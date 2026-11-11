//! Shows, episodes and the Library in the database, downloads, and the learner's own files.
//! A download is a practice copy kept on purpose (DESIGN.md section 4): never re-downloaded silently.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

use crate::{
    audio,
    db::Db,
    podcasts::{self, Feed, Listing},
};

pub const MY_FILES: &str = "My files";

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Show {
    pub id: i64,
    pub feed_url: String,
    pub apple_id: Option<String>,
    pub title: String,
    pub author: String,
    pub description: String,
    pub artwork_url: Option<String>,
    pub subscribed: bool,
    pub refreshed_at: Option<i64>,
    pub episode_count: i64,
    /// Episodes published since subscribing that aren't in the Library.
    pub new_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Episode {
    pub id: i64,
    pub show_id: i64,
    pub title: String,
    pub published_at: Option<i64>,
    pub duration_s: Option<f64>,
    pub audio_url: String,
    pub audio_bytes: Option<i64>,
    pub description: String,
    pub artwork_url: Option<String>,
    /// Set when the episode is in the Library.
    pub item_id: Option<i64>,
    pub item_state: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: i64,
    pub episode_id: Option<i64>,
    pub show_id: Option<i64>,
    pub title: String,
    pub source: String,
    pub own_file: bool,
    pub path: Option<String>,
    pub bytes: Option<i64>,
    pub duration_s: Option<f64>,
    /// "downloading", "ready", "failed", or "missing" when an own file has been moved or deleted.
    pub state: String,
    pub error: Option<String>,
    pub added_at: i64,
    pub last_practised_at: Option<i64>,
    pub artwork_url: Option<String>,
}

const SHOW_COLS: &str = "s.id, s.feed_url, s.apple_id, s.title, s.author, s.description, s.artwork_url,
    s.subscribed_at IS NOT NULL, s.refreshed_at,
    (SELECT count(*) FROM episodes e WHERE e.show_id = s.id),
    (SELECT count(*) FROM episodes e LEFT JOIN items i ON i.episode_id = e.id
       WHERE e.show_id = s.id AND i.id IS NULL AND e.published_at > s.subscribed_at)";

fn show_from(r: &Row) -> rusqlite::Result<Show> {
    Ok(Show {
        id: r.get(0)?,
        feed_url: r.get(1)?,
        apple_id: r.get(2)?,
        title: r.get(3)?,
        author: r.get(4)?,
        description: r.get(5)?,
        artwork_url: r.get(6)?,
        subscribed: r.get(7)?,
        refreshed_at: r.get(8)?,
        episode_count: r.get(9)?,
        new_count: r.get(10)?,
    })
}

const EPISODE_COLS: &str = "e.id, e.show_id, e.title, e.published_at, e.duration_s, e.audio_url, e.audio_bytes,
    e.description, COALESCE(e.artwork_url, s.artwork_url), i.id, i.state";

fn episode_from(r: &Row) -> rusqlite::Result<Episode> {
    Ok(Episode {
        id: r.get(0)?,
        show_id: r.get(1)?,
        title: r.get(2)?,
        published_at: r.get(3)?,
        duration_s: r.get(4)?,
        audio_url: r.get(5)?,
        audio_bytes: r.get(6)?,
        description: r.get(7)?,
        artwork_url: r.get(8)?,
        item_id: r.get(9)?,
        item_state: r.get(10)?,
    })
}

const ITEM_COLS: &str = "i.id, i.episode_id, e.show_id, i.title, i.source, i.own_file, i.path, i.bytes, i.duration_s,
    i.state, i.error, i.added_at, i.last_practised_at, COALESCE(e.artwork_url, s.artwork_url)";
const ITEM_FROM: &str = "items i LEFT JOIN episodes e ON e.id = i.episode_id LEFT JOIN shows s ON s.id = e.show_id";

fn item_from(r: &Row) -> rusqlite::Result<Item> {
    let own_file: bool = r.get(5)?;
    let path: Option<String> = r.get(6)?;
    let mut state: String = r.get(9)?;
    if own_file && state == "ready" && !path.as_deref().is_some_and(|p| Path::new(p).exists()) {
        state = "missing".into();
    }
    Ok(Item {
        id: r.get(0)?,
        episode_id: r.get(1)?,
        show_id: r.get(2)?,
        title: r.get(3)?,
        source: r.get(4)?,
        own_file,
        path,
        bytes: r.get(7)?,
        duration_s: r.get(8)?,
        state,
        error: r.get(10)?,
        added_at: r.get(11)?,
        last_practised_at: r.get(12)?,
        artwork_url: r.get(13)?,
    })
}

// ---------- shows and episodes ----------

/// Saves a show from search results or a feed link and returns its id. Known shows keep what they have.
pub fn save_listing(conn: &Connection, l: &Listing) -> Result<i64> {
    let feed = l.feed_url.as_deref().ok_or_else(|| anyhow!("the show has no feed"))?;
    conn.execute(
        "INSERT INTO shows (feed_url, apple_id, title, author, artwork_url, description) VALUES (?1, ?2, ?3, ?4, ?5, '')
         ON CONFLICT(feed_url) DO UPDATE SET apple_id = COALESCE(shows.apple_id, excluded.apple_id),
                                             artwork_url = COALESCE(shows.artwork_url, excluded.artwork_url)",
        params![feed, l.apple_id, l.title, l.author, l.artwork_url],
    )?;
    Ok(conn.query_row("SELECT id FROM shows WHERE feed_url = ?1", [feed], |r| r.get(0))?)
}

/// Stores what a feed says about a show and its episodes.
pub fn save_feed(conn: &mut Connection, show_id: i64, feed: &Feed) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE shows SET title = ?2, author = CASE WHEN ?3 = '' THEN author ELSE ?3 END, description = ?4,
                          artwork_url = COALESCE(?5, artwork_url), refreshed_at = ?6 WHERE id = ?1",
        params![show_id, feed.title, feed.author, feed.description, feed.artwork_url, now()],
    )?;
    {
        let mut upsert = tx.prepare(
            "INSERT INTO episodes (show_id, guid, title, published_at, duration_s, audio_url, audio_bytes, description, artwork_url)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(show_id, guid) DO UPDATE SET title = excluded.title, published_at = excluded.published_at,
               duration_s = excluded.duration_s, audio_url = excluded.audio_url, audio_bytes = excluded.audio_bytes,
               description = excluded.description, artwork_url = excluded.artwork_url",
        )?;
        for e in &feed.episodes {
            upsert.execute(params![
                show_id,
                e.guid,
                e.title,
                e.published_at,
                e.duration_s,
                e.audio_url,
                e.audio_bytes,
                e.description,
                e.artwork_url
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn show(conn: &Connection, id: i64) -> Result<Show> {
    conn.query_row(&format!("SELECT {SHOW_COLS} FROM shows s WHERE s.id = ?1"), [id], show_from)
        .optional()?
        .ok_or_else(|| anyhow!("That show isn't saved on this computer."))
}

pub fn subscribed(conn: &Connection) -> Result<Vec<Show>> {
    let mut st = conn.prepare(&format!("SELECT {SHOW_COLS} FROM shows s WHERE s.subscribed_at IS NOT NULL ORDER BY s.subscribed_at"))?;
    let rows = st.query_map([], show_from)?.collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn set_subscribed(conn: &Connection, id: i64, on: bool) -> Result<()> {
    conn.execute(
        "UPDATE shows SET subscribed_at = CASE WHEN ?2 THEN COALESCE(subscribed_at, ?3) ELSE NULL END WHERE id = ?1",
        params![id, on, now()],
    )?;
    Ok(())
}

pub fn episodes(conn: &Connection, show_id: i64) -> Result<Vec<Episode>> {
    let mut st = conn.prepare(&format!(
        "SELECT {EPISODE_COLS} FROM episodes e JOIN shows s ON s.id = e.show_id LEFT JOIN items i ON i.episode_id = e.id
         WHERE e.show_id = ?1 ORDER BY e.published_at DESC NULLS LAST, e.id DESC"
    ))?;
    let rows = st.query_map([show_id], episode_from)?.collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn episode(conn: &Connection, id: i64) -> Result<Episode> {
    conn.query_row(
        &format!(
            "SELECT {EPISODE_COLS} FROM episodes e JOIN shows s ON s.id = e.show_id LEFT JOIN items i ON i.episode_id = e.id
             WHERE e.id = ?1"
        ),
        [id],
        episode_from,
    )
    .optional()?
    .ok_or_else(|| anyhow!("That episode isn't saved on this computer."))
}

// ---------- the Library ----------

pub fn items(conn: &Connection) -> Result<Vec<Item>> {
    let mut st = conn.prepare(&format!(
        "SELECT {ITEM_COLS} FROM {ITEM_FROM} ORDER BY COALESCE(i.last_practised_at, i.added_at) DESC, i.id DESC"
    ))?;
    let rows = st.query_map([], item_from)?.collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

pub fn item(conn: &Connection, id: i64) -> Result<Item> {
    conn.query_row(&format!("SELECT {ITEM_COLS} FROM {ITEM_FROM} WHERE i.id = ?1"), [id], item_from)
        .optional()?
        .ok_or_else(|| anyhow!("That item is no longer in your library."))
}

/// Space used by downloaded episodes (own files stay where they are and aren't counted).
pub fn downloads_bytes(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("SELECT COALESCE(SUM(bytes), 0) FROM items WHERE own_file = 0 AND state = 'ready'", [], |r| r.get(0))?)
}

/// Adds an episode to the Library as a download in progress. Returns the item and whether it is new;
/// an episode already in the Library is left as it is, except that a failed download is tried again.
pub fn begin_download(conn: &Connection, episode_id: i64) -> Result<(i64, bool)> {
    if let Some((id, state)) = conn
        .query_row("SELECT id, state FROM items WHERE episode_id = ?1", [episode_id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })
        .optional()?
    {
        if state != "failed" {
            return Ok((id, false));
        }
        conn.execute("UPDATE items SET state = 'downloading', error = NULL WHERE id = ?1", [id])?;
        return Ok((id, true));
    }
    conn.execute(
        "INSERT INTO items (episode_id, title, source, state, added_at, duration_s)
         SELECT e.id, e.title, s.title, 'downloading', ?2, e.duration_s FROM episodes e JOIN shows s ON s.id = e.show_id WHERE e.id = ?1",
        params![episode_id, now()],
    )?;
    Ok((conn.last_insert_rowid(), true))
}

/// Adds one of the learner's own files. The file stays where it is. Returns the item's id.
pub fn add_file(conn: &Connection, path: &Path, duration_s: f64) -> Result<i64> {
    let p = path.to_string_lossy().to_string();
    if let Some(id) = conn
        .query_row("SELECT id FROM items WHERE own_file = 1 AND path = ?1", [&p], |r| r.get(0))
        .optional()?
    {
        return Ok(id);
    }
    let title = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| p.clone());
    let bytes = std::fs::metadata(path).map(|m| m.len() as i64).ok();
    conn.execute(
        "INSERT INTO items (title, source, own_file, path, bytes, duration_s, state, added_at) VALUES (?1, ?2, 1, ?3, ?4, ?5, 'ready', ?6)",
        params![title, MY_FILES, p, bytes, duration_s, now()],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Takes an item out of the Library. Returns the downloaded file to delete; own files are never deleted.
pub fn remove_item(conn: &Connection, id: i64) -> Result<Option<PathBuf>> {
    let (own, path): (bool, Option<String>) =
        conn.query_row("SELECT own_file, path FROM items WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    conn.execute("DELETE FROM items WHERE id = ?1", [id])?;
    Ok(if own { None } else { path.map(PathBuf::from) })
}

// ---------- downloads ----------

/// Downloads in progress, so they can be cancelled.
#[derive(Default)]
pub struct Downloads(Mutex<HashMap<i64, Arc<AtomicBool>>>);

impl Downloads {
    pub fn cancel(&self, item_id: i64) -> bool {
        match self.0.lock().unwrap().get(&item_id) {
            Some(flag) => {
                flag.store(true, Ordering::Relaxed);
                true
            }
            None => false,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub item_id: i64,
    pub received: u64,
    pub total: Option<u64>,
}

/// Where downloaded episodes are kept.
pub fn media_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = app.path().app_data_dir()?.join("media");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// The file extension for a download, from its link or else its content type.
fn extension(url: &str, content_type: Option<&str>) -> &'static str {
    let path = url.split(['?', '#']).next().unwrap_or("").to_ascii_lowercase();
    if let Some(ext) = audio::EXTENSIONS.iter().find(|e| path.ends_with(&format!(".{e}"))) {
        return ext;
    }
    match content_type.unwrap_or("") {
        t if t.contains("mp4") || t.contains("m4a") || t.contains("aac") => "m4a",
        t if t.contains("ogg") => "ogg",
        t if t.contains("wav") => "wav",
        _ => "mp3",
    }
}

/// Downloads an episode into the Library, reporting progress as `download` events. Runs until done,
/// failed or cancelled; the Library hears `library` when its state changes.
pub async fn download(app: AppHandle, item_id: i64, url: String) {
    let cancel = Arc::new(AtomicBool::new(false));
    app.state::<Downloads>().0.lock().unwrap().insert(item_id, cancel.clone());
    let result = fetch_to_file(&app, item_id, &url, &cancel).await;
    app.state::<Downloads>().0.lock().unwrap().remove(&item_id);

    let db = app.state::<Db>();
    match result {
        Ok((path, bytes)) => {
            let duration = {
                let p = path.clone();
                tauri::async_runtime::spawn_blocking(move || audio::duration(&p)).await.ok().and_then(|d| d.ok())
            };
            let conn = db.conn();
            let _ = conn.execute(
                "UPDATE items SET state = 'ready', path = ?2, bytes = ?3, duration_s = COALESCE(?4, duration_s), error = NULL WHERE id = ?1",
                params![item_id, path.to_string_lossy(), bytes as i64, duration],
            );
        }
        Err(_) if cancel.load(Ordering::Relaxed) => {
            let _ = db.conn().execute("DELETE FROM items WHERE id = ?1", [item_id]);
        }
        Err(e) => {
            let _ = db.conn().execute(
                "UPDATE items SET state = 'failed', error = ?2 WHERE id = ?1",
                params![item_id, format!("{e:#}")],
            );
        }
    }
    let _ = app.emit("library", ());
}

async fn fetch_to_file(app: &AppHandle, item_id: i64, url: &str, cancel: &AtomicBool) -> Result<(PathBuf, u64)> {
    let res = podcasts::HTTP
        .get(url)
        .send()
        .await
        .context("The episode can't be reached")?
        .error_for_status()
        .context("The podcast's server refused the download")?;
    let total = res.content_length();
    let content_type = res.headers().get("content-type").and_then(|v| v.to_str().ok()).map(str::to_string);
    let dir = media_dir(app)?;
    let part = dir.join(format!("{item_id}.part"));
    let mut file = tokio::fs::File::create(&part).await?;
    let mut stream = res.bytes_stream();
    let mut received = 0u64;
    let mut last = Instant::now() - Duration::from_secs(1);

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            drop(file);
            let _ = tokio::fs::remove_file(&part).await;
            return Err(anyhow!("cancelled"));
        }
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                let _ = tokio::fs::remove_file(&part).await;
                return Err(anyhow!(e).context("The download stopped partway"));
            }
        };
        file.write_all(&chunk).await?;
        received += chunk.len() as u64;
        if last.elapsed() >= Duration::from_millis(200) {
            last = Instant::now();
            let _ = app.emit("download", DownloadProgress { item_id, received, total });
        }
    }
    file.flush().await?;
    drop(file);
    if received == 0 {
        let _ = tokio::fs::remove_file(&part).await;
        return Err(anyhow!("The podcast's server sent an empty file"));
    }
    let _ = app.emit("download", DownloadProgress { item_id, received, total: Some(received) });
    let dest = dir.join(format!("{item_id}.{}", extension(url, content_type.as_deref())));
    tokio::fs::rename(&part, &dest).await?;
    Ok((dest, received))
}

/// Downloads interrupted by quitting the app can't resume; they are marked failed on the next start.
pub fn fail_interrupted(conn: &Connection) -> Result<()> {
    conn.execute(
        "UPDATE items SET state = 'failed', error = 'The download was interrupted when Eksigo closed' WHERE state = 'downloading'",
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::podcasts::parse_feed;

    fn feed(n: usize) -> Feed {
        let items: String = (0..n)
            .map(|i| {
                format!(
                    r#"<item><title>Episode {i}</title><guid>g{i}</guid><pubDate>Mon, 0{} Nov 2025 06:00:00 +0000</pubDate>
                    <enclosure url="https://example.com/{i}.mp3" length="1000" type="audio/mpeg"/></item>"#,
                    i + 1
                )
            })
            .collect();
        parse_feed(format!(r#"<rss version="2.0"><channel><title>Show</title><description>d</description>{items}</channel></rss>"#).as_bytes()).unwrap()
    }

    fn listing() -> Listing {
        Listing {
            apple_id: Some("1".into()),
            title: "Show".into(),
            author: "Someone".into(),
            feed_url: Some("https://example.com/feed".into()),
            artwork_url: Some("https://example.com/a.jpg".into()),
            note: None,
        }
    }

    #[test]
    fn a_show_is_saved_once_and_refreshing_keeps_the_library() {
        let db = Db::open_in_memory().unwrap();
        let mut conn = db.conn();
        let id = save_listing(&conn, &listing()).unwrap();
        assert_eq!(save_listing(&conn, &listing()).unwrap(), id);

        save_feed(&mut conn, id, &feed(3)).unwrap();
        let eps = episodes(&conn, id).unwrap();
        assert_eq!(eps.len(), 3);
        assert_eq!(eps[0].title, "Episode 2", "newest first");
        assert_eq!(eps[0].artwork_url.as_deref(), Some("https://example.com/a.jpg"), "show art when the episode has none");

        let (item_id, new) = begin_download(&conn, eps[0].id).unwrap();
        assert!(new);
        assert_eq!(begin_download(&conn, eps[0].id).unwrap(), (item_id, false), "never downloaded twice");

        // A refresh with one more episode keeps the ids, so the Library still points at the same episode.
        save_feed(&mut conn, id, &feed(4)).unwrap();
        let eps = episodes(&conn, id).unwrap();
        assert_eq!(eps.len(), 4);
        let in_library = eps.iter().find(|e| e.item_id == Some(item_id)).unwrap();
        assert_eq!(in_library.title, "Episode 2");
        assert_eq!(in_library.item_state.as_deref(), Some("downloading"));

        let it = item(&conn, item_id).unwrap();
        assert_eq!((it.source.as_str(), it.show_id), ("Show", Some(id)));
    }

    #[test]
    fn subscribing_and_new_episodes() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let id = save_listing(&conn, &listing()).unwrap();
        assert!(subscribed(&conn).unwrap().is_empty());
        set_subscribed(&conn, id, true).unwrap();
        assert_eq!(subscribed(&conn).unwrap().len(), 1);
        assert!(show(&conn, id).unwrap().subscribed);
        set_subscribed(&conn, id, false).unwrap();
        assert!(!show(&conn, id).unwrap().subscribed);
    }

    #[test]
    fn own_files_are_added_once_and_never_deleted() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let dir = audio::tests::temp_dir("own");
        let wav = audio::tests::ramp_wav(&dir, 8_000, 2);
        let id = add_file(&conn, &wav, 2.0).unwrap();
        assert_eq!(add_file(&conn, &wav, 2.0).unwrap(), id);
        let it = item(&conn, id).unwrap();
        assert_eq!((it.source.as_str(), it.state.as_str(), it.own_file), (MY_FILES, "ready", true));

        assert_eq!(remove_item(&conn, id).unwrap(), None, "the learner's file stays");
        assert!(wav.exists());
        assert!(items(&conn).unwrap().is_empty());

        let id = add_file(&conn, &wav, 2.0).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(item(&conn, id).unwrap().state, "missing");
    }

    #[test]
    fn download_extensions() {
        assert_eq!(extension("https://x.com/a/ep.M4A?token=1", None), "m4a");
        assert_eq!(extension("https://x.com/play/123", Some("audio/mp4")), "m4a");
        assert_eq!(extension("https://x.com/play/123", Some("audio/mpeg")), "mp3");
    }
}
