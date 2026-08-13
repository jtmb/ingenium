-- AUTH-105: organization Docs, authorization-scoped RAG, and private learning/context content.
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TEMP TABLE content_tenancy_owner_guard (
  valid INTEGER NOT NULL CHECK(valid = 1)
);
INSERT INTO content_tenancy_owner_guard (valid)
SELECT CASE
  WHEN (SELECT owner_user_id FROM bootstrap_state WHERE singleton = 1) IS NOT NULL THEN 1
  WHEN NOT EXISTS (
    SELECT 1 FROM context_conversations
    UNION ALL SELECT 1 FROM context_rag_upload_sessions
    UNION ALL SELECT 1 FROM context_rag_uploads
    UNION ALL SELECT 1 FROM observations
    UNION ALL SELECT 1 FROM personality_traits
  ) THEN 1
  ELSE 0
END;
DROP TABLE content_tenancy_owner_guard;

ALTER TABLE docs_spaces ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE docs_templates ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE docs_tags ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE docs_pages ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE docs_page_drafts ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE docs_page_versions ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE docs_comments ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE docs_attachments ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE docs_page_links ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE docs_page_projects ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE docs_page_tags ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE docs_repository_pages ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;

UPDATE docs_spaces SET organization_id = '00000000-0000-4000-8000-000000000093' WHERE organization_id IS NULL;
UPDATE docs_templates SET organization_id = '00000000-0000-4000-8000-000000000093' WHERE organization_id IS NULL;
UPDATE docs_tags SET organization_id = '00000000-0000-4000-8000-000000000093' WHERE organization_id IS NULL;
UPDATE docs_pages SET organization_id = (SELECT organization_id FROM docs_spaces WHERE id = docs_pages.space_id) WHERE organization_id IS NULL;
UPDATE docs_page_drafts SET organization_id = (SELECT organization_id FROM docs_pages WHERE id = docs_page_drafts.page_id) WHERE organization_id IS NULL;
UPDATE docs_page_versions SET organization_id = (SELECT organization_id FROM docs_pages WHERE id = docs_page_versions.page_id) WHERE organization_id IS NULL;
UPDATE docs_comments SET organization_id = (SELECT organization_id FROM docs_pages WHERE id = docs_comments.page_id) WHERE organization_id IS NULL;
UPDATE docs_attachments SET organization_id = (SELECT organization_id FROM docs_pages WHERE id = docs_attachments.page_id) WHERE organization_id IS NULL;
UPDATE docs_page_links SET organization_id = (SELECT organization_id FROM docs_pages WHERE id = docs_page_links.source_page_id) WHERE organization_id IS NULL;
UPDATE docs_page_projects SET organization_id = (SELECT organization_id FROM docs_pages WHERE id = docs_page_projects.page_id) WHERE organization_id IS NULL;
UPDATE docs_page_tags SET organization_id = (SELECT organization_id FROM docs_pages WHERE id = docs_page_tags.page_id) WHERE organization_id IS NULL;
UPDATE docs_repository_pages SET organization_id = (SELECT organization_id FROM docs_pages WHERE id = docs_repository_pages.page_id) WHERE organization_id IS NULL;

CREATE TABLE docs_spaces_098new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT DEFAULT '',
  icon TEXT DEFAULT 'folder',
  sort_order INTEGER DEFAULT 0,
  is_global INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(organization_id, name),
  UNIQUE(organization_id, slug)
);
INSERT INTO docs_spaces_098new SELECT id, organization_id, name, slug, description, icon, sort_order, is_global, created_at, updated_at FROM docs_spaces;
DROP TABLE docs_spaces;
ALTER TABLE docs_spaces_098new RENAME TO docs_spaces;

CREATE TABLE docs_templates_098new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  category TEXT DEFAULT 'general',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(organization_id, name)
);
INSERT INTO docs_templates_098new SELECT id, organization_id, name, description, content, category, created_at FROM docs_templates;
DROP TABLE docs_templates;
ALTER TABLE docs_templates_098new RENAME TO docs_templates;

CREATE TABLE docs_tags_098new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  UNIQUE(organization_id, name),
  UNIQUE(organization_id, slug)
);
INSERT INTO docs_tags_098new SELECT id, organization_id, name, slug FROM docs_tags;
DROP TABLE docs_tags;
ALTER TABLE docs_tags_098new RENAME TO docs_tags;

