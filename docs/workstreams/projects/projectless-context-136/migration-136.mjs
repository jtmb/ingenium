import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {installEvolution,replaceExactly,addColumnsAndConstraints} from './migration-rebuild.mjs';
const nullable=sql=>replaceExactly(sql,'project_id TEXT NOT NULL','project_id TEXT');
const fk=(column,parent)=>`FOREIGN KEY(${column}) REFERENCES ${parent}(id) ON DELETE RESTRICT`;
const parentTail=`scope_kind TEXT NOT NULL DEFAULT 'project' CHECK(scope_kind IN ('project','workspace')),
 workspace_id TEXT REFERENCES authorized_workspaces(id) ON DELETE RESTRICT,
 runtime_id TEXT REFERENCES runtime_instances(id) ON DELETE RESTRICT,
 binding_hash TEXT,binding_epoch INTEGER,execution_generation TEXT,
 CHECK((project_id IS NOT NULL AND scope_kind='project' AND workspace_id IS NULL AND runtime_id IS NULL
 AND binding_hash IS NULL AND binding_epoch IS NULL AND execution_generation IS NULL) OR
 (project_id IS NULL AND scope_kind='workspace' AND visibility='private' AND organization_id IS NOT NULL
 AND owner_user_id IS NOT NULL AND workspace_id IS NOT NULL AND runtime_id IS NOT NULL
 AND binding_hash IS NOT NULL AND length(binding_hash)=64 AND binding_hash NOT GLOB '*[^0-9a-f]*'
 AND binding_epoch IS NOT NULL AND binding_epoch>=0 AND execution_generation IS NOT NULL
 AND length(execution_generation)=64 AND execution_generation NOT GLOB '*[^0-9a-f]*'))`;
const child=(name,extra='')=>({name,evolve:sql=>addColumnsAndConstraints(nullable(sql),fk('conversation_id','context_conversations')+(extra?',\n'+extra:''))});
const tables=[
 {name:'context_conversations',evolve:sql=>addColumnsAndConstraints(nullable(sql),parentTail)},
 child('context_messages'),
 child('context_checkpoints',fk('through_message_id','context_messages')),
 child('context_checkpoint_maintenance_authorizations',fk('checkpoint_id','context_checkpoints')),
 child('context_checkpoint_audit_events',[fk('checkpoint_id','context_checkpoints'),fk('target_conversation_id','context_conversations'),fk('authorization_id','context_checkpoint_maintenance_authorizations')].join(',\n')),
 {name:'context_conversation_sources',evolve:sql=>addColumnsAndConstraints(replaceExactly(nullable(sql),'CHECK(entry_count >= 1)',"CHECK((project_id IS NOT NULL AND entry_count >= 1) OR (project_id IS NULL AND entry_count >= 0))"),`${fk('conversation_id','context_conversations')},
 workspace_id TEXT REFERENCES authorized_workspaces(id) ON DELETE RESTRICT,
 runtime_id TEXT REFERENCES runtime_instances(id) ON DELETE RESTRICT,execution_generation TEXT,
 CHECK((project_id IS NOT NULL AND workspace_id IS NULL AND runtime_id IS NULL AND execution_generation IS NULL) OR
 (project_id IS NULL AND workspace_id IS NOT NULL AND runtime_id IS NOT NULL AND execution_generation IS NOT NULL AND source_session_id IS NOT NULL))`)},
 child('context_conversation_source_messages',[fk('source_id','context_conversation_sources'),fk('message_id','context_messages')].join(',\n')),
];
const edits={context_conversations_scope_insert:sql=>replaceExactly(replaceExactly(sql,
 'WHEN NEW.organization_id IS NULL OR', 'WHEN NEW.project_id IS NOT NULL AND (NEW.organization_id IS NULL OR'),
 "\nBEGIN SELECT RAISE", ")\nBEGIN SELECT RAISE")};
// Direct ID FKs provide existence; these triggers supply the null-safe scope/relationship checks
// that the retained legacy composite FKs cannot provide when project_id is NULL.
const relation=(table,condition)=>`CREATE TRIGGER v136_${table}_scope BEFORE INSERT ON ${table}
 WHEN NEW.project_id IS NULL AND NOT (${condition})
 BEGIN SELECT RAISE(ABORT,'workspace Context relationship unavailable'); END;\n`;
