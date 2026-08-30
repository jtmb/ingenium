-- RESTORE-101: execution is a separately authorized, append-only maintenance
-- workflow. 083 remains the immutable preview/stage boundary; this migration
-- adds no path, process, token, or payload storage.
BEGIN IMMEDIATE;

-- 083 accidentally omitted `id` from its consume-only comparison. Keep the
-- original trigger name so pre-084 callers cannot bypass this correction.
DROP TRIGGER backup_restore_authorizations_consume_once;
CREATE TRIGGER backup_restore_authorizations_consume_once
BEFORE UPDATE ON backup_restore_authorizations
WHEN NEW.id IS NOT OLD.id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.plan_id IS NOT OLD.plan_id OR NEW.backup_id IS NOT OLD.backup_id
  OR NEW.operation IS NOT OLD.operation OR NEW.plan_revision IS NOT OLD.plan_revision
  OR NEW.manifest_hash IS NOT OLD.manifest_hash OR NEW.token_hash IS NOT OLD.token_hash
  OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_at IS NOT OLD.created_at
  OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT, 'restore authorization may only be consumed once'); END;

CREATE TABLE backup_restore_execution_authorizations (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation = 'execute_restore'),
  plan_revision INTEGER NOT NULL CHECK(plan_revision >= 0),
  manifest_hash TEXT NOT NULL CHECK(length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'),
  plan_hash TEXT NOT NULL CHECK(length(plan_hash) = 64 AND plan_hash NOT GLOB '*[^0-9a-f]*'),
  stage_hash TEXT NOT NULL CHECK(length(stage_hash) = 64 AND stage_hash NOT GLOB '*[^0-9a-f]*'),
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

CREATE TABLE backup_restore_execution_runs (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  authorization_id TEXT NOT NULL,
  plan_revision INTEGER NOT NULL CHECK(plan_revision >= 0),
  manifest_hash TEXT NOT NULL CHECK(length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'),
  plan_hash TEXT NOT NULL CHECK(length(plan_hash) = 64 AND plan_hash NOT GLOB '*[^0-9a-f]*'),
  stage_hash TEXT NOT NULL CHECK(length(stage_hash) = 64 AND stage_hash NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK(state IN ('queued', 'executor_start_failed', 'executor_claimed', 'executor_setup_failed', 'quiescing', 'snapshotting', 'swapping', 'verifying', 'restarting', 'completed', 'rolling_back', 'rolled_back', 'rollback_failed')),
  phase TEXT NOT NULL CHECK(phase IN ('queued', 'executor_start_failed', 'executor_claimed', 'executor_setup_failed', 'quiescing', 'snapshotting', 'swapping', 'verifying', 'restarting', 'completed', 'rolling_back', 'rolled_back', 'rollback_failed')),
  revision INTEGER NOT NULL CHECK(revision >= 0),
  owner_hash TEXT CHECK(owner_hash IS NULL OR (length(owner_hash) = 64 AND owner_hash NOT GLOB '*[^0-9a-f]*')),
  fence_hash TEXT CHECK(fence_hash IS NULL OR (length(fence_hash) = 64 AND fence_hash NOT GLOB '*[^0-9a-f]*')),
  deadline_at TEXT NOT NULL CHECK(length(deadline_at) BETWEEN 1 AND 64),
  safety_backup_id TEXT,
  error_code TEXT CHECK(error_code IS NULL OR error_code IN ('DEADLINE_EXCEEDED', 'HOLDER_REFUSED', 'SAFETY_SNAPSHOT_FAILED', 'BUFFER_WRITE_FAILED', 'SWAP_FAILED', 'VERIFY_FAILED', 'HEALTH_FAILED', 'ROLLBACK_FAILED', 'JOURNAL_INVALID', 'SUPERVISOR_FAILED', 'EXECUTOR_SETUP_FAILED')),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  completed_at TEXT,
  UNIQUE(project_id, id),
  UNIQUE(project_id, plan_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, plan_id) REFERENCES backup_restore_plans(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, backup_id) REFERENCES backup_records(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, authorization_id) REFERENCES backup_restore_execution_authorizations(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, safety_backup_id) REFERENCES backup_records(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE backup_restore_execution_items (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  component TEXT NOT NULL CHECK(component IN ('ingenium', 'opencode')),
  expected_sha256 TEXT NOT NULL CHECK(length(expected_sha256) = 64 AND expected_sha256 NOT GLOB '*[^0-9a-f]*'),
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
  pre_hash TEXT CHECK(pre_hash IS NULL OR (length(pre_hash) = 64 AND pre_hash NOT GLOB '*[^0-9a-f]*')),
  post_hash TEXT CHECK(post_hash IS NULL OR (length(post_hash) = 64 AND post_hash NOT GLOB '*[^0-9a-f]*')),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, id),
  UNIQUE(project_id, run_id, component),
  FOREIGN KEY(project_id, run_id) REFERENCES backup_restore_execution_runs(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE backup_restore_executor_plan_revisions (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  from_state TEXT NOT NULL CHECK(from_state IN ('ready_for_executor', 'execution_authorized', 'queued', 'executor_claimed', 'executor_setup_failed', 'quiescing', 'snapshotting', 'swapping', 'verifying', 'restarting', 'rolling_back')),
  to_state TEXT NOT NULL CHECK(to_state IN ('execution_authorized', 'queued', 'executor_start_failed', 'executor_claimed', 'executor_setup_failed', 'quiescing', 'snapshotting', 'swapping', 'verifying', 'restarting', 'completed', 'rolling_back', 'rolled_back', 'rollback_failed')),
  execution_run_id TEXT,
  stage_hash TEXT NOT NULL CHECK(length(stage_hash) = 64 AND stage_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, id),
  UNIQUE(project_id, plan_id, revision),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, plan_id) REFERENCES backup_restore_plans(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, backup_id) REFERENCES backup_records(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, execution_run_id) REFERENCES backup_restore_execution_runs(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE backup_restore_execution_events (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  run_id TEXT,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  event_code TEXT NOT NULL CHECK(event_code IN ('EXECUTION_AUTHORIZED', 'EXECUTION_QUEUED', 'EXECUTOR_START_FAILED', 'EXECUTOR_CLAIMED', 'EXECUTOR_SETUP_FAILED', 'QUIESCING', 'SNAPSHOTTING', 'SWAPPING', 'VERIFYING', 'RESTARTING', 'COMPLETED', 'ROLLING_BACK', 'ROLLED_BACK', 'ROLLBACK_FAILED')),
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  manifest_hash TEXT NOT NULL CHECK(length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'),
  plan_hash TEXT NOT NULL CHECK(length(plan_hash) = 64 AND plan_hash NOT GLOB '*[^0-9a-f]*'),
  stage_hash TEXT NOT NULL CHECK(length(stage_hash) = 64 AND stage_hash NOT GLOB '*[^0-9a-f]*'),
  metadata TEXT NOT NULL DEFAULT '{"schema":1}' CHECK(metadata = '{"schema":1}'),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, id),
  UNIQUE(project_id, plan_id, revision),
  FOREIGN KEY(project_id, plan_id, revision) REFERENCES backup_restore_executor_plan_revisions(project_id, plan_id, revision) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, plan_id) REFERENCES backup_restore_plans(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, backup_id) REFERENCES backup_records(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, run_id) REFERENCES backup_restore_execution_runs(project_id, id) ON DELETE RESTRICT
);

CREATE TABLE backup_restore_execution_receipts (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  project_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation = 'execute_restore'),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128 AND idempotency_key NOT GLOB '*[^A-Za-z0-9._:-]*'),
  request_hash TEXT NOT NULL CHECK(length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  result_json TEXT NOT NULL CHECK(json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 512),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  UNIQUE(project_id, id),
  UNIQUE(project_id, idempotency_key),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY(project_id, plan_id) REFERENCES backup_restore_plans(project_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_backup_restore_execution_authorizations_plan_expiry
  ON backup_restore_execution_authorizations(project_id, plan_id, expires_at, consumed_at);
CREATE INDEX idx_backup_restore_execution_runs_claim
  ON backup_restore_execution_runs(state, deadline_at, created_at, id);
CREATE INDEX idx_backup_restore_execution_events_plan
  ON backup_restore_execution_events(project_id, plan_id, revision DESC);
CREATE INDEX idx_backup_restore_execution_receipts_project_created
  ON backup_restore_execution_receipts(project_id, created_at DESC, id DESC);

CREATE TRIGGER backup_restore_execution_authorizations_global_project_insert
BEFORE INSERT ON backup_restore_execution_authorizations
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND is_global = 1 AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore execution authorizations require the active global project'); END;
CREATE TRIGGER backup_restore_execution_runs_global_project_insert
BEFORE INSERT ON backup_restore_execution_runs
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND is_global = 1 AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore execution runs require the active global project'); END;
CREATE TRIGGER backup_restore_execution_items_global_project_insert
BEFORE INSERT ON backup_restore_execution_items
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND is_global = 1 AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore execution items require the active global project'); END;
CREATE TRIGGER backup_restore_executor_plan_revisions_global_project_insert
BEFORE INSERT ON backup_restore_executor_plan_revisions
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND is_global = 1 AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore execution revisions require the active global project'); END;
CREATE TRIGGER backup_restore_execution_events_global_project_insert
BEFORE INSERT ON backup_restore_execution_events
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND is_global = 1 AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore execution events require the active global project'); END;
CREATE TRIGGER backup_restore_execution_receipts_global_project_insert
BEFORE INSERT ON backup_restore_execution_receipts
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND is_global = 1 AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore execution receipts require the active global project'); END;

CREATE TRIGGER backup_restore_execution_authorizations_validate_insert
BEFORE INSERT ON backup_restore_execution_authorizations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM backup_restore_plans p
    JOIN backup_restore_plan_revisions r ON r.project_id = p.project_id AND r.plan_id = p.id
    WHERE p.project_id = NEW.project_id AND p.id = NEW.plan_id AND p.backup_id = NEW.backup_id
      AND p.manifest_hash = NEW.manifest_hash AND p.plan_hash = NEW.plan_hash
      AND r.revision = NEW.plan_revision AND r.to_state = 'ready_for_executor' AND r.stage_hash = NEW.stage_hash
  ) THEN RAISE(ABORT, 'restore execution authorization requires ready plan binding') END;
END;

CREATE TRIGGER backup_restore_execution_authorizations_consume_once
BEFORE UPDATE ON backup_restore_execution_authorizations
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.plan_id IS NOT OLD.plan_id
  OR NEW.backup_id IS NOT OLD.backup_id OR NEW.operation IS NOT OLD.operation
  OR NEW.plan_revision IS NOT OLD.plan_revision OR NEW.manifest_hash IS NOT OLD.manifest_hash
  OR NEW.plan_hash IS NOT OLD.plan_hash OR NEW.stage_hash IS NOT OLD.stage_hash
  OR NEW.token_hash IS NOT OLD.token_hash OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.created_at IS NOT OLD.created_at OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
BEGIN SELECT RAISE(ABORT, 'restore execution authorization may only be consumed once'); END;
CREATE TRIGGER backup_restore_execution_authorizations_immutable_delete
BEFORE DELETE ON backup_restore_execution_authorizations
BEGIN SELECT RAISE(ABORT, 'restore execution authorizations are immutable'); END;

CREATE TRIGGER backup_restore_execution_runs_validate_insert
BEFORE INSERT ON backup_restore_execution_runs
BEGIN
  SELECT CASE WHEN NEW.state != 'queued' OR NEW.phase != 'queued' OR NEW.revision != 0
    OR NEW.owner_hash IS NOT NULL OR NEW.fence_hash IS NOT NULL OR NEW.safety_backup_id IS NOT NULL
    OR NEW.error_code IS NOT NULL OR NEW.completed_at IS NOT NULL
    THEN RAISE(ABORT, 'restore execution run must begin queued') END;
  SELECT CASE WHEN abs(strftime('%s', NEW.deadline_at) - strftime('%s', NEW.created_at)) != 900
    THEN RAISE(ABORT, 'restore execution deadline must be fifteen minutes') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM backup_restore_execution_authorizations a
    WHERE a.project_id = NEW.project_id AND a.id = NEW.authorization_id AND a.plan_id = NEW.plan_id
      AND a.backup_id = NEW.backup_id AND a.plan_revision = NEW.plan_revision
      AND a.manifest_hash = NEW.manifest_hash AND a.plan_hash = NEW.plan_hash AND a.stage_hash = NEW.stage_hash
      AND a.consumed_at IS NOT NULL AND strftime('%s', a.expires_at) > strftime('%s', 'now')
  ) THEN RAISE(ABORT, 'restore execution run requires consumed execution authorization') END;
END;

CREATE TRIGGER backup_restore_execution_runs_update
BEFORE UPDATE ON backup_restore_execution_runs
BEGIN
  SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.plan_id IS NOT OLD.plan_id
    OR NEW.backup_id IS NOT OLD.backup_id OR NEW.authorization_id IS NOT OLD.authorization_id
    OR NEW.plan_revision IS NOT OLD.plan_revision OR NEW.manifest_hash IS NOT OLD.manifest_hash
    OR NEW.plan_hash IS NOT OLD.plan_hash OR NEW.stage_hash IS NOT OLD.stage_hash
    OR NEW.deadline_at IS NOT OLD.deadline_at OR NEW.created_at IS NOT OLD.created_at
    THEN RAISE(ABORT, 'restore execution run identity is immutable') END;
  SELECT CASE WHEN NEW.revision != OLD.revision + 1 OR NEW.phase != NEW.state
    THEN RAISE(ABORT, 'restore execution run requires phase CAS') END;
  SELECT CASE WHEN NOT (
    (OLD.state = 'queued' AND NEW.state IN ('executor_start_failed', 'executor_claimed')) OR
    (OLD.state = 'executor_claimed' AND NEW.state IN ('executor_setup_failed', 'quiescing')) OR
    (OLD.state = 'quiescing' AND NEW.state = 'snapshotting') OR
    (OLD.state = 'snapshotting' AND NEW.state = 'swapping') OR
    (OLD.state = 'swapping' AND NEW.state = 'verifying') OR
    (OLD.state = 'verifying' AND NEW.state = 'restarting') OR
    (OLD.state = 'restarting' AND NEW.state = 'completed') OR
    (OLD.state IN ('executor_claimed', 'quiescing', 'snapshotting', 'swapping', 'verifying', 'restarting') AND NEW.state = 'rolling_back') OR
    (OLD.state = 'rolling_back' AND NEW.state IN ('rolled_back', 'rollback_failed'))
  ) THEN RAISE(ABORT, 'restore execution run transition is invalid') END;
  SELECT CASE WHEN OLD.state = 'queued' AND NEW.state = 'executor_claimed'
    AND NEW.owner_hash IS NOT NULL AND NEW.fence_hash IS NOT NULL
    THEN NULL WHEN NEW.owner_hash IS OLD.owner_hash AND NEW.fence_hash IS OLD.fence_hash
    THEN NULL ELSE RAISE(ABORT, 'restore execution ownership is immutable') END;
  SELECT CASE WHEN OLD.safety_backup_id IS NULL AND NEW.safety_backup_id IS NOT NULL
    AND OLD.state = 'snapshotting' AND NEW.state = 'swapping'
    THEN NULL WHEN NEW.safety_backup_id IS OLD.safety_backup_id
    THEN NULL ELSE RAISE(ABORT, 'restore execution safety backup is write-once') END;
  SELECT CASE WHEN NEW.completed_at IS NOT NULL AND NEW.state NOT IN ('executor_start_failed', 'executor_setup_failed', 'completed', 'rolled_back', 'rollback_failed')
    THEN RAISE(ABORT, 'restore execution completion timestamp is terminal only') END;
  SELECT CASE WHEN NEW.completed_at IS NULL AND OLD.completed_at IS NOT NULL
    THEN RAISE(ABORT, 'restore execution completion timestamp is immutable') END;
  SELECT CASE WHEN NEW.state = 'executor_start_failed' AND (OLD.state != 'queued' OR NEW.error_code != 'SUPERVISOR_FAILED' OR NEW.completed_at IS NULL)
    THEN RAISE(ABORT, 'restore executor start failure must be a queued terminal supervisor failure') END;
  SELECT CASE WHEN NEW.state = 'executor_setup_failed' AND (OLD.state != 'executor_claimed' OR NEW.error_code != 'EXECUTOR_SETUP_FAILED' OR NEW.completed_at IS NULL
    OR NEW.owner_hash IS NULL OR NEW.fence_hash IS NULL)
    THEN RAISE(ABORT, 'restore executor setup failure must retain claimed ownership') END;
  SELECT CASE WHEN NEW.state = 'rolling_back' AND (NEW.owner_hash IS NULL OR NEW.fence_hash IS NULL)
    THEN RAISE(ABORT, 'restore rollback requires executor ownership') END;
  SELECT CASE WHEN NEW.error_code IS NOT NULL AND NEW.state NOT IN ('executor_start_failed', 'executor_setup_failed', 'rolling_back', 'rolled_back', 'rollback_failed')
    THEN RAISE(ABORT, 'restore execution errors are terminal rollback evidence') END;
  SELECT CASE WHEN NEW.state = 'swapping' AND EXISTS (
    SELECT 1 FROM backup_restore_execution_items
    WHERE project_id = NEW.project_id AND run_id = NEW.id AND pre_hash IS NULL
  ) THEN RAISE(ABORT, 'restore execution swap requires pre hashes') END;
  SELECT CASE WHEN NEW.state = 'completed' AND EXISTS (
    SELECT 1 FROM backup_restore_execution_items
    WHERE project_id = NEW.project_id AND run_id = NEW.id AND post_hash IS NULL
  ) THEN RAISE(ABORT, 'restore execution completion requires post hashes') END;
END;
CREATE TRIGGER backup_restore_execution_runs_immutable_delete
BEFORE DELETE ON backup_restore_execution_runs
BEGIN SELECT RAISE(ABORT, 'restore execution runs are immutable'); END;

CREATE TRIGGER backup_restore_execution_items_validate_insert
BEFORE INSERT ON backup_restore_execution_items
WHEN NOT EXISTS (SELECT 1 FROM backup_restore_execution_runs WHERE project_id = NEW.project_id AND id = NEW.run_id AND state = 'queued')
BEGIN SELECT RAISE(ABORT, 'restore execution items require queued run'); END;
CREATE TRIGGER backup_restore_execution_items_hashes_write_once
BEFORE UPDATE ON backup_restore_execution_items
BEGIN
  SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.run_id IS NOT OLD.run_id
    OR NEW.component IS NOT OLD.component OR NEW.expected_sha256 IS NOT OLD.expected_sha256
    OR NEW.size_bytes IS NOT OLD.size_bytes OR NEW.created_at IS NOT OLD.created_at
    THEN RAISE(ABORT, 'restore execution item identity is immutable') END;
  SELECT CASE WHEN OLD.pre_hash IS NOT NULL AND NEW.pre_hash IS NOT OLD.pre_hash
    OR OLD.post_hash IS NOT NULL AND NEW.post_hash IS NOT OLD.post_hash
    OR NEW.post_hash IS NOT NULL AND NEW.pre_hash IS NULL
    THEN RAISE(ABORT, 'restore execution item hashes are write-once') END;
  SELECT CASE WHEN NEW.pre_hash IS NOT NULL AND OLD.pre_hash IS NULL AND NOT EXISTS (
    SELECT 1 FROM backup_restore_execution_runs r WHERE r.project_id = NEW.project_id AND r.id = NEW.run_id AND r.state = 'snapshotting'
  ) THEN RAISE(ABORT, 'restore execution pre hashes require snapshotting') END;
  SELECT CASE WHEN NEW.post_hash IS NOT NULL AND OLD.post_hash IS NULL AND NOT EXISTS (
    SELECT 1 FROM backup_restore_execution_runs r WHERE r.project_id = NEW.project_id AND r.id = NEW.run_id AND r.state = 'verifying'
  ) THEN RAISE(ABORT, 'restore execution post hashes require verifying') END;
END;
CREATE TRIGGER backup_restore_execution_items_immutable_delete
BEFORE DELETE ON backup_restore_execution_items
BEGIN SELECT RAISE(ABORT, 'restore execution items are immutable'); END;

CREATE TRIGGER backup_restore_executor_plan_revisions_validate_insert
BEFORE INSERT ON backup_restore_executor_plan_revisions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM backup_restore_plans WHERE project_id = NEW.project_id AND id = NEW.plan_id AND backup_id = NEW.backup_id
  ) THEN RAISE(ABORT, 'restore execution revision does not match plan identity') END;
  SELECT CASE WHEN NEW.revision != COALESCE((
    SELECT MAX(revision) + 1 FROM backup_restore_executor_plan_revisions WHERE project_id = NEW.project_id AND plan_id = NEW.plan_id
  ), (SELECT MAX(revision) + 1 FROM backup_restore_plan_revisions WHERE project_id = NEW.project_id AND plan_id = NEW.plan_id))
    THEN RAISE(ABORT, 'restore execution revision must be next append-only revision') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM backup_restore_executor_plan_revisions WHERE project_id = NEW.project_id AND plan_id = NEW.plan_id)
    AND NOT EXISTS (
      SELECT 1 FROM backup_restore_plan_revisions WHERE project_id = NEW.project_id AND plan_id = NEW.plan_id
        AND revision = NEW.revision - 1 AND to_state = 'ready_for_executor' AND stage_hash = NEW.stage_hash
    ) THEN RAISE(ABORT, 'restore execution must begin from ready plan') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM backup_restore_executor_plan_revisions WHERE project_id = NEW.project_id AND plan_id = NEW.plan_id)
    AND NEW.from_state IS NOT (
      SELECT to_state FROM backup_restore_executor_plan_revisions
      WHERE project_id = NEW.project_id AND plan_id = NEW.plan_id AND revision = NEW.revision - 1
    ) THEN RAISE(ABORT, 'restore execution revision prior state mismatch') END;
  SELECT CASE WHEN NOT (
    (NEW.from_state = 'ready_for_executor' AND NEW.to_state = 'execution_authorized' AND NEW.execution_run_id IS NULL) OR
    (NEW.from_state = 'execution_authorized' AND NEW.to_state = 'queued' AND NEW.execution_run_id IS NOT NULL) OR
    (NEW.from_state = 'queued' AND NEW.to_state IN ('executor_start_failed', 'executor_claimed') AND NEW.execution_run_id IS NOT NULL) OR
    (NEW.from_state = 'executor_claimed' AND NEW.to_state IN ('executor_setup_failed', 'quiescing') AND NEW.execution_run_id IS NOT NULL) OR
    (NEW.from_state = 'quiescing' AND NEW.to_state = 'snapshotting' AND NEW.execution_run_id IS NOT NULL) OR
    (NEW.from_state = 'snapshotting' AND NEW.to_state = 'swapping' AND NEW.execution_run_id IS NOT NULL) OR
    (NEW.from_state = 'swapping' AND NEW.to_state = 'verifying' AND NEW.execution_run_id IS NOT NULL) OR
    (NEW.from_state = 'verifying' AND NEW.to_state = 'restarting' AND NEW.execution_run_id IS NOT NULL) OR
    (NEW.from_state = 'restarting' AND NEW.to_state = 'completed' AND NEW.execution_run_id IS NOT NULL) OR
    (NEW.from_state IN ('executor_claimed', 'quiescing', 'snapshotting', 'swapping', 'verifying', 'restarting') AND NEW.to_state = 'rolling_back' AND NEW.execution_run_id IS NOT NULL) OR
    (NEW.from_state = 'rolling_back' AND NEW.to_state IN ('rolled_back', 'rollback_failed') AND NEW.execution_run_id IS NOT NULL)
  ) THEN RAISE(ABORT, 'restore execution revision transition is invalid') END;
  SELECT CASE WHEN NEW.to_state = 'execution_authorized' AND NOT EXISTS (
    SELECT 1 FROM backup_restore_execution_authorizations a
    WHERE a.project_id = NEW.project_id AND a.plan_id = NEW.plan_id AND a.backup_id = NEW.backup_id
      AND a.plan_revision = NEW.revision - 1 AND a.consumed_at IS NULL AND a.stage_hash = NEW.stage_hash
  ) THEN RAISE(ABORT, 'restore execution authorization binding missing') END;
  SELECT CASE WHEN NEW.execution_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM backup_restore_execution_runs r WHERE r.project_id = NEW.project_id AND r.id = NEW.execution_run_id
      AND r.plan_id = NEW.plan_id AND r.backup_id = NEW.backup_id AND r.stage_hash = NEW.stage_hash AND r.state = NEW.to_state
  ) THEN RAISE(ABORT, 'restore execution revision does not match run phase') END;
END;
CREATE TRIGGER backup_restore_executor_plan_revisions_immutable_update
BEFORE UPDATE ON backup_restore_executor_plan_revisions
BEGIN SELECT RAISE(ABORT, 'restore execution revisions are immutable'); END;
CREATE TRIGGER backup_restore_executor_plan_revisions_immutable_delete
BEFORE DELETE ON backup_restore_executor_plan_revisions
BEGIN SELECT RAISE(ABORT, 'restore execution revisions are immutable'); END;

CREATE TRIGGER backup_restore_executor_plan_revisions_create_event
AFTER INSERT ON backup_restore_executor_plan_revisions
BEGIN
  INSERT INTO backup_restore_execution_events
    (id, project_id, plan_id, backup_id, run_id, revision, event_code, from_state, to_state, manifest_hash, plan_hash, stage_hash, created_at)
  SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-8' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
         NEW.project_id, NEW.plan_id, NEW.backup_id, NEW.execution_run_id, NEW.revision,
         CASE NEW.to_state
           WHEN 'execution_authorized' THEN 'EXECUTION_AUTHORIZED' WHEN 'queued' THEN 'EXECUTION_QUEUED'
             WHEN 'executor_start_failed' THEN 'EXECUTOR_START_FAILED' WHEN 'executor_claimed' THEN 'EXECUTOR_CLAIMED' WHEN 'executor_setup_failed' THEN 'EXECUTOR_SETUP_FAILED' WHEN 'quiescing' THEN 'QUIESCING'
           WHEN 'snapshotting' THEN 'SNAPSHOTTING' WHEN 'swapping' THEN 'SWAPPING'
           WHEN 'verifying' THEN 'VERIFYING' WHEN 'restarting' THEN 'RESTARTING'
           WHEN 'completed' THEN 'COMPLETED' WHEN 'rolling_back' THEN 'ROLLING_BACK'
           WHEN 'rolled_back' THEN 'ROLLED_BACK' ELSE 'ROLLBACK_FAILED'
         END,
         NEW.from_state, NEW.to_state, p.manifest_hash, p.plan_hash, NEW.stage_hash, NEW.created_at
  FROM backup_restore_plans p WHERE p.project_id = NEW.project_id AND p.id = NEW.plan_id;
END;
CREATE TRIGGER backup_restore_execution_events_immutable_update
BEFORE UPDATE ON backup_restore_execution_events
BEGIN SELECT RAISE(ABORT, 'restore execution events are immutable'); END;
CREATE TRIGGER backup_restore_execution_events_immutable_delete
BEFORE DELETE ON backup_restore_execution_events
BEGIN SELECT RAISE(ABORT, 'restore execution events are immutable'); END;
CREATE TRIGGER backup_restore_execution_receipts_immutable_update
BEFORE UPDATE ON backup_restore_execution_receipts
BEGIN SELECT RAISE(ABORT, 'restore execution receipts are immutable'); END;
CREATE TRIGGER backup_restore_execution_receipts_immutable_delete
BEFORE DELETE ON backup_restore_execution_receipts
BEGIN SELECT RAISE(ABORT, 'restore execution receipts are immutable'); END;

COMMIT;
