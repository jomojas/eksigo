"""Accounts: Sign in with Apple or Google, sessions, and who is calling (DESIGN.md section 8).

Accounts are optional: listening on the phone and dictating on the desktop need none. An account turns on sync
and Premium.
"""

import hashlib
import json
import os
import secrets
import sqlite3
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from app.config import Config
from app.db import now_iso
from app.errors import APIError
from app.http import fetch_bytes

APPLE_ISSUER = "https://appleid.apple.com"
APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"
GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"]
GOOGLE_KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs"


def dev_login_enabled() -> bool:
    """Developer sign-in without Apple or Google, for local development. Never set EKSIGO_DEV_LOGIN on the VPS."""
    return os.environ.get("EKSIGO_DEV_LOGIN") == "1"


# ---------------------------------------------------------------- identity tokens (Apple, Google)


class SigningKeys:
    """A provider's public signing keys, cached for a day and refetched when a token names an unknown key."""

    url = APPLE_KEYS_URL
    provider = "Apple"

    def __init__(self, fetch: Callable[[], dict[str, Any]] | None = None):
        self._fetch = fetch or (lambda: json.loads(fetch_bytes(self.url)))
        self._keys: dict[str, Any] = {}
        self._fetched = 0.0
        self._lock = threading.Lock()

    def get(self, kid: str) -> Any:
        with self._lock:
            if kid not in self._keys or time.time() - self._fetched > 86400:
                jwks = self._fetch()
                self._keys = {k["kid"]: jwt.PyJWK(k).key for k in jwks.get("keys", []) if "kid" in k}
                self._fetched = time.time()
            if kid not in self._keys:
                raise APIError(401, "invalid_token", f"Unknown {self.provider} signing key")
            return self._keys[kid]


class AppleKeys(SigningKeys):
    pass


class GoogleKeys(SigningKeys):
    url = GOOGLE_KEYS_URL
    provider = "Google"


def verify_apple_token(token: str, nonce: str | None, cfg: Config, keys: AppleKeys,
                       audience: list[str] | None = None) -> dict[str, Any]:  # fmt: skip
    """Check signature, issuer, audience (by default the iPhone app's) and expiry; with a nonce, check it was this
    sign-in's."""
    try:
        kid = jwt.get_unverified_header(token).get("kid", "")
        claims = jwt.decode(token, keys.get(kid), algorithms=["RS256"], audience=audience or cfg.auth.apple_audiences,
                            issuer=APPLE_ISSUER, options={"require": ["sub", "exp", "iat"]})  # fmt: skip
    except jwt.PyJWTError as e:
        raise APIError(401, "invalid_token", f"Apple sign-in failed: {e}") from e
    if nonce is not None and claims.get("nonce") != hashlib.sha256(nonce.encode()).hexdigest():
        raise APIError(401, "invalid_token", "Apple sign-in failed: nonce mismatch")
    return claims


def verify_google_token(token: str, cfg: Config, keys: GoogleKeys, audience: list[str] | None = None) -> dict[str, Any]:
    """Check signature, issuer, audience (an app's OAuth client ID) and expiry of a Google ID token."""
    audience = audience or cfg.auth.google_client_ids
    if not audience:
        raise APIError(404, "not_found", "Google sign-in isn't set up")
    try:
        kid = jwt.get_unverified_header(token).get("kid", "")
        claims = jwt.decode(token, keys.get(kid), algorithms=["RS256"], audience=audience,
                            options={"require": ["sub", "exp", "iat", "iss"]})  # fmt: skip
    except jwt.PyJWTError as e:
        raise APIError(401, "invalid_token", f"Google sign-in failed: {e}") from e
    if claims["iss"] not in GOOGLE_ISSUERS:
        raise APIError(401, "invalid_token", "Google sign-in failed: wrong issuer")
    return claims


# ---------------------------------------------------------------- users and sessions


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _upsert(conn: sqlite3.Connection, column: str, sub: str, email: str | None, name: str | None) -> int:
    with conn:
        row = conn.execute(f"SELECT id FROM users WHERE {column} = ?", (sub,)).fetchone()
        if row:
            # Apple sends the name only the first time; never overwrite it with nothing.
            conn.execute("UPDATE users SET email = COALESCE(?, email), name = COALESCE(?, name) WHERE id = ?",
                         (email, name or None, row["id"]))  # fmt: skip
            return row["id"]
        return conn.execute(f"INSERT INTO users ({column}, email, name, created_at) VALUES (?, ?, ?, ?)",
                            (sub, email, name or None, now_iso())).lastrowid  # fmt: skip


def upsert_apple_user(conn: sqlite3.Connection, sub: str, email: str | None, name: str | None) -> int:
    return _upsert(conn, "apple_sub", sub, email, name)


def upsert_google_user(conn: sqlite3.Connection, sub: str, email: str | None, name: str | None) -> int:
    return _upsert(conn, "google_sub", sub, email, name)


def upsert_dev_user(conn: sqlite3.Connection, name: str) -> int:
    return _upsert(conn, "dev_name", name, None, name)


def create_session(conn: sqlite3.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = now_iso()
    with conn:
        conn.execute("INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)",
                     (_hash(token), user_id, now, now))  # fmt: skip
    return token


def _bearer(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return authorization[7:].strip()


def user_for_token(conn: sqlite3.Connection, cfg: Config, authorization: str | None) -> sqlite3.Row | None:
    """The signed-in user for an `Authorization: Bearer …` header, or None."""
    token = _bearer(authorization)
    if token is None:
        return None
    token_hash = _hash(token)
    row = conn.execute("SELECT u.*, s.last_used_at FROM sessions s JOIN users u ON u.id = s.user_id "
                       "WHERE s.token_hash = ?", (token_hash,)).fetchone()  # fmt: skip
    if row is None:
        return None
    last = datetime.fromisoformat(row["last_used_at"].replace("Z", "+00:00"))
    now = datetime.now(UTC)
    if now - last > timedelta(days=cfg.auth.session_idle_days):
        with conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
        return None
    if now - last > timedelta(hours=1):  # one write an hour is enough
        with conn:
            conn.execute("UPDATE sessions SET last_used_at = ? WHERE token_hash = ?", (now_iso(), token_hash))
    return row


def require_user(conn: sqlite3.Connection, cfg: Config, authorization: str | None) -> sqlite3.Row:
    user = user_for_token(conn, cfg, authorization)
    if user is None:
        raise APIError(401, "sign_in_required", "Sign in to use this feature")
    return user


def sign_out(conn: sqlite3.Connection, authorization: str | None) -> None:
    token = _bearer(authorization)
    if token is not None:
        with conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash(token),))


def delete_user(conn: sqlite3.Connection, user_id: int) -> None:
    """Delete the account and, through the foreign keys, its sessions and synced data (App Store guideline
    5.1.1(v))."""
    with conn:
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))


def save_apple_refresh_token(conn: sqlite3.Connection, user_id: int, token: str, client_id: str) -> None:
    with conn:
        conn.execute("UPDATE users SET apple_refresh_token = ?, apple_client_id = ? WHERE id = ?",
                     (token, client_id, user_id))  # fmt: skip


def provider(user: sqlite3.Row) -> str:
    return "apple" if user["apple_sub"] else "google" if user["google_sub"] else "dev"


def user_json(user: sqlite3.Row) -> dict[str, Any]:
    return {"id": user["id"], "name": user["name"], "email": user["email"], "plan": user["plan"],
            "provider": provider(user)}  # fmt: skip
