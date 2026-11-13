"""Sync (DESIGN.md section 7, API.md "Sync"): one call sends a device's changes and returns everything that changed
since its last sync.

Records are opaque JSON keyed by (kind, key). The latest change wins, by the time it was made on the device; a
deleted record stays as a marker so the deletion reaches the other devices. Each stored change takes the next number
of the account's counter, and a device asks for the changes after the last number it saw.
"""

import json
import sqlite3
from typing import Any

from app.errors import APIError

KINDS = {"word", "review", "missed", "practice", "day", "listen"}
MAX_CHANGES = 500  # per request
MAX_RECORD = 16 * 1024  # bytes of JSON per record
MAX_ACCOUNT = 20 * 1024 * 1024  # a heavy learner needs about 3 MB
PAGE = 1000  # changes returned per request; `more` says there are others


def _size(kind: str, key: str, data: str) -> int:
    return len(kind) + len(key.encode()) + len(data.encode())


def apply(conn: sqlite3.Connection, user_id: int, since: int, changes: list[dict[str, Any]]) -> dict[str, Any]:
    """Store the device's changes, then return the changes after `since` that the device doesn't have."""
    if len(changes) > MAX_CHANGES:
        raise APIError(400, "bad_request", f"At most {MAX_CHANGES} changes per request")
    mine: set[tuple[str, str]] = set()  # stored from this request: the device already has them
    with conn:
        conn.execute("INSERT OR IGNORE INTO sync_accounts (user_id) VALUES (?)", (user_id,))
        acc = conn.execute("SELECT seq, bytes FROM sync_accounts WHERE user_id = ?", (user_id,)).fetchone()
        seq, total = acc["seq"], acc["bytes"]
        # Further than the server has got (it was restored from a backup): start over, and the device sends all.
        reset = since > seq
        if reset:
            since = 0
        for c in changes:
            kind, key, at, deleted = c["kind"], c["key"], c["changedAt"], bool(c.get("deleted"))
            data = "{}" if deleted else json.dumps(c.get("data") or {}, ensure_ascii=False, separators=(",", ":"))
            if kind not in KINDS:
                raise APIError(400, "bad_request", f"Unknown kind: {kind}")
            if len(data.encode()) > MAX_RECORD:
                raise APIError(400, "bad_request", f"A {kind} record is larger than {MAX_RECORD} bytes")
            old = conn.execute("SELECT data, changed_at FROM sync_records WHERE user_id = ? AND kind = ? AND key = ?",
                               (user_id, kind, key)).fetchone()  # fmt: skip
            if old is not None and old["changed_at"] > at:
                continue  # changed later on another device: that version comes back in the answer
            total += _size(kind, key, data) - (_size(kind, key, old["data"]) if old else 0)
            if total > MAX_ACCOUNT:
                raise APIError(413, "sync_full", "This account has reached the sync limit")
            seq += 1
            conn.execute("INSERT INTO sync_records (user_id, kind, key, data, deleted, changed_at, seq) "
                         "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, kind, key) DO UPDATE SET "
                         "data = excluded.data, deleted = excluded.deleted, changed_at = excluded.changed_at, "
                         "seq = excluded.seq", (user_id, kind, key, data, int(deleted), at, seq))  # fmt: skip
            mine.add((kind, key))
        conn.execute("UPDATE sync_accounts SET seq = ?, bytes = ? WHERE user_id = ?", (seq, total, user_id))

    rows = conn.execute("SELECT kind, key, data, deleted, changed_at, seq FROM sync_records "
                        "WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?", (user_id, since, PAGE + 1)).fetchall()  # fmt: skip
    more = len(rows) > PAGE
    rows = rows[:PAGE]
    cursor = rows[-1]["seq"] if more else seq
    out = []
    for r in rows:
        if (r["kind"], r["key"]) in mine:
            continue
        item: dict[str, Any] = {"kind": r["kind"], "key": r["key"], "changedAt": r["changed_at"]}
        if r["deleted"]:
            item["deleted"] = True
        else:
            item["data"] = json.loads(r["data"])
        out.append(item)
    answer: dict[str, Any] = {"cursor": cursor, "changes": out, "more": more}
    if reset:
        answer["reset"] = True
    return answer
