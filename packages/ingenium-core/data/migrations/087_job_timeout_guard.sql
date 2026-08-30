-- Migration 087: bound job timeouts before they reach Node's timer limit.
-- Guard: runMigrations applies this only while timeout_minutes_guard is absent.

BEGIN IMMEDIATE;

-- Legacy rows may predate the runtime validation. Normalize only invalid values;
-- the revision trigger requires every mutable job update to advance once.
UPDATE jobs
SET timeout_minutes = 30,
    revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE typeof(timeout_minutes) <> 'integer'
   OR timeout_minutes NOT BETWEEN 1 AND 1440;

-- A generated guard adds a durable CHECK without rebuilding jobs and its many
-- FK-dependent provenance tables.
ALTER TABLE jobs ADD COLUMN timeout_minutes_guard INTEGER
  GENERATED ALWAYS AS (
    CASE
      WHEN typeof(timeout_minutes) = 'integer'
       AND timeout_minutes BETWEEN 1 AND 1440 THEN 1
      ELSE 0
    END
  ) VIRTUAL NOT NULL CHECK(timeout_minutes_guard = 1);

COMMIT;
