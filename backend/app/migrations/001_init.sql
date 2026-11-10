-- Accounts and sessions (DESIGN.md section 8). v2 starts with a fresh database; v1's stays in its own volume.

CREATE TABLE users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,  -- never reused, so a new account can't inherit a deleted one's data
    apple_sub   TEXT UNIQUE,
    google_sub  TEXT UNIQUE,
    dev_name    TEXT UNIQUE,  -- local development only (EKSIGO_DEV_LOGIN=1)
    email       TEXT,
    name        TEXT,
    plan        TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'premium')),
    created_at  TEXT NOT NULL
);

CREATE TABLE sessions (
    token_hash    TEXT PRIMARY KEY,  -- sha256 of the token; the token itself is never stored
    user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at    TEXT NOT NULL,
    last_used_at  TEXT NOT NULL
);

CREATE INDEX sessions_user ON sessions (user_id);
