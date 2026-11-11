pub mod audio;
pub mod compare;
pub mod db;
pub mod dictation;
pub mod library;
pub mod models;
pub mod player;
pub mod podcasts;
pub mod sentences;
pub mod transcribe;
pub mod whisper;

use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use db::Db;
use library::{Downloads, Episode, Item, Show};
use player::Player;
use podcasts::Listing;
use transcribe::Transcriber;

/// Errors cross to the interface as plain sentences.
type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    format!("{e:#}")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    os: &'static str,
    data_dir: String,
    schema_version: i64,
    whisper_backend: &'static str,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle, db: State<Db>) -> CmdResult<AppInfo> {
    let data_dir = app.path().app_data_dir().map_err(err)?;
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS,
        data_dir: data_dir.display().to_string(),
        schema_version: db.schema_version().map_err(err)?,
        whisper_backend: whisper::backend(),
    })
}

#[tauri::command]
fn get_setting(db: State<Db>, key: String) -> CmdResult<Option<String>> {
    db.get_setting(&key).map_err(err)
}

#[tauri::command]
fn set_setting(db: State<Db>, key: String, value: String) -> CmdResult<()> {
    db.set_setting(&key, &value).map_err(err)
}

// ---------- speech models and transcripts ----------

#[tauri::command]
fn models_list(app: AppHandle) -> CmdResult<Vec<models::ModelInfo>> {
    Ok(models::list(&transcribe::model_dir(&app).map_err(err)?))
}

/// Set to stop a model download from Settings.
#[derive(Default)]
struct ModelCancel(AtomicBool);

/// Downloads the speech model from Settings; progress arrives as `model-download` events.
#[tauri::command]
async fn model_download(app: AppHandle, cancel: State<'_, ModelCancel>) -> CmdResult<()> {
    cancel.0.store(false, Ordering::Relaxed);
    let dir = transcribe::model_dir(&app).map_err(err)?;
    let m = models::find(models::DEFAULT).map_err(err)?;
    let a = app.clone();
    let result = models::download(&dir, m, &cancel.0, &move |p| {
        let _ = a.emit("model-download", p);
    })
    .await;
    if let Err(e) = &result {
        let state = if cancel.0.load(Ordering::Relaxed) { "cancelled" } else { "failed" };
        let _ = app.emit("model-download", models::ModelProgress { id: m.id, received: 0, total: m.bytes, state, error: Some(format!("{e:#}")) });
    }
    result.map(|_| ()).map_err(err)
}

