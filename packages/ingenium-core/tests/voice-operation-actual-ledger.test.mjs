import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,mkdirSync,existsSync,lstatSync,unlinkSync,rmdirSync,writeFileSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import {SourceTextModule,SyntheticModule} from 'node:vm';
import * as crypto from 'node:crypto';

const cpuModule=new SourceTextModule(stripTypeScriptTypes(readFileSync(new URL('../lib/tools/voice-operation-cpu.ts',import.meta.url),'utf8'),{mode:'strip'}));
const ledgerModule=new SourceTextModule(stripTypeScriptTypes(readFileSync(new URL('../lib/tools/voice-operation-ledger.ts',import.meta.url),'utf8'),{mode:'strip'}));
const cryptoModule=new SyntheticModule(Object.keys(crypto),function(){for(const [key,value]of Object.entries(crypto))this.setExport(key,value);});
await ledgerModule.link(specifier=>specifier==='node:crypto'?cryptoModule:specifier==='./voice-operation-cpu.js'?cpuModule:(()=>{throw new Error('Unexpected module '+specifier);})());
await ledgerModule.evaluate();
const {createCoreVoiceOperationLedger,validateVoiceScope,validateCpuIdentity}=ledgerModule.namespace;

const sha=value=>createHash('sha256').update(value).digest('hex');
const ddl=readFileSync(new URL('../data/migrations/128_voice_operations.sql',import.meta.url),'utf8');
function fixture({databasePath=':memory:'}={}) {
 const db=new DatabaseSync(databasePath);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0;');
 db.exec(`
 CREATE TABLE users(id TEXT PRIMARY KEY,status TEXT,security_epoch INTEGER);
 CREATE TABLE auth_sessions(id TEXT PRIMARY KEY,user_id TEXT,security_epoch INTEGER,revoked_at TEXT,idle_expires_at TEXT,absolute_expires_at TEXT);
 CREATE TABLE organizations(id TEXT PRIMARY KEY,status TEXT);
 CREATE TABLE projects(id TEXT PRIMARY KEY,organization_id TEXT,archived_at TEXT);
 CREATE TABLE organization_memberships(organization_id TEXT,user_id TEXT,status TEXT,role TEXT);
 CREATE TABLE project_memberships(project_id TEXT,user_id TEXT,role TEXT);
 CREATE TABLE authorized_workspaces(id TEXT PRIMARY KEY,organization_id TEXT,project_id TEXT,owner_user_id TEXT,status TEXT,security_epoch INTEGER);
 CREATE TABLE runtime_instances(id TEXT PRIMARY KEY,workspace_id TEXT,organization_id TEXT,project_id TEXT,owner_user_id TEXT,state TEXT,security_epoch INTEGER,lease_owner_hash TEXT,lease_expires_at TEXT,absolute_expires_at TEXT);
 `+ddl);
 const now=Date.parse('2026-10-30T12:00:00Z');
 const scope={actorId:'user-a',accountId:'actual-account-a',organizationId:'org-a',projectId:'project-a',conversationId:'actual-conversation-a',runtimeId:randomUUID(),executionBindingId:'actual-binding-a',executionRevision:'opaque-revision-4',agentId:'actual-agent-a'};
 const owner={instanceId:'fixture-instance',bootId:randomUUID(),ownerId:randomUUID(),ownerGeneration:1,leaseId:'non-secret-original-lease-reference'};
 const state={now,scope,owner,userEpoch:2,workspaceEpoch:3,runtimeEpoch:3,selected:true,contextDeadline:now+60000,authenticated:true,proof:null,checkpoints:0,failCheckpoint:false,depth:0,denyAction:null,authorizations:0,contextInputs:[],retirementCalls:0};
 db.prepare('INSERT INTO users VALUES(?,?,?)').run(scope.actorId,'active',2);
 db.prepare('INSERT INTO users VALUES(?,?,?)').run('user-b','active',2);
 db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?,?,?)').run('auth-a',scope.actorId,2,null,new Date(now+60000).toISOString(),new Date(now+120000).toISOString());
 db.prepare('INSERT INTO organizations VALUES(?,?)').run(scope.organizationId,'active');
 db.prepare('INSERT INTO projects VALUES(?,?,?)').run(scope.projectId,scope.organizationId,null);
 db.prepare('INSERT INTO organization_memberships VALUES(?,?,?,?)').run(scope.organizationId,scope.actorId,'active','member');
 db.prepare('INSERT INTO project_memberships VALUES(?,?,?)').run(scope.projectId,scope.actorId,'editor');
 db.prepare('INSERT INTO authorized_workspaces VALUES(?,?,?,?,?,?)').run('workspace-a',scope.organizationId,scope.projectId,scope.actorId,'authorized',3);
 db.prepare('INSERT INTO runtime_instances VALUES(?,?,?,?,?,?,?,?,?,?)').run(scope.runtimeId,'workspace-a',scope.organizationId,scope.projectId,scope.actorId,'READY',3,'a'.repeat(64),new Date(now+60000).toISOString(),new Date(now+120000).toISOString());
 const privateOwners=new Map();
 const ports={db:()=>db,now:()=>state.now,transaction:(work,mode)=>{
   db.exec(mode==='immediate'?'BEGIN IMMEDIATE':'BEGIN');state.depth++;
   try{const result=work();assert.equal(typeof result?.then,'undefined');db.exec('COMMIT');return result;}
   catch(error){db.exec('ROLLBACK');throw error;}finally{state.depth--;}
 },checkpoint:()=>{assert.equal(state.depth,0);state.checkpoints++;if(state.failCheckpoint){state.failCheckpoint=false;throw new Error('checkpoint unavailable');}},
 currentScope:(context,requested,action)=>{
   state.authorizations++;state.contextInputs.push(context);
   if(context!==privateContext&&!privateOwners.has(context)||!state.authenticated||state.denyAction===action)throw new Error('actual request authority refused');
   return {scope:structuredClone(state.scope),authSessionId:'auth-a',workspaceId:'workspace-a',userSecurityEpoch:state.userEpoch,workspaceSecurityEpoch:state.workspaceEpoch,runtimeSecurityEpoch:state.runtimeEpoch,deadlineAt:state.contextDeadline,owner:structuredClone(state.owner),mode:'hosted',selectedConversationVerified:state.selected};
 },verifyRetirement:(...args)=>{state.retirementCalls++;return state.retirementHook?state.retirementHook(...args):state.proof;},requireOriginalResource:(context,operation,action,request)=>{
   const heldOwner=privateOwners.get(context);if(!heldOwner)throw new Error('actual original capability required');
   return {operationId:request.operationId??null,owner:structuredClone(heldOwner),instanceId:heldOwner.instanceId};
 }};
 const privateContext=Object.freeze({fixturePrivateRequest:true});
 const nodeContext=Object.freeze({fixtureOriginalNodeCapability:true});privateOwners.set(nodeContext,owner);
 const ledger=createCoreVoiceOperationLedger(ports);
 const original=(patch={})=>({operationId:randomUUID(),requestId:'voice:actual-session:'+randomUUID(),kind:'voice-agent-turn',scope:structuredClone(scope),turnGeneration:0,inputSha256:sha('actual input bytes'),parentOperationId:null,controlOperationId:null,control:null,deadlineAt:now+30000,cpuIdentity:null,...patch});
 const reserve=(o=original())=>ledger.reserve(privateContext,o,owner);
 const change=(op,to='running',extra={})=>({operationId:op.original.operationId,expectedRevision:op.revision,owner:op.owner,from:op.state,to,...extra});
 const proof=(op,outcome='completed',fingerprint=sha('actual result bytes'))=>({operationId:op.original.operationId,owner:structuredClone(op.owner),identity:op.original.cpuIdentity,retentionId:randomUUID(),drained:true,outcome,resultFingerprint:fingerprint});
 const createControl=(workerBootId=randomUUID())=>{
   const control={instanceId:owner.instanceId,profileDigest:sha('actual immutable CPU profile'),recoveryEndpointIdentity:'fixture-original-private-helper',retirementSecretSha256:sha('fixture-secret-not-retained')};
   const controlOriginal=original({kind:'voice-cpu-supervisor',inputSha256:control.profileDigest,control});
   const retained=ledger.reserveControl(nodeContext,{original:controlOriginal,owner,control});
   const bound=ledger.bindWorkerBoot(nodeContext,{operationId:controlOriginal.operationId,owner,workerBootId,physicalProof:{actualFixtureHelper:true}});
   return {operation:bound,workerBootId,control};
 };
 const cpuOperation=(control=createControl())=>{
   const operationId=randomUUID(),identity={instanceId:owner.instanceId,bootId:control.workerBootId,ownerId:owner.ownerId,ownerGeneration:owner.ownerGeneration,requestId:operationId,operationId,generation:randomUUID(),kind:'transcribe',digest:sha('transcribe\0actual PCM bytes')};
   const value=original({operationId,kind:'voice-speech-stt',inputSha256:identity.digest,cpuIdentity:identity,controlOperationId:control.operation.original.operationId});
   return {operation:reserve(value).operation,identity,control};
 };
 let closed=false;
 return {db,state,ports,ledger,context:privateContext,nodeContext,scope,owner,original,reserve,change,proof,createControl,cpuOperation,privateOwners,close:()=>{if(!closed){db.close();closed=true;}}};
}
const run=async action=>{const f=fixture();try{return await action(f);}finally{f.close();}};

