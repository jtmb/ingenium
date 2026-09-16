-- Replayed bootstrap secrets remain encrypted; credential revocation remains authoritative.
CREATE TABLE IF NOT EXISTS mcp_credential_receipts (
  idempotency_key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  credential_id TEXT NOT NULL REFERENCES mcp_credentials(id) ON DELETE CASCADE,
  encrypted_token TEXT NOT NULL
);
