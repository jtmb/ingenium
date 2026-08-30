-- Add bounded, hash-only CSRF grants without rotating authenticated sessions.
-- Guard: db.ts applies this migration only when the complete grant schema is absent.
BEGIN IMMEDIATE;

CREATE TABLE auth_session_csrf_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  security_epoch INTEGER NOT NULL CHECK(security_epoch >= 0),
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  expires_at TEXT NOT NULL CHECK(length(expires_at) BETWEEN 1 AND 64 AND julianday(expires_at) IS NOT NULL),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64 AND julianday(created_at) IS NOT NULL),
  CHECK(created_at < expires_at)
);

CREATE INDEX idx_auth_session_csrf_grants_session_newest
  ON auth_session_csrf_grants(session_id, created_at DESC, id DESC);
CREATE INDEX idx_auth_session_csrf_grants_expiry
  ON auth_session_csrf_grants(expires_at);

CREATE TRIGGER auth_session_csrf_grants_scope_insert
BEFORE INSERT ON auth_session_csrf_grants
WHEN NOT EXISTS (
  SELECT 1
  FROM auth_sessions
  JOIN users ON users.id = auth_sessions.user_id
  WHERE auth_sessions.id = NEW.session_id
    AND auth_sessions.user_id = NEW.user_id
    AND auth_sessions.security_epoch = NEW.security_epoch
    AND auth_sessions.revoked_at IS NULL
    AND auth_sessions.idle_expires_at > NEW.created_at
    AND auth_sessions.absolute_expires_at > NEW.created_at
    AND NEW.expires_at <= auth_sessions.idle_expires_at
    AND NEW.expires_at <= auth_sessions.absolute_expires_at
    AND users.status = 'active'
    AND users.security_epoch = NEW.security_epoch
)
BEGIN SELECT RAISE(ABORT, 'CSRF grant session scope is unavailable'); END;

CREATE TRIGGER auth_session_csrf_grants_immutable_update
BEFORE UPDATE ON auth_session_csrf_grants
BEGIN SELECT RAISE(ABORT, 'CSRF grants are immutable'); END;

CREATE TRIGGER auth_session_csrf_grants_bound_insert
AFTER INSERT ON auth_session_csrf_grants
BEGIN
  DELETE FROM auth_session_csrf_grants WHERE id IN (
    SELECT id FROM auth_session_csrf_grants
    WHERE session_id = NEW.session_id
    ORDER BY created_at DESC, id DESC
    LIMIT -1 OFFSET 8
  );
END;

CREATE TRIGGER auth_sessions_delete_csrf_grants_on_revoke
AFTER UPDATE OF revoked_at ON auth_sessions
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
BEGIN
  DELETE FROM auth_session_csrf_grants WHERE session_id = NEW.id;
END;

CREATE TRIGGER users_delete_csrf_grants_on_security_change
AFTER UPDATE OF security_epoch, status ON users
WHEN NEW.security_epoch IS NOT OLD.security_epoch OR NEW.status <> 'active'
BEGIN
  DELETE FROM auth_session_csrf_grants WHERE user_id = NEW.id;
END;

COMMIT;
