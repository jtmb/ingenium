-- VAULT-100: metadata-only job authorization references for vault items.
-- Vault items are soft-deleted; references and their authorization audit trail
-- are retained so historical jobs never lose provenance.

BEGIN IMMEDIATE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_items_project_id_id
  ON vault_items(project_id, id);

CREATE TABLE job_vault_references (
  project_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  authorized_at TEXT NOT NULL CHECK(length(authorized_at) BETWEEN 1 AND 64),
  authorized_item_version INTEGER NOT NULL CHECK(authorized_item_version >= 1),
  status TEXT NOT NULL CHECK(status IN ('authorized', 'revoked')),
  PRIMARY KEY(project_id, job_id, item_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, job_id) REFERENCES jobs(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, item_id) REFERENCES vault_items(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE job_vault_reference_audit (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  authorized_item_version INTEGER NOT NULL CHECK(authorized_item_version >= 1),
  action TEXT NOT NULL CHECK(action IN ('authorized', 'revoked')),
  actor TEXT NOT NULL CHECK(actor = 'authenticated_api'),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, job_id) REFERENCES jobs(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, item_id) REFERENCES vault_items(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_job_vault_references_project_job_status
  ON job_vault_references(project_id, job_id, status, item_id);
CREATE INDEX idx_job_vault_references_project_item
  ON job_vault_references(project_id, item_id, job_id);
CREATE INDEX idx_job_vault_reference_audit_project_job_created
  ON job_vault_reference_audit(project_id, job_id, created_at, id);

-- An authorized reference may only target a same-project, active vault item.
-- A later soft delete leaves the authorization evidence intact and makes the
-- DTO report the reference as unavailable.
CREATE TRIGGER job_vault_references_active_item_insert
BEFORE INSERT ON job_vault_references
WHEN NEW.status = 'authorized' AND NOT EXISTS (
  SELECT 1 FROM vault_items
  WHERE project_id = NEW.project_id
    AND id = NEW.item_id
    AND access_policy <> '{"mode":"deleted"}'
)
BEGIN
  SELECT RAISE(ABORT, 'job vault reference item must be active in the same project');
END;

CREATE TRIGGER job_vault_references_active_item_update
BEFORE UPDATE OF project_id, item_id, status ON job_vault_references
WHEN NEW.status = 'authorized' AND NOT EXISTS (
  SELECT 1 FROM vault_items
  WHERE project_id = NEW.project_id
    AND id = NEW.item_id
    AND access_policy <> '{"mode":"deleted"}'
)
BEGIN
  SELECT RAISE(ABORT, 'job vault reference item must be active in the same project');
END;

-- A job may hold at most sixteen currently authorized references. The runtime
-- checks this first; these guards keep direct SQL writes within the same bound.
CREATE TRIGGER job_vault_references_max_authorized_insert
BEFORE INSERT ON job_vault_references
WHEN NEW.status = 'authorized' AND (
  SELECT count(*) FROM job_vault_references
  WHERE project_id = NEW.project_id AND job_id = NEW.job_id AND status = 'authorized'
) >= 16
BEGIN
  SELECT RAISE(ABORT, 'job vault reference limit exceeded');
END;

CREATE TRIGGER job_vault_references_max_authorized_update
BEFORE UPDATE OF status ON job_vault_references
WHEN OLD.status = 'revoked' AND NEW.status = 'authorized' AND (
  SELECT count(*) FROM job_vault_references
  WHERE project_id = NEW.project_id AND job_id = NEW.job_id AND status = 'authorized'
) >= 16
BEGIN
  SELECT RAISE(ABORT, 'job vault reference limit exceeded');
END;

CREATE TRIGGER job_vault_references_identity_immutable_update
BEFORE UPDATE OF project_id, job_id, item_id ON job_vault_references
BEGIN
  SELECT RAISE(ABORT, 'job vault reference identity is immutable');
END;

CREATE TRIGGER job_vault_reference_audit_immutable_update
BEFORE UPDATE ON job_vault_reference_audit
BEGIN
  SELECT RAISE(ABORT, 'job vault reference audit is immutable');
END;

CREATE TRIGGER job_vault_reference_audit_immutable_delete
BEFORE DELETE ON job_vault_reference_audit
BEGIN
  SELECT RAISE(ABORT, 'job vault reference audit is immutable');
END;

COMMIT;
