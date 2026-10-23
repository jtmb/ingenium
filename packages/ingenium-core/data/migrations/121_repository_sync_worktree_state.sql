-- Move retained repository-sync generation state out of the retired
-- coordination worktree registry without deleting historical coordination data.
CREATE TABLE IF NOT EXISTS repository_sync_worktrees (
  project_id TEXT NOT NULL,
  worktree_id TEXT NOT NULL CHECK(
    length(worktree_id) BETWEEN 1 AND 512
    AND worktree_id NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  PRIMARY KEY(project_id, worktree_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

INSERT INTO repository_sync_worktrees (project_id, worktree_id, created_at, updated_at)
SELECT project_id, worktree_id, created_at, updated_at
FROM coordination_worktrees
WHERE 1 = 1
ON CONFLICT(project_id, worktree_id) DO NOTHING;

CREATE TABLE repository_sync_generations_v121 (
  project_id TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation >= 0),
  manifest_hash TEXT CHECK(manifest_hash IS NULL OR (length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^0-9a-f]*')),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  PRIMARY KEY(project_id, worktree_id),
  FOREIGN KEY(project_id, worktree_id) REFERENCES repository_sync_worktrees(project_id, worktree_id) ON DELETE CASCADE
);

INSERT INTO repository_sync_generations_v121 (project_id, worktree_id, generation, manifest_hash, updated_at)
SELECT project_id, worktree_id, generation, manifest_hash, updated_at
FROM repository_sync_generations
WHERE 1 = 1;

DROP TABLE repository_sync_generations;
ALTER TABLE repository_sync_generations_v121 RENAME TO repository_sync_generations;
