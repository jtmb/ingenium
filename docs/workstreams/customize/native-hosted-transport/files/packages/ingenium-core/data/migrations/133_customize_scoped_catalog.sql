-- Original Core writer only. No credential store, identity migration or synthetic project.
ALTER TABLE plugins ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0);
ALTER TABLE plugins ADD COLUMN archived_at TEXT;
CREATE TRIGGER plugins_archived_inactive BEFORE UPDATE ON plugins
WHEN NEW.archived_at IS NOT NULL AND NEW.enabled<>0
BEGIN SELECT RAISE(ABORT,'Archived plugins cannot activate'); END;
CREATE TRIGGER plugins_revision AFTER UPDATE ON plugins WHEN NEW.revision=OLD.revision
BEGIN UPDATE plugins SET revision=OLD.revision+1 WHERE id=OLD.id; END;
CREATE TABLE plugin_lifecycle_events(
 id TEXT PRIMARY KEY DEFAULT(lower(hex(randomblob(16)))),plugin_id TEXT NOT NULL REFERENCES plugins(id),
 project_id TEXT NOT NULL REFERENCES projects(id),previous_revision INTEGER NOT NULL,next_revision INTEGER NOT NULL,
 action TEXT NOT NULL CHECK(action IN('archive','restore')),created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TRIGGER plugins_lifecycle_event AFTER UPDATE OF archived_at ON plugins WHEN OLD.archived_at IS NOT NEW.archived_at
BEGIN INSERT INTO plugin_lifecycle_events(plugin_id,project_id,previous_revision,next_revision,action)
 VALUES(NEW.id,NEW.project_id,OLD.revision,CASE WHEN NEW.revision=OLD.revision THEN OLD.revision+1 ELSE NEW.revision END,CASE WHEN NEW.archived_at IS NULL THEN 'restore' ELSE 'archive' END); END;
CREATE TRIGGER plugin_lifecycle_event_no_update BEFORE UPDATE ON plugin_lifecycle_events BEGIN SELECT RAISE(ABORT,'Immutable plugin lifecycle event'); END;
CREATE TRIGGER plugin_lifecycle_event_no_delete BEFORE DELETE ON plugin_lifecycle_events BEGIN SELECT RAISE(ABORT,'Immutable plugin lifecycle event'); END;
CREATE TABLE customize_catalog_sources(
 id TEXT PRIMARY KEY,parent_source_id TEXT REFERENCES customize_catalog_sources(id),installation_id TEXT NOT NULL,organization_id TEXT NOT NULL REFERENCES organizations(id),
 owner_user_id TEXT REFERENCES users(id),visibility TEXT NOT NULL CHECK(visibility IN('personal','public','system')),
 kind TEXT NOT NULL CHECK(kind IN('plugin','skill')),name TEXT NOT NULL,description TEXT NOT NULL,
 source_project_id TEXT NOT NULL REFERENCES projects(id),source_resource_id TEXT NOT NULL,source_revision INTEGER NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 published_by TEXT NOT NULL REFERENCES users(id),revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),archived_at TEXT,
 created_at TEXT NOT NULL,CHECK((visibility='personal' AND owner_user_id IS NOT NULL) OR (visibility<>'personal' AND owner_user_id IS NULL)));
CREATE INDEX customize_catalog_scope ON customize_catalog_sources(installation_id,visibility,organization_id,owner_user_id,created_at,id);
CREATE TRIGGER customize_catalog_immutable BEFORE UPDATE ON customize_catalog_sources
WHEN NEW.id<>OLD.id OR NEW.parent_source_id IS NOT OLD.parent_source_id OR NEW.installation_id<>OLD.installation_id OR NEW.organization_id<>OLD.organization_id
 OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.visibility<>OLD.visibility OR NEW.kind<>OLD.kind OR NEW.name<>OLD.name
 OR NEW.description<>OLD.description OR NEW.source_project_id<>OLD.source_project_id OR NEW.source_resource_id<>OLD.source_resource_id
 OR NEW.source_revision<>OLD.source_revision OR NEW.payload_json<>OLD.payload_json OR NEW.payload_sha256<>OLD.payload_sha256
 OR NEW.published_by<>OLD.published_by OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1
BEGIN SELECT RAISE(ABORT,'Immutable catalog snapshot'); END;
CREATE TRIGGER customize_catalog_no_delete BEFORE DELETE ON customize_catalog_sources BEGIN SELECT RAISE(ABORT,'Retain catalog snapshot'); END;
CREATE TABLE customize_commands(
 id TEXT PRIMARY KEY,installation_id TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),
 project_id TEXT REFERENCES projects(id),kind TEXT NOT NULL CHECK(kind IN('plugin','skill')),resource_key TEXT NOT NULL,
 original_json TEXT NOT NULL CHECK(json_valid(original_json)),payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),created_at TEXT NOT NULL);
CREATE INDEX customize_commands_pending ON customize_commands(project_id,kind) WHERE result_json IS NULL;
CREATE TRIGGER customize_command_no_update BEFORE UPDATE ON customize_commands
WHEN NEW.id<>OLD.id OR NEW.installation_id<>OLD.installation_id OR NEW.actor_id<>OLD.actor_id OR NEW.project_id IS NOT OLD.project_id
 OR NEW.kind<>OLD.kind OR NEW.resource_key<>OLD.resource_key OR NEW.original_json<>OLD.original_json
 OR NEW.payload_sha256<>OLD.payload_sha256 OR NEW.created_at<>OLD.created_at OR OLD.result_json IS NOT NULL OR NEW.result_json IS NULL
BEGIN SELECT RAISE(ABORT,'Immutable original or first receipt'); END;
CREATE TRIGGER customize_command_no_delete BEFORE DELETE ON customize_commands BEGIN SELECT RAISE(ABORT,'Retain Customize original'); END;
CREATE TABLE customize_installations(
 id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES customize_catalog_sources(id),source_sha256 TEXT NOT NULL,
 project_id TEXT NOT NULL REFERENCES projects(id),kind TEXT NOT NULL CHECK(kind IN('plugin','skill')),target_name TEXT NOT NULL,
 resource_id TEXT,proposal_id TEXT REFERENCES skill_proposals(id),command_id TEXT NOT NULL UNIQUE REFERENCES customize_commands(id),
 created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 CHECK((kind='plugin' AND resource_id IS NOT NULL AND proposal_id IS NULL) OR (kind='skill' AND resource_id IS NULL AND proposal_id IS NOT NULL)));
CREATE TRIGGER customize_installation_no_update BEFORE UPDATE ON customize_installations BEGIN SELECT RAISE(ABORT,'Immutable installation provenance'); END;
CREATE TRIGGER customize_installation_no_delete BEFORE DELETE ON customize_installations BEGIN SELECT RAISE(ABORT,'Retain installation provenance'); END;