CREATE UNIQUE INDEX idx_docs_spaces_org_id ON docs_spaces(organization_id, id);
CREATE UNIQUE INDEX idx_docs_spaces_org_slug ON docs_spaces(organization_id, slug);
CREATE UNIQUE INDEX idx_docs_templates_org_id ON docs_templates(organization_id, id);
CREATE UNIQUE INDEX idx_docs_templates_org_name ON docs_templates(organization_id, name);
CREATE UNIQUE INDEX idx_docs_tags_org_id ON docs_tags(organization_id, id);
CREATE UNIQUE INDEX idx_docs_tags_org_slug ON docs_tags(organization_id, slug);
CREATE UNIQUE INDEX idx_docs_pages_org_id ON docs_pages(organization_id, id);
CREATE UNIQUE INDEX idx_docs_pages_org_space_id ON docs_pages(organization_id, space_id, id);
CREATE INDEX idx_docs_pages_org_space_slug ON docs_pages(organization_id, space_id, slug);

CREATE TRIGGER docs_spaces_org_required_insert BEFORE INSERT ON docs_spaces
WHEN NEW.organization_id IS NULL BEGIN SELECT RAISE(ABORT, 'docs space requires organization'); END;
CREATE TRIGGER docs_spaces_org_immutable BEFORE UPDATE OF organization_id ON docs_spaces
WHEN NEW.organization_id IS NOT OLD.organization_id BEGIN SELECT RAISE(ABORT, 'docs space organization is immutable'); END;
CREATE TRIGGER docs_templates_org_required_insert BEFORE INSERT ON docs_templates
WHEN NEW.organization_id IS NULL BEGIN SELECT RAISE(ABORT, 'docs template requires organization'); END;
CREATE TRIGGER docs_templates_org_immutable BEFORE UPDATE OF organization_id ON docs_templates
WHEN NEW.organization_id IS NOT OLD.organization_id BEGIN SELECT RAISE(ABORT, 'docs template organization is immutable'); END;
CREATE TRIGGER docs_tags_org_required_insert BEFORE INSERT ON docs_tags
WHEN NEW.organization_id IS NULL BEGIN SELECT RAISE(ABORT, 'docs tag requires organization'); END;
CREATE TRIGGER docs_tags_org_immutable BEFORE UPDATE OF organization_id ON docs_tags
WHEN NEW.organization_id IS NOT OLD.organization_id BEGIN SELECT RAISE(ABORT, 'docs tag organization is immutable'); END;
CREATE TRIGGER docs_pages_scope_insert BEFORE INSERT ON docs_pages
WHEN NEW.organization_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM docs_spaces WHERE id = NEW.space_id AND organization_id = NEW.organization_id
) OR (NEW.parent_page_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM docs_pages WHERE id = NEW.parent_page_id AND space_id = NEW.space_id AND organization_id = NEW.organization_id
)) BEGIN SELECT RAISE(ABORT, 'docs page scope must match its space and parent'); END;
CREATE TRIGGER docs_pages_scope_update BEFORE UPDATE OF organization_id, space_id, parent_page_id ON docs_pages
WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.space_id IS NOT OLD.space_id OR (
  NEW.parent_page_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM docs_pages WHERE id = NEW.parent_page_id AND space_id = NEW.space_id AND organization_id = NEW.organization_id
  )
) BEGIN SELECT RAISE(ABORT, 'docs page scope is immutable'); END;

