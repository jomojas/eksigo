# Eksigo API

The contract between the apps (desktop, iPhone) and the server, at `https://api.eksigo.com`. The design reasons are in [DESIGN.md](DESIGN.md). The v1 API (breakdowns, lessons, practice, App Store purchases) is gone; it lives in the v1 repository.

Status: accounts, dictionaries and cover art are implemented in `backend/` (2026-11-10). Sync (DESIGN.md section 7) and Premium AI (section 6) come later.

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

### `POST /v1/auth/dev`
`{"name": "me"}`. Local development only: answers `404` unless the server runs with `EKSIGO_DEV_LOGIN=1`.

### `POST /v1/auth/sign-out`
Ends this session. Returns `204`.

### `GET /v1/me`
Returns `User`:
```json
{"id": 12, "name": "Mei Lin", "email": "x@privaterelay.appleid.com", "plan": "free"}
```
`plan` is `free` or `premium`.

### `DELETE /v1/me`
Deletes the account and all its sessions. Returns `204`. Account IDs are never reused.

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
