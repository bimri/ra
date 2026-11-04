-- Commercial terms are deliberately unset until explicitly configured.
ALTER TABLE funders ADD COLUMN grant_cents INTEGER;
ALTER TABLE funders ADD COLUMN currency TEXT;
ALTER TABLE funders ADD COLUMN terms_configured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE voyages ADD COLUMN upfront REAL;
ALTER TABLE voyages ADD COLUMN reserved INTEGER NOT NULL DEFAULT 0;
