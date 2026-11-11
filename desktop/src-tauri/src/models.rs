//! The speech models: which exist, which are on this computer, and downloading one. A download is checked
//! against the model's SHA-256 before it is used, and goes to a mirror when Hugging Face can't be reached.

use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

use anyhow::{anyhow, bail, Context, Result};
use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

use crate::podcasts::HTTP;

pub struct Model {
    pub id: &'static str,
    /// What the learner sees: *Fast* or *Accurate*.
    pub name: &'static str,
    pub file: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
    /// Not offered in v0.1.0 (ROADMAP.md: "Left out of v0.1.0").
    pub available: bool,
}

/// English-only models: learners practise English, and these are faster and more accurate at it.
pub const MODELS: &[Model] = &[
    Model {
        id: "base.en",
        name: "Fast",
        file: "ggml-base.en.bin",
        bytes: 147_964_211,
        sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
        available: true,
    },
    Model {
        id: "small.en",
        name: "Accurate",
        file: "ggml-small.en.bin",
        bytes: 487_614_201,
        sha256: "",
        available: false,
    },
];

pub const DEFAULT: &str = "base.en";

const SOURCES: &[&str] = &[
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/",
    // A mirror that is reachable from mainland China, where huggingface.co is blocked.
    "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/",
];

pub fn find(id: &str) -> Result<&'static Model> {
    MODELS.iter().find(|m| m.id == id).ok_or_else(|| anyhow!("unknown speech model {id}"))
}

pub fn path(dir: &Path, m: &Model) -> PathBuf {
    dir.join(m.file)
}

/// The model file, if it is on this computer and complete.
pub fn installed(dir: &Path, m: &Model) -> Option<PathBuf> {
    let p = path(dir, m);
    (std::fs::metadata(&p).ok()?.len() == m.bytes).then_some(p)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub bytes: u64,
    pub installed: bool,
    pub available: bool,
    pub path: String,
}

pub fn list(dir: &Path) -> Vec<ModelInfo> {
    MODELS
        .iter()
        .map(|m| ModelInfo {
            id: m.id,
            name: m.name,
            bytes: m.bytes,
            installed: installed(dir, m).is_some(),
            available: m.available,
            path: path(dir, m).display().to_string(),
        })
        .collect()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProgress {
    pub id: &'static str,
    pub received: u64,
    pub total: u64,
    /// "downloading", "done", "failed" or "cancelled".
    pub state: &'static str,
    pub error: Option<String>,
}

/// Downloads a model into `dir`, trying each source in turn. `progress` hears about it five times a second.
pub async fn download(dir: &Path, m: &'static Model, cancel: &AtomicBool, progress: &(dyn Fn(ModelProgress) + Sync)) -> Result<PathBuf> {
    if let Some(p) = installed(dir, m) {
        return Ok(p);
    }
    std::fs::create_dir_all(dir)?;
    let mut last_err = anyhow!("no download source");
    for source in SOURCES {
        match fetch(dir, m, &format!("{source}{}", m.file), cancel, progress).await {
            Ok(p) => return Ok(p),
            Err(e) if cancel.load(Ordering::Relaxed) => return Err(e),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

async fn fetch(dir: &Path, m: &'static Model, url: &str, cancel: &AtomicBool, progress: &(dyn Fn(ModelProgress) + Sync)) -> Result<PathBuf> {
    let part = dir.join(format!("{}.part", m.file));
    let res = HTTP.get(url).send().await.context("The model's server can't be reached")?.error_for_status()?;
    let mut file = tokio::fs::File::create(&part).await?;
    let mut stream = res.bytes_stream();
    let mut hash = Sha256::new();
    let mut received = 0u64;
    let mut last = Instant::now() - Duration::from_secs(1);
    let report = |received, state, error: Option<String>| progress(ModelProgress { id: m.id, received, total: m.bytes, state, error });

    let result: Result<()> = async {
        while let Some(chunk) = stream.next().await {
            if cancel.load(Ordering::Relaxed) {
                bail!("cancelled");
            }
            let chunk = chunk.context("The download stopped partway")?;
            hash.update(&chunk);
            file.write_all(&chunk).await?;
            received += chunk.len() as u64;
            if last.elapsed() >= Duration::from_millis(200) {
                last = Instant::now();
                report(received, "downloading", None);
            }
        }
        file.flush().await?;
        if received != m.bytes || hex::encode(hash.finalize()) != m.sha256 {
            bail!("The downloaded model is damaged; try again");
        }
        Ok(())
    }
    .await;
    drop(file);
    if let Err(e) = result {
        let _ = tokio::fs::remove_file(&part).await;
        return Err(e);
    }
    let dest = path(dir, m);
    tokio::fs::rename(&part, &dest).await?;
    report(received, "done", None);
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_model_exists_and_is_offered() {
        let m = find(DEFAULT).unwrap();
        assert!(m.available && m.sha256.len() == 64);
        assert!(find("large").is_err());
    }

    #[test]
    fn a_partial_file_is_not_installed() {
        let dir = std::env::temp_dir().join(format!("eksigo-models-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let m = find(DEFAULT).unwrap();
        std::fs::write(path(&dir, m), b"half a model").unwrap();
        assert!(installed(&dir, m).is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// Downloads the real model and checks it: `cargo test -- --ignored downloads_the_model`.
    #[tokio::test]
    #[ignore = "downloads 148 MB"]
    async fn downloads_the_model() {
        let dir = std::env::temp_dir().join(format!("eksigo-model-dl-{}", std::process::id()));
        let m = find(DEFAULT).unwrap();
        let reports = std::sync::Mutex::new(0);
        let t = std::time::Instant::now();
        let p = download(&dir, m, &AtomicBool::new(false), &|_| *reports.lock().unwrap() += 1).await.unwrap();
        println!("downloaded and checked in {:?} with {} progress reports", t.elapsed(), reports.lock().unwrap());
        assert_eq!(installed(&dir, m), Some(p));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
