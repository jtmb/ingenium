-- Reserved broker protection must hold for every SQLite connection. In
-- particular, SQLite does not fire DELETE triggers caused by REPLACE when
-- recursive_triggers is disabled, so DELETE-only protection is insufficient.
-- These BEFORE INSERT and BEFORE UPDATE guards run before conflict resolution
-- and prevent REPLACE from deleting or replacing a broker row.
--
-- The only creatable broker is the exact, internal bootstrap template below.
-- SQLite cannot identify the application caller, so the database admits only
-- this complete static template for an absent broker in an existing project.
-- The public lifecycle APIs never expose this create path; bootstrapReservedBroker
-- is the sole core function that issues the matching insert.

DROP TRIGGER IF EXISTS agents_broker_invariant_after_insert;
DROP TRIGGER IF EXISTS agents_broker_invariant_after_update;
DROP TRIGGER IF EXISTS agents_broker_delete_protection;
DROP TRIGGER IF EXISTS agents_broker_rename_protection;
DROP TRIGGER IF EXISTS agents_broker_name_claim_protection;
DROP TRIGGER IF EXISTS agents_broker_immutable_update_protection;
DROP TRIGGER IF EXISTS agents_broker_insert_id_collision_protection;
DROP TRIGGER IF EXISTS agents_broker_insert_name_collision_protection;
DROP TRIGGER IF EXISTS agents_broker_insert_template_protection;
DROP TRIGGER IF EXISTS agents_broker_update_identity_protection;

-- Repair historical broker rows before installing immutable guards. The broker
-- has never accepted caller-provided profile fields, so normalizing every
-- material field is safe and removes legacy, arbitrary profile content.
UPDATE agents
SET description = 'Internal agent for Ingenium LLM broker — never invoke directly',
    category = 'execution',
    mode = 'subagent',
    model = NULL,
    reasoning_effort = NULL,
    permissions = '{"*":"deny"}',
    metadata = '{"hidden":true}',
    skills = '[]',
    content = 'This agent is reserved for system use. Do not invoke directly.

Its wildcard-deny permission boundary intentionally has no exceptions: it has no
file, shell, browser, MCP, task, skill, or other tool access. The API always
selects this profile for broker requests; request-level tool selections cannot
grant capabilities that this profile denies.
',
    enabled = 1
WHERE name = 'ingenium-llm-broker';

-- No insert may use a broker primary key as a REPLACE collision target. This
-- catches INSERT OR REPLACE that changes the replacement row's name as well.
CREATE TRIGGER agents_broker_insert_id_collision_protection
BEFORE INSERT ON agents
WHEN EXISTS (
  SELECT 1 FROM agents
  WHERE id = NEW.id AND name = 'ingenium-llm-broker'
)
BEGIN
  SELECT RAISE(ABORT, 'reserved LLM broker cannot be replaced');
END;

-- A broker name collision must be rejected before SQLite's REPLACE conflict
-- handler can delete the existing (project_id, name) row.
CREATE TRIGGER agents_broker_insert_name_collision_protection
BEFORE INSERT ON agents
WHEN NEW.name = 'ingenium-llm-broker'
  AND EXISTS (
    SELECT 1 FROM agents
    WHERE project_id = NEW.project_id AND name = 'ingenium-llm-broker'
  )
BEGIN
  SELECT RAISE(ABORT, 'reserved LLM broker cannot be replaced');
END;

-- A first creation is allowed only for the exact canonical, inert template
-- and only inside an existing active project. This is the database backstop
-- for the dedicated internal bootstrap path; arbitrary body, category, mode,
-- model, description, visibility, permissions, or enabled state cannot enter.
CREATE TRIGGER agents_broker_insert_template_protection
BEFORE INSERT ON agents
WHEN NEW.name = 'ingenium-llm-broker'
  AND (
    NEW.description IS NOT 'Internal agent for Ingenium LLM broker — never invoke directly'
    OR NEW.category IS NOT 'execution'
    OR NEW.mode IS NOT 'subagent'
    OR NEW.model IS NOT NULL
    OR NEW.reasoning_effort IS NOT NULL
    OR NEW.permissions IS NOT '{"*":"deny"}'
    OR NEW.metadata IS NOT '{"hidden":true}'
    OR NEW.skills IS NOT '[]'
    OR NEW.content IS NOT 'This agent is reserved for system use. Do not invoke directly.

Its wildcard-deny permission boundary intentionally has no exceptions: it has no
file, shell, browser, MCP, task, skill, or other tool access. The API always
selects this profile for broker requests; request-level tool selections cannot
grant capabilities that this profile denies.
'
    OR NEW.enabled IS NOT 1
    OR NEW.created_at IS NULL
    OR NEW.updated_at IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM projects
      WHERE id = NEW.project_id AND archived_at IS NULL
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'reserved LLM broker must match the canonical bootstrap template');
END;

-- Once present, no broker field may change. This is intentionally not limited
-- to selected columns: UPDATE OR REPLACE can otherwise use a unique conflict
-- to delete the protected row before recreating another one.
CREATE TRIGGER agents_broker_immutable_update_protection
BEFORE UPDATE ON agents
WHEN OLD.name = 'ingenium-llm-broker'
BEGIN
  SELECT RAISE(ABORT, 'reserved LLM broker is immutable');
END;

-- Do not permit a normal agent to claim the reserved name or a broker primary
-- key through UPDATE OR REPLACE conflict resolution.
CREATE TRIGGER agents_broker_update_identity_protection
BEFORE UPDATE ON agents
WHEN (OLD.name IS NOT 'ingenium-llm-broker' AND NEW.name = 'ingenium-llm-broker')
  OR EXISTS (
    SELECT 1 FROM agents
    WHERE id = NEW.id
      AND name = 'ingenium-llm-broker'
      AND id <> OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'reserved LLM broker identity cannot be claimed');
END;

CREATE TRIGGER agents_broker_delete_protection
BEFORE DELETE ON agents
WHEN OLD.name = 'ingenium-llm-broker'
BEGIN
  SELECT RAISE(ABORT, 'reserved LLM broker cannot be deleted directly');
END;