test('exact nine-key portable voice scope and separate CPU UUID generation remain closed',()=>run(f=>{
 assert.deepEqual(validateVoiceScope(f.scope),f.scope);
 assert.throws(()=>validateVoiceScope({...f.scope,workspaceId:'renderer-guess'}),/SHAPE/);
 const operationId=randomUUID(),cpu={instanceId:f.owner.instanceId,bootId:randomUUID(),ownerId:f.owner.ownerId,ownerGeneration:1,requestId:operationId,operationId,generation:randomUUID(),kind:'transcribe',digest:sha('transcribe\0PCM')};
 assert.deepEqual(validateCpuIdentity(cpu),cpu);assert.throws(()=>validateCpuIdentity({...cpu,generation:0}),/CPU_IDENTITY/);
 assert.throws(()=>validateCpuIdentity({...cpu,ownerGeneration:true}),/CPU_IDENTITY/);
 const control=f.createControl(cpu.bootId);
 const result=f.reserve(f.original({operationId,kind:'voice-speech-stt',cpuIdentity:cpu,inputSha256:cpu.digest,controlOperationId:control.operation.original.operationId}));assert.equal(result.accepted,true);
}));

test('fresh reserve is one-shot, changed original/UUID relabel cannot bypass durable deduplication',()=>run(f=>{
 const original=f.original(),first=f.reserve(original);assert.equal(first.accepted,true);assert.equal(first.operation.revision,0);
 const replay=f.reserve(original);assert.equal(replay.accepted,false);assert.equal(replay.fresh,false);
 assert.throws(()=>f.reserve({...original,inputSha256:sha('changed')}),/REUSE_CONFLICT/);
 assert.throws(()=>f.reserve({...original,operationId:randomUUID()}),/REQUEST_ALREADY_RETAINED/);
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM veyra_voice_operations').get().n,1);
}));

test('read missing is authenticated, remains absent and never invents dispatch/retirement',()=>run(f=>{
 const id=randomUUID();assert.equal(f.ledger.read(f.context,id),null);assert.equal(f.state.authorizations,1);
 assert.throws(()=>f.ledger.read({renderer:true},id),/request authority refused/);
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM veyra_voice_operations').get().n,0);
}));

test('actual current context and selected conversation cannot be replaced by renderer scope/echo or Native mode',()=>run(f=>{
 assert.throws(()=>f.ledger.reserve({renderer:true},f.original(),f.owner),/request authority refused/);
 assert.throws(()=>f.reserve(f.original({scope:{...f.scope,conversationId:'another-conversation'}})),/CONTEXT_UNAVAILABLE/);
 f.state.selected=false;assert.throws(()=>f.reserve(),/CONTEXT_UNAVAILABLE/);
 f.state.selected=true;const native=createCoreVoiceOperationLedger({...f.ports,currentScope:(...args)=>({...f.ports.currentScope(...args),mode:'native'})});
 assert.throws(()=>native.reserve(f.context,f.original(),f.owner),/CONTEXT_UNAVAILABLE/);
 assert.throws(()=>createCoreVoiceOperationLedger({...f.ports,currentScope:undefined}),/BINDING_REQUIRED/);
}));

