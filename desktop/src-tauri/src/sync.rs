//! Sync with the account (DESIGN.md section 7, API.md "Sync", design D20).
//!
//! What this computer has is turned into records (`build`): saved words, word reviews, missed sentences, practice
//! summaries and practice days. `sync_sent` remembers what each record looked like when it was last sent or
//! received, so a sync sends only the records that changed since, and a deletion for each one that is gone. The
//! answer brings the other devices' changes: words and reviews go into My words (`apply`), the rest (the phone's
//! listening, other computers' days) is kept in `synced`. The latest change wins, by when it was made.
//!
//! It runs by itself: when the app opens, a few seconds after words or practice change, and every ten minutes.

use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
    time::Duration,
};

use anyhow::{anyhow, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::Notify;

use crate::{account, db::Db};

const CURSOR: &str = "sync.cursor";
const ACCOUNT: &str = "sync.account";
const DEVICE: &str = "sync.device";
const LAST: &str = "sync.last";
/// Changes per request; the server takes at most 500.
const CHUNK: usize = 400;
/// Kinds this computer makes. Anything else that arrives is kept in `synced`.
const MINE: [&str; 5] = ["word", "review", "missed", "practice", "day"];

#[derive(Debug, Clone, PartialEq)]
pub struct Record {
    pub kind: &'static str,
    pub key: String,
    pub data: Value,
    /// When it last changed on this computer (unix ms), if that is known; otherwise the time of the sync.
    pub changed_at: Option<i64>,
}

fn hash(data: &Value) -> String {
    hex::encode(Sha256::digest(data.to_string().as_bytes()))
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

// ---------------------------------------------------------------- what this computer has

/// Everything this computer has made, as records.
pub fn build(conn: &Connection, device: &str) -> Result<Vec<Record>> {
    let mut out = words(conn)?;
    out.extend(reviews(conn)?);
    out.extend(missed(conn)?);
    out.extend(practice(conn)?);
    out.extend(days(conn, device)?);
    Ok(out)
}

pub fn word_key(text: &str) -> String {
    text.trim().to_lowercase()
}

fn words(conn: &Connection) -> Result<Vec<Record>> {
    let mut st = conn.prepare(
        "SELECT w.id, w.text, w.headword, w.ipa, w.meaning, w.note, w.explanation, w.card, w.due_at, w.level, w.added_at,
                MAX(w.updated_at, COALESCE((SELECT MAX(at) FROM word_reviews WHERE word_id = w.id), 0),
                    COALESCE((SELECT MAX(practised_at) FROM word_contexts WHERE word_id = w.id), 0))
         FROM saved_words w ORDER BY w.id",
    )?;
    let rows = st
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                json!({
                    "text": r.get::<_, String>(1)?,
                    "headword": r.get::<_, String>(2)?,
                    "ipa": r.get::<_, String>(3)?,
                    "meaning": r.get::<_, String>(4)?,
                    "note": r.get::<_, String>(5)?,
                    "explanation": r.get::<_, String>(6)?,
                    "card": r.get::<_, Option<String>>(7)?,
                    "dueAt": r.get::<_, Option<i64>>(8)?,
                    "level": r.get::<_, String>(9)?,
                    "addedAt": r.get::<_, i64>(10)?,
                }),
                r.get::<_, i64>(11)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut ctx = conn.prepare(
        "SELECT COALESCE(e.audio_url, c.audio_url), COALESCE(i.title, c.title), COALESCE(i.source, c.source), c.idx, c.sentence,
                c.typed, c.start_ms, c.end_ms, c.sentence_start_ms, c.sentence_end_ms, c.added_at, c.practised_at
         FROM word_contexts c LEFT JOIN items i ON i.id = c.item_id LEFT JOIN episodes e ON e.id = i.episode_id
         WHERE c.word_id = ?1 ORDER BY c.added_at, c.idx, c.sentence",
    )?;
    let mut out = Vec::with_capacity(rows.len());
    for (id, mut data, changed) in rows {
        let contexts = ctx
            .query_map([id], |r| {
                Ok(json!({
                    "audioUrl": r.get::<_, Option<String>>(0)?,
                    "title": r.get::<_, Option<String>>(1)?,
                    "source": r.get::<_, Option<String>>(2)?,
                    "idx": r.get::<_, i64>(3)?,
                    "sentence": r.get::<_, String>(4)?,
                    "typed": r.get::<_, String>(5)?,
                    "startMs": r.get::<_, i64>(6)?,
                    "endMs": r.get::<_, i64>(7)?,
                    "sentenceStartMs": r.get::<_, i64>(8)?,
                    "sentenceEndMs": r.get::<_, i64>(9)?,
                    "addedAt": r.get::<_, i64>(10)?,
                    "practisedAt": r.get::<_, Option<i64>>(11)?,
                }))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        data["contexts"] = Value::Array(contexts);
        let key = word_key(data["text"].as_str().unwrap_or(""));
        out.push(Record { kind: "word", key, data, changed_at: Some(changed * 1000) });
    }
    Ok(out)
}

fn reviews(conn: &Connection) -> Result<Vec<Record>> {
    let mut st = conn.prepare(
        "SELECT w.text, r.at, r.mode, r.grade, r.correct, r.typed, r.seconds FROM word_reviews r JOIN saved_words w ON w.id = r.word_id
         ORDER BY r.at, w.id",
    )?;
    let rows = st.query_map([], |r| {
        let text: String = r.get(0)?;
        let at: i64 = r.get(1)?;
        let mode: String = r.get(2)?;
        Ok(Record {
            kind: "review",
            key: format!("{}|{at}|{mode}", word_key(&text)),
            data: json!({
                "word": text, "at": at, "mode": mode, "grade": r.get::<_, i64>(3)?,
                "correct": r.get::<_, Option<bool>>(4)?, "typed": r.get::<_, String>(5)?, "seconds": r.get::<_, i64>(6)?,
            }),
            changed_at: Some(at * 1000),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The episode a podcast item came from: what the phone needs to find and play it.
const EPISODE: &str = "e.audio_url, s.feed_url, e.guid, e.title, s.title, COALESCE(e.artwork_url, s.artwork_url), e.audio_bytes";

fn episode_json(r: &rusqlite::Row, from: usize) -> rusqlite::Result<Value> {
    Ok(json!({
        "audioUrl": r.get::<_, String>(from)?,
        "feedUrl": r.get::<_, String>(from + 1)?,
        "guid": r.get::<_, String>(from + 2)?,
        "episode": r.get::<_, String>(from + 3)?,
        "show": r.get::<_, String>(from + 4)?,
        "artworkUrl": r.get::<_, Option<String>>(from + 5)?,
        "bytes": r.get::<_, Option<i64>>(from + 6)?,
    }))
}

/// The sentences missed in the latest attempt at each podcast episode: wrong words, or flagged. They become the
/// phone's listening playlist. The learner's own files are left out: the phone can't play them.
fn missed(conn: &Connection) -> Result<Vec<Record>> {
    let mut st = conn.prepare(&format!(
        "SELECT {EPISODE}, n.idx, s2.start_ms, s2.end_ms, n.original, n.typed, n.answered_at,
                EXISTS (SELECT 1 FROM flagged f WHERE f.attempt_id = a.id AND f.idx = n.idx)
         FROM attempts a
         JOIN items i ON i.id = a.item_id JOIN episodes e ON e.id = i.episode_id JOIN shows s ON s.id = e.show_id
         JOIN answers n ON n.attempt_id = a.id
         JOIN sentences s2 ON s2.item_id = a.item_id AND s2.idx = n.idx
         WHERE a.id = (SELECT id FROM attempts WHERE item_id = a.item_id ORDER BY started_at DESC, id DESC LIMIT 1)
           AND ((n.kind = 'typed' AND n.credit < n.total)
                OR EXISTS (SELECT 1 FROM flagged f WHERE f.attempt_id = a.id AND f.idx = n.idx))
         ORDER BY a.id, n.idx"
    ))?;
    let rows = st.query_map([], |r| {
        let mut data = episode_json(r, 0)?;
        let idx: i64 = r.get(7)?;
        let at: i64 = r.get(12)?;
        for (k, v) in [
            ("idx", json!(idx)),
            ("startMs", json!(r.get::<_, i64>(8)?)),
            ("endMs", json!(r.get::<_, i64>(9)?)),
            ("text", json!(r.get::<_, String>(10)?)),
            ("typed", json!(r.get::<_, String>(11)?)),
            ("at", json!(at)),
            ("flagged", json!(r.get::<_, bool>(13)?)),
        ] {
            data[k] = v;
        }
        let key = format!("{}|{idx}", data["audioUrl"].as_str().unwrap_or(""));
        Ok(Record { kind: "missed", key, data, changed_at: Some(at * 1000) })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// One record per dictation attempt at a podcast episode: when, how long, how much, how well.
fn practice(conn: &Connection) -> Result<Vec<Record>> {
    let mut st = conn.prepare(&format!(
        "SELECT {EPISODE}, a.started_at, a.updated_at, a.finished_at, a.seconds,
                (SELECT COUNT(*) FROM answers WHERE attempt_id = a.id AND kind != 'ad'),
                (SELECT COUNT(*) FROM sentences WHERE item_id = a.item_id),
                (SELECT COALESCE(SUM(credit), 0) FROM answers WHERE attempt_id = a.id AND kind != 'ad'),
                (SELECT COALESCE(SUM(total), 0) FROM answers WHERE attempt_id = a.id AND kind != 'ad')
         FROM attempts a
         JOIN items i ON i.id = a.item_id JOIN episodes e ON e.id = i.episode_id JOIN shows s ON s.id = e.show_id
         ORDER BY a.id"
    ))?;
    let rows = st.query_map([], |r| {
        let mut data = episode_json(r, 0)?;
        let started: i64 = r.get(7)?;
        let updated: i64 = r.get(8)?;
        let (credit, total): (f64, i64) = (r.get(13)?, r.get(14)?);
        for (k, v) in [
            ("startedAt", json!(started)),
            ("updatedAt", json!(updated)),
            ("finishedAt", json!(r.get::<_, Option<i64>>(9)?)),
            ("seconds", json!(r.get::<_, i64>(10)?)),
            ("answered", json!(r.get::<_, i64>(11)?)),
            ("sentences", json!(r.get::<_, i64>(12)?)),
            // Correct words out of all, in thousandths: whole numbers hash the same everywhere.
            ("accuracy", json!(if total > 0 { (credit * 1000.0 / total as f64).round() as i64 } else { 0 })),
        ] {
            data[k] = v;
        }
        let key = format!("{}|{started}", data["audioUrl"].as_str().unwrap_or(""));
        Ok(Record { kind: "practice", key, data, changed_at: Some(updated * 1000) })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// This computer's practice time per day and kind. Each device sends its own, and the totals add up.
fn days(conn: &Connection, device: &str) -> Result<Vec<Record>> {
    let mut st = conn.prepare("SELECT day, kind, seconds FROM practice_days ORDER BY day, kind")?;
    let rows = st.query_map([], |r| {
        let (day, kind): (String, String) = (r.get(0)?, r.get(1)?);
        Ok(Record {
            kind: "day",
            key: format!("{day}|{kind}|{device}"),
            data: json!({ "day": day, "kind": kind, "seconds": r.get::<_, i64>(2)?, "device": device }),
            changed_at: None,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

// ---------------------------------------------------------------- what to send

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub kind: String,
    pub key: String,
    pub changed_at: i64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub deleted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// The records that changed since they were last sent or received, and deletions for the ones that are gone.
/// Also the hash of each, to remember once the server has them.
pub fn changes(conn: &Connection, records: &[Record]) -> Result<Vec<(Change, Option<String>)>> {
    let mut sent: HashMap<(String, String), String> = HashMap::new();
    {
        let mut st = conn.prepare("SELECT kind, key, hash FROM sync_sent")?;
        for row in st.query_map([], |r| Ok(((r.get(0)?, r.get(1)?), r.get(2)?)))? {
            let (k, h) = row?;
            sent.insert(k, h);
        }
    }
    let now = now_ms();
    let mut out = Vec::new();
    let mut here = HashSet::new();
    for r in records {
        let h = hash(&r.data);
        let id = (r.kind.to_string(), r.key.clone());
        if sent.get(&id) != Some(&h) {
            out.push((
                Change { kind: id.0.clone(), key: id.1.clone(), changed_at: r.changed_at.unwrap_or(now), deleted: false, data: Some(r.data.clone()) },
                Some(h),
            ));
        }
        here.insert(id);
    }
    let mut gone: Vec<_> = sent.into_keys().filter(|id| !here.contains(id)).collect();
    gone.sort();
    for (kind, key) in gone {
        out.push((Change { kind, key, changed_at: now, deleted: true, data: None }, None));
    }
    Ok(out)
}

/// Remembers a record as the server has it: `None` once it's deleted there.
fn remember(conn: &Connection, kind: &str, key: &str, hash: Option<&str>) -> Result<()> {
    match hash {
        Some(h) => conn.execute(
            "INSERT INTO sync_sent (kind, key, hash) VALUES (?1, ?2, ?3) ON CONFLICT (kind, key) DO UPDATE SET hash = excluded.hash",
            params![kind, key, h],
        )?,
        None => conn.execute("DELETE FROM sync_sent WHERE kind = ?1 AND key = ?2", params![kind, key])?,
    };
    Ok(())
}

// ---------------------------------------------------------------- what other devices sent

/// Applies the other devices' changes: words first, so their reviews find them.
pub fn apply(conn: &Connection, device: &str, incoming: &[Change]) -> Result<()> {
    let mine: HashSet<(String, String)> = {
        let mut st = conn.prepare("SELECT kind, key FROM sync_sent")?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    let order = |c: &Change| match c.kind.as_str() {
        "word" => 0,
        "review" => 1,
        _ => 2,
    };
    let mut sorted: Vec<&Change> = incoming.iter().collect();
    sorted.sort_by_key(|c| order(c));
    for c in sorted {
        let empty = Value::Null;
        let d = c.data.as_ref().unwrap_or(&empty);
        match c.kind.as_str() {
            "word" if c.deleted => {
                conn.execute("DELETE FROM saved_words WHERE text = ?1 COLLATE NOCASE", [&c.key])?;
            }
            "word" => apply_word(conn, d, c.changed_at)?,
            "review" => {
                let (Some(word), Some(at), Some(mode)) = (d["word"].as_str(), d["at"].as_i64(), d["mode"].as_str()) else {
                    if c.deleted {
                        delete_review(conn, &c.key)?;
                    }
                    continue;
                };
                let id: Option<i64> = conn.query_row("SELECT id FROM saved_words WHERE text = ?1 COLLATE NOCASE", [word], |r| r.get(0)).optional()?;
                let Some(id) = id else { continue };
                conn.execute(
                    "INSERT INTO word_reviews (word_id, at, mode, grade, correct, typed, seconds)
                     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE NOT EXISTS (SELECT 1 FROM word_reviews WHERE word_id = ?1 AND at = ?2 AND mode = ?3)",
                    params![id, at, mode, d["grade"].as_i64().unwrap_or(3), d["correct"].as_bool(), d["typed"].as_str().unwrap_or(""), d["seconds"].as_i64().unwrap_or(0)],
                )?;
            }
            kind => {
                // This computer's own records come back only after the server lost its data: this copy wins.
                let own = d["device"].as_str() == Some(device) || (MINE.contains(&kind) && mine.contains(&(c.kind.clone(), c.key.clone())));
                if c.deleted {
                    conn.execute("DELETE FROM synced WHERE kind = ?1 AND key = ?2", params![kind, c.key])?;
                } else if !own {
                    conn.execute(
                        "INSERT INTO synced (kind, key, data, changed_at) VALUES (?1, ?2, ?3, ?4)
                         ON CONFLICT (kind, key) DO UPDATE SET data = excluded.data, changed_at = excluded.changed_at",
                        params![kind, c.key, d.to_string(), c.changed_at],
                    )?;
                }
            }
        }
    }
    Ok(())
}

fn delete_review(conn: &Connection, key: &str) -> Result<()> {
    let mut parts = key.rsplitn(3, '|');
    let (Some(mode), Some(at), Some(word)) = (parts.next(), parts.next().and_then(|a| a.parse::<i64>().ok()), parts.next()) else {
        return Ok(());
    };
    conn.execute(
        "DELETE FROM word_reviews WHERE at = ?2 AND mode = ?3 AND word_id = (SELECT id FROM saved_words WHERE text = ?1 COLLATE NOCASE)",
        params![word, at, mode],
    )?;
    Ok(())
}

/// A word as another device has it: its fields replace this computer's, and its sentences are added to the ones
/// here. Sentences from an episode in the Library point at it, so they play.
fn apply_word(conn: &Connection, d: &Value, changed_at: i64) -> Result<()> {
    let s = |k: &str| d[k].as_str().unwrap_or("").to_string();
    let text = s("text");
    if text.trim().is_empty() {
        return Ok(());
    }
    let added = d["addedAt"].as_i64().unwrap_or(changed_at / 1000);
    conn.execute(
        "INSERT INTO saved_words (text, headword, ipa, meaning, note, explanation, card, due_at, level, added_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT (text) DO UPDATE SET text = excluded.text, headword = excluded.headword, ipa = excluded.ipa,
           meaning = excluded.meaning, note = excluded.note, explanation = excluded.explanation, card = excluded.card,
           due_at = excluded.due_at, level = excluded.level, added_at = excluded.added_at, updated_at = excluded.updated_at",
        params![
            text,
            s("headword"),
            s("ipa"),
            s("meaning"),
            s("note"),
            s("explanation"),
            d["card"].as_str(),
            d["dueAt"].as_i64(),
            d["level"].as_str().unwrap_or("new"),
            added,
            changed_at / 1000,
        ],
    )?;
    let id: i64 = conn.query_row("SELECT id FROM saved_words WHERE text = ?1 COLLATE NOCASE", [&text], |r| r.get(0))?;
    for c in d["contexts"].as_array().into_iter().flatten() {
        let sentence = c["sentence"].as_str().unwrap_or("");
        let idx = c["idx"].as_i64().unwrap_or(0);
        let audio = c["audioUrl"].as_str();
        let practised = c["practisedAt"].as_i64();
        let item: Option<i64> = match audio {
            Some(url) => conn
                .query_row("SELECT i.id FROM items i JOIN episodes e ON e.id = i.episode_id WHERE e.audio_url = ?1", [url], |r| r.get(0))
                .optional()?,
            None => None,
        };
        let here: Option<(i64, Option<i64>)> = conn
            .query_row(
                "SELECT rowid, practised_at FROM word_contexts WHERE word_id = ?1 AND idx = ?2 AND sentence = ?3",
                params![id, idx, sentence],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        match here {
            Some((rowid, was)) => {
                if practised.unwrap_or(0) > was.unwrap_or(0) {
                    conn.execute("UPDATE word_contexts SET practised_at = ?2 WHERE rowid = ?1", params![rowid, practised])?;
                }
            }
            None => {
                conn.execute(
                    "INSERT OR IGNORE INTO word_contexts (word_id, item_id, idx, sentence, typed, start_ms, end_ms, sentence_start_ms,
                       sentence_end_ms, added_at, practised_at, audio_url, title, source)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                    params![
                        id,
                        item,
                        idx,
                        sentence,
                        c["typed"].as_str().unwrap_or(""),
                        c["startMs"].as_i64().unwrap_or(0),
                        c["endMs"].as_i64().unwrap_or(0),
                        c["sentenceStartMs"].as_i64().unwrap_or(0),
                        c["sentenceEndMs"].as_i64().unwrap_or(0),
                        c["addedAt"].as_i64().unwrap_or(added),
                        practised,
                        audio,
                        c["title"].as_str(),
                        c["source"].as_str(),
                    ],
                )?;
            }
        }
    }
    Ok(())
}

/// Starts over with another account (or after the server lost its data): everything is sent again.
fn forget(conn: &Connection, other_account: bool) -> Result<()> {
    conn.execute("DELETE FROM sync_sent", [])?;
    if other_account {
        conn.execute("DELETE FROM synced", [])?;
    }
    conn.execute("DELETE FROM settings WHERE key IN (?1, ?2)", params![CURSOR, LAST])?;
    Ok(())
}

// ---------------------------------------------------------------- talking to the server

#[derive(Deserialize)]
struct Answer {
    cursor: i64,
    changes: Vec<Change>,
    more: bool,
    #[serde(default)]
    reset: bool,
}

async fn post(token: &str, since: i64, changes: &[Change]) -> Result<Answer, Problem> {
    let r = crate::podcasts::HTTP
        .post(format!("{}/v1/sync", *account::API))
        .bearer_auth(token)
        .json(&json!({ "since": since, "changes": changes }))
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|_| Problem::Offline)?;
    match r.status().as_u16() {
        200 => r.json().await.map_err(|_| Problem::Failed("The server's answer couldn't be read.".into())),
        401 => Err(Problem::SignedOut),
        413 => Err(Problem::Failed("This account has reached the sync limit.".into())),
        s => Err(Problem::Failed(format!("The server answered {s}."))),
    }
}

#[derive(Debug, PartialEq)]
enum Problem {
    Offline,
    SignedOut,
    Failed(String),
}

fn device(db: &Db) -> Result<String> {
    if let Some(d) = db.get_setting(DEVICE)?.filter(|d| !d.is_empty()) {
        return Ok(d);
    }
    let d = format!("desktop-{}", &account::random(9));
    db.set_setting(DEVICE, &d)?;
    Ok(d)
}

/// One sync: send what changed, take in what the other devices changed. Returns how many changes came in.
async fn run(db: &Db, token: &str, account_id: i64) -> Result<usize, Problem> {
    let fail = |e: anyhow::Error| Problem::Failed(format!("{e:#}"));
    let device = device(db).map_err(fail)?;
    {
        let c = db.conn();
        let was: Option<String> = c.query_row("SELECT value FROM settings WHERE key = ?1", [ACCOUNT], |r| r.get(0)).optional().map_err(|e| fail(e.into()))?;
        if was.as_deref() != Some(&account_id.to_string()) {
            forget(&c, true).map_err(fail)?;
            drop(c);
            db.set_setting(ACCOUNT, &account_id.to_string()).map_err(fail)?;
        }
    }
    let mut received = 0;
    for _round in 0..2 {
        let (outgoing, mut since) = {
            let c = db.conn();
            let records = build(&c, &device).map_err(fail)?;
            let since: i64 = c
                .query_row("SELECT value FROM settings WHERE key = ?1", [CURSOR], |r| r.get::<_, String>(0))
                .optional()
                .map_err(|e| fail(e.into()))?
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            (changes(&c, &records).map_err(fail)?, since)
        };
        let mut incoming: Vec<Change> = Vec::new();
        let mut reset = false;
        let mut chunks = outgoing.chunks(CHUNK).peekable();
        loop {
            let chunk = chunks.next().unwrap_or(&[]);
            let send: Vec<Change> = chunk.iter().map(|(c, _)| c.clone()).collect();
            let answer = post(token, since, &send).await?;
            reset |= answer.reset;
            since = answer.cursor;
            let came: HashSet<(String, String)> = answer.changes.iter().map(|c| (c.kind.clone(), c.key.clone())).collect();
            {
                let c = db.conn();
                // What the server took is remembered as sent; what it refused comes back newer, below.
                for (change, h) in chunk {
                    if !came.contains(&(change.kind.clone(), change.key.clone())) {
                        remember(&c, &change.kind, &change.key, h.as_deref()).map_err(fail)?;
                    }
                }
            }
            incoming.extend(answer.changes);
            if chunks.peek().is_none() && !answer.more {
                break;
            }
        }
        {
            let mut c = db.conn();
            let tx = c.transaction().map_err(|e| fail(e.into()))?;
            apply(&tx, &device, &incoming).map_err(fail)?;
            // Words and reviews are now here as they came, so they aren't sent back. The rest is kept apart, not sent.
            for ch in &incoming {
                if ch.kind == "word" || ch.kind == "review" {
                    let h = ch.data.as_ref().filter(|_| !ch.deleted).map(hash);
                    remember(&tx, &ch.kind, &ch.key, h.as_deref()).map_err(fail)?;
                }
            }
            if reset {
                forget(&tx, false).map_err(fail)?;
            }
            tx.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                params![CURSOR, since.to_string()],
            )
            .map_err(|e| fail(e.into()))?;
            tx.commit().map_err(|e| fail(e.into()))?;
        }
        received += incoming.len();
        if !reset {
            break;
        }
    }
    db.set_setting(LAST, &now_ms().to_string()).map_err(fail)?;
    Ok(received)
}

// ---------------------------------------------------------------- running by itself

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// "off" (not signed in), "syncing", "synced" or "failed".
    pub state: &'static str,
    /// The last sync that worked, unix ms.
    pub last: Option<i64>,
    pub error: Option<String>,
    /// Never synced with this account yet: everything here is being added to it.
    pub first: bool,
    pub words: i64,
    pub days: i64,
    pub episodes: i64,
}

pub struct Syncer {
    nudge: Notify,
    status: Mutex<(&'static str, Option<String>)>,
}

impl Default for Syncer {
    fn default() -> Self {
        Syncer { nudge: Notify::new(), status: Mutex::new(("synced", None)) }
    }
}

impl Syncer {
    /// Sync soon: after a few quiet seconds, so a burst of changes goes in one request.
    pub fn soon(&self) {
        self.nudge.notify_one();
    }

    pub fn status(&self, db: &Db) -> Status {
        let (state, error) = self.status.lock().unwrap().clone();
        let signed_in = account::stored(db).is_some();
        let last = db.get_setting(LAST).ok().flatten().and_then(|v| v.parse().ok());
        let c = db.conn();
        let count = |sql: &str| c.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap_or(0);
        Status {
            state: if signed_in { state } else { "off" },
            last,
            error: error.filter(|_| state == "failed"),
            first: signed_in && last.is_none(),
            words: count("SELECT COUNT(*) FROM saved_words"),
            days: count("SELECT COUNT(DISTINCT day) FROM practice_all WHERE seconds > 0"),
            episodes: count("SELECT COUNT(DISTINCT item_id) FROM attempts"),
        }
    }

    fn set(&self, state: &'static str, error: Option<String>) {
        *self.status.lock().unwrap() = (state, error);
    }

    /// Syncs now, if signed in. `on_status` is told each change of state.
    pub async fn now(&self, db: &Db, on_status: &(dyn Fn(Status) + Send + Sync)) -> Option<usize> {
        let (Some(acc), Some(token)) = (account::stored(db), account::token()) else {
            on_status(self.status(db));
            return None;
        };
        self.set("syncing", None);
        on_status(self.status(db));
        let result = run(db, &token, acc.id).await;
        let received = match result {
            Ok(n) => {
                self.set("synced", None);
                Some(n)
            }
            Err(Problem::SignedOut) => {
                // The session ended elsewhere: the account check signs this computer out.
                let _ = account::refresh(db).await;
                self.set("synced", None);
                None
            }
            Err(Problem::Offline) => {
                self.set("failed", Some("Couldn't reach Eksigo. Your changes are kept here and sync when the connection is back.".into()));
                None
            }
            Err(Problem::Failed(e)) => {
                self.set("failed", Some(e));
                None
            }
        };
        on_status(self.status(db));
        received
    }

    /// The loop that syncs by itself: at once, then a few seconds after each nudge, and every ten minutes.
    pub async fn run_forever(&self, db: &Db, on_status: &(dyn Fn(Status) + Send + Sync), on_received: &(dyn Fn() + Send + Sync)) {
        loop {
            if self.now(db, on_status).await.is_some_and(|n| n > 0) {
                on_received();
            }
            let _ = tokio::time::timeout(Duration::from_secs(600), self.nudge.notified()).await;
            // Let a burst of changes settle.
            loop {
                if tokio::time::timeout(Duration::from_secs(4), self.nudge.notified()).await.is_err() {
                    break;
                }
            }
        }
    }
}

/// The phone's listening, newest first, for Today (design D20): episodes heard in the last three days.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Heard {
    pub audio_url: String,
    pub feed_url: Option<String>,
    pub guid: Option<String>,
    pub title: String,
    pub show: String,
    pub artwork_url: Option<String>,
    pub duration_s: Option<f64>,
    pub position_s: Option<f64>,
    pub finished: bool,
    pub listened_at: i64,
    /// Dictated here since: shown as Practised.
    pub practised: bool,
}

pub fn heard(conn: &Connection, since: i64) -> Result<Vec<Heard>> {
    let mut st = conn.prepare(
        "SELECT data FROM synced WHERE kind = 'listen' ORDER BY json_extract(data, '$.listenedAt') DESC LIMIT 40",
    )?;
    let rows = st.query_map([], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    let mut out = Vec::new();
    for raw in rows {
        let Ok(d) = serde_json::from_str::<Value>(&raw) else { continue };
        let (Some(audio), Some(at)) = (d["audioUrl"].as_str(), d["listenedAt"].as_i64()) else { continue };
        if at < since {
            continue;
        }
        let practised: bool = conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM attempts a JOIN items i ON i.id = a.item_id JOIN episodes e ON e.id = i.episode_id
             WHERE e.audio_url = ?1 AND a.updated_at * 1000 >= ?2)",
            params![audio, at],
            |r| r.get(0),
        )?;
        let s = |k: &str| d[k].as_str().map(str::to_string);
        out.push(Heard {
            audio_url: audio.into(),
            feed_url: s("feedUrl"),
            guid: s("guid"),
            title: s("episode").unwrap_or_default(),
            show: s("show").unwrap_or_default(),
            artwork_url: s("artworkUrl"),
            duration_s: d["durationS"].as_f64(),
            position_s: d["positionS"].as_f64(),
            finished: d["finished"].as_bool().unwrap_or(false),
            listened_at: at,
            practised,
        });
        if out.len() == 5 {
            break;
        }
    }
    Ok(out)
}

/// The Library's episode for something heard on the phone: found by its audio address, or read from its feed.
pub fn episode_for(conn: &Connection, audio_url: &str, guid: Option<&str>) -> Result<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT id FROM episodes WHERE audio_url = ?1 OR (?2 IS NOT NULL AND guid = ?2) ORDER BY audio_url = ?1 DESC LIMIT 1",
            params![audio_url, guid],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn not_found() -> anyhow::Error {
    anyhow!("This episode isn't in its show's feed any more.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn seed(c: &Connection) {
        c.execute_batch(
            "INSERT INTO shows (id, feed_url, title, artwork_url) VALUES (1, 'https://f/feed', 'Slow Stories', 'https://f/art.jpg');
             INSERT INTO episodes (id, show_id, guid, title, audio_url, audio_bytes) VALUES (1, 1, 'g1', 'A market at dawn', 'https://f/1.mp3', 1000);
             INSERT INTO items (id, episode_id, title, source, state, added_at) VALUES (1, 1, 'A market at dawn', 'Slow Stories', 'ready', 0);
             INSERT INTO sentences (item_id, idx, start_ms, end_ms, text, words) VALUES (1, 0, 0, 2000, 'It opens at dawn.', '[]'),
                (1, 1, 2000, 5000, 'People follow through.', '[]');
             INSERT INTO attempts (id, item_id, started_at, updated_at, seconds) VALUES (1, 1, 100, 200, 60);
             INSERT INTO answers (attempt_id, idx, kind, original, typed, credit, total, answered_at)
                VALUES (1, 0, 'typed', 'It opens at dawn.', 'It opens at dawn.', 4, 4, 150),
                       (1, 1, 'typed', 'People follow through.', 'People fall through.', 2, 3, 200);
             INSERT INTO saved_words (id, text, meaning, added_at, updated_at) VALUES (1, 'follow through', '贯彻到底', 10, 20);
             INSERT INTO word_contexts (word_id, item_id, idx, sentence, start_ms, end_ms, added_at) VALUES (1, 1, 1, 'People follow through.', 2500, 4000, 20);
             INSERT INTO word_reviews (word_id, at, mode, grade) VALUES (1, 300, 'recall', 3);
             INSERT INTO practice_days (day, kind, seconds) VALUES ('2026-11-12', 'dictation', 60);",
        )
        .unwrap();
    }

    fn sent_all(c: &Connection, records: &[Record]) {
        for (ch, h) in changes(c, records).unwrap() {
            remember(c, &ch.kind, &ch.key, h.as_deref()).unwrap();
        }
    }

    #[test]
    fn builds_a_record_of_each_kind() {
        let db = Db::open_in_memory().unwrap();
        let c = db.conn();
        seed(&c);
        let r = build(&c, "desktop-a").unwrap();
        let kinds: Vec<_> = r.iter().map(|r| (r.kind, r.key.as_str())).collect();
        assert_eq!(
            kinds,
            [
                ("word", "follow through"),
                ("review", "follow through|300|recall"),
                ("missed", "https://f/1.mp3|1"),
                ("practice", "https://f/1.mp3|100"),
                ("day", "2026-11-12|dictation|desktop-a"),
            ]
        );
        let word = &r[0];
        assert_eq!(word.changed_at, Some(300_000)); // the review is the latest change
        assert_eq!(word.data["contexts"][0]["audioUrl"], "https://f/1.mp3");
        assert_eq!(r[2].data["typed"], "People fall through.");
        assert_eq!(r[2].data["feedUrl"], "https://f/feed");
        assert_eq!(r[3].data["accuracy"], 857);
    }

    #[test]
    fn sends_only_what_changed_and_deletions() {
        let db = Db::open_in_memory().unwrap();
        let c = db.conn();
        seed(&c);
        let r = build(&c, "d").unwrap();
        assert_eq!(changes(&c, &r).unwrap().len(), 5);
        sent_all(&c, &r);
        assert!(changes(&c, &build(&c, "d").unwrap()).unwrap().is_empty());

        c.execute("UPDATE saved_words SET note = 'mine', updated_at = 400 WHERE id = 1", []).unwrap();
        let ch = changes(&c, &build(&c, "d").unwrap()).unwrap();
        assert_eq!(ch.len(), 1);
        assert_eq!((ch[0].0.kind.as_str(), ch[0].0.changed_at), ("word", 400_000));

        c.execute("DELETE FROM saved_words", []).unwrap();
        let ch: Vec<_> = changes(&c, &build(&c, "d").unwrap()).unwrap().into_iter().map(|(c, _)| (c.kind, c.deleted)).collect();
        assert_eq!(ch, [("review".to_string(), true), ("word".to_string(), true)]);
    }

    #[test]
    fn a_word_from_the_phone_lands_in_my_words_and_isnt_sent_back() {
        let db = Db::open_in_memory().unwrap();
        let c = db.conn();
        seed(&c);
        sent_all(&c, &build(&c, "d").unwrap());
        let word = json!({
            "text": "Gist", "headword": "gist", "ipa": "dʒɪst", "meaning": "要点", "note": "", "explanation": "", "card": null,
            "dueAt": null, "level": "new", "addedAt": 500,
            "contexts": [{"audioUrl": "https://f/1.mp3", "title": "A market at dawn", "source": "Slow Stories", "idx": 0,
                          "sentence": "It opens at dawn.", "typed": "", "startMs": 0, "endMs": 900, "sentenceStartMs": 0,
                          "sentenceEndMs": 2000, "addedAt": 500, "practisedAt": null}],
        });
        let review = json!({"word": "Gist", "at": 600, "mode": "type", "grade": 4, "correct": true, "typed": "gist", "seconds": 3});
        let incoming = vec![
            Change { kind: "review".into(), key: "gist|600|type".into(), changed_at: 600_000, deleted: false, data: Some(review.clone()) },
            Change { kind: "word".into(), key: "gist".into(), changed_at: 600_000, deleted: false, data: Some(word.clone()) },
        ];
        apply(&c, "d", &incoming).unwrap();
        for ch in &incoming {
            remember(&c, &ch.kind, &ch.key, Some(&hash(ch.data.as_ref().unwrap()))).unwrap();
        }
        // The episode is in the Library: the sentence points at it, so it plays.
        let item: Option<i64> = c.query_row("SELECT c.item_id FROM word_contexts c JOIN saved_words w ON w.id = c.word_id WHERE w.text = 'Gist'", [], |r| r.get(0)).unwrap();
        assert_eq!(item, Some(1));
        assert_eq!(c.query_row("SELECT COUNT(*) FROM word_reviews", [], |r| r.get::<_, i64>(0)).unwrap(), 2);
        // Built again, it's the same as what came: nothing to send back.
        assert!(changes(&c, &build(&c, "d").unwrap()).unwrap().is_empty());
        // And applying it twice changes nothing.
        apply(&c, "d", &incoming).unwrap();
        assert_eq!(c.query_row("SELECT COUNT(*) FROM word_contexts", [], |r| r.get::<_, i64>(0)).unwrap(), 2);
    }

    #[test]
    fn a_word_deleted_elsewhere_goes_here_too() {
        let db = Db::open_in_memory().unwrap();
        let c = db.conn();
        seed(&c);
        apply(&c, "d", &[Change { kind: "word".into(), key: "follow through".into(), changed_at: 1, deleted: true, data: None }]).unwrap();
        assert_eq!(c.query_row("SELECT COUNT(*) FROM saved_words", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }

    #[test]
    fn phone_listening_and_other_devices_days() {
        let db = Db::open_in_memory().unwrap();
        let c = db.conn();
        seed(&c);
        let listen = json!({"audioUrl": "https://f/1.mp3", "feedUrl": "https://f/feed", "guid": "g1", "episode": "A market at dawn",
                            "show": "Slow Stories", "positionS": 600.0, "durationS": 1080.0, "finished": false, "listenedAt": 1_000_000});
        let day = |device: &str| json!({"day": "2026-11-12", "kind": "listening", "seconds": 900, "device": device});
        apply(
            &c,
            "d",
            &[
                Change { kind: "listen".into(), key: "https://f/1.mp3".into(), changed_at: 1, deleted: false, data: Some(listen) },
                Change { kind: "day".into(), key: "2026-11-12|listening|iphone-1".into(), changed_at: 1, deleted: false, data: Some(day("iphone-1")) },
                // Its own day, back from a server that lost its data: not counted twice.
                Change { kind: "day".into(), key: "2026-11-12|listening|d".into(), changed_at: 1, deleted: false, data: Some(day("d")) },
            ],
        )
        .unwrap();
        let h = heard(&c, 0).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!((h[0].title.as_str(), h[0].position_s, h[0].practised), ("A market at dawn", Some(600.0), false));
        assert_eq!(heard(&c, 2_000_000).unwrap().len(), 0);
        let total: i64 = c.query_row("SELECT SUM(seconds) FROM practice_all WHERE day = '2026-11-12'", [], |r| r.get(0)).unwrap();
        assert_eq!(total, 960);
        // The phone's days aren't this computer's to send.
        assert!(build(&c, "d").unwrap().iter().all(|r| r.kind != "day" || r.key.ends_with("|d")));
    }
}
