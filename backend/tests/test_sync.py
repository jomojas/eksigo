"""Sync: changes from one device reach the other, the latest change wins, deletions travel, accounts are apart."""

from app import sync
from tests.conftest import sign_in


def post(client, headers, since=0, changes=()):
    r = client.post("/v1/sync", headers=headers, json={"since": since, "changes": list(changes)})
    assert r.status_code == 200, r.text
    return r.json()


def word(text, meaning, at, **more):
    return {"kind": "word", "key": text.lower(), "changedAt": at, "data": {"text": text, "meaning": meaning}, **more}


def test_needs_an_account(client):
    r = client.post("/v1/sync", json={"since": 0, "changes": []})
    assert r.status_code == 401 and r.json()["error"]["code"] == "sign_in_required"


def test_a_word_saved_on_the_desktop_reaches_the_phone(client, auth_headers):
    desktop = post(client, auth_headers, 0, [word("follow through", "贯彻到底", 1000)])
    assert desktop["changes"] == [] and desktop["cursor"] == 1  # the desktop isn't sent back its own change
    phone = post(client, auth_headers, 0)
    assert phone["changes"] == [{"kind": "word", "key": "follow through", "changedAt": 1000,
                                 "data": {"text": "follow through", "meaning": "贯彻到底"}}]  # fmt: skip
    assert phone["cursor"] == 1 and not phone["more"]
    assert post(client, auth_headers, phone["cursor"])["changes"] == []


def test_the_latest_change_wins(client, auth_headers):
    post(client, auth_headers, 0, [word("gist", "newer", 2000)])
    older = post(client, auth_headers, 0, [word("gist", "older", 1000)])
    # The older edit is refused, and the device gets the newer one back.
    assert [c["data"]["meaning"] for c in older["changes"]] == ["newer"]
    assert post(client, auth_headers, 0)["changes"][0]["data"]["meaning"] == "newer"


def test_a_deletion_reaches_the_other_devices(client, auth_headers):
    first = post(client, auth_headers, 0, [word("gist", "要点", 1000)])
    post(client, auth_headers, first["cursor"], [{"kind": "word", "key": "gist", "changedAt": 2000, "deleted": True}])
    other = post(client, auth_headers, first["cursor"])
    assert other["changes"] == [{"kind": "word", "key": "gist", "changedAt": 2000, "deleted": True}]


def test_accounts_dont_see_each_other(client, settings, auth_headers):
    post(client, auth_headers, 0, [word("gist", "要点", 1000)])
    other = sign_in(settings, "someone else")
    assert post(client, other, 0) == {"cursor": 0, "changes": [], "more": False}


def test_pages_of_changes(client, auth_headers, monkeypatch):
    monkeypatch.setattr(sync, "PAGE", 2)
    post(client, auth_headers, 0, [word(f"w{i}", "", 1000) for i in range(5)])
    seen, since = [], 0
    while True:
        r = post(client, auth_headers, since)
        seen += [c["key"] for c in r["changes"]]
        since = r["cursor"]
        if not r["more"]:
            break
    assert seen == [f"w{i}" for i in range(5)] and since == 5


def test_a_server_restored_from_a_backup_asks_for_everything(client, auth_headers):
    post(client, auth_headers, 0, [word("gist", "要点", 1000)])
    r = post(client, auth_headers, 99)
    assert r["reset"] is True and [c["key"] for c in r["changes"]] == ["gist"]


def test_limits(client, auth_headers, monkeypatch):
    bad = client.post("/v1/sync", headers=auth_headers, json={"changes": [{"kind": "audio", "key": "x", "changedAt": 1}]})
    assert bad.status_code == 400
    huge = word("x", "y" * (sync.MAX_RECORD + 1), 1)
    assert client.post("/v1/sync", headers=auth_headers, json={"changes": [huge]}).status_code == 400
    monkeypatch.setattr(sync, "MAX_ACCOUNT", 300)
    full = client.post("/v1/sync", headers=auth_headers, json={"changes": [word(f"w{i}", "x" * 50, 1) for i in range(10)]})
    assert full.status_code == 413 and full.json()["error"]["code"] == "sync_full"
    # Nothing of a refused request is kept.
    assert post(client, auth_headers, 0)["changes"] == []


def test_deleting_the_account_deletes_its_synced_data(client, settings, auth_headers, conn):
    post(client, auth_headers, 0, [word("gist", "要点", 1000)])
    assert client.delete("/v1/me", headers=auth_headers).status_code == 204
    assert conn.execute("SELECT COUNT(*) FROM sync_records").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM sync_accounts").fetchone()[0] == 0