test('Core user/session/security epoch and organization/membership/project checks are independent of callback allow',()=>run(f=>{
 const original=f.original();f.db.exec("UPDATE users SET status='disabled' WHERE id='user-a'");assert.throws(()=>f.reserve(original),/UNAUTHENTICATED/);
 f.db.exec("UPDATE users SET status='active'; UPDATE auth_sessions SET revoked_at='revoked'");assert.throws(()=>f.reserve(original),/UNAUTHENTICATED/);
 f.db.exec("UPDATE auth_sessions SET revoked_at=NULL; UPDATE organizations SET status='suspended'");assert.throws(()=>f.reserve(original),/FORBIDDEN/);
 f.db.exec("UPDATE organizations SET status='active'; UPDATE organization_memberships SET status='suspended'");assert.throws(()=>f.reserve(original),/FORBIDDEN/);
 f.db.exec("UPDATE organization_memberships SET status='active'; UPDATE projects SET archived_at='archived'");assert.throws(()=>f.reserve(original),/FORBIDDEN/);
}));

test('workspace/runtime tenant/owner/epochs and ready lease are checked from real SQL rows',()=>run(f=>{
 const original=f.original();f.db.exec("UPDATE runtime_instances SET owner_user_id='user-b'");assert.throws(()=>f.reserve(original),/RUNTIME_SCOPE_CHANGED/);
 f.db.exec("UPDATE runtime_instances SET owner_user_id='user-a'; UPDATE authorized_workspaces SET status='revoked'");assert.throws(()=>f.reserve(original),/RUNTIME_SCOPE_CHANGED/);
 f.db.exec("UPDATE authorized_workspaces SET status='authorized',security_epoch=4");assert.throws(()=>f.reserve(original),/RUNTIME_SCOPE_CHANGED/);
 f.db.exec("UPDATE authorized_workspaces SET security_epoch=3; UPDATE runtime_instances SET state='STOPPED'");assert.throws(()=>f.reserve(original),/RUNTIME_UNAVAILABLE/);
 f.db.exec("UPDATE runtime_instances SET state='READY',lease_expires_at='2000-01-01T00:00:00Z'");assert.throws(()=>f.reserve(original),/RUNTIME_UNAVAILABLE/);
}));

test('viewer, expired context/session and missing hosted project never acquire dispatch',()=>run(f=>{
 f.db.exec("UPDATE project_memberships SET role='viewer'");assert.throws(()=>f.reserve(),/FORBIDDEN/);
 f.db.exec("UPDATE project_memberships SET role='editor'");f.state.contextDeadline=f.state.now;assert.throws(()=>f.reserve(),/CONTEXT_EXPIRED/);
 f.state.contextDeadline=f.state.now+60000;f.db.exec("UPDATE auth_sessions SET idle_expires_at='invalid'");assert.throws(()=>f.reserve(),/UNAUTHENTICATED/);
 f.db.exec("UPDATE auth_sessions SET idle_expires_at='2026-10-30T12:01:00Z'");f.state.scope={...f.scope,projectId:null};assert.throws(()=>f.reserve(f.original({scope:f.state.scope})),/HOSTED_RUNTIME_REQUIRED/);
}));

test('checked CAS permits exactly one original owner dispatch and rejects stale revisions/new CPU boot',()=>run(f=>{
 const op=f.reserve().operation,change=f.change(op),running=f.ledger.cas(f.context,change);
 assert.equal(running.state,'running');assert.equal(running.revision,1);
 assert.throws(()=>f.ledger.cas(f.context,change),/REVISION_CONFLICT/);
 const next=f.reserve().operation;f.state.owner={...f.owner,bootId:randomUUID()};
 assert.throws(()=>f.ledger.cas(f.context,f.change(next)),/ORIGINAL_OWNER_CHANGED/);
}));

test('Core checks revocation again between durable reservation and dispatch claim',()=>run(f=>{
 const op=f.reserve().operation;f.db.exec("UPDATE auth_sessions SET revoked_at='revoked'");
 assert.throws(()=>f.ledger.cas(f.context,f.change(op)),/UNAUTHENTICATED/);
 assert.equal(f.db.prepare('SELECT state FROM veyra_voice_operations').get().state,'reserved');
}));

test('terminal requires positive original retirement, exact fingerprint and matching owner proof',()=>run(f=>{
 const running=f.ledger.cas(f.context,f.change(f.reserve().operation));const fingerprint=sha('actual result bytes');
 f.state.proof=true;assert.throws(()=>f.ledger.settle(f.context,f.change(running,'terminal',{outcome:'completed',resultFingerprint:fingerprint,proof:{ack:true}})),/SHAPE/);
 f.state.proof=f.proof(running);f.state.proof.owner.bootId=randomUUID();assert.throws(()=>f.ledger.settle(f.context,f.change(running,'terminal',{outcome:'completed',resultFingerprint:fingerprint,proof:{}})),/RETIREMENT_UNCONFIRMED/);
 f.state.proof=f.proof(running);const done=f.ledger.settle(f.context,f.change(running,'terminal',{outcome:'completed',resultFingerprint:fingerprint,proof:{privateProofHandle:true}}));
 assert.equal(done.retired,true);assert.equal(done.replayAllowed,false);assert.equal(done.resultFingerprint,fingerprint);
 assert.throws(()=>f.ledger.settle(f.context,f.change(done,'terminal',{outcome:'completed',resultFingerprint:fingerprint,proof:{}})),/TERMINAL_IMMUTABLE/);
 assert.throws(()=>f.db.prepare('UPDATE veyra_voice_operations SET result_fingerprint=? WHERE operation_id=?').run(sha('replacement'),done.original.operationId),/terminal is immutable/);
}));

