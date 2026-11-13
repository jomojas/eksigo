"""Signing in on the desktop (DESIGN.md section 8).

Apple and Google sign in on the web only to an https address they know, so the browser goes through this server:

1. The app listens on 127.0.0.1 and opens `/v1/auth/desktop/{provider}` with its port, a state and a PKCE challenge.
2. The server sends the browser to Apple or Google, which send it back to `/v1/auth/{provider}/callback`.
3. The server checks the identity token, finds or creates the user, and sends the browser to the app's listener
   with a one-time code. The app answers the browser with the "done" page.
4. The app trades the code and its PKCE verifier for a session token (`POST /v1/auth/desktop/token`).
"""

import base64
import hashlib
import html
import json
import logging
import secrets
import sqlite3
import time
import urllib.parse

import jwt

from app import auth, http
from app.config import Config, Settings
from app.errors import APIError

log = logging.getLogger("api")

APPLE_AUTHORIZE = "https://appleid.apple.com/auth/authorize"
APPLE_TOKEN = "https://appleid.apple.com/auth/token"
APPLE_REVOKE = "https://appleid.apple.com/auth/revoke"
GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"

# The learner has this long to finish in the browser, and the app this long to collect the code.
SIGN_IN_SECONDS = 15 * 60
CODE_SECONDS = 5 * 60

NAMES = {"apple": "Apple", "google": "Google"}


def enabled(provider: str, cfg: Config, settings: Settings) -> bool:
    if provider == "apple":
        return bool(cfg.auth.apple_services_id)
    if provider == "google":
        return bool(cfg.auth.google_web_client_id and settings.google_client_secret)
    return False


def _callback(settings: Settings, provider: str) -> str:
    return f"{settings.public_base_url}/v1/auth/{provider}/callback"


