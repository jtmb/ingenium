-- Native allocation 6. Applied by the existing ProjectStore writer transaction.
-- OS subject comes from the captured process token/euid; no caller identity.
CREATE TABLE local_installation (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 installation_id TEXT NOT NULL UNIQUE,
 custodian_scheme TEXT NOT NULL CHECK(custodian_scheme IN ('windows_sid','linux_euid')),
 custodian_subject TEXT NOT NULL,
 state_identity TEXT NOT NULL,
 custodian_key TEXT NOT NULL UNIQUE CHECK(length(custodian_key)=64),
 epoch INTEGER NOT NULL CHECK(epoch>=0),
 legacy_manifest_sha256 TEXT NOT NULL CHECK(length(legacy_manifest_sha256)=64)
);
CREATE TABLE local_migration_receipts (
 version INTEGER PRIMARY KEY CHECK(version=6), installation_id TEXT NOT NULL,
 custodian_key TEXT NOT NULL, legacy_manifest_sha256 TEXT NOT NULL,
 FOREIGN KEY(installation_id) REFERENCES local_installation(installation_id)
);
CREATE TABLE local_workspaces (
 id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, custodian_key TEXT NOT NULL,
 environment TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 creation_sha256 TEXT NOT NULL CHECK(length(creation_sha256)=64),
 state TEXT NOT NULL CHECK(state IN ('reserved','active','unknown','retired')),
 root_identity TEXT, root_path TEXT,
 FOREIGN KEY(installation_id) REFERENCES local_installation(installation_id),
 FOREIGN KEY(custodian_key) REFERENCES local_installation(custodian_key),
 CHECK((state='active' AND root_identity IS NOT NULL AND root_path IS NOT NULL) OR state<>'active')
);
CREATE TABLE local_workspace_operations (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, owner_json TEXT NOT NULL,
 request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64),
 kind TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('intent','unknown','committed','denied')),
 result_json TEXT,
 FOREIGN KEY(workspace_id) REFERENCES local_workspaces(id)
);
CREATE TRIGGER local_installation_no_update BEFORE UPDATE ON local_installation
BEGIN SELECT RAISE(ABORT,'local custodian is immutable; no reassignment'); END;
CREATE TRIGGER local_installation_no_delete BEFORE DELETE ON local_installation
BEGIN SELECT RAISE(ABORT,'local custodian is immutable'); END;
CREATE TRIGGER local_migration_receipts_no_update BEFORE UPDATE ON local_migration_receipts
BEGIN SELECT RAISE(ABORT,'local migration receipt is immutable'); END;
CREATE TRIGGER local_migration_receipts_no_delete BEFORE DELETE ON local_migration_receipts
BEGIN SELECT RAISE(ABORT,'local migration receipt is immutable'); END;
CREATE TRIGGER local_workspace_original_no_change BEFORE UPDATE ON local_workspaces
WHEN NEW.id IS NOT OLD.id OR NEW.installation_id IS NOT OLD.installation_id
 OR NEW.custodian_key IS NOT OLD.custodian_key OR NEW.environment IS NOT OLD.environment
 OR NEW.creation_sha256 IS NOT OLD.creation_sha256 OR NEW.revision<OLD.revision
 OR (OLD.root_identity IS NOT NULL AND (NEW.root_identity IS NOT OLD.root_identity OR NEW.root_path IS NOT OLD.root_path))
 OR (OLD.state IN ('unknown','retired') AND NEW.state<>OLD.state)
BEGIN SELECT RAISE(ABORT,'local workspace original is immutable'); END;
CREATE TRIGGER local_workspace_no_delete BEFORE DELETE ON local_workspaces
BEGIN SELECT RAISE(ABORT,'local workspace must retain original'); END;
CREATE TRIGGER local_operation_no_replay BEFORE UPDATE ON local_workspace_operations
WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id
 OR NEW.owner_json IS NOT OLD.owner_json OR NEW.request_sha256 IS NOT OLD.request_sha256
 OR NEW.kind IS NOT OLD.kind OR OLD.state IN ('committed','denied')
 OR (OLD.state='unknown' AND NEW.state NOT IN ('unknown','committed'))
BEGIN SELECT RAISE(ABORT,'local operation original/outcome is immutable'); END;
CREATE TRIGGER local_operation_no_delete BEFORE DELETE ON local_workspace_operations
BEGIN SELECT RAISE(ABORT,'local operation original must survive'); END;
PRAGMA user_version=6;
