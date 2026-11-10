"""Accounts: Sign in with Apple and Google, sessions, sign-out and account deletion (DESIGN.md section 8)."""

import hashlib
import json
import threading
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app import auth
from app.main import create_app

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
JWKS = {"keys": [{**json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(KEY.public_key())), "kid": "k1", "alg": "RS256"}]}
GOOGLE_CLIENT = "123-abc.apps.googleusercontent.com"


def _init_keys(keys, fetch=None):
    keys._fetch, keys._keys, keys._fetched, keys._lock = (lambda: JWKS), {}, 0.0, threading.Lock()


@pytest.fixture
def client(settings, cfg, monkeypatch):
    """Apple's and Google's signing keys are the test key; Google sign-in is on."""
    monkeypatch.setattr(auth.SigningKeys, "__init__", _init_keys)
    cfg.auth.google_client_ids = [GOOGLE_CLIENT]
    with TestClient(create_app(settings, cfg)) as c:
        yield c


def apple_token(sub="001234.abcd", aud="com.eksigo.app", nonce="n-1", exp_in=600, kid="k1", key=KEY, **extra):
    now = int(time.time())
    claims = {"iss": auth.APPLE_ISSUER, "aud": aud, "sub": sub, "iat": now, "exp": now + exp_in,
              "nonce": hashlib.sha256(nonce.encode()).hexdigest(), **extra}  # fmt: skip
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": kid})


def google_token(sub="g-42", aud=GOOGLE_CLIENT, iss="https://accounts.google.com", exp_in=600, **extra):
    now = int(time.time())
    claims = {"iss": iss, "aud": aud, "sub": sub, "iat": now, "exp": now + exp_in, **extra}
    return jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": "k1"})


def apple_sign_in(client, **kw):
    name = kw.pop("name", None)
    return client.post("/v1/auth/apple", json={"identity_token": apple_token(**kw), "nonce": kw.get("nonce", "n-1"),
                                               "name": name})  # fmt: skip


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_apple_sign_in_creates_one_account(client):
    r = apple_sign_in(client, name="Mei Lin", email="x@privaterelay.appleid.com")
    assert r.status_code == 200, r.text
    first = r.json()
    assert first["user"]["name"] == "Mei Lin" and first["user"]["plan"] == "free"
    # Signing in again (Apple sends no name this time) finds the same account and keeps the name.
    again = apple_sign_in(client).json()
    assert again["user"]["id"] == first["user"]["id"] and again["user"]["name"] == "Mei Lin"
    assert again["token"] != first["token"]
    assert client.get("/v1/me", headers=bearer(again["token"])).json()["id"] == first["user"]["id"]


@pytest.mark.parametrize("kw", [{"aud": "com.someone.else"}, {"exp_in": -10}, {"kid": "unknown"},
                                {"key": rsa.generate_private_key(public_exponent=65537, key_size=2048)}])  # fmt: skip
def test_bad_apple_tokens_are_refused(client, kw):
    r = apple_sign_in(client, **kw)
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_token"


def test_nonce_must_match(client):
    r = client.post("/v1/auth/apple", json={"identity_token": apple_token(nonce="real"), "nonce": "replayed"})
    assert r.status_code == 401


def test_google_sign_in_creates_one_account(client):
    tok = google_token(email="mei@gmail.com", email_verified=True, name="Mei Lin")
    first = client.post("/v1/auth/google", json={"id_token": tok}).json()
    assert first["user"]["name"] == "Mei Lin" and first["user"]["email"] == "mei@gmail.com"
    again = client.post("/v1/auth/google", json={"id_token": google_token()}).json()
    assert again["user"]["id"] == first["user"]["id"] and again["user"]["name"] == "Mei Lin"
    # An Apple account is a different account, even for the same person.
    assert apple_sign_in(client).json()["user"]["id"] != first["user"]["id"]


def test_unverified_google_email_is_not_kept(client):
    r = client.post("/v1/auth/google", json={"id_token": google_token(email="who@example.com", email_verified=False)})
    assert r.json()["user"]["email"] is None


@pytest.mark.parametrize("kw", [{"aud": "someone-else"}, {"exp_in": -10}, {"iss": "https://evil.example"}])
def test_bad_google_tokens_are_refused(client, kw):
    r = client.post("/v1/auth/google", json={"id_token": google_token(**kw)})
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_token"


def test_google_sign_in_is_off_without_a_client_id(settings, cfg):
    cfg.auth.google_client_ids = []
    with TestClient(create_app(settings, cfg)) as client:
        assert client.post("/v1/auth/google", json={"id_token": google_token()}).status_code == 404


def test_sign_out_and_delete(client, auth_headers):
    token = apple_sign_in(client).json()["token"]
    assert client.post("/v1/auth/sign-out", headers=bearer(token)).status_code == 204
    assert client.get("/v1/me", headers=bearer(token)).status_code == 401

    token = apple_sign_in(client).json()["token"]
    user_id = client.get("/v1/me", headers=bearer(token)).json()["id"]
    assert client.delete("/v1/me", headers=bearer(token)).status_code == 204
    assert client.get("/v1/me", headers=bearer(token)).status_code == 401
    assert apple_sign_in(client).json()["user"]["id"] != user_id  # a fresh account next time
    assert client.get("/v1/me", headers=auth_headers).status_code == 200  # other accounts untouched


def test_deleting_an_account_removes_all_its_sessions(client, conn):
    first = apple_sign_in(client).json()["token"]
    second = apple_sign_in(client).json()["token"]
    assert client.delete("/v1/me", headers=bearer(first)).status_code == 204
    assert client.get("/v1/me", headers=bearer(second)).status_code == 401
    assert conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0


def test_signed_out_calls_need_an_account(client):
    for headers in ({}, {"Authorization": "Bearer nonsense"}, {"Authorization": "Basic abc"}):
        r = client.get("/v1/me", headers=headers)
        assert r.status_code == 401 and r.json()["error"]["code"] == "sign_in_required"


def test_idle_sessions_expire(client, conn, auth_headers):
    with conn:
        conn.execute("UPDATE sessions SET last_used_at = '2020-01-01T00:00:00Z'")
    assert client.get("/v1/me", headers=auth_headers).status_code == 401


def test_dev_sign_in_only_when_enabled(client, monkeypatch):
    assert client.post("/v1/auth/dev", json={"name": "me"}).status_code == 404
    monkeypatch.setenv("EKSIGO_DEV_LOGIN", "1")
    r = client.post("/v1/auth/dev", json={"name": "me"})
    assert r.status_code == 200 and r.json()["user"]["name"] == "me"
