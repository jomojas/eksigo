"""SQLite connection and migrations. Plain sqlite3, no ORM. The database holds only accounts and, later, small
synced text (DESIGN.md section 7): never audio."""

import fcntl
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 10000")
    return conn


def migrate(conn: sqlite3.Connection) -> None:
    """Apply numbered migration files that haven't run yet."""
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
    done = {r["version"] for r in conn.execute("SELECT version FROM schema_migrations")}
    for file in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if file.stem in done:
            continue
        # One transaction per file: a failing migration leaves the database unchanged.
        conn.executescript(
            "BEGIN;\n"
            + file.read_text(encoding="utf-8")
            + f"\nINSERT INTO schema_migrations VALUES ('{file.stem}', '{now_iso()}');\nCOMMIT;"
        )


def open_db(path: Path) -> sqlite3.Connection:
    """Connect and apply migrations. A file lock stops two processes started at the same moment on the same
    volume (the API and an operator command) from migrating at the same time."""
    conn = connect(path)
    with open(path.with_suffix(".migrate.lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            migrate(conn)
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
    return conn
