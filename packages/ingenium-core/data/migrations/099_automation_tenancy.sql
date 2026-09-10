-- AUTH-106: organization-scoped automation principals, ownership, and execution provenance.
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

INSERT INTO service_principals (id, organization_id, name, status, created_at, updated_at)
SELECT lower(hex(randomblob(4))) || '-' || substr(lower(hex(randomblob(2))), 1, 4) || '-' ||
       substr(lower(hex(randomblob(2))), 1, 4) || '-' || substr(lower(hex(randomblob(2))), 1, 4) || '-' ||
       lower(hex(randomblob(6))), organization.id, 'Automation Dispatcher', 'active', datetime('now'), datetime('now')
FROM organizations organization
WHERE NOT EXISTS (
  SELECT 1 FROM service_principals principal
  WHERE principal.organization_id = organization.id AND principal.name = 'Automation Dispatcher'
);

CREATE TABLE automation_principal_grants (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  service_principal_id TEXT NOT NULL REFERENCES service_principals(id) ON DELETE RESTRICT,
  permission TEXT NOT NULL CHECK(permission IN ('execute')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  granted_by_actor_type TEXT NOT NULL CHECK(granted_by_actor_type IN ('compatibility', 'user', 'service', 'system')),
  granted_by_actor_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, service_principal_id, permission)
);

CREATE TABLE automation_dispatch_cursors (
  dispatch_kind TEXT PRIMARY KEY CHECK(dispatch_kind IN ('cron', 'event')),
  last_organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  last_claimed_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)
);

ALTER TABLE context_checkpoint_maintenance_authorizations ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE context_checkpoint_maintenance_authorizations ADD COLUMN actor_type TEXT NOT NULL DEFAULT 'compatibility' CHECK(actor_type IN ('compatibility', 'user', 'service', 'system'));
ALTER TABLE context_checkpoint_maintenance_authorizations ADD COLUMN actor_id TEXT;
ALTER TABLE context_checkpoint_maintenance_authorizations ADD COLUMN delegator_actor_type TEXT CHECK(delegator_actor_type IN ('compatibility', 'user', 'service', 'system'));
ALTER TABLE context_checkpoint_maintenance_authorizations ADD COLUMN delegator_actor_id TEXT;
ALTER TABLE context_checkpoint_maintenance_authorizations ADD COLUMN request_id TEXT;
ALTER TABLE context_checkpoint_maintenance_authorizations ADD COLUMN correlation_id TEXT;
UPDATE context_checkpoint_maintenance_authorizations
SET organization_id = (SELECT organization_id FROM projects WHERE id = context_checkpoint_maintenance_authorizations.project_id);

DROP TRIGGER context_checkpoint_audit_events_immutable_update;
ALTER TABLE context_checkpoint_audit_events ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE context_checkpoint_audit_events ADD COLUMN source_actor_type TEXT NOT NULL DEFAULT 'compatibility' CHECK(source_actor_type IN ('compatibility', 'user', 'service', 'system'));
ALTER TABLE context_checkpoint_audit_events ADD COLUMN source_actor_id TEXT;
ALTER TABLE context_checkpoint_audit_events ADD COLUMN delegator_actor_type TEXT CHECK(delegator_actor_type IN ('compatibility', 'user', 'service', 'system'));
ALTER TABLE context_checkpoint_audit_events ADD COLUMN delegator_actor_id TEXT;
ALTER TABLE context_checkpoint_audit_events ADD COLUMN request_id TEXT;
ALTER TABLE context_checkpoint_audit_events ADD COLUMN correlation_id TEXT;
UPDATE context_checkpoint_audit_events
SET organization_id = (SELECT organization_id FROM projects WHERE id = context_checkpoint_audit_events.project_id);
CREATE TRIGGER context_checkpoint_audit_events_immutable_update BEFORE UPDATE ON context_checkpoint_audit_events
BEGIN SELECT RAISE(ABORT, 'context_checkpoint_audit_events rows are immutable — UPDATE rejected'); END;

INSERT INTO automation_principal_grants
  (id, organization_id, project_id, service_principal_id, permission, granted_by_actor_type, created_at, updated_at)
SELECT lower(hex(randomblob(4))) || '-' || substr(lower(hex(randomblob(2))), 1, 4) || '-' ||
       substr(lower(hex(randomblob(2))), 1, 4) || '-' || substr(lower(hex(randomblob(2))), 1, 4) || '-' ||
       lower(hex(randomblob(6))), project.organization_id, project.id, principal.id, 'execute', 'compatibility', datetime('now'), datetime('now')
FROM projects project
JOIN service_principals principal
  ON principal.organization_id = project.organization_id AND principal.name = 'Automation Dispatcher';

