//! Times Whisper on this machine without opening the app. Used by CI on macOS and Windows.
//!
//!     cargo run --release --bin whisper-bench -- <model.bin> <audio file>

use std::path::PathBuf;

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(model), Some(audio)) = (args.next(), args.next()) else {
        eprintln!("usage: whisper-bench <model.bin> <audio file>");
        std::process::exit(2);
    };

    match eksigo_lib::whisper::bench(&PathBuf::from(model), &PathBuf::from(audio)) {
        Ok(r) => {
            for s in &r.segments {
                println!("[{:>7.2}s] {}", s.start_ms as f64 / 1000.0, s.text);
            }
            println!();
            println!("backend      {} ({} threads)", r.backend, r.threads);
            println!("audio        {:.1} s", r.audio_seconds);
            println!("decode       {} ms", r.decode_ms);
            println!("load model   {} ms", r.load_model_ms);
            println!("transcribe   {} ms", r.transcribe_ms);
            println!("speed        {:.1}x real time", r.speed);
            if r.segments.iter().all(|s| s.text.is_empty()) {
                eprintln!("no text was recognised");
                std::process::exit(1);
            }
        }
        Err(e) => {
            eprintln!("error: {e:#}");
            std::process::exit(1);
        }
    }
}
