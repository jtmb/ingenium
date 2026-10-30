import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createHostedGovernance, HostedRefusal, proposalReviewHash } from '../proposed/hosted-governance.ts';

export const schema = `
CREATE TABLE users(id TEXT PRIMARY KEY,security_epoch INTEGER NOT NULL,active INTEGER NOT NULL);
CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,security_epoch INTEGER NOT NULL,revoked INTEGER NOT NULL);
CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,archived_at TEXT,is_global INTEGER DEFAULT 0);
CREATE TABLE permissions(actor TEXT,project TEXT,can_read INTEGER,can_write INTEGER,can_admin INTEGER,PRIMARY KEY(actor,project));
CREATE TABLE skills(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,name TEXT NOT NULL,description TEXT DEFAULT '',content TEXT DEFAULT '',
 category TEXT,tags TEXT,always_apply INTEGER DEFAULT 0,file_tree TEXT,enabled INTEGER DEFAULT 1,revision INTEGER NOT NULL DEFAULT 0,
 archived_at TEXT,created_at TEXT DEFAULT 'now',updated_at TEXT DEFAULT 'now',UNIQUE(project_id,name));
CREATE TABLE skill_proposals(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,status TEXT,proposal_type TEXT,target_skill_id TEXT,
 target_name TEXT,source_project_id TEXT,source_name TEXT,expected_revision INTEGER,expected_source_revision INTEGER,
 proposed_state TEXT DEFAULT '{}',evidence_json TEXT DEFAULT '[]',observation_ids TEXT DEFAULT '[]',updated_at TEXT);
CREATE TABLE maintenance_locks(resource TEXT,project_id TEXT,owner_token TEXT,expires_at TEXT);
CREATE TABLE domain_witnesses(operation TEXT,actor TEXT);
CREATE TABLE veyra_installation_identity(singleton INTEGER PRIMARY KEY,instance_id TEXT UNIQUE);
INSERT INTO veyra_installation_identity VALUES(1,'installation-fixture');
INSERT INTO users VALUES('actor-a',1,1),('actor-b',1,1);
INSERT INTO sessions VALUES('session-a','actor-a',1,0),('session-b','actor-b',1,0);
INSERT INTO projects(id,name) VALUES('project-a','actual-a'),('project-b','actual-b'),('source-p','actual-source');
INSERT INTO permissions VALUES('actor-a','project-a',1,1,1),('actor-a','project-b',1,1,1),('actor-a','source-p',1,1,1),
 ('actor-b','project-a',1,1,1);
`;
const ddl = readFileSync(new URL('../proposed/125_native_hosted_governance.sql', import.meta.url),'utf8');