DROP TRIGGER jobs_revision_monotonic_update;
ALTER TABLE jobs ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE jobs ADD COLUMN owner_kind TEXT NOT NULL DEFAULT 'organization' CHECK(owner_kind IN ('user', 'organization'));
ALTER TABLE jobs ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE jobs ADD COLUMN visibility TEXT NOT NULL DEFAULT 'organization' CHECK(visibility IN ('private', 'organization'));
ALTER TABLE jobs ADD COLUMN service_principal_id TEXT REFERENCES service_principals(id) ON DELETE RESTRICT;
ALTER TABLE jobs ADD COLUMN schedule_revision INTEGER NOT NULL DEFAULT 0 CHECK(schedule_revision >= 0);
ALTER TABLE jobs ADD COLUMN created_by_actor_type TEXT NOT NULL DEFAULT 'compatibility' CHECK(created_by_actor_type IN ('compatibility', 'user', 'service', 'system'));
ALTER TABLE jobs ADD COLUMN created_by_actor_id TEXT;
UPDATE jobs
SET organization_id = (SELECT organization_id FROM projects WHERE id = jobs.project_id),
    service_principal_id = (
      SELECT principal.id FROM service_principals principal
      JOIN projects project ON project.organization_id = principal.organization_id
      WHERE project.id = jobs.project_id AND principal.name = 'Automation Dispatcher'
    );
CREATE TRIGGER jobs_revision_monotonic_update BEFORE UPDATE ON jobs
WHEN NEW.revision <> OLD.revision + 1
BEGIN SELECT RAISE(ABORT, 'job revision must advance by one'); END;

ALTER TABLE job_runs ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE job_runs ADD COLUMN effective_service_principal_id TEXT REFERENCES service_principals(id) ON DELETE RESTRICT;
ALTER TABLE job_runs ADD COLUMN delegator_actor_type TEXT CHECK(delegator_actor_type IN ('compatibility', 'user', 'service', 'system'));
ALTER TABLE job_runs ADD COLUMN delegator_actor_id TEXT;
ALTER TABLE job_runs ADD COLUMN source_actor_type TEXT CHECK(source_actor_type IN ('compatibility', 'user', 'service', 'system'));
ALTER TABLE job_runs ADD COLUMN source_actor_id TEXT;
ALTER TABLE job_runs ADD COLUMN job_revision INTEGER NOT NULL DEFAULT 0 CHECK(job_revision >= 0);
ALTER TABLE job_runs ADD COLUMN schedule_revision INTEGER CHECK(schedule_revision IS NULL OR schedule_revision >= 0);
ALTER TABLE job_runs ADD COLUMN scheduled_for TEXT;
ALTER TABLE job_runs ADD COLUMN authorization_revision INTEGER NOT NULL DEFAULT 0 CHECK(authorization_revision >= 0);
UPDATE job_runs
SET organization_id = (SELECT organization_id FROM jobs WHERE id = job_runs.job_id),
    effective_service_principal_id = (SELECT service_principal_id FROM jobs WHERE id = job_runs.job_id),
    delegator_actor_type = CASE WHEN trigger = 'manual' THEN 'compatibility' ELSE NULL END,
    source_actor_type = CASE WHEN trigger = 'event' THEN 'compatibility' ELSE NULL END,
    job_revision = (SELECT revision FROM jobs WHERE id = job_runs.job_id),
    schedule_revision = CASE WHEN trigger = 'cron' THEN (SELECT schedule_revision FROM jobs WHERE id = job_runs.job_id) ELSE NULL END,
    scheduled_for = CASE WHEN trigger = 'cron' THEN created_at ELSE NULL END,
    authorization_revision = COALESCE((
      SELECT grant_row.revision FROM automation_principal_grants grant_row
      WHERE grant_row.project_id = job_runs.project_id
        AND grant_row.service_principal_id = (SELECT service_principal_id FROM jobs WHERE id = job_runs.job_id)
        AND grant_row.permission = 'execute'
    ), 0);

ALTER TABLE job_run_logs ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
UPDATE job_run_logs SET organization_id = (SELECT organization_id FROM job_runs WHERE id = job_run_logs.run_id);

DROP TRIGGER trusted_job_events_immutable_update;
ALTER TABLE trusted_job_events ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE trusted_job_events ADD COLUMN source_actor_type TEXT NOT NULL DEFAULT 'compatibility' CHECK(source_actor_type IN ('compatibility', 'user', 'service', 'system'));
ALTER TABLE trusted_job_events ADD COLUMN source_actor_id TEXT;
UPDATE trusted_job_events SET organization_id = (SELECT organization_id FROM projects WHERE id = trusted_job_events.project_id);
CREATE TRIGGER trusted_job_events_immutable_update BEFORE UPDATE ON trusted_job_events
BEGIN SELECT RAISE(ABORT, 'trusted_job_events rows are immutable — UPDATE rejected'); END;

DROP TRIGGER job_event_dispatches_immutable_update;
ALTER TABLE job_event_dispatches ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
UPDATE job_event_dispatches SET organization_id = (SELECT organization_id FROM projects WHERE id = job_event_dispatches.project_id);
CREATE TRIGGER job_event_dispatches_immutable_update BEFORE UPDATE ON job_event_dispatches
BEGIN SELECT RAISE(ABORT, 'job event dispatch markers are immutable'); END;

