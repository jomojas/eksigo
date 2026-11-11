# Eksigo — Design

An open-source English listening practice system for learners (Chinese speakers first; the interface also in Japanese, Korean, Spanish and French):
- **Desktop app (Windows and Mac): dictation.** At night, the learner settles in and dictates an episode they listened to that day, sentence by sentence, then reviews their mistakes. Transcription runs on the computer, so the core is free.
- **iPhone app: listening companion.** By day, a free podcast player. It also plays back last night's missed sentences and reviews saved words.
- **Server:** accounts, sync of small text between the two, and an optional Premium that runs the AI for learners who don't want to bring their own API key.

Status: redesigned 2026-11-10. The previous design (Breakdown on the iPhone, built until 2026-11-08) lives in the private repository `jomojas/english-audio-breakdown` (tag `v1-breakdown`, design in its `docs/archive/DESIGN-v1.md`). This repository starts fresh: v1 code is copied over only where it still fits (section 13, step 1). Decisions go here before any code is written.

---

## 1. Why the change

The owner used the iPhone app every day and found that Breakdown is not real practice:
- **Focus.** People listen while commuting or walking, when they can't concentrate. Explaining every hard sentence doesn't help if the listener isn't really listening.
- **Accuracy.** The LLM has to guess which sentences are hard for this listener, and that guess was often wrong.

Dictation fixes both. The learner sits down at night, plays each sentence and types what they heard. Their own mistakes show what they can't hear, so nothing has to be guessed. Typing needs a keyboard and a desk, so this belongs on a laptop. Dictation also works better on an episode the learner already knows: they have heard it during the day, know what it's about and roughly where they got lost.

So:
- **Day, on the phone:** listen to episodes you choose. Review last night's mistakes and saved words.
- **Night, on the laptop:** dictate today's episode, review the mistakes, practise speaking, save words.

Many desktop dictation apps exist, so making money is not the goal. The project becomes open source, and an optional Premium covers the AI and server costs (section 6).

---

## 2. Desktop app: the workflow

**Platforms:** Windows and Mac, built with **Tauri 2** (TypeScript and React interface, Rust core). It is lighter than Electron, and the Rust side runs whisper.cpp and keeps API keys in the system's secure store. Code in `desktop/`.

**The desktop app works on its own.** It has its own podcast search, RSS and downloads, so the phone is a bonus, not a requirement. Android users with a Windows or Mac computer lose only the daytime sync.

**First launch (about one minute):**
1. Interface language, the same languages as the iPhone app.
2. Speech model download: *Fast* (about 150 MB) or *Accurate* (about 500 MB–1.5 GB). Changeable later.
3. AI: *None for now* / *Use my own key* / *Eksigo Premium*. Everything except the AI features in section 5 works with *None*.
4. Sign-in, optional, only for syncing with the phone. Apple or Google, the same accounts as the iPhone app. Sign in with Apple on Windows uses Apple's web sign-in (needs a Services ID and a return URL on the server).

