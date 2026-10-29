-- Native workspace.db v6 proposal. No project/account/transcript rows are rewritten.
CREATE TABLE private_workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  owner_key TEXT NOT NULL CHECK(length(owner_key)=64 AND owner_key NOT GLOB '*[^0-9a-f]*'),
  environment TEXT NOT NULL CHECK(json_valid(environment)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 4294967295),
  state TEXT NOT NULL CHECK(state IN ('pending','active','unknown','failed','retired')),
  create_request_id TEXT NOT NULL,
  create_sha256 TEXT NOT NULL CHECK(length(create_sha256)=64),
  created_instance_id TEXT NOT NULL,
  directory TEXT,
  root_identity TEXT,
  UNIQUE(owner_key,create_request_id),
  UNIQUE(id,owner_key),
  CHECK(state <> 'active' OR (directory IS NOT NULL AND root_identity IS NOT NULL))
) STRICT;
CREATE TABLE private_workspace_operations (
  owner_key TEXT NOT NULL,
  request_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workspace_revision INTEGER NOT NULL CHECK(workspace_revision BETWEEN 1 AND 4294967295),
  service_instance_id TEXT NOT NULL,
  authority_epoch INTEGER NOT NULL CHECK(authority_epoch>=0),
  original_sha256 TEXT NOT NULL CHECK(length(original_sha256)=64),
  operation_kind TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','succeeded','failed','unknown')),
  result_ref TEXT,
  PRIMARY KEY(owner_key,request_id),
  FOREIGN KEY(workspace_id,owner_key) REFERENCES private_workspaces(id,owner_key) ON DELETE RESTRICT
) STRICT;
CREATE INDEX private_workspaces_owner ON private_workspaces(owner_key,id);
PRAGMA user_version=6;
