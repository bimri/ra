-- Freeze explicit terms and integer obligations. Historical rows stay version 0:
-- missing commercial terms must be reconciled explicitly, never inferred.
ALTER TABLE voyages ADD COLUMN terms_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE voyages ADD COLUMN funder_name TEXT;
ALTER TABLE voyages ADD COLUMN funder_mission TEXT;
ALTER TABLE voyages ADD COLUMN upfront_cents INTEGER;
ALTER TABLE voyages ADD COLUMN marker_cents INTEGER;
ALTER TABLE voyages ADD COLUMN landfall_cents INTEGER;
ALTER TABLE voyages ADD COLUMN mind_delivered INTEGER NOT NULL DEFAULT 0;

-- One disclosure per earned slot, even if an achievement reference changes.
-- Legacy claims retain their signatures and are bound only on an exact retry.
ALTER TABLE claims ADD COLUMN slot TEXT;
ALTER TABLE claims ADD COLUMN mind_delivered INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX claims_slot ON claims(voyage_id, slot) WHERE slot IS NOT NULL;
ALTER TABLE pledges ADD COLUMN mind_delivered INTEGER NOT NULL DEFAULT 0;
CREATE INDEX voyages_delivery ON voyages(holder,mind_delivered,started_at,id);
CREATE INDEX claims_delivery ON claims(voyage_id,mind_delivered,at,id);
CREATE INDEX pledges_delivery ON pledges(holder,mind_delivered,at,id);