**Navigation (decided 2026-11-10).** Sidebar: Today, Podcasts, Library, My words, Progress, then an *In progress* list of unfinished episodes, and Settings at the bottom. Every piece of audio lives in the Library, so Dictation is not a sidebar item: it opens from Today, Podcasts, the Library or *In progress*, the sidebar keeps **Library** selected, and the top bar shows the path (`Library / show / episode`).
- **Today:** Continue, episodes heard on the phone today (needs sign-in), new episodes from subscriptions. Each has **Practise**.
- **Podcasts:** search (Apple podcast directory) or paste an RSS link; *Your shows*; recommendations (*Good for learners*, a short list we choose, plus Apple's top charts by country and category). → **Show** page: description, Subscribe, the episode list with each episode's practice status. → **Episode** page.
- **Library:** everything that can be practised: downloaded episodes **and the learner's own audio or video files** (Add audio or drag and drop; MP3, M4A, WAV, MP4; they stay on the computer and are transcribed by local Whisper). Each row shows the source, length, progress (*Not started*, *31/100*, *Finished*), accuracy and when it was last practised. Filters replace a separate History page.
- **Episode page** (the same page from Podcasts or the Library): **Start**, **Resume at sentence 32** or **Practise again**, **Preview**, and every past attempt with its results.
- **Practise** on an episode that isn't downloaded downloads it and opens Dictation; transcription starts in the background.
- **Settings** is a page in the main area, like VS Code (`Ctrl+,`), with its own section list and search; changes save as they are made.

**Starting an episode:** dictation starts after about 30 seconds while transcription continues in the background (section 3).

**Playback, saved as defaults and changeable during a session:**
- **Mode.** *Manual* (default): each sentence plays once; the learner presses `Tab` to hear it again, up to the maximum. The next sentence never starts by itself. *Auto*: the sentence plays the maximum number of times in a row with a pause between plays.
- **Speed:** 0.7 to 1.5 (0.85, 1.0, 1.2 …).
- **Maximum plays per sentence:** 1 to 5. The learner can move on before using them all; a counter shows "1 / 3".
- **Pause between plays:** Auto mode only.
- **Show the original text:** *when I stop or finish* (default), or after every sentence.

**The dictation loop, one sentence at a time.** Built for the keyboard:

| Key | Action |
|---|---|
| `Tab` | Play the sentence, or play it again (up to the maximum) |
| `Enter` | A new line in the typing box |
| `Shift+Enter` | Finish this sentence and go to the next |
| `Shift+Tab` | **I know this one**: fill in the sentence and move on |
| `Ctrl+R` | Play again, slower |
| `Ctrl+←` / `Ctrl+→` | Previous or next sentence |
| `Ctrl+K` | Skip section: mark the following sentences as an ad, leave them out of the score |
| `_` or `...` | A gap in a partly understood sentence ("I _ to the store") |
| `Esc` | Stop (see below); also leaves the typing box |
| `Ctrl+\` | Focus mode: hide the sidebar and the side panel |

(On Mac, `Cmd` instead of `Ctrl`.) Inside the typing box `Tab` is used for playback, so `Esc` is the way out for keyboard navigation.

**Stopping partway.** `Esc` or Stop asks: **See the results so far** (default) or **Save and continue later**. Progress is saved either way, and seeing partial results doesn't end the episode: the learner can resume at the next sentence, and the results grow.

**Results: the original and the learner's text side by side**, sentence by sentence like a split diff, each row with a play button. Words the learner missed are marked in the original; wrong words are red in the learner's text. Above: accuracy, sentences done, known, with mistakes, time; a filter for sentences with mistakes; **Resume** and **Practise these again**. The same results open later from the Episode page.
- **Selecting a word or phrase** in either column shows its offline dictionary meaning and pronunciation, **Add to My words** (`A`), and later, with an AI key, *Explain in this sentence*.
- Later: mark **"the transcript is wrong here"** (doesn't count against the learner), adjust a sentence's start or end, merge or split sentences.
- Later: **mistakes grouped by rules, without AI**: dropped small words (weak forms: *to, of, have, can*), numbers, names, similar-sounding words (*can/can't, fifteen/fifty*, from a pronunciation dictionary), dropped endings (*-ed, -s*).
- *(AI, optional)* a written review in the learner's language (section 5).

**My words.** Each saved word or phrase keeps its meaning, every sentence it was heard in (with the original audio and what the learner typed) and a level: *New → Learning → Familiar → Known*, moved by spaced repetition (FSRS, shared with the iPhone), or **I know this** to take it out of practice. **Practice, without AI:**
1. **Listen and type** (default): hear the original sentence with the word missing and type it; checked exactly.
2. **Listen and recall:** hear it, recall the meaning, reveal it, grade *Again / Hard / Good / Easy*.
3. **Pick the meaning:** four choices, the wrong ones taken from the learner's other words.
Checking a typed translation needs an LLM, so it can only come later, as an AI feature.

**Speaking, after the review, optional:**
- **Shadowing:** play a sentence, record yourself, then compare the two. Local Whisper turns the recording into text and shows which words came through clearly. Free.
- **Retell:** summarise the episode out loud. *(AI)* feedback on content and grammar, plus a better version.

**Progress:** a year grid like GitHub's (a square per day, darker for more minutes), the streak, minutes this week, accuracy over time, words known, and later the most common mistake types.

---

## 3. Transcription on the computer

- **Whisper on the laptop** (whisper.cpp): Metal on Mac, CPU, CUDA or Vulkan on Windows. Free, and the audio never leaves the computer. Word timestamps give the sentence splits.
- **Publisher's transcript first:** when the feed has one (`podcast:transcript`), it is usually more accurate than Whisper. It is aligned to the audio for timestamps.
- **Transcribe while dictating, not in advance.** Dictation is far slower than the audio, because each sentence plays 3–5 times and the learner types in between. Whisper on even a slow laptop runs at about real-time speed or faster. So the app transcribes the first minute, dictation starts, and Whisper stays ahead. The server does no work, and nothing has to run during the day.
- **Speed depends on the computer.** It's fast on Apple Silicon. On an old Windows laptop without a good graphics card it can be about as long as the episode. The learner chooses the model size: *Fast* or *Accurate*.
- **Premium only:** server transcription with Groq Whisper (about $0.04 per audio hour) for slow computers.
- **Not in the first version:**
  - **A shared transcript cache on the server.** It only helps when the audio file is identical (section 4), which mostly means podcasts without inserted ads.
  - **Transcribing on the iPhone.** iOS limits background work.

---

## 4. Ads and practice copies

**Ads.** Many large podcasts insert ads per download: the same episode URL returns a different file each time, with different ads of different lengths. Timestamps therefore fit only one file.
- **Rule: a transcript belongs to one exact audio file, not to an episode.** The app keeps a hash of the file with its transcript and with every synced missed sentence.
- **Whisper transcribes the ads too.** The `Tab` key makes them cheap to skip. `Ctrl+K` (*skip section*) marks a whole ad and leaves it out of the score and the review.
- **Later:** automatic ad detection. When two copies of the same episode exist, the parts that differ are inserted ads. Ads read by the host can't be detected this way.

**Practice copies.** A download is kept on purpose, not a temporary file:
- **The audio, the transcript and the attempts stay together.** The app never re-downloads silently, because a new download can have different ads.
- **States:** New / In progress / Done / Pinned. *Practise again* is a new attempt on the same copy, and progress over time is shown ("62% first time, 85% now").
- **Disk space:**
  - After download, the audio is converted to mono Opus at about 32 kbps: about 15 MB an hour instead of 50–60 MB, with no audible loss for speech.
  - Total disk use is shown, with an optional limit.
  - The storage folder can be changed, for example to an external drive.
- **Clean-up:** after N days, the audio of finished, unpinned episodes is deleted. The transcript, attempts and saved words are kept, because they are tiny.
  - Practising a cleaned-up episode again downloads and transcribes it again.
  - Old results are matched to it **by text, not by time**.

---

## 5. Free features and AI features

**Free, on the device or with tiny server use:**

| Feature | How |
|---|---|
| Podcast search, RSS, download, playback | Apple podcast directory and RSS feeds |
| Transcription and sentence splits | Whisper on the computer, or the publisher's transcript |
| The whole dictation loop | Local |
| Word-by-word comparison and accuracy | A word alignment (diff) in the app |
| Mistakes grouped by type | Rules plus a pronunciation dictionary |
| Basic word meanings | An offline dictionary in the app (ECDICT for Chinese is free; dictionaries for the other languages still to be found) |
| My words, history, progress, streaks | Local |
| Shadowing with the speech check | Local Whisper |
| Ad skipping, library management | Local |
| Sync with the phone | Our server, small amounts of text (section 7). Free, because the phone needs it |
| Phone: missed-sentence playlist, spaced-repetition word review | On the phone |

**AI features (the learner's own key, or Premium):**

| Feature | What the AI adds | Rough cost per use* |
|---|---|---|
| Episode review | Why sentences were misheard (linking, reductions), patterns, phrases to memorise | under $0.01 |
| Word or phrase in context | Its meaning in this sentence, usage, examples, in the learner's language | ~$0.0005 |
| Sentence explanation and translation | For a sentence still not understood after seeing the answer | ~$0.001 |
| Retell feedback | Score, grammar corrections, a better version | ~$0.002 + transcription |
| Weekly report | Across sessions: what's improving, what to focus on | ~$0.005 |
| Server transcription (Premium only) | Groq Whisper for slow computers | ~$0.04 per audio hour |

\*Rough figures at DeepSeek-class prices (2026-11-10). They need checking before the Premium price is set.

Only the aligned mistakes go to the AI, never the whole transcript. That keeps it cheap and its answers reliable.

---

## 6. AI access and Premium

- **One rule: every AI feature works for free with the learner's own key. Premium only means no key is needed**, plus server transcription. Nothing is locked behind payment that a key wouldn't unlock.
- **Bring your own key:**
  - Supported providers: OpenAI, DeepSeek, Anthropic, Groq, or any OpenAI-compatible endpoint.
  - The app calls the provider directly, and the key never reaches our server.
  - Keys are stored in the macOS Keychain or the Windows Credential Manager, never in a plain file.
  - A *Test key* button checks the key, and the app shows the estimated cost per episode.
- **One AI client:** our server acts as one more OpenAI-compatible provider, *Eksigo (Premium)*. Choosing it changes only the URL and uses the login token instead of a key, so there is one code path to test.
- **Premium is sold only on the web**, through a merchant of record (Paddle or Lemon Squeezy) that handles VAT and sales tax. Not in the iPhone app:
  - All AI is on the desktop now, and one payment channel means one webhook and one refund flow.
  - A free iPhone app doesn't need the Paid Apps Agreement, which also removes the W-8BEN and bank-detail blocker.
  - Apple requires in-app purchase for digital features unlocked inside an app, so **nothing in the iPhone app may depend on Premium**. Word meanings on the phone show what was saved on the desktop and never make a new AI call.
- **Price, proposed:** about **$3 a month or $24 a year**, with a generous allowance, for example 60 episode reviews, 1,000 word explanations, 30 retells and 10 hours of server transcription. A very active learner costs about $0.50–1.50 a month, mostly server transcription. Pay-as-you-go credit is the alternative. The $30 monthly AI budget cap stays.
- **Removed:** the iPhone subscription `com.eksigo.app.premium.monthly` and its server verification (v1 design, "Premium and payments") are not carried over from v1. The two TestFlight testers don't need moving (decided 2026-11-10).

---

## 7. Sync and the server

The VPS is small (2 vCPU, 4 GB RAM, 40 GB SSD), so **the server stores only small text, never audio**, and the heavy work runs on the learners' own devices.
- **What syncs** (only with an account):

  | Data | Size per item |
  |---|---|
  | Listening history: episode URL, position, date | ~100 bytes |
  | Saved word or phrase: word, meaning, example sentence, episode, timestamp | ~300–500 bytes |
  | Missed sentence: episode URL, file hash, start and end, transcript text, what was typed | ~300 bytes |
  | Practice summary: episode, date, accuracy | ~100 bytes |

  A heavy learner with 3,000 words and 5,000 missed sentences needs about 3 MB.
- **Only changes are sent.** Each device keeps a "last synced" marker and asks for what changed since then: one request when the app opens and one after a session. That's a few requests per user per day.
- **Audio, transcripts and attempts stay on each device.**
- **Accounts stay optional on both apps.** Listening on the phone and dictating on the desktop need no account. It is asked for only to turn on sync or Premium.
- **What the server does in total:**
  - accounts
  - sync
  - Premium: passes AI requests on to the provider, plus Groq transcription
  - later, maybe, the shared transcript cache
- **Not carried over from v1:** the breakdown pipeline, TTS, the lesson manifest and the scheduled ingestion (v1 design, sections 5–9). Their stored clips on the VPS are deleted. Backups of `app.db` must also be copied off the VPS.

---

## 8. Accounts (decided 2026-11-10)

Accounts stay **optional** on every app. Listening on the phone and dictating on the desktop need none. An account is asked for only to turn on sync (section 7) or Premium (section 6).
- **Sign in with Apple or Google**, the same accounts on the phone and the desktop.
  - **iPhone:** the native sheets, as built (v1 design, "Accounts").
  - **Desktop:** the system browser opens the provider's web sign-in and returns to the app. Sign in with Apple on the web needs a Services ID and a return URL set up in the Apple developer account; Google needs a desktop OAuth client.
- **How it works:** the provider's identity token goes to the server (`POST /v1/auth/apple`, `POST /v1/auth/google`). The server checks it, finds or creates the user, and returns an opaque session token. Sessions unused for 180 days expire.
- **Where the session token lives:** the iPhone Keychain (this device only), and the macOS Keychain or Windows Credential Manager on the desktop. Never in a plain file.
- **What the server stores:** the provider's user ID, the e-mail it shares, the name, the plan and the AI allowance use, plus the synced data in section 7.
- **Sign out and delete:** in Settings on each app. Deleting removes the user, sessions, allowance use and synced data from the server (App Store guideline 5.1.1(v)). Still to do: revoke the Apple token on deletion, which needs a Sign in with Apple private key.

---

## 9. iPhone app: listening companion (later, after the desktop MVP)

Free, with no AI and no in-app purchase.
- **Podcast player**, as today. Listening history syncs and becomes *Today* on the desktop.
- **Missed-sentence playlist:** last night's mistakes, played back to back with their text, for the commute. How the phone finds the sentence in its own copy:
  1. **The file hash matches:** play the exact timestamps. This is common for podcasts without inserted ads.
  2. **The hash differs:** search the phone's copy near the expected time with a small audio fingerprint of the sentence (about 3 seconds, about 100 bytes, synced with the sentence). Added later.
  3. **No match, or the episode is not on the phone:** show the text and what was typed, without audio.
- **Word review with spaced repetition:** cards from the desktop sessions, each with its original sentence and audio (FSRS scheduling, on the phone).
- **My words, history and progress**, view only.
- **Removed:** Breakdown, AI speaking practice, transcripts made by AI, the level test that tunes breakdowns, free breakdown lessons, and the Premium purchase and paywall.
- A read-only web page at eksigo.com for My words and history could cover Android users later.

---

## 10. Open source and distribution

- **Licenses, proposed:**
  - **MIT** for `ios/`, `desktop/` and `site/`. GPL-style licenses conflict with App Store distribution.
  - **AGPL** for `backend/`, so anyone who runs a changed copy of the server as a service must publish their changes.
- **The name and icon stay the owner's.** A trademark note says that forks must use another name and icon.
- **Contributions:** a `Signed-off-by` line on each commit (Developer Certificate of Origin). No CLA.
- **The README says it plainly:**
  - the apps are free
  - with your own key, everything works without an account
  - Premium is an optional hosted service that pays for the server and AI and funds the project
- **Before the repo goes public:**
  - This repository starts with a clean history (decided 2026-11-10). v1's history stays private.
  - Choose the licenses, then add `README.md`, the `LICENSE` files, `CONTRIBUTING.md` (DCO sign-off) and the trademark note.
  - Keep server addresses and operator details out of the repo: they live in GitHub secrets and on the VPS.
- **Distribution:**
  - **Builds:** GitHub Releases. A `tauri-action` workflow builds Mac and Windows on every tagged release. GitHub's build machines are free for public repos.
  - **Mac:** signed and notarised with the existing Apple Developer account, outside the Mac App Store, so no extra cost.
  - **Windows:** unsigned at first, with a note about SmartScreen's *More info → Run anyway*. Apply to the SignPath Foundation for free open-source code signing once there are users.
  - **Updates:** automatic, with Tauri's updater.
  - **Later:** `winget` and Homebrew.
- **Audio rights:** downloads are for the learner's own practice. Audio is never re-hosted or shared.

---

## 11. Repository layout

```
eksigo/
├── docs/
│   ├── DESIGN.md       # this file
│   └── API.md
├── backend/            # FastAPI: accounts, sync, Premium AI
├── desktop/            # Tauri 2 app for Windows and Mac (TypeScript + React, Rust)
├── ios/                # iPhone listening companion (SwiftUI)
└── site/               # eksigo.com
```

---

## 12. Deployment and release

### Repository
One Git repo with `backend/`, `desktop/`, `ios/` and `site/` side by side (section 11). An API change and the app change that uses it land in the same commit. GitHub Actions workflows use path filters, so backend CI only runs when `backend/` changes and iOS CI only when `ios/` changes.

### Development workflow (decided 2026-10-31)
Every change goes through a branch and a pull request; nothing is pushed to `main` directly.
1. Branch from an up-to-date `main`, named by kind: `feature/<short-name>` for something new, `fix/<short-name>` for a bug (also `docs/…`, `ci/…` when only those change).
2. Build it, write or update its tests, run them locally (backend: `uv run pytest -q`; app: `xcodebuild test` on the simulator), update DESIGN.md / API.md, commit and push the branch.
3. Open a pull request against `main`. CI (`.github/workflows/ci.yml`) runs on every pull request; each part runs only when its folder changed:
   - backend: `pytest` (`backend-test.yml`) when `backend/` changes.
   - ios: builds the app and runs its tests on an iPhone simulator (`ios.yml`, macOS runner, unsigned) when `ios/` changes.
   - `passed` sums them up. It is the one check `main` requires (a required check that never ran would block the merge, so the path filters are inside the workflow).
   Rules on `main` (2026-10-31): `passed` must succeed, and the branch must be up to date with `main`, so what was tested is exactly what `main` becomes (two open branches are each tested with the other once one is merged: GitHub's "Update branch" brings the newer `main` in and CI runs again).
   Before the merge, the branch's build is installed on the owner's phone (`ios/scripts/run-on-phone.sh` from the branch) to try it as a learner.
4. When CI passes, the owner reviews and merges the pull request (Claude never merges).
5. After the merge: delete the remote branch, switch to `main`, pull, and delete the local branch.
6. If `main` breaks anyway: revert the pull request (GitHub's Revert button), then fix it on a `fix/…` branch with a test for the bug. After a merge, both workflows run again on `main`, and the backend deploys only when its tests pass.
Merging into `main` deploys: the backend workflow builds the image and deploys to the VPS when `backend/` changed. The app is installed on the phone from `main` with `ios/scripts/run-on-phone.sh`.
Cost note: while the repository is private, GitHub counts macOS minutes ten times (public repositories get them free); the `ios` job runs only when the app changes and cancels an older run of the same branch.

### Backend (Docker + GitHub Actions)
```
push to main (backend/**)
  → GitHub Actions: run tests → build Docker image (linux/amd64) → push to GitHub Container Registry (ghcr.io)
  → SSH into the VPS → docker compose pull && docker compose up -d
```
- Registry: GitHub Container Registry (free private images, same login as GitHub). Docker Hub works too, but its free tier allows only one private repo.
- Build the image in Actions, not on the Mac: the Mac is ARM, the VPS is x86.
- `docker-compose.yml` on the VPS: `caddy` (HTTPS and the website) and `api` (FastAPI). Operator commands run inside `api`: `python -m app.admin users | plan | backup` (2026-11-10; v1's `pipeline` container is gone).
- **Volumes:** v2's database is in `eab_eksigo` (the compose project is still called `eab`, after the folder `/opt/eab`). v1's database stays in `eab_data` until it is deleted by hand. Switching steps: `backend/README.md`.
- Data lives in volumes, never in the image: the SQLite file (no audio is stored since section 7). Nightly SQLite backup to R2 or another off-site location.
- Secrets (OpenAI / DeepSeek keys): a `.env` file on the VPS only (mode 600), plus GitHub Actions secrets for the deploy SSH key. Never in the repo or the image.
- **VPS (decided 2026-10-17):** Ubuntu 26.04, 2 vCPU / 3.7 GB, `ubuntu` user with key-only SSH. Docker from Ubuntu's packages (`docker.io`, `docker-compose-v2`). `ufw` allows only SSH, 80 and 443. Stack lives in `/opt/eab`.
- **Domain (decided 2026-10-17):** `eksigo.com` from Cloudflare Registrar. The API is `https://api.eksigo.com`: an A record to the VPS, **DNS only** (not proxied), so Caddy gets the Let's Encrypt certificate itself. The apex and `www` are free for a later website.
- **Backups:** VPS crontab runs `python -m app.admin backup` at 03:00 UTC (keeps 14, logs to `/opt/eab/backup.log`). Copying them off the server is still open.
- **Image pull without a stored token:** the deploy job logs the VPS in to ghcr.io with the job's own short-lived `GITHUB_TOKEN` (`packages: read`), pulls, then logs out. No personal access token sits on the server. Containers that restart later reuse the image already pulled.
- The deploy job uses its own SSH key (not the developer's), so it can be revoked on its own.

### Website (decided 2026-10-25)
`https://eksigo.com` introduces the app and sends people to the App Store. It also holds the pages App Store Connect asks for: privacy policy, terms of use and support.
- **Static files in `site/`**, no build step: `index.html` (introduction), `privacy.html`, `terms.html`, `support.html`, one stylesheet and the images. Plain HTML loads fast in China; no web fonts or scripts from hosts that are blocked there.
- **Chinese first, English one tap away.** Each page carries both languages; the reader's browser language picks one and a switch in the header changes it (remembered on the device). Chinese learners are the audience; the English version is for App Review and everyone else.
- **Served by the same Caddy** on the VPS: `eksigo.com` serves `site/`, `www.eksigo.com` redirects to it. The deploy job copies `site/` to `/opt/eab/site` next to the Caddyfile, so a change to the site deploys like a backend change (the workflow also runs when `site/**` changes).
- **DNS (done by the owner in Cloudflare):** A records for `eksigo.com` and `www` to the VPS, **DNS only**, like `api`. Caddy gets the certificates itself.
- **App Store button:** until the app is in the store, it says "Coming soon to the App Store" and doesn't link anywhere. Once there's an App Store ID, it becomes the official "Download on the App Store" badge linking to `https://apps.apple.com/app/id<ID>`; the iPhone also shows Safari's Smart App Banner from the `apple-itunes-app` meta tag.
- **Support e-mail:** `support@eksigo.com`, forwarded to the owner by Cloudflare Email Routing (free, set up by the owner).
- **Privacy manifest** (to update in the cleanup: no purchases, no audio sent) (`ios/Eksigo/PrivacyInfo.xcprivacy`, 2026-11-05): no tracking; required-reason APIs `UserDefaults` (CA92.1) and file metadata through `attributesOfItem` (C617.1). Data collected, for app functionality only: name, e-mail, user ID, purchases and usage counts (linked to the account); audio and other content (not linked, not kept). **App Store Connect's privacy labels must say the same.** Using another required-reason API means adding it here.
- **Privacy policy facts** (keep in step with the code; the website's privacy page is rewritten for v2, section 13 step 1):
  - Accounts are optional; with one, the server keeps the provider's user ID, e-mail and name (with Apple the user may withhold them), the plan and allowance use.
  - Synced data (section 7): listening history, saved words, missed sentences as text and timestamps, practice summaries. No audio.
  - Audio, transcripts and attempts stay on the user's devices. Transcription runs on the computer.
  - With the user's own key, AI requests go straight from the desktop app to the chosen provider; our server never sees them or the key.
  - With Premium, AI requests and (for server transcription) audio pass through our server to the AI providers (DeepSeek or another LLM, Groq for transcription) and are not kept.
  - No ads, no tracking, no data sold. Deleting the account removes everything above from our server.

### iOS app
- Release flow: Xcode → Product → Archive → upload to App Store Connect → TestFlight (testers) → submit for review → release. Users get updates automatically from the App Store.
- Manual uploads from Xcode at first. Later, automate with Xcode Cloud (free monthly hours included in the Developer Program). GitHub-hosted macOS runners are expensive.
- Requires the Apple Developer Program ($99/yr). An individual account shows the developer's legal name as the seller.
- HTTPS only uses standard encryption, so set `ITSAppUsesNonExemptEncryption = NO` (no export paperwork).
- **Old app versions keep running for months.** The API must stay backward compatible: add fields, never remove or rename them. The manifest `version` field lets the app detect formats it doesn't understand. New episodes never need an app update.

### Countries
- A US developer account can publish to almost every App Store country. Availability is a checklist in App Store Connect (Pricing and Availability). Users install from their own country's store.
- **EU:** Apple requires a Digital Services Act "trader" declaration. A trader's address, phone and email are shown publicly in the EU store.
- **Mainland China:** not in the first release. The China App Store requires an ICP app filing, which needs a mainland Chinese company or ID holder and a mainland hosting provider. Apps using generative AI face extra rules. Podcast hosts and a London server are also slow or blocked there. Chinese speakers in Hong Kong, Taiwan, Singapore and abroad (and mainland users with non-mainland Apple IDs) can still install it. Revisit with a Chinese partner if mainland users become the main market.

### Desktop app
Releases go to GitHub Releases, built by a `tauri-action` workflow on every version tag: Mac signed and notarised, Windows unsigned at first (section 10). Tauri's updater checks GitHub Releases for new versions.

---

## 13. Desktop MVP and build order

The detailed milestones are in [ROADMAP.md](ROADMAP.md).


1. **New repository** (decided 2026-11-10). `jomojas/eksigo`, private until this step is done. Copy from v1 only what still fits, reviewing each part:
   - **server:** sign-in (Apple, Google), accounts, the database setup, Docker, deploy and CI
   - **iPhone:** the playback engine, RSS and podcast search, downloads, local storage, the sign-in client
   - **website:** `site/`, rewritten for v2 (privacy policy included)

   Point the VPS at the new server image and delete v1's clips and lesson data there. Choose the licenses, add the README and contribution files, then make the repo public.
2. **Visual design** (changed 2026-11-10): the Linear-style design system instead of the Claude brand: a dark, IDE-like look with a near-black canvas, grey surfaces and hairlines, one sparing accent, plus a derived light theme. Mockups of the desktop, iPhone and website screens are on the design canvas (https://claude.ai/artifact/9ZrDQTW2L9JBaDHDnwDC6f) and are agreed before code.
3. **Desktop MVP:**
   - podcast search and RSS
   - download as a practice copy
   - Whisper transcription while dictating
   - the dictation loop with all shortcuts
   - the end-of-episode review without AI
   - My words with the offline dictionary
   - the library
   - signed Mac and unsigned Windows builds on GitHub Releases
4. **AI with the learner's own key:** episode review, words in context, sentence explanation.
5. **Accounts and sync:** desktop sign-in, sync endpoints, *Today* from the phone's listening history.
6. **iPhone v2:** new screens on the reused engine (tabs: Listen, Discover, Review, Me); missed-sentence playlist (hash match first), spaced-repetition review, My words and history.
7. **Premium:** web checkout, *Eksigo (Premium)* as a provider, Groq transcription.
8. **Speaking:** shadowing, then retell with AI feedback.
9. **Later:**
   - audio fingerprint matching on the phone
   - automatic ad detection
   - the shared transcript cache
   - the web page for Android users
   - `winget` and Homebrew

---

## 14. Open questions

- **Accent colour:** Linear's lavender as in the design canvas, or Eksigo's own colour so the app doesn't look like Linear. Fonts: Inter and JetBrains Mono (free to bundle) stand in for Linear's own faces.
- **Licenses:** MIT plus AGPL as proposed in section 10, or one license for everything?
- **Premium:** a monthly plan or credit packs, the exact price and allowance. Check current AI prices first.
- **Offline dictionaries** for Japanese, Korean, Spanish and French speakers, with licenses that allow bundling.
- **Whisper models:** which sizes to offer. Test speed on an older Windows laptop.
- **Reading the publisher's transcript and aligning it to the audio:** how well it works across the formats feeds use (SRT, VTT, JSON, HTML).
- **iPhone release:** the next App Store submission is iPhone v2 (section 13, step 6), as an update to the same app record (`com.eksigo.app`). The free companion no longer needs the Paid Apps Agreement.
