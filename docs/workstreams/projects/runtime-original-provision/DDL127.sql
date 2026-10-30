-- Root-reserved Node 127 proposal only. Existing Core migration transaction owns BEGIN/COMMIT.
-- No original is inferred from legacy rows, labels, events or a current probe.
CREATE TABLE runtime_original_provisions (
 runtime_id TEXT PRIMARY KEY REFERENCES runtime_instances(id) ON DELETE RESTRICT,
 parent_container_id TEXT NOT NULL UNIQUE CHECK(length(parent_container_id)=64 AND parent_container_id NOT GLOB '*[^0-9a-f]*'),
 daemon_id TEXT NOT NULL CHECK(length(daemon_id) BETWEEN 1 AND 256),
 host_id TEXT NOT NULL CHECK(length(host_id)=78 AND substr(host_id,1,14)='docker-daemon:'),
 image_id TEXT NOT NULL CHECK(length(image_id)=71 AND substr(image_id,1,7)='sha256:' AND substr(image_id,8) NOT GLOB '*[^0-9a-f]*'),
 start_identity TEXT NOT NULL CHECK(length(start_identity)=64 AND start_identity NOT GLOB '*[^0-9a-f]*'),
 public_profile_sha256 TEXT NOT NULL CHECK(length(public_profile_sha256)=64 AND public_profile_sha256 NOT GLOB '*[^0-9a-f]*'),
 spec_sha256 TEXT NOT NULL CHECK(length(spec_sha256)=64 AND spec_sha256 NOT GLOB '*[^0-9a-f]*'),
 workspace_id TEXT NOT NULL,organization_id TEXT NOT NULL,project_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,
 binding_hash TEXT NOT NULL CHECK(length(binding_hash)=64 AND binding_hash NOT GLOB '*[^0-9a-f]*'),
 binding_epoch INTEGER NOT NULL CHECK(binding_epoch>=0),
 provisioning_revision INTEGER NOT NULL CHECK(provisioning_revision>=0),
 request_id TEXT NOT NULL UNIQUE CHECK(length(request_id)=36),
 request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
 cpu_millis INTEGER NOT NULL CHECK(cpu_millis BETWEEN 100 AND 64000),
 memory_bytes INTEGER NOT NULL CHECK(memory_bytes BETWEEN 134217728 AND 274877906944),
 pids_limit INTEGER NOT NULL CHECK(pids_limit BETWEEN 16 AND 65536),
 disk_bytes INTEGER NOT NULL CHECK(disk_bytes BETWEEN 67108864 AND 1099511627776),
 process_limit INTEGER NOT NULL CHECK(process_limit BETWEEN 16 AND pids_limit),
 container_created_at TEXT NOT NULL CHECK(julianday(container_created_at) IS NOT NULL),
 created_at TEXT NOT NULL CHECK(julianday(created_at) IS NOT NULL),
 FOREIGN KEY(runtime_id,workspace_id,organization_id,project_id,owner_user_id)
  REFERENCES runtime_instances(id,workspace_id,organization_id,project_id,owner_user_id) ON DELETE RESTRICT
) STRICT;
CREATE TRIGGER runtime_original_provisions_initial_only BEFORE INSERT ON runtime_original_provisions
WHEN NOT EXISTS(
 SELECT 1 FROM runtime_instances r JOIN authorized_workspaces w ON w.id=r.workspace_id
 WHERE r.id=NEW.runtime_id AND r.state='PROVISIONING' AND r.revision=NEW.provisioning_revision
 AND r.backend_container_id IS NULL AND r.workspace_id=NEW.workspace_id AND r.organization_id=NEW.organization_id
 AND r.project_id=NEW.project_id AND r.owner_user_id=NEW.owner_user_id AND r.security_epoch=NEW.binding_epoch
 AND r.cpu_millis=NEW.cpu_millis AND r.memory_bytes=NEW.memory_bytes AND r.pids_limit=NEW.pids_limit
 AND r.disk_bytes=NEW.disk_bytes AND r.process_limit=NEW.process_limit
 AND w.organization_id=NEW.organization_id AND w.project_id=NEW.project_id AND w.owner_user_id=NEW.owner_user_id
 AND w.status='authorized' AND w.security_epoch=NEW.binding_epoch AND w.storage_mapping_hash=NEW.binding_hash
)
BEGIN SELECT RAISE(ABORT,'original provisioning owner unavailable'); END;
CREATE TRIGGER runtime_original_provisions_no_update BEFORE UPDATE ON runtime_original_provisions
BEGIN SELECT RAISE(ABORT,'initial runtime provision is immutable'); END;
CREATE TRIGGER runtime_original_provisions_no_delete BEFORE DELETE ON runtime_original_provisions
BEGIN SELECT RAISE(ABORT,'initial runtime provision must survive'); END;