const parent=`EXISTS(SELECT 1 FROM context_conversations c WHERE c.id=NEW.conversation_id AND c.project_id IS NULL AND c.scope_kind='workspace')`;
let guards='';
guards+=relation('context_messages',parent);
guards+=relation('context_checkpoints',`${parent} AND EXISTS(SELECT 1 FROM context_messages m WHERE m.id=NEW.through_message_id AND m.project_id IS NULL AND m.conversation_id=NEW.conversation_id AND m.sequence=NEW.message_count-1)`);
guards+=relation('context_checkpoint_maintenance_authorizations',`${parent} AND EXISTS(SELECT 1 FROM context_conversations c WHERE c.id=NEW.conversation_id AND c.organization_id=NEW.organization_id AND NEW.actor_type='user' AND NEW.actor_id=c.owner_user_id AND NEW.delegator_actor_type IS NULL AND NEW.delegator_actor_id IS NULL) AND (NEW.checkpoint_id IS NULL OR EXISTS(SELECT 1 FROM context_checkpoints p WHERE p.id=NEW.checkpoint_id AND p.project_id IS NULL AND p.conversation_id=NEW.conversation_id))`);
guards+=relation('context_checkpoint_audit_events',`${parent} AND EXISTS(SELECT 1 FROM context_checkpoint_maintenance_authorizations a JOIN context_conversations c ON c.id=a.conversation_id WHERE a.id=NEW.authorization_id AND a.project_id IS NULL AND a.conversation_id=NEW.conversation_id AND a.organization_id=NEW.organization_id AND a.actor_type=NEW.source_actor_type AND a.actor_id=NEW.source_actor_id AND a.expected_revision=NEW.expected_revision AND a.checkpoint_id IS NEW.checkpoint_id AND a.consumed_at IS NOT NULL AND a.operation=CASE NEW.event_type WHEN 'conversation_archived' THEN 'archive_conversation' WHEN 'conversation_unarchived' THEN 'unarchive_conversation' WHEN 'checkpoint_restored_as_new' THEN 'restore_checkpoint' END AND NEW.delegator_actor_type IS NULL AND NEW.delegator_actor_id IS NULL) AND (NEW.target_conversation_id IS NULL OR EXISTS(SELECT 1 FROM context_conversations t JOIN context_conversations c ON c.id=NEW.conversation_id WHERE t.id=NEW.target_conversation_id AND t.project_id IS NULL AND t.organization_id=c.organization_id AND t.owner_user_id=c.owner_user_id AND t.workspace_id=c.workspace_id)) AND (NEW.checkpoint_id IS NULL OR EXISTS(SELECT 1 FROM context_checkpoints p WHERE p.id=NEW.checkpoint_id AND p.project_id IS NULL AND p.conversation_id=NEW.conversation_id AND p.state_hash=NEW.checkpoint_state_hash))`);
guards+=relation('context_conversation_sources',`${parent} AND EXISTS(SELECT 1 FROM context_conversations c WHERE c.id=NEW.conversation_id AND c.workspace_id=NEW.workspace_id AND c.runtime_id=NEW.runtime_id AND c.execution_generation=NEW.execution_generation)`);
guards+=relation('context_conversation_source_messages',`${parent} AND EXISTS(SELECT 1 FROM context_conversation_sources s JOIN context_messages m ON m.id=NEW.message_id WHERE s.id=NEW.source_id AND s.project_id IS NULL AND s.conversation_id=NEW.conversation_id AND m.project_id IS NULL AND m.conversation_id=NEW.conversation_id AND m.role=NEW.role AND m.content_hash=NEW.content_hash AND m.sequence=NEW.sequence)`);
// Also reject attempts to attach an existing workspace-owned parent through a non-null project.
// Historical project-only rows are unchanged; every fresh row must have a null-safe matching parent.
for(const t of tables.filter(x=>x.name!=='context_conversations')) {
 guards+=`CREATE TRIGGER v136_${t.name}_project_parent BEFORE INSERT ON ${t.name}
 WHEN NOT EXISTS(SELECT 1 FROM context_conversations c WHERE c.id=NEW.conversation_id AND c.project_id IS NEW.project_id)
 BEGIN SELECT RAISE(ABORT,'Context parent scope mismatch'); END;\n`;
}
export function context136Spec() {
 const tailSql=readFileSync(new URL('./136_projectless_context.sql',import.meta.url),'utf8')+'\n'+guards;
 const recipeSha256=createHash('sha256').update(readFileSync(new URL(import.meta.url))).update(readFileSync(new URL('./migration-rebuild.mjs',import.meta.url))).update(tailSql).digest('hex');
 return {version:136,tables,triggerEdits:edits,tailSql,recipeSha256};
}
export const installContext136=db=>installEvolution(db,context136Spec());

export function hasVerifiedContext136(db) {
 if(!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='veyra_evolution_136'").get())return false;
 // Receipt branch is read-only and verifies recipe plus every owned DDL hash.
 installEvolution(db,context136Spec());return true;
}