test('public quarantine after restart/deadline stays immutable unknown and never grants owner takeover',()=>run(f=>{
 const running=f.ledger.cas(f.context,f.change(f.reserve().operation));f.state.owner={...f.owner,bootId:randomUUID()};
 f.state.now+=31000;const unknown=f.ledger.quarantine(f.context,running.original.operationId,running.revision,'CPU_BOOT_CHANGED');
 assert.equal(unknown.state,'terminal');assert.equal(unknown.outcome,'unknown');assert.equal(unknown.retired,false);assert.equal(unknown.owner.bootId,f.owner.bootId);
 assert.throws(()=>f.ledger.cas(f.context,f.change(unknown)),/TRANSITION_INVALID/);
 f.state.proof=f.proof(unknown,'cancelled',null);
 assert.throws(()=>f.ledger.settle(f.context,f.change(unknown,'terminal',{outcome:'cancelled',proof:{originalOwnerProof:true}})),/TERMINAL_IMMUTABLE/);
}));

test('lost checkpoint after durable reserve cannot authorize a fresh dispatch on retry',()=>run(f=>{
 const original=f.original();f.state.failCheckpoint=true;assert.throws(()=>f.reserve(original),/checkpoint unavailable/);
 assert.equal(f.reserve(original).accepted,false);assert.equal(f.ledger.read(f.context,original.operationId).state,'reserved');
}));

test('terminal write failure rolls SQL back and original remains running for explicit quarantine/recovery only',()=>run(f=>{
 const running=f.ledger.cas(f.context,f.change(f.reserve().operation)),fingerprint=sha('actual result bytes');f.state.proof=f.proof(running);
 f.db.exec("CREATE TRIGGER fail_voice_terminal BEFORE UPDATE ON veyra_voice_operations WHEN NEW.state='terminal' BEGIN SELECT RAISE(ABORT,'synthetic terminal failure'); END");
 assert.throws(()=>f.ledger.settle(f.context,f.change(running,'terminal',{outcome:'completed',resultFingerprint:fingerprint,proof:{}})),/synthetic terminal failure/);
 assert.equal(f.ledger.read(f.context,running.original.operationId).state,'running');
 assert.throws(()=>f.ledger.quarantine(f.context,running.original.operationId,running.revision,'RETENTION_UNCONFIRMED'),/synthetic terminal failure/);
 f.db.exec('DROP TRIGGER fail_voice_terminal');
 assert.equal(f.ledger.quarantine(f.context,running.original.operationId,running.revision,'RETENTION_UNCONFIRMED').outcome,'unknown');
}));

const cpuRequest=(f,operation,identity,extra={})=>({operationId:operation.original.operationId,owner:f.owner,identity,expectedCpuRevision:operation.cpu?.revision??0,...extra});
function retain(f,operation,identity,phase,outcome=null,drained=false,patch={}) {
 return f.ledger.retainCpu(f.nodeContext,cpuRequest(f,operation,identity,{transactionId:randomUUID(),phase,outcome,drained,...patch}));
}
function readCpu(f,operation){return f.ledger.privateRead(f.nodeContext,{operationId:operation.original.operationId,owner:f.owner});}
function runningCpu(f) {
 const {operation,identity,control}=f.cpuOperation();
 const permit=f.ledger.claimCpuDispatch(f.nodeContext,cpuRequest(f,operation,identity));assert.equal(permit.revision,0);
 retain(f,readCpu(f,operation),identity,'reserved');
 retain(f,readCpu(f,operation),identity,'running');
 return {operation:readCpu(f,operation),identity,control};
}

test('private CPU claim is durable once BEFORE HTTP reservation, independent Node/Python boots and CPU/public revisions',()=>run(f=>{
 const {operation,identity}=f.cpuOperation();assert.notEqual(identity.bootId,f.owner.bootId);
 assert.throws(()=>f.ledger.claimCpuDispatch(f.context,cpuRequest(f,operation,identity)),/actual original capability required/);
 const claimed=f.ledger.claimCpuDispatch(f.nodeContext,cpuRequest(f,operation,identity));assert.equal(claimed.revision,0);
 const held=readCpu(f,operation);assert.equal(held.state,'running');assert.equal(held.revision,1);assert.equal(held.cpu.revision,0);
 assert.throws(()=>f.ledger.claimCpuDispatch(f.nodeContext,cpuRequest(f,held,identity)),/ALREADY_CLAIMED/);
 assert.equal(held.cpu.dispatchClaimed,true);
}));

test('retainCpu returns exact durable ACK across lost ACK, reserved repeat and historical retry; conflicts do not mutate',()=>run(f=>{
 const {operation,identity}=f.cpuOperation();f.ledger.claimCpuDispatch(f.nodeContext,cpuRequest(f,operation,identity));
 const request=cpuRequest(f,operation,identity,{transactionId:randomUUID(),phase:'reserved',outcome:null,drained:false});
 f.state.failCheckpoint=true;assert.throws(()=>f.ledger.retainCpu(f.nodeContext,request),/checkpoint unavailable/);
 const ack=f.ledger.retainCpu(f.nodeContext,request);assert.equal(ack.revision,1);
 const second=retain(f,readCpu(f,operation),identity,'reserved');assert.equal(second.revision,2);
 assert.deepEqual(f.ledger.retainCpu(f.nodeContext,request),ack);
 assert.throws(()=>f.ledger.retainCpu(f.nodeContext,{...request,phase:'running'}),/TRANSACTION_CONFLICT/);
 assert.equal(readCpu(f,operation).cpu.revision,2);
}));

test('CPU reserved-to-running rechecks current scope and SQL revocation BEFORE FFI ACK',()=>run(f=>{
 const {operation,identity}=f.cpuOperation();f.ledger.claimCpuDispatch(f.nodeContext,cpuRequest(f,operation,identity));retain(f,readCpu(f,operation),identity,'reserved');
 f.db.exec("UPDATE auth_sessions SET revoked_at='revoked'");assert.throws(()=>retain(f,readCpu(f,operation),identity,'running'),/UNAUTHENTICATED/);
 assert.equal(readCpu(f,operation).cpu.phase,'reserved');assert.equal(readCpu(f,operation).cpu.revision,1);
}));

