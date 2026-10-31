// Synthetic schema/rows ONLY. No deployed/live/user DB is opened.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {installContext136} from './migration-136.mjs';
import {installWorkspaceExecution137} from './migration-137.mjs';
const root=process.env.VEYRA_CORE_SOURCE??'/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/prd-ui-fixes/packages/ingenium-core';
const Database=createRequire(root+'/package.json')('better-sqlite3');
const hash=v=>createHash('sha256').update(v).digest('hex');
const ddl=name=>readFileSync(root+'/data/migrations/'+name,'utf8');
export function fixture({evolve=true}={}) {
 const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.function('sha256',hash);
 db.exec(`CREATE TABLE organizations(id TEXT PRIMARY KEY);CREATE TABLE users(id TEXT PRIMARY KEY,security_epoch INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE projects(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,archived_at TEXT);
 CREATE TABLE organization_memberships(organization_id TEXT,user_id TEXT,status TEXT);
 CREATE TABLE service_principals(id TEXT PRIMARY KEY,organization_id TEXT,status TEXT);
 CREATE TABLE auth_sessions(id TEXT PRIMARY KEY,user_id TEXT,security_epoch INTEGER,revoked_at TEXT,idle_expires_at TEXT,absolute_expires_at TEXT);
 CREATE TABLE rag_sources(id TEXT PRIMARY KEY,project_id TEXT,organization_id TEXT,visibility TEXT,owner_user_id TEXT);
 CREATE TABLE content_shares(id TEXT PRIMARY KEY,resource_type TEXT,resource_id TEXT);`);
 for(const name of ['063_immutable_context_conversations.sql','066_context_checkpoint_governance.sql','069_context_conversation_snapshot_imports.sql','100_mcp_credentials.sql','101_runtime_isolation.sql','102_runtime_browser_sessions.sql','109_runtime_workspace_supersession.sql','127_runtime_original_provisions.sql'])db.exec(ddl(name));
 const tenancy=ddl('098_content_tenancy.sql');
 for(const sql of tenancy.matchAll(/ALTER TABLE context_conversations ADD COLUMN[^;]+;/g))db.exec(sql[0]);
 const start=tenancy.indexOf('CREATE TRIGGER context_conversations_scope_insert');const end=tenancy.indexOf('CREATE TRIGGER context_checkpoint_rag_scope_insert',start);db.exec(tenancy.slice(start,end));
 for(const sql of ddl('099_automation_tenancy.sql').matchAll(/ALTER TABLE context_checkpoint_(?:maintenance_authorizations|audit_events) ADD COLUMN[^;]+;/g))db.exec(sql[0]);
 db.exec("INSERT INTO organizations VALUES('org');INSERT INTO users(id) VALUES('owner'),('other');INSERT INTO projects VALUES('project','org',NULL);INSERT INTO organization_memberships VALUES('org','owner','active'),('org','other','active');");
 db.prepare(`INSERT INTO context_conversations(rowid,id,project_id,title,request_hash,created_at,organization_id,owner_user_id,visibility) VALUES(41,'legacy','project','Legacy',?,?,'org','owner','private')`).run('a'.repeat(64),'2026-01-01T00:00:00.000Z');
 if(evolve){installContext136(db);installWorkspaceExecution137(db);}return db;
}
export function seedScope(db,{workspaceId='workspace',runtimeId='00000000-0000-4000-8000-000000000001',ownerUserId='owner',epoch=0}={}) {
 const storagePath='/synthetic-fixture/'+workspaceId,bindingHash=hash(workspaceId+'\0'+storagePath),generation=hash(runtimeId+'-fixture-start'),parent=hash(runtimeId+'-fixture-parent'),time='2026-01-01T00:00:00.000Z';
 db.prepare(`INSERT INTO authorized_workspaces(id,organization_id,project_id,owner_user_id,storage_path,storage_mapping_hash,security_epoch,created_at,updated_at,schema_version) VALUES(?,'org',NULL,?,?,?,?,?,?,2)`).run(workspaceId,ownerUserId,storagePath,bindingHash,epoch,time,time);
 db.prepare(`INSERT INTO runtime_instances(id,workspace_id,organization_id,project_id,owner_user_id,state,cpu_millis,memory_bytes,pids_limit,disk_bytes,process_limit,backend_name,security_epoch,created_at,updated_at,schema_version) VALUES(?,?,'org',NULL,?,'PROVISIONING',1000,1073741824,256,2147483648,128,?,?,?, ?,2)`).run(runtimeId,workspaceId,ownerUserId,'ingenium-runtime-'+runtimeId.replaceAll('-',''),epoch,time,time);
 // Explicit synthetic DB fixture. This is NOT a manager create/start/attach or placement proof.
 db.prepare(`INSERT INTO runtime_original_provisions(runtime_id,parent_container_id,daemon_id,host_id,image_id,start_identity,public_profile_sha256,spec_sha256,workspace_id,organization_id,project_id,owner_user_id,binding_hash,binding_epoch,provisioning_revision,request_id,request_sha256,cpu_millis,memory_bytes,pids_limit,disk_bytes,process_limit,container_created_at,created_at,schema_version)
 VALUES(?,?,'fixture-daemon',?,?,?, ?,?,?,'org',NULL,?,?,?,0,?,?,1000,1073741824,256,2147483648,128,?,?,2)`).run(runtimeId,parent,'docker-daemon:'+hash('veyra-docker-host-v1\0fixture-daemon'),'sha256:'+'a'.repeat(64),generation,'b'.repeat(64),'c'.repeat(64),workspaceId,ownerUserId,bindingHash,epoch,runtimeId,'d'.repeat(64),time,time);
 db.prepare("UPDATE runtime_instances SET state='READY',revision=revision+1,backend_container_id=? WHERE id=?").run(parent,runtimeId);
 return {projectId:null,organizationId:'org',ownerUserId,workspaceId,runtimeId,bindingHash,bindingEpoch:epoch,executionGeneration:generation};
}