#[tauri::command]
fn model_cancel(cancel: State<ModelCancel>) {
    cancel.0.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn model_delete(app: AppHandle, id: String) -> CmdResult<()> {
    let m = models::find(&id).map_err(err)?;
    let path = models::path(&transcribe::model_dir(&app).map_err(err)?, m);
    if path.exists() {
        std::fs::remove_file(path).map_err(err)?;
    }
    Ok(())
}

/// Transcribes a Library item in the background, ahead of anything else waiting.
#[tauri::command]
fn transcribe(transcriber: State<Transcriber>, item_id: i64) {
    transcriber.request(item_id, true);
}

#[tauri::command]
fn transcribe_cancel(transcriber: State<Transcriber>, item_id: i64) {
    transcriber.cancel(item_id);
}

#[tauri::command]
fn transcript_status(db: State<Db>, item_id: i64) -> CmdResult<transcribe::Status> {
    transcribe::status(&db.conn(), item_id).map_err(err)
}

#[tauri::command]
fn transcript_sentences(db: State<Db>, item_id: i64) -> CmdResult<Vec<transcribe::StoredSentence>> {
    transcribe::sentences(&db.conn(), item_id).map_err(err)
}

// ---------- podcasts ----------

#[tauri::command]
fn podcasts_for_learners() -> Vec<Listing> {
    podcasts::for_learners()
}

#[tauri::command]
async fn podcasts_search(term: String, country: String) -> CmdResult<Vec<Listing>> {
    podcasts::search(&term, &country).await.map_err(err)
}

#[tauri::command]
async fn podcasts_chart(country: String, genre: Option<u32>) -> CmdResult<Vec<Listing>> {
    podcasts::chart(&country, genre).await.map_err(err)
}

/// Saves a show from search, charts or recommendations and returns its id, finding its feed first if needed.
#[tauri::command]
async fn show_open(db: State<'_, Db>, listing: Listing) -> CmdResult<i64> {
    let listing = match (&listing.feed_url, &listing.apple_id) {
        (Some(_), _) => listing,
        (None, Some(id)) => {
            let found = podcasts::lookup(id).await.map_err(err)?;
            Listing { feed_url: found.feed_url, artwork_url: listing.artwork_url.or(found.artwork_url), ..listing }
        }
        (None, None) => return Err("This show has no feed.".into()),
    };
    library::save_listing(&db.conn(), &listing).map_err(err)
}

/// Adds a show from a pasted RSS link; the feed is read first, so a wrong link is caught here.
#[tauri::command]
async fn show_add_feed(db: State<'_, Db>, url: String) -> CmdResult<i64> {
    let feed = podcasts::fetch_feed(&url).await.map_err(err)?;
    let listing = Listing {
        apple_id: None,
        title: feed.title.clone(),
        author: feed.author.clone(),
        feed_url: Some(url.trim().to_string()),
        artwork_url: feed.artwork_url.clone(),
        note: None,
    };
    let mut conn = db.conn();
    let id = library::save_listing(&conn, &listing).map_err(err)?;
    library::save_feed(&mut conn, id, &feed).map_err(err)?;
    Ok(id)
}

#[derive(Serialize)]
struct ShowPage {
    show: Show,
    episodes: Vec<Episode>,
}

fn show_page(db: &Db, id: i64) -> CmdResult<ShowPage> {
    let conn = db.conn();
    Ok(ShowPage { show: library::show(&conn, id).map_err(err)?, episodes: library::episodes(&conn, id).map_err(err)? })
}

/// The show as saved on this computer; instant, possibly out of date.
#[tauri::command]
fn show_get(db: State<Db>, id: i64) -> CmdResult<ShowPage> {
    show_page(&db, id)
}

/// Reads the show's feed again for new episodes.
#[tauri::command]
async fn show_refresh(db: State<'_, Db>, id: i64) -> CmdResult<ShowPage> {
    let url = library::show(&db.conn(), id).map_err(err)?.feed_url;
    let feed = podcasts::fetch_feed(&url).await.map_err(err)?;
    library::save_feed(&mut db.conn(), id, &feed).map_err(err)?;
    show_page(&db, id)
}

#[tauri::command]
fn show_subscribe(db: State<Db>, id: i64, on: bool) -> CmdResult<()> {
    library::set_subscribed(&db.conn(), id, on).map_err(err)
}

#[tauri::command]
fn shows_subscribed(db: State<Db>) -> CmdResult<Vec<Show>> {
    library::subscribed(&db.conn()).map_err(err)
}

#[derive(Serialize)]
struct EpisodePage {
    episode: Episode,
    show: Show,
    item: Option<Item>,
}

#[tauri::command]
fn episode_get(db: State<Db>, id: i64) -> CmdResult<EpisodePage> {
    let conn = db.conn();
    let episode = library::episode(&conn, id).map_err(err)?;
    let show = library::show(&conn, episode.show_id).map_err(err)?;
    let item = episode.item_id.map(|i| library::item(&conn, i)).transpose().map_err(err)?;
    Ok(EpisodePage { episode, show, item })
}

/// Starts downloading an episode into the Library and returns its Library item.
#[tauri::command]
fn episode_download(app: AppHandle, db: State<Db>, id: i64) -> CmdResult<i64> {
    let (item_id, url, started) = {
        let conn = db.conn();
        let (item_id, started) = library::begin_download(&conn, id).map_err(err)?;
        (item_id, library::episode(&conn, id).map_err(err)?.audio_url, started)
    };
    if started {
        let _ = app.emit("library", ());
        tauri::async_runtime::spawn(library::download(app.clone(), item_id, url));
    }
    Ok(item_id)
}

#[tauri::command]
fn download_cancel(downloads: State<Downloads>, item_id: i64) -> bool {
    downloads.cancel(item_id)
}

// ---------- the Library ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryPage {
    items: Vec<Item>,
    downloads_bytes: i64,
}

