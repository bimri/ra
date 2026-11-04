-- The ledger (K1): voyages, funders, payments. Its own database with no route
-- to any Mind: a voyage belongs to a "holder", a keyed hash of the account
-- that only the Worker (with the master key) can make. Nothing here joins to
-- accounts, beacons or minds.

CREATE TABLE funders (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,           -- shown to the people it funds: Ra always says who
  mission      TEXT NOT NULL,           -- what journeys it backs, in its words
  mission_vec  TEXT,                    -- bge-m3, JSON
  token_hash   TEXT NOT NULL UNIQUE,    -- the funder's API token, hashed
  budget_cents INTEGER NOT NULL DEFAULT 0,
  upfront      REAL NOT NULL DEFAULT 0.3, -- share paid when a voyage starts; the rest on markers and landfall
  created_at   INTEGER NOT NULL
);

-- What a voyage costs where you are, when it isn't funded. Empty until prices are set per country.
CREATE TABLE prices (
  country      TEXT PRIMARY KEY,        -- ISO 3166 alpha-2
  amount_cents INTEGER NOT NULL,
  currency     TEXT NOT NULL
);

CREATE TABLE voyages (
  id           TEXT PRIMARY KEY,
  holder       TEXT NOT NULL,           -- keyed hash, never an account id
  island       TEXT NOT NULL,
  markers      INTEGER NOT NULL,
  funder_id    TEXT,
  amount_cents INTEGER,                 -- the voyage's value: the funder's grant or the person's price
  currency     TEXT,
  state        TEXT NOT NULL,           -- open · landed · closed
  started_at   INTEGER NOT NULL,
  closed_at    INTEGER
);
CREATE INDEX voyages_holder ON voyages (holder);

-- Money owed or paid. Without a payment provider yet, everything is "pending".
CREATE TABLE payments (
  id           TEXT PRIMARY KEY,
  voyage_id    TEXT,
  payer        TEXT NOT NULL,           -- funder:<id> · holder:<hash> · employer:<id>
  kind         TEXT NOT NULL,           -- upfront · marker · landfall · price · forward · placement
  amount_cents INTEGER NOT NULL,
  currency     TEXT NOT NULL,
  state        TEXT NOT NULL,           -- pending · paid
  provider_ref TEXT,
  at           INTEGER NOT NULL
);

-- A signed claim you chose to share: a marker reached, or landfall. No evidence, no words.
CREATE TABLE claims (
  id           TEXT PRIMARY KEY,
  voyage_id    TEXT NOT NULL,
  funder_id    TEXT,
  kind         TEXT NOT NULL,           -- marker · landfall
  payload      TEXT NOT NULL,
  signature    TEXT NOT NULL,
  at           INTEGER NOT NULL
);

-- Pay it forward: a pledge from someone who arrived, toward someone else's voyage.
CREATE TABLE pledges (
  id           TEXT PRIMARY KEY,
  holder       TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency     TEXT NOT NULL,
  state        TEXT NOT NULL,           -- pledged · paid
  at           INTEGER NOT NULL
);

-- An employer's placement fee, owed only after an introduction both sides said yes to.
CREATE TABLE placements (
  id           TEXT PRIMARY KEY,
  employer     TEXT NOT NULL,
  intro_ref    TEXT NOT NULL,           -- keyed hash of the introduction id
  fee_cents    INTEGER NOT NULL,
  currency     TEXT NOT NULL,
  state        TEXT NOT NULL,
  at           INTEGER NOT NULL
);
