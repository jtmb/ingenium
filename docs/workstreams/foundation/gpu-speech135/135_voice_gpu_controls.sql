-- SOURCE ONLY / AUTHORED UNRUN. Existing original Node Core writer only.
-- No 128 table rebuild, CPU relabel/backfill, 134 FK rewrite or GPU authority.
CREATE TABLE veyra_voice_gpu_schema (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL CHECK(version=1)
);
INSERT INTO veyra_voice_gpu_schema VALUES(1,1);
CREATE TRIGGER gpu135_schema_no_insert BEFORE INSERT ON veyra_voice_gpu_schema
BEGIN SELECT RAISE(ABORT,'GPU135 schema original retained'); END;
CREATE TRIGGER gpu135_schema_no_update BEFORE UPDATE ON veyra_voice_gpu_schema
BEGIN SELECT RAISE(ABORT,'GPU135 schema original retained'); END;
CREATE TRIGGER gpu135_schema_no_delete BEFORE DELETE ON veyra_voice_gpu_schema
BEGIN SELECT RAISE(ABORT,'GPU135 schema original retained'); END;

CREATE TABLE veyra_voice_gpu_controls (
 control_id TEXT PRIMARY KEY CHECK(length(control_id)=36),
 kind TEXT NOT NULL CHECK(kind='voice-gpu-supervisor'),
 request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 1 AND 256),
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 runtime_id TEXT NOT NULL REFERENCES runtime_instances(id) ON DELETE RESTRICT,
 workspace_id TEXT NOT NULL REFERENCES authorized_workspaces(id) ON DELETE RESTRICT,
 scope_json TEXT NOT NULL CHECK(json_valid(scope_json) AND length(CAST(scope_json AS BLOB))<=4096),
 scope_hash TEXT NOT NULL CHECK(length(scope_hash)=64),
 owner_json TEXT NOT NULL CHECK(json_valid(owner_json) AND length(CAST(owner_json AS BLOB))<=2048),
 instance_id TEXT NOT NULL CHECK(length(instance_id) BETWEEN 1 AND 160),
 owner_generation INTEGER NOT NULL CHECK(owner_generation>=1),
 user_epoch INTEGER NOT NULL CHECK(user_epoch>=0),
 workspace_epoch INTEGER NOT NULL CHECK(workspace_epoch>=0),
 runtime_epoch INTEGER NOT NULL CHECK(runtime_epoch>=0),
 original_json TEXT NOT NULL CHECK(json_valid(original_json) AND length(CAST(original_json AS BLOB))<=8192),
 original_hash TEXT NOT NULL CHECK(length(original_hash)=64),
 descriptor_json TEXT NOT NULL CHECK(json_valid(descriptor_json) AND length(CAST(descriptor_json AS BLOB))<=2048),
 admission_id TEXT GENERATED ALWAYS AS (json_extract(descriptor_json,'$.admissionId')) STORED NOT NULL UNIQUE,
 backend TEXT GENERATED ALWAYS AS (json_extract(descriptor_json,'$.backend')) STORED NOT NULL,
 worker_boot_id TEXT UNIQUE CHECK(worker_boot_id IS NULL OR length(worker_boot_id)=36),
 deadline_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
 phase TEXT NOT NULL DEFAULT 'reserved' CHECK(phase IN ('reserved','running','unknown','retired')),
 fenced INTEGER NOT NULL DEFAULT 0 CHECK(fenced IN (0,1)),
 fence_reason TEXT CHECK(fence_reason IS NULL OR length(fence_reason) BETWEEN 1 AND 64),
 resource_retired INTEGER NOT NULL DEFAULT 0 CHECK(resource_retired IN (0,1)),
 cleanup_json TEXT CHECK(cleanup_json IS NULL OR (json_valid(cleanup_json) AND length(CAST(cleanup_json AS BLOB))<=8192)),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 UNIQUE(scope_hash,request_id),UNIQUE(instance_id,owner_generation),
 CHECK((fenced=0 AND fence_reason IS NULL) OR (fenced=1 AND fence_reason IS NOT NULL)),
 CHECK((phase='reserved' AND worker_boot_id IS NULL AND fenced=0 AND resource_retired=0 AND cleanup_json IS NULL) OR
 (phase='running' AND worker_boot_id IS NOT NULL AND fenced=0 AND resource_retired=0 AND cleanup_json IS NULL) OR
 (phase='unknown' AND fenced=1 AND resource_retired=0 AND cleanup_json IS NULL) OR
 (phase='retired' AND fenced=1 AND resource_retired=1 AND cleanup_json IS NOT NULL))
);
CREATE UNIQUE INDEX gpu135_one_live_control ON veyra_voice_gpu_controls(instance_id) WHERE resource_retired=0;
CREATE INDEX gpu135_control_recovery ON veyra_voice_gpu_controls(actor_id,runtime_id,phase,control_id);

