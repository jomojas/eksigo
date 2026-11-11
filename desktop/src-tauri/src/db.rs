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
    // 3: transcripts. A transcript belongs to one Library item, that is one exact audio file (DESIGN.md
    // section 4), and grows a chunk at a time; `done_ms` is how far it has got.
    "CREATE TABLE transcripts (
        item_id     INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
        model       TEXT NOT NULL,
        state       TEXT NOT NULL,          -- 'queued', 'running', 'done' or 'failed'
        done_ms     INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        error       TEXT,
        started_at  INTEGER NOT NULL,
        finished_at INTEGER
    );
    CREATE TABLE sentences (
        item_id  INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        idx      INTEGER NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms   INTEGER NOT NULL,
        text     TEXT NOT NULL,
        words    TEXT NOT NULL,             -- JSON: [[start_ms, end_ms, \"word\"], ...]
        PRIMARY KEY (item_id, idx)
    );",
    // 4: dictation. An attempt is one go through an episode; it stays open until the last sentence, and
    // progress is saved with every sentence. Answers keep the sentence as it was then.
    "CREATE TABLE attempts (
        id          INTEGER PRIMARY KEY,
        item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        started_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        finished_at INTEGER,
        position    INTEGER NOT NULL DEFAULT 0,   -- the sentence to carry on from
        seconds     INTEGER NOT NULL DEFAULT 0    -- time spent dictating
    );
    CREATE INDEX attempts_by_item ON attempts (item_id, started_at DESC);
    CREATE TABLE answers (
        attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
        idx        INTEGER NOT NULL,              -- the sentence
        kind       TEXT NOT NULL,                 -- 'typed', 'shown' (since 5; was 'known') or 'ad'
        original   TEXT NOT NULL,
        typed      TEXT NOT NULL DEFAULT '',
        plays      INTEGER NOT NULL DEFAULT 0,
        credit     REAL NOT NULL DEFAULT 0,       -- correct words, half for each spelling mistake
        total      INTEGER NOT NULL DEFAULT 0,
        spelling   INTEGER NOT NULL DEFAULT 0,
        marks      TEXT,                          -- JSON: the word-by-word comparison
        answered_at INTEGER NOT NULL,
        PRIMARY KEY (attempt_id, idx)
    );",
    // 5: "I know this one" became "show the original": the original goes into the box, and the learner
    // marks what they didn't know or catch. `flags` is the JSON list of those marks.
    "ALTER TABLE answers ADD COLUMN flags TEXT NOT NULL DEFAULT '[]';
    UPDATE answers SET kind = 'shown', typed = original WHERE kind = 'known';",
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
