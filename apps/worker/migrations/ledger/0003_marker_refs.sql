-- Freeze the person's marker identities when the voyage starts.
ALTER TABLE voyages ADD COLUMN marker_refs TEXT;
