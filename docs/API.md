# Eksigo API

The contract between the apps (desktop, iPhone) and the server, at `https://api.eksigo.com`. The design reasons are in [DESIGN.md](DESIGN.md). The v1 API (breakdowns, lessons, practice, App Store purchases) is gone; it lives in the v1 repository.

Status: accounts, dictionaries and cover art are implemented in `backend/` (2026-11-10), sync on 2026-11-13. Premium AI (DESIGN.md section 6) comes later.

## Conventions
- HTTPS and JSON. Interactive docs at `/v1/docs`.
- **Signed-in calls** send `Authorization: Bearer <token>`, the token returned by a sign-in.
- **Backward compatible:** old app versions keep running for months, so fields are added, never removed or renamed.
- **Caching:** list responses carry an `ETag`. Send it back in `If-None-Match` and get `304` when nothing changed.

## Errors
Every error has the same shape:
```json
{"error": {"code": "sign_in_required", "message": "Sign in to use this feature"}}
```
| Status | Code | When |
|---|---|---|
| 400 | `bad_request` | The body or query is invalid |
| 401 | `sign_in_required` | No valid session (missing, signed out, expired after 180 idle days, or the account was deleted) |
| 401 | `invalid_token` | An Apple or Google identity token failed its checks |
| 404 | `not_found` | Unknown path or item; also Google sign-in when it isn't set up |
| 413 | `sync_full` | The account has reached the sync limit |
| 500 | `internal` | A bug on our side |

## Accounts (DESIGN.md section 8)

### `POST /v1/auth/apple`
```json
{"identity_token": "<Apple identity token>", "nonce": "<raw nonce>", "name": "Mei Lin"}
```
- **`nonce`:** the raw value whose SHA-256 the app put into Apple's request.
- **`name`:** optional. Apple gives it only on the first sign-in, and the server keeps it.

Returns `{"token": "...", "user": User}`.

### `POST /v1/auth/google`
```json
{"id_token": "<Google ID token>"}
```
Returns `{"token": "...", "user": User}`. The e-mail is kept only when Google marks it verified.

### Signing in on the desktop
The browser goes through the server (DESIGN.md section 8):
1. **`GET /v1/auth/desktop/{apple|google}?port=&state=&challenge=`.**
   - `port`: the app's listener on `127.0.0.1`, 1024–65535.
   - `state`: the app's own random value, at least 16 characters.
   - `challenge`: PKCE S256 (base64url of the SHA-256 of the verifier).

   The server redirects to Apple or Google, or answers `404` when that provider isn't set up.
2. **`GET /v1/auth/google/callback` and `POST /v1/auth/apple/callback`** are for Apple and Google. They send the browser to `http://127.0.0.1:{port}/callback?state=…` with either:
   - `code`: one use, valid 5 minutes, or
   - `error`: `cancelled` or `failed`.

   The learner has 15 minutes to finish in the browser.
3. **`POST /v1/auth/desktop/token`** with `{"code": "...", "verifier": "..."}` returns `{"token": "...", "user": User}`. A wrong verifier uses up the code.
4. **`GET /v1/auth/done?ok=1&provider=google`** is the page the app shows the browser at the end.

### `POST /v1/auth/dev`
`{"name": "me"}`. Local development only: answers `404` unless the server runs with `EKSIGO_DEV_LOGIN=1`.

### `POST /v1/auth/sign-out`
Ends this session. Returns `204`.

### `GET /v1/me`
Returns `User`:
```json
{"id": 12, "name": "Mei Lin", "email": "x@privaterelay.appleid.com", "plan": "free", "provider": "apple"}
```
- `plan`: `free` or `premium`.
- `provider`: `apple`, `google` or `dev`.

### `DELETE /v1/me`
Deletes the account and all its sessions. If it signed in with Apple on the desktop and the server has a Sign in with Apple key, it also revokes the sign-in at Apple. Returns `204`. Account IDs are never reused.

## Sync (DESIGN.md section 7)

