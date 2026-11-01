-- Proposal for the EXISTING original Node Core writer. No new database owner.
-- Metadata only; original private plan/dispatch handles remain process-local.
CREATE TABLE veyra_voice_assistant_sources (
 claim_id TEXT PRIMARY KEY CHECK(length(claim_id)=36),
 source_id TEXT NOT NULL CHECK(length(source_id)=36),
 call_id TEXT NOT NULL CHECK(length(call_id)=36),
 call_instance_id TEXT NOT NULL CHECK(length(call_instance_id)=36),
 call_generation INTEGER NOT NULL CHECK(call_generation>=0),
 segment_index INTEGER NOT NULL CHECK(segment_index BETWEEN 0 AND 511),
 scope_json TEXT NOT NULL CHECK(json_valid(scope_json) AND length(CAST(scope_json AS BLOB))<=4096),
 scope_hash TEXT NOT NULL CHECK(length(scope_hash)=64),
 owner_json TEXT NOT NULL CHECK(json_valid(owner_json) AND length(CAST(owner_json AS BLOB))<=2048),
 control_operation_id TEXT NOT NULL REFERENCES veyra_voice_operations(operation_id) ON DELETE RESTRICT,
 source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
 plan_hash TEXT NOT NULL CHECK(length(plan_hash)=64),
 profile_digest TEXT NOT NULL CHECK(length(profile_digest)=64),
 voice TEXT NOT NULL CHECK(length(voice) BETWEEN 1 AND 64),
 text_sha256 TEXT NOT NULL CHECK(length(text_sha256)=64),
 request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 1 AND 256),
 identity_json TEXT NOT NULL CHECK(json_valid(identity_json) AND length(CAST(identity_json AS BLOB))<=16384),
 identity_hash TEXT NOT NULL CHECK(length(identity_hash)=64),
 deadline_at INTEGER NOT NULL,created_at INTEGER NOT NULL,
 phase TEXT NOT NULL DEFAULT 'reserved' CHECK(phase IN ('reserved','linked','spent','unknown','fenced')),
 cpu_operation_id TEXT UNIQUE REFERENCES veyra_voice_operations(operation_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 dispatch_id TEXT UNIQUE CHECK(dispatch_id IS NULL OR length(dispatch_id)=36),
 cpu_identity_json TEXT CHECK(cpu_identity_json IS NULL OR (json_valid(cpu_identity_json) AND length(CAST(cpu_identity_json AS BLOB))<=2048)),
 spent_at INTEGER,fenced INTEGER NOT NULL DEFAULT 0 CHECK(fenced IN (0,1)),
 fence_reason TEXT CHECK(fence_reason IS NULL OR length(fence_reason) BETWEEN 1 AND 64),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 UNIQUE(call_instance_id,source_id,segment_index),
 CHECK((dispatch_id IS NULL AND cpu_identity_json IS NULL AND spent_at IS NULL) OR (dispatch_id IS NOT NULL AND cpu_identity_json IS NOT NULL AND spent_at IS NOT NULL)),
 CHECK((phase='reserved' AND cpu_operation_id IS NULL AND dispatch_id IS NULL AND fenced=0) OR
       (phase='linked' AND cpu_operation_id IS NOT NULL AND dispatch_id IS NULL AND fenced=0) OR
       (phase='spent' AND cpu_operation_id IS NOT NULL AND dispatch_id IS NOT NULL) OR
       (phase IN ('unknown','fenced') AND dispatch_id IS NULL AND fenced=1)),
 CHECK((fenced=0 AND fence_reason IS NULL) OR (fenced=1 AND fence_reason IS NOT NULL))
);
CREATE INDEX veyra_voice_assistant_call_fence ON veyra_voice_assistant_sources(call_instance_id,call_generation,fenced);
-- REPLACE must not erase old claims even with recursive_triggers disabled.
CREATE TRIGGER veyra_voice_assistant_no_replace BEFORE INSERT ON veyra_voice_assistant_sources
WHEN EXISTS(SELECT 1 FROM veyra_voice_assistant_sources WHERE claim_id=NEW.claim_id OR
 (call_instance_id=NEW.call_instance_id AND source_id=NEW.source_id AND segment_index=NEW.segment_index) OR
 (NEW.cpu_operation_id IS NOT NULL AND cpu_operation_id=NEW.cpu_operation_id) OR
 (NEW.dispatch_id IS NOT NULL AND dispatch_id=NEW.dispatch_id))
BEGIN SELECT RAISE(ABORT,'assistant source original already retained'); END;
CREATE TRIGGER veyra_voice_assistant_initial BEFORE INSERT ON veyra_voice_assistant_sources
WHEN NEW.phase<>'reserved' OR NEW.revision<>0 OR NEW.fenced<>0 OR NEW.cpu_operation_id IS NOT NULL OR NEW.dispatch_id IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM veyra_voice_operations c WHERE c.operation_id=NEW.control_operation_id
 AND c.kind='voice-cpu-supervisor' AND c.state='running' AND c.resource_retired=0
 AND c.scope_hash=NEW.scope_hash AND c.owner_json=NEW.owner_json
 AND json_extract(c.control_json,'$.profileDigest')=NEW.profile_digest)
