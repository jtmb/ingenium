import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve, isAbsolute } from 'node:path';
import { mkdirSync, existsSync, lstatSync, unlinkSync, rmdirSync, readdirSync } from 'node:fs';
import { fixture } from './fixture.mjs';
import { canonical, payloadHash, validateOriginal } from '../proposed/hosted-governance.ts';

const withFixture=async action=>{const f=fixture();try{return await action(f);}finally{f.close();}};
const edit=(f,binding,patch={})=>f.original(binding,{op:'save',name:'release',filePath:'SKILL.md',
 target:f.target(f.skill()),content:'# Exact draft  \r\n',extra:{always_apply:0},...patch});
const reviewCommand=(f,p,op='approve')=>({op,id:p.id,reviewed:f.reviewed(p),reviewer:'Display label is not authority'});

test('enrollment uses actual actor/installation and private native mapping, never renderer identity fields',()=>withFixture(f=>{
 const first=f.enroll('project-a','enroll-id'),again=f.enroll('project-a','enroll-id');
 assert.deepEqual(first,again);assert.equal(first.binding.actorId,'actor-a');
 assert.equal(first.binding.installationId,'installation-fixture');assert.equal(first.binding.nativeLibraryId,'library-a');
 assert.equal(first.binding.hostedProjectId,'project-a');assert.ok(first.capabilities.includes('approve'));
 assert.equal(first.capabilities.includes('synthesis-run'),false);
 assert.throws(()=>f.owner.enroll({enrollmentRequestId:'x',hostedProjectId:'project-a',visibility:'project',actorId:'forged'}),/INVALID_COMMAND/);
 assert.throws(()=>f.enroll('project-b','enroll-id'),/ENROLLMENT_REUSE_CONFLICT/);
 assert.throws(()=>f.owner.enroll({enrollmentRequestId:'sys',hostedProjectId:'project-a',visibility:'system'}),/NOT_FOUND/);
}));

test('create is absent-only and original replay returns its actual durable result without another effect',()=>withFixture(f=>{
 const {binding}=f.enroll();const original=f.original(binding,{op:'create',reviewedAbsent:true,name:'release',description:'Exact',content:'# Original'});
 const result=f.owner.effect(original);assert.equal(result.outcome,'succeeded');assert.equal(f.state.calls,1);
 assert.deepEqual(f.owner.effect(original),result);assert.equal(f.state.calls,1);
 assert.equal(f.skill().revision,0);assert.equal(result.payloadHash,payloadHash(original));
 const collision=f.owner.effect(f.original(binding,{...original.command,content:'# Must not overwrite'}));
 assert.equal(collision.outcome,'refused');assert.equal(collision.error.code,'TARGET_EXISTS');
 assert.equal(f.skill().content,'# Original');
 assert.throws(()=>f.owner.effect({...original,command:{...original.command,content:'# Changed reuse'}}),/OPERATION_REUSE_CONFLICT/);
 assert.equal(f.state.calls,1);
}));

test('save binds reviewed UUID and revision, preserves exact bytes, and records a stale refusal',()=>withFixture(f=>{
 const {binding}=f.enroll();f.create(binding);const original=edit(f,binding);
 const result=f.owner.effect(original);assert.equal(result.outcome,'succeeded');assert.equal(f.skill().content,'# Exact draft  \r\n');
 assert.equal(f.skill().revision,1);
 const refused=f.owner.effect({...original,id:'another-original'});assert.equal(refused.outcome,'refused');
 assert.equal(refused.error.code,'SKILL_CAS_CONFLICT');assert.equal(f.skill().revision,1);
 const newer=edit(f,binding);
 f.db.prepare("UPDATE skills SET id='replacement' WHERE name='release'").run();
 const replaced=f.owner.effect(newer);assert.equal(replaced.outcome,'refused');assert.equal(replaced.error.code,'SKILL_CAS_CONFLICT');
}));

