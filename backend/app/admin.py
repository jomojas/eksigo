"""Operator commands, run on the VPS from /opt/eab:

    docker compose exec api python -m app.admin users
    docker compose exec api python -m app.admin plan <user_id> free|premium
    docker compose exec api python -m app.admin backup [--keep 14]
"""

import argparse
import sqlite3
import sys
from datetime import UTC, datetime

from app.config import Settings, get_settings
from app.db import open_db


def cmd_users(args, conn: sqlite3.Connection, settings: Settings) -> int:
    for r in conn.execute("SELECT u.*, (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS sessions "
                          "FROM users u ORDER BY u.id"):  # fmt: skip
        via = "apple" if r["apple_sub"] else "google" if r["google_sub"] else "dev"
        print(f"#{r['id']}  {r['plan']:<7}  {via:<6}  {r['name'] or '-'}  {r['email'] or '-'}  "
              f"since {r['created_at'][:10]}  {r['sessions']} session(s)")  # fmt: skip
    return 0


def cmd_plan(args, conn: sqlite3.Connection, settings: Settings) -> int:
    """Set an account's plan by hand (before web checkout exists, DESIGN.md section 6)."""
    with conn:
        changed = conn.execute("UPDATE users SET plan = ? WHERE id = ?", (args.plan, args.user_id)).rowcount
    if not changed:
        print(f"no user #{args.user_id}", file=sys.stderr)
        return 1
    print(f"#{args.user_id} is now {args.plan}")
    return 0


def cmd_backup(args, conn: sqlite3.Connection, settings: Settings) -> int:
    """Consistent copy of the database (safe while the API is running). Run nightly from cron on the VPS."""
    backups = settings.data_dir / "backups"
    backups.mkdir(parents=True, exist_ok=True)
    dest = backups / f"app-{datetime.now(UTC):%Y%m%d-%H%M%S}.db"
    with sqlite3.connect(dest) as out:
        conn.backup(out)
    for old in sorted(backups.glob("app-*.db"))[: -args.keep]:
        old.unlink()
    print(dest)
    return 0


def main(argv: list[str] | None = None, settings: Settings | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.admin")
    sub = parser.add_subparsers(required=True)
    sub.add_parser("users", help="list accounts").set_defaults(func=cmd_users)
    p = sub.add_parser("plan", help="set an account's plan")
    p.add_argument("user_id", type=int)
    p.add_argument("plan", choices=["free", "premium"])
    p.set_defaults(func=cmd_plan)
    p = sub.add_parser("backup", help="back up the database to <data>/backups")
    p.add_argument("--keep", type=int, default=14)
    p.set_defaults(func=cmd_backup)
    args = parser.parse_args(argv)

    settings = settings or get_settings()
    conn = open_db(settings.db_path)
    try:
        return args.func(args, conn, settings)
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