#[tauri::command]
fn library_items(db: State<Db>) -> CmdResult<LibraryPage> {
    let conn = db.conn();
    Ok(LibraryPage { items: library::items(&conn).map_err(err)?, downloads_bytes: library::downloads_bytes(&conn).map_err(err)? })
}

#[tauri::command]
fn library_item(db: State<Db>, id: i64) -> CmdResult<Item> {
    library::item(&db.conn(), id).map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Added {
    ids: Vec<i64>,
    /// Files that couldn't be added, with the reason.
    skipped: Vec<(String, String)>,
}

/// Adds the learner's own audio or video files. Each is opened first, so unplayable files are caught here.
#[tauri::command]
async fn library_add_files(app: AppHandle, paths: Vec<String>) -> CmdResult<Added> {
    let checked = tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|p| {
                let path = PathBuf::from(&p);
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
                let result = if !audio::EXTENSIONS.contains(&ext.as_str()) {
                    Err("not an audio or video file Eksigo can read".to_string())
                } else {
                    audio::duration(&path).map_err(|e| format!("{e:#}"))
                };
                (path, result)
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(err)?;

    let db = app.state::<Db>();
    let mut added = Added { ids: Vec::new(), skipped: Vec::new() };
    {
        let conn = db.conn();
        for (path, result) in checked {
            match result {
                Ok(d) => added.ids.push(library::add_file(&conn, &path, d).map_err(err)?),
                Err(reason) => added.skipped.push((path.display().to_string(), reason)),
            }
        }
    }
    let _ = app.emit("library", ());
    Ok(added)
}

/// Takes an item out of the Library; a downloaded episode's file is deleted, the learner's own files never are.
#[tauri::command]
fn library_remove(app: AppHandle, db: State<Db>, downloads: State<Downloads>, transcriber: State<Transcriber>, id: i64) -> CmdResult<()> {
    downloads.cancel(id);
    transcriber.cancel(id);
    let file = library::remove_item(&db.conn(), id).map_err(err)?;
    if let Some(f) = file {
        let _ = std::fs::remove_file(f);
    }
    let _ = app.emit("library", ());
    Ok(())
}

// ---------- dictation ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    attempt: dictation::Attempt,
    answers: Vec<dictation::Answer>,
}

/// Opens dictation of an item: the unfinished attempt, or a new one (`again` starts a new one regardless).
#[tauri::command]
fn dictation_start(app: AppHandle, db: State<Db>, item_id: i64, again: bool) -> CmdResult<Session> {
    let s = {
        let conn = db.conn();
        let attempt = dictation::start(&conn, item_id, again).map_err(err)?;
        let answers = dictation::answers(&conn, attempt.id).map_err(err)?;
        Session { attempt, answers }
    };
    let _ = app.emit("practice", ());
    Ok(s)
}

/// Saves the answer to sentence `idx`: "typed" or "shown" (the box compared with the original, the marks counted), or "ad".
#[tauri::command]
fn dictation_answer(
    app: AppHandle,
    db: State<Db>,
    attempt_id: i64,
    idx: i64,
    kind: String,
    typed: String,
    flags: Vec<compare::Flagged>,
    plays: i64,
    seconds: i64,
) -> CmdResult<dictation::Answer> {
    let kind = dictation::Kind::parse(&kind).map_err(err)?;
    let a = dictation::answer(&db.conn(), attempt_id, idx, kind, &typed, &flags, plays, seconds).map_err(err)?;
    let _ = app.emit("practice", ());
    Ok(a)
}

/// Leaves sentences `from..to` out of the score as an ad.
#[tauri::command]
fn dictation_mark_ads(app: AppHandle, db: State<Db>, attempt_id: i64, from: i64, to: i64, seconds: i64) -> CmdResult<()> {
    dictation::mark_ads(&db.conn(), attempt_id, from, to, seconds).map_err(err)?;
    let _ = app.emit("practice", ());
    Ok(())
}

#[tauri::command]
fn dictation_position(app: AppHandle, db: State<Db>, attempt_id: i64, position: i64, seconds: i64) -> CmdResult<()> {
    dictation::save_position(&db.conn(), attempt_id, position, seconds).map_err(err)?;
    let _ = app.emit("practice", ());
    Ok(())
}

#[tauri::command]
fn dictation_finish(app: AppHandle, db: State<Db>, attempt_id: i64) -> CmdResult<dictation::Summary> {
    let conn = db.conn();
    dictation::finish(&conn, attempt_id).map_err(err)?;
    let _ = app.emit("practice", ());
    dictation::summary(&conn, attempt_id).map_err(err)
}

#[tauri::command]
fn dictation_summary(db: State<Db>, attempt_id: i64) -> CmdResult<dictation::Summary> {
    dictation::summary(&db.conn(), attempt_id).map_err(err)
}

/// Every attempt at an item, newest first, for the Episode page.
#[tauri::command]
fn dictation_attempts(db: State<Db>, item_id: i64) -> CmdResult<Vec<dictation::Summary>> {
    dictation::summaries(&db.conn(), item_id).map_err(err)
}

/// Unfinished episodes, for the sidebar and Today.
#[tauri::command]
fn dictation_in_progress(db: State<Db>) -> CmdResult<Vec<dictation::InProgress>> {
    dictation::in_progress(&db.conn()).map_err(err)
}

// ---------- playback ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayArgs {
    id: u64,
    path: String,
    start_ms: u64,
    end_ms: Option<u64>,
    speed: f32,
}