export function fixture({ path=':memory:', initialize=true }={}) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0;');
  if(initialize) db.exec(schema+ddl);
  const state={actor:'actor-a',session:'session-a',calls:0,projectionWrites:0,
    afterAdmission:null,failEffect:false,failCheckpoint:false,nativeRevision:4,nativeLibrary:'library-a',nativeService:'native-a'};
  let depth=0;
  const transaction=work=>{
    db.exec('BEGIN IMMEDIATE');depth++;
    try {
      const result=work();
      if(result?.then) throw new Error('ASYNC_SQL_TRANSACTION_FORBIDDEN');
      db.exec('COMMIT');return result;
    } catch(error) { db.exec('ROLLBACK');throw error; }
    finally {depth--;}
  };
  const actor=()=>{
    const row=db.prepare('SELECT s.*,u.active,u.security_epoch AS current_epoch FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.user_id=?').get(state.session,state.actor);
    if(!row||row.revoked||!row.active||row.security_epoch!==row.current_epoch)throw new HostedRefusal('UNAUTHORIZED',401);
    return {id:state.actor,sessionId:state.session,securityEpoch:row.current_epoch};
  };
  const allow=(project,permission)=>{
    const a=actor(),row=db.prepare('SELECT * FROM permissions WHERE actor=? AND project=?').get(a.id,project);
    return Boolean(row?.['can_'+({read:'read',write:'write',admin:'admin'}[permission])]);
  };
  const ports={
    db:()=>db,transaction,
    checkpoint:()=>{
      if(depth)throw new Error('CHECKPOINT_INSIDE_TRANSACTION');
      if(state.failCheckpoint){state.failCheckpoint=false;throw new Error('synthetic checkpoint interruption');}
      const row=db.prepare("SELECT operation_id FROM native_hosted_governance_effects WHERE state='executing' LIMIT 1").get();
      if(row&&state.afterAdmission){const hook=state.afterAdmission;state.afterAdmission=null;hook();}
    },
    actor,allow,systemAllowed:project=>allow(project,'admin')&&Boolean(db.prepare('SELECT is_global FROM projects WHERE id=?').get(project)?.is_global),
    verifyEnrollment:()=>({actorId:actor().id,nativeLibraryId:state.nativeLibrary,nativeServiceInstanceId:state.nativeService,
      nativeProjectId:'native-project-a',nativeProjectRevision:state.nativeRevision}),
    verifyNativeOwner:(g,recovery)=>{
      if(g.native_library_id!==state.nativeLibrary||g.native_service_instance_id!==state.nativeService
          ||g.native_project_id!=='native-project-a'||!recovery&&g.native_project_revision!==state.nativeRevision)throw new HostedRefusal('STALE_NATIVE_BINDING',409);
    },
    isSafeSkillName:name=>typeof name==='string'&&name.length>0&&name.length<=64&&!['.','..'].includes(name)&&!/[\\/\0]/.test(name),
    isValidSkillFileTree:value=>{
      if(value===undefined||value===null)return true;
      try{const o=JSON.parse(value);return !!o&&typeof o==='object'&&!Array.isArray(o)&&Object.values(o).every(v=>typeof v==='string');}catch{return false;}
    },
    locks:project=>db.prepare("SELECT * FROM maintenance_locks WHERE resource='skills' AND (project_id=? OR project_id='*') AND expires_at>?").all(project,new Date().toISOString()),
    execute:(command,binding,a)=>{
      if(depth!==1)throw new Error('EFFECT_OUTSIDE_OUTER_TRANSACTION');
      state.calls++;db.prepare('INSERT INTO domain_witnesses VALUES(?,?)').run(command.op,a.id);
      const project=binding.hostedProjectId;
      if(command.op==='create') {
        db.prepare('INSERT INTO skills(id,project_id,name,description,content) VALUES(?,?,?,?,?)').run(randomUUID(),project,command.name,command.description,command.content);
      } else if(command.target) {
        const row=db.prepare('SELECT * FROM skills WHERE project_id=? AND name=?').get(project,command.name);
        db.prepare('UPDATE skills SET content=?,revision=revision+1,archived_at=?,enabled=?,updated_at=? WHERE id=?')
          .run(command.op==='save'?command.content:row.content,command.op==='archive'?'archived':command.op==='restore'?null:row.archived_at,
            command.op==='enable'?1:command.op==='disable'?0:row.enabled,new Date().toISOString(),row.id);
      } else {
        const p=db.prepare('SELECT * FROM skill_proposals WHERE id=?').get(command.id);
        const status={submit:'pending',approve:'applied',reject:'rejected',rollback:'rolled_back'}[command.op];
        db.prepare('UPDATE skill_proposals SET status=?,updated_at=? WHERE id=?').run(status,new Date().toISOString(),p.id);
        if(p.proposal_type==='merge'&&['approve','rollback'].includes(command.op)) {
          db.prepare('UPDATE skills SET revision=revision+1,archived_at=? WHERE project_id=? AND name=?')
            .run(command.op==='approve'?'archived':null,p.source_project_id,p.source_name);
        }
      }
      state.projectionWrites++;
      if(state.failEffect)throw new Error('synthetic projection failure: first failure retained privately');
      return command.reviewed?db.prepare('SELECT * FROM skill_proposals WHERE id=?').get(command.id)
        :db.prepare('SELECT * FROM skills WHERE project_id=? AND name=?').get(project,command.name);
    },
    read:async()=>({synthetic:true}),
  };
  const owner=createHostedGovernance(ports);
  const enroll=(project='project-a',request=randomUUID())=>owner.enroll({enrollmentRequestId:request,hostedProjectId:project,visibility:'project'});
  const original=(binding,command,id=randomUUID())=>({id,binding:structuredClone(binding),command:structuredClone(command)});
  const skill=(name='release',project='project-a')=>db.prepare('SELECT * FROM skills WHERE project_id=? AND name=?').get(project,name);
  const create=(binding,name='release',content='# Original')=>owner.effect(original(binding,{op:'create',reviewedAbsent:true,name,description:'Actual fixture',content}));
  const target=row=>({id:row.id,revision:row.revision});
  function proposal(binding,{type='update',status='pending',sourceProject='source-p'}={}) {
    const t=skill();
    if(type==='merge'&&!skill('source',sourceProject))db.prepare('INSERT INTO skills(id,project_id,name,content) VALUES(?,?,?,?)').run('source-skill',sourceProject,'source','# Source');
    const source=type==='merge'?skill('source',sourceProject):null;
    const id=randomUUID();
    db.prepare('INSERT INTO skill_proposals(id,project_id,status,proposal_type,target_skill_id,target_name,source_project_id,source_name,expected_revision,expected_source_revision,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id,binding.hostedProjectId,status,type,t?.id??null,t?.name??'new-target',source?.project_id??null,source?.name??null,t?.revision??null,source?.revision??null,'2026-01-01T00:00:00.000Z');
    return db.prepare('SELECT * FROM skill_proposals WHERE id=?').get(id);
  }
  function reviewed(p) {
    const t=p.target_skill_id?db.prepare('SELECT * FROM skills WHERE id=?').get(p.target_skill_id):null;
    const src=p.source_project_id?skill(p.source_name,p.source_project_id):null;
    return {status:p.status,updatedAt:p.updated_at,targetSkillId:p.target_skill_id??null,sourceProjectId:p.source_project_id??null,
      sourceName:p.source_name??null,expectedRevision:p.expected_revision??null,expectedSourceRevision:p.expected_source_revision??null,
      proposalHash:proposalReviewHash(p),currentTarget:t?target(t):null,
      currentSource:src?{id:src.id,projectId:src.project_id,name:src.name,revision:src.revision}:null};
  }
  return {db,state,ports,owner,enroll,original,skill,create,target,proposal,reviewed,close:()=>db.close()};
}
