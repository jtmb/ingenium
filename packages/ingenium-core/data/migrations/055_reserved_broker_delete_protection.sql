-- The internal LLM broker is a reserved system profile. Direct deletion of
-- its row would bypass the API and lifecycle guards, so reject it while the
-- owning project still exists. Project deletion remains unaffected: Ingenium
-- only deletes child-free projects, and a future FK cascade runs after the
-- parent row is no longer visible to this trigger.
CREATE TRIGGER IF NOT EXISTS agents_broker_delete_protection
BEFORE DELETE ON agents
WHEN OLD.name = 'ingenium-llm-broker'
  AND EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN
  SELECT RAISE(ABORT, 'reserved LLM broker cannot be deleted directly');
END;
