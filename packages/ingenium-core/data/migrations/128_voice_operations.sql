-- Node SQL128 source migration; original Core is the sole Voice operation metadata writer.
-- Production runtime and physical owner qualification remain separate release gates.
CREATE TABLE veyra_voice_operations (
 operation_id TEXT PRIMARY KEY CHECK(length(operation_id)=36),
 request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 1 AND 256),
 kind TEXT NOT NULL CHECK(kind IN ('voice-agent-turn','voice-agent-steer','voice-agent-queue','voice-speech-stt','voice-speech-tts','voice-cpu-supervisor')),
 scope_json TEXT NOT NULL CHECK(json_valid(scope_json) AND length(CAST(scope_json AS BLOB))<=4096),
 scope_hash TEXT NOT NULL CHECK(length(scope_hash)=64), original_hash TEXT NOT NULL CHECK(length(original_hash)=64),
 original_json TEXT NOT NULL CHECK(json_valid(original_json) AND length(CAST(original_json AS BLOB))<=8192),
 input_sha256 TEXT NOT NULL CHECK(length(input_sha256)=64),
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 runtime_id TEXT NOT NULL REFERENCES runtime_instances(id) ON DELETE RESTRICT,
 workspace_id TEXT NOT NULL REFERENCES authorized_workspaces(id) ON DELETE RESTRICT,
 user_epoch INTEGER NOT NULL CHECK(user_epoch>=0), workspace_epoch INTEGER NOT NULL CHECK(workspace_epoch>=0), runtime_epoch INTEGER NOT NULL CHECK(runtime_epoch>=0),
 turn_generation INTEGER NOT NULL CHECK(turn_generation>=0),
 parent_operation_id TEXT REFERENCES veyra_voice_operations(operation_id) ON DELETE RESTRICT,
 control_operation_id TEXT REFERENCES veyra_voice_operations(operation_id) ON DELETE RESTRICT,
 cpu_identity_json TEXT CHECK(cpu_identity_json IS NULL OR (json_valid(cpu_identity_json) AND length(CAST(cpu_identity_json AS BLOB))<=2048)),
 owner_json TEXT NOT NULL CHECK(json_valid(owner_json) AND length(CAST(owner_json AS BLOB))<=2048),
 instance_id TEXT NOT NULL, owner_generation INTEGER NOT NULL CHECK(owner_generation>=1),
 control_json TEXT CHECK(control_json IS NULL OR (json_valid(control_json) AND length(CAST(control_json AS BLOB))<=4096)),
 cpu_json TEXT CHECK(cpu_json IS NULL OR (json_valid(cpu_json) AND length(CAST(cpu_json AS BLOB))<=131072)),
 resource_retired INTEGER NOT NULL DEFAULT 0 CHECK(resource_retired IN (0,1)), private_revision INTEGER NOT NULL DEFAULT 0 CHECK(private_revision>=0),
 resource_retirement_json TEXT CHECK(resource_retirement_json IS NULL OR (json_valid(resource_retirement_json) AND length(CAST(resource_retirement_json AS BLOB))<=4096)),
 deadline_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 state TEXT NOT NULL CHECK(state IN ('reserved','running','quarantined','terminal')),
 outcome TEXT CHECK(outcome IN ('completed','failed','cancelled','cancelled-before-dispatch','unknown')),
 result_fingerprint TEXT CHECK(result_fingerprint IS NULL OR length(result_fingerprint)=64),
 retention_id TEXT CHECK(retention_id IS NULL OR length(retention_id)=36),
 retired INTEGER NOT NULL DEFAULT 0 CHECK(retired IN (0,1)), quarantine_code TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(scope_hash,request_id),
 CHECK((resource_retired=0 AND resource_retirement_json IS NULL) OR (resource_retired=1 AND resource_retirement_json IS NOT NULL)),
 CHECK((state='terminal' AND ((outcome='unknown' AND retention_id IS NULL AND retired=0 AND result_fingerprint IS NULL) OR (outcome<>'unknown' AND outcome IS NOT NULL AND retention_id IS NOT NULL AND retired=1)))
  OR (state<>'terminal' AND outcome IS NULL AND retention_id IS NULL AND retired=0 AND result_fingerprint IS NULL))
);
CREATE INDEX veyra_voice_operations_recovery ON veyra_voice_operations(actor_id,runtime_id,state,operation_id);
CREATE INDEX veyra_voice_control_resources ON veyra_voice_operations(control_operation_id,resource_retired,owner_json,operation_id);
CREATE UNIQUE INDEX veyra_voice_one_live_cpu_control ON veyra_voice_operations(instance_id) WHERE kind='voice-cpu-supervisor' AND resource_retired=0;
CREATE TRIGGER veyra_voice_control_generation BEFORE INSERT ON veyra_voice_operations
WHEN NEW.kind='voice-cpu-supervisor' AND EXISTS(SELECT 1 FROM veyra_voice_operations WHERE kind='voice-cpu-supervisor' AND instance_id=NEW.instance_id AND owner_generation>=NEW.owner_generation)
BEGIN SELECT RAISE(ABORT,'voice supervisor generation must increase'); END;
CREATE TRIGGER veyra_voice_operation_identity_immutable BEFORE UPDATE ON veyra_voice_operations
WHEN NEW.operation_id IS NOT OLD.operation_id OR NEW.request_id IS NOT OLD.request_id OR NEW.kind IS NOT OLD.kind
 OR NEW.scope_json IS NOT OLD.scope_json OR NEW.scope_hash IS NOT OLD.scope_hash OR NEW.original_hash IS NOT OLD.original_hash OR NEW.original_json IS NOT OLD.original_json
 OR NEW.input_sha256 IS NOT OLD.input_sha256 OR NEW.actor_id IS NOT OLD.actor_id OR NEW.organization_id IS NOT OLD.organization_id
 OR NEW.project_id IS NOT OLD.project_id OR NEW.runtime_id IS NOT OLD.runtime_id OR NEW.workspace_id IS NOT OLD.workspace_id
 OR NEW.user_epoch IS NOT OLD.user_epoch OR NEW.workspace_epoch IS NOT OLD.workspace_epoch OR NEW.runtime_epoch IS NOT OLD.runtime_epoch
 OR NEW.turn_generation IS NOT OLD.turn_generation OR NEW.parent_operation_id IS NOT OLD.parent_operation_id
 OR NEW.control_operation_id IS NOT OLD.control_operation_id OR NEW.instance_id IS NOT OLD.instance_id OR NEW.owner_generation IS NOT OLD.owner_generation
 OR NEW.cpu_identity_json IS NOT OLD.cpu_identity_json OR NEW.owner_json IS NOT OLD.owner_json
 OR NEW.deadline_at IS NOT OLD.deadline_at OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'voice original identity is immutable'); END;