CREATE TABLE veyra_voice_gpu_operations (
 operation_id TEXT PRIMARY KEY CHECK(length(operation_id)=36),
 kind TEXT NOT NULL CHECK(kind IN ('voice-gpu-speech-stt','voice-gpu-speech-tts')),
 request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 1 AND 256),
 control_id TEXT NOT NULL REFERENCES veyra_voice_gpu_controls(control_id) ON DELETE RESTRICT,
 scope_json TEXT NOT NULL CHECK(json_valid(scope_json) AND length(CAST(scope_json AS BLOB))<=4096),
 scope_hash TEXT NOT NULL CHECK(length(scope_hash)=64),
 owner_json TEXT NOT NULL CHECK(json_valid(owner_json) AND length(CAST(owner_json AS BLOB))<=2048),
 descriptor_json TEXT NOT NULL CHECK(json_valid(descriptor_json) AND length(CAST(descriptor_json AS BLOB))<=2048),
 worker_boot_id TEXT NOT NULL CHECK(length(worker_boot_id)=36),
 turn_generation INTEGER NOT NULL CHECK(turn_generation>=0),
 original_json TEXT NOT NULL CHECK(json_valid(original_json) AND length(CAST(original_json AS BLOB))<=8192),
 original_hash TEXT NOT NULL CHECK(length(original_hash)=64),
 identity_json TEXT NOT NULL CHECK(json_valid(identity_json) AND length(CAST(identity_json AS BLOB))<=4096),
 input_sha256 TEXT NOT NULL CHECK(length(input_sha256)=64),
 deadline_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
 phase TEXT NOT NULL DEFAULT 'bound' CHECK(phase IN ('bound','running','unknown','terminal')),
 dispatch_id TEXT UNIQUE CHECK(dispatch_id IS NULL OR length(dispatch_id)=36),
 fenced INTEGER NOT NULL DEFAULT 0 CHECK(fenced IN (0,1)),
 fence_reason TEXT CHECK(fence_reason IS NULL OR length(fence_reason) BETWEEN 1 AND 64),
 outcome TEXT CHECK(outcome IS NULL OR outcome IN ('completed','failed','cancelled','cancelled-before-dispatch')),
 result_json TEXT CHECK(result_json IS NULL OR (json_valid(result_json) AND length(CAST(result_json AS BLOB))<=4096)),
 resource_retired INTEGER NOT NULL DEFAULT 0 CHECK(resource_retired IN (0,1)),
 cleanup_json TEXT CHECK(cleanup_json IS NULL OR (json_valid(cleanup_json) AND length(CAST(cleanup_json AS BLOB))<=8192)),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),UNIQUE(scope_hash,request_id),
 CHECK((fenced=0 AND fence_reason IS NULL) OR (fenced=1 AND fence_reason IS NOT NULL)),
 CHECK((resource_retired=0 AND cleanup_json IS NULL) OR (resource_retired=1 AND cleanup_json IS NOT NULL)),
 CHECK((phase='bound' AND dispatch_id IS NULL AND fenced=0 AND outcome IS NULL AND result_json IS NULL AND resource_retired=0) OR
 (phase='running' AND dispatch_id IS NOT NULL AND fenced=0 AND outcome IS NULL AND result_json IS NULL AND resource_retired=0) OR
 (phase='unknown' AND fenced=1 AND outcome IS NULL AND result_json IS NULL) OR
 (phase='terminal' AND fenced=1 AND outcome IS NOT NULL AND resource_retired=1))
);
CREATE INDEX gpu135_operation_recovery ON veyra_voice_gpu_operations(control_id,phase,operation_id);

