// Each Mind checks its schema version on start and migrates itself.
// Migrations only ever add; the events table is never rewritten.

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  -- The record. Bodies are encrypted with your data key once per-person keys land.
  CREATE TABLE events (
    seq    INTEGER PRIMARY KEY,
    id     TEXT NOT NULL UNIQUE,
    kind   TEXT NOT NULL,
    at     INTEGER NOT NULL,
    device TEXT NOT NULL,
    body   TEXT NOT NULL
  );

  -- Every line, yours and Ra's.
  CREATE TABLE utterances (
    id        TEXT PRIMARY KEY,
    seq       INTEGER NOT NULL,
    ray_id    TEXT,
    speaker   TEXT NOT NULL,
    start_ms  INTEGER NOT NULL,
    end_ms    INTEGER NOT NULL,
    text      TEXT NOT NULL,
    prosody   TEXT,
    audio_key TEXT
  );
  CREATE INDEX utterances_ray ON utterances (ray_id);

  -- What Ra thinks it knows, with the utterances it came from.
  CREATE TABLE memories (
    id          TEXT PRIMARY KEY,
    claim       TEXT NOT NULL,
    confidence  REAL NOT NULL,
    sources     TEXT NOT NULL,
    updated_seq INTEGER NOT NULL
  );

  -- Views computed from events by the shared reducer.
  CREATE TABLE views (name TEXT PRIMARY KEY, seq INTEGER NOT NULL, json TEXT NOT NULL);

  -- Due times sharing the one DO alarm: the Watch, Dial review dates.
  CREATE TABLE schedule (name TEXT PRIMARY KEY, due_at INTEGER NOT NULL, payload TEXT);
  `,
  // v2: a Ray's moment in progress (the question offered, the window shown,
  // the trips on screen), so it survives the Mind hibernating mid-Ray.
  `
  CREATE TABLE moments (
    ray_id TEXT NOT NULL,
    stage  TEXT NOT NULL,
    json   TEXT NOT NULL,
    PRIMARY KEY (ray_id, stage)
  );
  `,
  // v3: where to knock for content-free notifications, one row per phone.
  `
  CREATE TABLE push (endpoint TEXT PRIMARY KEY, json TEXT NOT NULL, at INTEGER NOT NULL);
  `,
  // v4: G3, an embedding of each of your lines (sealed), so the Watch can find the same topic months apart.
  `
  CREATE TABLE vecs (utterance_id TEXT PRIMARY KEY, at INTEGER NOT NULL, vec TEXT NOT NULL);
  `,
  // v5: private regression examples remain sealed inside their originating Mind.
  `CREATE TABLE audit_cases (id TEXT PRIMARY KEY, body TEXT NOT NULL);`,
  // v6: opaque progress only; words and vectors remain account-encrypted.
  `CREATE TABLE IF NOT EXISTS embedding_work (utterance_id TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL DEFAULT 0,skipped INTEGER NOT NULL DEFAULT 0);`,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function migrate(sql: SqlStorage): number {
  const hasMeta = sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").toArray().length > 0;
  let version = 0;
  if (hasMeta) {
    const row = sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'schema'").toArray()[0];
    version = row ? Number(row.value) : 0;
  }
  for (let v = version; v < MIGRATIONS.length; v++) {
    sql.exec(MIGRATIONS[v]!);
    sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)", String(v + 1));
  }
  return MIGRATIONS.length;
}
