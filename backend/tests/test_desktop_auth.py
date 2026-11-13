"""Signing in on the desktop through the browser (desktop_auth.py, DESIGN.md section 8)."""

import base64
import hashlib
import json
import secrets
import time
import urllib.parse

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app import auth, desktop_auth, http
from app.main import create_app
from tests.test_auth import KEY, _init_keys, apple_token, bearer, google_token

WEB_CLIENT = "web-1.apps.googleusercontent.com"
SERVICES_ID = "com.eksigo.desktop"
APPLE_KEY = ec.generate_private_key(ec.SECP256R1())
APPLE_PEM = APPLE_KEY.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                    serialization.NoEncryption()).decode()  # fmt: skip


@pytest.fixture
def posts(monkeypatch):
    """What the server posts to Apple and Google; answers come from `posts.answer`."""
    calls = []

    def post_form(url, data, timeout=20):
        calls.append((url, data))
        return posts.answer(url, data)

    posts = type("Posts", (), {"calls": calls, "answer": staticmethod(lambda url, data: {})})()
    monkeypatch.setattr(http, "post_form", post_form)
    return posts


@pytest.fixture
def client(settings, cfg, monkeypatch, posts):
    monkeypatch.setattr(auth.SigningKeys, "__init__", _init_keys)
    cfg.auth.google_web_client_id = WEB_CLIENT
    cfg.auth.apple_services_id = SERVICES_ID
    cfg.auth.apple_team_id, cfg.auth.apple_key_id = "TEAM123", "KEY123"
    settings = type(settings)(**{**settings.__dict__, "google_client_secret": "shh", "apple_private_key": APPLE_PEM})
    with TestClient(create_app(settings, cfg), follow_redirects=False) as c:
        yield c


def pkce():
    verifier = secrets.token_urlsafe(48)
    return verifier, base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


def start(client, provider, port=51234, state="app-state-0123456789"):
    verifier, challenge = pkce()
    r = client.get(f"/v1/auth/desktop/{provider}", params={"port": port, "state": state, "challenge": challenge})
    assert r.status_code == 302, r.text
    query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(r.headers["location"]).query))
    return verifier, query


def app_got(r, state="app-state-0123456789", port=51234):
    """The query the app's listener received."""
    url = urllib.parse.urlsplit(r.headers["location"])
    assert f"{url.scheme}://{url.netloc}{url.path}" == f"http://127.0.0.1:{port}/callback"
    query = dict(urllib.parse.parse_qsl(url.query))
    assert query.pop("state") == state
    return query


def google_round_trip(client, posts, **claims):
    verifier, sent = start(client, "google")
    assert sent["client_id"] == WEB_CLIENT and sent["redirect_uri"] == "https://api.test/v1/auth/google/callback"
    posts.answer = lambda url, data: {"id_token": google_token(aud=WEB_CLIENT, nonce=sent["nonce"], **claims)}
    got = app_got(client.get("/v1/auth/google/callback", params={"state": sent["state"], "code": "g-code"}))
    return verifier, got


def test_google_on_the_desktop(client, posts):
    verifier, got = google_round_trip(client, posts, email="mei@gmail.com", email_verified=True, name="Mei Lin")
    url, data = posts.calls[0]
    assert url == desktop_auth.GOOGLE_TOKEN and data["code"] == "g-code" and data["client_secret"] == "shh"
    r = client.post("/v1/auth/desktop/token", json={"code": got["code"], "verifier": verifier})
    assert r.status_code == 200, r.text
    user = r.json()["user"]
    assert user["name"] == "Mei Lin" and user["email"] == "mei@gmail.com" and user["provider"] == "google"
    assert client.get("/v1/me", headers=bearer(r.json()["token"])).json()["id"] == user["id"]
    # The code works once.
    assert client.post("/v1/auth/desktop/token", json={"code": got["code"], "verifier": verifier}).status_code == 401


def test_signing_in_again_finds_the_same_account(client, posts):
    verifier, got = google_round_trip(client, posts)
    first = client.post("/v1/auth/desktop/token", json={"code": got["code"], "verifier": verifier}).json()
    verifier, got = google_round_trip(client, posts)
    again = client.post("/v1/auth/desktop/token", json={"code": got["code"], "verifier": verifier}).json()
    assert again["user"]["id"] == first["user"]["id"]


def test_only_the_app_that_started_can_finish(client, posts):
    _, got = google_round_trip(client, posts)
    other, _ = pkce()
    r = client.post("/v1/auth/desktop/token", json={"code": got["code"], "verifier": other})
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_token"