/// Plays `startMs..endMs` (or to the end) at `speed`. Progress arrives as `playback` events carrying `id`.
#[tauri::command]
fn play(player: State<Player>, args: PlayArgs) {
    player.play(player::Request { id: args.id, path: args.path.into(), start_ms: args.start_ms, end_ms: args.end_ms, speed: args.speed });
}

#[tauri::command]
fn stop_playback(player: State<Player>) {
    player.stop();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db = Db::open(&dir.join("eksigo.db"))?;
            library::fail_interrupted(&db.conn())?;
            app.manage(db);
            app.manage(Downloads::default());
            let handle = app.handle().clone();
            app.manage(Player::new(move |e| {
                let _ = handle.emit("playback", e);
            }));
            app.manage(ModelCancel::default());
            let transcriber = Transcriber::start(app.handle().clone());
            // Transcripts interrupted by quitting carry on where they stopped.
            for item_id in transcribe::unfinished(&app.state::<Db>().conn())? {
                transcriber.request(item_id, false);
            }
            app.manage(transcriber);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            get_setting,
            set_setting,
            models_list,
            model_download,
            model_cancel,
            model_delete,
            transcribe,
            transcribe_cancel,
            transcript_status,
            transcript_sentences,
            podcasts_for_learners,
            podcasts_search,
            podcasts_chart,
            show_open,
            show_add_feed,
            show_get,
            show_refresh,
            show_subscribe,
            shows_subscribed,
            episode_get,
            episode_download,
            download_cancel,
            library_items,
            library_item,
            library_add_files,
            library_remove,
            dictation_start,
            dictation_answer,
            dictation_mark_ads,
            dictation_position,
            dictation_finish,
            dictation_summary,
            dictation_attempts,
            dictation_in_progress,
            play,
            stop_playback,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Eksigo");
}
