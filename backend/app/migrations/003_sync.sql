-- Sync (DESIGN.md section 7): small records the apps keep the same across devices. The server doesn't look inside
-- them; each app knows its kinds. Deleted with the account.

CREATE TABLE sync_records (
    user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,     -- word, review, missed, practice, day, listen
    key         TEXT NOT NULL,     -- the record's identity within its kind, chosen by the apps
    data        TEXT NOT NULL,     -- JSON; '{}' once deleted
    deleted     INTEGER NOT NULL DEFAULT 0,
    changed_at  INTEGER NOT NULL,  -- when it was changed on the device (unix ms): the latest change wins
    seq         INTEGER NOT NULL,  -- the account's change counter when the server stored it
    PRIMARY KEY (user_id, kind, key)
);

CREATE INDEX sync_records_since ON sync_records (user_id, seq);

-- Per account: the change counter, and the stored size for the cap.
CREATE TABLE sync_accounts (
    user_id  INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    seq      INTEGER NOT NULL DEFAULT 0,
    bytes    INTEGER NOT NULL DEFAULT 0
);