BEGIN SELECT RAISE(ABORT,'assistant source requires original running CPU control'); END;
CREATE TRIGGER veyra_voice_assistant_immutable BEFORE UPDATE ON veyra_voice_assistant_sources
WHEN NEW.claim_id IS NOT OLD.claim_id OR NEW.source_id IS NOT OLD.source_id OR NEW.call_id IS NOT OLD.call_id
 OR NEW.call_instance_id IS NOT OLD.call_instance_id OR NEW.call_generation IS NOT OLD.call_generation OR NEW.segment_index IS NOT OLD.segment_index
 OR NEW.scope_json IS NOT OLD.scope_json OR NEW.scope_hash IS NOT OLD.scope_hash OR NEW.owner_json IS NOT OLD.owner_json
 OR NEW.control_operation_id IS NOT OLD.control_operation_id OR NEW.source_hash IS NOT OLD.source_hash OR NEW.plan_hash IS NOT OLD.plan_hash
 OR NEW.profile_digest IS NOT OLD.profile_digest OR NEW.voice IS NOT OLD.voice OR NEW.text_sha256 IS NOT OLD.text_sha256 OR NEW.request_id IS NOT OLD.request_id
 OR NEW.identity_json IS NOT OLD.identity_json OR NEW.identity_hash IS NOT OLD.identity_hash OR NEW.deadline_at IS NOT OLD.deadline_at OR NEW.created_at IS NOT OLD.created_at
 OR NEW.revision<>OLD.revision+1 OR NEW.fenced<OLD.fenced
 OR (OLD.fence_reason IS NOT NULL AND NEW.fence_reason IS NOT OLD.fence_reason)
 OR (OLD.cpu_operation_id IS NOT NULL AND NEW.cpu_operation_id IS NOT OLD.cpu_operation_id)
 OR (OLD.dispatch_id IS NOT NULL AND (NEW.dispatch_id IS NOT OLD.dispatch_id OR NEW.cpu_identity_json IS NOT OLD.cpu_identity_json OR NEW.spent_at IS NOT OLD.spent_at))
 OR NOT ((NEW.phase=OLD.phase AND NEW.cpu_operation_id IS OLD.cpu_operation_id AND NEW.dispatch_id IS OLD.dispatch_id)
 OR (OLD.phase='reserved' AND NEW.phase='linked' AND OLD.fenced=0 AND NEW.fenced=0)
 OR (OLD.phase='linked' AND NEW.phase='spent' AND OLD.fenced=0 AND NEW.fenced=0)
 OR (OLD.phase IN ('reserved','linked') AND NEW.phase IN ('unknown','fenced') AND NEW.fenced=1))
BEGIN SELECT RAISE(ABORT,'assistant source identity or lifecycle immutable'); END;
CREATE TRIGGER veyra_voice_assistant_spend BEFORE UPDATE ON veyra_voice_assistant_sources
WHEN OLD.phase='linked' AND NEW.phase='spent' AND NOT EXISTS(
 SELECT 1 FROM veyra_voice_operations c WHERE c.operation_id=NEW.cpu_operation_id AND c.kind='voice-speech-tts'
 AND c.parent_operation_id=NEW.control_operation_id AND c.control_operation_id=NEW.control_operation_id
 AND c.scope_hash=NEW.scope_hash AND c.owner_json=NEW.owner_json AND c.request_id=NEW.request_id AND c.turn_generation=NEW.call_generation
 AND c.cpu_identity_json=NEW.cpu_identity_json AND c.state='reserved' AND c.resource_retired=0
 AND json_extract(c.cpu_json,'$.phase')='bound' AND json_extract(c.cpu_json,'$.dispatchClaimed')=0)
BEGIN SELECT RAISE(ABORT,'assistant spend requires original reserved CPU dispatch'); END;
-- Generic reserve still requires a completed original agent turn in Node code.
-- Only the private attached branch links the claim before its CPU INSERT, in one transaction.
CREATE TRIGGER veyra_voice_assistant_cpu_link BEFORE INSERT ON veyra_voice_operations
WHEN NEW.kind='voice-speech-tts' AND NEW.parent_operation_id=NEW.control_operation_id AND NOT EXISTS(
 SELECT 1 FROM veyra_voice_assistant_sources s WHERE s.cpu_operation_id=NEW.operation_id AND s.phase='linked' AND s.fenced=0
 AND s.control_operation_id=NEW.control_operation_id AND s.scope_hash=NEW.scope_hash AND s.owner_json=NEW.owner_json
 AND s.request_id=NEW.request_id AND s.call_generation=NEW.turn_generation AND NEW.deadline_at<=s.deadline_at)
BEGIN SELECT RAISE(ABORT,'attached CPU requires original linked assistant claim'); END;
CREATE TRIGGER veyra_voice_assistant_no_delete BEFORE DELETE ON veyra_voice_assistant_sources
BEGIN SELECT RAISE(ABORT,'assistant originals retained for no replay'); END;
-- UPDATE OR REPLACE can otherwise delete a DIFFERENT original on UNIQUE
-- collision before its delete trigger runs (recursive_triggers=OFF).
-- ABORT also overrides caller OR IGNORE/OR REPLACE conflict policies.
CREATE TRIGGER veyra_voice_assistant_update_no_replace BEFORE UPDATE ON veyra_voice_assistant_sources
WHEN EXISTS(SELECT 1 FROM veyra_voice_assistant_sources s WHERE s.claim_id<>OLD.claim_id AND (
 s.claim_id=NEW.claim_id OR
 (s.call_instance_id=NEW.call_instance_id AND s.source_id=NEW.source_id AND s.segment_index=NEW.segment_index) OR
 (NEW.cpu_operation_id IS NOT NULL AND s.cpu_operation_id=NEW.cpu_operation_id) OR
 (NEW.dispatch_id IS NOT NULL AND s.dispatch_id=NEW.dispatch_id)))
BEGIN SELECT RAISE(ABORT,'assistant source cross-original update collision'); END;
