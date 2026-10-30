-- NodeSQL 126 RESERVED by Root for this original managed JobRun ledger proposal.
-- Source only: no shared migration installed, production write cutover or second writer authorized.
-- Root reviews original job_runs schema and owns actual migration installation.
-- This is one execution binding per EXISTING original JobRun, never a second JobRun/scheduler/database.
CREATE TABLE job_run_managed_execution (
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
  profile_id TEXT NOT NULL,
  profile_hash TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  spec_hash TEXT NOT NULL,
  daemon_id TEXT NOT NULL,
  image_id TEXT NOT NULL,
  original_container_id TEXT UNIQUE,
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
  updated_at TEXT NOT NULL
);
-- Core must match the run's original project/job/org/service-principal and current approved capabilities.
-- Core CAS effect-intent writes and credential issuance commit synchronously BEFORE remote effects.
-- Identity fields are immutable; unknown create/start is NEVER reset to prepared or replaced.
-- No timer, retry lease, transcript, prompt copy, alternate run row or manager writer belongs here.

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
BEGIN SELECT RAISE(ABORT,'Original managed JobRun identity is immutable'); END;

-- Explicit job-run credential kind/audience sidecar owned by mcp-credentials.ts.
-- Do not rebuild, rewrite, relabel or relax CHECKs/triggers on legacy credential tables.
CREATE TABLE job_run_mcp_credentials (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES job_runs(id) ON DELETE RESTRICT,
  attempt_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind='job-run'),
  audience TEXT NOT NULL CHECK(audience='job-run'),
  service_principal_id TEXT NOT NULL REFERENCES service_principals(id) ON DELETE RESTRICT,
  principal_security_epoch INTEGER NOT NULL,
  workspace_security_epoch INTEGER NOT NULL,
  token_prefix TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  encrypted_token TEXT NOT NULL,
  scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json)),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TRIGGER job_run_mcp_credentials_immutable BEFORE UPDATE ON job_run_mcp_credentials
WHEN NEW.id IS NOT OLD.id OR NEW.run_id IS NOT OLD.run_id OR NEW.attempt_id IS NOT OLD.attempt_id
  OR NEW.kind IS NOT OLD.kind OR NEW.audience IS NOT OLD.audience
  OR NEW.service_principal_id IS NOT OLD.service_principal_id
  OR NEW.principal_security_epoch IS NOT OLD.principal_security_epoch
  OR NEW.workspace_security_epoch IS NOT OLD.workspace_security_epoch
  OR NEW.token_prefix IS NOT OLD.token_prefix OR NEW.token_hash IS NOT OLD.token_hash
  OR NEW.encrypted_token IS NOT OLD.encrypted_token OR NEW.scopes_json IS NOT OLD.scopes_json
  OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_at IS NOT OLD.created_at
  OR (NEW.revoked_at IS NOT OLD.revoked_at AND (OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL))
BEGIN SELECT RAISE(ABORT,'Original JobRun credential metadata is immutable'); END;
