import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as buffer from 'node:buffer';
import {stripTypeScriptTypes} from 'node:module';
import {SourceTextModule,SyntheticModule} from 'node:vm';
import {execFileSync,spawnSync} from 'node:child_process';
import {buildProjectionProposal} from './proposal.mjs';
import {fixture} from '../tests/fixture.mjs';

const integration=process.env.HOSTED_PROJECTION_INTEGRATION;
const worker=process.env.HOSTED_PROJECTION_WORKER;
const output=process.env.HOSTED_PROJECTION_TEST_ROOT;
assert.ok(integration?.startsWith('/')&&worker?.startsWith('/')&&output?.startsWith('/'),'Explicit existing Linux roots required; no fallback');
const proposal=buildProjectionProposal(integration,worker);
const source=target=>proposal.changes.find(c=>c.path.endsWith(target)).after;
const governance=execFileSync('git',['-C',integration,'show',proposal.base+':packages/ingenium-core/lib/tools/skill-governance.ts'],{encoding:'utf8'});
const root=path.resolve(output);
fs.mkdirSync(root,{recursive:true});
assert.equal(fs.lstatSync(root).isSymbolicLink(),false);
let sequence=0;
const removed=[];

async function actualFixture(action) {
 const directory=path.join(root,'case-'+process.pid+'-'+(++sequence));
 assert.equal(fs.existsSync(directory),false);fs.mkdirSync(directory);
 const f=fixture(),state={failWrite:null,failUnlink:false,failStat:false,events:[],warnings:[]};
 f.db.exec('ALTER TABLE native_hosted_governance_effects ADD COLUMN projection_plan_json TEXT; ALTER TABLE native_hosted_governance_effects ADD COLUMN projection_witness_json TEXT;');
 const ddl=source('/125_native_hosted_governance.sql');
 const identityTrigger=ddl.match(/CREATE TRIGGER native_hosted_effect_identity_immutable[\s\S]*?END;/)?.[0];
 assert.ok(identityTrigger);f.db.exec('DROP TRIGGER native_hosted_effect_identity_immutable;'+identityTrigger);
 for(const column of ['reviewer TEXT','review_reason TEXT','reviewed_at TEXT','applied_at TEXT','rolled_back_at TEXT','target_revision_before INTEGER','source_revision_before INTEGER','target_created INTEGER'])f.db.exec('ALTER TABLE skill_proposals ADD COLUMN '+column);
 f.db.exec('CREATE TABLE skill_versions(id TEXT PRIMARY KEY,skill_id TEXT,revision INTEGER,name TEXT,description TEXT,content TEXT,category TEXT,tags TEXT,always_apply INTEGER,file_tree TEXT,enabled INTEGER,archived_at TEXT);');
 f.db.exec('CREATE TABLE skill_lineage(project_id TEXT,source_project_id TEXT,source_name TEXT,target_skill_id TEXT,source_hash TEXT,merged_file_paths TEXT,reason TEXT,created_at TEXT,updated_at TEXT,UNIQUE(project_id,source_project_id,source_name,target_skill_id));');
 const dbPorts={getDb:()=>f.db,execTransaction:work=>{
   f.db.exec('SAVEPOINT actual_core_helper');
   try{const result=work();f.db.exec('RELEASE actual_core_helper');return result;}
   catch(error){f.db.exec('ROLLBACK TO actual_core_helper');f.db.exec('RELEASE actual_core_helper');throw error;}
 },checkpointAfterWrite:()=>{},sanitizeFts5Query:value=>value};
 const fsPorts={...fs,lstatSync:(name,...args)=>{
   if(state.failStat&&String(name).endsWith('SKILL.md'))throw Object.assign(new Error('synthetic inaccessible stat'),{code:'EACCES'});
   return fs.lstatSync(name,...args);
 },existsSync:name=>state.failStat&&String(name).endsWith('SKILL.md')?false:fs.existsSync(name),writeFileSync:(name,...args)=>{
   if(state.failWrite&&String(name).endsWith(state.failWrite))throw Object.assign(new Error('synthetic EACCES'),{code:'EACCES'});
   return fs.writeFileSync(name,...args);
 },unlinkSync:name=>{
   if(state.failUnlink&&String(name).endsWith('SKILL.md'))throw Object.assign(new Error('synthetic EACCES'),{code:'EACCES'});
   return fs.unlinkSync(name);
 }};
 const synthetic=value=>new SyntheticModule(Object.keys(value),function(){for(const [k,v]of Object.entries(value))this.setExport(k,v);});
 const modules=new Map();
 const skills=new SourceTextModule(stripTypeScriptTypes(source('/skills.ts'),{mode:'transform'}));
 const engine=new SourceTextModule(stripTypeScriptTypes(source('/hosted-governance.ts'),{mode:'transform'}));
 const plan=new SourceTextModule(stripTypeScriptTypes(source('/hosted-projection-plan.ts'),{mode:'transform'}));
 const gov=new SourceTextModule(stripTypeScriptTypes(governance,{mode:'transform'}));
 const owner=new SourceTextModule(stripTypeScriptTypes(source('/hosted-governance-owner.ts'),{mode:'transform'}));
 modules.set('./skills.js',skills);modules.set('./hosted-governance.js',engine);modules.set('./hosted-projection-plan.js',plan);modules.set('./skill-governance.js',gov);
 const external={'node:fs':fsPorts,'node:path':path,'node:crypto':crypto,'node:buffer':buffer,'../db.js':dbPorts,
  '../schema.js':{Skill:undefined,SkillVersion:undefined,SKILL_PROPOSAL_PAGE_CURSOR_VERSION:1,SKILL_PROPOSAL_RETENTION_INDEX:'fixture'},
  '../logger.js':{logger:{warn:(...args)=>state.warnings.push(args),info:()=>{},error:()=>{}}},
  './paths.js':{getSkillsBase:projectId=>path.join(directory,projectId??'none','skills')},
  './maintenance-locks.js':{listActiveLocks:()=>[]}};
 const link=specifier=>{
   if(modules.has(specifier))return modules.get(specifier);
   if(!Object.hasOwn(external,specifier))throw new Error('Unapproved actual Core dependency: '+specifier);
   const module=synthetic(external[specifier]);modules.set(specifier,module);return module;
 };
 try {
  await owner.link(link);await owner.evaluate();
  const auth=Object.fromEntries(['actor','allow','systemAllowed','verifyEnrollment','verifyNativeOwner','read'].map(key=>[key,f.ports[key]]));
  // Actual owner, engine, original skill helpers and original governance functions; only DB/auth/paths/fs faults are injected.
  f.owner=owner.namespace.createHostedGovernanceOwner(auth);
  const enroll=()=>f.owner.enroll({enrollmentRequestId:crypto.randomUUID(),hostedProjectId:'project-a',visibility:'project'});
  const file=(project='project-a',name='release',relative='SKILL.md')=>path.join(directory,project,'skills',name,relative);
  const makeSkill=({name='release',project='project-a',content='# Original',files=null}={})=>{
    f.db.prepare('INSERT INTO skills(id,project_id,name,description,content,file_tree) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),project,name,'Actual fixture',content,files);
    const row=f.skill(name,project);skills.namespace.writeSkillToDisk(row);return row;
  };
  await action({f,state,skills:skills.namespace,plan:plan.namespace,engine:engine.namespace,gov:gov.namespace,enroll,file,makeSkill,directory,dbPorts});
 } finally {
  f.close();
  // Only this newly created fixture subtree; no mounts/processes created, all SQLite/VM handles closed.
  const remove=directoryPath=>{
    assert.ok(path.resolve(directoryPath).startsWith(root+path.sep));
    for(const item of fs.readdirSync(directoryPath,{withFileTypes:true})){
      const full=path.join(directoryPath,item.name),info=fs.lstatSync(full);
      if(info.isDirectory()&&!info.isSymbolicLink()){remove(full);continue;}
      if(info.isFile()){
        assert.equal(info.nlink,1);
        const active=spawnSync('/usr/bin/fuser',[full]);
        assert.equal(active.status,1,'Retain fixture with active or unverified handle');assert.equal(active.stdout.length+active.stderr.length,0);
      }
      assert.ok(info.isFile()||info.isSymbolicLink());fs.unlinkSync(full);removed.push({path:full,bytes:info.size,kind:info.isSymbolicLink()?'owned-fixture-link':'owned-fixture-file'});
    }
    fs.rmdirSync(directoryPath);
  };
  remove(directory);
 }
}
const save=(f,binding,row,extra={always_apply:0})=>f.original(binding,{op:'save',name:row.name,filePath:'SKILL.md',target:{id:row.id,revision:row.revision},content:'# Changed  \r\n',extra});

test('actual Core strict scope rejects unsafe name and symlink directory early returns; legacy caller stays compatible',()=>actualFixture(({skills,state,directory,makeSkill})=>{
 const row=makeSkill();const observe=e=>state.events.push(e);
 assert.throws(()=>skills.withStrictSkillProjection(observe,()=>skills.writeSkillToDisk({...row,name:'../escape'})),/UNSAFE_SKILL_NAME/);
 const outside=path.join(directory,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'original'),'protected fixture');
 const linked=path.join(directory,'project-a','skills','linked');fs.symlinkSync(outside,linked);
 assert.throws(()=>skills.withStrictSkillProjection(observe,()=>skills.writeSkillToDisk({...row,name:'linked'})),/UNSAFE_SKILL_DIRECTORY/);
 assert.doesNotThrow(()=>skills.writeSkillToDisk({...row,name:'linked'}));
 assert.equal(fs.readFileSync(path.join(outside,'original'),'utf8'),'protected fixture');assert.equal(fs.existsSync(path.join(outside,'SKILL.md')),false);
 assert.ok(state.events.every(e=>e.phase==='failed'));
}));

