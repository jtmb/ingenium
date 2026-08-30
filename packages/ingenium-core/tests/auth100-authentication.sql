BEGIN IMMEDIATE;

CREATE TABLE auth_identities (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK(provider IN ('local', 'oidc')),
  issuer TEXT NOT NULL CHECK(length(issuer) BETWEEN 1 AND 2048),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 512),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  UNIQUE(issuer, subject),
  UNIQUE(user_id, provider, issuer)
);
CREATE TABLE password_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  password_hash TEXT NOT NULL CHECK(length(password_hash) = 64 AND password_hash NOT GLOB '*[^0-9a-f]*'),
  salt TEXT NOT NULL CHECK(length(salt) = 32 AND salt NOT GLOB '*[^0-9a-f]*'),
  scrypt_n INTEGER NOT NULL CHECK(scrypt_n >= 65536),
  scrypt_r INTEGER NOT NULL CHECK(scrypt_r >= 8),
  scrypt_p INTEGER NOT NULL CHECK(scrypt_p >= 1),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64)
);
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  idle_expires_at TEXT NOT NULL CHECK(length(idle_expires_at) BETWEEN 1 AND 64),
  absolute_expires_at TEXT NOT NULL CHECK(length(absolute_expires_at) BETWEEN 1 AND 64),
  revoked_at TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  last_seen_at TEXT NOT NULL CHECK(length(last_seen_at) BETWEEN 1 AND 64),
  CHECK(julianday(idle_expires_at) IS NOT NULL AND julianday(absolute_expires_at) IS NOT NULL AND idle_expires_at <= absolute_expires_at)
);
CREATE TABLE auth_one_time_states (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  purpose TEXT NOT NULL CHECK(purpose IN ('oidc', 'password_reset', 'email_verification')),
  user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  state_hash TEXT NOT NULL UNIQUE CHECK(length(state_hash) = 64 AND state_hash NOT GLOB '*[^0-9a-f]*'),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json) AND json_type(metadata_json) = 'object' AND length(CAST(metadata_json AS BLOB)) <= 4096),
  expires_at TEXT NOT NULL CHECK(length(expires_at) BETWEEN 1 AND 64 AND julianday(expires_at) IS NOT NULL),
  consumed_at TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64)
);
CREATE TABLE auth_totp_factors (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  encrypted_secret TEXT NOT NULL CHECK(length(encrypted_secret) BETWEEN 32 AND 4096),
  enabled_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64)
);
CREATE TABLE auth_recovery_codes (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  code_hash TEXT NOT NULL UNIQUE CHECK(length(code_hash) = 64 AND code_hash NOT GLOB '*[^0-9a-f]*'),
  consumed_at TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64)
);
CREATE INDEX idx_auth_identities_user ON auth_identities(user_id, provider);
CREATE INDEX idx_auth_sessions_user_active ON auth_sessions(user_id, revoked_at, absolute_expires_at);
CREATE INDEX idx_auth_one_time_states_expiry ON auth_one_time_states(purpose, expires_at, consumed_at);
CREATE TRIGGER auth_one_time_states_consume_once
BEFORE UPDATE ON auth_one_time_states
WHEN NEW.id IS NOT OLD.id OR NEW.purpose IS NOT OLD.purpose OR NEW.user_id IS NOT OLD.user_id
  OR NEW.state_hash IS NOT OLD.state_hash OR NEW.metadata_json IS NOT OLD.metadata_json
  OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_at IS NOT OLD.created_at
  OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT, 'one-time authentication state may only be consumed once'); END;

COMMIT;
