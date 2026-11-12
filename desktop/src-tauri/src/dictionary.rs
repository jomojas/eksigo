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
fn from_repo(lang: &str) -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../backend/app/dictionaries");
    let index: Vec<serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(dir.join("index.json")).ok()?).ok()?;
    let e = index.iter().find(|e| e["lang"] == lang)?;
    Some(dir.join(e["file"].as_str()?))
}

fn inflate(data: &[u8]) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(data.len() * 3);
    flate2::read::DeflateDecoder::new(data).read_to_end(&mut out).context("The dictionary file is damaged")?;
    Ok(out)
}

/// Downloads (or, while developing, copies) the dictionary for `lang` into `dir`.
async fn install(dir: &Path, lang: &str) -> Result<(PathBuf, String)> {
    std::fs::create_dir_all(dir)?;
    if let Some(local) = from_repo(lang).filter(|p| p.exists()) {
        let raw = inflate(&std::fs::read(&local)?)?;
        let dest = dir.join(file_name(lang, 0));
        std::fs::write(&dest, raw)?;
        std::fs::write(dest.with_extension("source"), "ECDICT")?;
        return Ok((dest, "ECDICT".into()));
    }
    let listing: Listing = HTTP.get(API).send().await.context("The dictionary server can't be reached")?.error_for_status()?.json().await?;
    let d = listing
        .dictionaries
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

    pub fn with<T>(&self, lang: &str, f: impl FnOnce(&Dict) -> Result<T>) -> Result<T> {
        let map = self.0.lock().unwrap();
        f(map.get(lang).ok_or_else(|| anyhow!("The dictionary isn't ready yet."))?)
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
    fn get(&self, word: &str) -> Result<Option<Entry>> {
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
             INSERT INTO forms VALUES ('followed', 'follow'), ('arrives', 'arrive'), ('feeling', 'feel'), ('went', 'go'), ('made', 'make');",
        )
        .unwrap();
        Dict { conn, source: "ECDICT".into(), has_definition: true }
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
        let raw = inflate(&std::fs::read(from_repo("zh").unwrap()).unwrap()).unwrap();
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