test('lost dispatch permit response spends the original and cannot mint a replacement permit',()=>run(f=>{
 const {operation,identity}=f.cpuOperation();f.state.failCheckpoint=true;
 assert.throws(()=>f.ledger.claimCpuDispatch(f.nodeContext,cpuRequest(f,operation,identity)),/checkpoint unavailable/);
 assert.equal(readCpu(f,operation).cpu.dispatchClaimed,true);
 assert.throws(()=>f.ledger.claimCpuDispatch(f.nodeContext,cpuRequest(f,operation,identity)),/ALREADY_CLAIMED/);
}));

test('uncertain worker callback has its own durable transactional ACK, never a quarantine flag substitute',()=>run(f=>{
 const {operation,identity}=runningCpu(f);
 const request=cpuRequest(f,operation,identity,{transactionId:randomUUID(),phase:'uncertain',outcome:null,drained:false});
 const ack=f.ledger.retainCpu(f.nodeContext,request);assert.equal(ack.revision,operation.cpu.revision+1);
 assert.deepEqual(f.ledger.retainCpu(f.nodeContext,request),ack);
 const unknown=readCpu(f,operation);assert.equal(unknown.cpu.phase,'uncertain');assert.equal(unknown.cpu.drained,false);
 assert.equal(unknown.cpu.retentionId,ack.retentionId);assert.equal(unknown.outcome,'unknown');assert.equal(unknown.resourceRetired,false);
 assert.throws(()=>retain(f,unknown,identity,'running'),/TRANSITION_INVALID/);
 f.state.scope={...f.scope,conversationId:'changed-selected-conversation'};
 const terminal=retain(f,unknown,identity,'terminal','cancelled',true);assert.equal(terminal.revision,ack.revision+1);
 assert.equal(readCpu(f,operation).outcome,'unknown');
}));

test('CPU terminal commit is private, fingerprint follows terminal, public completion requires actual consumer settlement',()=>run(f=>{
 const {operation,identity}=runningCpu(f);
 f.state.proof=f.proof(operation,'cancelled',null);
 assert.throws(()=>f.ledger.settle(f.context,f.change(operation,'terminal',{outcome:'cancelled',proof:{booleanAckIsNotProducerTerminal:true}})),/CPU_RESULT_UNCONFIRMED/);
 const fp={status:200,contentType:'application/json',sha256:sha('actual CPU response'),bytes:64};
 assert.throws(()=>f.ledger.recordCpuResult(f.nodeContext,cpuRequest(f,operation,identity,{resultFingerprint:fp})),/TERMINAL_UNCONFIRMED/);
 const ack=retain(f,operation,identity,'terminal','completed',true),terminal=readCpu(f,operation);
 assert.equal(terminal.cpu.retentionId,ack.retentionId);assert.equal(terminal.state,'running');assert.equal(terminal.outcome,null);
 f.state.proof=f.proof(terminal,'completed',fp.sha256);
 assert.throws(()=>f.ledger.settle(f.context,f.change(terminal,'terminal',{outcome:'completed',resultFingerprint:fp.sha256,proof:{}})),/CPU_RESULT_UNCONFIRMED/);
 const held=f.ledger.recordCpuResult(f.nodeContext,cpuRequest(f,terminal,identity,{resultFingerprint:fp}));
 f.state.proof.retentionId=ack.retentionId;
 assert.equal(held.cpu.revision,ack.revision);assert.equal(held.outcome,null);
 assert.throws(()=>f.ledger.recordCpuResult(f.nodeContext,cpuRequest(f,held,identity,{resultFingerprint:{...fp,sha256:sha('replacement')}})),/RESULT_IMMUTABLE/);
 const completed=f.ledger.settle(f.context,f.change(held,'terminal',{outcome:'completed',resultFingerprint:fp.sha256,proof:{actualOriginalReceipt:true}}));
 assert.equal(completed.outcome,'completed');assert.equal(completed.retired,true);
}));

test('public unknown stays immutable while old capability finalizes CPU terminal/fingerprint/retirement after UI selection changes',()=>run(f=>{
 const {operation,identity}=runningCpu(f);
 const unknown=f.ledger.quarantineCpu(f.nodeContext,cpuRequest(f,operation,identity,{reason:'LOST_BODY'}));
 assert.equal(unknown.outcome,'unknown');assert.equal(unknown.cpu.phase,'uncertain');
 f.state.scope={...f.scope,conversationId:'new-selected-conversation'};
 assert.throws(()=>f.ledger.read(f.context,operation.original.operationId),/CONTEXT_UNAVAILABLE/);
 const ack=retain(f,readCpu(f,operation),identity,'terminal','completed',true);
 const terminal=readCpu(f,operation);assert.equal(terminal.outcome,'unknown');assert.equal(terminal.cpu.phase,'terminal');
 const held=f.ledger.recordCpuResult(f.nodeContext,cpuRequest(f,terminal,identity,{resultFingerprint:{status:200,contentType:'application/json',sha256:sha('late observed response'),bytes:64}}));
 f.state.proof=f.proof(held,'completed',null);f.state.proof.retentionId=ack.retentionId;
 const retired=f.ledger.retireOriginal(f.nodeContext,{operationId:operation.original.operationId,owner:f.owner,physicalProof:{heldOriginalOwner:true}});
 assert.equal(retired.resourceRetired,true);assert.equal(retired.outcome,'unknown');assert.equal(retired.replayAllowed,false);
 assert.equal(retired.retired,false); // Public result did not become successful.
 assert.equal(retired.resourceRetirement.retentionId,ack.retentionId);
 assert.throws(()=>f.db.prepare('UPDATE veyra_voice_operations SET resource_retired=0,resource_retirement_json=NULL,private_revision=private_revision+1 WHERE operation_id=?').run(operation.original.operationId),/private resource/);
}));