CREATE TRIGGER veyra_voice_operation_terminal_immutable BEFORE UPDATE ON veyra_voice_operations
WHEN OLD.state='terminal' AND (NEW.state IS NOT OLD.state OR NEW.outcome IS NOT OLD.outcome OR NEW.result_fingerprint IS NOT OLD.result_fingerprint OR NEW.retention_id IS NOT OLD.retention_id OR NEW.retired IS NOT OLD.retired OR NEW.revision IS NOT OLD.revision OR NEW.quarantine_code IS NOT OLD.quarantine_code)
BEGIN SELECT RAISE(ABORT,'voice terminal is immutable'); END;
CREATE TRIGGER veyra_voice_operation_revision BEFORE UPDATE ON veyra_voice_operations
WHEN (NEW.state IS NOT OLD.state OR NEW.outcome IS NOT OLD.outcome OR NEW.revision IS NOT OLD.revision) AND (NEW.revision<>OLD.revision+1 OR NOT (
 (OLD.state='reserved' AND NEW.state IN ('running','quarantined','terminal'))
 OR (OLD.state='running' AND NEW.state IN ('quarantined','terminal'))
 OR (OLD.state='quarantined' AND NEW.state='terminal')))
BEGIN SELECT RAISE(ABORT,'voice transition requires checked revision'); END;
CREATE TRIGGER veyra_voice_operation_no_delete BEFORE DELETE ON veyra_voice_operations
BEGIN SELECT RAISE(ABORT,'voice originals are retained for no-replay'); END;
CREATE TRIGGER veyra_voice_private_revision BEFORE UPDATE ON veyra_voice_operations
WHEN NEW.resource_retired<OLD.resource_retired OR
 ((NEW.cpu_json IS NOT OLD.cpu_json OR NEW.control_json IS NOT OLD.control_json OR NEW.resource_retired IS NOT OLD.resource_retired OR NEW.resource_retirement_json IS NOT OLD.resource_retirement_json) AND NEW.private_revision<>OLD.private_revision+1)
 OR (OLD.resource_retirement_json IS NOT NULL AND NEW.resource_retirement_json IS NOT OLD.resource_retirement_json)
