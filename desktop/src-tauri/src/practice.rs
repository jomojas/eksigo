//! Word practice (design D10): when each saved word comes back, chosen by FSRS (the scheduler Anki uses,
//! and the iPhone app will too), and its level, which follows from that. Each practice uses one of the
//! sentences the word was saved from, a different one each time.
//!
//! The learner decides as little as possible: a wrong answer counts as Again by itself, a right one as
//! Good unless they say Hard or Easy. New words are limited to `NEW_PER_DAY`, a session to `PER_SESSION`.

use anyhow::{anyhow, Result};
use chrono::{DateTime, Local, TimeZone, Utc};
use rs_fsrs::{Card, Parameters, Rating, State, FSRS};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::words::{self, Context, SavedWord};

pub const NEW_PER_DAY: i64 = 10;
pub const PER_SESSION: usize = 20;

/// Longer than this on one word, the learner was away; the time isn't counted.
const MAX_SECONDS_PER_WORD: i64 = 120;

/// Days, not minutes: words are practised in a daily session, and a missed word comes back at the end
/// of the session it was missed in (the screen does that) as well as the next day.
fn fsrs() -> FSRS {
    FSRS::new(Parameters { enable_short_term: false, ..Default::default() })
}

fn at(unix: i64) -> DateTime<Utc> {
    Utc.timestamp_opt(unix, 0).single().unwrap_or_else(Utc::now)
}

/// New · Learning (back within 3 days) · Familiar (3 to 21) · Known (longer).
pub fn level_of(card: &Card) -> &'static str {
    match card.state {
        State::New => "new",
        State::Learning | State::Relearning => "learning",
        State::Review if card.scheduled_days < 3 => "learning",
        State::Review if card.scheduled_days < 21 => "familiar",
        State::Review => "known",
    }
}

fn card_of(conn: &Connection, word_id: i64, now: i64) -> Result<Card> {
    let json: Option<String> = conn
        .query_row("SELECT card FROM saved_words WHERE id = ?1", [word_id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| anyhow!("That word is no longer in My words."))?;
    Ok(match json {
        Some(j) => serde_json::from_str(&j)?,
        None => Card { due: at(now), last_review: at(now), ..Default::default() },
    })
}

/// Midnight today on this computer's calendar.
pub fn today_start() -> i64 {
    let midnight = Local::now().date_naive().and_hms_opt(0, 0, 0).unwrap();
    Local.from_local_datetime(&midnight).earliest().map(|d| d.timestamp()).unwrap_or(0)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    /// Practised before and due now.
    pub due: i64,
    /// New words that may still start today.
    pub new: i64,
    /// What "Practise" offers today: due plus new.
    pub total: i64,
}

/// New words practised for the first time since `since` (not counting ones marked "I know this").
fn started_since(conn: &Connection, since: i64) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM (SELECT word_id, MIN(at) AS first FROM word_reviews WHERE mode != 'known' GROUP BY word_id) WHERE first >= ?1",
        [since],
        |r| r.get(0),
    )?)
}

pub fn counts(conn: &Connection, now: i64, today: i64) -> Result<Counts> {
    let due: i64 = conn.query_row("SELECT COUNT(*) FROM saved_words WHERE level != 'new' AND due_at <= ?1", [now], |r| r.get(0))?;
    let fresh: i64 = conn.query_row("SELECT COUNT(*) FROM saved_words WHERE level = 'new'", [], |r| r.get(0))?;
    let new = fresh.min((NEW_PER_DAY - started_since(conn, today)?).max(0));
    Ok(Counts { due, new, total: due + new })
}

/// One word to practise, with the sentence it's practised in.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub word: SavedWord,
    pub context: Context,
    /// The sentence split around the word, for Listen and type; None when the word can't be found in it
    /// (then the screen uses Listen and recall for this word).
    pub gap: Option<[String; 3]>,
    /// The meaning shown after answering and in Pick the meaning: the learner's note, else the dictionary's
    /// first line.
    pub answer: String,
    /// Four meanings in a random order, one of them `answer`; empty when there aren't enough other words.
    pub choices: Vec<String>,
    /// Seconds until the word comes back for Again, Hard, Good and Easy.
    pub next: [i64; 4],
}

/// The note, else the first line of the dictionary meaning.
fn answer_of(w: &SavedWord) -> String {
    let note = w.note.trim();
    if !note.is_empty() {
        return note.to_string();
    }
    w.meaning.lines().next().unwrap_or("").trim().to_string()
}