test('one hot fixed-instance control blocks scope replacement until positive old tree retirement and monotonic generation',()=>run(f=>{
 const control=f.createControl();f.ledger.quarantine(f.context,control.operation.original.operationId,control.operation.revision,'SUPERVISOR_UNKNOWN');
 const nextOwner={...f.owner,bootId:randomUUID(),ownerGeneration:2,leaseId:'next-actual-lease'};f.state.owner=nextOwner;
 const nextContext=Object.freeze({fixtureNewNodeCapability:true});f.privateOwners.set(nextContext,nextOwner);
 f.state.scope={...f.scope,conversationId:'new-selected-conversation'};
 const spec={...control.control,profileDigest:sha('new actual profile')};
 const next=f.original({scope:f.state.scope,kind:'voice-cpu-supervisor',inputSha256:spec.profileDigest,control:spec});
 assert.throws(()=>f.ledger.reserveControl(nextContext,{original:next,owner:nextOwner,control:spec}),/UNIQUE/);
 assert.equal(f.ledger.listControls(nextContext,{instanceId:nextOwner.instanceId,owner:nextOwner}).length,1);
 f.state.proof=true;assert.throws(()=>f.ledger.retireOriginal(f.nodeContext,{operationId:control.operation.original.operationId,owner:f.owner,physicalProof:{pidAbsent:true}}),/RETIREMENT_UNCONFIRMED/);
 const original=f.ledger.privateRead(f.nodeContext,{operationId:control.operation.original.operationId,owner:f.owner});f.state.proof=f.proof(original,'unknown',null);
 f.ledger.retireOriginal(f.nodeContext,{operationId:control.operation.original.operationId,owner:f.owner,physicalProof:{actualJoinedOriginalTree:true}});
 const sameGeneration={...nextOwner,ownerGeneration:1};const sameContext=Object.freeze({fixtureBadReusedGeneration:true});f.privateOwners.set(sameContext,sameGeneration);f.state.owner=sameGeneration;
 assert.throws(()=>f.ledger.reserveControl(sameContext,{original:next,owner:sameGeneration,control:spec}),/generation must increase/);
 f.state.owner=nextOwner;
 const nextRetained=f.ledger.reserveControl(nextContext,{original:next,owner:nextOwner,control:spec});assert.equal(nextRetained.accepted,true);
 assert.equal(f.ledger.privateRead(f.nodeContext,{operationId:control.operation.original.operationId,owner:f.owner}).outcome,'unknown');
}));

function positiveControlProof(f,control,physicalProof) {
 const calls=[];
 f.state.retirementHook=(_context,operation,proof)=>{
   assert.equal(proof,physicalProof);calls.push(operation.original.operationId);
   if(operation.original.operationId!==control.operation.original.operationId){
     assert.equal(operation.original.controlOperationId,control.operation.original.operationId);
     assert.deepEqual(operation.owner,f.owner);
   }
   const receipt=f.proof(operation,'unknown',null);
   if(operation.cpu?.phase==='terminal')receipt.retentionId=operation.cpu.retentionId;
   return receipt;
 };
 return calls;
}
function cloneCpuFixture(f,template,patch={}) {
 const original=structuredClone(template.original),operationId=randomUUID();
 original.operationId=operationId;original.requestId='voice:fixture-clone:'+operationId;
 original.cpuIdentity.operationId=operationId;original.cpuIdentity.requestId=operationId;
 const source=f.db.prepare('SELECT * FROM veyra_voice_operations WHERE operation_id=?').get(template.original.operationId);
 const cpu=JSON.parse(source.cpu_json);cpu.identity=original.cpuIdentity;
 Object.assign(source,{operation_id:operationId,request_id:original.requestId,original_json:JSON.stringify(original),cpu_identity_json:JSON.stringify(original.cpuIdentity),cpu_json:JSON.stringify(cpu),...patch});
 const keys=Object.keys(source);f.db.prepare('INSERT INTO veyra_voice_operations('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>source[k]));
 return operationId;
}

test('control retirement verifies the SAME physical proof per exact leaf and atomically seals private resources only',()=>run(f=>{
 const control=f.createControl(),first=f.cpuOperation(control),second=f.cpuOperation(control);
 const unknown=f.ledger.quarantineCpu(f.nodeContext,cpuRequest(f,first.operation,first.identity,{reason:'WORKER_LOST'}));
 f.ledger.claimCpuDispatch(f.nodeContext,cpuRequest(f,second.operation,second.identity));
 retain(f,readCpu(f,second.operation),second.identity,'reserved');retain(f,readCpu(f,second.operation),second.identity,'running');retain(f,readCpu(f,second.operation),second.identity,'terminal','completed',true);
 const terminal=readCpu(f,second.operation);
 f.ledger.recordCpuResult(f.nodeContext,cpuRequest(f,terminal,second.identity,{resultFingerprint:{status:200,contentType:'application/json',sha256:sha('actual retained response'),bytes:64}}));
 f.ledger.quarantine(f.context,second.operation.original.operationId,terminal.revision,'BODY_UNAVAILABLE');
 const before=[readCpu(f,first.operation),readCpu(f,second.operation)];
 const physicalProof=Object.freeze({fixtureJoinedExactOriginalGroup:true});const calls=positiveControlProof(f,control,physicalProof);
 f.state.scope={...f.scope,conversationId:'new-selected-conversation'};
 const retired=f.ledger.retireOriginal(f.nodeContext,{operationId:control.operation.original.operationId,owner:f.owner,physicalProof});
 assert.equal(retired.resourceRetired,true);assert.equal(calls.length,3);
 for(const previous of before){const after=readCpu(f,previous);assert.equal(after.resourceRetired,true);assert.equal(after.outcome,'unknown');assert.equal(after.revision,previous.revision);assert.deepEqual(after.cpu,previous.cpu);}
 assert.equal(unknown.cpu.drained,false);assert.equal(readCpu(f,first.operation).cpu.drained,false);
 const count=calls.length;f.ledger.retireOriginal(f.nodeContext,{operationId:control.operation.original.operationId,owner:f.owner,physicalProof});assert.equal(calls.length,count);
}));