test('archive/restore/enable/disable use exact target state and only restore requires existing admin permission',()=>withFixture(f=>{
 const {binding}=f.enroll();f.create(binding);
 for(const op of ['disable','enable','archive','restore']) {
  const original=f.original(f.owner.binding(binding.grantId).binding,{op,name:'release',target:f.target(f.skill())});
  assert.equal(f.owner.effect(original).outcome,'succeeded');
 }
 assert.equal(f.skill().archived_at,null);assert.equal(f.skill().revision,4);
 const archive=f.original(binding,{op:'archive',name:'release',target:f.target(f.skill())});f.owner.effect(archive);
 f.db.exec("UPDATE permissions SET can_admin=0 WHERE actor='actor-a' AND project='project-a'");
 const current=f.owner.binding(binding.grantId).binding;
 const refused=f.owner.effect(f.original(current,{op:'restore',name:'release',target:f.target(f.skill())}));
 assert.equal(refused.outcome,'refused');assert.equal(refused.error.code,'FORBIDDEN');
}));

test('actual session revocation after admission produces a durable refused result and no domain write',()=>withFixture(f=>{
 const {binding}=f.enroll();f.create(binding);const original=edit(f,binding),before=f.state.calls;
 f.state.afterAdmission=()=>f.db.exec("UPDATE sessions SET revoked=1 WHERE id='session-a'");
 const result=f.owner.effect(original);assert.equal(result.outcome,'refused');assert.equal(result.error.code,'UNAUTHORIZED');
 assert.equal(f.state.calls,before);
 assert.equal(f.db.prepare('SELECT state FROM native_hosted_governance_effects WHERE operation_id=?').get(original.id).state,'refused');
}));

test('current target permission revocation and foreign actor/grant cannot turn review metadata into authority',()=>withFixture(f=>{
 const {binding}=f.enroll();f.create(binding);const original=edit(f,binding),before=f.state.calls;
 f.state.afterAdmission=()=>f.db.exec("UPDATE permissions SET can_write=0 WHERE actor='actor-a' AND project='project-a'");
 assert.equal(f.owner.effect(original).outcome,'refused');assert.equal(f.state.calls,before);
 f.state.actor='actor-b';f.state.session='session-b';
 assert.throws(()=>f.owner.inspect(original.id,binding.grantId),/NOT_FOUND/);
 assert.throws(()=>f.owner.effect(original),/NOT_FOUND/);assert.equal(f.state.calls,before);
}));

test('a matching grant ID with changed connection/epoch/project fields is not an effect grant',()=>withFixture(f=>{
 const {binding}=f.enroll();f.create(binding);
 const original=edit(f,{...binding,connectionId:'forged-connection'});
 const result=f.owner.effect(original);assert.equal(result.outcome,'refused');assert.equal(result.error.code,'STALE_BINDING');
 assert.equal(f.skill().revision,0);
 assert.throws(()=>f.owner.effect(edit(f,{...binding,hostedProjectId:'project-b'})),/NOT_FOUND/);
}));

test('merge approval and rollback require source read/admin and distinct source and target locks',()=>withFixture(f=>{
 const {binding}=f.enroll();f.create(binding);const p=f.proposal(binding,{type:'merge'});
 const future='2099-01-01T00:00:00.000Z';
 f.db.prepare("INSERT INTO maintenance_locks VALUES('skills','project-a','target-private',?)").run(future);
 f.db.prepare("INSERT INTO maintenance_locks VALUES('skills','source-p','source-private',?)").run(future);
 const bad=f.owner.effect(f.original(binding,reviewCommand(f,p)),{target:'target-private',source:'target-private'});
 assert.equal(bad.outcome,'refused');assert.equal(bad.error.code,'LOCKED');assert.equal(f.skill('source','source-p').archived_at,null);
 const good=f.owner.effect(f.original(binding,reviewCommand(f,p)),{target:'target-private',source:'source-private'});
 assert.equal(good.outcome,'succeeded');assert.equal(f.skill('source','source-p').archived_at,'archived');
 const applied=f.db.prepare('SELECT * FROM skill_proposals WHERE id=?').get(p.id);
 const rollback=f.owner.effect(f.original(binding,reviewCommand(f,applied,'rollback')),{target:'target-private',source:'source-private'});
 assert.equal(rollback.outcome,'succeeded');assert.equal(f.skill('source','source-p').archived_at,null);
 const rows=f.db.prepare('SELECT payload_hash,binding_hash,value_ref_json,error_code FROM native_hosted_governance_effects').all();
 assert.equal(JSON.stringify(rows).includes('target-private'),false);assert.equal(JSON.stringify(rows).includes('source-private'),false);
}));