### `POST /v1/sync`
Signed in. Sends this device's changes and returns every change made since its last sync by its other devices. One call when the app opens, after a session, and a few seconds after something changes.
```json
{
  "since": 1290,
  "changes": [
    {"kind": "word", "key": "follow through", "changedAt": 1794598222000, "data": {"text": "follow through", "…": "…"}},
    {"kind": "word", "key": "gist", "changedAt": 1794598230000, "deleted": true}
  ]
}
```
Returns:
```json
{"cursor": 1302, "changes": [{"kind": "listen", "key": "https://…/ep12.mp3", "changedAt": 1794590000000, "data": {"…": "…"}}], "more": false}
```
- **Records** are JSON objects keyed by `kind` and `key`; the server stores them as they are. `changedAt` is when the record changed on the device, in unix milliseconds.
- **The latest change wins.** A change older than the one stored is ignored, and the stored one comes back in `changes`, so the device takes it.
- **Deleting** sends `"deleted": true` without `data`. The deletion is kept and reaches the other devices the same way.
- **`since`** is the `cursor` from the last answer (0 the first time). The answer leaves out the device's own changes from this request. With `"more": true` there are more: call again with the new cursor and no changes.
- **`"reset": true`** means the server has less than the device thought (it was restored from a backup). The answer then holds everything from the start; the device should send all its records again.
- **Limits:** at most 500 changes per request, 16 KB per record, 20 MB per account (`413 sync_full`). Deleting the account deletes all of it.

Kinds. Times inside `data` are unix seconds unless the name ends in `Ms`; an episode is identified by its `audioUrl`, with `feedUrl` and `guid` to find it in its feed.

| `kind` | `key` | Made by | `data` |
|---|---|---|---|
| `word` | the text, lowercased | both | `text`, `headword`, `ipa`, `meaning`, `note`, `explanation`, `card` (the FSRS card as a JSON string, or null), `dueAt`, `level` (`new`, `learning`, `familiar`, `known`), `addedAt`, and `contexts`: each sentence it was saved from, `{audioUrl, title, source, idx, sentence, typed, startMs, endMs, sentenceStartMs, sentenceEndMs, addedAt, practisedAt}` |
| `review` | `<word key>\|<at>\|<mode>` | both | `word`, `at`, `mode` (`type`, `recall`, `pick`, `known`), `grade` (1–4), `correct` (bool or null), `typed`, `seconds` |
| `missed` | `<audioUrl>\|<idx>` | desktop | a sentence missed in the latest dictation of a podcast episode, the phone's playlist: `audioUrl`, `feedUrl`, `guid`, `episode`, `show`, `artworkUrl`, `bytes` (the file's size, to check it's the same file), `idx`, `startMs`, `endMs`, `text`, `typed`, `at`, `flagged` |
| `practice` | `<audioUrl>\|<startedAt>` | desktop | one dictation attempt: the episode fields as in `missed`, `startedAt`, `updatedAt`, `finishedAt`, `seconds`, `answered`, `sentences`, `accuracy` (correct words in thousandths) |
| `day` | `<day>\|<kind>\|<device>` | both | time practised on a day by one device, so the devices' days add up: `day` ("2026-11-13"), `kind` (`dictation`, `words`, `listening`), `seconds`, `device` |
| `listen` | `<audioUrl>` | phone | the latest listen to an episode: `audioUrl`, `feedUrl`, `guid`, `episode`, `show`, `artworkUrl`, `durationS`, `positionS`, `finished`, `listenedAt` (unix ms) |

A device keeps records of kinds it doesn't know and doesn't send them back.

## Free resources (no account needed)

### `GET /v1/dictionaries`
The offline dictionaries the apps download for the learner's language (DESIGN.md section 5):
```json
{"dictionaries": [{"lang": "ja", "version": 1, "bytes": 1534012, "sha256": "…", "source": "EJDict",
                   "url": "https://api.eksigo.com/dictionaries/ja-1.sqlite.deflate"}]}
```

### `GET /dictionaries/{file}`
The file: a SQLite database compressed with raw deflate (zlib without its header). `zh` has Chinese meanings, phrases and English definitions (`words.definition`). A new version gets a new name, so a file never changes (`Cache-Control: immutable`).

### `GET /v1/art?url=<image URL>`
A podcast cover image, fetched once, scaled to at most 600 px wide and cached, because some image hosts can't be reached from mainland China.
- Returns a JPEG.
- Returns `404` when the URL isn't a public `http(s)` image.
