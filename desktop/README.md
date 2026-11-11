# Eksigo desktop

Tauri 2 app for Windows and Mac: React and TypeScript interface in `src/`, Rust core in `src-tauri/`. Design: [DESIGN.md](../docs/DESIGN.md) sections 2–6; build order: [ROADMAP.md](../docs/ROADMAP.md).

## Setup

- Node 24, Rust (via [rustup](https://rustup.rs)) and CMake (`brew install cmake`; Windows: Visual Studio Build Tools with C++, CMake and LLVM)
- `npm install`

## Running

```bash
npm run tauri dev
```

Opens the app with hot reload: interface changes appear at once, Rust changes rebuild and reopen the window.

```bash
npm run dev
```

The interface alone at http://localhost:1420, in any browser. `src/lib/backend.ts` falls back to sample data there, so every screen works without the Rust side; transcription and file access only work in the app.

## Layout

| Path | What |
|---|---|
| `src/styles/tokens.css` | Colours, type and spacing (Linear tokens, plus the derived light theme) |
| `src/styles/app.css` | Shared components; class names match the design canvas |
| `src/components/Shell.tsx` | Sidebar, top bar, status bar, app-wide shortcuts |
| `src/lib/backend.ts` | Every call to the Rust core; `src/lib/sample.ts` stands in for it in a browser |
| `src/pages/` | One file per screen: Podcasts, Show, Episode, Library, Settings |
| `src-tauri/src/db.rs` | SQLite, with numbered migrations |
| `src-tauri/src/audio.rs` | Decoding MP3, M4A/MP4, WAV, FLAC and Ogg, from any point, exact to the sample |
| `src-tauri/src/player.rs` | Playback of an exact stretch at 0.7–1.5× with the pitch unchanged (Signalsmith Stretch) |
| `src-tauri/src/podcasts.rs` | Apple podcast search and charts, the *Good for learners* list (`data/learners.json`), RSS |
| `src-tauri/src/library.rs` | Shows, episodes and the Library in SQLite; downloads; the learner's own files |
| `src-tauri/src/models.rs` | The speech models, downloaded once and checked by SHA-256 |
| `src-tauri/src/transcribe.rs` | Background transcription in chunks, saved as it goes and resumed after quitting |
| `src-tauri/src/sentences.rs` | Timed words into sentences sized for dictation |
| `src-tauri/src/whisper.rs` | Which whisper.cpp build runs: Metal on Mac, CPU on Windows |

## Tests

```bash
cd src-tauri && cargo test
```

Three more tests need the network, an audio file or a sound device, so they only run when asked:

```bash
EKSIGO_TEST_AUDIO=~/Downloads/episode.mp3 cargo test -- --ignored --nocapture
```

They read every feed on the learners list, check that seeking in a real MP3 lands on the same samples as decoding from the start, and play a sentence at 0.7× through the speakers.

## Whisper benchmark

```bash
cd src-tauri && cargo run --release --bin whisper-bench -- <ggml-model.bin> <audio file>
```

Transcribes a file the way the app does (in chunks, split into sentences) and prints the sentences, how long the first ones took and the whole file's speed. `EKSIGO_WHISPER_CPU=1` turns off the GPU, to estimate a computer without one. CI runs it on macOS and Windows for every pull request and puts the timing in the job summary.

The app keeps its data (database, models, downloads) in the system's app data folder; Settings → About shows where.
