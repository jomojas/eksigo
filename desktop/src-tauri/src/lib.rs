pub mod audio;
pub mod db;
pub mod whisper;

use std::path::PathBuf;

use serde::Serialize;
use tauri::{Manager, State};

use db::Db;

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

/// Transcribes a file and times it. Runs off the main thread so the window stays responsive.
#[tauri::command]
async fn whisper_bench(model_path: String, audio_path: String) -> CmdResult<whisper::BenchReport> {
    tauri::async_runtime::spawn_blocking(move || {
        whisper::bench(&PathBuf::from(model_path), &PathBuf::from(audio_path))
    })
    .await
    .map_err(err)?
    .map_err(err)
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
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![app_info, get_setting, set_setting, whisper_bench])
        .run(tauri::generate_context!())
        .expect("error while running Eksigo");
}