def _s256(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


def _hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


# ---------------------------------------------------------------- 1. start


def start(conn: sqlite3.Connection, cfg: Config, settings: Settings, provider: str, port: int, app_state: str,
          challenge: str) -> str:  # fmt: skip
    """Remember the app's request and return the provider's sign-in address."""
    if not enabled(provider, cfg, settings):
        raise APIError(404, "not_found", f"Signing in with {NAMES.get(provider, provider)} isn't set up")
    request_id, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    now = int(time.time())
    with conn:
        conn.execute("DELETE FROM desktop_sign_ins WHERE created < ?", (now - SIGN_IN_SECONDS - CODE_SECONDS,))
        conn.execute("INSERT INTO desktop_sign_ins (id, provider, port, app_state, challenge, nonce, created) "
                     "VALUES (?, ?, ?, ?, ?, ?, ?)", (request_id, provider, port, app_state, challenge, nonce, now))  # fmt: skip
    if provider == "apple":
        # Apple puts the nonce into the token as given; the token check compares it with the SHA-256 of ours.
        query = {"client_id": cfg.auth.apple_services_id, "redirect_uri": _callback(settings, "apple"),
                 "response_type": "code id_token", "response_mode": "form_post", "scope": "name email",
                 "state": request_id, "nonce": hashlib.sha256(nonce.encode()).hexdigest()}  # fmt: skip
        return f"{APPLE_AUTHORIZE}?{urllib.parse.urlencode(query, quote_via=urllib.parse.quote)}"
    query = {"client_id": cfg.auth.google_web_client_id, "redirect_uri": _callback(settings, "google"),
             "response_type": "code", "scope": "openid email profile", "state": request_id, "nonce": nonce,
             "prompt": "select_account"}  # fmt: skip
    return f"{GOOGLE_AUTHORIZE}?{urllib.parse.urlencode(query, quote_via=urllib.parse.quote)}"


# ---------------------------------------------------------------- 2. the provider answers


class Pending:
    def __init__(self, row: sqlite3.Row):
        self.id, self.provider, self.port, self.app_state = row["id"], row["provider"], row["port"], row["app_state"]
        self.nonce = row["nonce"]

    def back_to_app(self, **query: str) -> str:
        return f"http://127.0.0.1:{self.port}/callback?{urllib.parse.urlencode({'state': self.app_state, **query})}"


def pending(conn: sqlite3.Connection, request_id: str | None, provider: str) -> Pending | None:
    """The app's request a provider's answer is for, if it's still waiting."""
    if not request_id:
        return None
    row = conn.execute("SELECT * FROM desktop_sign_ins WHERE id = ? AND provider = ? AND code_hash IS NULL "
                       "AND created >= ?", (request_id, provider, int(time.time()) - SIGN_IN_SECONDS)).fetchone()  # fmt: skip
    return Pending(row) if row else None


def finish(conn: sqlite3.Connection, p: Pending, user_id: int) -> str:
    """Give the app a one-time code for the signed-in user; returns where to send the browser."""
    code = secrets.token_urlsafe(32)
    with conn:
        conn.execute("UPDATE desktop_sign_ins SET code_hash = ?, user_id = ?, created = ? WHERE id = ?",
                     (_hash(code), user_id, int(time.time()), p.id))  # fmt: skip
    return p.back_to_app(code=code)


def fail(conn: sqlite3.Connection, p: Pending, error: str) -> str:
    with conn:
        conn.execute("DELETE FROM desktop_sign_ins WHERE id = ?", (p.id,))
    return p.back_to_app(error=error)


def google_user(conn: sqlite3.Connection, cfg: Config, settings: Settings, keys: auth.GoogleKeys, p: Pending,
                code: str) -> int:  # fmt: skip
    answer = http.post_form(GOOGLE_TOKEN, {"code": code, "client_id": cfg.auth.google_web_client_id,
                                           "client_secret": settings.google_client_secret,
                                           "redirect_uri": _callback(settings, "google"),
                                           "grant_type": "authorization_code"})  # fmt: skip
    claims = auth.verify_google_token(answer.get("id_token", ""), cfg, keys, [cfg.auth.google_web_client_id])
    if claims.get("nonce") != p.nonce:
        raise APIError(401, "invalid_token", "Google sign-in failed: nonce mismatch")
    email = claims.get("email") if claims.get("email_verified") else None
    return auth.upsert_google_user(conn, claims["sub"], email, (claims.get("name") or "").strip() or None)


def apple_user(conn: sqlite3.Connection, cfg: Config, settings: Settings, keys: auth.AppleKeys, p: Pending,
               form: dict[str, str]) -> int:  # fmt: skip
    claims = auth.verify_apple_token(form.get("id_token", ""), p.nonce, cfg, keys, [cfg.auth.apple_services_id])
    name = None
    try:  # Apple sends the name once, on the very first sign-in, outside the token.
        given = json.loads(form.get("user") or "{}").get("name") or {}
        name = " ".join(x for x in (given.get("firstName"), given.get("lastName")) if x).strip() or None
    except (ValueError, AttributeError):
        pass
    user_id = auth.upsert_apple_user(conn, claims["sub"], claims.get("email"), name)
    if apple_key_ready(cfg, settings) and form.get("code"):
        try:
            client_id = cfg.auth.apple_services_id
            answer = http.post_form(APPLE_TOKEN, {"client_id": client_id, "client_secret": apple_secret(cfg, settings, client_id),
                                                  "code": form["code"], "grant_type": "authorization_code",
                                                  "redirect_uri": _callback(settings, "apple")})  # fmt: skip
            if answer.get("refresh_token"):
                auth.save_apple_refresh_token(conn, user_id, answer["refresh_token"], client_id)
        except (ValueError, OSError) as e:  # signing in still works; only revoking on deletion is missed
            log.warning("apple token exchange: %s", e)
    return user_id


# ---------------------------------------------------------------- 4. the app collects the session


def redeem(conn: sqlite3.Connection, code: str, verifier: str) -> int:
    """The user ID for a one-time code, if the verifier matches the challenge the app started with. One try."""
    row = conn.execute("SELECT * FROM desktop_sign_ins WHERE code_hash = ?", (_hash(code),)).fetchone()
    if row is None:
        raise APIError(401, "invalid_token", "This sign-in has already finished or was never started")
    with conn:
        conn.execute("DELETE FROM desktop_sign_ins WHERE id = ?", (row["id"],))
    if row["created"] < time.time() - CODE_SECONDS or row["user_id"] is None:
        raise APIError(401, "invalid_token", "This sign-in took too long; try again")
    if not secrets.compare_digest(_s256(verifier), row["challenge"]):
        raise APIError(401, "invalid_token", "This sign-in was started by another app")
    return row["user_id"]


# ---------------------------------------------------------------- Apple tokens


def apple_key_ready(cfg: Config, settings: Settings) -> bool:
    return bool(cfg.auth.apple_team_id and cfg.auth.apple_key_id and settings.apple_private_key)


def apple_secret(cfg: Config, settings: Settings, client_id: str) -> str:
    """Apple's client secret: a short-lived JWT signed with the Sign in with Apple key."""
    now = int(time.time())
    claims = {"iss": cfg.auth.apple_team_id, "iat": now, "exp": now + 300, "aud": auth.APPLE_ISSUER, "sub": client_id}
    return jwt.encode(claims, settings.apple_private_key, algorithm="ES256", headers={"kid": cfg.auth.apple_key_id})


def revoke_apple(cfg: Config, settings: Settings, user: sqlite3.Row) -> None:
    """Tell Apple the account is gone (App Store guideline 5.1.1(v)). Best effort: the account is deleted anyway."""
    token, client_id = user["apple_refresh_token"], user["apple_client_id"]
    if not token or not client_id or not apple_key_ready(cfg, settings):
        return
    try:
        http.post_form(APPLE_REVOKE, {"client_id": client_id, "client_secret": apple_secret(cfg, settings, client_id),
                                      "token": token, "token_type_hint": "refresh_token"})  # fmt: skip
    except (ValueError, OSError) as e:
        log.warning("apple revoke for user %s: %s", user["id"], e)


# ---------------------------------------------------------------- the page the browser ends on


def done_page(ok: bool, provider: str | None) -> str:
    """Matches the app's look (design D15). Light or dark follows the computer."""
    name = NAMES.get(provider or "")
    if ok:
        title, text = "You're signed in", "Go back to Eksigo; it's already carrying on. You can close this tab."
        mark = '<path d="M4 12l5 5L20 6"/>'
    else:
        title = "Signing in didn't work"
        who = f"{name} didn't confirm the sign-in" if name else "The sign-in didn't finish"
        text = f"{who}, or it took too long. Go back to Eksigo and try again."
        mark = '<path d="M6 6l12 12M18 6L6 18"/>'
    foot = f'<p class="foot">Signed in with {name}</p>' if ok and name else ""
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title, quote=False)} · Eksigo</title>
<style>
:root{{--canvas:#fcfcfd;--surface-2:#efeff2;--hairline-strong:#d2d2d9;--ink:#121316;--ink-muted:#3a3d44;--ink-tertiary:#9a9da5;
--ok:#1f8a3a;--bad:#d33f45;color-scheme:light dark}}
@media (prefers-color-scheme:dark){{:root{{--canvas:#010102;--surface-2:#141516;--hairline-strong:#34343a;--ink:#f7f8f8;
--ink-muted:#d0d6e0;--ink-tertiary:#62666d;--ok:#27a644;--bad:#eb5757}}}}
body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--canvas);
color:var(--ink-muted);font-family:Inter,-apple-system,system-ui,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}}
main{{max-width:440px;padding:24px 16px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:14px}}
.ws{{font:600 18px/1 inherit;letter-spacing:-0.3px;color:var(--ink);padding-bottom:18px}}
.mark{{width:52px;height:52px;border-radius:9999px;display:flex;align-items:center;justify-content:center;
background:var(--surface-2);border:1px solid var(--hairline-strong);color:var(--{"ok" if ok else "bad"})}}
h1{{margin:0;font-size:28px;line-height:1.2;font-weight:600;letter-spacing:-0.7px;color:var(--ink)}}
p{{margin:0;font-size:15px;line-height:1.55}}
.foot{{font-size:12px;color:var(--ink-tertiary);margin-top:18px}}
</style></head>
<body><main>
<div class="ws">Eksigo</div>
<div class="mark"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{mark}</svg></div>
<h1>{html.escape(title, quote=False)}</h1>
<p>{html.escape(text, quote=False)}</p>
{foot}
</main></body></html>"""

