//! The local SQLite database. Each schema change is one more entry in `MIGRATIONS`;
//! `PRAGMA user_version` records how many have run.

use std::{path::Path, sync::Mutex};

use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};

const MIGRATIONS: &[&str] = &[
    // 1: settings as key/value pairs (theme, playback defaults, ...).
    "CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );",
    // 2: podcasts and the Library. Times are Unix seconds.
    "CREATE TABLE shows (
        id            INTEGER PRIMARY KEY,
        feed_url      TEXT NOT NULL UNIQUE,
        apple_id      TEXT,
        title         TEXT NOT NULL,
        author        TEXT NOT NULL DEFAULT '',
        description   TEXT NOT NULL DEFAULT '',
        artwork_url   TEXT,
        subscribed_at INTEGER,      -- NULL when not subscribed
        refreshed_at  INTEGER       -- last time the feed was read
    );
    CREATE TABLE episodes (
        id           INTEGER PRIMARY KEY,
        show_id      INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
        guid         TEXT NOT NULL,
        title        TEXT NOT NULL,
        published_at INTEGER,
        duration_s   REAL,
        audio_url    TEXT NOT NULL,
        audio_bytes  INTEGER,
        description  TEXT NOT NULL DEFAULT '',
        artwork_url  TEXT,
        UNIQUE (show_id, guid)
    );
    CREATE INDEX episodes_by_show ON episodes (show_id, published_at DESC);
    -- The Library: everything that can be practised, downloaded episodes and the learner's own files.
    CREATE TABLE items (
        id                INTEGER PRIMARY KEY,
        episode_id        INTEGER UNIQUE REFERENCES episodes(id) ON DELETE SET NULL,
        title             TEXT NOT NULL,
        source            TEXT NOT NULL,   -- the show's title, or 'My files'
        own_file          INTEGER NOT NULL DEFAULT 0,
        path              TEXT,            -- the audio or video file; NULL until downloaded
        bytes             INTEGER,
        duration_s        REAL,
        state             TEXT NOT NULL,   -- 'downloading', 'ready' or 'failed'
        error             TEXT,
        added_at          INTEGER NOT NULL,
        last_practised_at INTEGER
    );",
];

pub struct Db(pub Mutex<Connection>);

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        migrate(&mut conn)?;
        Ok(Db(Mutex::new(conn)))
    }

    /// The connection, for the queries in other modules.
    pub fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.0.lock().unwrap()
    }

    pub fn schema_version(&self) -> Result<i64> {
        let conn = self.0.lock().unwrap();
        Ok(conn.pragma_query_value(None, "user_version", |r| r.get(0))?)
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.0.lock().unwrap();
        Ok(conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
            .optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.0.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }
}

fn migrate(conn: &mut Connection) -> Result<()> {
    let current: usize = conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))? as usize;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_to_the_latest_version() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len() as i64);
    }

    #[test]
    fn settings_round_trip_and_overwrite() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(db.get_setting("theme").unwrap(), None);
        db.set_setting("theme", "dark").unwrap();
        db.set_setting("theme", "light").unwrap();
        assert_eq!(db.get_setting("theme").unwrap().as_deref(), Some("light"));
    }
}