test('source permissions are freshly checked after admission and again before receipt recovery',()=>withFixture(f=>{
 const {binding}=f.enroll();f.create(binding);const p=f.proposal(binding,{type:'merge'}),original=f.original(binding,reviewCommand(f,p));
 f.state.afterAdmission=()=>f.db.exec("UPDATE permissions SET can_read=0 WHERE actor='actor-a' AND project='source-p'");
 const result=f.owner.effect(original);assert.equal(result.outcome,'refused');assert.equal(result.error.code,'SOURCE_FORBIDDEN');
 assert.equal(f.skill('source','source-p').archived_at,null);
 assert.throws(()=>f.owner.inspect(original.id,binding.grantId),/NOT_FOUND/);
 f.db.exec("UPDATE permissions SET can_read=1,can_admin=0 WHERE actor='actor-a' AND project='source-p'");
 const refused=f.owner.effect(f.original(binding,reviewCommand(f,p)));assert.equal(refused.outcome,'refused');assert.equal(refused.error.status,403);
}));

test('proposal CAS covers status/timestamp/current target and source UUID/revisions, not just expected baseline',()=>withFixture(f=>{
 const {binding}=f.enroll();f.create(binding);const p=f.proposal(binding,{type:'merge'}),command=reviewCommand(f,p);
 f.db.exec("UPDATE skills SET revision=revision+1 WHERE project_id='source-p'");
 const result=f.owner.effect(f.original(binding,command));assert.equal(result.outcome,'refused');assert.equal(result.error.code,'SOURCE_CAS_CONFLICT');
 const p2=f.proposal(binding),stale=reviewCommand(f,p2);
 f.db.exec("UPDATE skills SET revision=revision+1 WHERE project_id='project-a'");
 assert.equal(f.owner.effect(f.original(binding,stale)).error.code,'TARGET_CAS_CONFLICT');
 const changed=reviewCommand(f,p2);changed.reviewed.updatedAt='different';
 assert.equal(f.owner.effect(f.original(binding,changed)).error.code,'PROPOSAL_CAS_CONFLICT');
}));

test('same-timestamp proposal body replacement cannot pass the opaque reviewed proposal hash',()=>withFixture(f=>{
 const {binding}=f.enroll();f.create(binding);const p=f.proposal(binding),original=f.original(binding,reviewCommand(f,p));
 f.db.prepare("UPDATE skill_proposals SET proposed_state=? WHERE id=?").run('{"content":"unreviewed"}',p.id);
 const result=f.owner.effect(original);assert.equal(result.outcome,'refused');assert.equal(result.error.code,'PROPOSAL_CAS_CONFLICT');
 assert.equal(f.db.prepare('SELECT status FROM skill_proposals WHERE id=?').get(p.id).status,'pending');
}));

test('submit/reject preserve explicit reviewed lifecycle and use the same original receipt owner',()=>withFixture(f=>{
 const {binding}=f.enroll();f.create(binding);const draft=f.proposal(binding,{status:'draft'});
 assert.equal(f.owner.effect(f.original(binding,reviewCommand(f,draft,'submit'))).outcome,'succeeded');
 const pending=f.db.prepare('SELECT * FROM skill_proposals WHERE id=?').get(draft.id);
 assert.equal(f.owner.effect(f.original(binding,reviewCommand(f,pending,'reject'))).outcome,'succeeded');
 assert.equal(f.db.prepare('SELECT status FROM skill_proposals WHERE id=?').get(draft.id).status,'rejected');
}));