CREATE TRIGGER docs_drafts_scope_insert BEFORE INSERT ON docs_page_drafts
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM docs_pages WHERE id = NEW.page_id AND organization_id = NEW.organization_id)
BEGIN SELECT RAISE(ABORT, 'docs draft scope must match page'); END;
CREATE TRIGGER docs_drafts_scope_update BEFORE UPDATE OF organization_id, page_id ON docs_page_drafts
WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.page_id IS NOT OLD.page_id
BEGIN SELECT RAISE(ABORT, 'docs draft scope is immutable'); END;
CREATE TRIGGER docs_versions_scope_insert BEFORE INSERT ON docs_page_versions
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM docs_pages WHERE id = NEW.page_id AND organization_id = NEW.organization_id)
BEGIN SELECT RAISE(ABORT, 'docs version scope must match page'); END;
CREATE TRIGGER docs_versions_scope_update BEFORE UPDATE OF organization_id, page_id ON docs_page_versions
WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.page_id IS NOT OLD.page_id
BEGIN SELECT RAISE(ABORT, 'docs version scope is immutable'); END;
CREATE TRIGGER docs_comments_scope_insert BEFORE INSERT ON docs_comments
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM docs_pages WHERE id = NEW.page_id AND organization_id = NEW.organization_id)
  OR (NEW.parent_comment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM docs_comments WHERE id = NEW.parent_comment_id AND page_id = NEW.page_id AND organization_id = NEW.organization_id))
BEGIN SELECT RAISE(ABORT, 'docs comment scope must match page and parent'); END;
CREATE TRIGGER docs_comments_scope_update BEFORE UPDATE OF organization_id, page_id, parent_comment_id ON docs_comments
WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.page_id IS NOT OLD.page_id
  OR (NEW.parent_comment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM docs_comments WHERE id = NEW.parent_comment_id AND page_id = NEW.page_id AND organization_id = NEW.organization_id))
BEGIN SELECT RAISE(ABORT, 'docs comment scope is immutable'); END;
CREATE TRIGGER docs_attachments_scope_insert BEFORE INSERT ON docs_attachments
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM docs_pages WHERE id = NEW.page_id AND organization_id = NEW.organization_id)
BEGIN SELECT RAISE(ABORT, 'docs attachment scope must match page'); END;
CREATE TRIGGER docs_attachments_scope_update BEFORE UPDATE OF organization_id, page_id ON docs_attachments
WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.page_id IS NOT OLD.page_id
BEGIN SELECT RAISE(ABORT, 'docs attachment scope is immutable'); END;
CREATE TRIGGER docs_page_links_scope_insert BEFORE INSERT ON docs_page_links
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM docs_pages WHERE id = NEW.source_page_id AND organization_id = NEW.organization_id)
  OR NOT EXISTS (SELECT 1 FROM docs_pages WHERE id = NEW.target_page_id AND organization_id = NEW.organization_id)
BEGIN SELECT RAISE(ABORT, 'docs link endpoints must share organization'); END;
CREATE TRIGGER docs_page_links_scope_update BEFORE UPDATE OF organization_id, source_page_id, target_page_id ON docs_page_links
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM docs_pages WHERE id = NEW.source_page_id AND organization_id = NEW.organization_id)
  OR NOT EXISTS (SELECT 1 FROM docs_pages WHERE id = NEW.target_page_id AND organization_id = NEW.organization_id)
BEGIN SELECT RAISE(ABORT, 'docs link endpoints must share organization'); END;
CREATE TRIGGER docs_page_projects_scope_insert BEFORE INSERT ON docs_page_projects
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM docs_pages WHERE id = NEW.page_id AND organization_id = NEW.organization_id)
  OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id)
BEGIN SELECT RAISE(ABORT, 'docs project link must share organization'); END;
CREATE TRIGGER docs_page_projects_scope_update BEFORE UPDATE OF organization_id, page_id, project_id ON docs_page_projects
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM docs_pages WHERE id = NEW.page_id AND organization_id = NEW.organization_id)
  OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id)
BEGIN SELECT RAISE(ABORT, 'docs project link must share organization'); END;
CREATE TRIGGER docs_page_tags_scope_insert BEFORE INSERT ON docs_page_tags
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM docs_pages WHERE id = NEW.page_id AND organization_id = NEW.organization_id)
  OR NOT EXISTS (SELECT 1 FROM docs_tags WHERE id = NEW.tag_id AND organization_id = NEW.organization_id)
BEGIN SELECT RAISE(ABORT, 'docs page tag must share organization'); END;
CREATE TRIGGER docs_page_tags_scope_update BEFORE UPDATE OF organization_id, page_id, tag_id ON docs_page_tags
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM docs_pages WHERE id = NEW.page_id AND organization_id = NEW.organization_id)
  OR NOT EXISTS (SELECT 1 FROM docs_tags WHERE id = NEW.tag_id AND organization_id = NEW.organization_id)
