//! Time spent practising, by day on this computer's calendar, for the Progress page and the streak.
//! Kept as it happens: an attempt's total alone can't say which days it was spread over.

use anyhow::Result;
use rusqlite::{params, Connection};
use serde::Serialize;

/// Today on this computer's calendar, "2026-11-12".
pub fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
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
}
