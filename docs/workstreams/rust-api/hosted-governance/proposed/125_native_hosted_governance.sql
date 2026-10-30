-- PROPOSAL SQL125 ONLY. Root owns installation; no migration is applied by this worker.
CREATE TABLE native_hosted_governance_grants (
 id TEXT PRIMARY KEY, enrollment_request_id TEXT NOT NULL UNIQUE,
 enrollment_hash TEXT NOT NULL CHECK(length(enrollment_hash)=64), connection_id TEXT NOT NULL UNIQUE,
 owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 installation_id TEXT NOT NULL REFERENCES veyra_installation_identity(instance_id) ON DELETE RESTRICT,
 native_library_id TEXT NOT NULL, native_service_instance_id TEXT NOT NULL,
 native_project_id TEXT, native_project_revision INTEGER,
 hosted_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 visibility TEXT NOT NULL CHECK(visibility IN ('project','system')),
 revision INTEGER NOT NULL CHECK(revision>0), epoch TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL,
 CHECK((native_project_id IS NULL AND native_project_revision IS NULL)
  OR (native_project_id IS NOT NULL AND native_project_revision>=0))
);
CREATE INDEX native_hosted_grants_owner ON native_hosted_governance_grants(owner_user_id,installation_id,hosted_project_id);
CREATE TABLE native_hosted_governance_effects (
 operation_id TEXT PRIMARY KEY CHECK(length(operation_id) BETWEEN 1 AND 256),
 grant_id TEXT NOT NULL REFERENCES native_hosted_governance_grants(id) ON DELETE RESTRICT,
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 source_project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64), binding_hash TEXT NOT NULL CHECK(length(binding_hash)=64),
 command_kind TEXT NOT NULL CHECK(command_kind IN ('create','save','archive','restore','enable','disable','submit','approve','reject','rollback')),
 state TEXT NOT NULL CHECK(state IN ('executing','succeeded','refused')),
 value_ref_json TEXT, error_code TEXT, error_status INTEGER, first_failure_code TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK((state='executing' AND value_ref_json IS NULL AND error_status IS NULL)
  OR (state='succeeded' AND error_status IS NULL)
  OR (state='refused' AND value_ref_json IS NULL AND error_code IS NOT NULL AND error_status BETWEEN 400 AND 599))
);
CREATE INDEX native_hosted_effects_pending ON native_hosted_governance_effects(grant_id,actor_id,state,operation_id);
CREATE TRIGGER native_hosted_effect_identity_immutable BEFORE UPDATE ON native_hosted_governance_effects
WHEN NEW.operation_id<>OLD.operation_id OR NEW.grant_id<>OLD.grant_id OR NEW.actor_id<>OLD.actor_id
 OR NEW.project_id<>OLD.project_id OR NEW.payload_hash<>OLD.payload_hash OR NEW.binding_hash<>OLD.binding_hash
 OR NEW.command_kind<>OLD.command_kind OR NEW.source_project_id IS NOT OLD.source_project_id OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'hosted original identity is immutable'); END;
CREATE TRIGGER native_hosted_effect_terminal_immutable BEFORE UPDATE ON native_hosted_governance_effects
WHEN OLD.state<>'executing' AND (NEW.state<>OLD.state OR NEW.value_ref_json IS NOT OLD.value_ref_json
 OR NEW.error_code IS NOT OLD.error_code OR NEW.error_status IS NOT OLD.error_status)
BEGIN SELECT RAISE(ABORT,'hosted terminal outcome is immutable'); END;
CREATE TRIGGER native_hosted_effect_no_delete BEFORE DELETE ON native_hosted_governance_effects
BEGIN SELECT RAISE(ABORT,'hosted effect originals require explicit future retention authority'); END;
