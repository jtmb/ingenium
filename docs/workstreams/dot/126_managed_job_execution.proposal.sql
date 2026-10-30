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
