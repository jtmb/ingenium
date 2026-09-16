-- COORD-101: durable, project-scoped coordination registry. Ownership tokens
-- are never persisted directly; only their SHA-256 hashes are retained.
BEGIN IMMEDIATE;

CREATE TABLE coordination_worktrees (
  project_id TEXT NOT NULL,
  worktree_id TEXT NOT NULL CHECK(
    length(worktree_id) BETWEEN 1 AND 512
    AND worktree_id NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  next_fence INTEGER NOT NULL DEFAULT 1 CHECK(next_fence >= 1),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  PRIMARY KEY(project_id, worktree_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE coordination_sessions (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  session_id TEXT NOT NULL CHECK(
    length(session_id) BETWEEN 1 AND 512
    AND session_id NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  incarnation INTEGER NOT NULL CHECK(incarnation >= 1),
  ownership_token_hash TEXT NOT NULL CHECK(
    length(ownership_token_hash) = 64
    AND ownership_token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  fence INTEGER NOT NULL CHECK(fence >= 1),
  state TEXT NOT NULL CHECK(state IN ('active', 'quarantined', 'closed')),
  heartbeat_at TEXT NOT NULL CHECK(length(heartbeat_at) BETWEEN 1 AND 64),
  expires_at TEXT NOT NULL CHECK(length(expires_at) BETWEEN 1 AND 64),
  snapshot_json TEXT NOT NULL DEFAULT '{}' CHECK(
    json_valid(snapshot_json)
    AND json_type(snapshot_json) = 'object'
    AND length(CAST(snapshot_json AS BLOB)) <= 16384
  ),
  snapshot_revision INTEGER NOT NULL DEFAULT 0 CHECK(snapshot_revision >= 0),
  current_task_id TEXT,
  current_task_revision INTEGER,
  context_conversation_id TEXT,
  context_revision INTEGER,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, id),
  UNIQUE(project_id, worktree_id, session_id, incarnation),
  CHECK(
    (current_task_id IS NULL AND current_task_revision IS NULL)
    OR (current_task_id IS NOT NULL AND current_task_revision >= 0)
  ),
  CHECK(
    (context_conversation_id IS NULL AND context_revision IS NULL)
    OR (context_conversation_id IS NOT NULL AND context_revision >= 0)
  ),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, worktree_id)
    REFERENCES coordination_worktrees(project_id, worktree_id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, current_task_id)
    REFERENCES tasks(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, context_conversation_id)
    REFERENCES context_conversations(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE coordination_claims (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  coordination_session_id TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  incarnation INTEGER NOT NULL CHECK(incarnation >= 1),
  fence INTEGER NOT NULL CHECK(fence >= 1),
  kind TEXT NOT NULL,
  value TEXT NOT NULL CHECK(length(value) BETWEEN 1 AND 1024),
  baseline_sha256 TEXT CHECK(
    baseline_sha256 IS NULL OR (
      length(baseline_sha256) = 64
      AND baseline_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  state TEXT NOT NULL CHECK(state IN ('active', 'released', 'dirty', 'quarantined', 'collision')),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  released_at TEXT,
  UNIQUE(project_id, id),
  CHECK(
    (kind IN ('path', 'tree') AND value NOT GLOB '*[^A-Za-z0-9._:/@-]*')
    OR (kind = 'reserved' AND value IN ('@build', '@repository'))
  ),
  CHECK(
    (state = 'released' AND released_at IS NOT NULL)
    OR (state <> 'released' AND released_at IS NULL)
  ),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, coordination_session_id)
    REFERENCES coordination_sessions(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY(project_id, worktree_id)
    REFERENCES coordination_worktrees(project_id, worktree_id) ON DELETE CASCADE
);

CREATE TABLE coordination_mutation_receipts (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(length(operation) BETWEEN 1 AND 64),
  idempotency_key TEXT NOT NULL CHECK(
    length(idempotency_key) BETWEEN 1 AND 128
    AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  request_hash TEXT NOT NULL CHECK(
    length(request_hash) = 64
    AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  result_json TEXT NOT NULL CHECK(
    json_valid(result_json)
    AND length(CAST(result_json AS BLOB)) <= 16384
  ),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, idempotency_key),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_coordination_sessions_identity
  ON coordination_sessions(project_id, worktree_id, session_id, incarnation);
CREATE INDEX idx_coordination_sessions_active_expiry
  ON coordination_sessions(project_id, worktree_id, state, expires_at, id);
CREATE INDEX idx_coordination_claims_active_worktree
  ON coordination_claims(project_id, worktree_id, state, kind, value, id);
CREATE INDEX idx_coordination_claims_session
  ON coordination_claims(project_id, coordination_session_id, state, created_at, id);
CREATE INDEX idx_coordination_mutation_receipts_project_created
  ON coordination_mutation_receipts(project_id, created_at, id);

CREATE TRIGGER coordination_mutation_receipts_immutable_update
BEFORE UPDATE ON coordination_mutation_receipts
BEGIN
  SELECT RAISE(ABORT, 'coordination mutation receipts are immutable — UPDATE rejected');
END;

COMMIT;
