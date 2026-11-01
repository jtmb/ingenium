-- Installation credentials retain their original encrypted vault rows and references.
-- Only the installation branch changes; organization/user ownership remains unchanged.
CREATE TABLE installation_credential_owner_schema (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  schema_version INTEGER NOT NULL CHECK(schema_version = 1)
);
CREATE TRIGGER installation_credential_schema_no_update BEFORE UPDATE ON installation_credential_owner_schema
BEGIN SELECT RAISE(ABORT, 'installation credential schema is immutable'); END;
CREATE TRIGGER installation_credential_schema_no_delete BEFORE DELETE ON installation_credential_owner_schema
BEGIN SELECT RAISE(ABORT, 'installation credential schema is immutable'); END;
CREATE TRIGGER installation_credential_schema_no_replace BEFORE INSERT ON installation_credential_owner_schema
WHEN EXISTS (SELECT 1 FROM installation_credential_owner_schema)
BEGIN SELECT RAISE(ABORT, 'installation credential schema is immutable'); END;
DROP TRIGGER IF EXISTS provider_connections_owner_valid_insert;
CREATE TRIGGER provider_connections_owner_valid_insert BEFORE INSERT ON provider_connections
WHEN (NEW.owner_kind = 'user' AND NOT EXISTS (
  SELECT 1 FROM organization_memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.owner_user_id AND status = 'active'
)) OR (NEW.credential_item_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM vault_items item
  JOIN projects project ON project.id = item.project_id
  WHERE item.id = NEW.credential_item_id AND item.access_policy <> '{"mode":"deleted"}'
    AND ((NEW.owner_kind = 'installation' AND EXISTS (SELECT 1 FROM veyra_installation_identity installation JOIN veyra_installation_legacy_refs storage ON storage.instance_id = installation.instance_id WHERE installation.singleton = 1 AND storage.legacy_project_id = project.id) AND item.owner_kind = 'organization')
      OR (NEW.owner_kind = 'organization' AND item.organization_id = NEW.organization_id AND item.owner_kind = 'organization')
      OR (NEW.owner_kind = 'user' AND item.organization_id = NEW.organization_id AND item.owner_kind = 'user' AND item.owner_user_id = NEW.owner_user_id))
))
BEGIN SELECT RAISE(ABORT, 'invalid provider owner or credential'); END;

DROP TRIGGER IF EXISTS provider_connections_credential_valid_update;
CREATE TRIGGER provider_connections_credential_valid_update BEFORE UPDATE OF credential_item_id ON provider_connections
WHEN NEW.credential_item_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM vault_items item
  JOIN projects project ON project.id = item.project_id
  WHERE item.id = NEW.credential_item_id AND item.access_policy <> '{"mode":"deleted"}'
    AND ((NEW.owner_kind = 'installation' AND EXISTS (SELECT 1 FROM veyra_installation_identity installation JOIN veyra_installation_legacy_refs storage ON storage.instance_id = installation.instance_id WHERE installation.singleton = 1 AND storage.legacy_project_id = project.id) AND item.owner_kind = 'organization')
      OR (NEW.owner_kind = 'organization' AND item.organization_id = NEW.organization_id AND item.owner_kind = 'organization')
      OR (NEW.owner_kind = 'user' AND item.organization_id = NEW.organization_id AND item.owner_kind = 'user' AND item.owner_user_id = NEW.owner_user_id))
)
BEGIN SELECT RAISE(ABORT, 'invalid provider credential'); END;
INSERT INTO installation_credential_owner_schema(singleton, schema_version) VALUES(1, 1);