CREATE TRIGGER gpu135_control_initial BEFORE INSERT ON veyra_voice_gpu_controls
WHEN NEW.phase<>'reserved' OR NEW.revision<>0 OR NEW.fenced<>0 OR NEW.resource_retired<>0 OR NEW.worker_boot_id IS NOT NULL OR NEW.cleanup_json IS NOT NULL
 OR NEW.deadline_at<=NEW.created_at
 OR json_extract(NEW.descriptor_json,'$.version') IS NOT 1
 OR json_type(NEW.descriptor_json,'$.version') IS NOT 'integer'
 OR json_extract(NEW.descriptor_json,'$.resourceKind') IS NOT 'voice-gpu-v1'
 OR json_type(NEW.descriptor_json,'$.platform') IS NOT 'text'
 OR json_type(NEW.descriptor_json,'$.backend') IS NOT 'text'
 OR NOT ((NEW.backend='directml' AND json_extract(NEW.descriptor_json,'$.platform')='win32') OR
 (NEW.backend IN ('rocm','cuda') AND json_extract(NEW.descriptor_json,'$.platform')='linux'))
 OR (SELECT count(*) FROM json_each(NEW.descriptor_json))<>11
 OR EXISTS(SELECT 1 FROM json_each(NEW.descriptor_json) WHERE key NOT IN ('version','resourceKind','backend','platform','providerDigest','deviceIdentityDigest','deviceBootId','profileDigest','modelSetDigest','measurementDigest','admissionId'))
 OR EXISTS(SELECT 1 FROM json_each(NEW.descriptor_json) WHERE key IN ('providerDigest','deviceIdentityDigest','profileDigest','modelSetDigest','measurementDigest') AND (type<>'text' OR length(value)<>64 OR value GLOB '*[^0-9a-f]*'))
 OR json_type(NEW.descriptor_json,'$.providerDigest') IS NOT 'text'
 OR json_type(NEW.descriptor_json,'$.deviceIdentityDigest') IS NOT 'text'
 OR json_type(NEW.descriptor_json,'$.profileDigest') IS NOT 'text'
 OR json_type(NEW.descriptor_json,'$.modelSetDigest') IS NOT 'text'
 OR json_type(NEW.descriptor_json,'$.measurementDigest') IS NOT 'text'
 OR json_type(NEW.descriptor_json,'$.deviceBootId') IS NOT 'text' OR length(json_extract(NEW.descriptor_json,'$.deviceBootId'))<>36
 OR json_type(NEW.descriptor_json,'$.admissionId') IS NOT 'text' OR length(NEW.admission_id)<>36
 OR json_extract(NEW.original_json,'$.version') IS NOT 1 OR json_extract(NEW.original_json,'$.kind') IS NOT 'voice-gpu-supervisor'
 OR json_extract(NEW.original_json,'$.operationId') IS NOT NEW.control_id
 OR json_extract(NEW.original_json,'$.requestId') IS NOT NEW.request_id
 OR json_extract(NEW.original_json,'$.deadlineAt') IS NOT NEW.deadline_at
 OR json_extract(NEW.original_json,'$.scope') IS NOT json(NEW.scope_json)
 OR json_extract(NEW.original_json,'$.descriptor') IS NOT json(NEW.descriptor_json)
 OR json_extract(NEW.owner_json,'$.instanceId') IS NOT NEW.instance_id OR json_extract(NEW.owner_json,'$.ownerGeneration') IS NOT NEW.owner_generation
 OR EXISTS(SELECT 1 FROM veyra_voice_gpu_controls WHERE instance_id=NEW.instance_id AND owner_generation>=NEW.owner_generation)
