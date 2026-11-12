//! Dictation attempts in the database: starting and resuming, saving each sentence's answer with its
//! comparison, sections marked as ads, and the progress the Library, the sidebar and Today show.

use anyhow::{anyhow, bail, Result};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

use crate::compare::{self, Comparison};

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Longer than this between two answers, the learner was away; the time isn't counted.
pub const MAX_SECONDS_PER_SENTENCE: i64 = 180;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
    pub id: i64,
    pub item_id: i64,
    pub started_at: i64,
    pub updated_at: i64,
    pub finished_at: Option<i64>,
    pub position: i64,
    pub seconds: i64,
}

const ATTEMPT_COLS: &str = "id, item_id, started_at, updated_at, finished_at, position, seconds";

fn attempt_from(r: &Row) -> rusqlite::Result<Attempt> {
    Ok(Attempt {
        id: r.get(0)?,
        item_id: r.get(1)?,
        started_at: r.get(2)?,
        updated_at: r.get(3)?,
        finished_at: r.get(4)?,
        position: r.get(5)?,
        seconds: r.get(6)?,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Typed,
    Known,
    Ad,
}

impl Kind {
    pub fn parse(s: &str) -> Result<Self> {
        Ok(match s {
            "typed" => Kind::Typed,
            "known" => Kind::Known,
            "ad" => Kind::Ad,
            _ => bail!("unknown answer kind {s}"),
        })
    }
    fn as_str(self) -> &'static str {
        match self {
            Kind::Typed => "typed",
            Kind::Known => "known",
            Kind::Ad => "ad",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub idx: i64,
    /// "typed", "known" or "ad".
    pub kind: String,
    pub original: String,
    pub typed: String,
    pub plays: i64,
    pub credit: f64,
    pub total: i64,
    pub spelling: i64,
    pub comparison: Option<Comparison>,
}

fn answer_from(r: &Row) -> rusqlite::Result<Answer> {
    let marks: Option<String> = r.get(8)?;
    Ok(Answer {
        idx: r.get(0)?,
        kind: r.get(1)?,
        original: r.get(2)?,
        typed: r.get(3)?,
        plays: r.get(4)?,
        credit: r.get(5)?,
        total: r.get(6)?,
        spelling: r.get(7)?,
        comparison: marks.and_then(|m| serde_json::from_str(&m).ok()),
    })
}

pub fn attempt(conn: &Connection, id: i64) -> Result<Attempt> {
    conn.query_row(&format!("SELECT {ATTEMPT_COLS} FROM attempts WHERE id = ?1"), [id], attempt_from)
        .optional()?
        .ok_or_else(|| anyhow!("That dictation no longer exists."))
}

/// The item's unfinished attempt, if there is one.
pub fn open_attempt(conn: &Connection, item_id: i64) -> Result<Option<Attempt>> {
    Ok(conn
        .query_row(
            &format!("SELECT {ATTEMPT_COLS} FROM attempts WHERE item_id = ?1 AND finished_at IS NULL ORDER BY started_at DESC, id DESC LIMIT 1"),
            [item_id],
            attempt_from,
        )
        .optional()?)
}

/// The unfinished attempt to carry on, or a new one. `again` starts a new one even when one is open;
/// the open one is then closed where it stopped (unless nothing was done in it, when it is simply reused).
pub fn start(conn: &Connection, item_id: i64, again: bool) -> Result<Attempt> {
    if let Some(a) = open_attempt(conn, item_id)? {
        let untouched = a.position == 0 && conn.query_row("SELECT NOT EXISTS (SELECT 1 FROM answers WHERE attempt_id = ?1)", [a.id], |r| r.get::<_, bool>(0))?;
        if !again || untouched {
            return Ok(a);
        }
        conn.execute("UPDATE attempts SET finished_at = ?2 WHERE id = ?1", params![a.id, now()])?;
    }
    let t = now();
    conn.execute("INSERT INTO attempts (item_id, started_at, updated_at) VALUES (?1, ?2, ?2)", params![item_id, t])?;
    attempt(conn, conn.last_insert_rowid())
}

pub fn answers(conn: &Connection, attempt_id: i64) -> Result<Vec<Answer>> {
    let mut st = conn.prepare(
        "SELECT idx, kind, original, typed, plays, credit, total, spelling, marks FROM answers WHERE attempt_id = ?1 ORDER BY idx",
    )?;
    let rows = st.query_map([attempt_id], answer_from)?.collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

fn sentence_text(conn: &Connection, item_id: i64, idx: i64) -> Result<String> {
    conn.query_row("SELECT text FROM sentences WHERE item_id = ?1 AND idx = ?2", params![item_id, idx], |r| r.get(0))
        .optional()?
        .ok_or_else(|| anyhow!("Sentence {} isn't transcribed yet.", idx + 1))
}

/// Saves the answer to one sentence, compared with the original, and moves the attempt on past it.
/// `seconds` is the time spent since the last save.
pub fn answer(conn: &Connection, attempt_id: i64, idx: i64, kind: Kind, typed: &str, plays: i64, seconds: i64) -> Result<Answer> {
    let a = attempt(conn, attempt_id)?;
    let original = sentence_text(conn, a.item_id, idx)?;
    let comparison = match kind {
        Kind::Typed => Some(compare::compare(&original, typed)),
        Kind::Known => Some(compare::known(&original)),
        Kind::Ad => None,
    };
    let (credit, total, spelling) = comparison.as_ref().map(|c| (c.credit, c.total as i64, c.spelling as i64)).unwrap_or((0.0, 0, 0));
    let typed = if kind == Kind::Typed { typed.trim().to_string() } else { String::new() };
    let t = now();
    conn.execute(
        "INSERT INTO answers (attempt_id, idx, kind, original, typed, plays, credit, total, spelling, marks, answered_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT (attempt_id, idx) DO UPDATE SET kind = excluded.kind, original = excluded.original, typed = excluded.typed,
           plays = excluded.plays, credit = excluded.credit, total = excluded.total, spelling = excluded.spelling,
           marks = excluded.marks, answered_at = excluded.answered_at",
        params![
            attempt_id,
            idx,
            kind.as_str(),
            original,
            typed,
            plays,
            credit,
            total,
            spelling,
            comparison.as_ref().map(|c| serde_json::to_string(c).unwrap()),
            t
        ],
    )?;
    save_position(conn, attempt_id, idx + 1, seconds)?;
    Ok(Answer { idx, kind: kind.as_str().into(), original, typed, plays, credit, total, spelling, comparison })
}

/// Marks sentences `from..to` as an ad: left out of the score. The attempt carries on at `to`.
pub fn mark_ads(conn: &Connection, attempt_id: i64, from: i64, to: i64, seconds: i64) -> Result<()> {
    for idx in from..to {
        answer(conn, attempt_id, idx, Kind::Ad, "", 0, 0)?;
    }
    save_position(conn, attempt_id, to, seconds)
}

/// Where the learner is (moving with Ctrl ← →, or stopping), and time spent since the last save.
pub fn save_position(conn: &Connection, attempt_id: i64, position: i64, seconds: i64) -> Result<()> {
    let t = now();
    conn.execute(
        "UPDATE attempts SET position = ?2, seconds = seconds + ?3, updated_at = ?4 WHERE id = ?1",
        params![attempt_id, position.max(0), seconds.clamp(0, MAX_SECONDS_PER_SENTENCE), t],
    )?;
    conn.execute("UPDATE items SET last_practised_at = ?2 WHERE id = (SELECT item_id FROM attempts WHERE id = ?1)", params![attempt_id, t])?;
    Ok(())
}

/// Flags sentence `idx` for the review, or takes the flag off.
pub fn flag(conn: &Connection, attempt_id: i64, idx: i64, on: bool) -> Result<()> {
    if on {
        conn.execute("INSERT OR IGNORE INTO flagged (attempt_id, idx) VALUES (?1, ?2)", params![attempt_id, idx])?;
    } else {
        conn.execute("DELETE FROM flagged WHERE attempt_id = ?1 AND idx = ?2", params![attempt_id, idx])?;
    }
    Ok(())
}

/// The sentences flagged in an attempt.
pub fn flagged(conn: &Connection, attempt_id: i64) -> Result<Vec<i64>> {
    let mut st = conn.prepare("SELECT idx FROM flagged WHERE attempt_id = ?1 ORDER BY idx")?;
    let rows = st.query_map([attempt_id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// The last sentence is done: the attempt is closed.
pub fn finish(conn: &Connection, attempt_id: i64) -> Result<()> {
    conn.execute("UPDATE attempts SET finished_at = COALESCE(finished_at, ?2) WHERE id = ?1", params![attempt_id, now()])?;
    Ok(())
}

/// An attempt in numbers, for the results, the Episode page and the Library.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub attempt: Attempt,
    /// Sentences answered (typed or known), not counting ads.
    pub done: i64,
    pub known: i64,
    /// Typed sentences with at least one word not fully right.
    pub with_mistakes: i64,
    pub ads: i64,
    /// Sentences flagged for the review.
    pub flagged: i64,
    pub credit: f64,
    pub total: i64,
    pub spelling: i64,
    /// 0–1, or None before any word is scored.
    pub accuracy: Option<f64>,
    /// Sentences in the transcript so far, and whether it is complete.
    pub sentences: i64,
    pub transcript_done: bool,
}

pub fn summary(conn: &Connection, attempt_id: i64) -> Result<Summary> {
    let a = attempt(conn, attempt_id)?;
    let (done, known, with_mistakes, ads, credit, total, spelling): (i64, i64, i64, i64, f64, i64, i64) = conn.query_row(
        "SELECT
            COALESCE(SUM(kind != 'ad'), 0),
            COALESCE(SUM(kind = 'known'), 0),
            COALESCE(SUM(kind = 'typed' AND credit < total), 0),
            COALESCE(SUM(kind = 'ad'), 0),
            COALESCE(SUM(credit), 0),
            COALESCE(SUM(total), 0),
            COALESCE(SUM(spelling), 0)
         FROM answers WHERE attempt_id = ?1",
        [attempt_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
    )?;
    let flagged: i64 = conn.query_row("SELECT count(*) FROM flagged WHERE attempt_id = ?1", [attempt_id], |r| r.get(0))?;
    let (sentences, transcript_done): (i64, bool) = conn.query_row(
        "SELECT (SELECT count(*) FROM sentences WHERE item_id = ?1),
                COALESCE((SELECT state = 'done' FROM transcripts WHERE item_id = ?1), 0)",
        [a.item_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(Summary {
        attempt: a,
        done,
        known,
        with_mistakes,
        ads,
        flagged,
        credit,
        total,
        spelling,
        accuracy: (total > 0).then(|| credit / total as f64),
        sentences,
        transcript_done,
    })
}

/// Every attempt at an item, newest first.
pub fn summaries(conn: &Connection, item_id: i64) -> Result<Vec<Summary>> {
    let mut st = conn.prepare("SELECT id FROM attempts WHERE item_id = ?1 ORDER BY started_at DESC, id DESC")?;
    let ids: Vec<i64> = st.query_map([item_id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    ids.into_iter().map(|id| summary(conn, id)).collect()
}

/// What the Library and the Show page show in their Practice column: the latest attempt.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Practice {
    pub attempt_id: i64,
    pub position: i64,
    /// Sentences answered (typed or known).
    pub done: i64,
    pub sentences: i64,
    pub transcript_done: bool,
    pub finished: bool,
    pub accuracy: Option<f64>,
}

pub fn practice(conn: &Connection, item_id: i64) -> Result<Option<Practice>> {
    let id: Option<i64> = conn
        .query_row("SELECT id FROM attempts WHERE item_id = ?1 ORDER BY started_at DESC, id DESC LIMIT 1", [item_id], |r| r.get(0))
        .optional()?;
    let Some(id) = id else { return Ok(None) };
    let s = summary(conn, id)?;
    Ok(Some(Practice {
        attempt_id: id,
        position: s.attempt.position,
        done: s.done,
        sentences: s.sentences,
        transcript_done: s.transcript_done,
        finished: s.attempt.finished_at.is_some(),
        accuracy: s.accuracy,
    }))
}

/// An unfinished episode, for the sidebar's *In progress* and Today's Continue.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InProgress {
    pub item_id: i64,
    pub attempt_id: i64,
    pub title: String,
    pub source: String,
    pub artwork_url: Option<String>,
    pub position: i64,
    pub done: i64,
    pub sentences: i64,
    pub transcript_done: bool,
    pub updated_at: i64,
}

pub fn in_progress(conn: &Connection) -> Result<Vec<InProgress>> {
    let mut st = conn.prepare(
        "SELECT i.id, a.id, i.title, i.source, COALESCE(e.artwork_url, s.artwork_url), a.position,
                (SELECT count(*) FROM answers x WHERE x.attempt_id = a.id AND x.kind != 'ad'),
                (SELECT count(*) FROM sentences x WHERE x.item_id = i.id),
                COALESCE(t.state = 'done', 0), a.updated_at
         FROM attempts a JOIN items i ON i.id = a.item_id
         LEFT JOIN episodes e ON e.id = i.episode_id LEFT JOIN shows s ON s.id = e.show_id
         LEFT JOIN transcripts t ON t.item_id = i.id
         WHERE a.finished_at IS NULL
         ORDER BY a.updated_at DESC, a.id DESC",
    )?;
    let rows = st
        .query_map([], |r| {
            Ok(InProgress {
                item_id: r.get(0)?,
                attempt_id: r.get(1)?,
                title: r.get(2)?,
                source: r.get(3)?,
                artwork_url: r.get(4)?,
                position: r.get(5)?,
                done: r.get(6)?,
                sentences: r.get(7)?,
                transcript_done: r.get(8)?,
                updated_at: r.get(9)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
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
            c.execute("INSERT INTO transcripts (item_id, model, state, started_at) VALUES (1, 'base.en', 'done', 0)", []).unwrap();
            for (i, t) in ["Hello there.", "This is an ad for socks.", "Buy them now.", "Back to the show."].iter().enumerate() {
                c.execute(
                    "INSERT INTO sentences (item_id, idx, start_ms, end_ms, text, words) VALUES (1, ?1, ?2, ?3, ?4, '[]')",
                    params![i as i64, i as i64 * 1000, i as i64 * 1000 + 900, t],
                )
                .unwrap();
            }
        }
        db
    }

    #[test]
    fn an_attempt_saves_answers_and_resumes_where_it_stopped() {
        let db = setup();
        let c = db.conn();
        let a = start(&c, 1, false).unwrap();
        let ans = answer(&c, a.id, 0, Kind::Typed, "hello their", 2, 30).unwrap();
        assert_eq!((ans.credit, ans.total), (1.0, 2));
        // Opening again carries on the same attempt, at the next sentence.
        let again = start(&c, 1, false).unwrap();
        assert_eq!((again.id, again.position, again.seconds), (a.id, 1, 30));
        assert_eq!(in_progress(&c).unwrap().len(), 1);

        mark_ads(&c, a.id, 1, 3, 5).unwrap();
        answer(&c, a.id, 3, Kind::Known, "", 1, 1000).unwrap();
        let s = summary(&c, a.id).unwrap();
        assert_eq!((s.done, s.known, s.with_mistakes, s.ads), (2, 1, 1, 2));
        assert_eq!((s.credit, s.total), (5.0, 6), "ads are left out of the score");
        assert_eq!(s.attempt.seconds, 30 + 5 + MAX_SECONDS_PER_SENTENCE, "time away isn't counted");
        assert_eq!(s.attempt.position, 4);

        finish(&c, a.id).unwrap();
        assert!(in_progress(&c).unwrap().is_empty());
        let p = practice(&c, 1).unwrap().unwrap();
        assert!(p.finished && p.transcript_done && p.sentences == 4);
        // Practising again is a new attempt.
        assert_ne!(start(&c, 1, false).unwrap().id, a.id);
        assert_eq!(summaries(&c, 1).unwrap().len(), 2);
    }

    #[test]
    fn answering_a_sentence_again_replaces_the_answer() {
        let db = setup();
        let c = db.conn();
        let a = start(&c, 1, false).unwrap();
        answer(&c, a.id, 0, Kind::Typed, "hello", 1, 0).unwrap();
        let second = answer(&c, a.id, 0, Kind::Typed, "Hello there", 3, 0).unwrap();
        assert_eq!(second.credit, 2.0);
        let all = answers(&c, a.id).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].comparison.as_ref().unwrap().credit, 2.0);
    }

    #[test]
    fn sentences_are_flagged_for_the_review_answered_or_not() {
        let db = setup();
        let c = db.conn();
        let a = start(&c, 1, false).unwrap();
        flag(&c, a.id, 2, true).unwrap();
        flag(&c, a.id, 2, true).unwrap();
        answer(&c, a.id, 0, Kind::Known, "", 1, 0).unwrap();
        flag(&c, a.id, 0, true).unwrap();
        assert_eq!(flagged(&c, a.id).unwrap(), vec![0, 2]);
        assert_eq!(summary(&c, a.id).unwrap().flagged, 2);
        flag(&c, a.id, 2, false).unwrap();
        assert_eq!(flagged(&c, a.id).unwrap(), vec![0]);
    }

    #[test]
    fn a_sentence_not_transcribed_yet_cant_be_answered() {
        let db = setup();
        let c = db.conn();
        let a = start(&c, 1, false).unwrap();
        assert!(answer(&c, a.id, 9, Kind::Typed, "x", 1, 0).is_err());
    }

    #[test]
    fn starting_again_closes_the_open_attempt() {
        let db = setup();
        let c = db.conn();
        let a = start(&c, 1, false).unwrap();
        assert_eq!(start(&c, 1, true).unwrap().id, a.id, "an attempt with nothing done is reused");
        answer(&c, a.id, 0, Kind::Known, "", 0, 0).unwrap();
        let b = start(&c, 1, true).unwrap();
        assert_ne!(a.id, b.id);
        assert!(attempt(&c, a.id).unwrap().finished_at.is_some());
        assert_eq!(open_attempt(&c, 1).unwrap().unwrap().id, b.id);
    }
}
