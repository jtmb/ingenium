-- Preserve non-runtime agent frontmatter metadata independently from the
-- markdown body. In particular, `hidden: true` is security-sensitive for the
-- internal LLM broker and must survive a disable/enable disk round trip.
ALTER TABLE agents ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';

-- The broker is a reserved system profile. Normalize every historical row and
-- retain that exact state even if a low-level import or future write bypasses
-- the TypeScript lifecycle helpers.
CREATE TRIGGER IF NOT EXISTS agents_broker_invariant_after_insert
AFTER INSERT ON agents
WHEN NEW.name = 'ingenium-llm-broker'
  AND (NEW.permissions IS NOT '{"*":"deny"}' OR NEW.metadata IS NOT '{"hidden":true}')
BEGIN
  UPDATE agents
  SET permissions = '{"*":"deny"}', metadata = '{"hidden":true}'
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS agents_broker_invariant_after_update
AFTER UPDATE OF name, permissions, metadata ON agents
WHEN NEW.name = 'ingenium-llm-broker'
  AND (NEW.permissions IS NOT '{"*":"deny"}' OR NEW.metadata IS NOT '{"hidden":true}')
BEGIN
  UPDATE agents
  SET permissions = '{"*":"deny"}', metadata = '{"hidden":true}'
  WHERE id = NEW.id;
END;

UPDATE agents
SET permissions = '{"*":"deny"}', metadata = '{"hidden":true}'
WHERE name = 'ingenium-llm-broker';
