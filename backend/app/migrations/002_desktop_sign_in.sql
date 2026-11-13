-- Signing in on the desktop through the browser (DESIGN.md section 8), and what revoking an Apple sign-in needs.

CREATE TABLE desktop_sign_ins (
    id          TEXT PRIMARY KEY,  -- the state sent to Apple or Google
    provider    TEXT NOT NULL CHECK (provider IN ('apple', 'google')),
    port        INTEGER NOT NULL,  -- the app's listener on 127.0.0.1
    app_state   TEXT NOT NULL,     -- echoed back to the app so it knows the answer is for its own request
    challenge   TEXT NOT NULL,     -- PKCE S256: only the app that started the sign-in can finish it
    nonce       TEXT NOT NULL,
    code_hash   TEXT UNIQUE,       -- the one-time code given to the app, once the provider has answered
    user_id     INTEGER REFERENCES users (id) ON DELETE CASCADE,
    created     INTEGER NOT NULL   -- unix seconds
);

-- Apple asks apps to revoke its tokens when an account is deleted. Only kept when the server has a Sign in with
-- Apple key to get one with.
ALTER TABLE users ADD COLUMN apple_refresh_token TEXT;
ALTER TABLE users ADD COLUMN apple_client_id TEXT;
