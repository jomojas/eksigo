# Eksigo — Roadmap

The order we build v2 in, desktop first. It expands [DESIGN.md](DESIGN.md) section 13 into milestones small enough to finish, review and merge one at a time.

**How each milestone works:**
- One branch and one pull request per milestone, or a few smaller PRs for the big ones (marked below). Jomo reviews and merges.
- A milestone is finished when its *Done when* list works in the real app, its tests pass in CI, and the screens match the design canvas.
- Weeks are rough estimates for building with Claude. They are a guide for the order, not deadlines.

**Design reference:** the Linear-style canvas, https://claude.ai/artifact/9ZrDQTW2L9JBaDHDnwDC6f (dark by default, plus a derived light theme).

| # | Milestone | Rough time | Result |
|---|---|---|---|
| 0 | Design fixes | 1–2 days | Agreed screens and tokens |
| 1 | Desktop skeleton | 1 week | The app opens, with the shell and both themes |
| 2 | Podcasts and library | 1 week | Find, subscribe, download, play |
| 3 | Transcription | 1–2 weeks | Whisper on the computer, sentences with timings |
| 4 | Dictation loop | 2 weeks | The core practice works end to end |
| 5 | Review and progress | 1 week | End-of-episode review, Today, Progress |
| 6 | My words and dictionary | 1 week | Saving words with offline meanings |
| 7 | First launch and release | 1 week | **v0.1.0 on GitHub Releases** for Mac and Windows |
| 8 | Website v2 | 3–4 days | eksigo.com with the download buttons |
| 9 | AI with your own key | 1–2 weeks | Episode review, words in context |
| 10 | Accounts and sync | 2 weeks | *Today* from the phone, synced words |
| 11 | iPhone v2 | 3–4 weeks | The listening companion on the App Store |
| 12 | Premium | 1–2 weeks | Web checkout, AI without a key |
| 13 | Speaking | 1–2 weeks | Shadowing, then retell |

Milestones 0–7 are the **desktop MVP, about 9–10 weeks**. It works fully offline without an account, so it can ship before the server has any new work.

---

## 0. Design fixes

- Fix the small issues found on the canvas review.
- Settle the accent colour: keep Linear's lavender or choose Eksigo's own (DESIGN.md section 14).
- Freeze the tokens (dark and light) into one file that the desktop code imports.

**Done when:** the canvas is approved and the tokens file is ready.

## 1. Desktop skeleton

- Tauri 2 project in `desktop/`: React and TypeScript with Vite on the front, Rust core.
- Theme from the tokens: follows the system's light or dark setting, with a manual override in Settings.
- The shell from the canvas: sidebar, top bar with breadcrumbs, the right-hand panel and the status bar. Pages are empty states for now.
- Local storage: SQLite in the app's data folder, with migrations.
- Keyboard shortcut layer (`Ctrl` on Windows, `Cmd` on Mac) and the `Ctrl K` command menu.
- CI: lint, type check, `cargo test`, and a debug build on macOS and Windows for every PR.

**Done when:** the app opens on Mac and Windows, switches themes, and CI is green on both.

## 2. Podcasts and library

- Podcast search through the Apple podcast directory, adding an RSS feed by URL, subscriptions.
- Episode lists from the feeds, refreshed when the app opens.
- Download an episode as a practice copy (DESIGN.md section 4), with progress, pause and resume, and a file hash.
- Library table: episode, show, progress, status and disk use, with delete.
- Cover art through the existing `GET /v1/art` endpoint.
- Audio playback with exact start and end times and speed changes that keep the pitch.

**Done when:** you can find a podcast, download an episode and play any stretch of it at 0.7×–1.0×.

## 3. Transcription (two PRs)

- **First, a spike (2–3 days):** whisper.cpp from Rust with Metal on Mac and the CPU build on Windows. Measure speed for the *Fast* and *Accurate* models on an Apple Silicon Mac and an older Windows laptop. This decides which models to offer (open question in section 14).
- Model download from the first launch or Settings, checked by hash.
- Transcribe in chunks in the background with word timestamps, staying ahead of the dictation. Progress shows in the status bar and the library.
- Split into sentences from punctuation and pauses, and store them with start and end times.
- Use the publisher's transcript when the feed has one (`podcast:transcript`), aligned to Whisper's timings. If the alignment is not reliable yet, this part moves to *Later*.

**Done when:** a 30-minute episode is split into sentences, and dictation can start after about 30 seconds while the rest is transcribed.

## 4. Dictation loop (two or three PRs)

