-- Content-free message ownership and replay guards. No message, media ID or phone number is stored here.
ALTER TABLE ear_links ADD COLUMN generation TEXT;
CREATE TABLE ear_accounts (
  account TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1,
  delivered INTEGER NOT NULL DEFAULT 0
);
-- Old links require reauthorization: their earlier deliveries had no generation/receipt identity.
INSERT INTO ear_accounts(account) SELECT DISTINCT account FROM ear_links;
CREATE TABLE ear_operations (
  op_key TEXT PRIMARY KEY,
  claim_token TEXT NOT NULL,
  account TEXT,
  generation TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('link','capture','ignored')),
  discreet INTEGER NOT NULL DEFAULT 1,
  processed INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  reply_kind TEXT CHECK(reply_kind IN ('linked','kept','unheard','notLinked')),
  reply_state TEXT NOT NULL DEFAULT 'pending' CHECK(reply_state IN ('pending','blocked','attempting','sent','unknown'))
);
CREATE INDEX ear_operations_account ON ear_operations(account);
