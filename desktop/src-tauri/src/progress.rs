//! The Progress page (DESIGN.md, Progress): streaks, time, dictation accuracy, words known and the year grid.
//! Accuracy is dictation only: the share of words heard right, half off for a spelling mistake, the same
//! credit the results screen uses.

use anyhow::Result;
use chrono::{Datelike, Days, Local, Months, NaiveDate, TimeZone};
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::activity;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayDetail {
    pub day: String,
    pub seconds: i64,
    /// Sentences typed in dictation.
    pub sentences: i64,
    /// Different episodes or files dictated.
    pub episodes: i64,
    /// Words practised.
    pub words: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekAccuracy {
    /// The Monday the week starts on.
    pub start: String,
    pub accuracy: Option<f64>,
    pub sentences: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub streak: i64,
    pub best_streak: i64,
    /// The last seven days, as on Today.
    pub week_seconds: i64,
    pub month_accuracy: Option<f64>,
    pub last_month_accuracy: Option<f64>,
    pub words_known: i64,
    pub words_total: i64,
    /// The first day of the year grid: the Monday 52 weeks before this week's.
    pub from: String,
    pub year_seconds: i64,
    /// Days from `from` on with any practice, oldest first.
    pub days: Vec<DayDetail>,
    /// The last twelve weeks, oldest first, this week last.
    pub weeks: Vec<WeekAccuracy>,
}

fn day_of(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

/// Local midnight at the start of `d`, as Unix seconds.
fn start_of(d: NaiveDate) -> i64 {
    let midnight = d.and_hms_opt(0, 0, 0).unwrap();
    Local.from_local_datetime(&midnight).earliest().map(|t| t.timestamp()).unwrap_or(0)
}

/// Dictation accuracy and sentences typed between two times.
fn accuracy(conn: &Connection, from: i64, to: i64) -> Result<(Option<f64>, i64)> {
    let (credit, total, n): (f64, i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(credit), 0), COALESCE(SUM(total), 0), COUNT(*) FROM answers
         WHERE kind = 'typed' AND answered_at >= ?1 AND answered_at < ?2",
        params![from, to],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    Ok(((total > 0).then(|| credit / total as f64), n))
}

pub fn progress(conn: &Connection, today: NaiveDate) -> Result<Progress> {
    let (streak, best_streak) = activity::streaks(conn, today)?;
    let week_seconds = activity::days(conn, &day_of(today - Days::new(6)))?.iter().map(|d| d.seconds).sum();

    let month = today.with_day(1).unwrap();
    let (month_accuracy, _) = accuracy(conn, start_of(month), start_of(month + Months::new(1)))?;
    let (last_month_accuracy, _) = accuracy(conn, start_of(month - Months::new(1)), start_of(month))?;

    let (words_known, words_total): (i64, i64) = conn.query_row(
        "SELECT COUNT(*) FILTER (WHERE level = 'known'), COUNT(*) FROM saved_words",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    let monday = today - Days::new(today.weekday().num_days_from_monday() as u64);
    let from = monday - Days::new(52 * 7);
    let mut days: Vec<DayDetail> = activity::days(conn, &day_of(from))?
        .into_iter()
        .map(|d| DayDetail { day: d.day, seconds: d.seconds, sentences: 0, episodes: 0, words: 0 })
        .collect();
    let since = start_of(from);
    let mut st = conn.prepare(
        "SELECT date(an.answered_at, 'unixepoch', 'localtime') AS day, COUNT(*), COUNT(DISTINCT at.item_id)
         FROM answers an JOIN attempts at ON at.id = an.attempt_id
         WHERE an.kind = 'typed' AND an.answered_at >= ?1 GROUP BY day",
    )?;
    let typed = st.query_map([since], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))?;
    for row in typed {
        let (day, sentences, episodes) = row?;
        let d = detail(&mut days, day);
        d.sentences = sentences;
        d.episodes = episodes;
    }
    let mut st = conn.prepare(
        "SELECT date(at, 'unixepoch', 'localtime') AS day, COUNT(*) FROM word_reviews
         WHERE mode != 'known' AND at >= ?1 GROUP BY day",
    )?;
    let reviewed = st.query_map([since], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    for row in reviewed {
        let (day, words) = row?;
        detail(&mut days, day).words = words;
    }
    days.sort_by(|a, b| a.day.cmp(&b.day));
    let year_seconds = days.iter().map(|d| d.seconds).sum();

    let weeks = (0..12u64)
        .rev()
        .map(|i| {
            let start = monday - Days::new(i * 7);
            let (accuracy, sentences) = accuracy(conn, start_of(start), start_of(start + Days::new(7)))?;
            Ok(WeekAccuracy { start: day_of(start), accuracy, sentences })
        })
        .collect::<Result<_>>()?;

    Ok(Progress {
        streak,
        best_streak,
        week_seconds,
        month_accuracy,
        last_month_accuracy,
        words_known,
        words_total,
        from: day_of(from),
        year_seconds,
        days,
        weeks,
    })
}

fn detail(days: &mut Vec<DayDetail>, day: String) -> &mut DayDetail {
    let i = match days.iter().position(|d| d.day == day) {
        Some(i) => i,
        None => {
            days.push(DayDetail { day, seconds: 0, sentences: 0, episodes: 0, words: 0 });
            days.len() - 1
        }
    };
    &mut days[i]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn noon(d: NaiveDate) -> i64 {
        start_of(d) + 12 * 3600
    }

    #[test]
    fn a_week_of_practice() {
        let db = Db::open_in_memory().unwrap();
        let c = db.conn();
        let today = NaiveDate::from_ymd_opt(2026, 11, 12).unwrap(); // a Thursday
        let day = |n: u64| today - Days::new(n);

        c.execute_batch(
            "INSERT INTO items (id, title, source, state, added_at) VALUES (1, 'A', 'Show', 'ready', 0), (2, 'B', 'Show', 'ready', 0);
             INSERT INTO attempts (id, item_id, started_at, updated_at) VALUES (1, 1, 0, 0), (2, 2, 0, 0);
             INSERT INTO saved_words (text, added_at, updated_at, level) VALUES ('a', 0, 0, 'known'), ('b', 0, 0, 'new'), ('c', 0, 0, 'learning');",
        )
        .unwrap();
        let answer = |attempt: i64, idx: i64, at: i64, credit: f64, total: i64| {
            c.execute(
                "INSERT INTO answers (attempt_id, idx, kind, original, credit, total, answered_at) VALUES (?1, ?2, 'typed', '', ?3, ?4, ?5)",
                params![attempt, idx, credit, total, at],
            )
            .unwrap();
        };
        // Last month: 5 of 10 words. This month: 18 of 20, over two episodes on one day.
        answer(1, 0, noon(NaiveDate::from_ymd_opt(2026, 10, 20).unwrap()), 5.0, 10);
        answer(1, 1, noon(day(1)), 9.0, 10);
        answer(2, 0, noon(day(1)), 9.0, 10);
        c.execute("INSERT INTO word_reviews (word_id, at, mode, grade, correct, typed, seconds) VALUES (3, ?1, 'type', 3, 1, 'c', 5)", [noon(today)])
            .unwrap();
        for n in 0..5 {
            activity::add(&c, &day_of(day(n)), "dictation", 600).unwrap();
        }
        activity::add(&c, &day_of(day(9)), "dictation", 60).unwrap();

        let p = progress(&c, today).unwrap();
        assert_eq!((p.streak, p.best_streak), (5, 5));
        assert_eq!(p.week_seconds, 3000);
        assert_eq!(p.month_accuracy, Some(0.9));
        assert_eq!(p.last_month_accuracy, Some(0.5));
        assert_eq!((p.words_known, p.words_total), (1, 3));
        assert_eq!(p.from, "2025-11-10", "the Monday 52 weeks before this week's");
        assert_eq!(p.year_seconds, 3060);
        // Oct 20 has an answer but no recorded time; it's still a day with something done.
        assert_eq!(p.days.len(), 7);
        let yesterday = p.days.iter().find(|d| d.day == "2026-11-11").unwrap();
        assert_eq!(*yesterday, DayDetail { day: "2026-11-11".into(), seconds: 600, sentences: 2, episodes: 2, words: 0 });
        assert_eq!(p.days.last().unwrap().words, 1);
        assert_eq!(p.weeks.len(), 12);
        assert_eq!(p.weeks[11], WeekAccuracy { start: "2026-11-09".into(), accuracy: Some(0.9), sentences: 2 });
        assert_eq!(p.weeks[8].accuracy, Some(0.5), "the week of 19 Oct");
        assert_eq!(p.weeks[0].accuracy, None);
    }
}
