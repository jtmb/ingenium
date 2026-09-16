-- Durable managed-mutation epochs, accepted path baselines, operation evidence,
-- and repository manifest generations for COORD-104/105.
BEGIN IMMEDIATE;

CREATE TABLE coordination_worktree_epochs (
  project_id TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  accepted_epoch INTEGER NOT NULL DEFAULT 1 CHECK(accepted_epoch >= 1),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'quarantined')),
  quarantine_code TEXT CHECK(quarantine_code IS NULL OR quarantine_code IN ('unexpected_footprint', 'uncertain_apply', 'dirty_baseline')),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  PRIMARY KEY(project_id, worktree_id),
  FOREIGN KEY(project_id, worktree_id) REFERENCES coordination_worktrees(project_id, worktree_id) ON DELETE CASCADE
);

CREATE TABLE coordination_managed_paths (
  project_id TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  path TEXT NOT NULL CHECK(length(path) BETWEEN 1 AND 1024),
  accepted_sha256 TEXT CHECK(accepted_sha256 IS NULL OR (length(accepted_sha256) = 64 AND accepted_sha256 NOT GLOB '*[^0-9a-f]*')),
  accepted_epoch INTEGER NOT NULL CHECK(accepted_epoch >= 1),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  PRIMARY KEY(project_id, worktree_id, path),
  FOREIGN KEY(project_id, worktree_id) REFERENCES coordination_worktrees(project_id, worktree_id) ON DELETE CASCADE
);

CREATE TABLE coordination_managed_operations (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  coordination_session_id TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  incarnation INTEGER NOT NULL CHECK(incarnation >= 1),
  fence INTEGER NOT NULL CHECK(fence >= 1),
  accepted_epoch INTEGER NOT NULL CHECK(accepted_epoch >= 1),
  client_claim_key_hash TEXT NOT NULL CHECK(length(client_claim_key_hash) = 64 AND client_claim_key_hash NOT GLOB '*[^0-9a-f]*'),
  operation TEXT NOT NULL CHECK(operation IN ('write', 'edit', 'create', 'delete', 'rename', 'apply_patch', 'repository', 'build')),
  state TEXT NOT NULL CHECK(state IN ('claimed', 'verified', 'quarantined', 'uncertain')),
  declared_paths_hash TEXT NOT NULL CHECK(length(declared_paths_hash) = 64 AND declared_paths_hash NOT GLOB '*[^0-9a-f]*'),
  footprint_hash TEXT CHECK(footprint_hash IS NULL OR (length(footprint_hash) = 64 AND footprint_hash NOT GLOB '*[^0-9a-f]*')),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  completed_at TEXT,
  FOREIGN KEY(project_id, coordination_session_id) REFERENCES coordination_sessions(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, worktree_id) REFERENCES coordination_worktrees(project_id, worktree_id) ON DELETE CASCADE
);

CREATE TABLE repository_sync_generations (
  project_id TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation >= 0),
  manifest_hash TEXT CHECK(manifest_hash IS NULL OR (length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^0-9a-f]*')),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  PRIMARY KEY(project_id, worktree_id),
  FOREIGN KEY(project_id, worktree_id) REFERENCES coordination_worktrees(project_id, worktree_id) ON DELETE CASCADE
);

CREATE INDEX idx_coordination_managed_operations_session
  ON coordination_managed_operations(project_id, coordination_session_id, state, created_at);

CREATE TRIGGER coordination_managed_operations_immutable_delete
BEFORE DELETE ON coordination_managed_operations
BEGIN
  SELECT RAISE(ABORT, 'coordination managed operations are retained');
END;

COMMIT;