BEGIN SELECT RAISE(ABORT,'voice private resource requires checked revision'); END;
CREATE TRIGGER veyra_voice_control_identity_immutable BEFORE UPDATE ON veyra_voice_operations
WHEN OLD.control_json IS NOT NULL AND (
 json_extract(NEW.control_json,'$.instanceId') IS NOT json_extract(OLD.control_json,'$.instanceId')
 OR json_extract(NEW.control_json,'$.profileDigest') IS NOT json_extract(OLD.control_json,'$.profileDigest')
 OR json_extract(NEW.control_json,'$.recoveryEndpointIdentity') IS NOT json_extract(OLD.control_json,'$.recoveryEndpointIdentity')
 OR json_extract(NEW.control_json,'$.retirementSecretSha256') IS NOT json_extract(OLD.control_json,'$.retirementSecretSha256')
 OR (json_extract(OLD.control_json,'$.workerBootId') IS NOT NULL AND json_extract(NEW.control_json,'$.workerBootId') IS NOT json_extract(OLD.control_json,'$.workerBootId')))
BEGIN SELECT RAISE(ABORT,'voice control identity is immutable'); END;
CREATE TRIGGER veyra_voice_cpu_identity_terminal_immutable BEFORE UPDATE ON veyra_voice_operations
WHEN OLD.cpu_json IS NOT NULL AND (
 json_extract(NEW.cpu_json,'$.identity') IS NOT json_extract(OLD.cpu_json,'$.identity')
 OR json_extract(NEW.cpu_json,'$.revision')<json_extract(OLD.cpu_json,'$.revision')
 OR json_extract(NEW.cpu_json,'$.dispatchClaimed')<json_extract(OLD.cpu_json,'$.dispatchClaimed')
 OR (json_extract(OLD.cpu_json,'$.phase')='terminal' AND (
   json_extract(NEW.cpu_json,'$.phase') IS NOT 'terminal'
   OR json_extract(NEW.cpu_json,'$.outcome') IS NOT json_extract(OLD.cpu_json,'$.outcome')
   OR json_extract(NEW.cpu_json,'$.drained') IS NOT json_extract(OLD.cpu_json,'$.drained')
   OR json_extract(NEW.cpu_json,'$.retentionId') IS NOT json_extract(OLD.cpu_json,'$.retentionId')))
 OR (json_extract(OLD.cpu_json,'$.resultFingerprint') IS NOT NULL AND json_extract(NEW.cpu_json,'$.resultFingerprint') IS NOT json_extract(OLD.cpu_json,'$.resultFingerprint')))
BEGIN SELECT RAISE(ABORT,'voice CPU identity/terminal is immutable'); END;
