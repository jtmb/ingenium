-- MEMORY-100 explicit saved memory. Immutable receipts and tombstones keep
-- explicit user saves separate from transcript Context and inferred learning.
BEGIN IMMEDIATE;

CREATE TABLE explicit_memories (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  workspace_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  visibility TEXT NOT NULL CHECK(visibility IN ('private', 'project')),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  tags TEXT NOT NULL DEFAULT '[]' CHECK(
    json_valid(tags) AND json_type(tags) = 'array' AND length(CAST(tags AS BLOB)) <= 4096
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'forgotten')),
  origin_type TEXT NOT NULL DEFAULT 'explicit' CHECK(origin_type IN ('explicit', 'context_archive', 'source')),
  origin_id TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  forgotten_at TEXT,
  UNIQUE(id, organization_id, project_id, workspace_id, owner_user_id),
  FOREIGN KEY(workspace_id, organization_id, project_id, owner_user_id)
    REFERENCES authorized_workspaces(id, organization_id, project_id, owner_user_id) ON DELETE RESTRICT,
  CHECK(
    (state = 'active' AND length(content) BETWEEN 1 AND 32768 AND forgotten_at IS NULL)
    OR (state = 'forgotten' AND content = '' AND tags = '[]' AND forgotten_at IS NOT NULL)
  ),
  CHECK(
    (origin_type = 'explicit' AND origin_id IS NULL)
    OR (origin_type <> 'explicit' AND origin_id IS NOT NULL AND length(origin_id) BETWEEN 1 AND 256)
  )
);

CREATE TABLE explicit_memory_operation_receipts (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  workspace_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL CHECK(
    length(operation_id) BETWEEN 1 AND 128
    AND operation_id NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  operation TEXT NOT NULL CHECK(operation IN ('save', 'update', 'forget')),
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  result_json TEXT NOT NULL CHECK(
    json_valid(result_json) AND json_type(result_json) = 'object'
    AND length(CAST(result_json AS BLOB)) <= 16384
  ),
  status TEXT NOT NULL CHECK(status = 'committed'),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, workspace_id, owner_user_id, operation_id),
  FOREIGN KEY(workspace_id, organization_id, project_id, owner_user_id)
    REFERENCES authorized_workspaces(id, organization_id, project_id, owner_user_id) ON DELETE RESTRICT
);

