-- A3 / J3: a passphrase lock for phones without passkeys (an Android WebView
-- can't reach them). Only a slow salted hash is kept, never the passphrase.
CREATE TABLE passphrases (
  account_id  TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  salt        TEXT NOT NULL,
  hash        TEXT NOT NULL,
  iterations  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  failures    INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);
