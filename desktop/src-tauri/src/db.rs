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
        kind       TEXT NOT NULL,                 -- 'typed', 'known' (I know this one) or 'ad' (left out)
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
    // 5: tried and replaced by 6: "show the original" with marks typed in the box.
    "ALTER TABLE answers ADD COLUMN flags TEXT NOT NULL DEFAULT '[]';
    UPDATE answers SET kind = 'shown', typed = original WHERE kind = 'known';",
    // 6: back to "I know this one"; instead of marking words, the learner flags whole sentences to look
    // at in the review. A flag can be set before the sentence is answered, so it has its own table.
    "UPDATE answers SET kind = 'known', typed = '' WHERE kind = 'shown';
    ALTER TABLE answers DROP COLUMN flags;
    CREATE TABLE flagged (
        attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
        idx        INTEGER NOT NULL,
        PRIMARY KEY (attempt_id, idx)
    );",
    // 7: answers that came back from 'shown' kept the marks and score of that version; a known
    // sentence counts as all correct and has no word-by-word comparison to show.
    "UPDATE answers SET credit = total, spelling = 0, marks = NULL WHERE kind = 'known';",
    // 8: My words. A word or phrase as selected (one row however often it's saved), and each sentence it
    // was saved from, with where the words are in the audio. The sentence text is kept, so a word
    // outlives the episode it came from.
    "CREATE TABLE saved_words (
        id         INTEGER PRIMARY KEY,
        text       TEXT NOT NULL UNIQUE COLLATE NOCASE,
        headword   TEXT NOT NULL DEFAULT '',  -- the dictionary entry it was found under
        ipa        TEXT NOT NULL DEFAULT '',
        meaning    TEXT NOT NULL DEFAULT '',
        note       TEXT NOT NULL DEFAULT '',  -- the learner's own meaning
        added_at   INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE TABLE word_contexts (
        word_id  INTEGER NOT NULL REFERENCES saved_words(id) ON DELETE CASCADE,
        item_id  INTEGER REFERENCES items(id) ON DELETE SET NULL,
        idx      INTEGER NOT NULL,
        sentence TEXT NOT NULL,
        typed    TEXT NOT NULL DEFAULT '',
        start_ms INTEGER NOT NULL,
        end_ms   INTEGER NOT NULL,
        added_at INTEGER NOT NULL,
        UNIQUE (word_id, item_id, idx)
    );",
    // 9: a saved word's sentence plays whole, and shows where it is in the episode.
    "ALTER TABLE word_contexts ADD COLUMN sentence_start_ms INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE word_contexts ADD COLUMN sentence_end_ms INTEGER NOT NULL DEFAULT 0;
    UPDATE word_contexts SET
        sentence_start_ms = COALESCE((SELECT s.start_ms FROM sentences s WHERE s.item_id = word_contexts.item_id AND s.idx = word_contexts.idx), start_ms),
        sentence_end_ms = COALESCE((SELECT s.end_ms FROM sentences s WHERE s.item_id = word_contexts.item_id AND s.idx = word_contexts.idx), end_ms);",
    // 10: practice time by day (this computer's calendar), for Progress. Time from before is put on the day
    // each attempt was last worked on, the best that can be known now.
    "CREATE TABLE practice_days (
        day     TEXT NOT NULL,                  -- 'YYYY-MM-DD'
        kind    TEXT NOT NULL,                  -- 'dictation' or 'words'
        seconds INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, kind)
    );
    INSERT INTO practice_days (day, kind, seconds)
        SELECT date(updated_at, 'unixepoch', 'localtime'), 'dictation', SUM(seconds) FROM attempts WHERE seconds > 0 GROUP BY 1;",
    // 11: word practice (practice.rs). Each word's FSRS card as JSON, when it's next due and the level that
    // follows; which sentence was practised when; and every answer, for Progress.
    "ALTER TABLE saved_words ADD COLUMN card TEXT;
    ALTER TABLE saved_words ADD COLUMN due_at INTEGER;
    ALTER TABLE saved_words ADD COLUMN level TEXT NOT NULL DEFAULT 'new';
    CREATE INDEX saved_words_due ON saved_words (level, due_at);
    ALTER TABLE word_contexts ADD COLUMN practised_at INTEGER;
    CREATE TABLE word_reviews (
        word_id INTEGER NOT NULL REFERENCES saved_words(id) ON DELETE CASCADE,
        at      INTEGER NOT NULL,
        mode    TEXT NOT NULL,                 -- 'type', 'recall', 'pick' or 'known' (I know this)
        grade   INTEGER NOT NULL,              -- 1 Again, 2 Hard, 3 Good, 4 Easy
        correct INTEGER,                       -- typed or picked right; NULL for recall
        typed   TEXT NOT NULL DEFAULT '',
        seconds INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX word_reviews_by_word ON word_reviews (word_id, at);",
    // 12: AI (ai.rs). What a saved word means in its sentence; and, per attempt, why a sentence was misheard
    // (`idx`) and the episode review (`idx` -1), in the language they were written in, so each is asked once.
    "ALTER TABLE saved_words ADD COLUMN explanation TEXT NOT NULL DEFAULT '';
    CREATE TABLE ai_notes (
        attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
        idx        INTEGER NOT NULL,
        lang       TEXT NOT NULL,
        json       TEXT NOT NULL,
        created    INTEGER NOT NULL,
        PRIMARY KEY (attempt_id, idx, lang)
    );",
    // 13: AI conversations about one sentence (ai.rs, design D17): per attempt on Results, per episode on Listen
    // (no attempt). `why` holds the answer to *Why did I miss this?*, by reason; `answer` the rest.
    "CREATE TABLE ai_messages (
        id         INTEGER PRIMARY KEY,
        item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        attempt_id INTEGER REFERENCES attempts(id) ON DELETE CASCADE,
        idx        INTEGER NOT NULL,
        question   TEXT NOT NULL,
        why        TEXT,
        answer     TEXT NOT NULL DEFAULT '',
        created    INTEGER NOT NULL
    );
    CREATE INDEX ai_messages_by_sentence ON ai_messages (item_id, idx);",
    // 14: sync (sync.rs, design D20). What each record looked like when last sent or received; what other devices
    // sent that isn't merged into this computer's own tables (the phone's listening, other devices' practice days);
    // where a word's sentence came from when its episode isn't in this Library; and practice days from everywhere.
    "CREATE TABLE sync_sent (
        kind TEXT NOT NULL,
        key  TEXT NOT NULL,
        hash TEXT NOT NULL,
        PRIMARY KEY (kind, key)
    );
    CREATE TABLE synced (
        kind       TEXT NOT NULL,
        key        TEXT NOT NULL,
        data       TEXT NOT NULL,
        changed_at INTEGER NOT NULL,
        PRIMARY KEY (kind, key)
    );
    ALTER TABLE word_contexts ADD COLUMN audio_url TEXT;
    ALTER TABLE word_contexts ADD COLUMN title TEXT;
    ALTER TABLE word_contexts ADD COLUMN source TEXT;
    CREATE VIEW practice_all AS
        SELECT day, kind, seconds FROM practice_days
        UNION ALL
        SELECT json_extract(data, '$.day'), json_extract(data, '$.kind'), json_extract(data, '$.seconds') FROM synced WHERE kind = 'day';",
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
