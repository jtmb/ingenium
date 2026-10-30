-- Core SQL129: one original managed execution owner, with an explicit inert
-- qualification purpose. No image approval, public bypass, new Run, quota or writer.
-- Existing production rows retain every original value/type/byte representation.
CREATE TABLE job_run_managed_execution_v129 (
  run_id TEXT PRIMARY KEY REFERENCES job_runs(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE,
  runtime_id TEXT NOT NULL,
  parent_container_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  binding_hash TEXT NOT NULL,
  binding_epoch INTEGER NOT NULL CHECK(binding_epoch >= 0),
  runtime_revision INTEGER NOT NULL,
  provisioning_revision INTEGER NOT NULL,
  job_revision INTEGER NOT NULL,
  schedule_revision INTEGER NOT NULL,
  grant_revision INTEGER NOT NULL,
  profile_id TEXT,
  profile_hash TEXT,
  prompt_hash TEXT NOT NULL,
  spec_hash TEXT NOT NULL,
  daemon_id TEXT NOT NULL,
  image_id TEXT NOT NULL,
  original_container_id TEXT UNIQUE,
  effect_fence TEXT NOT NULL DEFAULT 'untracked' CHECK(effect_fence IN ('untracked','open-v1','material-admitted-v1','create-admitted-v1','closed-no-create-v1')),
  phase TEXT NOT NULL CHECK(phase IN ('prepared','create_intent','created','start_intent','running','create_unknown','start_unknown','cancel_requested','retired')),
  admission_json TEXT NOT NULL CHECK(json_valid(admission_json)),
  run_identity_hash TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  material_consumed_at TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  resource_admission_id TEXT NOT NULL,
  credential_id TEXT, -- existing credential owner reference; NO plaintext secret in this table
  retirement_proof TEXT, -- bounded exact original-owner wait join; not cached execution authority
  outcome_consumed_at TEXT,
  container_removed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'production' CHECK(purpose IN ('production','candidate-inert-v1')),
  candidate_intent_json TEXT CHECK(candidate_intent_json IS NULL OR json_valid(candidate_intent_json)),
  candidate_intent_hash TEXT CHECK(candidate_intent_hash IS NULL OR length(candidate_intent_hash)=64),
  CHECK(CASE purpose WHEN 'production' THEN profile_id IS NOT NULL AND profile_hash IS NOT NULL AND candidate_intent_json IS NULL AND candidate_intent_hash IS NULL
   WHEN 'candidate-inert-v1' THEN profile_id IS NULL AND profile_hash IS NULL AND candidate_intent_json IS NOT NULL AND candidate_intent_hash IS NOT NULL AND COALESCE(
    json_extract(candidate_intent_json,'$.schemaVersion')=1 AND json_extract(candidate_intent_json,'$.purpose')='candidate-inert-v1'
    AND json_extract(candidate_intent_json,'$.run.runId')=run_id AND json_extract(candidate_intent_json,'$.run.jobId')=job_id AND json_extract(candidate_intent_json,'$.run.attemptId')=attempt_id
    AND json_extract(candidate_intent_json,'$.scope.organizationId')=organization_id AND json_extract(candidate_intent_json,'$.scope.projectId')=project_id AND json_extract(candidate_intent_json,'$.scope.ownerUserId')=owner_user_id
    AND json_extract(candidate_intent_json,'$.scope.workspaceId')=workspace_id AND json_extract(candidate_intent_json,'$.scope.bindingHash')=binding_hash AND json_extract(candidate_intent_json,'$.scope.bindingEpoch')=binding_epoch
    AND json_extract(candidate_intent_json,'$.parent.containerId')=parent_container_id AND json_extract(candidate_intent_json,'$.parent.runtimeId')=runtime_id
    AND json_extract(candidate_intent_json,'$.parent.daemonId')=daemon_id AND json_extract(candidate_intent_json,'$.imageId')=image_id
    AND json_extract(candidate_intent_json,'$.resource.admissionId')=resource_admission_id,0)
   ELSE 0 END)
);
INSERT INTO job_run_managed_execution_v129 (run_id,organization_id,owner_user_id,project_id,job_id,attempt_id,runtime_id,parent_container_id,workspace_id,binding_hash,binding_epoch,runtime_revision,provisioning_revision,job_revision,schedule_revision,grant_revision,profile_id,profile_hash,prompt_hash,spec_hash,daemon_id,image_id,original_container_id,effect_fence,phase,admission_json,run_identity_hash,deadline_at,result_json,material_consumed_at,revision,resource_admission_id,credential_id,retirement_proof,outcome_consumed_at,container_removed_at,created_at,updated_at) SELECT run_id,organization_id,owner_user_id,project_id,job_id,attempt_id,runtime_id,parent_container_id,workspace_id,binding_hash,binding_epoch,runtime_revision,provisioning_revision,job_revision,schedule_revision,grant_revision,profile_id,profile_hash,prompt_hash,spec_hash,daemon_id,image_id,original_container_id,effect_fence,phase,admission_json,run_identity_hash,deadline_at,result_json,material_consumed_at,revision,resource_admission_id,credential_id,retirement_proof,outcome_consumed_at,container_removed_at,created_at,updated_at FROM job_run_managed_execution;
-- Check both directions before replacing the original table. The guard fails
-- the enclosing Core transaction on any original typed-byte difference.
CREATE TEMP TABLE veyra_candidate_129_copy_guard(ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO veyra_candidate_129_copy_guard SELECT CASE WHEN
 EXISTS(SELECT typeof(run_id)||':'||hex(CAST(run_id AS BLOB)) AS run_id,typeof(organization_id)||':'||hex(CAST(organization_id AS BLOB)) AS organization_id,typeof(owner_user_id)||':'||hex(CAST(owner_user_id AS BLOB)) AS owner_user_id,typeof(project_id)||':'||hex(CAST(project_id AS BLOB)) AS project_id,typeof(job_id)||':'||hex(CAST(job_id AS BLOB)) AS job_id,typeof(attempt_id)||':'||hex(CAST(attempt_id AS BLOB)) AS attempt_id,typeof(runtime_id)||':'||hex(CAST(runtime_id AS BLOB)) AS runtime_id,typeof(parent_container_id)||':'||hex(CAST(parent_container_id AS BLOB)) AS parent_container_id,typeof(workspace_id)||':'||hex(CAST(workspace_id AS BLOB)) AS workspace_id,typeof(binding_hash)||':'||hex(CAST(binding_hash AS BLOB)) AS binding_hash,typeof(binding_epoch)||':'||hex(CAST(binding_epoch AS BLOB)) AS binding_epoch,typeof(runtime_revision)||':'||hex(CAST(runtime_revision AS BLOB)) AS runtime_revision,typeof(provisioning_revision)||':'||hex(CAST(provisioning_revision AS BLOB)) AS provisioning_revision,typeof(job_revision)||':'||hex(CAST(job_revision AS BLOB)) AS job_revision,typeof(schedule_revision)||':'||hex(CAST(schedule_revision AS BLOB)) AS schedule_revision,typeof(grant_revision)||':'||hex(CAST(grant_revision AS BLOB)) AS grant_revision,typeof(profile_id)||':'||hex(CAST(profile_id AS BLOB)) AS profile_id,typeof(profile_hash)||':'||hex(CAST(profile_hash AS BLOB)) AS profile_hash,typeof(prompt_hash)||':'||hex(CAST(prompt_hash AS BLOB)) AS prompt_hash,typeof(spec_hash)||':'||hex(CAST(spec_hash AS BLOB)) AS spec_hash,typeof(daemon_id)||':'||hex(CAST(daemon_id AS BLOB)) AS daemon_id,typeof(image_id)||':'||hex(CAST(image_id AS BLOB)) AS image_id,typeof(original_container_id)||':'||hex(CAST(original_container_id AS BLOB)) AS original_container_id,typeof(effect_fence)||':'||hex(CAST(effect_fence AS BLOB)) AS effect_fence,typeof(phase)||':'||hex(CAST(phase AS BLOB)) AS phase,typeof(admission_json)||':'||hex(CAST(admission_json AS BLOB)) AS admission_json,typeof(run_identity_hash)||':'||hex(CAST(run_identity_hash AS BLOB)) AS run_identity_hash,typeof(deadline_at)||':'||hex(CAST(deadline_at AS BLOB)) AS deadline_at,typeof(result_json)||':'||hex(CAST(result_json AS BLOB)) AS result_json,typeof(material_consumed_at)||':'||hex(CAST(material_consumed_at AS BLOB)) AS material_consumed_at,typeof(revision)||':'||hex(CAST(revision AS BLOB)) AS revision,typeof(resource_admission_id)||':'||hex(CAST(resource_admission_id AS BLOB)) AS resource_admission_id,typeof(credential_id)||':'||hex(CAST(credential_id AS BLOB)) AS credential_id,typeof(retirement_proof)||':'||hex(CAST(retirement_proof AS BLOB)) AS retirement_proof,typeof(outcome_consumed_at)||':'||hex(CAST(outcome_consumed_at AS BLOB)) AS outcome_consumed_at,typeof(container_removed_at)||':'||hex(CAST(container_removed_at AS BLOB)) AS container_removed_at,typeof(created_at)||':'||hex(CAST(created_at AS BLOB)) AS created_at,typeof(updated_at)||':'||hex(CAST(updated_at AS BLOB)) AS updated_at FROM job_run_managed_execution EXCEPT SELECT typeof(run_id)||':'||hex(CAST(run_id AS BLOB)) AS run_id,typeof(organization_id)||':'||hex(CAST(organization_id AS BLOB)) AS organization_id,typeof(owner_user_id)||':'||hex(CAST(owner_user_id AS BLOB)) AS owner_user_id,typeof(project_id)||':'||hex(CAST(project_id AS BLOB)) AS project_id,typeof(job_id)||':'||hex(CAST(job_id AS BLOB)) AS job_id,typeof(attempt_id)||':'||hex(CAST(attempt_id AS BLOB)) AS attempt_id,typeof(runtime_id)||':'||hex(CAST(runtime_id AS BLOB)) AS runtime_id,typeof(parent_container_id)||':'||hex(CAST(parent_container_id AS BLOB)) AS parent_container_id,typeof(workspace_id)||':'||hex(CAST(workspace_id AS BLOB)) AS workspace_id,typeof(binding_hash)||':'||hex(CAST(binding_hash AS BLOB)) AS binding_hash,typeof(binding_epoch)||':'||hex(CAST(binding_epoch AS BLOB)) AS binding_epoch,typeof(runtime_revision)||':'||hex(CAST(runtime_revision AS BLOB)) AS runtime_revision,typeof(provisioning_revision)||':'||hex(CAST(provisioning_revision AS BLOB)) AS provisioning_revision,typeof(job_revision)||':'||hex(CAST(job_revision AS BLOB)) AS job_revision,typeof(schedule_revision)||':'||hex(CAST(schedule_revision AS BLOB)) AS schedule_revision,typeof(grant_revision)||':'||hex(CAST(grant_revision AS BLOB)) AS grant_revision,typeof(profile_id)||':'||hex(CAST(profile_id AS BLOB)) AS profile_id,typeof(profile_hash)||':'||hex(CAST(profile_hash AS BLOB)) AS profile_hash,typeof(prompt_hash)||':'||hex(CAST(prompt_hash AS BLOB)) AS prompt_hash,typeof(spec_hash)||':'||hex(CAST(spec_hash AS BLOB)) AS spec_hash,typeof(daemon_id)||':'||hex(CAST(daemon_id AS BLOB)) AS daemon_id,typeof(image_id)||':'||hex(CAST(image_id AS BLOB)) AS image_id,typeof(original_container_id)||':'||hex(CAST(original_container_id AS BLOB)) AS original_container_id,typeof(effect_fence)||':'||hex(CAST(effect_fence AS BLOB)) AS effect_fence,typeof(phase)||':'||hex(CAST(phase AS BLOB)) AS phase,typeof(admission_json)||':'||hex(CAST(admission_json AS BLOB)) AS admission_json,typeof(run_identity_hash)||':'||hex(CAST(run_identity_hash AS BLOB)) AS run_identity_hash,typeof(deadline_at)||':'||hex(CAST(deadline_at AS BLOB)) AS deadline_at,typeof(result_json)||':'||hex(CAST(result_json AS BLOB)) AS result_json,typeof(material_consumed_at)||':'||hex(CAST(material_consumed_at AS BLOB)) AS material_consumed_at,typeof(revision)||':'||hex(CAST(revision AS BLOB)) AS revision,typeof(resource_admission_id)||':'||hex(CAST(resource_admission_id AS BLOB)) AS resource_admission_id,typeof(credential_id)||':'||hex(CAST(credential_id AS BLOB)) AS credential_id,typeof(retirement_proof)||':'||hex(CAST(retirement_proof AS BLOB)) AS retirement_proof,typeof(outcome_consumed_at)||':'||hex(CAST(outcome_consumed_at AS BLOB)) AS outcome_consumed_at,typeof(container_removed_at)||':'||hex(CAST(container_removed_at AS BLOB)) AS container_removed_at,typeof(created_at)||':'||hex(CAST(created_at AS BLOB)) AS created_at,typeof(updated_at)||':'||hex(CAST(updated_at AS BLOB)) AS updated_at FROM job_run_managed_execution_v129)
 OR EXISTS(SELECT typeof(run_id)||':'||hex(CAST(run_id AS BLOB)) AS run_id,typeof(organization_id)||':'||hex(CAST(organization_id AS BLOB)) AS organization_id,typeof(owner_user_id)||':'||hex(CAST(owner_user_id AS BLOB)) AS owner_user_id,typeof(project_id)||':'||hex(CAST(project_id AS BLOB)) AS project_id,typeof(job_id)||':'||hex(CAST(job_id AS BLOB)) AS job_id,typeof(attempt_id)||':'||hex(CAST(attempt_id AS BLOB)) AS attempt_id,typeof(runtime_id)||':'||hex(CAST(runtime_id AS BLOB)) AS runtime_id,typeof(parent_container_id)||':'||hex(CAST(parent_container_id AS BLOB)) AS parent_container_id,typeof(workspace_id)||':'||hex(CAST(workspace_id AS BLOB)) AS workspace_id,typeof(binding_hash)||':'||hex(CAST(binding_hash AS BLOB)) AS binding_hash,typeof(binding_epoch)||':'||hex(CAST(binding_epoch AS BLOB)) AS binding_epoch,typeof(runtime_revision)||':'||hex(CAST(runtime_revision AS BLOB)) AS runtime_revision,typeof(provisioning_revision)||':'||hex(CAST(provisioning_revision AS BLOB)) AS provisioning_revision,typeof(job_revision)||':'||hex(CAST(job_revision AS BLOB)) AS job_revision,typeof(schedule_revision)||':'||hex(CAST(schedule_revision AS BLOB)) AS schedule_revision,typeof(grant_revision)||':'||hex(CAST(grant_revision AS BLOB)) AS grant_revision,typeof(profile_id)||':'||hex(CAST(profile_id AS BLOB)) AS profile_id,typeof(profile_hash)||':'||hex(CAST(profile_hash AS BLOB)) AS profile_hash,typeof(prompt_hash)||':'||hex(CAST(prompt_hash AS BLOB)) AS prompt_hash,typeof(spec_hash)||':'||hex(CAST(spec_hash AS BLOB)) AS spec_hash,typeof(daemon_id)||':'||hex(CAST(daemon_id AS BLOB)) AS daemon_id,typeof(image_id)||':'||hex(CAST(image_id AS BLOB)) AS image_id,typeof(original_container_id)||':'||hex(CAST(original_container_id AS BLOB)) AS original_container_id,typeof(effect_fence)||':'||hex(CAST(effect_fence AS BLOB)) AS effect_fence,typeof(phase)||':'||hex(CAST(phase AS BLOB)) AS phase,typeof(admission_json)||':'||hex(CAST(admission_json AS BLOB)) AS admission_json,typeof(run_identity_hash)||':'||hex(CAST(run_identity_hash AS BLOB)) AS run_identity_hash,typeof(deadline_at)||':'||hex(CAST(deadline_at AS BLOB)) AS deadline_at,typeof(result_json)||':'||hex(CAST(result_json AS BLOB)) AS result_json,typeof(material_consumed_at)||':'||hex(CAST(material_consumed_at AS BLOB)) AS material_consumed_at,typeof(revision)||':'||hex(CAST(revision AS BLOB)) AS revision,typeof(resource_admission_id)||':'||hex(CAST(resource_admission_id AS BLOB)) AS resource_admission_id,typeof(credential_id)||':'||hex(CAST(credential_id AS BLOB)) AS credential_id,typeof(retirement_proof)||':'||hex(CAST(retirement_proof AS BLOB)) AS retirement_proof,typeof(outcome_consumed_at)||':'||hex(CAST(outcome_consumed_at AS BLOB)) AS outcome_consumed_at,typeof(container_removed_at)||':'||hex(CAST(container_removed_at AS BLOB)) AS container_removed_at,typeof(created_at)||':'||hex(CAST(created_at AS BLOB)) AS created_at,typeof(updated_at)||':'||hex(CAST(updated_at AS BLOB)) AS updated_at FROM job_run_managed_execution_v129 EXCEPT SELECT typeof(run_id)||':'||hex(CAST(run_id AS BLOB)) AS run_id,typeof(organization_id)||':'||hex(CAST(organization_id AS BLOB)) AS organization_id,typeof(owner_user_id)||':'||hex(CAST(owner_user_id AS BLOB)) AS owner_user_id,typeof(project_id)||':'||hex(CAST(project_id AS BLOB)) AS project_id,typeof(job_id)||':'||hex(CAST(job_id AS BLOB)) AS job_id,typeof(attempt_id)||':'||hex(CAST(attempt_id AS BLOB)) AS attempt_id,typeof(runtime_id)||':'||hex(CAST(runtime_id AS BLOB)) AS runtime_id,typeof(parent_container_id)||':'||hex(CAST(parent_container_id AS BLOB)) AS parent_container_id,typeof(workspace_id)||':'||hex(CAST(workspace_id AS BLOB)) AS workspace_id,typeof(binding_hash)||':'||hex(CAST(binding_hash AS BLOB)) AS binding_hash,typeof(binding_epoch)||':'||hex(CAST(binding_epoch AS BLOB)) AS binding_epoch,typeof(runtime_revision)||':'||hex(CAST(runtime_revision AS BLOB)) AS runtime_revision,typeof(provisioning_revision)||':'||hex(CAST(provisioning_revision AS BLOB)) AS provisioning_revision,typeof(job_revision)||':'||hex(CAST(job_revision AS BLOB)) AS job_revision,typeof(schedule_revision)||':'||hex(CAST(schedule_revision AS BLOB)) AS schedule_revision,typeof(grant_revision)||':'||hex(CAST(grant_revision AS BLOB)) AS grant_revision,typeof(profile_id)||':'||hex(CAST(profile_id AS BLOB)) AS profile_id,typeof(profile_hash)||':'||hex(CAST(profile_hash AS BLOB)) AS profile_hash,typeof(prompt_hash)||':'||hex(CAST(prompt_hash AS BLOB)) AS prompt_hash,typeof(spec_hash)||':'||hex(CAST(spec_hash AS BLOB)) AS spec_hash,typeof(daemon_id)||':'||hex(CAST(daemon_id AS BLOB)) AS daemon_id,typeof(image_id)||':'||hex(CAST(image_id AS BLOB)) AS image_id,typeof(original_container_id)||':'||hex(CAST(original_container_id AS BLOB)) AS original_container_id,typeof(effect_fence)||':'||hex(CAST(effect_fence AS BLOB)) AS effect_fence,typeof(phase)||':'||hex(CAST(phase AS BLOB)) AS phase,typeof(admission_json)||':'||hex(CAST(admission_json AS BLOB)) AS admission_json,typeof(run_identity_hash)||':'||hex(CAST(run_identity_hash AS BLOB)) AS run_identity_hash,typeof(deadline_at)||':'||hex(CAST(deadline_at AS BLOB)) AS deadline_at,typeof(result_json)||':'||hex(CAST(result_json AS BLOB)) AS result_json,typeof(material_consumed_at)||':'||hex(CAST(material_consumed_at AS BLOB)) AS material_consumed_at,typeof(revision)||':'||hex(CAST(revision AS BLOB)) AS revision,typeof(resource_admission_id)||':'||hex(CAST(resource_admission_id AS BLOB)) AS resource_admission_id,typeof(credential_id)||':'||hex(CAST(credential_id AS BLOB)) AS credential_id,typeof(retirement_proof)||':'||hex(CAST(retirement_proof AS BLOB)) AS retirement_proof,typeof(outcome_consumed_at)||':'||hex(CAST(outcome_consumed_at AS BLOB)) AS outcome_consumed_at,typeof(container_removed_at)||':'||hex(CAST(container_removed_at AS BLOB)) AS container_removed_at,typeof(created_at)||':'||hex(CAST(created_at AS BLOB)) AS created_at,typeof(updated_at)||':'||hex(CAST(updated_at AS BLOB)) AS updated_at FROM job_run_managed_execution)
 THEN 0 ELSE 1 END;
DROP TABLE veyra_candidate_129_copy_guard;
DROP TRIGGER managed_job_execution_immutable;
DROP TRIGGER managed_job_effect_fence_monotonic;
DROP TRIGGER managed_job_credential_requires_material;
DROP TABLE job_run_managed_execution;
ALTER TABLE job_run_managed_execution_v129 RENAME TO job_run_managed_execution;
CREATE TRIGGER managed_job_execution_immutable BEFORE UPDATE ON job_run_managed_execution
WHEN NEW.run_id IS NOT OLD.run_id
 OR NEW.project_id IS NOT OLD.project_id
 OR NEW.organization_id IS NOT OLD.organization_id
 OR NEW.owner_user_id IS NOT OLD.owner_user_id
 OR NEW.job_id IS NOT OLD.job_id
 OR NEW.attempt_id IS NOT OLD.attempt_id
 OR NEW.runtime_id IS NOT OLD.runtime_id
 OR NEW.parent_container_id IS NOT OLD.parent_container_id
 OR NEW.workspace_id IS NOT OLD.workspace_id
 OR NEW.binding_hash IS NOT OLD.binding_hash
 OR NEW.binding_epoch IS NOT OLD.binding_epoch
 OR NEW.runtime_revision IS NOT OLD.runtime_revision
 OR NEW.provisioning_revision IS NOT OLD.provisioning_revision
 OR NEW.job_revision IS NOT OLD.job_revision
 OR NEW.schedule_revision IS NOT OLD.schedule_revision
 OR NEW.grant_revision IS NOT OLD.grant_revision
 OR NEW.profile_id IS NOT OLD.profile_id
 OR NEW.profile_hash IS NOT OLD.profile_hash
 OR NEW.prompt_hash IS NOT OLD.prompt_hash
 OR NEW.spec_hash IS NOT OLD.spec_hash
 OR NEW.daemon_id IS NOT OLD.daemon_id
 OR NEW.image_id IS NOT OLD.image_id
 OR NEW.resource_admission_id IS NOT OLD.resource_admission_id
 OR NEW.admission_json IS NOT OLD.admission_json
 OR NEW.run_identity_hash IS NOT OLD.run_identity_hash
 OR NEW.deadline_at IS NOT OLD.deadline_at
 OR NEW.created_at IS NOT OLD.created_at
 OR NEW.revision != OLD.revision+1
 OR (NEW.original_container_id IS NOT OLD.original_container_id AND OLD.original_container_id IS NOT NULL)
 OR (NEW.credential_id IS NOT OLD.credential_id AND OLD.credential_id IS NOT NULL)
 OR (NEW.retirement_proof IS NOT OLD.retirement_proof AND OLD.retirement_proof IS NOT NULL)
 OR (NEW.result_json IS NOT OLD.result_json AND OLD.result_json IS NOT NULL)
 OR NEW.purpose IS NOT OLD.purpose OR NEW.candidate_intent_json IS NOT OLD.candidate_intent_json OR NEW.candidate_intent_hash IS NOT OLD.candidate_intent_hash
BEGIN SELECT RAISE(ABORT,'Original managed JobRun identity is immutable'); END;
CREATE TRIGGER managed_job_effect_fence_monotonic BEFORE UPDATE ON job_run_managed_execution
WHEN COALESCE((
  NEW.effect_fence=OLD.effect_fence
  OR (OLD.effect_fence='open-v1' AND NEW.effect_fence='material-admitted-v1' AND OLD.phase='prepared' AND NEW.phase='prepared')
  OR (OLD.effect_fence='material-admitted-v1' AND NEW.effect_fence='create-admitted-v1' AND OLD.phase='prepared' AND NEW.phase='create_intent' AND OLD.material_consumed_at IS NOT NULL AND OLD.credential_id IS NOT NULL)
  OR (OLD.effect_fence='open-v1' AND NEW.effect_fence='closed-no-create-v1' AND OLD.phase IN ('prepared','cancel_requested') AND NEW.phase='retired'
    AND OLD.original_container_id IS NULL AND NEW.original_container_id IS NULL
    AND OLD.material_consumed_at IS NULL AND NEW.material_consumed_at IS NULL
    AND OLD.credential_id IS NULL AND NEW.credential_id IS NULL AND OLD.result_json IS NULL AND NEW.result_json IS NULL
    AND NOT EXISTS(SELECT 1 FROM job_run_mcp_credentials c WHERE c.run_id=OLD.run_id)
    AND json_extract(NEW.retirement_proof,'$.schemaVersion')=1
    AND json_extract(NEW.retirement_proof,'$.kind')='core-no-create-effect-v1'
    AND json_extract(NEW.retirement_proof,'$.runId')=OLD.run_id
    AND json_extract(NEW.retirement_proof,'$.attemptId')=OLD.attempt_id
    AND json_extract(NEW.retirement_proof,'$.specHash')=OLD.spec_hash
    AND json_extract(NEW.retirement_proof,'$.runIdentityHash')=OLD.run_identity_hash
    AND json_extract(NEW.retirement_proof,'$.effectFence')='closed-no-create-v1'
    AND json_extract(NEW.retirement_proof,'$.closedRevision')=NEW.revision)
),0)=0
 OR (NEW.effect_fence IN ('open-v1','material-admitted-v1') AND NEW.phase NOT IN ('prepared','cancel_requested'))
 OR (NEW.phase='create_intent' AND NEW.effect_fence!='create-admitted-v1')
 OR (NEW.effect_fence='closed-no-create-v1' AND (NEW.phase!='retired' OR NEW.original_container_id IS NOT NULL OR NEW.material_consumed_at IS NOT NULL OR NEW.credential_id IS NOT NULL OR NEW.result_json IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'Managed effect admission fence is monotonic'); END;
-- Existing encrypted credentials are NOT copied, rotated or re-encrypted.
ALTER TABLE job_run_mcp_credentials ADD COLUMN purpose TEXT NOT NULL DEFAULT 'production' CHECK(purpose IN ('production','candidate-inert-v1'));
ALTER TABLE job_run_mcp_credentials ADD COLUMN candidate_intent_hash TEXT CHECK(
 (purpose='production' AND candidate_intent_hash IS NULL) OR
 (purpose='candidate-inert-v1' AND candidate_intent_hash IS NOT NULL AND length(candidate_intent_hash)=64));
CREATE TRIGGER job_run_credential_purpose_immutable BEFORE UPDATE ON job_run_mcp_credentials
WHEN NEW.purpose IS NOT OLD.purpose OR NEW.candidate_intent_hash IS NOT OLD.candidate_intent_hash
BEGIN SELECT RAISE(ABORT,'Original JobRun credential purpose is immutable'); END;
CREATE TRIGGER managed_job_credential_requires_material BEFORE INSERT ON job_run_mcp_credentials
WHEN NOT EXISTS(SELECT 1 FROM job_run_managed_execution e WHERE e.run_id=NEW.run_id AND e.attempt_id=NEW.attempt_id
  AND e.purpose=NEW.purpose AND e.candidate_intent_hash IS NEW.candidate_intent_hash
  AND e.effect_fence='material-admitted-v1' AND e.phase='prepared' AND e.credential_id IS NULL)
BEGIN SELECT RAISE(ABORT,'Original material admission is required'); END;
CREATE TABLE managed_job_execution_purpose_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1),schema_version INTEGER NOT NULL CHECK(schema_version=1));
INSERT INTO managed_job_execution_purpose_schema VALUES(1,1);
CREATE TRIGGER managed_job_purpose_schema_no_update BEFORE UPDATE ON managed_job_execution_purpose_schema BEGIN SELECT RAISE(ABORT,'Managed purpose schema marker is immutable'); END;
CREATE TRIGGER managed_job_purpose_schema_no_delete BEFORE DELETE ON managed_job_execution_purpose_schema BEGIN SELECT RAISE(ABORT,'Managed purpose schema marker is immutable'); END;