/// A small random generator, enough for shuffling choices.
struct Shuffle(u64);
impl Shuffle {
    fn new(seed: u64) -> Self {
        Self(seed | 1)
    }
    fn below(&mut self, n: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 % n as u64) as usize
    }
    fn shuffle<T>(&mut self, v: &mut [T]) {
        for i in (1..v.len()).rev() {
            v.swap(i, self.below(i + 1));
        }
    }
}

/// Today's session: due words first, the longest overdue first, then new words in the order they were
/// saved, up to the day's limit; at most `PER_SESSION`.
pub fn queue(conn: &Connection, now: i64, today: i64, seed: u64) -> Result<Vec<Item>> {
    let c = counts(conn, now, today)?;
    let mut ids: Vec<i64> = conn
        .prepare("SELECT id FROM saved_words WHERE level != 'new' AND due_at <= ?1 ORDER BY due_at, id LIMIT ?2")?
        .query_map(params![now, PER_SESSION as i64], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let room = (PER_SESSION - ids.len()) as i64;
    let fresh: Vec<i64> = conn
        .prepare("SELECT id FROM saved_words WHERE level = 'new' ORDER BY added_at, id LIMIT ?1")?
        .query_map([c.new.min(room)], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    ids.extend(fresh);

    let all = words::list(conn)?;
    let mut rng = Shuffle::new(seed);
    ids.iter().map(|&id| item(conn, &all, id, now, &mut rng)).collect()
}

fn item(conn: &Connection, all: &[SavedWord], id: i64, now: i64, rng: &mut Shuffle) -> Result<Item> {
    let word = all.iter().find(|w| w.id == id).cloned().ok_or_else(|| anyhow!("That word is no longer in My words."))?;
    // The sentence practised longest ago (or never).
    let (item_id, idx): (Option<i64>, i64) = conn.query_row(
        "SELECT item_id, idx FROM word_contexts WHERE word_id = ?1 ORDER BY COALESCE(practised_at, 0), added_at DESC LIMIT 1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let context = word
        .contexts
        .iter()
        .find(|c| c.item_id == item_id && c.idx == idx)
        .or(word.contexts.first())
        .cloned()
        .ok_or_else(|| anyhow!("“{}” has no sentence to practise with.", word.text))?;
    let gap = split(&context.sentence, &word.text);
    let answer = answer_of(&word);
    let mut others: Vec<String> = all.iter().filter(|w| w.id != id).map(answer_of).filter(|a| !a.is_empty() && *a != answer).collect();
    others.sort();
    others.dedup();
    let choices = if answer.is_empty() || others.len() < 3 {
        vec![]
    } else {
        rng.shuffle(&mut others);
        let mut c: Vec<String> = others.into_iter().take(3).collect();
        c.push(answer.clone());
        rng.shuffle(&mut c);
        c
    };
    let card = card_of(conn, id, now)?;
    let preview = fsrs().repeat(card, at(now));
    let next = [Rating::Again, Rating::Hard, Rating::Good, Rating::Easy].map(|r| preview[&r].card.due.timestamp() - now);
    Ok(Item { word, context, gap, answer, choices, next })
}

/// Lower case, curly quotes straight, other punctuation as a space.
fn normalise(c: char) -> Option<char> {
    match c {
        '’' | '‘' | '`' => Some('\''),
        c if c.is_alphanumeric() || c == '\'' || c == '-' => Some(c.to_lowercase().next().unwrap_or(c)),
        _ => None,
    }
}

/// The words of a text, compared loosely: "Follow-through!" and "follow-through" are the same.
pub fn words_of(text: &str) -> Vec<String> {
    text.split(|c: char| normalise(c).is_none())
        .map(|w| w.chars().filter_map(normalise).collect::<String>().trim_matches(['\'', '-']).to_string())
        .filter(|w| !w.is_empty())
        .collect()
}

/// Whether what was typed is the word: case and punctuation don't matter, spelling does.
pub fn check(expected: &str, typed: &str) -> bool {
    let e = words_of(expected);
    !e.is_empty() && e == words_of(typed)
}

/// Splits `sentence` around the first whole-word match of `text`: [before, the words, after].
pub fn split(sentence: &str, text: &str) -> Option<[String; 3]> {
    let chars: Vec<(usize, char)> = sentence.char_indices().collect();
    let norm: Vec<Option<char>> = chars.iter().map(|&(_, c)| normalise(c)).collect();
    // The text's words with one space between them.
    let target: Vec<char> = words_of(text).join(" ").chars().collect();
    if target.is_empty() {
        return None;
    }
    // Hyphens count as part of a word: "in" isn't found in "in-tray".
    let is_word = |i: usize| norm.get(i).copied().flatten().is_some_and(|c| c.is_alphanumeric() || c == '-');
    'outer: for start in 0..chars.len() {
        if start > 0 && is_word(start - 1) {
            continue;
        }
        let mut i = start;
        for &t in &target {
            match norm.get(i) {
                Some(Some(c)) if *c == t && t != ' ' => i += 1,
                // Between words, any run of spaces and punctuation in the sentence: "Well, honestly".
                Some(None) if t == ' ' => {
                    while matches!(norm.get(i), Some(None)) {
                        i += 1;
                    }
                }
                _ => continue 'outer,
            }
        }
        if is_word(i) {
            continue;
        }
        let a = chars[start].0;
        let b = chars.get(i).map(|c| c.0).unwrap_or(sentence.len());
        return Some([sentence[..a].to_string(), sentence[a..b].to_string(), sentence[b..].to_string()]);
    }
    None
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Graded {
    pub level: String,
    pub due_at: i64,
}

/// One answer: 1 Again, 2 Hard, 3 Good, 4 Easy. `mode` is "type", "recall" or "pick".
#[allow(clippy::too_many_arguments)]
pub fn grade(
    conn: &Connection,
    word_id: i64,
    item_id: Option<i64>,
    idx: i64,
    mode: &str,
    grade: u8,
    correct: Option<bool>,
    typed: &str,
    seconds: i64,
    now: i64,
) -> Result<Graded> {
    let rating = match grade {
        1 => Rating::Again,
        2 => Rating::Hard,
        3 => Rating::Good,
        4 => Rating::Easy,
        _ => return Err(anyhow!("A grade is 1 to 4.")),
    };
    let card = fsrs().next(card_of(conn, word_id, now)?, at(now), rating).card;
    let level = level_of(&card);
    let due_at = card.due.timestamp();
    conn.execute(
        "UPDATE saved_words SET card = ?2, due_at = ?3, level = ?4 WHERE id = ?1",
        params![word_id, serde_json::to_string(&card)?, due_at, level],
    )?;
    conn.execute("UPDATE word_contexts SET practised_at = ?3 WHERE word_id = ?1 AND item_id IS ?2 AND idx = ?4", params![word_id, item_id, now, idx])?;
    let seconds = seconds.clamp(0, MAX_SECONDS_PER_WORD);
    conn.execute(
        "INSERT INTO word_reviews (word_id, at, mode, grade, correct, typed, seconds) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![word_id, now, mode, grade, correct, typed.trim(), seconds],
    )?;
    let day = Local.timestamp_opt(now, 0).single().map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_else(crate::activity::today);
    crate::activity::add(conn, &day, "words", seconds)?;
    Ok(Graded { level: level.into(), due_at })
}

/// "I know this": Known straight away, back in a year to check.
pub fn know(conn: &Connection, word_id: i64, now: i64) -> Result<Graded> {
    let mut card = card_of(conn, word_id, now)?;
    card.state = State::Review;
    card.stability = card.stability.max(365.0);
    card.difficulty = if card.difficulty > 0.0 { card.difficulty } else { 5.0 };
    card.scheduled_days = 365;
    card.last_review = at(now);
    card.due = at(now + 365 * 86_400);
    card.reps += 1;
    let due_at = card.due.timestamp();
    conn.execute(
        "UPDATE saved_words SET card = ?2, due_at = ?3, level = 'known' WHERE id = ?1",
        params![word_id, serde_json::to_string(&card)?, due_at],
    )?;
    conn.execute("INSERT INTO word_reviews (word_id, at, mode, grade) VALUES (?1, ?2, 'known', 4)", params![word_id, now])?;
    Ok(Graded { level: "known".into(), due_at })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::words::{add, NewWord};

    const NOW: i64 = 1_800_000_000;

    fn setup(n: usize) -> Db {
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
            for i in 0..n {
                let text = if i == 0 { "follow through".to_string() } else { format!("word{i}") };
                add(
                    &c,
                    &NewWord {
                        text,
                        headword: String::new(),
                        ipa: String::new(),
                        meaning: format!("meaning {i}\nmore"),
                        note: String::new(),
                        item_id: 1,
                        idx: 0,
                        from: 3,
                        to: 4,
                        typed: String::new(),
                    },
                )
                .unwrap();
                c.execute("UPDATE saved_words SET added_at = ?2 WHERE text = ?1", params![if i == 0 { "follow through".into() } else { format!("word{i}") }, i as i64])
                    .unwrap();
            }
        }
        db
    }

    #[test]
    fn answers_are_checked_loosely_but_spelt_exactly() {
        assert!(check("follow through", "Follow through."));
        assert!(check("don't", "don’t"));
        assert!(check("follow-through", "follow-through!"));
        assert!(!check("follow through", "follow true"));
        assert!(!check("follow through", "follow"));
        assert!(!check("", ""));
    }

    #[test]
    fn the_sentence_is_split_around_whole_words() {
        let s = |a: &str, b: &str, c: &str| Some([a.to_string(), b.to_string(), c.to_string()]);
        assert_eq!(split("You have to follow through.", "follow through"), s("You have to ", "follow through", "."));
        assert_eq!(split("Into the in-tray, in time.", "in"), s("Into the in-tray, ", "in", " time."));
        assert_eq!(split("I don’t know.", "don't"), s("I ", "don’t", " know."));
        assert_eq!(split("Well, honestly, yes.", "well honestly"), s("", "Well, honestly", ", yes."));
        assert_eq!(split("Nothing here.", "follow"), None);
    }

    #[test]
    fn levels_follow_the_interval() {
        let mut c = Card::default();
        assert_eq!(level_of(&c), "new");
        c.state = State::Review;
        c.scheduled_days = 1;
        assert_eq!(level_of(&c), "learning");
        c.scheduled_days = 7;
        assert_eq!(level_of(&c), "familiar");
        c.scheduled_days = 30;
        assert_eq!(level_of(&c), "known");
    }

    #[test]
    fn new_words_are_limited_per_day_and_a_session_holds_twenty() {
        let db = setup(25);
        let c = db.conn();
        let today = NOW - 3600;
        assert_eq!(counts(&c, NOW, today).unwrap(), Counts { due: 0, new: NEW_PER_DAY, total: NEW_PER_DAY });
        let q = queue(&c, NOW, today, 7).unwrap();
        assert_eq!(q.len(), NEW_PER_DAY as usize);
        assert_eq!(q[0].word.text, "follow through", "new words in the order they were saved");
        assert_eq!(q[0].gap.as_ref().unwrap()[1], "follow through");
        assert_eq!(q[0].answer, "meaning 0");
        assert_eq!(q[0].choices.len(), 4);
        assert!(q[0].choices.contains(&"meaning 0".to_string()));
        assert!(q[0].next[0] < q[0].next[2] && q[0].next[2] < q[0].next[3], "Again comes back soonest, Easy latest");

        // Four new words practised today leave six; one marked known doesn't count against the limit.
        for item in &q[..4] {
            grade(&c, item.word.id, Some(1), 0, "type", 3, Some(true), "x", 20, NOW).unwrap();
        }
        know(&c, q[4].word.id, NOW).unwrap();
        assert_eq!(counts(&c, NOW, today).unwrap().new, 6);

        // Days later the four are due and come first; still at most twenty.
        let later = NOW + 40 * 86_400;
        let c2 = counts(&c, later, later - 3600).unwrap();
        assert_eq!((c2.due, c2.new), (4, NEW_PER_DAY));
        let q2 = queue(&c, later, later - 3600, 1).unwrap();
        assert_eq!(q2.len(), 14);
        assert!(q2[..4].iter().all(|i| i.word.contexts.len() == 1 && q[..4].iter().any(|o| o.word.id == i.word.id)));
    }

    #[test]
    fn grades_move_the_level_and_the_date() {
        let db = setup(1);
        let c = db.conn();
        let id = queue(&c, NOW, NOW - 60, 1).unwrap()[0].word.id;
        let g = grade(&c, id, Some(1), 0, "type", 1, Some(false), "follow true", 30, NOW).unwrap();
        assert_eq!(g.level, "learning");
        assert!(g.due_at > NOW && g.due_at <= NOW + 2 * 86_400);
        // Good again and again: further apart each time, until it's known.
        let mut t = g.due_at;
        let mut last = 0;
        for _ in 0..6 {
            let g = grade(&c, id, Some(1), 0, "type", 3, Some(true), "follow through", 10, t).unwrap();
            assert!(g.due_at - t > last);
            last = g.due_at - t;
            t = g.due_at;
        }
        assert_eq!(words::get(&c, id).unwrap().level, "known");
        assert_eq!(words::get(&c, id).unwrap().reviews, 7);
        let time: i64 = c.query_row("SELECT SUM(seconds) FROM practice_days WHERE kind = 'words'", [], |r| r.get(0)).unwrap();
        assert_eq!(time, 30 + 6 * 10);
    }
}