test('actual Core file_tree I/O catch propagates under strict owner and preserves partial projection witness',()=>actualFixture(({f,state,enroll,makeSkill,file})=>{
 const row=makeSkill(),{binding}=enroll();state.failWrite='refs/failure.md';
 const original=save(f,binding,row,{always_apply:0,files:JSON.stringify({'refs/failure.md':'# Reference'})});
 const result=f.owner.effect(original);assert.equal(result.outcome,'unknown');assert.equal(f.skill().revision,0);
 assert.match(fs.readFileSync(file(),'utf8'),/# Changed/); // Projection escaped the SQL rollback; do not claim atomic files.
 const ledger=f.db.prepare('SELECT * FROM native_hosted_governance_effects WHERE operation_id=?').get(original.id);
 assert.equal(ledger.state,'executing');assert.equal(JSON.parse(ledger.projection_plan_json).payloadHash,result.payloadHash);
 const events=JSON.parse(ledger.projection_witness_json);assert.ok(events.some(e=>e.relativePath==='refs/failure.md'&&e.phase==='failed'&&e.code==='EACCES'));
 assert.ok(events.some(e=>e.relativePath==='SKILL.md'&&e.phase==='completed'&&/^[a-f0-9]{64}$/.test(e.expectedSha256)));
 assert.equal(JSON.stringify(events).includes('# Changed'),false);
 state.failWrite=null;fs.writeFileSync(file(),'# User revised after failure');
 assert.equal(f.owner.effect(original).outcome,'unknown');assert.equal(f.owner.inspect(original.id,binding.grantId).outcome,'unknown');
 assert.equal(fs.readFileSync(file(),'utf8'),'# User revised after failure');
}));

test('actual Core unlink catch cannot terminal-succeed for hosted archive; SQL rolls back',()=>actualFixture(({f,state,enroll,makeSkill,file})=>{
 const row=makeSkill(),{binding}=enroll();state.failUnlink=true;
 const original=f.original(binding,{op:'archive',name:row.name,target:{id:row.id,revision:row.revision}});
 assert.equal(f.owner.effect(original).outcome,'unknown');assert.equal(f.skill().archived_at,null);assert.equal(fs.existsSync(file()),true);
 assert.equal(f.db.prepare('SELECT state FROM native_hosted_governance_effects WHERE operation_id=?').get(original.id).state,'executing');
}));

test('actual Core legacy auxiliary write and unlink remain best effort outside strict scope',()=>actualFixture(({f,state,skills,makeSkill,file})=>{
 const row=makeSkill();state.failWrite='ref.md';
 assert.doesNotThrow(()=>skills.writeSkillToDisk({...row,file_tree:JSON.stringify({'ref.md':'body'})}));
 state.failUnlink=true;assert.doesNotThrow(()=>skills.removeSkillMdOnly(row.name,row.project_id));assert.equal(fs.existsSync(file()),true);
}));

test('strict remove distinguishes inaccessible stat from absent file instead of trusting existsSync false',()=>actualFixture(({f,state,enroll,makeSkill,file})=>{
 const row=makeSkill(),{binding}=enroll();state.failStat=true;
 const original=f.original(binding,{op:'disable',name:row.name,target:{id:row.id,revision:row.revision}});
 assert.equal(f.owner.effect(original).outcome,'unknown');assert.equal(f.skill().enabled,1);assert.equal(fs.existsSync(file()),true);
}));

test('actual Core projection followed by terminal receipt failure remains unknown with plan and no replay',()=>actualFixture(({f,enroll,makeSkill,file})=>{
 const row=makeSkill(),{binding}=enroll();
 f.db.exec("CREATE TRIGGER fail_actual_receipt BEFORE UPDATE ON native_hosted_governance_effects WHEN NEW.state='succeeded' BEGIN SELECT RAISE(ABORT,'receipt write failure'); END");
 const original=save(f,binding,row);assert.equal(f.owner.effect(original).outcome,'unknown');assert.equal(f.skill().revision,0);
 assert.match(fs.readFileSync(file(),'utf8'),/# Changed/);
 const ledger=f.db.prepare('SELECT * FROM native_hosted_governance_effects WHERE operation_id=?').get(original.id);
 assert.ok(JSON.parse(ledger.projection_witness_json).some(e=>e.phase==='completed'));assert.ok(ledger.projection_plan_json);
 assert.equal(f.owner.inspect(original.id,binding.grantId).outcome,'unknown');
}));

test('actual skill-governance approve uses strict original removal owner and rolls proposal SQL back on unlink failure',()=>actualFixture(({f,state,enroll,makeSkill,file})=>{
 makeSkill();const {binding}=enroll(),p=f.proposal(binding,{type:'archive'});state.failUnlink=true;
 const original=f.original(binding,{op:'approve',id:p.id,reviewed:f.reviewed(p),reviewer:'Actual reviewer'});
 assert.equal(f.owner.effect(original).outcome,'unknown');assert.equal(f.skill().archived_at,null);assert.equal(fs.existsSync(file()),true);
 assert.equal(f.db.prepare('SELECT status FROM skill_proposals WHERE id=?').get(p.id).status,'pending');
}));

test('actual Core receipt transaction outer failure after projection retains only conservative admission plan on simulated crash',()=>actualFixture(({f,skills,engine,plan,enroll,makeSkill,file})=>{
 const row=makeSkill(),{binding}=enroll(),original=save(f,binding,row);
 const ports={...f.ports,projectionPlan:o=>plan.deriveHostedProjectionPlan(f.db,o),execute:(command,b,actor,id,projection)=>{
   return skills.withStrictSkillProjection(plan.createHostedProjectionObserver(projection.plan,projection.events),()=>skills.updateSkill(b.hostedProjectId,command.name,command.content,undefined,undefined,0));
 }};
 // A separate synthetic outer-commit failure around actual original Core helpers, not a fake projection.
 let transactions=0;const tx=ports.transaction;ports.transaction=work=>tx(()=>{const value=work();if(++transactions===2)throw new Error('synthetic outer commit failure');return value;});
 const owner=engine.createHostedGovernance(ports);assert.equal(owner.effect(original).outcome,'unknown');assert.equal(f.skill().revision,0);assert.match(fs.readFileSync(file(),'utf8'),/# Changed/);
 const ledger=f.db.prepare('SELECT * FROM native_hosted_governance_effects WHERE operation_id=?').get(original.id);
 assert.equal(ledger.state,'executing');assert.ok(ledger.projection_plan_json);
 // Drop optional in-memory events to model process death: immutable admission plan remains, never a success attestation.
 f.db.prepare('UPDATE native_hosted_governance_effects SET projection_witness_json=NULL WHERE operation_id=?').run(original.id);
 assert.equal(owner.effect(original).outcome,'unknown');assert.equal(owner.inspect(original.id,binding.grantId).outcome,'unknown');
}));

test('admission plan is immutable, content-free and binds the exact original while planned observer refuses another path',()=>actualFixture(({f,plan,skills,enroll,makeSkill,file})=>{
 const row=makeSkill(),{binding}=enroll(),original=save(f,binding,row),events=[];
 const planned=plan.deriveHostedProjectionPlan(f.db,original);
 assert.equal(JSON.stringify(planned).includes('# Original'),false);assert.equal(JSON.stringify(planned).includes('# Changed'),false);
 const observe=plan.createHostedProjectionObserver(planned,events);
 assert.throws(()=>skills.withStrictSkillProjection(observe,()=>skills.writeSkillToDisk({...row,revision:row.revision+1,file_tree:JSON.stringify({'unplanned.md':'Not authorized'})})),/Unplanned|PROJECTION/);
 assert.equal(fs.existsSync(file('project-a','release','unplanned.md')),false);
 assert.ok(events.some(e=>e.code==='UNPLANNED_PROJECTION'));
 assert.equal(f.owner.effect(original).outcome,'succeeded');
 assert.throws(()=>f.db.prepare('UPDATE native_hosted_governance_effects SET projection_plan_json=? WHERE operation_id=?').run('{}',original.id),/immutable/);
}));

test('actual Core strict observer failure releases scope and refuses further effects',()=>actualFixture(({skills,state,makeSkill,file})=>{
 const row=makeSkill(),before=fs.readFileSync(file(),'utf8');
 assert.throws(()=>skills.withStrictSkillProjection(()=>{throw new Error('observer unavailable');},()=>skills.writeSkillToDisk({...row,content:'# Must not write'})),/observer unavailable/);
 assert.equal(fs.readFileSync(file(),'utf8'),before);
 assert.doesNotThrow(()=>skills.writeSkillToDisk({...row,content:'# Legacy after scope'}));
 assert.match(fs.readFileSync(file(),'utf8'),/# Legacy after scope/);
}));

test('actual skill-governance rollback uses strict original write owner and rolls restored SQL back on auxiliary failure',()=>actualFixture(({f,state,enroll,makeSkill,file})=>{
 const row=makeSkill({files:JSON.stringify({'refs/restored.md':'# Reference'})}),{binding}=enroll();
 f.db.prepare('INSERT INTO skill_versions(id,skill_id,revision,name,description,content,category,tags,always_apply,file_tree,enabled,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('version-fixture',row.id,0,row.name,row.description,row.content,null,null,0,row.file_tree,1,null);
 f.db.prepare("UPDATE skills SET archived_at='archived',revision=1 WHERE id=?").run(row.id);
 const p=f.proposal(binding,{type:'archive',status:'applied'});
 f.db.prepare('UPDATE skill_proposals SET target_revision_before=0,target_created=0 WHERE id=?').run(p.id);
 const fresh=f.db.prepare('SELECT * FROM skill_proposals WHERE id=?').get(p.id);state.failWrite='refs/restored.md';
 const original=f.original(binding,{op:'rollback',id:p.id,reviewed:f.reviewed(fresh),reviewer:'Actual reviewer'});
 assert.equal(f.owner.effect(original).outcome,'unknown');assert.equal(f.skill().archived_at,'archived');assert.equal(f.skill().revision,1);
 assert.equal(f.db.prepare('SELECT status FROM skill_proposals WHERE id=?').get(p.id).status,'applied');
 assert.match(fs.readFileSync(file(),'utf8'),/# Original/);
}));

test('actual merge approval rolls both SQL owners back after target projection then failed source removal',()=>actualFixture(({f,state,enroll,makeSkill,file})=>{
 makeSkill();makeSkill({project:'source-p',name:'source',content:'# Source'});const {binding}=enroll();
 const p=f.proposal(binding,{type:'merge'});
 f.db.prepare('UPDATE skill_proposals SET proposed_state=? WHERE id=?').run(JSON.stringify({content:'# Merged',description:'Merged'}),p.id);
 const fresh=f.db.prepare('SELECT * FROM skill_proposals WHERE id=?').get(p.id);state.failUnlink=true;
 const original=f.original(binding,{op:'approve',id:p.id,reviewed:f.reviewed(fresh),reviewer:'Actual reviewer'});
 assert.equal(f.owner.effect(original).outcome,'unknown');assert.equal(f.skill().content,'# Original');
 assert.equal(f.skill('source','source-p').archived_at,null);assert.equal(fs.existsSync(file('source-p','source')),true);
 assert.match(fs.readFileSync(file(),'utf8'),/# Merged/);
 const row=f.db.prepare('SELECT * FROM native_hosted_governance_effects WHERE operation_id=?').get(original.id);
 assert.equal(JSON.parse(row.projection_plan_json).entries.length,2);
 assert.ok(JSON.parse(row.projection_witness_json).some(e=>e.projectId==='source-p'&&e.phase==='failed'));
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM skill_lineage').get().n,0);
}));

test.after(()=>{
 if(fs.readdirSync(root).length===0)fs.rmdirSync(root);
 const receipt={root,removed,removedLogicalLinuxBytes:removed.reduce((n,x)=>n+x.bytes,0),retained:[],windowsRecoveryClaim:false,regeneration:'actual-core-projection.test.mjs with explicit same owned roots; in-memory transforms, isolated fixtures only'};
 fs.writeFileSync(path.join(path.dirname(root),'projection-outcomes-cleanup.json'),JSON.stringify(receipt,null,2)+'\n');
});