ALTER TABLE job_event_deliveries ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE job_event_deliveries ADD COLUMN effective_service_principal_id TEXT REFERENCES service_principals(id) ON DELETE RESTRICT;
ALTER TABLE job_event_deliveries ADD COLUMN source_actor_type TEXT CHECK(source_actor_type IN ('compatibility', 'user', 'service', 'system'));
ALTER TABLE job_event_deliveries ADD COLUMN source_actor_id TEXT;
ALTER TABLE job_event_deliveries ADD COLUMN job_revision INTEGER NOT NULL DEFAULT 0 CHECK(job_revision >= 0);
ALTER TABLE job_event_deliveries ADD COLUMN authorization_revision INTEGER NOT NULL DEFAULT 0 CHECK(authorization_revision >= 0);
UPDATE job_event_deliveries
SET organization_id = (SELECT organization_id FROM jobs WHERE id = job_event_deliveries.job_id),
    effective_service_principal_id = (SELECT service_principal_id FROM jobs WHERE id = job_event_deliveries.job_id),
    source_actor_type = (SELECT source_actor_type FROM trusted_job_events WHERE id = job_event_deliveries.trusted_event_id),
    source_actor_id = (SELECT source_actor_id FROM trusted_job_events WHERE id = job_event_deliveries.trusted_event_id),
    job_revision = (SELECT revision FROM jobs WHERE id = job_event_deliveries.job_id),
    authorization_revision = COALESCE((
      SELECT grant_row.revision FROM automation_principal_grants grant_row
      WHERE grant_row.project_id = job_event_deliveries.project_id
        AND grant_row.service_principal_id = (SELECT service_principal_id FROM jobs WHERE id = job_event_deliveries.job_id)
        AND grant_row.permission = 'execute'
    ), 0);

ALTER TABLE job_event_attempts ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE job_event_attempts ADD COLUMN effective_service_principal_id TEXT REFERENCES service_principals(id) ON DELETE RESTRICT;
ALTER TABLE job_event_attempts ADD COLUMN source_actor_type TEXT CHECK(source_actor_type IN ('compatibility', 'user', 'service', 'system'));
ALTER TABLE job_event_attempts ADD COLUMN source_actor_id TEXT;
UPDATE job_event_attempts
SET organization_id = (SELECT organization_id FROM job_event_deliveries WHERE id = job_event_attempts.delivery_id),
    effective_service_principal_id = (SELECT effective_service_principal_id FROM job_event_deliveries WHERE id = job_event_attempts.delivery_id),
    source_actor_type = (SELECT source_actor_type FROM job_runs WHERE id = job_event_attempts.run_id),
    source_actor_id = (SELECT source_actor_id FROM job_runs WHERE id = job_event_attempts.run_id);

ALTER TABLE job_vault_references ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE job_vault_references ADD COLUMN grant_revision INTEGER NOT NULL DEFAULT 0 CHECK(grant_revision >= 0);
UPDATE job_vault_references
SET organization_id = (SELECT organization_id FROM jobs WHERE id = job_vault_references.job_id);

INSERT INTO resource_grants
  (id, organization_id, resource_type, resource_id, grantee_kind, grantee_id, permissions_json,
   granted_by_actor_type, created_at, updated_at)
SELECT lower(hex(randomblob(4))) || '-' || substr(lower(hex(randomblob(2))), 1, 4) || '-' ||
       substr(lower(hex(randomblob(2))), 1, 4) || '-' || substr(lower(hex(randomblob(2))), 1, 4) || '-' ||
       lower(hex(randomblob(6))), reference.organization_id, 'vault_item', reference.item_id, 'service',
       job.service_principal_id, '["read"]', 'compatibility', datetime('now'), datetime('now')
FROM job_vault_references reference
JOIN jobs job ON job.project_id = reference.project_id AND job.id = reference.job_id
WHERE reference.status = 'authorized'
ON CONFLICT DO NOTHING;
UPDATE job_vault_references
SET grant_revision = COALESCE((
  SELECT grant_row.revision FROM resource_grants grant_row
  JOIN jobs job ON job.id = job_vault_references.job_id
  WHERE grant_row.organization_id = job_vault_references.organization_id
    AND grant_row.resource_type = 'vault_item' AND grant_row.resource_id = job_vault_references.item_id
    AND grant_row.grantee_kind = 'service' AND grant_row.grantee_id = job.service_principal_id
), 0);

DROP TRIGGER job_vault_reference_audit_immutable_update;
ALTER TABLE job_vault_reference_audit ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE job_vault_reference_audit ADD COLUMN actor_type TEXT NOT NULL DEFAULT 'compatibility' CHECK(actor_type IN ('compatibility', 'user', 'service', 'system'));
ALTER TABLE job_vault_reference_audit ADD COLUMN actor_id TEXT;
UPDATE job_vault_reference_audit SET organization_id = (SELECT organization_id FROM jobs WHERE id = job_vault_reference_audit.job_id);
CREATE TRIGGER job_vault_reference_audit_immutable_update BEFORE UPDATE ON job_vault_reference_audit
BEGIN SELECT RAISE(ABORT, 'job vault reference audit is immutable'); END;

DROP TRIGGER job_vault_runs_revision_cas_update;
ALTER TABLE job_vault_runs ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE job_vault_runs ADD COLUMN effective_service_principal_id TEXT REFERENCES service_principals(id) ON DELETE RESTRICT;
ALTER TABLE job_vault_runs ADD COLUMN job_revision INTEGER NOT NULL DEFAULT 0 CHECK(job_revision >= 0);
ALTER TABLE job_vault_runs ADD COLUMN authorization_revision INTEGER NOT NULL DEFAULT 0 CHECK(authorization_revision >= 0);
UPDATE job_vault_runs
SET organization_id = (SELECT organization_id FROM jobs WHERE id = job_vault_runs.job_id),
    effective_service_principal_id = (SELECT service_principal_id FROM jobs WHERE id = job_vault_runs.job_id),
    job_revision = (SELECT job_revision FROM job_runs WHERE id = job_vault_runs.run_id),
    authorization_revision = (SELECT authorization_revision FROM job_runs WHERE id = job_vault_runs.run_id);
