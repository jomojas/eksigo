# Eksigo — Roadmap

The order we build v2 in, desktop first. It expands [DESIGN.md](DESIGN.md) section 13.

**Goal (decided 2026-11-10, widened 2026-11-12): ship desktop v0.1.0 once the basic functions are all in: dictation, My words with practice, Progress and the full Settings.** It is not urgent; Jomo tests each day's work while the next is built. Jomo directs each step; Claude builds it. One branch and one PR per day's work, reviewed and merged by Jomo.

**Design reference:** the Linear-style canvas, https://claude.ai/artifact/9ZrDQTW2L9JBaDHDnwDC6f. Each desktop screen is marked *v0.1* or *next*.

## v0.1.0 in eleven days

The riskiest parts come first: Whisper building on both systems, then the dictation loop.

| Day | Build | Done when |
|---|---|---|
| 1 | **Skeleton and the Whisper test.** Tauri 2 (React, TypeScript, Rust) in `desktop/`; design tokens with light and dark mode; the app layout (sidebar, top bar, status bar); SQLite; CI building on macOS and Windows. whisper.cpp linked from Rust with Metal on Mac and CPU on Windows, timed on a sample episode. | The app opens on both systems, CI is green, and Whisper transcribes a test file on both |
| 2 | **Podcasts and library.** Apple podcast search, add an RSS feed, the Show and Episode pages, download with progress, the Library with filters and delete, **adding your own audio or video files**, cover art via `GET /v1/art`, playing an exact stretch of audio at 1.0 / 0.85 / 0.7 without changing the pitch. | An episode can be found, downloaded and played sentence-sized |
| 3 | **Transcription.** The *Fast* model downloaded on first use; background transcription in chunks with word timestamps; sentence splitting; progress in the status bar. | Dictation can start about 30 seconds after starting a 30-minute episode |
| 4 | **Dictation loop.** Manual and Auto playback, speed and maximum plays; the typing box; `Tab` to play, `Shift Enter` to finish, `Shift Tab` for I know this one, `Ctrl D` to flag a sentence for the review (filter All · Flagged · With mistakes), `Ctrl P` to play past the maximum, `Ctrl R`, `Ctrl ←/→/↓`, `Ctrl K`, `_` for gaps, `Esc` to stop; word-by-word comparison; stop and resume. Speed 0.5–1.5 in 0.05 steps (`Ctrl −/=`); spelling mistakes count half (DESIGN.md). | A whole episode can be dictated with the keyboard alone; the comparison has unit tests |
| 5 | **Results and My words.** The side-by-side results (original and your text, missed and wrong words marked) after stopping or finishing, also from the Episode page; select words to look them up (the phrase, else each word; played as said or read slowly) and save them; My words list with meanings from the offline dictionary (`GET /v1/dictionaries`, Chinese built from ECDICT with phrases); a simple Today page (Continue and the library). | Stopping shows the results so far and resuming continues; a saved word shows its meaning |
| 6 | **Settings, complete.** The D12 sections v0.1 needs: Dictionaries (installed, size, update, remove), Storage (what takes the space and where it's kept; episodes are removed in the Library), Shortcuts (the full list), About (version, licences, credits); search across the sections. Practice time starts being recorded here, so Progress has data from the start. | Every Settings section on the canvas except AI and Account works |
| 7 | **Word levels and practice.** Levels New · Learning · Familiar · Known with the next practice date (D09); the Practice screen (D10): *Listen and type* (the saved sentence played as said, the word left as a gap), *Listen and recall* and *Pick the meaning*; grades Again · Hard · Good · Easy set the next date; *I know this*; "Practise 12 due" on My words and Today. | A saved word comes up for practice, its grade moves its level and next date |
| 8 | **Progress.** The D11 page: streak and best, time this week, accuracy this month, words known; the year grid by minutes (decided: no sentences switch; accuracy is dictation only), with the day's detail; accuracy over the last 12 weeks. *What you mishear most* stays for later. | A week of practice shows correctly on every part of the page |
| 9 | **First launch and release.** The welcome (D13): language, the speech model download, AI later (decided: two steps, the AI step comes with AI); `tauri-action` release workflow on version tags, Mac signed and notarised, Windows unsigned, drafts the owner publishes; the updater; the AGPL-3.0 license. | A test tag produces installable builds for both systems |
| 10 | **Listen (added 2026-11-13).** The Listen page (D07): the episode straight through, sentences hidden as bars until shown (`S`, or all with `Shift+S`), shown ones stay shown; `↑ ↓` between sentences; select words to look them up in the docked card and save them; listening time counts towards the streak. The Episode page offers Dictate and Listen side by side. | A learner can listen to an episode, show a sentence, save a word from it, and see the minutes on Today |
| 11 | **Test and ship.** Install on a clean Mac and Windows machine, fix what breaks, tag **v0.1.0**. Point the eksigo.com download buttons at the release. | v0.1.0 is on GitHub Releases and downloadable from eksigo.com |

### Left out of v0.1.0, added in the following weeks

- **First after v0.1.0 (decided 2026-11-12): a human-like voice for looking words up.** A neural voice (Kokoro, Apache 2.0) on api.eksigo.com, `GET /v1/speak?text=` returning audio for a selected word or phrase, each made once and kept; it replaces *Slow voice*, which uses the computer's own voice until then.

- **Then: machine translation for phrases (decided 2026-11-13).** When a selection isn't in the dictionary as a phrase, the card also shows a translation of the whole selection from a small model on the computer (HY-MT 1.5, or Qwen 2.5 in the EU, the UK and South Korea; DESIGN.md, *Results*), downloaded by itself when the app first opens.

- Publisher transcripts (`podcast:transcript`) and their alignment
- The *Accurate* speech model
- Mistakes grouped by type (weak forms, numbers, names, similar sounds, endings)
- Recommendations beyond the *Good for learners* list
- Adjusting, merging or splitting sentences, and "the transcript is wrong here"
- *What you mishear most* on Progress (needs mistakes grouped by type)
- Interface translations (English only at first)
- CSV export of My words
- The full website redesign (only the download buttons change on day 7)

### Jomo's part, as early as possible

- **Day 1:** the list of design fixes from the canvas, and the accent colour (keep lavender or choose another).
- **By day 9:** an Apple **Developer ID Application** certificate (exported as .p12) and an app-specific password, added as GitHub secrets for notarisation. Creating the certificate can take a day.
- **By day 9:** the license (AGPL-3.0, chosen 2026-11-12; the repo went public the same day), and the updater's signing key as two GitHub secrets.
- **Day 10:** a Windows machine for the install test (an older laptop, ideally, to check Whisper speed).

### Risks

- **Whisper on Windows** is the most likely to slip, which is why it is tested on day 1. If the CPU build is too slow, v0.1.0 ships with the smallest model for Windows.
- **Unsigned Windows builds** show a SmartScreen warning. The download page says how to get past it.
- If a day overruns, the next day's least important item moves to the list above rather than the release date moving.

---

# After v0.1.0

Rough times; the order can change with feedback from the first users.

**Order decided 2026-11-13:** accounts and sync, then the iPhone app (listen and review on the phone, practise on the computer), then the website and finding the first users. AI, Premium and the rest follow. **Changed the same day:** AI came right after accounts (sync follows), since ChatGPT Plus can be used without OpenAI's approval. Speaking is postponed (under *Later*). Video and YouTube are not planned (DESIGN.md, *Listen*).

## Website v2 (1–2 days)

- Rewrite `site/` from the canvas design: hero, how it works, features, pricing and download.
- Download buttons point at the latest GitHub release for Mac and Windows.
- Privacy policy updated for v2 (local audio, optional accounts, the learner's own AI key).

**Done when:** eksigo.com serves the new page and both download buttons work.

## AI (about 1 week)

- Done 2026-11-13: no approval was needed (open-source apps on the user's computer may use ChatGPT plans; DESIGN.md section 6).
- Settings → AI, in the order of DESIGN.md section 6: *Sign in with ChatGPT*, *Eksigo Premium* (comes with the Premium step), and under *Advanced* the learner's own key (OpenAI, DeepSeek, Anthropic, Groq, OpenRouter or any OpenAI-compatible URL), stored in the Keychain or the Credential Manager, with *Test key*. No Claude subscription login (not allowed by Anthropic).
- One AI module in the Rust core (`ai.rs`): the Responses API for ChatGPT, chat completions for OpenAI-compatible keys, Messages for Anthropic.
- Explain a word or phrase in its sentence when asked (`E`), and by itself only when the dictionary and the translator found nothing; *Ask about this sentence* (`?`) with *Why did I miss this?* by reason (new word, sounds different, didn't catch it, spelling, guessed) and the learner's own questions, answers shown as they're written; the episode review by the same reasons. All in the learner's language (redesigned 2026-11-13 after the first try: an AI call on every lookup was slow and unasked for).
- The model is *Automatic* (a small one), with a *Model* choice in Settings › AI.
- Still to do: fill in OpenAI's interest form for Premium.
- Later: *Practise these sentences* from the episode review (needs practising only some sentences of an episode).

**Done when:** with a DeepSeek key, the AI review on the review screen and *Explain* on a word both work, and the key never appears in any file or log.

## Accounts and sync, server and desktop (about 1 week)

- Desktop sign-in with Apple and Google through the system browser, and Settings › Account and sync, with sign out and delete account (done 2026-11-13). Jomo sets up Apple's Services ID and key and Google's Web application OAuth client (`backend/README.md`).
- Server: `POST /v1/sync` for saved words, word reviews, missed sentences, practice summaries, practice days and the phone's listening (section 7), with tests, in `backend/` and `docs/API.md` (done 2026-11-13).
- Desktop syncs when it opens, a few seconds after words or practice change, and every ten minutes; Settings › Account shows the state, with *Sync now* (done 2026-11-13, design D20).
- *Today* shows the episodes listened to on the phone (done 2026-11-13).

**Done when:** words saved on the desktop appear through the API for the same account, and history posted for the phone shows up in *Today*.

## iPhone v2 (2–3 weeks)

- Reuse v1's playback engine, RSS and search, downloads, storage and sign-in client.
- New screens from the canvas, with tabs Listen, Discover, Review and Me.
- Missed-sentence playlist (exact file match first), spaced-repetition word review (FSRS), My words, history and progress, all view only.
- Free, with no AI and no in-app purchase. TestFlight, then the App Store as an update to `com.eksigo.app`.
- The app, all 22 screens, with sync, missed sentences, word review (FSRS tested against the desktop's) and iOS CI (built 2026-11-13, `ios/`). Tried end to end against a local server: words and missed sentences from a pretend desktop arrive, play and are reviewed, and the reviews go back in the desktop's format.
- Next: a real sync between the desktop and the phone with one account, then TestFlight.

**Done when:** last night's missed sentences play on the phone the next morning, and the update passes App Store review.

## Premium (about 1 week)

- Web checkout through Paddle or Lemon Squeezy, with a webhook on the server.
- *Eksigo (Premium)* as one more provider: the server forwards AI requests within the allowance.
- Server transcription with Groq for slow computers.
- **Before this step:** the price and allowance (section 14), checked against current AI prices.

**Done when:** a test purchase turns on Premium, and the AI review works without a key.

## Later

- **Speaking (postponed 2026-11-13):** shadowing (record a sentence and compare it with local Whisper, free) and retelling the episode out loud with AI feedback.

- Audio fingerprint matching on the phone
- Automatic ad detection
- The shared transcript cache
- A web page for My words and history for Android users
- `winget` and Homebrew
