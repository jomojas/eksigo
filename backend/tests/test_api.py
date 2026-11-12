"""Health, offline dictionaries, cover art and the error format."""

import hashlib

import pytest

from app import artwork, dictionaries


def test_health(client):
    assert client.get("/v1/health").json() == {"status": "ok"}


def test_dictionaries_list_matches_the_files(client):
    r = client.get("/v1/dictionaries")
    assert r.status_code == 200
    items = r.json()["dictionaries"]
    assert {d["lang"] for d in items} == {"en", "es", "fr", "ja", "ko", "zh"}
    for d in items:
        assert d["url"].startswith("https://api.test/dictionaries/")
        name = d["url"].rsplit("/", 1)[1]
        assert hashlib.sha256((dictionaries.DIR / name).read_bytes()).hexdigest() == d["sha256"]
        assert (dictionaries.DIR / name).stat().st_size == d["bytes"]


def test_dictionary_list_answers_304_when_unchanged(client):
    etag = client.get("/v1/dictionaries").headers["etag"]
    assert client.get("/v1/dictionaries", headers={"If-None-Match": etag}).status_code == 304


def test_dictionary_file(client):
    name = dictionaries.entries()[0]["file"]
    r = client.get(f"/dictionaries/{name}")
    assert r.status_code == 200 and "immutable" in r.headers["cache-control"]
    assert client.get("/dictionaries/../app.db").status_code == 404
    assert client.get("/dictionaries/nope.sqlite").json()["error"]["code"] == "not_found"


@pytest.mark.parametrize("url", ["ftp://example.com/a.jpg", "http://127.0.0.1/a.jpg", "http://localhost/a.jpg",
                                 "http://10.0.0.1/a.jpg", "http://169.254.169.254/latest/meta-data", "not a url"])  # fmt: skip
def test_art_refuses_non_public_urls(client, url):
    r = client.get("/v1/art", params={"url": url})
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_art_serves_the_cached_copy(client, settings):
    url = "https://images.example/cover.jpg"
    cached = settings.data_dir / "artwork" / f"{hashlib.sha1(url.encode()).hexdigest()}.jpg"
    cached.parent.mkdir(parents=True)
    cached.write_bytes(b"\xff\xd8 fake jpeg")
    r = client.get("/v1/art", params={"url": url})
    assert r.status_code == 200 and r.content == b"\xff\xd8 fake jpeg" and r.headers["content-type"] == "image/jpeg"


def test_check_url_accepts_public_hosts(monkeypatch):
    monkeypatch.setattr(artwork.socket, "getaddrinfo", lambda host, port: [(None, None, None, None, ("93.184.215.14", 0))])
    artwork.check_url("https://images.example/cover.jpg")


def test_validation_errors_use_the_error_format(client):
    r = client.post("/v1/auth/apple", json={"identity_token": "short"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_request"


def test_unknown_paths(client):
    assert client.get("/v1/nothing-here").json()["error"]["code"] == "not_found"
    # v1's endpoints are gone.
    for path in ("/v1/breakdown", "/v1/purchases/apple", "/v1/practice/score"):
        assert client.post(path, json={}).status_code == 404