CREATE TRIGGER job_vault_runs_revision_cas_update BEFORE UPDATE ON job_vault_runs
WHEN NEW.revision <> OLD.revision + 1
BEGIN SELECT RAISE(ABORT, 'job vault run revision must advance by one'); END;

DROP TRIGGER job_vault_run_items_immutable_update;
ALTER TABLE job_vault_run_items ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE job_vault_run_items ADD COLUMN grant_revision INTEGER NOT NULL DEFAULT 0 CHECK(grant_revision >= 0);
UPDATE job_vault_run_items
SET organization_id = (SELECT organization_id FROM job_vault_runs WHERE run_id = job_vault_run_items.run_id),
    grant_revision = COALESCE((SELECT grant_revision FROM job_vault_references reference
      WHERE reference.project_id = job_vault_run_items.project_id
        AND reference.job_id = job_vault_run_items.job_id AND reference.item_id = job_vault_run_items.item_id), 0);
CREATE TRIGGER job_vault_run_items_immutable_update BEFORE UPDATE ON job_vault_run_items
BEGIN SELECT RAISE(ABORT, 'job vault run item snapshot is immutable'); END;

DROP TRIGGER job_vault_runtime_audit_immutable_update;
ALTER TABLE job_vault_runtime_audit ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE job_vault_runtime_audit ADD COLUMN effective_service_principal_id TEXT REFERENCES service_principals(id) ON DELETE RESTRICT;
UPDATE job_vault_runtime_audit
SET organization_id = (SELECT organization_id FROM job_runs WHERE id = job_vault_runtime_audit.run_id),
    effective_service_principal_id = (SELECT effective_service_principal_id FROM job_runs WHERE id = job_vault_runtime_audit.run_id);
CREATE TRIGGER job_vault_runtime_audit_immutable_update BEFORE UPDATE ON job_vault_runtime_audit
BEGIN SELECT RAISE(ABORT, 'job vault runtime audit is immutable'); END;

ALTER TABLE tasks ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE tasks ADD COLUMN owner_kind TEXT NOT NULL DEFAULT 'organization' CHECK(owner_kind IN ('user', 'organization'));
ALTER TABLE tasks ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE tasks ADD COLUMN visibility TEXT NOT NULL DEFAULT 'organization' CHECK(visibility IN ('private', 'organization'));
ALTER TABLE tasks ADD COLUMN created_by_actor_type TEXT NOT NULL DEFAULT 'compatibility' CHECK(created_by_actor_type IN ('compatibility', 'user', 'service', 'system'));
ALTER TABLE tasks ADD COLUMN created_by_actor_id TEXT;
UPDATE tasks SET organization_id = (SELECT organization_id FROM projects WHERE id = tasks.project_id);

ALTER TABLE task_comments ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
UPDATE task_comments SET organization_id = (SELECT organization_id FROM tasks WHERE id = task_comments.task_id);
ALTER TABLE task_activity ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
UPDATE task_activity SET organization_id = (SELECT organization_id FROM tasks WHERE id = task_activity.task_id);
ALTER TABLE task_links ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
UPDATE task_links SET organization_id = (SELECT organization_id FROM tasks WHERE id = task_links.task_id);
ALTER TABLE task_notifications ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
UPDATE task_notifications SET organization_id = (SELECT organization_id FROM projects WHERE id = task_notifications.project_id);
ALTER TABLE board_config ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
UPDATE board_config SET organization_id = (SELECT organization_id FROM projects WHERE id = board_config.project_id);

DROP TRIGGER task_source_references_immutable_update;
ALTER TABLE task_source_references ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
UPDATE task_source_references SET organization_id = (SELECT organization_id FROM projects WHERE id = task_source_references.project_id);
CREATE TRIGGER task_source_references_immutable_update BEFORE UPDATE ON task_source_references
BEGIN SELECT RAISE(ABORT, 'task source references are immutable — UPDATE rejected'); END;

DROP TRIGGER task_mutation_receipts_immutable_update;
ALTER TABLE task_mutation_receipts ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
UPDATE task_mutation_receipts SET organization_id = (SELECT organization_id FROM projects WHERE id = task_mutation_receipts.project_id);
CREATE TRIGGER task_mutation_receipts_immutable_update BEFORE UPDATE ON task_mutation_receipts
BEGIN SELECT RAISE(ABORT, 'task mutation receipts are immutable — UPDATE rejected'); END;

