//! The offline dictionary of English words with meanings in the learner's language (DESIGN.md section 5):
//! downloaded once from `GET /v1/dictionaries`, checked, unpacked into the app's data folder and opened
//! read-only. Looking up a selection finds the whole phrase if the dictionary has it (in its base form,
//! or with "sb" / "sth" / "one's" for the people and things in it), else the longest phrase inside it,
//! and gives every word on its own as well.

use std::{
    collections::HashMap,
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
};

use anyhow::{anyhow, bail, Context, Result};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::podcasts::HTTP;

const API: &str = "https://api.eksigo.com/v1/dictionaries";

/// The dictionaries the server offers, by language code ("zh", "ja", "en", …).
#[derive(Debug, Clone, Deserialize)]
struct Listed {
    lang: String,
    version: i64,
    bytes: u64,
    sha256: String,
    source: String,
    url: String,
}

#[derive(Deserialize)]
struct Listing {
    dictionaries: Vec<Listed>,
}

/// Open dictionaries, by language.
#[derive(Default)]
pub struct Dictionaries(Mutex<HashMap<String, Dict>>);

pub struct Dict {
    conn: Connection,
    /// Where the meanings come from, credited on the card ("ECDICT").
    pub source: String,
    /// The English definitions column exists (zh) or not (the older files).
    has_definition: bool,
}

fn file_name(lang: &str, version: i64) -> String {
    format!("{lang}-{version}.sqlite")
}

/// The newest dictionary file for `lang` in `dir`, if one was downloaded.
fn on_disk(dir: &Path, lang: &str) -> Option<(PathBuf, String)> {
    let mut best: Option<(i64, PathBuf)> = None;
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Some(rest) = name.strip_prefix(&format!("{lang}-")).and_then(|r| r.strip_suffix(".sqlite")) else { continue };
        if let Ok(v) = rest.parse::<i64>() {
            if best.as_ref().is_none_or(|(b, _)| v > *b) {
                best = Some((v, e.path()));
            }
        }
    }
    let (_, path) = best?;
    let source = std::fs::read_to_string(path.with_extension("source")).unwrap_or_default();
    Some((path, source))
}

/// While developing, the file built in this repository (backend/app/dictionaries) is used before the
/// server has it.
fn repo_index() -> Option<(PathBuf, Vec<serde_json::Value>)> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../backend/app/dictionaries");
    let index: Vec<serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(dir.join("index.json")).ok()?).ok()?;
    Some((dir, index))
}

/// The repository's file for `lang` and its version.
fn from_repo(lang: &str) -> Option<(PathBuf, i64)> {
    let (dir, index) = repo_index()?;
    let e = index.iter().find(|e| e["lang"] == lang)?;
    Some((dir.join(e["file"].as_str()?), e["version"].as_i64().unwrap_or(0)))
}

/// What the server offers (or, while developing, the repository's index).
async fn listed() -> Result<Vec<Listed>> {
    if let Some((_, index)) = repo_index() {
        return Ok(index
            .iter()
            .filter_map(|e| {
                Some(Listed {
                    lang: e["lang"].as_str()?.into(),
                    version: e["version"].as_i64()?,
                    bytes: e["bytes"].as_u64()?,
                    sha256: e["sha256"].as_str()?.into(),
                    source: e["source"].as_str()?.into(),
                    url: String::new(),
                })
            })
            .collect());
    }
    let listing: Listing = HTTP.get(API).send().await.context("The dictionary server can't be reached")?.error_for_status()?.json().await?;
    Ok(listing.dictionaries)
}

