# Eksigo

English listening practice for learners, built on dictation.

- **Desktop app (Windows and Mac):** at night, dictate an episode you listened to that day, sentence by sentence, then review your mistakes. Transcription runs on your computer, so the core is free.
- **iPhone app:** by day, a free podcast player. It also plays back last night's missed sentences and reviews the words you saved.
- **Server:** optional accounts, sync between your devices, and an optional Premium that runs the AI for you if you don't want to bring your own API key.

Status: early. The design is in [docs/DESIGN.md](docs/DESIGN.md); decisions go there before code.

| Folder | What |
|---|---|
| `desktop/` | Tauri 2 app for Windows and Mac |
| `ios/` | iPhone listening companion (SwiftUI) |
| `backend/` | FastAPI server: accounts, sync, Premium AI |
| `site/` | eksigo.com |
| `docs/` | Design and API |