BEGIN SELECT RAISE(ABORT, 'docs page tag must share organization'); END;
CREATE TRIGGER docs_repository_pages_scope_insert BEFORE INSERT ON docs_repository_pages
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM docs_pages WHERE id = NEW.page_id AND organization_id = NEW.organization_id)
  OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id)
BEGIN SELECT RAISE(ABORT, 'repository docs scope mismatch'); END;
CREATE TRIGGER docs_repository_pages_scope_update BEFORE UPDATE OF organization_id, page_id, project_id ON docs_repository_pages
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM docs_pages WHERE id = NEW.page_id AND organization_id = NEW.organization_id)
  OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id)
BEGIN SELECT RAISE(ABORT, 'repository docs scope mismatch'); END;

INSERT INTO docs_spaces (organization_id, name, slug, description, icon, is_global, created_at, updated_at)
SELECT organization.id,
       CASE WHEN organization.id = '00000000-0000-4000-8000-000000000093' THEN 'Organization' ELSE 'Organization ' || substr(organization.id, 1, 8) END,
       CASE WHEN organization.id = '00000000-0000-4000-8000-000000000093' THEN 'organization' ELSE 'organization-' || substr(organization.id, 1, 8) END,
       'Organization documentation', 'folder', 0, datetime('now'), datetime('now')
FROM organizations organization
WHERE NOT EXISTS (SELECT 1 FROM docs_spaces space WHERE space.organization_id = organization.id);

ALTER TABLE rag_sources ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE rag_sources ADD COLUMN visibility TEXT NOT NULL DEFAULT 'project' CHECK(visibility IN ('organization', 'project', 'restricted'));
ALTER TABLE rag_sources ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
UPDATE rag_sources SET organization_id = (SELECT organization_id FROM projects WHERE id = rag_sources.project_id)
WHERE organization_id IS NULL AND NOT EXISTS (SELECT 1 FROM context_checkpoint_rag_sources WHERE rag_source_id = rag_sources.id);
UPDATE rag_sources SET visibility = 'organization'
WHERE (id IN (SELECT rag_source_id FROM docs_repository_pages WHERE rag_source_id IS NOT NULL)
   OR json_extract(metadata, '$.kind') = 'docs_page')
  AND NOT EXISTS (SELECT 1 FROM context_checkpoint_rag_sources WHERE rag_source_id = rag_sources.id)
  AND NOT EXISTS (SELECT 1 FROM context_rag_uploads WHERE rag_source_id = rag_sources.id);
DROP TRIGGER rag_sources_context_checkpoint_immutable_update;
UPDATE rag_sources SET organization_id = (SELECT organization_id FROM projects WHERE id = rag_sources.project_id) WHERE organization_id IS NULL;
UPDATE rag_sources
SET visibility = 'restricted', owner_user_id = (SELECT owner_user_id FROM bootstrap_state WHERE singleton = 1)
WHERE id IN (SELECT rag_source_id FROM context_rag_uploads)
   OR id IN (SELECT rag_source_id FROM context_checkpoint_rag_sources);
CREATE TRIGGER rag_sources_context_checkpoint_immutable_update BEFORE UPDATE ON rag_sources
WHEN EXISTS (SELECT 1 FROM context_checkpoint_rag_sources link WHERE link.project_id = OLD.project_id AND link.rag_source_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'checkpoint RAG sources are immutable — UPDATE rejected'); END;
CREATE UNIQUE INDEX idx_rag_sources_scope_id ON rag_sources(organization_id, project_id, id);
CREATE INDEX idx_rag_sources_visibility ON rag_sources(organization_id, visibility, project_id, owner_user_id, updated_at DESC);
CREATE TRIGGER rag_sources_scope_insert BEFORE INSERT ON rag_sources
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id)
  OR (NEW.visibility = 'restricted') <> (NEW.owner_user_id IS NOT NULL)
  OR (NEW.owner_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.owner_user_id AND status = 'active'))
BEGIN SELECT RAISE(ABORT, 'invalid RAG source scope'); END;
CREATE TRIGGER rag_sources_scope_immutable BEFORE UPDATE OF organization_id, project_id, visibility, owner_user_id ON rag_sources
WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.project_id IS NOT OLD.project_id
  OR NEW.visibility IS NOT OLD.visibility OR NEW.owner_user_id IS NOT OLD.owner_user_id
