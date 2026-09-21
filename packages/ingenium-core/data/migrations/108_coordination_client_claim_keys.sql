-- Bind caller-held claim keys to claim batches without persisting or exposing
-- either the plaintext key or the internal claim UUIDs.
BEGIN IMMEDIATE;

ALTER TABLE coordination_claims ADD COLUMN client_claim_key_hash TEXT CHECK(
  client_claim_key_hash IS NULL OR (
    length(client_claim_key_hash) = 64
    AND client_claim_key_hash NOT GLOB '*[^0-9a-f]*'
  )
);

UPDATE coordination_claims
SET state = 'released',
    released_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE state = 'active';

UPDATE coordination_claims
SET client_claim_key_hash = lower(hex(randomblob(32)))
WHERE state <> 'released';

CREATE INDEX idx_coordination_claims_client_key
  ON coordination_claims(
    project_id, coordination_session_id, worktree_id, incarnation, fence,
    client_claim_key_hash, state
  );

CREATE TRIGGER coordination_claims_require_client_key_insert
BEFORE INSERT ON coordination_claims
WHEN NEW.client_claim_key_hash IS NULL
BEGIN
  SELECT RAISE(ABORT, 'coordination claim key hash required');
END;

CREATE TRIGGER coordination_claims_require_client_key_update
BEFORE UPDATE OF state, client_claim_key_hash ON coordination_claims
WHEN NEW.state <> 'released' AND NEW.client_claim_key_hash IS NULL
BEGIN
  SELECT RAISE(ABORT, 'coordination claim key hash required');
END;

COMMIT;
