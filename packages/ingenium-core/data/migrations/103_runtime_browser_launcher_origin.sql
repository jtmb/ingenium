-- Persist the authenticated dashboard origin on runtime browser sessions.
-- Guard: db.ts applies this migration only when pragma_table_info reports the column missing.
BEGIN IMMEDIATE;

ALTER TABLE runtime_browser_sessions ADD COLUMN launcher_origin TEXT
  CHECK(launcher_origin IS NULL OR length(launcher_origin) BETWEEN 8 AND 512);

UPDATE runtime_browser_sessions AS s
SET launcher_origin = (
  SELECT t.launcher_origin
  FROM runtime_browser_launch_tickets AS t
  WHERE t.runtime_id = s.runtime_id
    AND t.workspace_id = s.workspace_id
    AND t.owner_user_id = s.owner_user_id
    AND t.auth_session_id = s.auth_session_id
    AND t.audience = s.audience
    AND t.origin = s.origin
    AND t.host = s.host
    AND t.generation = s.generation
    AND t.consumed_at IS NOT NULL
  ORDER BY t.consumed_at DESC, t.created_at DESC
  LIMIT 1
)
WHERE launcher_origin IS NULL;

UPDATE runtime_browser_sessions
SET revoked_at = COALESCE(revoked_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
WHERE launcher_origin IS NULL;

CREATE TRIGGER IF NOT EXISTS runtime_browser_session_launcher_origin_insert
BEFORE INSERT ON runtime_browser_sessions
WHEN NEW.launcher_origin IS NULL
  OR (substr(NEW.launcher_origin, 1, 8) <> 'https://'
    AND NEW.launcher_origin NOT GLOB 'http://localhost:*'
    AND NEW.launcher_origin NOT GLOB 'http://127.0.0.1:*')
BEGIN SELECT RAISE(ABORT, 'runtime browser launcher origin is invalid'); END;

CREATE TRIGGER IF NOT EXISTS runtime_browser_session_launcher_origin_update
BEFORE UPDATE OF launcher_origin ON runtime_browser_sessions
WHEN NEW.launcher_origin IS NOT OLD.launcher_origin
BEGIN SELECT RAISE(ABORT, 'runtime browser launcher origin is immutable'); END;

COMMIT;
