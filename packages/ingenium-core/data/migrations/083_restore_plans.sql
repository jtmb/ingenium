-- RESTORE-100: signed bundles and a durable, non-executing restore approval
-- workflow. Migration 083 is unreleased: its identity, revision, stage, and
-- audit records are designed together and are append-only from the outset.
BEGIN IMMEDIATE;

CREATE UNIQUE INDEX idx_backup_records_project_id_id
  ON backup_records(project_id, id);

CREATE TABLE backup_restore_plans (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  dry_run INTEGER NOT NULL CHECK(dry_run = 1),
  manifest_hash TEXT NOT NULL CHECK(length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'),
  plan_hash TEXT NOT NULL CHECK(length(plan_hash) = 64 AND plan_hash NOT GLOB '*[^0-9a-f]*'),
  components_json TEXT NOT NULL CHECK(json_valid(components_json) AND length(CAST(components_json AS BLOB)) <= 2048),
  blockers_json TEXT NOT NULL CHECK(json_valid(blockers_json) AND json_type(blockers_json) = 'array' AND length(CAST(blockers_json AS BLOB)) <= 2048),
  warnings_json TEXT NOT NULL CHECK(json_valid(warnings_json) AND json_type(warnings_json) = 'array' AND length(CAST(warnings_json AS BLOB)) <= 2048),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, backup_id) REFERENCES backup_records(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE backup_restore_plan_revisions (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  from_state TEXT,
  to_state TEXT NOT NULL CHECK(to_state IN ('previewed', 'authorized', 'confirmed', 'ready_for_executor', 'failed')),
  stage_hash TEXT CHECK(stage_hash IS NULL OR (length(stage_hash) = 64 AND stage_hash NOT GLOB '*[^0-9a-f]*')),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, plan_id, revision),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, plan_id) REFERENCES backup_restore_plans(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, backup_id) REFERENCES backup_records(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE backup_restore_authorizations (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation = 'confirm_restore'),
  plan_revision INTEGER NOT NULL CHECK(plan_revision = 1),
  manifest_hash TEXT NOT NULL CHECK(length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'),
  token_hash TEXT NOT NULL CHECK(length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  expires_at TEXT NOT NULL CHECK(length(expires_at) BETWEEN 1 AND 64),
  consumed_at TEXT,
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, id),
  UNIQUE(project_id, plan_id, operation, plan_revision),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, plan_id) REFERENCES backup_restore_plans(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, backup_id) REFERENCES backup_records(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE backup_restore_stages (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  manifest_hash TEXT NOT NULL CHECK(length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'),
  plan_hash TEXT NOT NULL CHECK(length(plan_hash) = 64 AND plan_hash NOT GLOB '*[^0-9a-f]*'),
  ingenium_sha256 TEXT NOT NULL CHECK(length(ingenium_sha256) = 64 AND ingenium_sha256 NOT GLOB '*[^0-9a-f]*'),
  ingenium_size_bytes INTEGER NOT NULL CHECK(ingenium_size_bytes > 0),
  opencode_sha256 TEXT NOT NULL CHECK(length(opencode_sha256) = 64 AND opencode_sha256 NOT GLOB '*[^0-9a-f]*'),
  opencode_size_bytes INTEGER NOT NULL CHECK(opencode_size_bytes > 0),
  stage_hash TEXT NOT NULL CHECK(length(stage_hash) = 64 AND stage_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, plan_id),
  UNIQUE(project_id, stage_hash),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, plan_id) REFERENCES backup_restore_plans(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, backup_id) REFERENCES backup_records(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE backup_restore_events (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('previewed', 'authorized', 'confirmed', 'ready_for_executor', 'stage_integrity_failed')),
  from_state TEXT,
  to_state TEXT NOT NULL CHECK(to_state IN ('previewed', 'authorized', 'confirmed', 'ready_for_executor', 'failed')),
  revision INTEGER NOT NULL CHECK(revision >= 0),
  manifest_hash TEXT NOT NULL CHECK(length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'),
  plan_hash TEXT NOT NULL CHECK(length(plan_hash) = 64 AND plan_hash NOT GLOB '*[^0-9a-f]*'),
  metadata TEXT NOT NULL DEFAULT '{"schema":1}' CHECK(metadata = '{"schema":1}'),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, id),
  UNIQUE(project_id, plan_id, revision),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, plan_id, revision) REFERENCES backup_restore_plan_revisions(project_id, plan_id, revision) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, plan_id) REFERENCES backup_restore_plans(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, backup_id) REFERENCES backup_records(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE backup_restore_receipts (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  plan_id TEXT,
  operation TEXT NOT NULL CHECK(operation IN ('preview_restore', 'confirm_restore')),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128 AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'),
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  result_json TEXT NOT NULL CHECK(json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 2048),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, id),
  UNIQUE(project_id, idempotency_key),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, plan_id) REFERENCES backup_restore_plans(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_backup_restore_plans_project_created
  ON backup_restore_plans(project_id, created_at DESC, id DESC);
CREATE INDEX idx_backup_restore_revisions_project_plan
  ON backup_restore_plan_revisions(project_id, plan_id, revision DESC);
CREATE INDEX idx_backup_restore_events_project_plan
  ON backup_restore_events(project_id, plan_id, revision DESC);
CREATE INDEX idx_backup_restore_authorizations_plan_expiry
  ON backup_restore_authorizations(project_id, plan_id, expires_at, consumed_at);
CREATE INDEX idx_backup_restore_receipts_project_created
  ON backup_restore_receipts(project_id, created_at DESC, id DESC);

CREATE TRIGGER backup_restore_plans_global_project_insert
BEFORE INSERT ON backup_restore_plans
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND is_global = 1 AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore plans require the active global project'); END;
CREATE TRIGGER backup_restore_plan_revisions_global_project_insert
BEFORE INSERT ON backup_restore_plan_revisions
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND is_global = 1 AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore plan revisions require the active global project'); END;
CREATE TRIGGER backup_restore_authorizations_global_project_insert
BEFORE INSERT ON backup_restore_authorizations
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND is_global = 1 AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore authorizations require the active global project'); END;
CREATE TRIGGER backup_restore_stages_global_project_insert
BEFORE INSERT ON backup_restore_stages
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND is_global = 1 AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore stages require the active global project'); END;
CREATE TRIGGER backup_restore_events_global_project_insert
BEFORE INSERT ON backup_restore_events
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND is_global = 1 AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore events require the active global project'); END;
CREATE TRIGGER backup_restore_receipts_global_project_insert
BEFORE INSERT ON backup_restore_receipts
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND is_global = 1 AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore receipts require the active global project'); END;

CREATE TRIGGER backup_restore_plans_immutable_update
BEFORE UPDATE ON backup_restore_plans
BEGIN SELECT RAISE(ABORT, 'restore plans are immutable'); END;
CREATE TRIGGER backup_restore_plans_immutable_delete
BEFORE DELETE ON backup_restore_plans
BEGIN SELECT RAISE(ABORT, 'restore plans are immutable'); END;
CREATE TRIGGER backup_restore_plan_revisions_immutable_update
BEFORE UPDATE ON backup_restore_plan_revisions
BEGIN SELECT RAISE(ABORT, 'restore plan revisions are immutable'); END;
CREATE TRIGGER backup_restore_plan_revisions_immutable_delete
BEFORE DELETE ON backup_restore_plan_revisions
BEGIN SELECT RAISE(ABORT, 'restore plan revisions are immutable'); END;
CREATE TRIGGER backup_restore_stages_immutable_update
BEFORE UPDATE ON backup_restore_stages
BEGIN SELECT RAISE(ABORT, 'restore stages are immutable'); END;
CREATE TRIGGER backup_restore_stages_immutable_delete
BEFORE DELETE ON backup_restore_stages
BEGIN SELECT RAISE(ABORT, 'restore stages are immutable'); END;
CREATE TRIGGER backup_restore_events_immutable_update
BEFORE UPDATE ON backup_restore_events
BEGIN SELECT RAISE(ABORT, 'restore events are immutable'); END;
CREATE TRIGGER backup_restore_events_immutable_delete
BEFORE DELETE ON backup_restore_events
BEGIN SELECT RAISE(ABORT, 'restore events are immutable'); END;
CREATE TRIGGER backup_restore_receipts_immutable_update
BEFORE UPDATE ON backup_restore_receipts
BEGIN SELECT RAISE(ABORT, 'restore receipts are immutable'); END;
CREATE TRIGGER backup_restore_receipts_immutable_delete
BEFORE DELETE ON backup_restore_receipts
BEGIN SELECT RAISE(ABORT, 'restore receipts are immutable'); END;
CREATE TRIGGER backup_restore_authorizations_immutable_delete
BEFORE DELETE ON backup_restore_authorizations
BEGIN SELECT RAISE(ABORT, 'restore authorizations are immutable'); END;
CREATE TRIGGER backup_restore_authorizations_consume_once
BEFORE UPDATE ON backup_restore_authorizations
WHEN NEW.project_id IS NOT OLD.project_id OR NEW.plan_id IS NOT OLD.plan_id OR NEW.backup_id IS NOT OLD.backup_id
  OR NEW.operation IS NOT OLD.operation OR NEW.plan_revision IS NOT OLD.plan_revision
  OR NEW.manifest_hash IS NOT OLD.manifest_hash OR NEW.token_hash IS NOT OLD.token_hash
  OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_at IS NOT OLD.created_at
  OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT, 'restore authorization may only be consumed once'); END;

CREATE TRIGGER backup_restore_authorizations_validate_insert
BEFORE INSERT ON backup_restore_authorizations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM backup_restore_plans p
    JOIN backup_restore_plan_revisions r ON r.project_id = p.project_id AND r.plan_id = p.id
    WHERE p.project_id = NEW.project_id AND p.id = NEW.plan_id AND p.backup_id = NEW.backup_id
      AND p.manifest_hash = NEW.manifest_hash AND r.revision = 0 AND r.to_state = 'previewed'
  ) THEN RAISE(ABORT, 'restore authorization requires previewed plan') END;
END;

CREATE TRIGGER backup_restore_stages_validate_insert
BEFORE INSERT ON backup_restore_stages
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM backup_restore_plans p
    WHERE p.project_id = NEW.project_id AND p.id = NEW.plan_id AND p.backup_id = NEW.backup_id
      AND p.manifest_hash = NEW.manifest_hash AND p.plan_hash = NEW.plan_hash
      AND json_extract(p.components_json, '$.ingenium.sha256') = NEW.ingenium_sha256
      AND json_extract(p.components_json, '$.ingenium.sizeBytes') = NEW.ingenium_size_bytes
      AND json_extract(p.components_json, '$.opencode.sha256') = NEW.opencode_sha256
      AND json_extract(p.components_json, '$.opencode.sizeBytes') = NEW.opencode_size_bytes
  ) THEN RAISE(ABORT, 'restore stage does not match plan components') END;
END;

CREATE TRIGGER backup_restore_plan_revisions_validate_insert
BEFORE INSERT ON backup_restore_plan_revisions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM backup_restore_plans
    WHERE project_id = NEW.project_id AND id = NEW.plan_id AND backup_id = NEW.backup_id
  ) THEN RAISE(ABORT, 'restore revision does not match plan identity') END;
  SELECT CASE WHEN NEW.revision != COALESCE((
    SELECT MAX(revision) + 1 FROM backup_restore_plan_revisions
    WHERE project_id = NEW.project_id AND plan_id = NEW.plan_id
  ), 0) THEN RAISE(ABORT, 'restore revision must be next append-only revision') END;
  SELECT CASE WHEN NEW.revision = 0 AND (
    NEW.from_state IS NOT NULL OR NEW.to_state != 'previewed' OR NEW.stage_hash IS NOT NULL
  ) THEN RAISE(ABORT, 'restore plan must begin previewed') END;
  SELECT CASE WHEN NEW.revision > 0 AND NEW.from_state IS NOT (
    SELECT to_state FROM backup_restore_plan_revisions
    WHERE project_id = NEW.project_id AND plan_id = NEW.plan_id AND revision = NEW.revision - 1
  ) THEN RAISE(ABORT, 'restore revision prior state mismatch') END;
  SELECT CASE WHEN NEW.revision > 0 AND NOT (
    (NEW.from_state = 'previewed' AND NEW.to_state = 'authorized') OR
    (NEW.from_state = 'authorized' AND NEW.to_state = 'confirmed') OR
    (NEW.from_state = 'confirmed' AND NEW.to_state = 'ready_for_executor') OR
    (NEW.from_state IN ('confirmed', 'ready_for_executor') AND NEW.to_state = 'failed')
  ) THEN RAISE(ABORT, 'restore revision transition is invalid') END;
  SELECT CASE WHEN NEW.revision > 0 AND NEW.created_at < (
    SELECT created_at FROM backup_restore_plan_revisions
    WHERE project_id = NEW.project_id AND plan_id = NEW.plan_id AND revision = NEW.revision - 1
  ) THEN RAISE(ABORT, 'restore revision timestamp is not monotonic') END;
  SELECT CASE WHEN NEW.to_state = 'authorized' AND (
    NEW.stage_hash IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM backup_restore_authorizations a JOIN backup_restore_plans p
        ON p.project_id = a.project_id AND p.id = a.plan_id
      WHERE a.project_id = NEW.project_id AND a.plan_id = NEW.plan_id AND a.backup_id = NEW.backup_id
        AND a.plan_revision = NEW.revision AND a.manifest_hash = p.manifest_hash AND a.consumed_at IS NULL
    )
  ) THEN RAISE(ABORT, 'restore authorized revision requires unconsumed authorization') END;
  SELECT CASE WHEN NEW.to_state = 'confirmed' AND (
    NEW.stage_hash IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM backup_restore_authorizations a JOIN backup_restore_plans p
        ON p.project_id = a.project_id AND p.id = a.plan_id
      WHERE a.project_id = NEW.project_id AND a.plan_id = NEW.plan_id AND a.backup_id = NEW.backup_id
        AND a.plan_revision = NEW.revision - 1 AND a.manifest_hash = p.manifest_hash AND a.consumed_at IS NOT NULL
    )
  ) THEN RAISE(ABORT, 'restore confirmed revision requires consumed authorization') END;
  SELECT CASE WHEN NEW.to_state = 'ready_for_executor' AND NOT EXISTS (
    SELECT 1 FROM backup_restore_stages s JOIN backup_restore_plans p
      ON p.project_id = s.project_id AND p.id = s.plan_id
    JOIN backup_restore_authorizations a
      ON a.project_id = p.project_id AND a.plan_id = p.id AND a.backup_id = p.backup_id
    WHERE s.project_id = NEW.project_id AND s.plan_id = NEW.plan_id AND s.backup_id = NEW.backup_id
      AND s.stage_hash = NEW.stage_hash AND s.manifest_hash = p.manifest_hash AND s.plan_hash = p.plan_hash
      AND a.plan_revision = NEW.revision - 2 AND a.manifest_hash = p.manifest_hash AND a.consumed_at IS NOT NULL
  ) THEN RAISE(ABORT, 'restore ready revision requires consumed authorization and verified stage') END;
END;

CREATE TRIGGER backup_restore_plan_revisions_create_event
AFTER INSERT ON backup_restore_plan_revisions
BEGIN
  INSERT INTO backup_restore_events
    (id, project_id, plan_id, backup_id, event_type, from_state, to_state, revision, manifest_hash, plan_hash, created_at)
  SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-8' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
         NEW.project_id, NEW.plan_id, NEW.backup_id,
         CASE WHEN NEW.to_state = 'failed' THEN 'stage_integrity_failed' ELSE NEW.to_state END,
         NEW.from_state, NEW.to_state, NEW.revision,
         p.manifest_hash, p.plan_hash, NEW.created_at
  FROM backup_restore_plans p WHERE p.project_id = NEW.project_id AND p.id = NEW.plan_id;
END;

COMMIT;
