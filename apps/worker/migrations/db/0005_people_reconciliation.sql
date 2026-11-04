-- Durable, content-free projection work. Revisions survive successful delivery.
CREATE TABLE people_jobs (
  account TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('intro', 'witness')),
  ref TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  delivered INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account, kind, ref)
);
CREATE INDEX people_jobs_pending ON people_jobs(account, delivered, revision);
CREATE TABLE people_erased (account TEXT PRIMARY KEY);
ALTER TABLE witness_requests ADD COLUMN summary TEXT NOT NULL DEFAULT 'A landfall.';

-- Repair relationships written before durable projection delivery existed.
INSERT OR IGNORE INTO people_jobs(account, kind, ref) SELECT a, 'intro', id FROM intros;
INSERT OR IGNORE INTO people_jobs(account, kind, ref) SELECT b, 'intro', id FROM intros;
INSERT OR IGNORE INTO people_jobs(account, kind, ref) SELECT owner, 'witness', id FROM witness_requests;
INSERT OR IGNORE INTO people_jobs(account, kind, ref) SELECT witness, 'witness', id FROM witness_requests;

ALTER TABLE intros ADD COLUMN a_answer INTEGER;
ALTER TABLE intros ADD COLUMN b_answer INTEGER;
UPDATE intros SET a_answer = 1 WHERE state IN ('asked-b','introduced');
UPDATE intros SET b_answer = 1 WHERE state = 'introduced';

-- Only contact details explicitly shared with this particular crewmate.
CREATE TABLE crew_contacts (
  owner TEXT NOT NULL,
  recipient TEXT NOT NULL,
  intro_id TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY(owner, recipient)
);
