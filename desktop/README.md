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
| `src/lib/backend.ts` | Every call to the Rust core |
| `src-tauri/src/db.rs` | SQLite, with numbered migrations |
| `src-tauri/src/audio.rs` | Decoding MP3, M4A, WAV, FLAC and Ogg to 16 kHz mono |
| `src-tauri/src/whisper.rs` | whisper.cpp (Metal on Mac, CPU on Windows) |

## Whisper benchmark

```bash
cd src-tauri && cargo run --release --bin whisper-bench -- <ggml-model.bin> <audio file>
```

`EKSIGO_WHISPER_CPU=1` turns off the GPU, to estimate a computer without one. CI runs it on macOS and Windows for every pull request and puts the timing in the job summary.

The app keeps its data (database, models, downloads) in the system's app data folder; Settings → About shows where.
