-- G3 Context migration repair provenance.
--
-- The probe-based runner invokes this migration inside the same transaction as
-- its canonical 063 table rebuild when it finds a legacy or partial shape. The
-- table is intentionally content-free: it records only the source schema hash
-- and logical repaired-component row counts, never conversation or message
-- bodies. Logical keys are stable provenance labels, not SQL table-name output.
CREATE TABLE IF NOT EXISTS context_migration_repairs (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  repaired_at TEXT NOT NULL,
  source_schema_hash TEXT NOT NULL CHECK(
    length(source_schema_hash) = 64
    AND source_schema_hash NOT GLOB '*[^0-9a-f]*'
  ),
  row_counts TEXT NOT NULL CHECK(
    json_valid(row_counts)
    AND json_type(row_counts) = 'object'
  )
);