BEGIN SELECT RAISE(ABORT, 'RAG source scope is immutable'); END;

ALTER TABLE context_rag_upload_sessions ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE context_rag_upload_sessions ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE context_rag_upload_sessions ADD COLUMN visibility TEXT NOT NULL DEFAULT 'project' CHECK(visibility IN ('organization', 'project', 'restricted'));
UPDATE context_rag_upload_sessions SET organization_id = (SELECT organization_id FROM projects WHERE id = context_rag_upload_sessions.project_id) WHERE organization_id IS NULL;
UPDATE context_rag_upload_sessions
SET visibility = 'restricted', owner_user_id = (SELECT owner_user_id FROM bootstrap_state WHERE singleton = 1);
CREATE INDEX idx_context_rag_sessions_scope ON context_rag_upload_sessions(organization_id, project_id, visibility, owner_user_id, status, created_at DESC);
CREATE TRIGGER context_rag_sessions_scope_insert BEFORE INSERT ON context_rag_upload_sessions
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id)
  OR (NEW.visibility = 'restricted') <> (NEW.owner_user_id IS NOT NULL)
  OR (NEW.owner_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.owner_user_id AND status = 'active'))
BEGIN SELECT RAISE(ABORT, 'invalid context RAG upload scope'); END;
CREATE TRIGGER context_rag_sessions_scope_immutable BEFORE UPDATE OF organization_id, project_id, visibility, owner_user_id ON context_rag_upload_sessions
WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.project_id IS NOT OLD.project_id
  OR NEW.visibility IS NOT OLD.visibility OR NEW.owner_user_id IS NOT OLD.owner_user_id
BEGIN SELECT RAISE(ABORT, 'context RAG upload scope is immutable'); END;

ALTER TABLE context_conversations ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE context_conversations ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE context_conversations ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private', 'organization', 'project'));
DROP TRIGGER context_conversations_immutable_update;
UPDATE context_conversations SET organization_id = (SELECT organization_id FROM projects WHERE id = context_conversations.project_id) WHERE organization_id IS NULL;
UPDATE context_conversations SET owner_user_id = (SELECT owner_user_id FROM bootstrap_state WHERE singleton = 1) WHERE owner_user_id IS NULL;
CREATE UNIQUE INDEX idx_context_conversations_scope_id ON context_conversations(organization_id, project_id, id);
CREATE INDEX idx_context_conversations_visibility ON context_conversations(organization_id, owner_user_id, visibility, created_at DESC, id DESC);
CREATE TRIGGER context_conversations_immutable_update BEFORE UPDATE ON context_conversations
BEGIN SELECT RAISE(ABORT, 'context_conversations rows are immutable — UPDATE rejected'); END;
CREATE TRIGGER context_conversations_scope_insert BEFORE INSERT ON context_conversations
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id)
  OR (NEW.visibility = 'private' AND NEW.owner_user_id IS NULL)
  OR (NEW.owner_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.owner_user_id AND status = 'active'))
BEGIN SELECT RAISE(ABORT, 'invalid context conversation scope'); END;
CREATE TRIGGER context_checkpoint_rag_scope_insert BEFORE INSERT ON context_checkpoint_rag_sources
WHEN NOT EXISTS (
  SELECT 1 FROM context_checkpoints checkpoint
  JOIN context_conversations conversation ON conversation.project_id = checkpoint.project_id AND conversation.id = checkpoint.conversation_id
  JOIN rag_sources source ON source.id = NEW.rag_source_id
  WHERE checkpoint.project_id = NEW.project_id AND checkpoint.id = NEW.checkpoint_id
    AND source.organization_id = conversation.organization_id
    AND ((conversation.visibility = 'private' AND source.visibility = 'restricted' AND source.owner_user_id = conversation.owner_user_id)
      OR (conversation.visibility = 'organization' AND source.visibility = 'organization')
      OR (conversation.visibility = 'project' AND source.visibility = 'project' AND source.project_id = conversation.project_id))
)
BEGIN SELECT RAISE(ABORT, 'checkpoint RAG source scope mismatch'); END;

