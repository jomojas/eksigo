# Eksigo for iPhone

The listening companion ([DESIGN.md](../docs/DESIGN.md) section 9): podcasts, the sentences missed in dictation on the
computer, and word review. SwiftUI, iOS 18+, no third-party packages. The screens are P01–P22 on the design canvas, in
the desktop's Linear style (light and dark).

## Run

Open `ios/Eksigo.xcodeproj` in Xcode, pick an iPhone simulator, press Run.

- **Try the screens without an account:** scheme → Run → Arguments → `-sample YES` fills the phone with made-up words
  and missed sentences, as if synced. `-tab review|discover|me` opens a tab; `-openReview YES` starts a review.
- **Sign in and sync without Apple or Google:** `ios/scripts/local-server.sh` runs the backend on this Mac with
  developer sign-in and points the simulator's debug build at it; then Me › Sign in to sync › *Developer sign-in
  (local server)*. `ios/scripts/local-server.sh off` points the app back at api.eksigo.com.
- **On your own iPhone:** `ios/scripts/run-on-phone.sh` builds and installs a 7-day build signed with a free Apple ID
  (no Sign in with Apple in that build).

## Test

```
xcodebuild test -project ios/Eksigo.xcodeproj -scheme Eksigo -destination 'platform=iOS Simulator,name=iPhone 17' -parallel-testing-enabled NO
```

The tests check that word review schedules exactly as the desktop's rs-fsrs (values from running the crate), the
review queue's rules, the sync bookkeeping (what is sent, what wins, another account), streaks, and the marking of
missed words. CI runs them on pull requests that change `ios/` (`.github/workflows/ios.yml`).

## Layout

| Folder | What |
|---|---|
| `App/` | The tabs, the theme (the desktop's tokens) and the shared pieces: rows, cards, buttons, cover art |
| `Sync/` | Sync records as Swift values, the record store (SwiftData), `Syncer` (`POST /v1/sync`), figures for streaks and history |
| `Review/` | FSRS (a port of rs-fsrs), the review rules, the Review tab and session |
| `Listen/` | The Listen tab, the missed-sentence player and list |
| `Playback/` | `PlaybackCenter` (episodes and missed sentences on one `AVPlayer`, downloads, lock screen), the players |
| `Discover/`, `Directory/` | Discover, search, show and episode pages; Apple's directory and charts, RSS, the learners list |
| `Me/` | Me, My words, a word, History, Progress, Settings, Downloads, Account |
| `Account/` | Sign in with Apple and Google, the session token in the Keychain |

## How it fits with the desktop

- Everything from the computer arrives as sync records (docs/API.md, "Sync"): words, reviews, missed sentences,
  practice and practice days. The phone keeps each record as it came, so fields it doesn't know survive its changes.
- The phone makes `listen` records (the latest listen to each episode), `review` records and `day` records for its own
  listening and review time. In a `word` it changes only the card, due date and level, and the sentence's `practisedAt`.
- A missed sentence plays from the phone's download when it is the computer's file (the size in `missed.bytes`), else
  from the stream; a download that differs shows the text only. Episodes with missed sentences download by themselves
  on Wi-Fi.
- Sync runs when the app opens or goes to the background, a few seconds after a review or a pause, and every ten
  minutes while it is open.