/// The version of a dictionary file's name ("zh-1.sqlite" → 1).
fn version_of(path: &Path, lang: &str) -> i64 {
    path.file_stem()
        .and_then(|s| s.to_str())
        .and_then(|s| s.strip_prefix(&format!("{lang}-")))
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

/// Every file belonging to `lang`'s dictionaries in `dir` (the database, its credit, a half download).
fn files_of(dir: &Path, lang: &str) -> Vec<PathBuf> {
    let prefix = format!("{lang}-");
    std::fs::read_dir(dir)
        .map(|r| {
            r.flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
                        n.strip_prefix(&prefix).is_some_and(|rest| rest.split('.').next().is_some_and(|v| v.parse::<i64>().is_ok()))
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// One language's dictionary for Settings: what the server has, and what is on this computer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictInfo {
    pub lang: String,
    pub source: String,
    /// The download, packed; 0 when the server couldn't be reached.
    pub download_bytes: u64,
    pub latest_version: Option<i64>,
    /// On this computer, unpacked.
    pub installed_version: Option<i64>,
    pub installed_bytes: u64,
}

/// The dictionaries offered and installed. `offline` is true when the server couldn't be asked.
pub async fn list(dir: &Path) -> (Vec<DictInfo>, bool) {
    let (offered, offline) = match listed().await {
        Ok(l) => (l, false),
        Err(_) => (vec![], true),
    };
    let mut out: Vec<DictInfo> = offered
        .iter()
        .map(|d| DictInfo {
            lang: d.lang.clone(),
            source: d.source.clone(),
            download_bytes: d.bytes,
            latest_version: Some(d.version),
            installed_version: None,
            installed_bytes: 0,
        })
        .collect();
    // Installed ones the server no longer lists (or can't be asked about) still show, so they can be removed.
    let mut langs: Vec<String> = std::fs::read_dir(dir)
        .map(|r| {
            r.flatten()
                .filter_map(|e| e.file_name().to_str().and_then(|n| n.strip_suffix(".sqlite")).and_then(|n| n.split_once('-')).map(|(l, _)| l.to_string()))
                .collect()
        })
        .unwrap_or_default();
    langs.sort();
    langs.dedup();
    for lang in langs {
        let Some((path, source)) = on_disk(dir, &lang) else { continue };
        let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let version = version_of(&path, &lang);
        match out.iter_mut().find(|d| d.lang == lang) {
            Some(d) => {
                d.installed_version = Some(version);
                d.installed_bytes = bytes;
            }
            None => out.push(DictInfo {
                lang,
                source,
                download_bytes: 0,
                latest_version: None,
                installed_version: Some(version),
                installed_bytes: bytes,
            }),
        }
    }
    (out, offline)
}

fn inflate(data: &[u8]) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(data.len() * 3);
    flate2::read::DeflateDecoder::new(data).read_to_end(&mut out).context("The dictionary file is damaged")?;
    Ok(out)
}

/// Downloads (or, while developing, copies) the dictionary for `lang` into `dir`.
async fn install(dir: &Path, lang: &str) -> Result<(PathBuf, String)> {
    std::fs::create_dir_all(dir)?;
    if let Some((local, version)) = from_repo(lang).filter(|(p, _)| p.exists()) {
        let raw = inflate(&std::fs::read(&local)?)?;
        let source = listed().await?.into_iter().find(|d| d.lang == lang).map(|d| d.source).unwrap_or_default();
        let dest = dir.join(file_name(lang, version));
        std::fs::write(&dest, raw)?;
        std::fs::write(dest.with_extension("source"), &source)?;
        return Ok((dest, source));
    }
    let d = listed()
        .await?
        .into_iter()
        .find(|d| d.lang == lang)
        .ok_or_else(|| anyhow!("There's no dictionary for this language yet."))?;
    let data = HTTP.get(&d.url).send().await.context("The dictionary couldn't be downloaded")?.error_for_status()?.bytes().await?;
    if data.len() as u64 != d.bytes || hex::encode(Sha256::digest(&data)) != d.sha256 {
        bail!("The downloaded dictionary is damaged; try again");
    }
    let raw = inflate(&data)?;
    let dest = dir.join(file_name(lang, d.version));
    let part = dest.with_extension("part");
    std::fs::write(&part, raw)?;
    std::fs::rename(&part, &dest)?;
    std::fs::write(dest.with_extension("source"), &d.source)?;
    Ok((dest, d.source))
}

fn open(path: &Path, source: String) -> Result<Dict> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    let has_definition = conn.prepare("SELECT definition FROM words LIMIT 0").is_ok();
    Ok(Dict { conn, source, has_definition })
}

impl Dictionaries {
    /// Makes sure the dictionary for `lang` is open, downloading it the first time.
    pub async fn ensure(&self, dir: &Path, lang: &str) -> Result<()> {
        if self.0.lock().unwrap().contains_key(lang) {
            return Ok(());
        }
        let (path, source) = match on_disk(dir, lang) {
            Some(found) => found,
            None => install(dir, lang).await?,
        };
        let d = open(&path, source)?;
        self.0.lock().unwrap().insert(lang.to_string(), d);
        Ok(())
    }

    /// Downloads `lang`'s newest dictionary, replacing the one on this computer (Settings › Dictionaries).
    pub async fn update(&self, dir: &Path, lang: &str) -> Result<()> {
        let old = files_of(dir, lang);
        let (path, source) = install(dir, lang).await?;
        let d = open(&path, source)?;
        self.0.lock().unwrap().insert(lang.to_string(), d);
        for f in old.into_iter().filter(|f| f != &path && f != &path.with_extension("source")) {
            let _ = std::fs::remove_file(f);
        }
        Ok(())
    }

    /// Closes and deletes `lang`'s dictionary; it downloads again the next time it's needed.
    pub fn remove(&self, dir: &Path, lang: &str) -> Result<()> {
        self.0.lock().unwrap().remove(lang);
        for f in files_of(dir, lang) {
            std::fs::remove_file(&f).with_context(|| format!("{} couldn't be deleted", f.display()))?;
        }
        Ok(())
    }

    /// Whether `lang`'s dictionary lacks English definitions, so the English one is needed beside it.
    pub fn needs_english(&self, lang: &str) -> bool {
        lang != "en" && self.0.lock().unwrap().get(lang).is_some_and(|d| !d.has_definition)
    }

    /// Looks up `text` in `lang`'s dictionary; English definitions come from the English dictionary when
    /// `lang`'s has none (every language shows its meaning and the English definition).
    pub fn lookup(&self, lang: &str, text: &str) -> Result<Lookup> {
        let map = self.0.lock().unwrap();
        let d = map.get(lang).ok_or_else(|| anyhow!("The dictionary isn't ready yet."))?;
        let mut l = d.lookup(text)?;
        if !d.has_definition && lang != "en" {
            if let Some(en) = map.get("en") {
                en.fill_definitions(&mut l)?;
            }
        }
        Ok(l)
    }
}

// ---------- looking up ----------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// As the dictionary has it: "follow through", "put sb off", "arrive".
    pub headword: String,
    pub ipa: String,
    /// In the learner's language, one sense per line.
    pub meaning: String,
    /// In English, when the dictionary has it.
    pub definition: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordLine {
    /// As selected: "arrives".
    pub text: String,
    pub entry: Option<Entry>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lookup {
    /// The selection, tidied: "before the feeling arrives".
    pub query: String,
    /// The whole selection, or the longest phrase found inside it.
    pub entry: Option<Entry>,
    /// True when `entry` covers the whole selection.
    pub whole: bool,
    /// For more than one word: each word on its own.
    pub words: Vec<WordLine>,
    pub source: String,
}

/// Lower case, curly quotes made straight, punctuation trimmed from the ends of each word.
pub fn tokens(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|w| w.to_lowercase().replace(['’', '‘', '`'], "'"))
        .map(|w| w.trim_matches(|c: char| !(c.is_alphanumeric() || c == '\'' || c == '-')).trim_matches('\'').to_string())
        .filter(|w| !w.is_empty())
        .collect()
}

const INFLECTION_NOTES: &[&str] = &["的过去式", "的过去分词", "的现在分词", "的第三人称", "的复数", "的比较级", "的最高级", "past tense of", "plural of"];

const PEOPLE: &[&str] = &["me", "you", "him", "her", "us", "them", "someone", "somebody", "everyone", "everybody", "people"];
const THINGS: &[&str] = &["it", "this", "that", "these", "those", "something", "everything", "anything"];
const POSSESSIVE: &[&str] = &["my", "your", "his", "her", "its", "our", "their"];

impl Dict {
    /// As written (selections are lower-cased), else as a name ("English", "New York") or an abbreviation
    /// ("BBC"), which the dictionary keeps capitalised.
    fn get(&self, word: &str) -> Result<Option<Entry>> {
        if let Some(e) = self.get_exact(word)? {
            return Ok(Some(e));
        }
        if !word.chars().any(char::is_lowercase) {
            return Ok(None);
        }
        let title: String = word
            .split(' ')
            .map(|w| {
                let mut c = w.chars();
                c.next().map(|f| f.to_uppercase().chain(c).collect::<String>()).unwrap_or_default()
            })
            .collect::<Vec<_>>()
            .join(" ");
        if let Some(e) = self.get_exact(&title)? {
            return Ok(Some(e));
        }
        self.get_exact(&word.to_uppercase())
    }

    fn get_exact(&self, word: &str) -> Result<Option<Entry>> {
        let sql = if self.has_definition {
            "SELECT word, ipa, meaning, definition FROM words WHERE word = ?1"
        } else {
            "SELECT word, ipa, meaning, '' FROM words WHERE word = ?1"
        };
        Ok(self
            .conn
            .query_row(sql, [word], |r| Ok(Entry { headword: r.get(0)?, ipa: r.get(1)?, meaning: r.get(2)?, definition: r.get(3)? }))
            .optional()?)
    }

    fn base(&self, form: &str) -> Result<Option<String>> {
        Ok(self.conn.query_row("SELECT word FROM forms WHERE form = ?1", [form], |r| r.get(0)).optional()?)
    }

    /// One word: as written, else its base form ("arrives" → "arrive", "went" → "go").
    fn word(&self, w: &str) -> Result<Option<Entry>> {
        if let Some(e) = self.get(w)? {
            // A form whose own entry only says what it is a form of ("arrive的第三人称单数") is better as
            // its base; one with meanings of its own ("feeling: 感觉") stays.
            if INFLECTION_NOTES.iter().any(|n| e.meaning.contains(n)) {
                if let Some(base) = self.base(w)?.map(|b| self.get(&b)).transpose()?.flatten() {
                    return Ok(Some(base));
                }
            }
            return Ok(Some(e));
        }
        if let Some(b) = self.base(w)? {
            return self.get(&b);
        }
        if let Some(stem) = w.strip_suffix("'s") {
            return self.word(stem);
        }
        Ok(None)
    }

    /// The ways a run of words may be written in the dictionary, most literal first.
    fn variants(&self, words: &[String]) -> Result<Vec<String>> {
        let mut options: Vec<Vec<Option<String>>> = Vec::new();
        for w in words {
            let mut o = vec![Some(w.clone())];
            if let Some(b) = self.base(w)? {
                o.push(Some(b));
            }
            if PEOPLE.contains(&w.as_str()) {
                o.push(Some("sb".into()));
            }
            if THINGS.contains(&w.as_str()) {
                o.push(Some("sth".into()));
            }
            if POSSESSIVE.contains(&w.as_str()) {
                o.push(Some("one's".into()));
            }
            // "give it up" is "give up".
            if PEOPLE.contains(&w.as_str()) || THINGS.contains(&w.as_str()) {
                o.push(None);
            }
            options.push(o);
        }
        let mut out: Vec<String> = Vec::new();
        let mut combo = vec![0usize; options.len()];
        loop {
            let phrase: Vec<&str> = combo.iter().enumerate().filter_map(|(i, &k)| options[i][k].as_deref()).collect();
            if phrase.len() >= 2 {
                let p = phrase.join(" ");
                if !out.contains(&p) {
                    out.push(p);
                }
            }
            if out.len() >= 200 {
                break;
            }
            // The next combination, changing the last words first.
            let mut i = options.len();
            loop {
                if i == 0 {
                    return Ok(out);
                }
                i -= 1;
                combo[i] += 1;
                if combo[i] < options[i].len() {
                    break;
                }
                combo[i] = 0;
            }
        }
        Ok(out)
    }

    fn phrase(&self, words: &[String]) -> Result<Option<Entry>> {
        for v in self.variants(words)? {
            if let Some(e) = self.get(&v)? {
                return Ok(Some(e));
            }
        }
        Ok(None)
    }

    /// Fills empty English definitions from this (English) dictionary, whose meanings are definitions.
    fn fill_definitions(&self, l: &mut Lookup) -> Result<()> {
        let fill = |e: &mut Entry| -> Result<()> {
            if e.definition.is_empty() {
                if let Some(en) = self.word(&e.headword)? {
                    e.definition = en.meaning;
                }
            }
            Ok(())
        };
        if let Some(e) = l.entry.as_mut() {
            fill(e)?;
        }
        for w in l.words.iter_mut() {
            if let Some(e) = w.entry.as_mut() {
                fill(e)?;
            }
        }
        Ok(())
    }

    pub fn lookup(&self, text: &str) -> Result<Lookup> {
        let words = tokens(text);
        let query = words.join(" ");
        let mut out = Lookup { query, entry: None, whole: false, words: Vec::new(), source: self.source.clone() };
        match words.len() {
            0 => {}
            1 => {
                out.entry = self.word(&words[0])?;
                out.whole = out.entry.is_some();
            }
            n => {
                out.entry = self.get(&out.query)?.map(Ok).or_else(|| self.phrase(&words).transpose()).transpose()?;
                out.whole = out.entry.is_some();
                // Else the longest phrase inside the selection.
                'spans: for len in (2..n.min(7)).rev() {
                    if out.entry.is_some() {
                        break;
                    }
                    for start in 0..=n - len {
                        if let Some(e) = self.phrase(&words[start..start + len])? {
                            out.entry = Some(e);
                            break 'spans;
                        }
                    }
                }
                for w in &words {
                    out.words.push(WordLine { text: w.clone(), entry: self.word(w)? });
                }
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A small dictionary in the shape of the real one.
    fn dict() -> Dict {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE words (word TEXT PRIMARY KEY, ipa TEXT NOT NULL, meaning TEXT NOT NULL, definition TEXT NOT NULL);
             CREATE TABLE forms (form TEXT PRIMARY KEY, word TEXT NOT NULL);
             INSERT INTO words VALUES ('follow through', '', '坚持到底', ''), ('follow', '/ˈfɒləʊ/', '跟随', 'go after'),
               ('through', '/θruː/', '穿过', ''), ('arrive', '/əˈraɪv/', '到达', 'reach a destination'),
               ('arrives', '', 'arrive的第三人称单数', ''), ('feeling', '', '感觉', ''), ('feel', '', '感到', ''), ('the', '', '那', ''),
               ('before', '', '在…之前', ''), ('put sb off', '', '使某人反感', ''), ('give up', '', '放弃', ''),
               ('make up one''s mind', '', '下定决心', ''), ('go', '', '去', '');
             INSERT INTO words VALUES ('English', '/ˈɪŋɡlɪʃ/', '英语', ''), ('BBC', '', '英国广播公司', ''), ('New York', '', '纽约', ''), ('book', '', '书', '');
             INSERT INTO forms VALUES ('books', 'book');
             INSERT INTO forms VALUES ('followed', 'follow'), ('arrives', 'arrive'), ('feeling', 'feel'), ('went', 'go'), ('made', 'make');",
        )
        .unwrap();
        Dict { conn, source: "ECDICT".into(), has_definition: true }
    }

    #[tokio::test]
    async fn installed_dictionaries_are_listed_and_removed() {
        let dir = std::env::temp_dir().join(format!("eksigo-dicts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for f in ["zh-0.sqlite", "zh-0.source", "zh-1.part", "xx-2.sqlite", "zz.sqlite"] {
            std::fs::write(dir.join(f), "ab").unwrap();
        }
        let (list, offline) = list(&dir).await;
        assert!(!offline, "while developing, the repository's index is the listing");
        let zh = list.iter().find(|d| d.lang == "zh").unwrap();
        assert_eq!((zh.installed_version, zh.installed_bytes, zh.latest_version), (Some(0), 2, Some(1)));
        let xx = list.iter().find(|d| d.lang == "xx").unwrap();
        assert_eq!((xx.installed_version, xx.latest_version), (Some(2), None), "installed but no longer offered");
        assert!(list.iter().find(|d| d.lang == "ja").unwrap().installed_version.is_none());

        Dictionaries::default().remove(&dir, "zh").unwrap();
        let mut left: Vec<String> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into()).collect();
        left.sort();
        assert_eq!(left, ["xx-2.sqlite", "zz.sqlite"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_word_is_found_in_its_base_form() {
        let d = dict();
        let l = d.lookup("Arrives,").unwrap();
        assert_eq!((l.query.as_str(), l.entry.unwrap().headword.as_str(), l.whole), ("arrives", "arrive", true));
        assert_eq!(d.lookup("went").unwrap().entry.unwrap().headword, "go");
        assert!(d.lookup("zzz").unwrap().entry.is_none());
    }

    #[test]
    fn names_and_abbreviations_are_found_whatever_the_case() {
        let d = dict();
        for (text, head) in [("English", "English"), ("english.", "English"), ("BBC", "BBC"), ("bbc", "BBC"), ("new york", "New York"), ("Books", "book")] {
            assert_eq!(d.lookup(text).unwrap().entry.map(|e| e.headword).as_deref(), Some(head), "{text}");
        }
    }

    #[test]
    fn phrases_are_found_with_their_forms_and_people_and_things() {
        let d = dict();
        for (text, head) in [
            ("Follow through.", "follow through"),
            ("followed through", "follow through"),
            ("put them off", "put sb off"),
            ("give it up", "give up"),
            ("made up her mind", "make up one's mind"),
        ] {
            let l = d.lookup(text).unwrap();
            assert_eq!(l.entry.as_ref().map(|e| e.headword.as_str()), Some(head), "{text}");
            assert!(l.whole, "{text}");
        }
    }

    #[test]
    fn otherwise_the_longest_phrase_inside_and_every_word() {
        let d = dict();
        let l = d.lookup("you just have to follow through").unwrap();
        assert_eq!(l.entry.unwrap().headword, "follow through");
        assert!(!l.whole);
        let l = d.lookup("before the feeling arrives").unwrap();
        assert!(l.entry.is_none());
        let heads: Vec<Option<&str>> = l.words.iter().map(|w| w.entry.as_ref().map(|e| e.headword.as_str())).collect();
        assert_eq!(heads, vec![Some("before"), Some("the"), Some("feeling"), Some("arrive")]);
    }

    #[test]
    fn other_languages_get_english_definitions_from_the_english_dictionary() {
        let ja = Connection::open_in_memory().unwrap();
        ja.execute_batch(
            "CREATE TABLE words (word TEXT PRIMARY KEY, ipa TEXT NOT NULL, meaning TEXT NOT NULL);
             CREATE TABLE forms (form TEXT PRIMARY KEY, word TEXT NOT NULL);
             INSERT INTO words VALUES ('follow', '', '…の後について行く');",
        )
        .unwrap();
        let en = Connection::open_in_memory().unwrap();
        en.execute_batch(
            "CREATE TABLE words (word TEXT PRIMARY KEY, ipa TEXT NOT NULL, meaning TEXT NOT NULL);
             CREATE TABLE forms (form TEXT PRIMARY KEY, word TEXT NOT NULL);
             INSERT INTO words VALUES ('follow', '', 'v. to travel behind, go after');",
        )
        .unwrap();
        let dicts = Dictionaries::default();
        dicts.0.lock().unwrap().insert("ja".into(), Dict { conn: ja, source: "EJDict".into(), has_definition: false });
        assert!(dicts.needs_english("ja"));
        dicts.0.lock().unwrap().insert("en".into(), Dict { conn: en, source: "ECDICT".into(), has_definition: false });
        let l = dicts.lookup("ja", "Follow").unwrap();
        let e = l.entry.unwrap();
        assert_eq!((e.meaning.as_str(), e.definition.as_str()), ("…の後について行く", "v. to travel behind, go after"));
    }

    #[test]
    fn the_downloaded_file_is_raw_deflate() {
        let mut c = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
        std::io::Write::write_all(&mut c, b"SQLite format 3").unwrap();
        assert_eq!(inflate(&c.finish().unwrap()).unwrap(), b"SQLite format 3");
    }

    /// The real Chinese dictionary built in this repository: `cargo test -- --ignored the_built_dictionary`.
    #[test]
    #[ignore = "needs backend/app/dictionaries/zh-1.sqlite.deflate"]
    fn the_built_dictionary() {
        let dir = std::env::temp_dir().join(format!("eksigo-dict-{}", std::process::id()));
        let raw = inflate(&std::fs::read(from_repo("zh").unwrap().0).unwrap()).unwrap();
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("zh-0.sqlite");
        std::fs::write(&p, raw).unwrap();
        let d = open(&p, "ECDICT".into()).unwrap();
        for (text, head) in [("followed through", "follow through"), ("put them off", "put off"), ("itching", "itching"), ("arrives", "arrive"), ("in the long run", "in the long run")] {
            let l = d.lookup(text).unwrap();
            println!("{text}: {:?}", l.entry);
            assert_eq!(l.entry.map(|e| e.headword), Some(head.to_string()), "{text}");
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
}