test('unexpected projection failure rolls back domain rows, preserves original first failure and never replays',()=>withFixture(f=>{
 const {binding}=f.enroll();f.create(binding);const original=edit(f,binding),calls=f.state.calls;
 f.state.failEffect=true;
 const first=f.owner.effect(original);assert.equal(first.outcome,'unknown');assert.equal(f.skill().revision,0);
 assert.equal(f.state.calls,calls+1);
 assert.deepEqual(f.owner.effect(original),first);assert.equal(f.state.calls,calls+1);
 assert.equal(f.owner.inspect(original.id,binding.grantId).outcome,'unknown');
 assert.equal(f.owner.pending(binding.grantId).data[0].operationId,original.id);
 assert.equal(f.db.prepare('SELECT state,first_failure_code FROM native_hosted_governance_effects WHERE operation_id=?').get(original.id).state,'executing');
 assert.equal(JSON.stringify(first).includes('synthetic projection'),false);
}));

test('domain mutation and terminal receipt are atomic even if the terminal SQLite update fails',()=>withFixture(f=>{
 const {binding}=f.enroll();f.create(binding);const original=edit(f,binding);
 f.db.exec("CREATE TRIGGER fixture_terminal_failure BEFORE UPDATE ON native_hosted_governance_effects WHEN NEW.state='succeeded' BEGIN SELECT RAISE(ABORT,'synthetic receipt write failure'); END");
 const result=f.owner.effect(original);assert.equal(result.outcome,'unknown');assert.equal(f.skill().revision,0);
 assert.equal(f.db.prepare('SELECT state FROM native_hosted_governance_effects WHERE operation_id=?').get(original.id).state,'executing');
 const calls=f.state.calls;f.owner.effect(original);assert.equal(f.state.calls,calls);
}));

test('a crash after durable admission but before effects recovers read-only as unknown',()=>withFixture(f=>{
 const {binding}=f.enroll();f.create(binding);const original=edit(f,binding),calls=f.state.calls;
 f.state.failCheckpoint=true;
 assert.throws(()=>f.owner.effect(original),/checkpoint interruption/);
 assert.equal(f.owner.inspect(original.id,binding.grantId).outcome,'unknown');
 f.owner.effect(original);assert.equal(f.state.calls,calls);
 const before=f.db.prepare('SELECT total_changes() AS n').get().n;
 assert.equal(f.owner.inspect('never-admitted',binding.grantId).outcome,'unknown');
 f.owner.pending(binding.grantId);assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,before);
}));

test('recovery tolerates an old reader epoch only for the current same owner, never a new mutation',()=>withFixture(f=>{
 const {binding}=f.enroll();f.create(binding);const original=edit(f,binding);f.owner.effect(original);
 f.state.nativeRevision=5;
 assert.equal(f.owner.inspect(original.id,binding.grantId).outcome,'succeeded');
 assert.equal(f.owner.effect(edit(f,binding)).outcome,'refused');
 f.db.exec("UPDATE native_hosted_governance_grants SET revoked_at='revoked'");assert.throws(()=>f.owner.inspect(original.id,binding.grantId),/NOT_FOUND/);
}));