test('a failed leaf proof or later SQL retirement failure rolls the entire control cascade back',()=>run(f=>{
 const control=f.createControl(),a=f.cpuOperation(control),b=f.cpuOperation(control),physicalProof={fixtureJoinedOriginalGroup:true};
 const calls=positiveControlProof(f,control,physicalProof),positive=f.state.retirementHook;
 f.state.retirementHook=(...args)=>{const receipt=positive(...args);if(args[1].original.operationId===b.operation.original.operationId)throw new Error('original leaf proof unavailable');return receipt;};
 const request={operationId:control.operation.original.operationId,owner:f.owner,physicalProof};
 assert.throws(()=>f.ledger.retireOriginal(f.nodeContext,request),/leaf proof unavailable/);
 assert.equal(f.db.prepare('SELECT sum(resource_retired) AS n FROM veyra_voice_operations').get().n,0);
 f.state.retirementHook=positive;
 const last=[a.operation.original.operationId,b.operation.original.operationId].sort().at(-1);
 f.db.exec("CREATE TRIGGER fixture_later_leaf_failure BEFORE UPDATE ON veyra_voice_operations WHEN NEW.operation_id='"+last+"' AND NEW.resource_retired=1 BEGIN SELECT RAISE(ABORT,'later leaf write failure'); END");
 assert.throws(()=>f.ledger.retireOriginal(f.nodeContext,request),/later leaf write failure/);
 assert.equal(f.db.prepare('SELECT sum(resource_retired) AS n FROM veyra_voice_operations').get().n,0);
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM veyra_voice_operations WHERE resource_retirement_json IS NOT NULL').get().n,0);
 f.db.exec('DROP TRIGGER fixture_later_leaf_failure');assert.equal(f.ledger.retireOriginal(f.nodeContext,request).resourceRetired,true);
 assert.equal(f.db.prepare('SELECT sum(resource_retired) AS n FROM veyra_voice_operations').get().n,3);
}));

test('cascade excludes foreign Node owner/boot/generation/lease even when a legacy row references this control',()=>run(f=>{
 const control=f.createControl(),leaf=f.cpuOperation(control);
 const originalOwner=JSON.parse(f.db.prepare('SELECT owner_json FROM veyra_voice_operations WHERE operation_id=?').get(leaf.operation.original.operationId).owner_json);
 const foreignIds=[{ownerId:randomUUID()},{bootId:randomUUID()},{ownerGeneration:2},{leaseId:'foreign-original-lease'}].map(change=>cloneCpuFixture(f,leaf.operation,{owner_json:JSON.stringify({...originalOwner,...change}),owner_generation:change.ownerGeneration??1}));
 const physicalProof={fixtureJoinedOriginalGroup:true};const calls=positiveControlProof(f,control,physicalProof);
 f.ledger.retireOriginal(f.nodeContext,{operationId:control.operation.original.operationId,owner:f.owner,physicalProof});
 assert.equal(readCpu(f,leaf.operation).resourceRetired,true);
 for(const foreign of foreignIds){assert.equal(calls.includes(foreign),false);assert.equal(f.db.prepare('SELECT resource_retired FROM veyra_voice_operations WHERE operation_id=?').get(foreign).resource_retired,0);}
}));

test('a matching owner/control with contradictory scope fails closed without partial resource retirement',()=>run(f=>{
 const control=f.createControl(),leaf=f.cpuOperation(control);
 cloneCpuFixture(f,leaf.operation,{scope_hash:sha('foreign-scope')});
 const physicalProof={fixtureJoinedOriginalGroup:true};positiveControlProof(f,control,physicalProof);
 assert.throws(()=>f.ledger.retireOriginal(f.nodeContext,{operationId:control.operation.original.operationId,owner:f.owner,physicalProof}),/LEAF_SCOPE_CHANGED/);
 assert.equal(f.state.retirementCalls,0);assert.equal(f.db.prepare('SELECT sum(resource_retired) AS n FROM veyra_voice_operations').get().n,0);
}));

test('a previously retired parent still requires positive scope proof to reconcile its unretired original leaves',()=>run(f=>{
 const control=f.createControl(),leaf=f.cpuOperation(control);
 const receipt={operationId:control.operation.original.operationId,owner:f.owner,identity:null,retentionId:randomUUID(),drained:true,verifiedAt:f.state.now};
 // Simulate the valid parent-only receipt written by the prior implementation.
 f.db.prepare('UPDATE veyra_voice_operations SET resource_retired=1,resource_retirement_json=?,private_revision=private_revision+1 WHERE operation_id=?').run(JSON.stringify(receipt),control.operation.original.operationId);
 const physicalProof={fixtureRetainedPositiveOriginalGroupProof:true},request={operationId:control.operation.original.operationId,owner:f.owner,physicalProof};
 assert.throws(()=>f.ledger.retireOriginal(f.nodeContext,request),/RETIREMENT_UNCONFIRMED/);
 assert.equal(readCpu(f,leaf.operation).resourceRetired,false);
 const calls=positiveControlProof(f,control,physicalProof);assert.equal(f.ledger.retireOriginal(f.nodeContext,request).resourceRetired,true);
 assert.equal(calls.length,2);assert.equal(readCpu(f,leaf.operation).resourceRetired,true);
 assert.equal(f.db.prepare('SELECT resource_retirement_json FROM veyra_voice_operations WHERE operation_id=?').get(control.operation.original.operationId).resource_retirement_json,JSON.stringify(receipt));
}));

test('cascade accepts 1024 unretired exact leaves and refuses 1025 before callbacks or mutations',()=>run(f=>{
 const control=f.createControl(),leaf=f.cpuOperation(control);
 for(let n=1;n<1025;n++)f.cpuOperation(control);
 const physicalProof={fixtureJoinedOriginalGroup:true};positiveControlProof(f,control,physicalProof);
 const request={operationId:control.operation.original.operationId,owner:f.owner,physicalProof};
 assert.throws(()=>f.ledger.retireOriginal(f.nodeContext,request),/RETIREMENT_LIMIT/);
 assert.equal(f.state.retirementCalls,0);assert.equal(f.db.prepare('SELECT sum(resource_retired) AS n FROM veyra_voice_operations').get().n,0);
 // One independently proven retired leaf is no longer work for this bounded cascade.
 f.state.proof=f.proof(leaf.operation,'unknown',null);f.state.retirementHook=null;
 f.ledger.retireOriginal(f.nodeContext,{operationId:leaf.operation.original.operationId,owner:f.owner,physicalProof});
 const calls=positiveControlProof(f,control,physicalProof);
 assert.equal(f.ledger.retireOriginal(f.nodeContext,request).resourceRetired,true);assert.equal(calls.length,1025);
 assert.equal(f.db.prepare('SELECT sum(resource_retired) AS n FROM veyra_voice_operations').get().n,1026);
}));

