-- Accounts: a passkey is the account. No password, no email (architecture page,
-- "Identity and privacy"). D1 only ever holds what someone chose to make
-- findable, plus what's needed to sign in; minds live in their own Durable Objects.

CREATE TABLE accounts (
  id           TEXT PRIMARY KEY,           -- also the Mind's name: MIND.getByName(id)
  created_at   INTEGER NOT NULL,
  -- Age bracket, set at sign-up (safety: beacons are off by default for minors).
  age_bracket  TEXT NOT NULL CHECK (age_bracket IN ('under-16', '16-17', 'adult')),
  -- This person's data key, wrapped (AES-KW) by the master key held as a Worker secret.
  -- Event bodies, utterance text and audio are encrypted with it. Deleting the
  -- account deletes this row, after which any copy left anywhere is unreadable.
  wrapped_key  TEXT NOT NULL,
  lang         TEXT NOT NULL DEFAULT 'en'
);

-- WebAuthn credentials (passkeys). One account, any number of devices (I1 "Devices · revoke a lost one").
CREATE TABLE credentials (
  id           TEXT PRIMARY KEY,           -- base64url credential id
  account_id   TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  public_key   TEXT NOT NULL,              -- base64url COSE key
  counter      INTEGER NOT NULL DEFAULT 0,
  transports   TEXT,                       -- JSON array
  device_name  TEXT,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX credentials_account ON credentials (account_id);

-- Signed-in sessions, as an opaque token in an HttpOnly cookie.
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,           -- SHA-256 of the cookie token, never the token itself
  account_id   TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  credential_id TEXT REFERENCES credentials (id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX sessions_account ON sessions (account_id);

-- One-time WebAuthn challenges, kept a few minutes.
CREATE TABLE challenges (
  id           TEXT PRIMARY KEY,
  challenge    TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('register', 'authenticate')),
  account_id   TEXT,
  expires_at   INTEGER NOT NULL
);
