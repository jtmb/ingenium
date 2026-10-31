-- Tail executed ONLY by migration-136.mjs after guarded exact table rebuild.
-- No transaction wrapper: the original-connection owner supplies the one transaction.
CREATE UNIQUE INDEX v136_conversation_idem ON context_conversations(workspace_id,idempotency_key) WHERE project_id IS NULL;
CREATE INDEX v136_conversation_scope ON context_conversations(organization_id,owner_user_id,workspace_id,created_at,id) WHERE project_id IS NULL;
CREATE UNIQUE INDEX v136_message_seq ON context_messages(conversation_id,sequence) WHERE project_id IS NULL;
CREATE UNIQUE INDEX v136_message_idem ON context_messages(conversation_id,idempotency_key) WHERE project_id IS NULL;
CREATE UNIQUE INDEX v136_checkpoint_seq ON context_checkpoints(conversation_id,sequence) WHERE project_id IS NULL;
CREATE UNIQUE INDEX v136_checkpoint_idem ON context_checkpoints(conversation_id,idempotency_key) WHERE project_id IS NULL;
CREATE UNIQUE INDEX v136_authorization_confirmation ON context_checkpoint_maintenance_authorizations(conversation_id,confirmation_hash) WHERE project_id IS NULL;
CREATE UNIQUE INDEX v136_archive_seq ON context_checkpoint_audit_events(conversation_id,archive_sequence) WHERE project_id IS NULL;
CREATE UNIQUE INDEX v136_source_engine ON context_conversation_sources(workspace_id,runtime_id,execution_generation,source_session_id) WHERE project_id IS NULL;
CREATE UNIQUE INDEX v136_source_key ON context_conversation_sources(workspace_id,source_key) WHERE project_id IS NULL;
CREATE UNIQUE INDEX v136_source_conversation ON context_conversation_sources(conversation_id) WHERE project_id IS NULL;
CREATE UNIQUE INDEX v136_source_message_seq ON context_conversation_source_messages(source_id,sequence) WHERE project_id IS NULL;
CREATE UNIQUE INDEX v136_source_message_id ON context_conversation_source_messages(source_id,message_id) WHERE project_id IS NULL;
CREATE UNIQUE INDEX v136_source_fingerprint ON context_conversation_source_messages(source_id,source_fingerprint) WHERE project_id IS NULL;
CREATE TRIGGER v136_conversation_scope BEFORE INSERT ON context_conversations
WHEN NEW.project_id IS NULL AND NOT EXISTS (
 SELECT 1 FROM authorized_workspaces w JOIN runtime_instances r ON r.workspace_id=w.id
 JOIN organization_memberships m ON m.organization_id=w.organization_id AND m.user_id=w.owner_user_id
 WHERE w.id=NEW.workspace_id AND w.project_id IS NULL AND r.project_id IS NULL
 AND w.organization_id=NEW.organization_id AND r.organization_id=w.organization_id
 AND w.owner_user_id=NEW.owner_user_id AND r.owner_user_id=w.owner_user_id
 AND w.status='authorized' AND m.status='active' AND w.security_epoch=NEW.binding_epoch
 AND r.security_epoch=w.security_epoch AND w.storage_mapping_hash=NEW.binding_hash
 AND r.id=NEW.runtime_id AND r.state IN ('READY','IDLE')
)
BEGIN SELECT RAISE(ABORT,'workspace Context owner unavailable'); END;
CREATE TRIGGER v136_no_context_sharing BEFORE INSERT ON content_shares
WHEN NEW.resource_type='context_conversation' AND EXISTS(
 SELECT 1 FROM context_conversations WHERE id=NEW.resource_id AND project_id IS NULL
)
BEGIN SELECT RAISE(ABORT,'workspace Context is private'); END;
CREATE TRIGGER v136_source_update BEFORE UPDATE ON context_conversation_sources
WHEN OLD.project_id IS NULL AND (
 NEW.project_id IS NOT OLD.project_id OR NEW.id IS NOT OLD.id OR NEW.source_key IS NOT OLD.source_key
 OR NEW.source_session_id IS NOT OLD.source_session_id OR NEW.conversation_id IS NOT OLD.conversation_id
 OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.runtime_id IS NOT OLD.runtime_id
 OR NEW.execution_generation IS NOT OLD.execution_generation OR NEW.created_at IS NOT OLD.created_at
 OR NEW.entry_count<OLD.entry_count
)
BEGIN SELECT RAISE(ABORT,'workspace Context source identity immutable'); END;
CREATE TRIGGER v136_source_delete BEFORE DELETE ON context_conversation_sources WHEN OLD.project_id IS NULL
BEGIN SELECT RAISE(ABORT,'workspace Context source must survive'); END;
CREATE TRIGGER v136_authorization_update BEFORE UPDATE ON context_checkpoint_maintenance_authorizations
WHEN OLD.project_id IS NULL AND (
 NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.operation IS NOT OLD.operation
 OR NEW.conversation_id IS NOT OLD.conversation_id OR NEW.checkpoint_id IS NOT OLD.checkpoint_id
 OR NEW.expected_revision IS NOT OLD.expected_revision OR NEW.confirmation_hash IS NOT OLD.confirmation_hash
 OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_at IS NOT OLD.created_at
 OR NEW.organization_id IS NOT OLD.organization_id OR NEW.actor_type IS NOT OLD.actor_type
 OR NEW.actor_id IS NOT OLD.actor_id OR NEW.delegator_actor_type IS NOT OLD.delegator_actor_type
 OR NEW.delegator_actor_id IS NOT OLD.delegator_actor_id OR NEW.request_id IS NOT OLD.request_id
 OR NEW.correlation_id IS NOT OLD.correlation_id OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
)
BEGIN SELECT RAISE(ABORT,'workspace Context authorization consume once'); END;
CREATE TRIGGER v136_authorization_delete BEFORE DELETE ON context_checkpoint_maintenance_authorizations WHEN OLD.project_id IS NULL
BEGIN SELECT RAISE(ABORT,'workspace Context authorization must survive'); END;

CREATE TRIGGER v136_no_context_share_update BEFORE UPDATE ON content_shares
WHEN NEW.resource_type='context_conversation' AND EXISTS(SELECT 1 FROM context_conversations WHERE id=NEW.resource_id AND project_id IS NULL)
BEGIN SELECT RAISE(ABORT,'workspace Context is private'); END;
