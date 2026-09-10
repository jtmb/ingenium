-- The internal LLM broker is a reserved system profile. A direct SQL rename
-- would evade the canonical-name invariant triggers installed by migration 054
-- and could leave a permissive profile under a new name. Reject the write before
-- any column in that row changes.
CREATE TRIGGER IF NOT EXISTS agents_broker_rename_protection
BEFORE UPDATE OF name ON agents
WHEN OLD.name = 'ingenium-llm-broker'
  AND NEW.name IS NOT 'ingenium-llm-broker'
BEGIN
  SELECT RAISE(ABORT, 'reserved LLM broker cannot be renamed directly');
END;
