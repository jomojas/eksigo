//! Transcribes a file the way the app does (chunk by chunk, split into sentences) and times it, without
//! opening the app. CI runs it on macOS and Windows.
//!
//!     cargo run --release --bin whisper-bench -- <model.bin> <audio file>

use std::{path::PathBuf, time::Instant};

use eksigo_lib::{audio, transcribe, whisper};

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(model), Some(file)) = (args.next(), args.next()) else {
        eprintln!("usage: whisper-bench <model.bin> <audio file>");
        std::process::exit(2);
    };
    if let Err(e) = bench(&PathBuf::from(model), &PathBuf::from(file)) {
        eprintln!("error: {e:#}");
        std::process::exit(1);
    }
}

fn bench(model: &PathBuf, file: &PathBuf) -> anyhow::Result<()> {
    let audio_s = audio::duration(file)?;
    let t = Instant::now();
    let engine = transcribe::Engine::load(model, "bench")?;
    let load_ms = t.elapsed().as_millis();

    let t = Instant::now();
    let mut first_ms = None;
    let mut count = 0;
    let mut chunks = 0;
    transcribe::run(&engine, file, 0, "", |chunk| {
        first_ms.get_or_insert(t.elapsed().as_millis());
        chunks += 1;
        for s in &chunk.sentences {
            count += 1;
            println!("{:>4}  {:>7.2}–{:<7.2} {}", count, s.start_ms as f64 / 1000.0, s.end_ms as f64 / 1000.0, s.text);
        }
        Ok(true)
    })?;
    let total_ms = t.elapsed().as_millis();

    println!();
    println!("backend           {} ({} threads)", whisper::backend(), whisper::threads());
    println!("audio             {audio_s:.1} s");
    println!("load model        {load_ms} ms");
    println!("first sentences   {} ms", first_ms.unwrap_or(0));
    println!("whole file        {total_ms} ms in {chunks} chunks");
    println!("speed             {:.1}x real time", audio_s / (total_ms.max(1) as f64 / 1000.0));
    println!("sentences         {count}");
    if count == 0 {
        anyhow::bail!("no text was recognised");
    }
    Ok(())
}