ALTER TABLE pipeline_events ADD COLUMN effective_service_principal_id TEXT REFERENCES service_principals(id) ON DELETE RESTRICT;
ALTER TABLE pipeline_events ADD COLUMN source_run_id TEXT REFERENCES job_runs(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX idx_jobs_automation_scope ON jobs(organization_id, project_id, id);
CREATE INDEX idx_jobs_automation_owner ON jobs(organization_id, visibility, owner_user_id, project_id, created_at DESC);
CREATE UNIQUE INDEX idx_job_runs_cron_claim ON job_runs(job_id, schedule_revision, scheduled_for)
  WHERE trigger = 'cron';
CREATE INDEX idx_job_runs_automation_scope ON job_runs(organization_id, effective_service_principal_id, project_id, created_at DESC);
CREATE INDEX idx_automation_principal_grants_scope ON automation_principal_grants(organization_id, project_id, service_principal_id, status);
CREATE INDEX idx_tasks_automation_owner ON tasks(organization_id, visibility, owner_user_id, project_id, created_at DESC);

CREATE TRIGGER context_checkpoint_maintenance_authorizations_automation_scope_insert BEFORE INSERT ON context_checkpoint_maintenance_authorizations
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM projects project WHERE project.id = NEW.project_id AND project.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'context maintenance authorization scope mismatch'); END;
CREATE TRIGGER context_checkpoint_audit_events_automation_scope_insert BEFORE INSERT ON context_checkpoint_audit_events
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM context_checkpoint_maintenance_authorizations authorization
  WHERE authorization.project_id = NEW.project_id AND authorization.id = NEW.authorization_id
    AND authorization.organization_id = NEW.organization_id
    AND authorization.actor_type = NEW.source_actor_type
    AND authorization.actor_id IS NEW.source_actor_id
    AND authorization.delegator_actor_type IS NEW.delegator_actor_type
    AND authorization.delegator_actor_id IS NEW.delegator_actor_id
    AND authorization.request_id IS NEW.request_id
    AND authorization.correlation_id IS NEW.correlation_id
)
BEGIN SELECT RAISE(ABORT, 'context maintenance audit provenance mismatch'); END;

CREATE TRIGGER automation_principal_grants_scope_insert BEFORE INSERT ON automation_principal_grants
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id)
  OR NOT EXISTS (SELECT 1 FROM service_principals WHERE id = NEW.service_principal_id AND organization_id = NEW.organization_id)
BEGIN SELECT RAISE(ABORT, 'automation grant scope mismatch'); END;
CREATE TRIGGER automation_principal_grants_revision_update BEFORE UPDATE ON automation_principal_grants
WHEN NEW.revision <> OLD.revision + 1
BEGIN SELECT RAISE(ABORT, 'automation grant revision must advance by one'); END;
CREATE TRIGGER automation_dispatch_cursors_revision_update BEFORE UPDATE ON automation_dispatch_cursors
WHEN NEW.revision <> OLD.revision + 1
BEGIN SELECT RAISE(ABORT, 'automation dispatch cursor revision must advance by one'); END;
CREATE TRIGGER jobs_automation_scope_insert BEFORE INSERT ON jobs
WHEN NEW.organization_id IS NULL OR NEW.service_principal_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id)
  OR NOT EXISTS (SELECT 1 FROM service_principals WHERE id = NEW.service_principal_id AND organization_id = NEW.organization_id)
  OR (NEW.owner_kind = 'user') <> (NEW.owner_user_id IS NOT NULL)
  OR (NEW.visibility = 'private') <> (NEW.owner_user_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'invalid job automation scope'); END;
CREATE TRIGGER jobs_automation_scope_immutable BEFORE UPDATE OF organization_id, project_id, owner_kind, owner_user_id, visibility, service_principal_id ON jobs
WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.project_id IS NOT OLD.project_id
  OR NEW.owner_kind IS NOT OLD.owner_kind OR NEW.owner_user_id IS NOT OLD.owner_user_id
  OR NEW.visibility IS NOT OLD.visibility OR NEW.service_principal_id IS NOT OLD.service_principal_id
BEGIN SELECT RAISE(ABORT, 'job automation scope is immutable'); END;
CREATE TRIGGER job_runs_automation_scope_insert BEFORE INSERT ON job_runs
WHEN NEW.organization_id IS NULL OR NEW.effective_service_principal_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM jobs job JOIN automation_principal_grants grant_row
      ON grant_row.project_id = job.project_id AND grant_row.service_principal_id = job.service_principal_id
    WHERE job.id = NEW.job_id AND job.project_id = NEW.project_id
      AND job.organization_id = NEW.organization_id AND job.service_principal_id = NEW.effective_service_principal_id
      AND job.revision = NEW.job_revision AND grant_row.permission = 'execute'
      AND grant_row.status = 'active' AND grant_row.revision = NEW.authorization_revision
  )
  OR (NEW.trigger = 'manual') <> (NEW.delegator_actor_type IS NOT NULL)
  OR (NEW.trigger = 'event') <> (NEW.source_actor_type IS NOT NULL)
  OR (NEW.trigger = 'cron') <> (NEW.scheduled_for IS NOT NULL AND NEW.schedule_revision IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'invalid job run automation provenance'); END;