test('pending is bounded and closed originals reject credential fields, unsafe Unicode and unknown commands',()=>withFixture(f=>{
 const {binding}=f.enroll();f.create(binding);
 assert.throws(()=>f.owner.pending(binding.grantId,'',101),/INVALID_CURSOR/);
 assert.throws(()=>validateOriginal({...edit(f,binding),cookie:'not-a-real-cookie'},f.ports),/INVALID_COMMAND/);
 assert.throws(()=>f.owner.effect(f.original(binding,{op:'synthesis-run'})),/UNSUPPORTED_COMMAND/);
 assert.throws(()=>canonical({invalid:'\ud800'}),/INVALID_UNICODE/);
 assert.equal(payloadHash({a:1,b:'  \r\n'}),payloadHash({b:'  \r\n',a:1}));
 assert.notEqual(payloadHash({a:'x\n'}),payloadHash({a:'x\r\n'}));
}));

test('archived merge source refuses approval before the domain helper',()=>withFixture(f=>{
 const {binding}=f.enroll();f.create(binding);const p=f.proposal(binding,{type:'merge'});
 f.db.prepare("UPDATE skills SET archived_at='archived' WHERE id='source-skill'").run();
 const result=f.owner.effect(f.original(binding,reviewCommand(f,p)));
 assert.equal(result.outcome,'refused');assert.equal(result.error.code,'STALE_PROPOSAL');
 assert.equal(f.db.prepare('SELECT status FROM skill_proposals WHERE id=?').get(p.id).status,'pending');
}));

test('unexpected domain proposal status rolls SQL back and retains unknown admission',()=>withFixture(f=>{
 const {binding}=f.enroll();f.create(binding);const p=f.proposal(binding);const execute=f.ports.execute;
 f.ports.execute=(...args)=>({...execute(...args),status:'stale'});
 const original=f.original(binding,reviewCommand(f,p));
 assert.equal(f.owner.effect(original).outcome,'unknown');
 assert.equal(f.db.prepare('SELECT status FROM skill_proposals WHERE id=?').get(p.id).status,'pending');
 assert.equal(f.owner.inspect(original.id,binding.grantId).outcome,'unknown');
}));

test('two actual SQLite connections serialize concurrent creators: loser is refused without legacy upsert overwrite',()=>{
 const directory=process.env.HOSTED_GOVERNANCE_TEST_ROOT;
 assert.ok(directory&&isAbsolute(directory),'Explicit owned fixture root is required; no temporary fallback');
 const root=resolve(directory);mkdirSync(root,{recursive:true});
 assert.equal(lstatSync(root).isSymbolicLink(),false);
 const path=join(root,'two-creators-'+process.pid+'.sqlite');
 assert.equal(existsSync(path),false,'Never overwrite an existing fixture or unknown data');
 let a,b;
 try {
  a=fixture({path});b=fixture({path,initialize:false});
  const {binding}=a.enroll();
  const first=a.original(binding,{op:'create',reviewedAbsent:true,name:'release',description:'First',content:'# First'});
  const second=b.original(binding,{op:'create',reviewedAbsent:true,name:'release',description:'Second',content:'# Winner'});
  a.state.afterAdmission=()=>{assert.equal(b.owner.effect(second).outcome,'succeeded');};
  assert.equal(a.owner.effect(first).outcome,'refused');
  assert.equal(a.skill().content,'# Winner');assert.equal(a.db.prepare("SELECT count(*) AS n FROM skills WHERE name='release'").get().n,1);
  const third=a.original(binding,{op:'create',reviewedAbsent:true,name:'third',description:'Third',content:'# Third'});
  a.db.exec('BEGIN IMMEDIATE');
  try {assert.throws(()=>b.owner.effect(third),/locked|busy/i);}finally{a.db.exec('ROLLBACK');}
  assert.equal(b.owner.inspect(third.id,binding.grantId).outcome,'unknown');assert.equal(b.skill('third'),undefined);
 } finally {
  b?.close();a?.close();
  for(const suffix of ['','-wal','-shm','-journal']) {
   const file=path+suffix;
   if(existsSync(file)){const info=lstatSync(file);assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1);unlinkSync(file);}
  }
  if(readdirSync(root).length===0)rmdirSync(root); // Other failed-cleanup witnesses stay protected.
 }
});
