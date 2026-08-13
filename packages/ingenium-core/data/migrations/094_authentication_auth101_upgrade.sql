-- AUTH-101 exact upgrade from the AUTH-100 authentication foundation.
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN security_epoch INTEGER NOT NULL DEFAULT 0 CHECK(security_epoch >= 0);

DROP INDEX idx_auth_sessions_user_active;
ALTER TABLE auth_sessions RENAME TO auth_sessions_auth100;
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  csrf_hash TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' CHECK(length(csrf_hash) = 64 AND csrf_hash NOT GLOB '*[^0-9a-f]*'),
  security_epoch INTEGER NOT NULL DEFAULT 0 CHECK(security_epoch >= 0),
  device_label TEXT CHECK(device_label IS NULL OR length(device_label) BETWEEN 1 AND 128),
  idle_expires_at TEXT NOT NULL CHECK(length(idle_expires_at) BETWEEN 1 AND 64),
  absolute_expires_at TEXT NOT NULL CHECK(length(absolute_expires_at) BETWEEN 1 AND 64),
  recent_step_up_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  last_seen_at TEXT NOT NULL CHECK(length(last_seen_at) BETWEEN 1 AND 64),
  CHECK(julianday(idle_expires_at) IS NOT NULL AND julianday(absolute_expires_at) IS NOT NULL AND idle_expires_at <= absolute_expires_at)
);
INSERT INTO auth_sessions
  (id, user_id, token_hash, security_epoch, idle_expires_at, absolute_expires_at, revoked_at, created_at, last_seen_at)
SELECT auth_sessions_auth100.id, auth_sessions_auth100.user_id, auth_sessions_auth100.token_hash, users.security_epoch,
       auth_sessions_auth100.idle_expires_at, auth_sessions_auth100.absolute_expires_at,
       COALESCE(auth_sessions_auth100.revoked_at, datetime('now')), auth_sessions_auth100.created_at,
       auth_sessions_auth100.last_seen_at
FROM auth_sessions_auth100 JOIN users ON users.id = auth_sessions_auth100.user_id;
DROP TABLE auth_sessions_auth100;
CREATE INDEX idx_auth_sessions_user_active ON auth_sessions(user_id, revoked_at, absolute_expires_at);

DROP TRIGGER auth_one_time_states_consume_once;
DROP INDEX idx_auth_one_time_states_expiry;
ALTER TABLE auth_one_time_states RENAME TO auth_one_time_states_auth100;
CREATE TABLE auth_one_time_states (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  purpose TEXT NOT NULL CHECK(purpose IN ('password_reset', 'email_verification', 'mfa_challenge')),
  user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  state_hash TEXT NOT NULL UNIQUE CHECK(length(state_hash) = 64 AND state_hash NOT GLOB '*[^0-9a-f]*'),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json) AND json_type(metadata_json) = 'object' AND length(CAST(metadata_json AS BLOB)) <= 4096),
  expires_at TEXT NOT NULL CHECK(length(expires_at) BETWEEN 1 AND 64 AND julianday(expires_at) IS NOT NULL),
  consumed_at TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64)
);
INSERT INTO auth_one_time_states
SELECT * FROM auth_one_time_states_auth100 WHERE purpose IN ('password_reset', 'email_verification');
DROP TABLE auth_one_time_states_auth100;
CREATE INDEX idx_auth_one_time_states_expiry ON auth_one_time_states(purpose, expires_at, consumed_at);
CREATE TRIGGER auth_one_time_states_consume_once
BEFORE UPDATE ON auth_one_time_states
WHEN NEW.id IS NOT OLD.id OR NEW.purpose IS NOT OLD.purpose OR NEW.user_id IS NOT OLD.user_id
  OR NEW.state_hash IS NOT OLD.state_hash OR NEW.metadata_json IS NOT OLD.metadata_json
  OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_at IS NOT OLD.created_at
  OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT, 'one-time authentication state may only be consumed once'); END;

ALTER TABLE auth_totp_factors RENAME TO auth_totp_factors_auth100;
CREATE TABLE auth_totp_factors (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  encrypted_secret TEXT NOT NULL CHECK(length(encrypted_secret) BETWEEN 32 AND 4096),
  secret_key_version INTEGER NOT NULL DEFAULT 1 CHECK(secret_key_version = 1),
  enabled_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64)
);
INSERT INTO auth_totp_factors (id, user_id, encrypted_secret, enabled_at, revoked_at, created_at)
SELECT id, user_id, encrypted_secret, enabled_at, revoked_at, created_at FROM auth_totp_factors_auth100;
DROP TABLE auth_totp_factors_auth100;

CREATE TABLE oidc_providers (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  name TEXT NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 128),
  issuer TEXT NOT NULL UNIQUE CHECK(length(issuer) BETWEEN 1 AND 2048),
  client_id TEXT NOT NULL CHECK(length(client_id) BETWEEN 1 AND 512),
  redirect_uri TEXT NOT NULL CHECK(length(redirect_uri) BETWEEN 1 AND 2048),
  signature_algorithm TEXT NOT NULL CHECK(signature_algorithm IN ('RS256', 'ES256')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64)
);
CREATE TABLE oidc_authorization_states (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  provider_id TEXT NOT NULL REFERENCES oidc_providers(id) ON DELETE RESTRICT,
  state_hash TEXT NOT NULL UNIQUE CHECK(length(state_hash) = 64 AND state_hash NOT GLOB '*[^0-9a-f]*'),
  transaction_hash TEXT NOT NULL CHECK(length(transaction_hash) = 64 AND transaction_hash NOT GLOB '*[^0-9a-f]*'),
  nonce_hash TEXT NOT NULL CHECK(length(nonce_hash) = 64 AND nonce_hash NOT GLOB '*[^0-9a-f]*'),
  encrypted_pkce_verifier TEXT NOT NULL CHECK(length(encrypted_pkce_verifier) BETWEEN 32 AND 4096),
  expires_at TEXT NOT NULL CHECK(length(expires_at) BETWEEN 1 AND 64 AND julianday(expires_at) IS NOT NULL),
  consumed_at TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64)
);
CREATE INDEX idx_oidc_authorization_states_expiry ON oidc_authorization_states(expires_at, consumed_at);
CREATE TRIGGER oidc_authorization_states_consume_once
BEFORE UPDATE ON oidc_authorization_states
WHEN NEW.id IS NOT OLD.id OR NEW.provider_id IS NOT OLD.provider_id OR NEW.state_hash IS NOT OLD.state_hash
  OR NEW.transaction_hash IS NOT OLD.transaction_hash OR NEW.nonce_hash IS NOT OLD.nonce_hash
  OR NEW.encrypted_pkce_verifier IS NOT OLD.encrypted_pkce_verifier
  OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_at IS NOT OLD.created_at
  OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT, 'OIDC authorization state may only be consumed once'); END;

COMMIT;
PRAGMA foreign_keys = ON;
