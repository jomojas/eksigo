//! What Eksigo keeps on this computer and how much space each part takes (Settings › Storage).

use std::path::Path;

use anyhow::Result;
use rusqlite::Connection;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub data_dir: String,
    /// Downloaded episodes, in the data folder.
    pub episodes: u32,
    pub episodes_bytes: u64,
    /// The learner's own files stay where they are and are never copied; shown for completeness.
    pub own_files: u32,
    pub own_files_bytes: u64,
    pub models_bytes: u64,
    pub dictionaries_bytes: u64,
    /// Transcripts, dictations, My words and settings.
    pub database_bytes: u64,
}

/// The size of everything under `path` (0 when it doesn't exist).
pub fn size(path: &Path) -> u64 {
    match std::fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() => std::fs::read_dir(path).map(|r| r.flatten().map(|e| size(&e.path())).sum()).unwrap_or(0),
        Ok(m) => m.len(),
        Err(_) => 0,
    }
}

pub fn usage(conn: &Connection, data_dir: &Path) -> Result<Usage> {
    let (episodes, episodes_bytes): (u32, i64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(bytes), 0) FROM items WHERE own_file = 0 AND state = 'ready'",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let (own_files, own_files_bytes): (u32, i64) =
        conn.query_row("SELECT COUNT(*), COALESCE(SUM(bytes), 0) FROM items WHERE own_file = 1", [], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let database_bytes = ["eksigo.db", "eksigo.db-wal", "eksigo.db-shm"].iter().map(|f| size(&data_dir.join(f))).sum();
    Ok(Usage {
        data_dir: data_dir.display().to_string(),
        episodes,
        // The files themselves, when the folder is there; the recorded sizes otherwise.
        episodes_bytes: match size(&data_dir.join("media")) {
            0 => episodes_bytes as u64,
            n => n,
        },
        own_files,
        own_files_bytes: own_files_bytes as u64,
        models_bytes: size(&data_dir.join("models")),
        dictionaries_bytes: size(&data_dir.join("dictionaries")),
        database_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn usage_adds_up_each_folder() {
        let dir = std::env::temp_dir().join(format!("eksigo-storage-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("models/sub")).unwrap();
        std::fs::write(dir.join("models/a.bin"), [0u8; 100]).unwrap();
        std::fs::write(dir.join("models/sub/b.bin"), [0u8; 50]).unwrap();
        std::fs::create_dir_all(dir.join("dictionaries")).unwrap();
        std::fs::write(dir.join("dictionaries/zh-1.sqlite"), [0u8; 30]).unwrap();
        let db = Db::open_in_memory().unwrap();
        let c = db.conn();
        c.execute_batch(
            "INSERT INTO items (title, source, own_file, path, bytes, state, added_at) VALUES ('a', 'Show', 0, '/m/a.mp3', 1000, 'ready', 0),
               ('b', 'Show', 0, NULL, NULL, 'downloading', 0), ('c', 'My files', 1, '/x/c.mp3', 400, 'ready', 0);",
        )
        .unwrap();
        let u = usage(&c, &dir).unwrap();
        assert_eq!((u.episodes, u.episodes_bytes, u.own_files, u.own_files_bytes), (1, 1000, 1, 400));
        assert_eq!((u.models_bytes, u.dictionaries_bytes, u.database_bytes), (150, 30, 0));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
