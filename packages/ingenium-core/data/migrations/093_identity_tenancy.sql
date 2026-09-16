-- AUTH-100: identity, organization tenancy, deterministic legacy-project backfill.
BEGIN IMMEDIATE;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 128),
  slug TEXT NOT NULL UNIQUE CHECK(length(slug) BETWEEN 1 AND 64 AND slug NOT GLOB '*[^a-z0-9-]*'),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended')),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64)
);

INSERT INTO organizations (id, name, slug, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000093', 'Bootstrap Organization', 'bootstrap', datetime('now'), datetime('now'));

CREATE TABLE users (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  email_normalized TEXT NOT NULL UNIQUE CHECK(length(email_normalized) BETWEEN 3 AND 320 AND email_normalized = lower(trim(email_normalized))),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 128),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64)
);

CREATE TABLE organization_memberships (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended')),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  PRIMARY KEY (organization_id, user_id)
);

ALTER TABLE projects ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
UPDATE projects SET organization_id = '00000000-0000-4000-8000-000000000093' WHERE organization_id IS NULL;

CREATE TABLE project_memberships (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK(role IN ('editor', 'viewer')),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE bootstrap_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  state TEXT NOT NULL CHECK(state IN ('pending', 'claimed')),
  organization_id TEXT NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE RESTRICT,
  owner_user_id TEXT UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  claimed_at TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 1 AND 64),
  CHECK((state = 'pending' AND owner_user_id IS NULL AND claimed_at IS NULL) OR (state = 'claimed' AND owner_user_id IS NOT NULL AND claimed_at IS NOT NULL))
);

INSERT INTO bootstrap_state (singleton, state, organization_id, created_at, updated_at)
VALUES (1, 'pending', '00000000-0000-4000-8000-000000000093', datetime('now'), datetime('now'));

CREATE TABLE bootstrap_manifests (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  migration INTEGER NOT NULL CHECK(migration = 93),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_count INTEGER NOT NULL CHECK(project_count >= 0),
  project_ids_json TEXT NOT NULL CHECK(json_valid(project_ids_json) AND json_type(project_ids_json) = 'array'),
  phase TEXT NOT NULL CHECK(phase IN ('expand', 'dual_write', 'backfill', 'verified')),
  integrity_result TEXT NOT NULL CHECK(integrity_result = 'ok'),
  foreign_key_violations INTEGER NOT NULL CHECK(foreign_key_violations = 0),
  created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 1 AND 64)
);

INSERT INTO bootstrap_manifests
  (id, migration, organization_id, project_count, project_ids_json, phase, integrity_result, foreign_key_violations, created_at)
SELECT '00000000-0000-4000-8000-000000000193', 93,
       '00000000-0000-4000-8000-000000000093', COUNT(*),
       COALESCE((SELECT json_group_array(id) FROM (SELECT id FROM projects ORDER BY id)), '[]'),
       'verified', 'ok', 0, datetime('now')
FROM projects;

CREATE INDEX idx_organization_memberships_user ON organization_memberships(user_id, organization_id);
CREATE INDEX idx_projects_organization ON projects(organization_id, id);
CREATE INDEX idx_project_memberships_user ON project_memberships(user_id, project_id);

CREATE TRIGGER projects_require_organization_insert
AFTER INSERT ON projects WHEN NEW.organization_id IS NULL
BEGIN
  UPDATE projects SET organization_id = '00000000-0000-4000-8000-000000000093' WHERE id = NEW.id;
END;
CREATE TRIGGER projects_require_organization_update
BEFORE UPDATE OF organization_id ON projects WHEN NEW.organization_id IS NULL
BEGIN SELECT RAISE(ABORT, 'projects require organization ownership'); END;

CREATE TRIGGER project_memberships_same_organization_insert
BEFORE INSERT ON project_memberships
WHEN NOT EXISTS (
  SELECT 1 FROM projects p JOIN organization_memberships m ON m.organization_id = p.organization_id
  WHERE p.id = NEW.project_id AND m.user_id = NEW.user_id AND m.status = 'active'
)
BEGIN SELECT RAISE(ABORT, 'project membership requires active organization membership'); END;
CREATE TRIGGER project_memberships_same_organization_update
BEFORE UPDATE ON project_memberships
WHEN NOT EXISTS (
  SELECT 1 FROM projects p JOIN organization_memberships m ON m.organization_id = p.organization_id
  WHERE p.id = NEW.project_id AND m.user_id = NEW.user_id AND m.status = 'active'
)
BEGIN SELECT RAISE(ABORT, 'project membership requires active organization membership'); END;

CREATE TRIGGER organization_memberships_keep_owner_delete
BEFORE DELETE ON organization_memberships WHEN OLD.role = 'owner' AND OLD.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = OLD.organization_id AND role = 'owner' AND status = 'active' AND user_id <> OLD.user_id)
BEGIN SELECT RAISE(ABORT, 'organization must retain an active owner'); END;
CREATE TRIGGER organization_memberships_keep_owner_update
BEFORE UPDATE OF role, status ON organization_memberships
WHEN OLD.role = 'owner' AND OLD.status = 'active' AND (NEW.role <> 'owner' OR NEW.status <> 'active')
  AND NOT EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = OLD.organization_id AND role = 'owner' AND status = 'active' AND user_id <> OLD.user_id)
BEGIN SELECT RAISE(ABORT, 'organization must retain an active owner'); END;

CREATE TRIGGER project_memberships_reject_org_departure
BEFORE UPDATE OF status ON organization_memberships
WHEN NEW.status <> 'active' AND EXISTS (
  SELECT 1 FROM project_memberships pm JOIN projects p ON p.id = pm.project_id
  WHERE pm.user_id = OLD.user_id AND p.organization_id = OLD.organization_id
)
BEGIN SELECT RAISE(ABORT, 'active project memberships require active organization membership'); END;
CREATE TRIGGER project_memberships_reject_org_delete
BEFORE DELETE ON organization_memberships
WHEN EXISTS (
  SELECT 1 FROM project_memberships pm JOIN projects p ON p.id = pm.project_id
  WHERE pm.user_id = OLD.user_id AND p.organization_id = OLD.organization_id
)
BEGIN SELECT RAISE(ABORT, 'active project memberships require active organization membership'); END;
CREATE TRIGGER projects_reject_membership_reparent
BEFORE UPDATE OF organization_id ON projects
WHEN NEW.organization_id <> OLD.organization_id AND EXISTS (
  SELECT 1 FROM project_memberships pm
  WHERE pm.project_id = OLD.id AND NOT EXISTS (
    SELECT 1 FROM organization_memberships om
    WHERE om.organization_id = NEW.organization_id AND om.user_id = pm.user_id AND om.status = 'active'
  )
)
BEGIN SELECT RAISE(ABORT, 'project reparent would create cross-organization membership'); END;

CREATE TRIGGER bootstrap_manifests_immutable_update BEFORE UPDATE ON bootstrap_manifests
BEGIN SELECT RAISE(ABORT, 'bootstrap manifests are immutable'); END;
CREATE TRIGGER bootstrap_manifests_immutable_delete BEFORE DELETE ON bootstrap_manifests
BEGIN SELECT RAISE(ABORT, 'bootstrap manifests are immutable'); END;

COMMIT;