CREATE TRIGGER job_runs_automation_scope_update BEFORE UPDATE OF job_id, project_id, organization_id, effective_service_principal_id, job_revision, authorization_revision ON job_runs
WHEN NEW.organization_id IS NULL OR NEW.effective_service_principal_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM jobs job JOIN automation_principal_grants grant_row
    ON grant_row.project_id = job.project_id AND grant_row.service_principal_id = job.service_principal_id
  WHERE job.id = NEW.job_id AND job.project_id = NEW.project_id
    AND job.organization_id = NEW.organization_id AND job.service_principal_id = NEW.effective_service_principal_id
    AND job.revision = NEW.job_revision AND grant_row.permission = 'execute'
    AND grant_row.revision = NEW.authorization_revision
)
BEGIN SELECT RAISE(ABORT, 'invalid job run automation scope'); END;
CREATE TRIGGER job_run_logs_automation_scope_insert BEFORE INSERT ON job_run_logs
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM job_runs run WHERE run.id = NEW.run_id AND run.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'job run log scope mismatch'); END;
CREATE TRIGGER job_run_logs_automation_scope_update BEFORE UPDATE OF run_id, organization_id ON job_run_logs
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM job_runs run WHERE run.id = NEW.run_id AND run.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'job run log scope mismatch'); END;
CREATE TRIGGER trusted_job_events_automation_scope_insert BEFORE INSERT ON trusted_job_events
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM projects project WHERE project.id = NEW.project_id AND project.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'trusted job event scope mismatch'); END;
CREATE TRIGGER job_event_dispatches_automation_scope_insert BEFORE INSERT ON job_event_dispatches
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM trusted_job_events event
  WHERE event.project_id = NEW.project_id AND event.id = NEW.trusted_event_id AND event.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'job event dispatch scope mismatch'); END;
CREATE TRIGGER job_event_deliveries_automation_scope_insert BEFORE INSERT ON job_event_deliveries
WHEN NEW.organization_id IS NULL OR NEW.effective_service_principal_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM trusted_job_events event JOIN jobs job ON job.project_id = event.project_id
  WHERE event.project_id = NEW.project_id AND event.id = NEW.trusted_event_id AND job.id = NEW.job_id
    AND event.organization_id = NEW.organization_id AND job.organization_id = NEW.organization_id
    AND job.service_principal_id = NEW.effective_service_principal_id
    AND event.source_actor_type IS NEW.source_actor_type AND event.source_actor_id IS NEW.source_actor_id
)
BEGIN SELECT RAISE(ABORT, 'job event delivery scope mismatch'); END;
CREATE TRIGGER job_event_deliveries_automation_scope_update BEFORE UPDATE OF project_id, organization_id, trusted_event_id, job_id, effective_service_principal_id, source_actor_type, source_actor_id ON job_event_deliveries
WHEN NEW.organization_id IS NULL OR NEW.effective_service_principal_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM trusted_job_events event JOIN jobs job ON job.project_id = event.project_id
  WHERE event.project_id = NEW.project_id AND event.id = NEW.trusted_event_id AND job.id = NEW.job_id
    AND event.organization_id = NEW.organization_id AND job.organization_id = NEW.organization_id
    AND job.service_principal_id = NEW.effective_service_principal_id
    AND event.source_actor_type IS NEW.source_actor_type AND event.source_actor_id IS NEW.source_actor_id
)
BEGIN SELECT RAISE(ABORT, 'job event delivery scope mismatch'); END;
CREATE TRIGGER job_event_attempts_automation_scope_insert BEFORE INSERT ON job_event_attempts
WHEN NEW.organization_id IS NULL OR NEW.effective_service_principal_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM job_event_deliveries delivery JOIN job_runs run
    ON run.project_id = delivery.project_id AND run.id = NEW.run_id
  WHERE delivery.project_id = NEW.project_id AND delivery.id = NEW.delivery_id
    AND delivery.organization_id = NEW.organization_id AND run.organization_id = NEW.organization_id
    AND delivery.effective_service_principal_id = NEW.effective_service_principal_id
    AND run.effective_service_principal_id = NEW.effective_service_principal_id
    AND run.source_actor_type IS NEW.source_actor_type AND run.source_actor_id IS NEW.source_actor_id
)
BEGIN SELECT RAISE(ABORT, 'job event attempt scope mismatch'); END;
CREATE TRIGGER job_event_attempts_automation_scope_update BEFORE UPDATE OF project_id, organization_id, effective_service_principal_id, source_actor_type, source_actor_id, delivery_id, run_id ON job_event_attempts
WHEN NEW.organization_id IS NULL OR NEW.effective_service_principal_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM job_event_deliveries delivery JOIN job_runs run
    ON run.project_id = delivery.project_id AND run.id = NEW.run_id
  WHERE delivery.project_id = NEW.project_id AND delivery.id = NEW.delivery_id
    AND delivery.organization_id = NEW.organization_id AND run.organization_id = NEW.organization_id
    AND delivery.effective_service_principal_id = NEW.effective_service_principal_id
    AND run.effective_service_principal_id = NEW.effective_service_principal_id
    AND run.source_actor_type IS NEW.source_actor_type AND run.source_actor_id IS NEW.source_actor_id
)
BEGIN SELECT RAISE(ABORT, 'job event attempt scope mismatch'); END;
CREATE TRIGGER job_vault_references_automation_scope_insert BEFORE INSERT ON job_vault_references
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM jobs job JOIN vault_items item ON item.project_id = job.project_id AND item.id = NEW.item_id
  WHERE job.project_id = NEW.project_id AND job.id = NEW.job_id
    AND job.organization_id = NEW.organization_id AND item.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'job vault reference scope mismatch'); END;
