-- The Ear (A5): a keyed hash of a WhatsApp ID, never the number, and short-lived link codes.
CREATE TABLE ear_links (
  wa_hash TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  discreet INTEGER NOT NULL DEFAULT 1,
  linked_at INTEGER NOT NULL
);
CREATE INDEX ear_links_account ON ear_links (account);

CREATE TABLE ear_codes (
  code TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  discreet INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL
);
