-- Evolve installation restore ownership only. Preserve original approval,
-- consume-once, revision, deadline, signature and immutable history guards.
CREATE TABLE installation_restore_owner_schema (
 singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
 schema_version INTEGER NOT NULL CHECK(schema_version = 1)
);
CREATE TRIGGER installation_restore_schema_no_update BEFORE UPDATE ON installation_restore_owner_schema
BEGIN SELECT RAISE(ABORT, 'installation restore schema is immutable'); END;
CREATE TRIGGER installation_restore_schema_no_delete BEFORE DELETE ON installation_restore_owner_schema
BEGIN SELECT RAISE(ABORT, 'installation restore schema is immutable'); END;
CREATE TRIGGER installation_restore_schema_no_replace BEFORE INSERT ON installation_restore_owner_schema
WHEN EXISTS (SELECT 1 FROM installation_restore_owner_schema)
BEGIN SELECT RAISE(ABORT, 'installation restore schema is immutable'); END;
DROP TRIGGER IF EXISTS backup_restore_plans_global_project_insert;
CREATE TRIGGER backup_restore_plans_global_project_insert
BEFORE INSERT ON backup_restore_plans
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND EXISTS (SELECT 1 FROM veyra_installation_identity installation JOIN veyra_installation_legacy_refs storage ON storage.instance_id=installation.instance_id WHERE installation.singleton=1 AND storage.legacy_project_id=projects.id) AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore plans require the active global project'); END;

DROP TRIGGER IF EXISTS backup_restore_plan_revisions_global_project_insert;
CREATE TRIGGER backup_restore_plan_revisions_global_project_insert
BEFORE INSERT ON backup_restore_plan_revisions
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND EXISTS (SELECT 1 FROM veyra_installation_identity installation JOIN veyra_installation_legacy_refs storage ON storage.instance_id=installation.instance_id WHERE installation.singleton=1 AND storage.legacy_project_id=projects.id) AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore plan revisions require the active global project'); END;

DROP TRIGGER IF EXISTS backup_restore_authorizations_global_project_insert;
CREATE TRIGGER backup_restore_authorizations_global_project_insert
BEFORE INSERT ON backup_restore_authorizations
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND EXISTS (SELECT 1 FROM veyra_installation_identity installation JOIN veyra_installation_legacy_refs storage ON storage.instance_id=installation.instance_id WHERE installation.singleton=1 AND storage.legacy_project_id=projects.id) AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore authorizations require the active global project'); END;

DROP TRIGGER IF EXISTS backup_restore_stages_global_project_insert;
CREATE TRIGGER backup_restore_stages_global_project_insert
BEFORE INSERT ON backup_restore_stages
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND EXISTS (SELECT 1 FROM veyra_installation_identity installation JOIN veyra_installation_legacy_refs storage ON storage.instance_id=installation.instance_id WHERE installation.singleton=1 AND storage.legacy_project_id=projects.id) AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore stages require the active global project'); END;

DROP TRIGGER IF EXISTS backup_restore_events_global_project_insert;
CREATE TRIGGER backup_restore_events_global_project_insert
BEFORE INSERT ON backup_restore_events
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND EXISTS (SELECT 1 FROM veyra_installation_identity installation JOIN veyra_installation_legacy_refs storage ON storage.instance_id=installation.instance_id WHERE installation.singleton=1 AND storage.legacy_project_id=projects.id) AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore events require the active global project'); END;

DROP TRIGGER IF EXISTS backup_restore_receipts_global_project_insert;
CREATE TRIGGER backup_restore_receipts_global_project_insert
BEFORE INSERT ON backup_restore_receipts
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND EXISTS (SELECT 1 FROM veyra_installation_identity installation JOIN veyra_installation_legacy_refs storage ON storage.instance_id=installation.instance_id WHERE installation.singleton=1 AND storage.legacy_project_id=projects.id) AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore receipts require the active global project'); END;

DROP TRIGGER IF EXISTS backup_restore_execution_authorizations_global_project_insert;
CREATE TRIGGER backup_restore_execution_authorizations_global_project_insert
BEFORE INSERT ON backup_restore_execution_authorizations
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND EXISTS (SELECT 1 FROM veyra_installation_identity installation JOIN veyra_installation_legacy_refs storage ON storage.instance_id=installation.instance_id WHERE installation.singleton=1 AND storage.legacy_project_id=projects.id) AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore execution authorizations require the active global project'); END;

DROP TRIGGER IF EXISTS backup_restore_execution_runs_global_project_insert;
CREATE TRIGGER backup_restore_execution_runs_global_project_insert
BEFORE INSERT ON backup_restore_execution_runs
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND EXISTS (SELECT 1 FROM veyra_installation_identity installation JOIN veyra_installation_legacy_refs storage ON storage.instance_id=installation.instance_id WHERE installation.singleton=1 AND storage.legacy_project_id=projects.id) AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore execution runs require the active global project'); END;

DROP TRIGGER IF EXISTS backup_restore_execution_items_global_project_insert;
CREATE TRIGGER backup_restore_execution_items_global_project_insert
BEFORE INSERT ON backup_restore_execution_items
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND EXISTS (SELECT 1 FROM veyra_installation_identity installation JOIN veyra_installation_legacy_refs storage ON storage.instance_id=installation.instance_id WHERE installation.singleton=1 AND storage.legacy_project_id=projects.id) AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore execution items require the active global project'); END;

DROP TRIGGER IF EXISTS backup_restore_executor_plan_revisions_global_project_insert;
CREATE TRIGGER backup_restore_executor_plan_revisions_global_project_insert
BEFORE INSERT ON backup_restore_executor_plan_revisions
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND EXISTS (SELECT 1 FROM veyra_installation_identity installation JOIN veyra_installation_legacy_refs storage ON storage.instance_id=installation.instance_id WHERE installation.singleton=1 AND storage.legacy_project_id=projects.id) AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore execution revisions require the active global project'); END;

DROP TRIGGER IF EXISTS backup_restore_execution_events_global_project_insert;
CREATE TRIGGER backup_restore_execution_events_global_project_insert
BEFORE INSERT ON backup_restore_execution_events
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND EXISTS (SELECT 1 FROM veyra_installation_identity installation JOIN veyra_installation_legacy_refs storage ON storage.instance_id=installation.instance_id WHERE installation.singleton=1 AND storage.legacy_project_id=projects.id) AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore execution events require the active global project'); END;

DROP TRIGGER IF EXISTS backup_restore_execution_receipts_global_project_insert;
CREATE TRIGGER backup_restore_execution_receipts_global_project_insert
BEFORE INSERT ON backup_restore_execution_receipts
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND EXISTS (SELECT 1 FROM veyra_installation_identity installation JOIN veyra_installation_legacy_refs storage ON storage.instance_id=installation.instance_id WHERE installation.singleton=1 AND storage.legacy_project_id=projects.id) AND archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'restore execution receipts require the active global project'); END;
INSERT INTO installation_restore_owner_schema(singleton,schema_version) VALUES(1,1);