CREATE TRIGGER job_vault_references_automation_scope_update BEFORE UPDATE OF project_id, organization_id, job_id, item_id ON job_vault_references
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM jobs job JOIN vault_items item ON item.project_id = job.project_id AND item.id = NEW.item_id
  WHERE job.project_id = NEW.project_id AND job.id = NEW.job_id
    AND job.organization_id = NEW.organization_id AND item.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'job vault reference scope mismatch'); END;
CREATE TRIGGER job_vault_reference_audit_automation_scope_insert BEFORE INSERT ON job_vault_reference_audit
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM jobs job WHERE job.project_id = NEW.project_id AND job.id = NEW.job_id
    AND job.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'job vault reference audit scope mismatch'); END;
CREATE TRIGGER job_vault_runs_automation_scope_insert BEFORE INSERT ON job_vault_runs
WHEN NEW.organization_id IS NULL OR NEW.effective_service_principal_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM job_runs run WHERE run.project_id = NEW.project_id AND run.id = NEW.run_id AND run.job_id = NEW.job_id
    AND run.organization_id = NEW.organization_id
    AND run.effective_service_principal_id = NEW.effective_service_principal_id
    AND run.job_revision = NEW.job_revision AND run.authorization_revision = NEW.authorization_revision
)
BEGIN SELECT RAISE(ABORT, 'job vault run scope mismatch'); END;
CREATE TRIGGER job_vault_runs_automation_scope_update BEFORE UPDATE OF run_id, project_id, organization_id, job_id, effective_service_principal_id, job_revision, authorization_revision ON job_vault_runs
WHEN NEW.organization_id IS NULL OR NEW.effective_service_principal_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM job_runs run WHERE run.project_id = NEW.project_id AND run.id = NEW.run_id AND run.job_id = NEW.job_id
    AND run.organization_id = NEW.organization_id
    AND run.effective_service_principal_id = NEW.effective_service_principal_id
    AND run.job_revision = NEW.job_revision AND run.authorization_revision = NEW.authorization_revision
)
BEGIN SELECT RAISE(ABORT, 'job vault run scope mismatch'); END;
CREATE TRIGGER job_vault_run_items_automation_scope_insert BEFORE INSERT ON job_vault_run_items
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM job_vault_runs run JOIN job_vault_references reference
    ON reference.project_id = run.project_id AND reference.job_id = run.job_id AND reference.item_id = NEW.item_id
  WHERE run.project_id = NEW.project_id AND run.run_id = NEW.run_id AND run.job_id = NEW.job_id
    AND run.organization_id = NEW.organization_id AND reference.organization_id = NEW.organization_id
    AND reference.grant_revision = NEW.grant_revision
)
BEGIN SELECT RAISE(ABORT, 'job vault run item scope mismatch'); END;
CREATE TRIGGER job_vault_runtime_audit_automation_scope_insert BEFORE INSERT ON job_vault_runtime_audit
WHEN NEW.organization_id IS NULL OR NEW.effective_service_principal_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM job_runs run WHERE run.project_id = NEW.project_id AND run.id = NEW.run_id AND run.job_id = NEW.job_id
    AND run.organization_id = NEW.organization_id AND run.effective_service_principal_id = NEW.effective_service_principal_id
)
BEGIN SELECT RAISE(ABORT, 'job vault runtime audit scope mismatch'); END;
CREATE TRIGGER tasks_automation_scope_insert BEFORE INSERT ON tasks
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id)
  OR (NEW.owner_kind = 'user') <> (NEW.owner_user_id IS NOT NULL)
  OR (NEW.visibility = 'private') <> (NEW.owner_user_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'invalid task automation scope'); END;
CREATE TRIGGER tasks_automation_scope_immutable BEFORE UPDATE OF organization_id, project_id, owner_kind, owner_user_id, visibility ON tasks
WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.project_id IS NOT OLD.project_id
  OR NEW.owner_kind IS NOT OLD.owner_kind OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.visibility IS NOT OLD.visibility
BEGIN SELECT RAISE(ABORT, 'task automation scope is immutable'); END;
CREATE TRIGGER task_comments_automation_scope_insert BEFORE INSERT ON task_comments
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM tasks task WHERE task.id = NEW.task_id AND task.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'task comment scope mismatch'); END;
CREATE TRIGGER task_comments_automation_scope_update BEFORE UPDATE OF task_id, organization_id ON task_comments
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM tasks task WHERE task.id = NEW.task_id AND task.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'task comment scope mismatch'); END;
CREATE TRIGGER task_activity_automation_scope_insert BEFORE INSERT ON task_activity
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM tasks task WHERE task.id = NEW.task_id AND task.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'task activity scope mismatch'); END;
CREATE TRIGGER task_activity_automation_scope_update BEFORE UPDATE OF task_id, organization_id ON task_activity
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM tasks task WHERE task.id = NEW.task_id AND task.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'task activity scope mismatch'); END;
CREATE TRIGGER task_links_automation_scope_insert BEFORE INSERT ON task_links
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM tasks source JOIN tasks target ON target.id = NEW.linked_task_id
  WHERE source.id = NEW.task_id AND source.organization_id = NEW.organization_id
    AND target.organization_id = NEW.organization_id AND target.project_id = source.project_id
)
BEGIN SELECT RAISE(ABORT, 'task link scope mismatch'); END;
CREATE TRIGGER task_links_automation_scope_update BEFORE UPDATE OF task_id, linked_task_id, organization_id ON task_links
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM tasks source JOIN tasks target ON target.id = NEW.linked_task_id
  WHERE source.id = NEW.task_id AND source.organization_id = NEW.organization_id
    AND target.organization_id = NEW.organization_id AND target.project_id = source.project_id
)
BEGIN SELECT RAISE(ABORT, 'task link scope mismatch'); END;
CREATE TRIGGER task_notifications_automation_scope_insert BEFORE INSERT ON task_notifications
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM tasks task WHERE task.id = NEW.task_id AND task.project_id = NEW.project_id
    AND task.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'task notification scope mismatch'); END;
