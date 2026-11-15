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

**First launch (about one minute; v0.1 decided 2026-11-12):**
1. *Which language do you speak?* The language word meanings are shown in, your computer's language already chosen. The interface itself is English in v0.1; translating it comes later, and this step will then set both.
2. *The speech model:* Fast (150 MB), with Accurate shown as *Later* until it arrives. It downloads in the background, in the status bar, while the learner carries on; if it fails, the first transcription downloads it again.
3. Later: AI (*None for now* / *Use my own key* / *Eksigo Premium*), added as a step once there's AI to set up. Everything except the AI features in section 5 works without it.
4. Later: sign-in, optional, only for syncing with the phone. Apple or Google, the same accounts as the iPhone app. Sign in with Apple on Windows uses Apple's web sign-in (needs a Services ID and a return URL on the server).

The welcome shows once; the app remembers it in its own database, so updates don't show it again.

**Navigation (decided 2026-11-10).** Sidebar: Today, Podcasts, Library, My words, Progress, then an *In progress* list of unfinished episodes, and Settings at the bottom. Every piece of audio lives in the Library, so Dictation is not a sidebar item: it opens from Today, Podcasts, the Library or *In progress*, the sidebar keeps **Library** selected, and the top bar shows the path (`Library / show / episode`).
- **Today:** one large Continue card for the unfinished episode practised last (*Resume at sentence N*, `Enter`); the other unfinished ones are in the sidebar's *In progress*. Then *Heard on your phone today* (needs the phone app and an account, later) and *New from your shows*: from each subscribed show its newest episode not yet started, at most three, newest first, with **Practise** (downloads it and opens dictation). Subscribed feeds are read again once per run of the app when older than six hours. On the right, *This week*: the day streak, time practised, a bar for each of the last seven days (the day under the mouse, else today, is written out below), and My words (due, new to start today, started this week, *Practise N words*, `P`).
- **Podcasts:** search (Apple podcast directory) or paste an RSS link; *Your shows*; recommendations (*Good for learners*, a short list we choose, plus Apple's top charts by country and category). → **Show** page: description, Subscribe, the episode list with each episode's practice status. → **Episode** page.
- **Library:** everything that can be practised: downloaded episodes **and the learner's own audio or video files** (Add audio or drag and drop; MP3, M4A, WAV, MP4; they stay on the computer and are transcribed by local Whisper). Each row shows the source, length, progress (*Not started*, *31/100*, *Finished*), accuracy and when it was last practised. Filters replace a separate History page.
- **Episode page** (the same page from Podcasts or the Library): two ways in, **Dictate** (*Start dictation*, *Resume dictation at 32* or *Dictate again*) and **Listen** (`L`), each with a line saying what it is; the transcript's progress; and every past attempt with its results.
- **Practise** on an episode that isn't downloaded downloads it and opens Dictation; transcription starts in the background.
- **Settings** is a page in the main area, like VS Code (`Ctrl+,`), with its own section list and search; changes save as they are made. Sections (built 2026-11-12): General (theme), Dictation (the playback defaults), Speech model, Dictionaries (*Word meanings in*, and each language's dictionary downloaded, updated or removed), Storage (space taken by downloaded episodes, the speech model, dictionaries and the database, with the data folder; the learner's own files are never copied), Shortcuts (the full list, not yet changeable), About (version, credits and licences). AI and Account and sync are listed as *later*. The next sentence always waits for `Tab`; there is no setting to play it by itself.

**Starting an episode:** dictation starts after about 30 seconds while transcription continues in the background (section 3).

**Listen (decided 2026-11-13, design D07).** The everyday way in, for learners who aren't preparing for a test and won't type a whole episode. The episode plays straight through; its sentences are listed with the one being heard highlighted and kept in view, but **hidden by default**: each shows as grey bars, one per word and as long as the word, which darken as the words are spoken. The learner tests their ears first, then shows what they want to read.
- `S` (or the row's *Show*) shows or hides the sentence being heard; **Hidden · All shown** above the list (`Shift+S`) shows or hides them all. A sentence once shown **stays shown** as playback moves on. Hidden is the default every time; the choice isn't remembered.
- `↑ ↓` go to the sentence before or after and play it from its start; `R` replays the sentence; `Space` plays or pauses; `← →` 5 seconds; the speed as in dictation.
- Selecting words in a shown sentence opens the same dictionary card as the results, docked in the right panel; playback pauses while it's open and carries on when it closes. Words saved here keep their sentence and audio like any other, and are listed under *Saved while listening*.
- The panel also shows *Shown so far* and *Listened today*. Time listening counts towards the streak and Progress (kind `listening`), like dictation; accuracy stays dictation only.
- Opening a word's sentence from My words opens Listen there, with that sentence shown. No transcript yet: Listen starts it, and the audio plays meanwhile.
- **Not planned (decided 2026-11-13):** video and YouTube. Browser tools such as Language Reactor already do subtitles on YouTube and Netflix well; Eksigo's part is training the ear with podcasts, dictation and the learner's own mistakes.

**Playback, saved as defaults and changeable during a session (decided 2026-11-11):**
- **Mode.** *Manual* (default): each sentence plays when the learner presses `Tab`, again up to the maximum. *Auto*: one `Tab` plays the sentence the maximum number of times in a row, with a pause between plays. In both modes the next sentence never starts by itself: it waits for `Tab`.
- **Speed:** 0.5× to 1.5× in steps of 0.05, with a slider and `Ctrl −` / `Ctrl =` (one step slower or faster), `Ctrl 0` back to 1.0×. A change applies at once, to the sentence playing. (The Episode page's Preview keeps its four listening speeds.)
- **Maximum plays per sentence:** 1 to 5. The learner can move on before using them all; a counter shows "1 / 3". Each sentence keeps its own count when moving back and forth. The maximum is a reminder, not a wall: `Ctrl+P` plays it anyway, the counter shows "4 / 3 · 1 over", and the results show the plays over the limit.
- **Pause between plays** (Auto only): either as long as the sentence times 1, 1.5 or 2 (long sentences get more typing time), or a fixed 1–10 seconds.
- **Slower** (`Ctrl R`): plays the sentence once at a slow speed, 0.75× by default, without changing the speed setting; at or below that speed already, 0.15 slower. It counts as one of the plays.

**The dictation loop, one sentence at a time.** Built for the keyboard:

| Key | Action |
|---|---|
| `Tab` | Play the sentence, or play it again (up to the maximum) |
| `Ctrl+P` | Play anyway, past the maximum |
| `Ctrl+D` | Flag this sentence for the review, or take the flag off |
| `Enter` | A new line in the typing box |
| `Shift+Enter` | Finish this sentence and go to the next |
| `Shift+Tab` | **I know this one**: move on without typing; counts as correct |
| `Ctrl+R` | Play once, slower (see Slower above) |
| `Ctrl+−` / `Ctrl+=` / `Ctrl+0` | Speed 0.05 slower, faster, back to 1.0× |
| `Ctrl+←` / `Ctrl+→` | Previous or next sentence |
| `Ctrl+↓` | Back to the first sentence not done |
| `Ctrl+K` | Skip section: the episode plays on from this sentence; `Ctrl+K` again when it is back marks the sentences in between as an ad, left out of the score (`Esc` cancels) |
| `_` or `...` | A gap in a partly understood sentence ("I _ to the store") |
| `Esc` | Stop (see below); also leaves the typing box |
| `Ctrl+\` | Focus mode: hide the sidebar and the side panel |

(On Mac, `Cmd` instead of `Ctrl`.) Inside the typing box `Tab` is used for playback, so `Esc` is the way out for keyboard navigation.

The screen shows *Sentence 25 of 90* and the sentences just before it, done or *not done yet*, so it is always clear where the learner is. The progress in the top bar counts **sentences done** ("20 / 90 done"), not the position.

**Flag for review instead of marking words (decided 2026-11-12).** Dictation stays quick: each sentence is either typed (`Shift+Enter`, compared with the original) or skipped as known (`Shift+Tab`, counted as correct); the original is never shown while dictating, since dictation is practice, not checking answers. A sentence the learner isn't sure about, typed or known, gets a **flag** (`Ctrl+D`, on or off at any time, also before answering). Flags don't change the score; they say "look at this one later". Going back to a known sentence shows *Known: not typed. Type here to answer it instead.* in the box.

The **review** (after stopping or finishing, and from each attempt on the Episode page) filters **All · Flagged · With mistakes**; flagged rows are highlighted and can be flagged or unflagged there. Words are saved to My words only by the learner, by selecting them in the original during the review (day 5). An earlier version with the original shown and words marked in the box (`<…>`, `[…]`) was tried and dropped as too much to remember while dictating.

**Comparison (decided 2026-11-11).** Lenient about what doesn't show whether the learner heard the words: case, punctuation, fillers (*um, uh*), contractions (*don't = do not*, *I'd = I would / I had*, *dont = don't*), numbers (*15 = fifteen*, *1990 = nineteen ninety*, *21st = twenty-first*, *50% = fifty percent*), British and American spellings (*colour, realise, centre, travelled*), hyphens. Each word of the original is then **correct**, **missing**, **wrong** or **spelling**:
- **Wrong:** a real English word that isn't the one said, however close (*their/there*, *live/leave*), or a non-word too far off to say the learner knew the word (*ubikwitus*).
- **Spelling:** not a real word, and only a letter or two from the right one: 1 letter for words of 4–8 letters, 2 for longer ones, none for words of 3 letters or fewer (*recieve*). It counts **half a word**, shown in its own colour.
- Accuracy = (correct + ½ spelling) ÷ words in the original. Extra typed words are marked but cost nothing; a gap (`_`) makes the words under it missing but keeps the rest lined up. "I know this one" counts as all correct; ad sections count for nothing.
- The real-word check uses an English word list (SCOWL, American and British, sizes 10–60) bundled in the app. The comparison runs in the app, not on the server.

**Stopping partway.** `Esc` or Stop asks: **Review so far** (default) or **Save and continue later**. Progress is saved either way, and seeing partial results doesn't end the episode: the learner can resume at the next sentence, and the results grow.

**Today's Continue card and rows:** clicking one opens the episode's page; **Resume** opens dictation. The streak counts days in a row with any practice, up to yesterday while today has none yet.

**Results: the original and the learner's text side by side**, sentence by sentence like a split diff, each row with a play button. Words the learner missed are marked in the original; wrong words are red in the learner's text. Above: accuracy, sentences done, known, flagged, time; filters All, Flagged, With mistakes; a filter for sentences with mistakes; **Resume** and **Practise these again**. The same results open later from the Episode page.
- **Selecting a word or phrase** in the original opens a card with its meaning (decided 2026-11-12, changed 2026-11-13). Any selection works:
  1. **One word: the dictionary**, made flexible: case ignored, the base form found (*followed* finds *follow*), with the IPA.
  2. **Several words: one translation** of the whole selection, read in its sentence, from a translation model on the computer (below). Just the translation: the card doesn't say where it came from and doesn't list each word (decided 2026-11-13). Meanings in English have nothing to translate into, so there, and if a translation fails, the dictionary is used: **the whole phrase**, made flexible (*give it up* finds *give up*), else the longest phrase inside and each word on its own.
     - **The model:** Tencent's **HY-MT 1.5** (1.8B, 1.1 GB), the best of five tested on 36 real episode phrases (Opus-MT, Qwen 2.5 0.5B and 1.5B, Qwen3 1.7B, HY-MT): it gets idioms right (*at the end of the day* → 最终, *deluding yourself* → 自欺欺人). Its licence excludes the EU, the UK and South Korea, so computers set to those regions get **Qwen 2.5 1.5B** (Apache 2.0) instead. Firefox's 44 MB model wasn't tested.
     - **Downloads by itself** when the app first opens, after the speech model; nothing to decide. It's asked about the phrase in its sentence, and again about the phrase alone if it translated the whole sentence. Slang and explanations are what *Explain in this sentence* (AI) is for.
     - It runs in a **helper program** bundled beside the app (llama.cpp and whisper.cpp can't share one program), started when needed and closed after 5 idle minutes.
  3. **Pronunciation for anything selected:** ▶ *As said in the episode* plays exactly those words, from the word timings transcription keeps; *Slow voice* reads them with the computer's own voice. The dictionary's IPA where it has it.
  4. **Add to My words** (`A`) for any selection, with the sentence, what was typed, the words' place in the audio, the meaning (or each word's), and the learner's own note.
  5. *Explain in this sentence* needs an AI key (later).
- **The dictionary:** downloaded once from `GET /v1/dictionaries` for the language chosen in Settings › Dictionaries (*Word meanings in*, by default the computer's language). Chinese (`zh-1`, 5 MB) is built from ECDICT: about 50,000 common words, 58,000 phrases and their word forms, with English definitions.
- Later: mark **"the transcript is wrong here"** (doesn't count against the learner), adjust a sentence's start or end, merge or split sentences.
- Later: **mistakes grouped by rules, without AI**: dropped small words (weak forms: *to, of, have, can*), numbers, names, similar-sounding words (*can/can't, fifteen/fifty*, from a pronunciation dictionary), dropped endings (*-ed, -s*).
- *(AI, optional)* a written review in the learner's language (section 5).

**My words.** Each saved word or phrase keeps its meaning, every sentence it was heard in (with the original audio and what the learner typed) and a level: *New → Learning → Familiar → Known*, moved by spaced repetition (FSRS, shared with the iPhone), or **I know this** to take it out of practice. **Practice, without AI:**
1. **Listen and type** (default): hear the original sentence with the word missing and type it; checked exactly.
2. **Listen and recall:** hear it, recall the meaning, reveal it, grade *Again / Hard / Good / Easy*.
3. **Pick the meaning:** four choices, the wrong ones taken from the learner's other words.
Checking a typed translation needs an LLM, so it can only come later, as an AI feature.

**How practice runs (built 2026-11-12).** The learner decides as little as possible; the app follows one set flow:
- **What comes up:** words due now, the longest overdue first, then up to **10 new words a day** in the order they were saved; at most **20 per session**. *Practise N* on My words (`P`) and on Today.
- **Each word** is practised in one of the sentences it was saved from, a different one each time, played as said in the episode (the computer's voice reads it when the episode is gone). Typing needs the word in the sentence and picking needs four saved meanings; otherwise that word falls back to another way.
- **Grades:** a wrong answer, or *Show the answer* (`Shift+Tab`), counts as **Again** by itself and the word comes back at the end of the session (at most twice) and the next day. A right answer is **Good** on `Enter`; `2` or `4` make it Hard or Easy. Recall is graded by the learner, `Enter` for Good.
- **Scheduling:** FSRS (the `rs-fsrs` crate, MIT) in days, without the minute-long learning steps. Levels follow the interval: *Learning* under 3 days, *Familiar* 3 to 21, *Known* longer. *I know this* makes a word Known and brings it back in a year.
- Each answer is kept (time, way, grade, what was typed) for Progress; practice time counts towards the day.

**Speaking, after the review, optional:**
- **Shadowing:** play a sentence, record yourself, then compare the two. Local Whisper turns the recording into text and shows which words came through clearly. Free.
- **Retell:** summarise the episode out loud. *(AI)* feedback on content and grammar, plus a better version.

**Progress (decided 2026-11-12):**
- Four numbers: the current streak and the best (days in a row with any practice, dictation or words); time practised in the last seven days; **dictation accuracy** this calendar month and the change in points from last month; words known out of all saved words.
- **Accuracy is dictation only**: the share of words heard right, half off for a spelling mistake, as on the results screen. Word practice grades are a different measure and stay out of it.
- A year grid like GitHub's: 53 weeks, Monday to Sunday, darker for more minutes (under 15, under 30, under 60, an hour or more). **Minutes only**, no switch to sentences; the day under the mouse (or clicked, else today) is written out above the grid as its date and minutes, nothing more.
- Accuracy over the last 12 weeks, one point per week starting Monday; weeks without dictation leave a gap. Hovering shows the week's accuracy and sentences.
- *What you mishear most* is shown as coming later; it needs mistakes sorted by kind.

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
| Phrase translation | A small translation model on the computer, for phrases the dictionary lacks |
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

- **One rule: every AI feature works with whatever AI the learner already pays for. Premium only means they need none**, plus server transcription. Nothing is locked behind payment that their own AI wouldn't unlock.
- **How a learner connects AI (decided 2026-11-13).** Learners shouldn't have to create API keys. In Settings › AI and the welcome, in this order:
  1. **Sign in with ChatGPT**, for ChatGPT Plus and Pro subscribers: OpenAI's official programme lets apps use the subscriber's plan, with a weekly limit per app the subscriber sets in ChatGPT. **No approval needed (checked 2026-11-13):** plan usage is open to open-source apps that run on the user's computer, which Eksigo is (AGPL, and AI calls go straight from the desktop). OpenAI's interest form is for paid or hosted apps; Eksigo fills it in for Premium, without waiting on it.
     - How it works: the app listens on `127.0.0.1` and opens `auth.openai.com` with PKCE, a nonce, the scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, the resource `https://api.openai.com/v1` and a stable, opaque install ID (`ext_agent_host_id`, a `urn:uuid`). The first time, OpenAI registers this install and returns its client ID with the code; it is kept and reused. No secret, no key, no Eksigo server.
     - Requests go to OpenAI's Responses API with the access token, `store: false`, streamed, and with little reasoning (`effort: low`; dropped for a model that refuses it), since the answers are short. The refresh token renews the access token; Disconnect revokes it.
     - **Model (decided 2026-11-13):** *Automatic* by default: a small model from the plan's list (a "mini" one first), which answers sooner and uses less of the weekly limit. Settings › AI has a *Model* list of what the plan offers, small ones marked, for anyone who wants a stronger one. If a model goes away, Eksigo goes back to Automatic.
     - When the weekly limit is reached, Settings, the card and the review say so and offer **Manage usage** (`chatgpt.com/settings/usage`). Dictation and the dictionary carry on as usual.
     - OpenAI's DevKit is under a noncommercial licence, so Eksigo has its own Rust implementation of the same protocol rather than the kit's code.
  2. **Eksigo Premium**, for everyone else: sign in and subscribe on the web, nothing to set up. For many Chinese learners, who can't easily subscribe to ChatGPT or Claude, this is the main way.
  3. **Use my own key** (OpenAI, DeepSeek, Anthropic, Groq, OpenRouter or any OpenAI-compatible URL), under *Advanced*.
- **Not offered: Claude subscriptions.** Anthropic's terms allow Claude Free, Pro and Max logins only in Claude.ai and Claude Code, and it has blocked third-party apps that used them (2026). Using a subscriber's Claude login would break and could get their account suspended. Nor does Eksigo borrow the Codex CLI's ChatGPT login unofficially. Either is reconsidered only if the provider offers an official programme.
- **Own key, details:**
  - Supported providers: OpenAI, DeepSeek, Anthropic, Groq, or any OpenAI-compatible endpoint.
  - The app calls the provider directly, and the key never reaches our server.
  - Keys are stored in the macOS Keychain or the Windows Credential Manager, never in a plain file.
  - *Test key* tries the key with a tiny request and keeps it only when it works. Each provider has a usual small model (OpenAI `gpt-5-mini`, DeepSeek `deepseek-chat`, Anthropic `claude-haiku-5-5`, Groq `openai/gpt-oss-120b`, OpenRouter `openai/gpt-5-mini`); another can be named. The estimated cost per episode is not shown yet: prices change too often to keep in the app.
- **What AI does (redesigned 2026-11-13, designs D16–D19), always in the learner's language with English words kept in English.** The AI is asked only when the learner asks, or when nothing else has an answer; the dictionary and the translator answer first, at once and for free.
  - **Lookup card** (Results and Listen, D19): **Explain in this sentence** (`E`) says what the selection means here. It is asked by itself only when neither the dictionary nor the translator found anything (a new coinage, slang). After it, *Ask about these words…* takes follow-up questions. The explanation is saved with the word.
  - **Ask about this sentence** (`?`, D17): a conversation under a sentence on Results, in the side panel on Listen. One-click questions (*Why did I miss this?*, *What does it mean?*, *Explain the grammar*) or the learner's own, in any language. Answers appear as they are written. The conversation is kept with the sentence: per attempt on Results, per episode on Listen.
  - **Why did I miss this?** gives each mistake one of five reasons, as cards: **New word** (with *Add to My words*), **Sounds different** (weak forms, linking; with *Play at 0.7×*), **Didn't catch it** (too fast, a name or a number), **Spelling**, **Guessed** (other real words that fit). Hints sent with it: words already in My words, and words the app marked as spelling only.
  - **Episode review** (D18), written by itself when a finished episode's review opens: a line on how it went, the mistakes grouped by the same five reasons with a few of the words and their sentence numbers, *Add these N to My words* for new words, and one thing to do next time.
  - Sent: the sentence (mistakes marked), what was typed, the sentences before and after, the episode title, and the earlier questions of the same conversation. Never the audio. The review is kept per attempt and language, so it is asked once.
  - **Later:** *Practise these sentences* from the review, which needs practising only some sentences of an episode.
- **One AI client:** our server acts as one more OpenAI-compatible provider, *Eksigo (Premium)*. Choosing it changes only the URL and uses the login token instead of a key; *Sign in with ChatGPT* likewise supplies a token for OpenAI. One code path to test.
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
- **How it works (decided 2026-11-13, design D20, API.md "Sync"):** one call, `POST /v1/sync`, sends a device's changes and brings back the others'. It runs by itself when the app opens, a few seconds after words or practice change, and every ten minutes; Settings › Account shows when it last worked, with *Sync now*.
  - **The latest change wins**, record by record (a word, a review, a day). Reviews are separate records, so practising on both devices loses none; a word's sentences from both are kept.
  - **Deleting** a word deletes it on every device.
  - **First sign-in:** everything already on the computer is added to the account. Nothing is asked; nothing is lost. Signing out keeps everything on the computer.
  - **Practice days** are kept per device and added up, so the streak counts the phone's listening too.
  - **The learner's own files** don't sync (the phone can't play them); a saved word's sentence from one still does, as text.
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
  - **Desktop:** the system browser opens the provider's web sign-in and returns to the app (built 2026-11-13). Apple and Google only return to an https address they know, so the browser goes through the server:
    1. The app listens on `127.0.0.1` at a random port and opens `api.eksigo.com/v1/auth/desktop/{apple|google}` with that port, a state and a PKCE challenge.
    2. The server sends the browser to Apple or Google, which send it back to `/v1/auth/{provider}/callback`.
    3. The server checks the identity token, finds or creates the user, and sends the browser to the app's listener with a one-time code.
    4. The app trades the code and its PKCE verifier for a session token. It then shows the browser the server's "You're signed in" page (design D15).

    Setup: Apple needs a Services ID with the return URL `https://api.eksigo.com/v1/auth/apple/callback`. Google needs a *Web application* OAuth client with `https://api.eksigo.com/v1/auth/google/callback`.
- **Decided 2026-11-13:**
  - **No sign-in in the welcome.** It is offered in Settings › Account and sync and by "Sign in to sync" in the sidebar.
  - **Apple and Google stay separate accounts.** No merging, even when the e-mail is the same.
  - **Signing in keeps what is on the computer.** Its words and practice are added to the account silently, never with a question (with sync, section 7).
- **How it works:** the provider's identity token goes to the server (`POST /v1/auth/apple`, `POST /v1/auth/google`). The server checks it, finds or creates the user, and returns an opaque session token. Sessions unused for 180 days expire.
- **Where the session token lives:** the iPhone Keychain (this device only), and the macOS Keychain or Windows Credential Manager on the desktop. Never in a plain file.
- **What the server stores:** the provider's user ID, the e-mail it shares, the name, the plan and the AI allowance use, plus the synced data in section 7.
- **Sign out and delete:** in Settings on each app. Signing out or deleting leaves everything on the computer. Deleting removes the user, sessions, allowance use and synced data from the server (App Store guideline 5.1.1(v)).
  - Desktop Apple sign-ins are also revoked at Apple, once the server has a Sign in with Apple key (`EKSIGO_APPLE_PRIVATE_KEY`).
  - Still to do: the iPhone's Apple sign-ins (the app must send its authorization code).

---

## 9. iPhone app: listening companion

Free, with no AI and no in-app purchase. Built 2026-11-13 from the canvas (P01–P22), tabs Listen, Discover, Review and Me (`ios/README.md`).
- **Podcast player**, as today. Listening history syncs and becomes *Today* on the desktop.
  - **v2.1 (2026-11-14, canvas P23–P31):** Discover became short rows you swipe sideways (your shows, for learners, top shows) plus topic tiles, with *See all* pages; the player gained the episode's missed sentences, what plays next, a labelled row (Speed, Sleep, Up Next, AirPlay, More) and the notes under it.
  - **v3 look (2026-11-14, canvas N01–N27):** the phone left the desktop's Linear style for the native iOS one. System colours and font (light and dark come out right by themselves), no outlines, rounder soft-grey groups, capsule buttons, large titles that shrink into the bar. Liquid Glass only where the system puts it: the tab bar, the bars, the mini player (in the tab bar's accessory spot, so pages end above it). Colour comes from content: the covers (bigger), the player and show pages tinted with the cover's colour, a purple card and player for missed sentences, an orange card when words are due, a colour per topic. One indigo accent for the main action.
  - **Up Next:** add from an episode page, by swiping an episode left, or by holding it. Episodes play in the order added; each leaves the list when it starts; with the list empty, playback stops after the current episode ("sleep at the end of the episode" also stops it). Shown in Listen (the next three) and as a sheet from the player (reorder, remove, clear). Kept on the phone only: the desktop has no queue.
- **Missed-sentence playlist:** last night's mistakes, played back to back with their text, for the commute. How the phone finds the sentence in its own copy:
  1. **The file matches:** play the exact timestamps. This is common for podcasts without inserted ads. Built as a size check: the phone's download has the size the computer's had (`missed.bytes`); with no download yet, the stream plays. Episodes with missed sentences download by themselves on Wi-Fi (Settings, on by default).
  2. **The hash differs:** search the phone's copy near the expected time with a small audio fingerprint of the sentence (about 3 seconds, about 100 bytes, synced with the sentence). Added later.
  3. **No match, or the episode is not on the phone:** show the text and what was typed, without audio.
- **Word review with spaced repetition:** cards from the desktop sessions, each with its original sentence and audio (FSRS scheduling, on the phone).
  - Built as recall (the sentence plays with the word as a gap, then the answer and Again/Hard/Good/Easy) and, for new words, pick the meaning from four. No typing on the phone. The rules are the desktop's: due words first, at most 10 new a day and 20 a session, a missed word once more at the end. FSRS is a port of the desktop's rs-fsrs, tested against it.
- **My words, history and progress**, view only.
- **Removed:** Breakdown, AI speaking practice, transcripts made by AI, the level test that tunes breakdowns, free breakdown lessons, and the Premium purchase and paywall.
- A read-only web page at eksigo.com for My words and history could cover Android users later.

---

## 10. Open source and distribution

- **License (decided 2026-11-12):** **AGPL-3.0** for the whole repository (`LICENSE` at the top). Anyone may use and change the code, but a changed copy that is shipped or run as a service must publish its changes under the same license.
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
  - **Updates:** automatic, with Tauri's updater. The app checks the latest GitHub release once each time it starts, downloads a newer version without asking, and offers *Restart to update* in the status bar (and in Settings › About). Update files are signed with a key whose private half is a GitHub secret; the app refuses anything not signed with it.
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
- **Privacy manifest** (`ios/Eksigo/PrivacyInfo.xcprivacy`, updated 2026-11-13 for v2): no tracking; required-reason APIs `UserDefaults` (CA92.1) and file metadata through `attributesOfItem` (C617.1). Data collected, for app functionality only, linked to the account: name, e-mail, user ID, product interaction (listening and practice time) and other content (saved words and reviews, through sync). No purchases and no audio. **App Store Connect's privacy labels must say the same.** Using another required-reason API means adding it here.
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
Releases go to GitHub Releases, built by `.github/workflows/release.yml` on every version tag (`git tag v0.1.0 && git push origin v0.1.0`):
- The tag is the version: the workflow writes it into `tauri.conf.json` before building.
- **Mac:** one universal `.dmg` (Apple Silicon and Intel, macOS 11 or later), signed with the Developer ID and notarised. Secrets: `APPLE_CERTIFICATE` (the .p12 as base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID`.
- **Windows:** an unsigned NSIS installer for the current user, no admin rights needed (section 10).
- **Updates:** both builds also upload signed update files and `latest.json`. Secrets: `TAURI_SIGNING_PRIVATE_KEY` and its password; the public key is in `tauri.conf.json`.
- whisper.cpp is compiled for a common baseline (AVX2 and FMA), not for the build machine's processor, so it runs on the learner's.
- The release is a **draft** until the owner publishes it. It's never marked pre-release, because the updater reads GitHub's *latest* release, which skips pre-releases and drafts. Test tags (`v0.1.0-test.1`) are published only to test the updater, then deleted.

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
4. **AI:** episode review, words in context, sentence explanation; connected with *Sign in with ChatGPT* (once OpenAI approves Eksigo), Premium, or the learner's own key (section 6).
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
