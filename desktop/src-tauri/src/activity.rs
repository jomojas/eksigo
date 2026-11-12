//! Time spent practising, by day on this computer's calendar, for the Progress page and the streak.
//! Kept as it happens: an attempt's total alone can't say which days it was spread over.

use anyhow::Result;
use rusqlite::{params, Connection};
use chrono::{Days, NaiveDate};
use serde::Serialize;

/// Today on this computer's calendar, "2026-11-12".
pub fn today() -> String {
    day_of(chrono::Local::now().date_naive())
}

fn day_of(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

/// Adds `seconds` of practice of `kind` ("dictation", later "words") to `day`.
pub fn add(conn: &Connection, day: &str, kind: &str, seconds: i64) -> Result<()> {
    if seconds <= 0 {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO practice_days (day, kind, seconds) VALUES (?1, ?2, ?3)
         ON CONFLICT (day, kind) DO UPDATE SET seconds = seconds + excluded.seconds",
        params![day, kind, seconds],
    )?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Day {
    pub day: String,
    pub seconds: i64,
}

/// Seconds practised each day from `from` on (any kind), oldest first; days without practice are left out.
pub fn days(conn: &Connection, from: &str) -> Result<Vec<Day>> {
    let mut st = conn.prepare("SELECT day, SUM(seconds) FROM practice_days WHERE day >= ?1 GROUP BY day ORDER BY day")?;
    let rows = st.query_map([from], |r| Ok(Day { day: r.get(0)?, seconds: r.get(1)? }))?.collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Week {
    /// The last seven days, oldest first and `today` last; days without practice have 0 seconds.
    pub days: Vec<Day>,
    /// Days in a row with some practice, up to today, or up to yesterday while today has none yet.
    pub streak: i64,
}

/// Days with any practice, oldest first.
fn practised_days(conn: &Connection) -> Result<Vec<NaiveDate>> {
    let mut st = conn.prepare("SELECT day FROM practice_days GROUP BY day HAVING SUM(seconds) > 0 ORDER BY day")?;
    let days = st.query_map([], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(days.iter().filter_map(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()).collect())
}

/// (current, best): days in a row with practice. The current run ends today, or yesterday while today
/// has none yet; the best is the longest run ever, the current one included.
pub fn streaks(conn: &Connection, today: NaiveDate) -> Result<(i64, i64)> {
    let days = practised_days(conn)?;
    let (mut best, mut run, mut prev) = (0i64, 0i64, None::<NaiveDate>);
    for &d in &days {
        run = if prev.and_then(|p| p.succ_opt()) == Some(d) { run + 1 } else { 1 };
        best = best.max(run);
        prev = Some(d);
    }
    let yesterday = today - Days::new(1);
    let current = match prev {
        Some(last) if last == today || last == yesterday => run,
        _ => 0,
    };
    Ok((current, best))
}

/// The week shown on Today.
pub fn week(conn: &Connection, today: NaiveDate) -> Result<Week> {
    let from = today - Days::new(6);
    let got = days(conn, &day_of(from))?;
    let days = (0..7)
        .map(|i| {
            let day = day_of(from + Days::new(i));
            let seconds = got.iter().find(|g| g.day == day).map_or(0, |g| g.seconds);
            Day { day, seconds }
        })
        .collect();

    let streak = streaks(conn, today)?.0;
    Ok(Week { days, streak })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn time_adds_up_by_day() {
        let db = Db::open_in_memory().unwrap();
        let c = db.conn();
        add(&c, "2026-11-10", "dictation", 60).unwrap();
        add(&c, "2026-11-10", "dictation", 30).unwrap();
        add(&c, "2026-11-10", "words", 10).unwrap();
        add(&c, "2026-11-12", "dictation", 0).unwrap();
        add(&c, "2026-11-12", "dictation", 5).unwrap();
        assert_eq!(
            days(&c, "2026-11-01").unwrap(),
            vec![Day { day: "2026-11-10".into(), seconds: 100 }, Day { day: "2026-11-12".into(), seconds: 5 }]
        );
        assert_eq!(days(&c, "2026-11-11").unwrap().len(), 1);
    }

    #[test]
    fn week_and_streak() {
        let db = Db::open_in_memory().unwrap();
        let c = db.conn();
        let day = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap();
        for d in ["2026-11-01", "2026-11-09", "2026-11-10", "2026-11-11"] {
            add(&c, d, "dictation", 60).unwrap();
        }
        // Today has nothing yet: the streak still counts up to yesterday.
        let w = week(&c, day("2026-11-12")).unwrap();
        assert_eq!(w.streak, 3);
        assert_eq!(w.days.len(), 7);
        assert_eq!(w.days[0], Day { day: "2026-11-06".into(), seconds: 0 });
        assert_eq!(w.days[5].seconds, 60);
        assert_eq!(w.days[6], Day { day: "2026-11-12".into(), seconds: 0 });
        add(&c, "2026-11-12", "words", 30).unwrap();
        assert_eq!(week(&c, day("2026-11-12")).unwrap().streak, 4);
        // A day missed ends it.
        assert_eq!(week(&c, day("2026-11-14")).unwrap().streak, 0);
        assert_eq!(streaks(&c, day("2026-11-14")).unwrap(), (0, 4));
        for d in ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"] {
            add(&c, d, "words", 60).unwrap();
        }
        assert_eq!(streaks(&c, day("2026-11-12")).unwrap(), (4, 5));
    }
}