def test_a_wrong_nonce_fails_back_to_the_app(client, posts):
    _, sent = start(client, "google")
    posts.answer = lambda url, data: {"id_token": google_token(aud=WEB_CLIENT, nonce="someone-elses")}
    got = app_got(client.get("/v1/auth/google/callback", params={"state": sent["state"], "code": "c"}))
    assert got == {"error": "failed"}


def test_cancelling_at_google(client):
    _, sent = start(client, "google")
    got = app_got(client.get("/v1/auth/google/callback", params={"state": sent["state"], "error": "access_denied"}))
    assert got == {"error": "cancelled"}
    # The request is gone, so its tab can't be replayed.
    r = client.get("/v1/auth/google/callback", params={"state": sent["state"], "code": "c"})
    assert r.status_code == 400 and "didn't work" in r.text


def test_an_old_sign_in_is_refused(client, conn):
    _, sent = start(client, "google")
    with conn:
        conn.execute("UPDATE desktop_sign_ins SET created = ?", (int(time.time()) - desktop_auth.SIGN_IN_SECONDS - 1,))
    r = client.get("/v1/auth/google/callback", params={"state": sent["state"], "code": "c"})
    assert r.status_code == 400 and r.headers["content-type"].startswith("text/html")


def test_apple_on_the_desktop_and_deleting_revokes(client, posts):
    verifier, sent = start(client, "apple")
    assert sent["client_id"] == SERVICES_ID and sent["response_mode"] == "form_post"
    posts.answer = lambda url, data: {"refresh_token": "apple-refresh"}

    # The nonce Apple got is the SHA-256 of the one the server keeps; the token carries it as given.
    def token(**kw):
        now = int(time.time())
        claims = {"iss": "https://appleid.apple.com", "aud": SERVICES_ID, "sub": "001.apple", "iat": now,
                  "exp": now + 600, "nonce": sent["nonce"], "email": "x@privaterelay.appleid.com", **kw}  # fmt: skip
        return jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": "k1"})

    form = {"state": sent["state"], "code": "a-code", "id_token": token(),
            "user": json.dumps({"name": {"firstName": "Mei", "lastName": "Lin"}})}  # fmt: skip
    r = client.post("/v1/auth/apple/callback", data=form)
    assert r.status_code == 303, r.text
    got = app_got(r)
    url, data = posts.calls[0]
    assert url == desktop_auth.APPLE_TOKEN and data["client_id"] == SERVICES_ID and data["code"] == "a-code"
    signed = client.post("/v1/auth/desktop/token", json={"code": got["code"], "verifier": verifier}).json()
    assert signed["user"]["name"] == "Mei Lin" and signed["user"]["provider"] == "apple"

    assert client.delete("/v1/me", headers=bearer(signed["token"])).status_code == 204
    url, data = posts.calls[-1]
    assert url == desktop_auth.APPLE_REVOKE and data["token"] == "apple-refresh" and data["client_id"] == SERVICES_ID


def test_apple_token_for_another_app_is_refused(client, posts):
    _, sent = start(client, "apple")
    form = {"state": sent["state"], "id_token": apple_token(aud="com.eksigo.app")}
    assert app_got(client.post("/v1/auth/apple/callback", data=form)) == {"error": "failed"}


def test_cancelling_at_apple(client):
    _, sent = start(client, "apple")
    r = client.post("/v1/auth/apple/callback", data={"state": sent["state"], "error": "user_cancelled_authorize"})
    assert app_got(r) == {"error": "cancelled"}


def test_providers_that_are_not_set_up(settings, cfg):
    cfg.auth.google_web_client_id = cfg.auth.apple_services_id = ""
    _, challenge = pkce()
    with TestClient(create_app(settings, cfg), follow_redirects=False) as c:
        for provider in ("apple", "google"):
            r = c.get(f"/v1/auth/desktop/{provider}", params={"port": 5000, "state": "s" * 20, "challenge": challenge})
            assert r.status_code == 404


@pytest.mark.parametrize("port", [80, 70000])
def test_the_app_listens_on_an_ordinary_port(client, port):
    _, challenge = pkce()
    r = client.get("/v1/auth/desktop/google", params={"port": port, "state": "s" * 20, "challenge": challenge})
    assert r.status_code == 400


def test_the_done_page(client):
    ok = client.get("/v1/auth/done", params={"ok": 1, "provider": "google"})
    assert "You're signed in" in ok.text and "Signed in with Google" in ok.text
    failed = client.get("/v1/auth/done", params={"provider": "apple"})
    assert "Apple didn't confirm" in failed.text
