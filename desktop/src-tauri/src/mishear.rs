//! *What you mishear most* on the Progress page: the words missed in dictation over the last 90 days, sorted
//! by kind from the comparison saved with each answer. No AI: the kinds are the ones a word itself shows.
//!
//! Each missed word of the original (missing, wrong, or misspelled) goes to the first kind that fits:
//! - **spelling**: heard, but misspelled;
//! - **numbers**: digits or number words;
//! - **endings**: the word typed without its ending, or with another (-s, -ed, -ing);
//! - **stretch**: four or more words in a row missed: the thread was lost, not one word;
//! - **linked**: two or three words in a row missed, as when words run together ("kind of", "going to");
//! - **small**: a short grammar word on its own ("to", "of", "the", "it's");
//! - **names**: a capitalised word that doesn't start the sentence;
//! - **other**: any other word.

use std::collections::HashMap;

use anyhow::Result;
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::compare::{Comparison, Mark, Marked};

/// How far back it looks.
const DAYS: i64 = 90;

const SMALL: &[&str] = &[
    "a", "an", "the", "to", "of", "in", "on", "at", "for", "with", "by", "from", "and", "or", "but", "as", "is", "are",
    "was", "were", "be", "been", "being", "am", "it", "its", "that", "this", "these", "those", "there", "their", "they",
    "he", "she", "we", "you", "i", "me", "him", "her", "us", "them", "my", "your", "our", "his", "do", "does", "did",
    "have", "has", "had", "will", "would", "can", "could", "should", "shall", "may", "might", "must", "so", "if", "not",
    "no", "just", "than", "then", "up", "out", "about", "into", "some", "any", "all", "what", "who", "which", "when",
    "how", "one", "like", "get", "got", "go", "going", "kind", "sort", "lot", "bit", "now", "here", "oh", "yeah",
    "well", "okay", "ok", "right", "very", "really", "too", "also", "still", "only", "more", "most",
];

const NUMBERS: &[&str] = &[
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
    "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty",
    "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million", "billion", "half", "quarter",
    "percent", "first", "second", "third", "fourth", "fifth", "tenth", "hundredth",
];

