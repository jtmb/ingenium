-- Draft additive migration; numbering and production execution belong to the coordinator.
-- Legacy tables and every FK remain intact. No transcript, secret, or ciphertext is copied.
CREATE TABLE veyra_workspace_projects (
  instance_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  label TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  archived_at TEXT,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
  legacy_project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
  PRIMARY KEY(instance_id, organization_id, owner_user_id, id)
);
CREATE TABLE veyra_workspace_roots (
  instance_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  canonical_root_id TEXT NOT NULL,
  display_path TEXT NOT NULL,
  is_primary INTEGER NOT NULL CHECK(is_primary IN (0,1)),
  repository_identity TEXT,
  PRIMARY KEY(instance_id, organization_id, owner_user_id, project_id, id),
  FOREIGN KEY(instance_id, organization_id, owner_user_id, project_id)
    REFERENCES veyra_workspace_projects(instance_id, organization_id, owner_user_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX veyra_one_primary_root ON veyra_workspace_roots(
  instance_id, organization_id, owner_user_id, project_id) WHERE is_primary = 1;
CREATE TABLE veyra_installation_legacy_refs (
  instance_id TEXT PRIMARY KEY,
  legacy_project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
);
CREATE TABLE veyra_project_aliases (
  instance_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  legacy_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  classification TEXT NOT NULL CHECK(classification IN ('workspace','installation','imported_unassigned')),
  evidence_ref TEXT NOT NULL,
  PRIMARY KEY(instance_id, source_system, source_id)
);
CREATE TABLE veyra_project_operations (
  scope_key TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','succeeded','failed','unknown')),
  result_json TEXT,
  PRIMARY KEY(scope_key, operation_id)
);
