-- The LLM broker is an API-owned system profile.  It remains visible in the
-- agents table so resource sync can materialize its trusted markdown profile,
-- but its enabled, permission, visibility, identity, and content state must
-- not be mutable through ad-hoc SQLite statements.
--
-- Replace the incremental 054–056 trigger set with one coherent invariant.
-- Recreating these idempotently also repairs an interrupted historical
-- migration before the immutable-write trigger is installed.
DROP TRIGGER IF EXISTS agents_broker_invariant_after_insert;
DROP TRIGGER IF EXISTS agents_broker_invariant_after_update;
DROP TRIGGER IF EXISTS agents_broker_delete_protection;
DROP TRIGGER IF EXISTS agents_broker_rename_protection;
DROP TRIGGER IF EXISTS agents_broker_name_claim_protection;
DROP TRIGGER IF EXISTS agents_broker_immutable_update_protection;

-- Backfill existing rows before protection is enabled. The profile body and
-- identity are preserved from the established system record; only its fixed
-- runtime safety fields are repaired.
UPDATE agents
SET enabled = 1,
    permissions = '{"*":"deny"}',
    metadata = '{"hidden":true}'
WHERE name = 'ingenium-llm-broker'
  AND (
    enabled IS NOT 1
    OR permissions IS NOT '{"*":"deny"}'
    OR metadata IS NOT '{"hidden":true}'
  );

-- Reject every material mutation of the reserved record. Canonicalizing a
-- historical malformed row remains possible because the corrected values are
-- explicitly allowed; only updated_at may advance independently.
CREATE TRIGGER agents_broker_immutable_update_protection
BEFORE UPDATE ON agents
WHEN OLD.name = 'ingenium-llm-broker'
  AND (
    NEW.id IS NOT OLD.id
    OR NEW.project_id IS NOT OLD.project_id
    OR NEW.name IS NOT OLD.name
    OR NEW.description IS NOT OLD.description
    OR NEW.category IS NOT OLD.category
    OR NEW.mode IS NOT OLD.mode
    OR NEW.model IS NOT OLD.model
    OR NEW.reasoning_effort IS NOT OLD.reasoning_effort
    OR NEW.skills IS NOT OLD.skills
    OR NEW.content IS NOT OLD.content
    OR NEW.created_at IS NOT OLD.created_at
    OR NEW.enabled IS NOT 1
    OR NEW.permissions IS NOT '{"*":"deny"}'
    OR NEW.metadata IS NOT '{"hidden":true}'
  )
BEGIN
  SELECT RAISE(ABORT, 'reserved LLM broker is immutable');
END;

-- Do not permit an ordinary agent to claim the broker identity. This closes
-- the no-collision UPDATE OR REPLACE path as well as ordinary direct renames.
CREATE TRIGGER agents_broker_name_claim_protection
BEFORE UPDATE OF name ON agents
WHEN OLD.name IS NOT 'ingenium-llm-broker'
  AND NEW.name = 'ingenium-llm-broker'
BEGIN
  SELECT RAISE(ABORT, 'reserved LLM broker identity cannot be claimed');
END;

-- INSERT OR REPLACE and colliding UPDATE OR REPLACE delete the existing row
-- before writing their replacement. Block that delete while retaining the
-- parent-existence exception needed for any future FK cascade semantics.
CREATE TRIGGER agents_broker_delete_protection
BEFORE DELETE ON agents
WHEN OLD.name = 'ingenium-llm-broker'
  AND EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN
  SELECT RAISE(ABORT, 'reserved LLM broker cannot be deleted directly');
END;
