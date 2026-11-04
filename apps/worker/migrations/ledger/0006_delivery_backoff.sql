-- Retry metadata contains no private payload. Pending work survives restart.
ALTER TABLE voyages ADD COLUMN delivery_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE voyages ADD COLUMN retry_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE claims ADD COLUMN delivery_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE claims ADD COLUMN retry_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pledges ADD COLUMN delivery_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pledges ADD COLUMN retry_at INTEGER NOT NULL DEFAULT 0;