BEGIN SELECT RAISE(ABORT,'GPU135 requires typed new GPU control DATA'); END;

CREATE TRIGGER gpu135_control_insert_collision BEFORE INSERT ON veyra_voice_gpu_controls
WHEN EXISTS(SELECT 1 FROM veyra_voice_gpu_controls s WHERE s.control_id=NEW.control_id OR (s.scope_hash=NEW.scope_hash AND s.request_id=NEW.request_id) OR s.admission_id=NEW.admission_id OR (NEW.worker_boot_id IS NOT NULL AND s.worker_boot_id=NEW.worker_boot_id) OR (s.instance_id=NEW.instance_id AND (s.owner_generation=NEW.owner_generation OR s.resource_retired=0)))
 OR EXISTS(SELECT 1 FROM veyra_voice_gpu_operations s WHERE s.operation_id=NEW.control_id OR (s.scope_hash=NEW.scope_hash AND s.request_id=NEW.request_id))
 OR EXISTS(SELECT 1 FROM veyra_voice_operations s WHERE s.operation_id=NEW.control_id OR (s.scope_hash=NEW.scope_hash AND s.request_id=NEW.request_id) OR (s.kind IN ('voice-cpu-supervisor','voice-speech-stt','voice-speech-tts') AND s.instance_id=NEW.instance_id AND s.resource_retired=0))
BEGIN SELECT RAISE(ABORT,'GPU135 original or voice slot collision'); END;
CREATE TRIGGER gpu135_control_update_collision BEFORE UPDATE ON veyra_voice_gpu_controls
WHEN EXISTS(SELECT 1 FROM veyra_voice_gpu_controls s WHERE s.control_id<>OLD.control_id AND (s.control_id=NEW.control_id OR (s.scope_hash=NEW.scope_hash AND s.request_id=NEW.request_id) OR s.admission_id=NEW.admission_id OR (NEW.worker_boot_id IS NOT NULL AND s.worker_boot_id=NEW.worker_boot_id) OR (s.instance_id=NEW.instance_id AND (s.owner_generation=NEW.owner_generation OR (s.resource_retired=0 AND NEW.resource_retired=0)))))
 OR EXISTS(SELECT 1 FROM veyra_voice_gpu_operations s WHERE s.operation_id=NEW.control_id OR (s.scope_hash=NEW.scope_hash AND s.request_id=NEW.request_id))
 OR EXISTS(SELECT 1 FROM veyra_voice_operations s WHERE s.operation_id=NEW.control_id OR (s.scope_hash=NEW.scope_hash AND s.request_id=NEW.request_id) OR (NEW.resource_retired=0 AND s.kind IN ('voice-cpu-supervisor','voice-speech-stt','voice-speech-tts') AND s.instance_id=NEW.instance_id AND s.resource_retired=0))
