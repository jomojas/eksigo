//! Which whisper.cpp build runs here: Metal on Mac, the CPU elsewhere. The transcription itself is in transcribe.rs.

/// Setting `EKSIGO_WHISPER_CPU=1` turns the GPU off, to measure what a computer without one would get.
pub fn force_cpu() -> bool {
    std::env::var("EKSIGO_WHISPER_CPU").is_ok_and(|v| v == "1")
}

pub fn backend() -> &'static str {
    if cfg!(target_os = "macos") && !force_cpu() { "Metal" } else { "CPU" }
}

pub fn threads() -> i32 {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8) as i32
}
