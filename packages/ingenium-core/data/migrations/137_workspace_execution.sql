-- Tail ONLY. installWorkspaceExecution137 owns the original-connection transaction.
-- v1 rows keep schema_version=1; fresh workspace scope explicitly opts into v2.
CREATE TRIGGER v137_workspace_scope BEFORE INSERT ON authorized_workspaces
WHEN NEW.project_id IS NULL AND NOT EXISTS(
 SELECT 1 FROM organization_memberships m JOIN users u ON u.id=m.user_id
 WHERE m.organization_id=NEW.organization_id AND m.user_id=NEW.owner_user_id AND m.status='active'
)
BEGIN SELECT RAISE(ABORT,'workspace execution owner unavailable'); END;
CREATE TRIGGER v137_runtime_scope BEFORE INSERT ON runtime_instances
WHEN NEW.project_id IS NULL AND NOT EXISTS(
 SELECT 1 FROM authorized_workspaces w WHERE w.id=NEW.workspace_id AND w.schema_version=2
 AND w.project_id IS NULL AND w.organization_id=NEW.organization_id AND w.owner_user_id=NEW.owner_user_id
 AND w.status='authorized' AND w.security_epoch=NEW.security_epoch
)
BEGIN SELECT RAISE(ABORT,'workspace runtime owner unavailable'); END;
CREATE TRIGGER v137_credential_scope BEFORE INSERT ON mcp_credentials
WHEN NEW.project_id IS NULL AND NOT EXISTS(
 SELECT 1 FROM authorized_workspaces w WHERE w.id=NEW.workspace_id AND w.schema_version=2 AND w.project_id IS NULL
 AND w.organization_id=NEW.organization_id AND w.owner_user_id=NEW.created_by_user_id
 AND w.status='authorized' AND w.security_epoch=NEW.security_epoch AND w.storage_path=NEW.launcher_worktree
 AND NEW.kind='runtime' AND NEW.audience='runtime' AND json_array_length(NEW.project_grants_json)=0
)
BEGIN SELECT RAISE(ABORT,'workspace runtime credential scope unavailable'); END;
CREATE TRIGGER v137_capability_scope BEFORE INSERT ON runtime_capability_bindings
WHEN NEW.project_id IS NULL AND NOT EXISTS(
 SELECT 1 FROM runtime_instances r JOIN mcp_credentials c ON c.id=NEW.mcp_credential_id
 WHERE r.id=NEW.runtime_id AND r.schema_version=2 AND c.schema_version=2
 AND r.project_id IS NULL AND c.project_id IS NULL AND r.workspace_id=NEW.workspace_id
 AND r.organization_id=NEW.organization_id AND r.owner_user_id=NEW.owner_user_id
 AND r.security_epoch=NEW.security_epoch AND c.workspace_id=r.workspace_id
)
BEGIN SELECT RAISE(ABORT,'workspace runtime capability unavailable'); END;
CREATE TRIGGER v137_launch_scope BEFORE INSERT ON runtime_launch_tickets
WHEN NEW.project_id IS NULL AND NOT EXISTS(
 SELECT 1 FROM runtime_instances r WHERE r.id=NEW.runtime_id AND r.schema_version=2 AND r.project_id IS NULL
 AND r.organization_id=NEW.organization_id AND r.owner_user_id=NEW.owner_user_id
)
BEGIN SELECT RAISE(ABORT,'workspace runtime launch unavailable'); END;
CREATE TRIGGER v137_original_scope BEFORE INSERT ON runtime_original_provisions
WHEN NEW.project_id IS NULL AND NOT EXISTS(
 SELECT 1 FROM runtime_instances r WHERE r.id=NEW.runtime_id AND r.schema_version=2 AND r.project_id IS NULL
 AND r.workspace_id=NEW.workspace_id AND r.organization_id=NEW.organization_id AND r.owner_user_id=NEW.owner_user_id
)
BEGIN SELECT RAISE(ABORT,'workspace original producer unavailable'); END;
CREATE TRIGGER v137_context_original_scope BEFORE INSERT ON context_conversations
WHEN NEW.project_id IS NULL AND NOT EXISTS(
 SELECT 1 FROM runtime_original_provisions o JOIN runtime_instances r ON r.id=o.runtime_id
 WHERE o.schema_version=2 AND o.project_id IS NULL AND r.schema_version=2 AND r.project_id IS NULL
 AND o.runtime_id=NEW.runtime_id AND o.workspace_id=NEW.workspace_id AND o.organization_id=NEW.organization_id
 AND o.owner_user_id=NEW.owner_user_id AND o.binding_hash=NEW.binding_hash AND o.binding_epoch=NEW.binding_epoch
 AND o.start_identity=NEW.execution_generation AND o.parent_container_id=r.backend_container_id
 AND r.security_epoch=NEW.binding_epoch AND r.state IN ('READY','IDLE')
)
BEGIN SELECT RAISE(ABORT,'workspace original execution generation unavailable'); END;

CREATE TRIGGER v137_runtime_browser_launch_tickets_scope BEFORE INSERT ON runtime_browser_launch_tickets
WHEN NEW.project_id IS NULL AND NOT EXISTS(
 SELECT 1 FROM runtime_instances r JOIN authorized_workspaces w ON w.id=r.workspace_id
 JOIN auth_sessions a ON a.id=NEW.auth_session_id JOIN users u ON u.id=a.user_id
 WHERE r.id=NEW.runtime_id AND r.schema_version=2 AND r.project_id IS NULL
 AND r.workspace_id=NEW.workspace_id AND r.organization_id=NEW.organization_id AND r.owner_user_id=NEW.owner_user_id
 AND w.schema_version=2 AND w.project_id IS NULL AND w.status='authorized' AND w.security_epoch=r.security_epoch
 AND w.organization_id=r.organization_id AND w.owner_user_id=r.owner_user_id AND r.state IN ('READY','IDLE')
 AND a.user_id=NEW.owner_user_id AND a.revoked_at IS NULL AND a.security_epoch=u.security_epoch
 AND julianday(a.idle_expires_at)>julianday('now') AND julianday(a.absolute_expires_at)>julianday('now')
)
BEGIN SELECT RAISE(ABORT,'workspace browser authentication unavailable'); END;

CREATE TRIGGER v137_runtime_browser_sessions_scope BEFORE INSERT ON runtime_browser_sessions
WHEN NEW.project_id IS NULL AND NOT EXISTS(
 SELECT 1 FROM runtime_instances r JOIN authorized_workspaces w ON w.id=r.workspace_id
 JOIN auth_sessions a ON a.id=NEW.auth_session_id JOIN users u ON u.id=a.user_id
 WHERE r.id=NEW.runtime_id AND r.schema_version=2 AND r.project_id IS NULL
 AND r.workspace_id=NEW.workspace_id AND r.organization_id=NEW.organization_id AND r.owner_user_id=NEW.owner_user_id
 AND w.schema_version=2 AND w.project_id IS NULL AND w.status='authorized' AND w.security_epoch=r.security_epoch
 AND w.organization_id=r.organization_id AND w.owner_user_id=r.owner_user_id AND r.state IN ('READY','IDLE')
 AND a.user_id=NEW.owner_user_id AND a.revoked_at IS NULL AND a.security_epoch=u.security_epoch
 AND julianday(a.idle_expires_at)>julianday('now') AND julianday(a.absolute_expires_at)>julianday('now')
)
BEGIN SELECT RAISE(ABORT,'workspace browser authentication unavailable'); END;