CREATE TABLE content_shares (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('context_conversation', 'rag_source')),
  resource_id TEXT NOT NULL CHECK(length(resource_id) BETWEEN 1 AND 256),
  grantee_kind TEXT NOT NULL CHECK(grantee_kind IN ('user', 'organization', 'project')),
  grantee_id TEXT NOT NULL CHECK(length(grantee_id) BETWEEN 1 AND 128),
  permission TEXT NOT NULL CHECK(permission IN ('read', 'write')),
  granted_by_actor_type TEXT NOT NULL CHECK(granted_by_actor_type IN ('compatibility', 'user', 'service', 'system')),
  granted_by_actor_id TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(organization_id, resource_type, resource_id, grantee_kind, grantee_id, permission)
);
CREATE INDEX idx_content_shares_lookup ON content_shares(organization_id, resource_type, resource_id, grantee_kind, grantee_id, revoked_at);
CREATE TRIGGER content_shares_immutable_update BEFORE UPDATE OF organization_id, resource_type, resource_id, grantee_kind, grantee_id, permission ON content_shares
BEGIN SELECT RAISE(ABORT, 'content share identity is immutable'); END;

ALTER TABLE observations ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE observations ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE observations ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private', 'organization'));
UPDATE observations SET organization_id = (SELECT organization_id FROM projects WHERE id = observations.project_id) WHERE organization_id IS NULL;
UPDATE observations SET owner_user_id = (SELECT owner_user_id FROM bootstrap_state WHERE singleton = 1) WHERE owner_user_id IS NULL;
CREATE INDEX idx_observations_scope ON observations(organization_id, owner_user_id, visibility, project_id, status);
CREATE TRIGGER observations_scope_insert BEFORE INSERT ON observations
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id)
  OR (NEW.visibility = 'private') <> (NEW.owner_user_id IS NOT NULL)
  OR (NEW.owner_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.owner_user_id AND status = 'active'))
BEGIN SELECT RAISE(ABORT, 'invalid observation scope'); END;
CREATE TRIGGER observations_scope_immutable BEFORE UPDATE OF organization_id, owner_user_id, visibility ON observations
WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.visibility IS NOT OLD.visibility
BEGIN SELECT RAISE(ABORT, 'observation scope is immutable'); END;

ALTER TABLE personality_traits ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE personality_traits ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE personality_traits ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private', 'organization'));
UPDATE personality_traits SET organization_id = (SELECT organization_id FROM projects WHERE id = personality_traits.project_id) WHERE organization_id IS NULL;
UPDATE personality_traits SET owner_user_id = (SELECT owner_user_id FROM bootstrap_state WHERE singleton = 1) WHERE owner_user_id IS NULL;
CREATE INDEX idx_personality_scope ON personality_traits(organization_id, owner_user_id, visibility, project_id, is_active);
CREATE TRIGGER personality_scope_insert BEFORE INSERT ON personality_traits
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id)
  OR (NEW.visibility = 'private') <> (NEW.owner_user_id IS NOT NULL)
  OR (NEW.owner_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.owner_user_id AND status = 'active'))
  OR (NEW.exemplar_observation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM observations WHERE id = NEW.exemplar_observation_id AND organization_id = NEW.organization_id
      AND visibility = NEW.visibility AND owner_user_id IS NEW.owner_user_id
  ))
BEGIN SELECT RAISE(ABORT, 'invalid personality scope'); END;
CREATE TRIGGER personality_scope_immutable BEFORE UPDATE OF organization_id, owner_user_id, visibility ON personality_traits
WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.visibility IS NOT OLD.visibility
BEGIN SELECT RAISE(ABORT, 'personality scope is immutable'); END;

ALTER TABLE pipeline_events ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE pipeline_events ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE pipeline_events ADD COLUMN visibility TEXT NOT NULL DEFAULT 'organization' CHECK(visibility IN ('private', 'organization'));
UPDATE pipeline_events SET organization_id = (SELECT organization_id FROM projects WHERE id = pipeline_events.project_id) WHERE organization_id IS NULL;
CREATE INDEX idx_pipeline_events_scope ON pipeline_events(organization_id, owner_user_id, visibility, project_id, created_at DESC);
CREATE TRIGGER pipeline_events_scope_insert BEFORE INSERT ON pipeline_events
WHEN NEW.organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id)
  OR (NEW.visibility = 'private') <> (NEW.owner_user_id IS NOT NULL)
  OR (NEW.owner_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = NEW.organization_id AND user_id = NEW.owner_user_id AND status = 'active'))
  OR length(CAST(COALESCE(NEW.title, '') AS BLOB)) > 256
  OR length(CAST(COALESCE(NEW.description, '') AS BLOB)) > 1024
  OR length(CAST(COALESCE(NEW.data, '') AS BLOB)) > 4096