CREATE TRIGGER task_notifications_automation_scope_update BEFORE UPDATE OF project_id, organization_id, task_id ON task_notifications
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM tasks task WHERE task.id = NEW.task_id AND task.project_id = NEW.project_id
    AND task.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'task notification scope mismatch'); END;
CREATE TRIGGER board_config_automation_scope_insert BEFORE INSERT ON board_config
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM projects project WHERE project.id = NEW.project_id AND project.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'board config scope mismatch'); END;
CREATE TRIGGER board_config_automation_scope_update BEFORE UPDATE OF project_id, organization_id ON board_config
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM projects project WHERE project.id = NEW.project_id AND project.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'board config scope mismatch'); END;
CREATE TRIGGER task_source_references_automation_scope_insert BEFORE INSERT ON task_source_references
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM tasks task WHERE task.id = NEW.task_id AND task.project_id = NEW.project_id
    AND task.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'task source reference scope mismatch'); END;
CREATE TRIGGER task_mutation_receipts_automation_scope_insert BEFORE INSERT ON task_mutation_receipts
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM tasks task WHERE task.id = NEW.task_id AND task.project_id = NEW.project_id
    AND task.organization_id = NEW.organization_id
)
BEGIN SELECT RAISE(ABORT, 'task mutation receipt scope mismatch'); END;
CREATE TRIGGER pipeline_events_automation_scope_insert BEFORE INSERT ON pipeline_events
WHEN (NEW.source_run_id IS NULL) <> (NEW.effective_service_principal_id IS NULL)
  OR (NEW.source_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM job_runs run WHERE run.id = NEW.source_run_id AND run.project_id = NEW.project_id
      AND run.organization_id = NEW.organization_id
      AND run.effective_service_principal_id = NEW.effective_service_principal_id
  ))
BEGIN SELECT RAISE(ABORT, 'pipeline event automation scope mismatch'); END;
CREATE TRIGGER pipeline_events_automation_scope_update BEFORE UPDATE OF project_id, organization_id, source_run_id, effective_service_principal_id ON pipeline_events
WHEN (NEW.source_run_id IS NULL) <> (NEW.effective_service_principal_id IS NULL)
  OR (NEW.source_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM job_runs run WHERE run.id = NEW.source_run_id AND run.project_id = NEW.project_id
      AND run.organization_id = NEW.organization_id
      AND run.effective_service_principal_id = NEW.effective_service_principal_id
  ))
BEGIN SELECT RAISE(ABORT, 'pipeline event automation scope mismatch'); END;

CREATE TABLE automation_tenancy_manifests (
  migration INTEGER PRIMARY KEY CHECK(migration = 99),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  counts_json TEXT NOT NULL CHECK(json_valid(counts_json) AND json_type(counts_json) = 'object'),
  identities_json TEXT NOT NULL CHECK(json_valid(identities_json) AND json_type(identities_json) = 'array'),
  phase TEXT NOT NULL CHECK(phase = 'verified'),
  created_at TEXT NOT NULL
);
INSERT INTO automation_tenancy_manifests (migration, organization_id, counts_json, identities_json, phase, created_at)
SELECT 99, '00000000-0000-4000-8000-000000000093',
  json_object('jobs', (SELECT count(*) FROM jobs), 'runs', (SELECT count(*) FROM job_runs),
    'logs', (SELECT count(*) FROM job_run_logs), 'tasks', (SELECT count(*) FROM tasks),
    'trusted_events', (SELECT count(*) FROM trusted_job_events), 'deliveries', (SELECT count(*) FROM job_event_deliveries)),
  COALESCE((SELECT json_group_array(identity) FROM (
    SELECT 'job:' || id AS identity FROM jobs
    UNION ALL SELECT 'run:' || id FROM job_runs
    UNION ALL SELECT 'task:' || id FROM tasks
    UNION ALL SELECT 'event:' || id FROM trusted_job_events
    UNION ALL SELECT 'delivery:' || id FROM job_event_deliveries
    ORDER BY identity
  )), '[]'), 'verified', datetime('now');
CREATE TRIGGER automation_tenancy_manifests_immutable_update BEFORE UPDATE ON automation_tenancy_manifests
BEGIN SELECT RAISE(ABORT, 'automation tenancy manifests are immutable'); END;
CREATE TRIGGER automation_tenancy_manifests_immutable_delete BEFORE DELETE ON automation_tenancy_manifests
BEGIN SELECT RAISE(ABORT, 'automation tenancy manifests are immutable'); END;

COMMIT;
PRAGMA foreign_keys = ON;