CREATE TABLE explicit_memory_versions (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  memory_id TEXT NOT NULL REFERENCES explicit_memories(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version >= 1),
  operation TEXT NOT NULL CHECK(operation IN ('save', 'update', 'forget')),
  content_hash TEXT NOT NULL CHECK(length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  tags_hash TEXT NOT NULL CHECK(length(tags_hash) = 64 AND tags_hash NOT GLOB '*[^0-9a-f]*'),
  receipt_id TEXT NOT NULL REFERENCES explicit_memory_operation_receipts(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(memory_id, version),
  UNIQUE(receipt_id)
);

CREATE TABLE explicit_memory_tombstones (
  memory_id TEXT PRIMARY KEY REFERENCES explicit_memories(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version >= 2),
  prior_content_hash TEXT NOT NULL CHECK(length(prior_content_hash) = 64 AND prior_content_hash NOT GLOB '*[^0-9a-f]*'),
  receipt_id TEXT NOT NULL UNIQUE REFERENCES explicit_memory_operation_receipts(id) ON DELETE RESTRICT,
  forgotten_at TEXT NOT NULL CHECK(length(forgotten_at) BETWEEN 1 AND 64)
);

-- A restore may predate the forgotten memory's user/workspace parents. Keep a
-- content-free suppression in that case without weakening normal memory FKs.
CREATE TABLE explicit_memory_restore_suppressions (
  memory_id TEXT PRIMARY KEY CHECK(length(memory_id) = 36),
  organization_id TEXT NOT NULL CHECK(length(organization_id) = 36),
  project_id TEXT NOT NULL CHECK(length(project_id) = 36),
  workspace_id TEXT NOT NULL CHECK(length(workspace_id) BETWEEN 1 AND 256),
  owner_user_id TEXT NOT NULL CHECK(length(owner_user_id) = 36),
  visibility TEXT NOT NULL CHECK(visibility IN ('private', 'project')),
  version INTEGER NOT NULL CHECK(version >= 2),
  prior_content_hash TEXT NOT NULL CHECK(length(prior_content_hash) = 64 AND prior_content_hash NOT GLOB '*[^0-9a-f]*'),
  receipt_id TEXT NOT NULL UNIQUE CHECK(length(receipt_id) = 36),
  operation_id TEXT NOT NULL CHECK(
    length(operation_id) BETWEEN 1 AND 128
    AND operation_id NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  result_json TEXT NOT NULL CHECK(
    json_valid(result_json) AND json_type(result_json) = 'object'
    AND length(CAST(result_json AS BLOB)) <= 16384
  ),
  entry_json TEXT NOT NULL CHECK(
    json_valid(entry_json) AND json_type(entry_json) = 'object'
    AND length(CAST(entry_json AS BLOB)) <= 131072
  ),
  entry_hash TEXT NOT NULL CHECK(length(entry_hash) = 64 AND entry_hash NOT GLOB '*[^0-9a-f]*'),
  forgotten_at TEXT NOT NULL CHECK(length(forgotten_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, workspace_id, owner_user_id, operation_id)
);

CREATE VIRTUAL TABLE explicit_memories_fts USING fts5(
  content,
  tags,
  content='explicit_memories',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE INDEX idx_explicit_memories_private_active
  ON explicit_memories(project_id, workspace_id, owner_user_id, updated_at DESC, id DESC)
  WHERE state = 'active' AND visibility = 'private';
CREATE INDEX idx_explicit_memories_project_active
  ON explicit_memories(project_id, updated_at DESC, id DESC)
  WHERE state = 'active' AND visibility = 'project';
CREATE INDEX idx_explicit_memory_receipts_scope
  ON explicit_memory_operation_receipts(project_id, workspace_id, owner_user_id, created_at DESC, id DESC);
CREATE INDEX idx_explicit_memory_versions_memory
  ON explicit_memory_versions(memory_id, version DESC);
CREATE INDEX idx_explicit_memory_tombstones_scope
  ON explicit_memory_tombstones(project_id, workspace_id, owner_user_id, forgotten_at DESC);
CREATE INDEX idx_explicit_memory_restore_suppressions_scope
  ON explicit_memory_restore_suppressions(project_id, workspace_id, owner_user_id, forgotten_at DESC);

CREATE TRIGGER explicit_memories_scope_insert
BEFORE INSERT ON explicit_memories
WHEN NOT EXISTS (
  SELECT 1 FROM authorized_workspaces workspace
  JOIN projects project ON project.id = workspace.project_id
  WHERE workspace.id = NEW.workspace_id
    AND workspace.organization_id = NEW.organization_id
    AND workspace.project_id = NEW.project_id
    AND workspace.owner_user_id = NEW.owner_user_id
    AND workspace.status = 'authorized'
    AND project.organization_id = NEW.organization_id
    AND project.archived_at IS NULL
)
BEGIN SELECT RAISE(ABORT, 'explicit memory scope is unavailable'); END;

CREATE TRIGGER explicit_memories_tags_insert
BEFORE INSERT ON explicit_memories
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.tags)
  WHERE type <> 'text' OR length(trim(value)) NOT BETWEEN 1 AND 64 OR value <> trim(value)
)
BEGIN SELECT RAISE(ABORT, 'explicit memory tags are invalid'); END;

CREATE TRIGGER explicit_memories_tags_update
BEFORE UPDATE OF tags ON explicit_memories
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.tags)
  WHERE type <> 'text' OR length(trim(value)) NOT BETWEEN 1 AND 64 OR value <> trim(value)
)
BEGIN SELECT RAISE(ABORT, 'explicit memory tags are invalid'); END;

CREATE TRIGGER explicit_memories_revision_update
BEFORE UPDATE ON explicit_memories
WHEN NEW.id IS NOT OLD.id
  OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.project_id IS NOT OLD.project_id
  OR NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.owner_user_id IS NOT OLD.owner_user_id
  OR NEW.visibility IS NOT OLD.visibility
  OR NEW.origin_type IS NOT OLD.origin_type
  OR NEW.origin_id IS NOT OLD.origin_id
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.version <> OLD.version + 1
  OR OLD.state = 'forgotten'
  OR (OLD.state = 'active' AND NEW.state NOT IN ('active', 'forgotten'))
BEGIN SELECT RAISE(ABORT, 'explicit memory identity or revision is invalid'); END;

CREATE TRIGGER explicit_memories_immutable_delete
BEFORE DELETE ON explicit_memories
BEGIN SELECT RAISE(ABORT, 'explicit memories cannot be deleted'); END;

CREATE TRIGGER explicit_memory_receipts_scope_insert
BEFORE INSERT ON explicit_memory_operation_receipts
WHEN NOT EXISTS (
  SELECT 1 FROM authorized_workspaces
  WHERE id = NEW.workspace_id AND organization_id = NEW.organization_id
    AND project_id = NEW.project_id AND owner_user_id = NEW.owner_user_id
    AND status = 'authorized'
)
BEGIN SELECT RAISE(ABORT, 'explicit memory receipt scope is unavailable'); END;

CREATE TRIGGER explicit_memory_receipts_immutable_update
BEFORE UPDATE ON explicit_memory_operation_receipts
BEGIN SELECT RAISE(ABORT, 'explicit memory receipts are immutable'); END;
CREATE TRIGGER explicit_memory_receipts_immutable_delete
BEFORE DELETE ON explicit_memory_operation_receipts
BEGIN SELECT RAISE(ABORT, 'explicit memory receipts are immutable'); END;

CREATE TRIGGER explicit_memory_versions_scope_insert
BEFORE INSERT ON explicit_memory_versions
WHEN NOT EXISTS (
  SELECT 1 FROM explicit_memories memory
  JOIN explicit_memory_operation_receipts receipt ON receipt.id = NEW.receipt_id
  WHERE memory.id = NEW.memory_id AND memory.organization_id = NEW.organization_id
    AND memory.project_id = NEW.project_id AND memory.workspace_id = NEW.workspace_id
    AND memory.owner_user_id = NEW.owner_user_id AND memory.version = NEW.version
    AND receipt.organization_id = NEW.organization_id AND receipt.project_id = NEW.project_id
    AND receipt.workspace_id = NEW.workspace_id AND receipt.owner_user_id = NEW.owner_user_id
    AND receipt.operation = NEW.operation AND receipt.status = 'committed'
)
BEGIN SELECT RAISE(ABORT, 'explicit memory version scope is unavailable'); END;
CREATE TRIGGER explicit_memory_versions_immutable_update
BEFORE UPDATE ON explicit_memory_versions
BEGIN SELECT RAISE(ABORT, 'explicit memory versions are immutable'); END;
CREATE TRIGGER explicit_memory_versions_immutable_delete
BEFORE DELETE ON explicit_memory_versions
BEGIN SELECT RAISE(ABORT, 'explicit memory versions are immutable'); END;

CREATE TRIGGER explicit_memory_tombstones_scope_insert
BEFORE INSERT ON explicit_memory_tombstones
WHEN NOT EXISTS (
  SELECT 1 FROM explicit_memories memory
  JOIN explicit_memory_operation_receipts receipt ON receipt.id = NEW.receipt_id
  WHERE memory.id = NEW.memory_id AND memory.organization_id = NEW.organization_id
    AND memory.project_id = NEW.project_id AND memory.workspace_id = NEW.workspace_id
    AND memory.owner_user_id = NEW.owner_user_id AND memory.version = NEW.version
    AND memory.state = 'forgotten'
    AND receipt.organization_id = NEW.organization_id AND receipt.project_id = NEW.project_id
    AND receipt.workspace_id = NEW.workspace_id AND receipt.owner_user_id = NEW.owner_user_id
    AND receipt.operation = 'forget' AND receipt.status = 'committed'
)
BEGIN SELECT RAISE(ABORT, 'explicit memory tombstone scope is unavailable'); END;
CREATE TRIGGER explicit_memory_tombstones_immutable_update
BEFORE UPDATE ON explicit_memory_tombstones
BEGIN SELECT RAISE(ABORT, 'explicit memory tombstones are immutable'); END;
CREATE TRIGGER explicit_memory_tombstones_immutable_delete
BEFORE DELETE ON explicit_memory_tombstones
BEGIN SELECT RAISE(ABORT, 'explicit memory tombstones are immutable'); END;

CREATE TRIGGER explicit_memory_restore_suppressions_immutable_update
BEFORE UPDATE ON explicit_memory_restore_suppressions
BEGIN SELECT RAISE(ABORT, 'explicit memory restore suppressions are immutable'); END;
CREATE TRIGGER explicit_memory_restore_suppressions_immutable_delete
BEFORE DELETE ON explicit_memory_restore_suppressions
BEGIN SELECT RAISE(ABORT, 'explicit memory restore suppressions are immutable'); END;

CREATE TRIGGER explicit_memories_fts_insert
AFTER INSERT ON explicit_memories WHEN NEW.state = 'active'
BEGIN
  INSERT INTO explicit_memories_fts(rowid, content, tags) VALUES (NEW.rowid, NEW.content, NEW.tags);
END;
CREATE TRIGGER explicit_memories_fts_update_delete
BEFORE UPDATE ON explicit_memories
BEGIN
  INSERT INTO explicit_memories_fts(explicit_memories_fts, rowid, content, tags)
    VALUES ('delete', OLD.rowid, OLD.content, OLD.tags);
END;
CREATE TRIGGER explicit_memories_fts_update_insert
AFTER UPDATE ON explicit_memories WHEN NEW.state = 'active'
BEGIN
  INSERT INTO explicit_memories_fts(rowid, content, tags) VALUES (NEW.rowid, NEW.content, NEW.tags);
END;

COMMIT;