test('source validation matches the actual portable scope and CPUv2 identity implementations',async()=>run(async f=>{
 const integration=process.env.VOICE_LEDGER_INTEGRATION_ROOT;assert.ok(integration&&isAbsolute(integration),'Explicit actual source root required');
 const portable=await import(pathToFileURL(join(integration,'packages/veyra-voice/session.mjs')).href);
 const actual=await import(pathToFileURL(join(integration,'services/ingenium-api/lib/voice-v2/cpu-ownership.mjs')).href);
 assert.deepEqual(validateVoiceScope(f.scope),portable.validateScope(f.scope));
 const {identity}=f.cpuOperation();assert.deepEqual(validateCpuIdentity(identity),actual.cpuIdentity(identity));
 for(const changed of [{...identity,generation:1},{...identity,requestId:randomUUID()},{...identity,ownerGeneration:true},{...identity,unexpected:'renderer'}]){
   assert.throws(()=>validateCpuIdentity(changed));assert.throws(()=>actual.cpuIdentity(changed));
 }
}));

test('two SQLite connections serialize duplicate reservations, stale CAS and busy writer without new admission',()=>{
 const configured=process.env.VOICE_LEDGER_TEST_ROOT;assert.ok(configured&&isAbsolute(configured),'Explicit owned SQLite root required');
 const root=resolve(configured);mkdirSync(root,{recursive:true});assert.equal(lstatSync(root).isSymbolicLink(),false);
 const path=join(root,'voice-ledger-'+process.pid+'.sqlite');assert.equal(existsSync(path),false);
 let f,other;const removed=[];
 try {
   f=fixture({databasePath:path});other=new DatabaseSync(path);other.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0;');
   const connectionLedger=connection=>createCoreVoiceOperationLedger({...f.ports,db:()=>connection,transaction:(work,mode)=>{
     connection.exec(mode==='immediate'?'BEGIN IMMEDIATE':'BEGIN');
     try{const result=work();connection.exec('COMMIT');return result;}catch(error){connection.exec('ROLLBACK');throw error;}
   }});
   const second=connectionLedger(other);
   const original=f.original(),op=f.reserve(original).operation;
   assert.equal(second.reserve(f.context,original,f.owner).accepted,false);
   assert.throws(()=>second.reserve(f.context,{...original,operationId:randomUUID()},f.owner),/REQUEST_ALREADY_RETAINED/);
   f.ledger.cas(f.context,f.change(op));assert.throws(()=>second.cas(f.context,f.change(op)),/REVISION_CONFLICT/);
   const absent=f.original();f.db.exec('BEGIN IMMEDIATE');
   try{assert.throws(()=>second.reserve(f.context,absent,f.owner),/busy|locked/i);}finally{f.db.exec('ROLLBACK');}
   assert.equal(second.read(f.context,absent.operationId),null);
   // Commit succeeded but neither reservation nor CPU ACK reached its caller.
   const lostReservation=f.original();f.state.failCheckpoint=true;
   assert.throws(()=>f.reserve(lostReservation),/checkpoint unavailable/);
   const {operation:cpuOperation,identity}=f.cpuOperation();
   f.ledger.claimCpuDispatch(f.nodeContext,cpuRequest(f,cpuOperation,identity));
   const lostCpuAck=cpuRequest(f,cpuOperation,identity,{transactionId:randomUUID(),phase:'reserved',outcome:null,drained:false});
   f.state.failCheckpoint=true;assert.throws(()=>f.ledger.retainCpu(f.nodeContext,lostCpuAck),/checkpoint unavailable/);
   const retained=JSON.parse(f.db.prepare('SELECT cpu_json FROM veyra_voice_operations WHERE operation_id=?').get(identity.operationId).cpu_json).transactions[lostCpuAck.transactionId].ack;
   other.close();other=null;f.close(); // No SQLite connection remains before cold recovery.
   other=new DatabaseSync(path);other.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0;');
   const cold=connectionLedger(other);
   assert.equal(cold.read(f.context,original.operationId).state,'running');
   assert.equal(cold.reserve(f.context,lostReservation,f.owner).accepted,false);
   assert.deepEqual(cold.retainCpu(f.nodeContext,lostCpuAck),retained);
   assert.equal(cold.privateRead(f.nodeContext,{operationId:identity.operationId,owner:f.owner}).cpu.revision,1);
 } finally {
   other?.close();f?.close();
   for(const suffix of ['','-wal','-shm','-journal']){
     const target=path+suffix;if(!existsSync(target))continue;
     assert.equal(resolve(target).startsWith(root+'/'),true);const info=lstatSync(target);assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1);
     const handles=spawnSync('/usr/bin/fuser',[target]);assert.equal(handles.status,1);assert.equal(handles.stdout.length+handles.stderr.length,0);
     unlinkSync(target);removed.push({path:target,bytes:info.size});
   }
   rmdirSync(root);
   writeFileSync(join(resolve(root,'..'),'voice-ledger-cleanup.json'),JSON.stringify({removed,removedLogicalLinuxBytes:removed.reduce((n,v)=>n+v.bytes,0),retained:[],windowsRecoveryClaim:false,regeneration:'Node built-in SQLite/VM voice-operation-ledger.test.mjs with explicit same owned roots'},null,2)+'\n');
 }
});

test('SQL immutability/revision/no-delete safeguards retain content-free originals',()=>run(f=>{
 const op=f.reserve().operation,id=op.original.operationId;
 assert.throws(()=>f.db.prepare('UPDATE veyra_voice_operations SET input_sha256=? WHERE operation_id=?').run(sha('other'),id),/immutable|revision/);
 assert.throws(()=>f.db.prepare("UPDATE veyra_voice_operations SET state='running' WHERE operation_id=?").run(id),/revision/);
 assert.throws(()=>f.db.prepare('DELETE FROM veyra_voice_operations WHERE operation_id=?').run(id),/retained/);
 const serialized=JSON.stringify(f.db.prepare('SELECT * FROM veyra_voice_operations').get());assert.equal(serialized.includes('actual input bytes'),false);
 assert.equal(serialized.includes('auth-a'),false);assert.equal(serialized.includes('PCM'),false);
}));
