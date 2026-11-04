-- Opaque deletion receipts fence requests already in flight.
CREATE TABLE erased_holders(holder TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TRIGGER voyages_erased BEFORE INSERT ON voyages
WHEN EXISTS(SELECT 1 FROM erased_holders WHERE holder=NEW.holder)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER pledges_erased BEFORE INSERT ON pledges
WHEN EXISTS(SELECT 1 FROM erased_holders WHERE holder=NEW.holder)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER claims_erased BEFORE INSERT ON claims
WHEN NOT EXISTS(SELECT 1 FROM voyages WHERE id=NEW.voyage_id AND holder NOT LIKE 'erased:%')
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER payments_erased BEFORE INSERT ON payments
WHEN NEW.voyage_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM voyages WHERE id=NEW.voyage_id AND holder NOT LIKE 'erased:%')
BEGIN SELECT RAISE(IGNORE); END;
