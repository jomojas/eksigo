//! My words: words and phrases the learner saved from a review, each with its meaning, their own note,
//! and every sentence it was saved from (the sentence, what was typed, and where the words are in the
//! audio, so the card can play them as said).

use anyhow::{anyhow, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

/// The audio times of each word of a sentence, `[start_ms, end_ms]`, in the order of its text's words.
pub fn word_times(conn: &Connection, item_id: i64, idx: i64) -> Result<Vec<[i64; 2]>> {
    let json: String = conn
        .query_row("SELECT words FROM sentences WHERE item_id = ?1 AND idx = ?2", params![item_id, idx], |r| r.get(0))
        .optional()?
        .ok_or_else(|| anyhow!("That sentence is no longer transcribed."))?;
    let words: Vec<(i64, i64, String)> = serde_json::from_str(&json)?;
    // A word written with a space inside it ("e. g.") still counts as one per written word.
    let mut out = Vec::new();
    for (s, e, text) in words {
        for _ in 0..text.split_whitespace().count().max(1) {
            out.push([s, e]);
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewWord {
    /// As selected and tidied: "follow through".
    pub text: String,
    pub headword: String,
    pub ipa: String,
    pub meaning: String,
    pub note: String,
    pub item_id: i64,
    pub idx: i64,
    /// The selected written words of the sentence, `from..=to`.
    pub from: usize,
    pub to: usize,
    pub typed: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    pub item_id: Option<i64>,
    pub item_title: Option<String>,
    pub path: Option<String>,
    pub idx: i64,
    pub sentence: String,
    pub typed: String,
    /// The saved words in the audio.
    pub start_ms: i64,
    pub end_ms: i64,
    /// The whole sentence in the audio.
    pub sentence_start_ms: i64,
    pub sentence_end_ms: i64,
    pub added_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedWord {
    pub id: i64,
    pub text: String,
    pub headword: String,
    pub ipa: String,
    pub meaning: String,
    pub note: String,
    pub added_at: i64,
    /// "new", "learning", "familiar" or "known" (practice.rs).
    pub level: String,
    /// When it next comes up for practice; None while new.
    pub due_at: Option<i64>,
    /// Times practised.
    pub reviews: i64,
    pub contexts: Vec<Context>,
}

/// Saves a word, or adds this sentence to it when it is already saved (a new note replaces an empty one).
pub fn add(conn: &Connection, w: &NewWord) -> Result<SavedWord> {
    let times = word_times(conn, w.item_id, w.idx)?;
    let (start_ms, end_ms) = match (times.get(w.from), times.get(w.to.min(times.len().saturating_sub(1)))) {
        (Some(a), Some(b)) => (a[0], b[1].max(a[0])),
        _ => {
            let (s, e): (i64, i64) =
                conn.query_row("SELECT start_ms, end_ms FROM sentences WHERE item_id = ?1 AND idx = ?2", params![w.item_id, w.idx], |r| Ok((r.get(0)?, r.get(1)?)))?;
            (s, e)
        }
    };
    let (sentence, s_start, s_end): (String, i64, i64) =
        conn.query_row("SELECT text, start_ms, end_ms FROM sentences WHERE item_id = ?1 AND idx = ?2", params![w.item_id, w.idx], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    let t = now();
    conn.execute(
        "INSERT INTO saved_words (text, headword, ipa, meaning, note, added_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT (text) DO UPDATE SET updated_at = excluded.updated_at,
           note = CASE WHEN saved_words.note = '' THEN excluded.note ELSE saved_words.note END",
        params![w.text.trim(), w.headword, w.ipa, w.meaning, w.note.trim(), t],
    )?;
    let id: i64 = conn.query_row("SELECT id FROM saved_words WHERE text = ?1", [w.text.trim()], |r| r.get(0))?;
    conn.execute(
        "INSERT OR IGNORE INTO word_contexts (word_id, item_id, idx, sentence, typed, start_ms, end_ms, sentence_start_ms, sentence_end_ms, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![id, w.item_id, w.idx, sentence, w.typed, start_ms, end_ms, s_start, s_end, t],
    )?;
    get(conn, id)
}

pub fn set_note(conn: &Connection, id: i64, note: &str) -> Result<()> {
    conn.execute("UPDATE saved_words SET note = ?2, updated_at = ?3 WHERE id = ?1", params![id, note.trim(), now()])?;
    Ok(())
}

pub fn remove(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM saved_words WHERE id = ?1", [id])?;
    Ok(())
}

fn contexts(conn: &Connection, id: i64) -> Result<Vec<Context>> {
    let mut st = conn.prepare(
        "SELECT c.item_id, i.title, i.path, c.idx, c.sentence, c.typed, c.start_ms, c.end_ms, c.sentence_start_ms, c.sentence_end_ms, c.added_at
         FROM word_contexts c LEFT JOIN items i ON i.id = c.item_id WHERE c.word_id = ?1 ORDER BY c.added_at DESC",
    )?;
    let rows = st
        .query_map([id], |r| {
            Ok(Context {
                item_id: r.get(0)?,
                item_title: r.get(1)?,
                path: r.get(2)?,
                idx: r.get(3)?,
                sentence: r.get(4)?,
                typed: r.get(5)?,
                start_ms: r.get(6)?,
                end_ms: r.get(7)?,
                sentence_start_ms: r.get(8)?,
                sentence_end_ms: r.get(9)?,
                added_at: r.get(10)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: i64) -> Result<SavedWord> {
    let mut w = conn.query_row(
        "SELECT id, text, headword, ipa, meaning, note, added_at, level, due_at,
           (SELECT COUNT(*) FROM word_reviews WHERE word_id = saved_words.id AND mode != 'known')
         FROM saved_words WHERE id = ?1",
        [id],
        |r| {
            Ok(SavedWord {
                id: r.get(0)?,
                text: r.get(1)?,
                headword: r.get(2)?,
                ipa: r.get(3)?,
                meaning: r.get(4)?,
                note: r.get(5)?,
                added_at: r.get(6)?,
                level: r.get(7)?,
                due_at: r.get(8)?,
                reviews: r.get(9)?,
                contexts: vec![],
            })
        },
    )?;
    w.contexts = contexts(conn, id)?;
    Ok(w)
}

/// Every saved word, newest first.
pub fn list(conn: &Connection) -> Result<Vec<SavedWord>> {
    let ids: Vec<i64> = conn.prepare("SELECT id FROM saved_words ORDER BY updated_at DESC, id DESC")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    ids.into_iter().map(|id| get(conn, id)).collect()
}

/// The saved words among `texts` (to show "Saved" on the card).
pub fn saved(conn: &Connection, text: &str) -> Result<Option<i64>> {
    Ok(conn.query_row("SELECT id FROM saved_words WHERE text = ?1", [text.trim()], |r| r.get(0)).optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn setup() -> Db {
        let db = Db::open_in_memory().unwrap();
        {
            let c = db.conn();
            c.execute("INSERT INTO items (id, title, source, own_file, path, state, added_at) VALUES (1, 'Talk', 'My files', 1, '/x.mp3', 'ready', 0)", [])
                .unwrap();
            c.execute(
                "INSERT INTO sentences (item_id, idx, start_ms, end_ms, text, words) VALUES (1, 0, 900, 4100, 'You have to follow through.', ?1)",
                [r#"[[1000,1200,"You"],[1200,1400,"have"],[1400,1500,"to"],[1500,1900,"follow"],[1900,2400,"through."]]"#],
            )
            .unwrap();
        }
        db
    }

    fn new(text: &str, from: usize, to: usize, note: &str) -> NewWord {
        NewWord {
            text: text.into(),
            headword: text.into(),
            ipa: String::new(),
            meaning: "坚持到底".into(),
            note: note.into(),
            item_id: 1,
            idx: 0,
            from,
            to,
            typed: "You have to follow true.".into(),
        }
    }

    #[test]
    fn a_saved_word_keeps_its_sentence_and_where_it_is_in_the_audio() {
        let db = setup();
        let c = db.conn();
        let w = add(&c, &new("follow through", 3, 4, "")).unwrap();
        assert_eq!(w.contexts.len(), 1);
        let ctx = &w.contexts[0];
        assert_eq!((ctx.start_ms, ctx.end_ms, ctx.path.as_deref()), (1500, 2400, Some("/x.mp3")));
        assert_eq!((ctx.sentence_start_ms, ctx.sentence_end_ms), (900, 4100));
        assert_eq!(ctx.sentence, "You have to follow through.");
        // Saving it again from the same sentence changes nothing; a note fills an empty one.
        let again = add(&c, &new("Follow Through", 3, 4, "keep going")).unwrap();
        assert_eq!((again.id, again.contexts.len(), again.note.as_str()), (w.id, 1, "keep going"));
        assert_eq!(saved(&c, "follow through").unwrap(), Some(w.id));
        set_note(&c, w.id, "finish it").unwrap();
        assert_eq!(list(&c).unwrap()[0].note, "finish it");
        remove(&c, w.id).unwrap();
        assert!(list(&c).unwrap().is_empty());
    }
}
