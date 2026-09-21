BEGIN IMMEDIATE;

-- Same-phase triggers have no guaranteed order; delete old terms before the
-- AFTER UPDATE trigger inserts the new terms, including terms shared by both.
DROP TRIGGER IF EXISTS explicit_memories_fts_update_delete;
CREATE TRIGGER explicit_memories_fts_update_delete
BEFORE UPDATE ON explicit_memories
BEGIN
  INSERT INTO explicit_memories_fts(explicit_memories_fts, rowid, content, tags)
    VALUES ('delete', OLD.rowid, OLD.content, OLD.tags);
END;

-- Repair terms already lost by the old ordering without rewriting memory or
-- its immutable receipts. Forgotten rows contain no searchable content/tags.
INSERT INTO explicit_memories_fts(explicit_memories_fts) VALUES ('rebuild');

COMMIT;
