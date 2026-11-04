-- Layer 3, people (H1–H3, G4, G5, safety). Only what someone chose to make
-- findable lives here: a beacon in their own words, introductions, crews,
-- witness requests and shared postcards. Matching reads beacons, never minds.

CREATE TABLE beacons (
  account     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,           -- the name crewmates see, as they chose it
  text        TEXT NOT NULL,           -- the beacon, in their words
  star        TEXT NOT NULL,
  island      TEXT,                    -- only when "star + island" shines
  minor       INTEGER NOT NULL DEFAULT 0,
  landfalls   INTEGER NOT NULL DEFAULT 0,
  star_vec    TEXT,                    -- bge-m3 embedding, JSON
  island_vec  TEXT,
  lit         INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL
);

-- Two yeses, or nothing: asked-a → asked-b → introduced, or declined / expired.
CREATE TABLE intros (
  id          TEXT PRIMARY KEY,
  a           TEXT NOT NULL,           -- asked first
  b           TEXT NOT NULL,
  kind        TEXT NOT NULL,
  state       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX intros_a ON intros (a);
CREATE INDEX intros_b ON intros (b);

-- A crew is the people you were introduced to. One row per pair, a < b.
CREATE TABLE crew (
  a         TEXT NOT NULL,
  b         TEXT NOT NULL,
  intro_id  TEXT NOT NULL,
  at        INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);

-- G4: a crewmate asked to witness a landfall.
CREATE TABLE witness_requests (
  id           TEXT PRIMARY KEY,
  owner        TEXT NOT NULL,
  witness      TEXT NOT NULL,
  landfall_id  TEXT NOT NULL,
  state        TEXT NOT NULL,          -- asked · saw · not-yet
  at           INTEGER NOT NULL
);

-- G5: a landfall postcard; the snapshot itself is in R2 under share/<token>.
CREATE TABLE shares (
  token        TEXT PRIMARY KEY,
  account      TEXT NOT NULL,
  landfall_id  TEXT NOT NULL,
  at           INTEGER NOT NULL
);

-- Safety: blocking is mutual for matching; a report is read by a person.
CREATE TABLE blocks (
  account  TEXT NOT NULL,
  blocked  TEXT NOT NULL,
  at       INTEGER NOT NULL,
  PRIMARY KEY (account, blocked)
);
CREATE TABLE reports (
  id        TEXT PRIMARY KEY,
  reporter  TEXT NOT NULL,
  about     TEXT NOT NULL,
  intro_id  TEXT,
  at        INTEGER NOT NULL
);