BEGIN SELECT RAISE(ABORT,'GPU135 cross-original control update collision'); END;
CREATE TRIGGER gpu135_control_identity BEFORE UPDATE ON veyra_voice_gpu_controls
WHEN NEW.control_id IS NOT OLD.control_id OR NEW.kind IS NOT OLD.kind OR NEW.request_id IS NOT OLD.request_id
 OR NEW.actor_id IS NOT OLD.actor_id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.project_id IS NOT OLD.project_id OR NEW.runtime_id IS NOT OLD.runtime_id OR NEW.workspace_id IS NOT OLD.workspace_id
 OR NEW.scope_json IS NOT OLD.scope_json OR NEW.scope_hash IS NOT OLD.scope_hash OR NEW.owner_json IS NOT OLD.owner_json OR NEW.instance_id IS NOT OLD.instance_id OR NEW.owner_generation IS NOT OLD.owner_generation
 OR NEW.user_epoch IS NOT OLD.user_epoch OR NEW.workspace_epoch IS NOT OLD.workspace_epoch OR NEW.runtime_epoch IS NOT OLD.runtime_epoch
 OR NEW.original_json IS NOT OLD.original_json OR NEW.original_hash IS NOT OLD.original_hash OR NEW.descriptor_json IS NOT OLD.descriptor_json OR NEW.deadline_at IS NOT OLD.deadline_at OR NEW.created_at IS NOT OLD.created_at
 OR NEW.revision<>OLD.revision+1 OR NEW.fenced<OLD.fenced OR NEW.resource_retired<OLD.resource_retired
 OR (OLD.worker_boot_id IS NOT NULL AND NEW.worker_boot_id IS NOT OLD.worker_boot_id)
 OR (NEW.worker_boot_id IS NOT OLD.worker_boot_id AND NOT (OLD.phase='reserved' AND NEW.phase='running' AND OLD.worker_boot_id IS NULL AND NEW.worker_boot_id IS NOT NULL))
 OR (OLD.fence_reason IS NOT NULL AND NEW.fence_reason IS NOT OLD.fence_reason)
 OR (OLD.cleanup_json IS NOT NULL AND NEW.cleanup_json IS NOT OLD.cleanup_json)
 OR NOT ((NEW.phase=OLD.phase AND NEW.worker_boot_id IS OLD.worker_boot_id AND NEW.resource_retired=OLD.resource_retired AND NEW.cleanup_json IS OLD.cleanup_json) OR
 (OLD.phase='reserved' AND NEW.phase='running' AND NEW.worker_boot_id IS NOT NULL) OR
 (OLD.phase IN ('reserved','running') AND NEW.phase='unknown' AND NEW.fenced=1) OR
 (OLD.phase IN ('reserved','running','unknown') AND NEW.phase='retired' AND NEW.fenced=1 AND NEW.resource_retired=1 AND NEW.cleanup_json IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'GPU135 control identity or lifecycle immutable'); END;
CREATE TRIGGER gpu135_control_no_delete BEFORE DELETE ON veyra_voice_gpu_controls
BEGIN SELECT RAISE(ABORT,'GPU135 control originals retained'); END;
CREATE TRIGGER gpu135_control_child_cleanup BEFORE UPDATE ON veyra_voice_gpu_controls
WHEN NEW.resource_retired=1 AND EXISTS(SELECT 1 FROM veyra_voice_gpu_operations c WHERE c.control_id=OLD.control_id AND c.resource_retired=0)
BEGIN SELECT RAISE(ABORT,'GPU135 child physical cleanup still unknown'); END;

CREATE TRIGGER gpu135_operation_initial BEFORE INSERT ON veyra_voice_gpu_operations
WHEN NEW.phase<>'bound' OR NEW.revision<>0 OR NEW.dispatch_id IS NOT NULL OR NEW.fenced<>0 OR NEW.resource_retired<>0 OR NEW.cleanup_json IS NOT NULL
 OR NEW.deadline_at<=NEW.created_at
 OR NOT EXISTS(SELECT 1 FROM veyra_voice_gpu_controls c WHERE c.control_id=NEW.control_id AND c.phase='running' AND c.fenced=0 AND c.resource_retired=0
 AND c.scope_json=NEW.scope_json AND c.scope_hash=NEW.scope_hash AND c.owner_json=NEW.owner_json AND c.descriptor_json=NEW.descriptor_json AND c.worker_boot_id=NEW.worker_boot_id AND NEW.deadline_at<=c.deadline_at)
 OR json_extract(NEW.original_json,'$.version') IS NOT 1 OR json_extract(NEW.original_json,'$.kind') IS NOT NEW.kind OR json_extract(NEW.original_json,'$.operationId') IS NOT NEW.operation_id
 OR json_extract(NEW.identity_json,'$.version') IS NOT 1 OR json_extract(NEW.identity_json,'$.resourceKind') IS NOT 'voice-gpu-dispatch-v1'
 OR json_extract(NEW.identity_json,'$.operationId') IS NOT NEW.operation_id OR json_extract(NEW.identity_json,'$.requestId') IS NOT NEW.operation_id
 OR json_extract(NEW.identity_json,'$.controlOperationId') IS NOT NEW.control_id OR json_extract(NEW.identity_json,'$.workerBootId') IS NOT NEW.worker_boot_id
 OR json_extract(NEW.identity_json,'$.inputSha256') IS NOT NEW.input_sha256 OR json_extract(NEW.identity_json,'$.descriptor') IS NOT json(NEW.descriptor_json)
 OR (NEW.kind='voice-gpu-speech-stt' AND json_extract(NEW.identity_json,'$.kind') IS NOT 'transcribe')
 OR (NEW.kind='voice-gpu-speech-tts' AND json_extract(NEW.identity_json,'$.kind') IS NOT 'synthesize')
BEGIN SELECT RAISE(ABORT,'GPU135 child requires matching GPU control DATA'); END;
CREATE TRIGGER gpu135_operation_insert_collision BEFORE INSERT ON veyra_voice_gpu_operations
WHEN EXISTS(SELECT 1 FROM veyra_voice_gpu_operations s WHERE s.operation_id=NEW.operation_id OR (s.scope_hash=NEW.scope_hash AND s.request_id=NEW.request_id) OR (NEW.dispatch_id IS NOT NULL AND s.dispatch_id=NEW.dispatch_id))
 OR EXISTS(SELECT 1 FROM veyra_voice_gpu_controls s WHERE s.control_id=NEW.operation_id OR (s.scope_hash=NEW.scope_hash AND s.request_id=NEW.request_id))
 OR EXISTS(SELECT 1 FROM veyra_voice_operations s WHERE s.operation_id=NEW.operation_id OR (s.scope_hash=NEW.scope_hash AND s.request_id=NEW.request_id))
BEGIN SELECT RAISE(ABORT,'GPU135 operation original collision'); END;
CREATE TRIGGER gpu135_operation_update_collision BEFORE UPDATE ON veyra_voice_gpu_operations
WHEN EXISTS(SELECT 1 FROM veyra_voice_gpu_operations s WHERE s.operation_id<>OLD.operation_id AND (s.operation_id=NEW.operation_id OR (s.scope_hash=NEW.scope_hash AND s.request_id=NEW.request_id) OR (NEW.dispatch_id IS NOT NULL AND s.dispatch_id=NEW.dispatch_id)))
 OR EXISTS(SELECT 1 FROM veyra_voice_gpu_controls s WHERE s.control_id=NEW.operation_id OR (s.scope_hash=NEW.scope_hash AND s.request_id=NEW.request_id))
 OR EXISTS(SELECT 1 FROM veyra_voice_operations s WHERE s.operation_id=NEW.operation_id OR (s.scope_hash=NEW.scope_hash AND s.request_id=NEW.request_id))
BEGIN SELECT RAISE(ABORT,'GPU135 cross-original operation update collision'); END;
CREATE TRIGGER gpu135_operation_identity BEFORE UPDATE ON veyra_voice_gpu_operations
WHEN NEW.operation_id IS NOT OLD.operation_id OR NEW.kind IS NOT OLD.kind OR NEW.request_id IS NOT OLD.request_id OR NEW.control_id IS NOT OLD.control_id
 OR NEW.scope_json IS NOT OLD.scope_json OR NEW.scope_hash IS NOT OLD.scope_hash OR NEW.owner_json IS NOT OLD.owner_json OR NEW.descriptor_json IS NOT OLD.descriptor_json OR NEW.worker_boot_id IS NOT OLD.worker_boot_id
 OR NEW.turn_generation IS NOT OLD.turn_generation OR NEW.original_json IS NOT OLD.original_json OR NEW.original_hash IS NOT OLD.original_hash OR NEW.identity_json IS NOT OLD.identity_json OR NEW.input_sha256 IS NOT OLD.input_sha256 OR NEW.deadline_at IS NOT OLD.deadline_at OR NEW.created_at IS NOT OLD.created_at
 OR NEW.revision<>OLD.revision+1 OR NEW.fenced<OLD.fenced OR NEW.resource_retired<OLD.resource_retired
 OR (OLD.dispatch_id IS NOT NULL AND NEW.dispatch_id IS NOT OLD.dispatch_id) OR (OLD.fence_reason IS NOT NULL AND NEW.fence_reason IS NOT OLD.fence_reason)
 OR (NEW.dispatch_id IS NOT OLD.dispatch_id AND NOT (OLD.phase='bound' AND NEW.phase='running' AND OLD.dispatch_id IS NULL AND NEW.dispatch_id IS NOT NULL))
 OR (OLD.outcome IS NOT NULL AND NEW.outcome IS NOT OLD.outcome) OR (OLD.result_json IS NOT NULL AND NEW.result_json IS NOT OLD.result_json) OR (OLD.cleanup_json IS NOT NULL AND NEW.cleanup_json IS NOT OLD.cleanup_json)
 OR NOT ((NEW.phase=OLD.phase AND NEW.dispatch_id IS OLD.dispatch_id AND NEW.outcome IS OLD.outcome AND NEW.result_json IS OLD.result_json AND NEW.resource_retired=OLD.resource_retired AND NEW.cleanup_json IS OLD.cleanup_json) OR
 (OLD.phase='unknown' AND NEW.phase='unknown' AND OLD.resource_retired=0 AND NEW.resource_retired=1 AND NEW.cleanup_json IS NOT NULL AND NEW.dispatch_id IS OLD.dispatch_id) OR
 (OLD.phase='bound' AND NEW.phase='running' AND NEW.dispatch_id IS NOT NULL AND EXISTS(SELECT 1 FROM veyra_voice_gpu_controls c WHERE c.control_id=NEW.control_id AND c.phase='running' AND c.fenced=0 AND c.resource_retired=0)) OR
 (OLD.phase IN ('bound','running') AND NEW.phase='unknown' AND NEW.fenced=1) OR
 (OLD.phase IN ('bound','running','unknown') AND NEW.phase='terminal' AND NEW.fenced=1 AND NEW.cleanup_json IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'GPU135 operation identity or lifecycle immutable'); END;
CREATE TRIGGER gpu135_operation_no_delete BEFORE DELETE ON veyra_voice_gpu_operations
BEGIN SELECT RAISE(ABORT,'GPU135 operation originals retained'); END;

-- Both families share UUID/request dedup and ONE instance voice-control slot.
-- These guards add refusal only. Old CPU table/rows/kind/proofs stay unchanged.
CREATE TRIGGER gpu135_legacy_insert_collision BEFORE INSERT ON veyra_voice_operations
WHEN EXISTS(SELECT 1 FROM veyra_voice_operations s WHERE s.operation_id=NEW.operation_id OR (s.scope_hash=NEW.scope_hash AND s.request_id=NEW.request_id))
 OR EXISTS(SELECT 1 FROM veyra_voice_gpu_controls s WHERE s.control_id=NEW.operation_id OR (s.scope_hash=NEW.scope_hash AND s.request_id=NEW.request_id) OR (NEW.kind IN ('voice-cpu-supervisor','voice-speech-stt','voice-speech-tts') AND NEW.resource_retired=0 AND s.instance_id=NEW.instance_id AND s.resource_retired=0))
 OR EXISTS(SELECT 1 FROM veyra_voice_gpu_operations s WHERE s.operation_id=NEW.operation_id OR (s.scope_hash=NEW.scope_hash AND s.request_id=NEW.request_id))
 OR EXISTS(SELECT 1 FROM veyra_voice_gpu_operations s JOIN veyra_voice_gpu_controls c ON c.control_id=s.control_id WHERE NEW.kind IN ('voice-cpu-supervisor','voice-speech-stt','voice-speech-tts') AND NEW.resource_retired=0 AND c.instance_id=NEW.instance_id AND s.resource_retired=0)
BEGIN SELECT RAISE(ABORT,'GPU135 cross-family original or slot collision'); END;
