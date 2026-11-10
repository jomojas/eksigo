"""Operator commands (app/admin.py)."""

import sqlite3

from app import admin, auth


def test_users_and_plan(settings, conn, capsys):
    user_id = auth.upsert_dev_user(conn, "mei")
    assert admin.main(["plan", str(user_id), "premium"], settings) == 0
    assert conn.execute("SELECT plan FROM users WHERE id = ?", (user_id,)).fetchone()["plan"] == "premium"
    assert admin.main(["users"], settings) == 0
    assert f"#{user_id}  premium" in capsys.readouterr().out
    assert admin.main(["plan", "999", "free"], settings) == 1


def test_backup_keeps_the_newest(settings, conn, monkeypatch):
    auth.upsert_dev_user(conn, "mei")
    backups = settings.data_dir / "backups"
    backups.mkdir(parents=True)
    for day in range(1, 4):
        (backups / f"app-2026010{day}-000000.db").write_bytes(b"old")
    assert admin.main(["backup", "--keep", "2"], settings) == 0
    files = sorted(p.name for p in backups.glob("app-*.db"))
    assert len(files) == 2 and files[0] == "app-20260103-000000.db"
    with sqlite3.connect(backups / files[1]) as copy:
        assert copy.execute("SELECT name FROM users").fetchone()[0] == "mei"
