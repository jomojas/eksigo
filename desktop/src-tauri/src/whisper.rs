//! Speech to text with whisper.cpp. Day 1 only checks it builds and how fast it runs on this machine;
//! chunked background transcription with word timestamps comes on day 3.

use std::{path::Path, time::Instant};

use anyhow::{anyhow, Result};
use serde::Serialize;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::audio;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    /// Start and end in milliseconds from the start of the audio.
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchReport {
    pub audio_seconds: f64,
    pub decode_ms: u128,
    pub load_model_ms: u128,
    pub transcribe_ms: u128,
    /// Seconds of audio transcribed per second of work; above 1 is faster than real time.
    pub speed: f64,
    /// "Metal" on Mac, "CPU" elsewhere.
    pub backend: &'static str,
    pub threads: i32,
    pub segments: Vec<Segment>,
}

/// Setting `EKSIGO_WHISPER_CPU=1` turns the GPU off, to measure what a computer without one would get.
fn force_cpu() -> bool {
    std::env::var("EKSIGO_WHISPER_CPU").is_ok_and(|v| v == "1")
}

pub fn backend() -> &'static str {
    if cfg!(target_os = "macos") && !force_cpu() { "Metal" } else { "CPU" }
}

fn threads() -> i32 {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8) as i32
}

/// Transcribes a whole file with the given model and times each stage.
pub fn bench(model: &Path, audio_file: &Path) -> Result<BenchReport> {
    whisper_rs::install_logging_hooks();

    let t = Instant::now();
    let samples = audio::load_for_whisper(audio_file)?;
    let decode_ms = t.elapsed().as_millis();
    let audio_seconds = samples.len() as f64 / audio::WHISPER_RATE as f64;

    let t = Instant::now();
    let model_str = model.to_str().ok_or_else(|| anyhow!("the model path isn't valid text"))?;
    let mut ctx_params = WhisperContextParameters::default();
    if force_cpu() {
        ctx_params.use_gpu(false);
    }
    let ctx = WhisperContext::new_with_params(model_str, ctx_params)
        .map_err(|e| anyhow!("loading the speech model: {e}"))?;
    let mut state = ctx.create_state().map_err(|e| anyhow!("whisper state: {e}"))?;
    let load_model_ms = t.elapsed().as_millis();

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    let n_threads = threads();
    params.set_n_threads(n_threads);
    params.set_language(Some("en"));
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    let t = Instant::now();
    state.full(params, &samples).map_err(|e| anyhow!("transcribing: {e}"))?;
    let transcribe_ms = t.elapsed().as_millis();

    let segments = state
        .as_iter()
        .map(|s| Segment {
            // whisper.cpp timestamps are in 10 ms units.
            start_ms: s.start_timestamp() * 10,
            end_ms: s.end_timestamp() * 10,
            text: s.to_str_lossy().map(|t| t.trim().to_string()).unwrap_or_default(),
        })
        .collect();

    Ok(BenchReport {
        audio_seconds,
        decode_ms,
        load_model_ms,
        transcribe_ms,
        speed: audio_seconds / (transcribe_ms.max(1) as f64 / 1000.0),
        backend: backend(),
        threads: n_threads,
        segments,
    })
}