const ENDINGS: &[&str] = &["s", "es", "d", "ed", "ing", "'s", "er", "est", "ly"];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Kind {
    /// "stretch", "linked", "small", "endings", "numbers", "names", "spelling" or "other".
    pub kind: &'static str,
    /// Words missed of this kind.
    pub count: i64,
    /// A few of them as they were said, most missed first.
    pub examples: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Missed {
    pub word: String,
    pub count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mishear {
    /// Sentences typed in the period.
    pub sentences: i64,
    /// Words missed in them.
    pub missed: i64,
    /// Most missed kind first; kinds with nothing are left out.
    pub kinds: Vec<Kind>,
    /// Words missed more than once, most first.
    pub words: Vec<Missed>,
}

/// Lowercase, without punctuation around it; curly apostrophes made straight.
fn plain(w: &str) -> String {
    w.replace('’', "'").trim_matches(|c: char| !c.is_alphanumeric() && c != '\'').trim_matches('\'').to_lowercase()
}

fn is_number(w: &str) -> bool {
    w.chars().any(|c| c.is_ascii_digit()) || w.split('-').all(|p| NUMBERS.contains(&p))
}

/// `typed` is `said` with a different ending, or without one: "walk" for "walked", "walks" for "walked".
fn ending_only(said: &str, typed: &str) -> bool {
    if said == typed || said.len() < 3 || typed.len() < 2 {
        return false;
    }
    let stem = |w: &str| -> String {
        ENDINGS
            .iter()
            .filter_map(|e| w.strip_suffix(e).filter(|s| s.len() >= 2))
            .min_by_key(|s| s.len())
            .unwrap_or(w)
            .to_string()
    };
    let (a, b) = (stem(said), stem(typed));
    a == b || a == typed || b == said
}

/// Per kind: words missed, and how often each example came up.
#[derive(Default)]
struct Tally {
    words: i64,
    examples: HashMap<String, i64>,
}

/// Sorts one sentence's missed words into `kinds`, and counts each word in `words`.
fn sort(c: &Comparison, kinds: &mut HashMap<&'static str, Tally>, words: &mut HashMap<String, i64>) {
    let scored: Vec<(usize, &Marked)> = c.original.iter().enumerate().filter(|(_, m)| m.mark != Mark::Ignored).collect();
    let missed = |m: &Marked| matches!(m.mark, Mark::Missing | Mark::Wrong);
    let typed_wrong: Vec<String> = c.typed.iter().filter(|m| m.mark == Mark::Wrong).map(|m| plain(&m.text)).collect();

    // Runs of missed words next to each other: the run is the example. Four or more is a lost stretch.
    let mut in_run: Vec<Option<&'static str>> = vec![None; scored.len()];
    let mut i = 0;
    while i < scored.len() {
        let mut j = i;
        while j < scored.len() && missed(scored[j].1) {
            j += 1;
        }
        if j - i >= 2 {
            let kind = if j - i >= 4 { "stretch" } else { "linked" };
            in_run[i..j].iter_mut().for_each(|x| *x = Some(kind));
            let words: Vec<String> = scored[i..j].iter().map(|(_, m)| plain(&m.text)).collect();
            let phrase = if words.len() > 4 { format!("{} …", words[..4].join(" ")) } else { words.join(" ") };
            *kinds.entry(kind).or_default().examples.entry(phrase).or_default() += 1;
        }
        i = j.max(i + 1);
    }

    for (k, (pos, m)) in scored.iter().enumerate() {
        if !matches!(m.mark, Mark::Missing | Mark::Wrong | Mark::Spelling) {
            continue;
        }
        let w = plain(&m.text);
        if w.is_empty() {
            continue;
        }
        let kind = if m.mark == Mark::Spelling {
            "spelling"
        } else if is_number(&w) {
            "numbers"
        } else if m.mark == Mark::Wrong && typed_wrong.iter().any(|t| ending_only(&w, t)) {
            "endings"
        } else if let Some(run) = in_run[k] {
            run
        } else if SMALL.contains(&w.as_str()) || w.contains('\'') {
            "small"
        } else if *pos > 0 && m.text.chars().next().is_some_and(char::is_uppercase) && w != "i" {
            "names"
        } else {
            "other"
        };
        let tally = kinds.entry(kind).or_default();
        tally.words += 1;
        if in_run[k] != Some(kind) {
            *tally.examples.entry(w.clone()).or_default() += 1;
        }
        if kind != "spelling" {
            *words.entry(w).or_default() += 1;
        }
    }
}

pub fn mishear(conn: &Connection, now: i64) -> Result<Mishear> {
    let mut stmt = conn.prepare("SELECT marks FROM answers WHERE kind = 'typed' AND marks IS NOT NULL AND answered_at >= ?1")?;
    let rows = stmt.query_map(params![now - DAYS * 86400], |r| r.get::<_, String>(0))?;
    let mut kinds: HashMap<&'static str, Tally> = HashMap::new();
    let mut words: HashMap<String, i64> = HashMap::new();
    let mut sentences = 0;
    for json in rows {
        let Ok(c) = serde_json::from_str::<Comparison>(&json?) else { continue };
        sentences += 1;
        sort(&c, &mut kinds, &mut words);
    }

    let mut out: Vec<Kind> = kinds
        .into_iter()
        .map(|(kind, tally)| {
            let mut ex: Vec<(String, i64)> = tally.examples.into_iter().collect();
            // Most missed first, then shorter, then alphabetically, so it's stable.
            ex.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.len().cmp(&b.0.len())).then(a.0.cmp(&b.0)));
            Kind { kind, count: tally.words, examples: ex.into_iter().take(4).map(|(w, _)| w).collect() }
        })
        .filter(|k| k.count > 0)
        .collect();
    out.sort_by(|a, b| b.count.cmp(&a.count).then(a.kind.cmp(b.kind)));
    let missed = out.iter().map(|k| k.count).sum();

    let mut top: Vec<Missed> = words.into_iter().filter(|(_, n)| *n > 1).map(|(word, count)| Missed { word, count }).collect();
    top.sort_by(|a, b| b.count.cmp(&a.count).then(a.word.cmp(&b.word)));
    top.truncate(12);

    Ok(Mishear { sentences, missed, kinds: out, words: top })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{compare::compare, db::Db};

    fn kinds_of(said: &str, typed: &str) -> HashMap<&'static str, i64> {
        let mut kinds = HashMap::new();
        let mut words = HashMap::new();
        sort(&compare(said, typed), &mut kinds, &mut words);
        kinds.into_iter().map(|(k, v)| (k, v.words)).filter(|(_, n)| *n > 0).collect()
    }

    #[test]
    fn each_missed_word_goes_to_one_kind() {
        assert_eq!(kinds_of("I went to the shop", "I went the shop"), HashMap::from([("small", 1)]));
        assert_eq!(kinds_of("She walked home", "She walk home"), HashMap::from([("endings", 1)]));
        assert_eq!(kinds_of("It costs fifteen pounds", "It costs pounds"), HashMap::from([("numbers", 1)]));
        assert_eq!(kinds_of("We met Sarah there", "We met there"), HashMap::from([("names", 1)]));
        assert_eq!(kinds_of("It was a kind of joke", "It was a joke"), HashMap::from([("linked", 2)]));
        assert_eq!(kinds_of("Then we all went down to the river", "Then river"), HashMap::from([("stretch", 6)]));
        assert_eq!(kinds_of("A beautiful garden", "A beutiful garden"), HashMap::from([("spelling", 1)]));
        assert_eq!(kinds_of("A remarkable garden", "A garden"), HashMap::from([("other", 1)]));
        assert!(kinds_of("All right", "All right").is_empty());
    }

    #[test]
    fn the_last_ninety_days_most_missed_first() {
        let db = Db::open_in_memory().unwrap();
        let c = db.conn();
        c.execute_batch(
            "INSERT INTO items (id, title, source, state, added_at) VALUES (1, 'A', 'Show', 'ready', 0);
             INSERT INTO attempts (id, item_id, started_at, updated_at) VALUES (1, 1, 0, 0);",
        )
        .unwrap();
        let now = 200 * 86400;
        let answer = |idx: i64, said: &str, typed: &str, at: i64| {
            let marks = serde_json::to_string(&compare(said, typed)).unwrap();
            c.execute(
                "INSERT INTO answers (attempt_id, idx, kind, original, typed, marks, answered_at) VALUES (1, ?1, 'typed', ?2, ?3, ?4, ?5)",
                params![idx, said, typed, marks, at],
            )
            .unwrap();
        };
        answer(0, "I went to the shop", "I went the shop", now - 10);
        answer(1, "We want to go", "We want go", now - 20);
        answer(2, "She walked home", "She walk home", now - 30);
        answer(3, "Back to the start", "Back the start", now - 100 * 86400); // too old

        let m = mishear(&c, now).unwrap();
        assert_eq!((m.sentences, m.missed), (3, 3));
        assert_eq!(m.kinds[0], Kind { kind: "small", count: 2, examples: vec!["to".into()] });
        assert_eq!(m.kinds[1].kind, "endings");
        assert_eq!(m.words, vec![Missed { word: "to".into(), count: 2 }]);
    }
}