The core of the product. It gets the most tests.
- Plays per sentence (3 or 5), the gap between plays, speed and when to show the answer, saved as defaults.
- The typing box and all the shortcuts in DESIGN.md section 2: `Enter`, `Tab`, `Ctrl R`, `Ctrl ↓`, `Ctrl ←/→`, `Ctrl K`, and `_` for a gap.
- Word-by-word comparison without AI: normalising numbers, contractions, punctuation and case, then aligning the words. Missed words get the dashed box and misheard words the wavy underline.
- After each sentence: click words to save them, mark "the transcript is wrong here", adjust the start or end, merge or split sentences.
- Resume an episode where you stopped ("sentence 34 of 120").
- The right-hand panel: tonight's score, what you mishear, playback settings.

**Done when:** a whole episode can be dictated with the keyboard alone, and the comparison has unit tests for numbers, contractions and gaps.

## 5. Review and progress

- End-of-episode review: accuracy; known, partly understood and missed counts; the missed sentences with audio, the correct text and what was typed.
- Mistakes grouped by rules: weak forms, numbers, names, similar-sounding words (using a pronunciation dictionary such as CMUdict) and dropped endings.
- *Practise only these* and *Practise again later*.
- **Today** page: Continue, and episodes ready to dictate (the phone's history comes in milestone 10).
- **Progress** page: accuracy over time, minutes practised, streak and the most common mistake types.

**Done when:** finishing an episode leads to the review screen from the canvas, and its numbers show up in Progress.

## 6. My words and dictionary

- Download the offline dictionary for the learner's language from the existing `GET /v1/dictionaries` endpoint.
- My words: each saved word or phrase with its sentence, audio and episode, with search, delete and CSV export.
- Meanings from the offline dictionary when saving and in the list.

**Done when:** a word saved during dictation shows its meaning and can replay its sentence from My words.

## 7. First launch and release

- First launch: interface language, speech model, AI set to *None for now*. Sign-in waits for milestone 10.
- Settings: theme, playback defaults, speech model, storage folder and disk use.
- Interface text ready for translation, with English first.
- Release workflow with `tauri-action` on version tags: Mac signed and notarised, Windows unsigned, published to GitHub Releases, with Tauri's updater.
- **Before this milestone, decisions for Jomo:**
  - licenses (section 14), so the repo can be made public
  - an Apple **Developer ID Application** certificate and an app-specific password, added as GitHub secrets for notarisation

**Done when:** v0.1.0 installs from GitHub Releases on a clean Mac and a clean Windows machine, and the updater finds v0.1.1.

## 8. Website v2

- Rewrite `site/` from the canvas design: hero, how it works, features, pricing and download.
- Download buttons point at the latest GitHub release for Mac and Windows.
- Privacy policy updated for v2 (local audio, optional accounts, the learner's own AI key).

**Done when:** eksigo.com serves the new page and both download buttons work.

## 9. AI with your own key

- Settings → AI: provider (OpenAI, DeepSeek, Anthropic, Groq or any OpenAI-compatible URL), key stored in the Keychain or the Credential Manager, *Test key*, estimated cost per episode.
- One OpenAI-compatible client in the Rust core.
- Episode review, word or phrase in context, sentence explanation, all in the learner's language. Only the aligned mistakes are sent.

**Done when:** with a DeepSeek key, the AI review on the review screen and *Explain* on a word both work, and the key never appears in any file or log.

## 10. Accounts and sync (server and desktop)

- Desktop sign-in with Apple and Google through the system browser. Jomo sets up Apple's Services ID and return URL and Google's desktop OAuth client.
- Server: sync endpoints for listening history, saved words, missed sentences and practice summaries (section 7), with tests, in `backend/` and `docs/API.md`.
- Desktop syncs when it opens and after each session.
- *Today* shows the episodes listened to on the phone.

**Done when:** words saved on the desktop appear through the API for the same account, and history posted for the phone shows up in *Today*.

## 11. iPhone v2 (several PRs)

- Reuse v1's playback engine, RSS and search, downloads, storage and sign-in client.
- New screens from the canvas, with tabs Listen, Discover, Review and Me.
- Missed-sentence playlist (exact file match first), spaced-repetition word review (FSRS), My words, history and progress, all view only.
- Free, with no AI and no in-app purchase. TestFlight, then the App Store as an update to `com.eksigo.app`.

**Done when:** last night's missed sentences play on the phone the next morning, and the update passes App Store review.

## 12. Premium

- Web checkout through Paddle or Lemon Squeezy, with a webhook on the server.
- *Eksigo (Premium)* as one more provider: the server forwards AI requests within the allowance.
- Server transcription with Groq for slow computers.
- **Before this milestone:** the price and allowance (section 14), checked against current AI prices.

**Done when:** a test purchase turns on Premium, and the AI review works without a key.

## 13. Speaking

- Shadowing: record a sentence and compare it with local Whisper. Free.
- Retell: summarise the episode out loud, with AI feedback.

## Later

- Audio fingerprint matching on the phone
- Automatic ad detection
- The shared transcript cache
- A web page for My words and history for Android users
- `winget` and Homebrew