BEGIN SELECT RAISE(ABORT, 'invalid or unbounded pipeline event scope'); END;

CREATE TABLE content_audit_events (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT,
  owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('docs_space', 'docs_page', 'context_conversation', 'context_checkpoint', 'rag_source', 'observation', 'personality_trait')),
  resource_id TEXT CHECK(resource_id IS NULL OR length(resource_id) BETWEEN 1 AND 256),
  action TEXT NOT NULL CHECK(action IN ('share', 'unshare', 'archive', 'unarchive', 'restore', 'export', 'delete')),
  actor_type TEXT NOT NULL CHECK(actor_type IN ('compatibility', 'user', 'service', 'system')),
  actor_id TEXT,
  outcome TEXT NOT NULL CHECK(outcome IN ('success', 'denied', 'failure')),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_content_audit_scope ON content_audit_events(organization_id, owner_user_id, resource_type, resource_id, created_at DESC);
CREATE TRIGGER content_audit_immutable_update BEFORE UPDATE ON content_audit_events BEGIN SELECT RAISE(ABORT, 'content audit events are immutable'); END;
CREATE TRIGGER content_audit_immutable_delete BEFORE DELETE ON content_audit_events BEGIN SELECT RAISE(ABORT, 'content audit events are immutable'); END;

CREATE TABLE content_tenancy_manifests (
  migration INTEGER PRIMARY KEY CHECK(migration = 98),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  counts_json TEXT NOT NULL CHECK(json_valid(counts_json) AND json_type(counts_json) = 'object'),
  identities_json TEXT NOT NULL CHECK(json_valid(identities_json) AND json_type(identities_json) = 'array'),
  phase TEXT NOT NULL CHECK(phase = 'verified'),
  created_at TEXT NOT NULL
);
INSERT INTO content_tenancy_manifests (migration, organization_id, counts_json, identities_json, phase, created_at)
SELECT 98, '00000000-0000-4000-8000-000000000093',
  json_object('spaces', (SELECT count(*) FROM docs_spaces), 'pages', (SELECT count(*) FROM docs_pages),
    'rag_sources', (SELECT count(*) FROM rag_sources), 'conversations', (SELECT count(*) FROM context_conversations),
    'messages', (SELECT count(*) FROM context_messages), 'checkpoints', (SELECT count(*) FROM context_checkpoints),
    'observations', (SELECT count(*) FROM observations), 'traits', (SELECT count(*) FROM personality_traits)),
  COALESCE((SELECT json_group_array(identity) FROM (
    SELECT 'docs_page:' || id || ':' || revision || ':' || length(CAST(content AS BLOB)) AS identity FROM docs_pages
    UNION ALL SELECT 'rag_source:' || id || ':' || COALESCE(source_hash, '') FROM rag_sources
    UNION ALL SELECT 'conversation:' || id || ':' || request_hash FROM context_conversations
    UNION ALL SELECT 'message:' || id || ':' || sequence || ':' || content_hash FROM context_messages
    UNION ALL SELECT 'checkpoint:' || id || ':' || sequence || ':' || state_hash FROM context_checkpoints
    ORDER BY identity
  )), '[]'), 'verified', datetime('now');
CREATE TRIGGER content_tenancy_manifests_immutable_update BEFORE UPDATE ON content_tenancy_manifests BEGIN SELECT RAISE(ABORT, 'content tenancy manifests are immutable'); END;
CREATE TRIGGER content_tenancy_manifests_immutable_delete BEFORE DELETE ON content_tenancy_manifests BEGIN SELECT RAISE(ABORT, 'content tenancy manifests are immutable'); END;

COMMIT;
PRAGMA foreign_keys = ON;
