import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {fixture,seedScope} from '../../../docs/workstreams/projects/projectless-context-136/context-fixture.mjs';
import * as context from '../../../packages/ingenium-core/lib/tools/workspace-context-store.mjs';
import {mapCanonicalContextPair,resolveContextPairCandidate} from '../lib/memory-v2/opencode-context-pair.mjs';
import {contextMemorySourceState} from '../lib/memory-v2/source-state.mjs';
import {createOpenCodeSnapshotReader} from '../lib/memory-v2/opencode-snapshot.mjs';
import {createRecallSourceReader} from '../lib/memory-v2/recall-availability.mjs';
import {MemoryLifecycle,scopeKey} from '../lib/memory-v2/lifecycle.mjs';
import {createApiMemorySession} from '../lib/memory-v2/adapters.mjs';
// Canonical store, actual SQL migrations, memory lifecycle and both real reader
// implementations. Authentication/placement/engine transport are explicit unit
// fixtures; this is not physical manager, model, HTTP or deployment acceptance.
async function run(work){const db=fixture();try{
 const original=seedScope(db),hostId=db.prepare('SELECT host_id FROM runtime_original_provisions WHERE runtime_id=?').get(original.runtimeId).host_id;
 const scope={...original,hostId,environmentId:'managed-workspace-runtime-v2:'+'a'.repeat(32),visibility:'private'},execution={...scope,mode:'runtime',available:true,status:'authorized'};
 db.exec(readFileSync(new URL('../../../packages/ingenium-core/data/migrations/123_veyra_memory_lifecycle.sql',import.meta.url),'utf8'));
 const now=Date.now(),done=now-6*3600000-1000,chatId='source-engine',raw='  Exact é\r\npreference  ';
 const tx=work=>db.transaction(work).immediate(),linked=tx(()=>context.linkOriginalEngineInTransaction(db,original,{engineSessionId:chatId,title:'Original source'}));
 const save=(change={})=>tx(()=>context.persistOriginalEngineTurnInTransaction(db,original,linked.conversation.id,{engineSessionId:chatId,userMessageId:'engine-user',assistantMessageId:'engine-assistant',userContent:raw,assistantContent:'Acknowledged',expectedRevision:0,...change}));
 const saved=save(),ref={id:saved.userMessage.id,chatId,contentHash:saved.userMessage.content_hash};
 const key=scopeKey(scope);db.prepare('INSERT INTO veyra_memory_policy VALUES(?,?,?,?,?,?)').run(key,1,1,1,1,0);db.prepare('INSERT INTO veyra_memory_chat_policy VALUES(?,?,?,?,?)').run(key,chatId,1,1,1);
 const envelope=(id,role,content)=>({info:{id,role,sessionID:chatId,time:{created:done-10,...(role==='assistant'?{completed:done}:{})},...(role==='assistant'?{finish:'stop'}:{})},parts:[{id:id+':text',type:'text',text:content,sessionID:chatId,messageID:id}]});
 const envelopes=new Map([['engine-user',envelope('engine-user','user',raw)],['engine-assistant',envelope('engine-assistant','assistant','Acknowledged')]]);
 const owner={scope,execution,ownerInstanceId:'original-fixture-container',directory:'/workspace',target:{baseUrl:'http://fixture:4098',directory:'/workspace',authHeader:'fixture-secret'}};
 const transport={getSession:async()=>({id:chatId,projectID:'engine-internal-project',directory:'/workspace',path:'/workspace',time:{created:done-1000,updated:done}}),getMessages:async()=>structuredClone([...envelopes.values()]),getSessionMessage:async(_owner,_chat,id)=>structuredClone(envelopes.get(id)??{error:{code:'NOT_FOUND'}})};
 const reader=()=>createRecallSourceReader({scope,execution,getDb:()=>db,getOwner:async()=>owner,transport});
 const state=(id,internal={})=>{const row=db.prepare('SELECT conversation_id,content_hash FROM context_messages WHERE id=?').get(id);return row?contextMemorySourceState({db,scope,execution,chatId,messageId:id,conversationId:row.conversation_id,contentHash:row.content_hash,...internal}):null;};
 const memory=internal=>new MemoryLifecycle({db,authorize:()=>true,checkpoint:()=>{},sources:(_scope,_chat,id)=>{const row=db.prepare('SELECT content_hash FROM context_messages WHERE id=?').get(id),current=state(id,internal);return row&&current?{...current,contentHash:row.content_hash,kind:'transcript'}:null;}});
 const f={db,scope,execution,chatId,raw,now,done,save,saved,ref,key,envelope,envelopes,owner,transport,reader,state,memory,contextId:linked.conversation.id};
 await work(f);assert.deepEqual(db.pragma('foreign_key_check'),[]);
}finally{db.close();}}
const candidate=(f,ref=f.ref)=>resolveContextPairCandidate(f.db,{scope:f.scope,execution:f.execution,chatId:f.chatId,sourceRef:ref});
test('maps original null-Project source ledger and immutable checkpoint with exact raw bytes and distinct IDs',()=>run(f=>{
 const pair=candidate(f);assert.equal(pair.conversationId,f.contextId);assert.notEqual(pair.conversationId,f.chatId);assert.equal(pair.user.content,f.raw);assert.deepEqual(pair.sourceRefs,[{id:f.saved.userMessage.id,contentHash:f.saved.userMessage.content_hash},{id:f.saved.assistantMessage.id,contentHash:f.saved.assistantMessage.content_hash}]);
 assert.deepEqual(mapCanonicalContextPair(f.db,{scope:f.scope,execution:f.execution,chatId:f.chatId,user:pair.user,assistant:pair.assistant}),{conversationId:pair.conversationId,sourceRefs:pair.sourceRefs});
}));
for(const [name,axis,value] of [['actor','ownerUserId','other'],['organization','organizationId','foreign'],['workspace','workspaceId','foreign'],['epoch','bindingEpoch',1],['binding','bindingHash','b'.repeat(64)],['host','hostId','other-host'],['environment','environmentId','other-env']])test('refuses source lookup with changed '+name,()=>run(f=>{
 assert.equal(resolveContextPairCandidate(f.db,{scope:{...f.scope,[axis]:value},execution:f.execution,chatId:f.chatId,sourceRef:f.ref}),null);
}));
test('changed engine/runtime and original source IDs never fall back to a global Project',()=>run(f=>{
 assert.equal(resolveContextPairCandidate(f.db,{scope:f.scope,execution:{...f.execution,runtimeId:'other'},chatId:f.chatId,sourceRef:f.ref}),null);
 assert.equal(resolveContextPairCandidate(f.db,{scope:f.scope,execution:f.execution,chatId:'other-engine',sourceRef:f.ref}),null);
 assert.equal(candidate(f,{id:'legacy',contentHash:f.ref.contentHash}),null);assert.equal(candidate(f,{...f.ref,contentHash:'0'.repeat(64)}),null);
}));
test('source/checkpoint existence alone cannot supply a generation or recall observation',()=>run(f=>{
 assert.deepEqual(f.state(f.ref.id),{active:false,excluded:false,uncertain:true,idleEligible:false});const memory=f.memory({});assert.throws(()=>memory.admit(f.scope,f.chatId,[f.ref]),{code:'SOURCE_UNAVAILABLE'});
}));
test('actual opaque completed reader admits and commits to the same null scope; fresh chat retrieves and forget prevents reuse',()=>run(async f=>{
 const snapshotReader=createOpenCodeSnapshotReader({scope:f.scope,execution:f.execution,chatId:f.chatId,minRolloutIdleHours:6,getOwner:async()=>f.owner,transport:f.transport,mapContext:input=>mapCanonicalContextPair(f.db,input),externalContext:async()=>false,clock:()=>f.now});
 const prepared=await snapshotReader.prepare(),internal={completedSnapshot:prepared.snapshot,policy:{version:'codex-memory-source-v1',minRolloutIdleHours:6,scope:f.scope,runtimeId:f.execution.runtimeId}},memory=f.memory(internal);
 const admission=snapshotReader.withVerifiedSources(()=>memory.admit(f.scope,f.chatId,prepared.sourceRefs));await snapshotReader.refresh();
 const committed=snapshotReader.withVerifiedSources(()=>memory.commitRecall(f.scope,{operationId:'learn-projectless',admission,content:'Preserve exact preference',model:'explicit-unit-model'}));assert.equal(committed.receipt.status,'committed');snapshotReader.invalidate();
 // A fresh lifecycle/reader instance uses durable SQL, not a retained admission.
 const read=f.reader(),fresh=f.memory({readAvailability:read.view});let plan=fresh.planSourceReads(f.scope,'fresh-engine');assert.equal(plan.sourceRefs.length,2);assert.equal((await read.prime(plan.sourceRefs)).verifiedSources,2);
 const recalled=read.withVerifiedSources(()=>fresh.withSourceReadPlan(f.scope,'fresh-engine',plan,()=>fresh.recall(f.scope,'fresh-engine')));assert.equal(recalled.items.length,1);assert.equal(recalled.items[0].content,'Preserve exact preference');
 const forgotten=fresh.forget(f.scope,{operationId:'forget-projectless',memoryId:recalled.items[0].id,expectedVersion:recalled.items[0].version});assert.equal(forgotten.receipt.status,'committed');plan=fresh.planSourceReads(f.scope,'another-fresh-engine');await read.prime(plan.sourceRefs);
 const after=read.withVerifiedSources(()=>fresh.withSourceReadPlan(f.scope,'another-fresh-engine',plan,()=>fresh.recall(f.scope,'another-fresh-engine')));assert.deepEqual(after.items,[]);assert.equal(fresh.operation(f.scope,'forget-projectless').status,'committed');read.invalidate();
}));
test('engine change between source observations rejects the old source even though SQL is unchanged',()=>run(async f=>{
 const reader=f.reader();f.envelopes.get('engine-assistant').parts[0].text='Changed on actual fixture engine';const result=await reader.prime([f.ref]);assert.equal(result.verifiedSources,0);assert.equal(result.unavailableSources.length,1);reader.withVerifiedSources(()=>assert.equal(f.state(f.ref.id,{readAvailability:reader.view}).uncertain,true));
}));
test('continued original assistant retains the same preceding user and qualifies only against that same actual engine relation',()=>run(async f=>{
 const next=f.save({assistantMessageId:'engine-assistant-two',assistantContent:'Continued',expectedRevision:2}),ref={id:next.assistantMessage.id,chatId:f.chatId,contentHash:next.assistantMessage.content_hash};f.envelopes.set('engine-assistant-two',f.envelope('engine-assistant-two','assistant','Continued'));
 assert.equal(candidate(f,ref).user.id,'engine-user');const reader=f.reader();assert.equal((await reader.prime([ref])).verifiedSources,1);reader.withVerifiedSources(()=>assert.equal(f.state(ref.id,{readAvailability:reader.view}).uncertain,false));
 const other=f.envelope('different-user','user','Another turn');// Replaced with an unrelated preceding user.
 f.transport.getMessages=async()=>[f.envelope('engine-user','user',f.raw),other,f.envelope('engine-assistant-two','assistant','Continued')];const changed=f.reader();assert.equal((await changed.prime([ref])).verifiedSources,0);changed.invalidate();
}));
test('suppression of either pair member excludes both sources after a fresh engine observation',()=>run(async f=>{
 f.db.prepare('INSERT INTO veyra_memory_suppression(scope_key,kind,target,receipt_id) VALUES(?,?,?,?)').run(f.key,'content',f.saved.assistantMessage.content_hash,'explicit-suppression-fixture');const reader=f.reader();await reader.prime([f.ref]);reader.withVerifiedSources(()=>{const state=f.state(f.ref.id,{readAvailability:reader.view});assert.equal(state.excluded,true);assert.equal(state.idleEligible,false)});
}));
test('actual API adapter reads qualified canonical projectless text and never calls the legacy scope owner',()=>run(async f=>{
 const reader=f.reader();const request={},principal={type:'user',id:'owner',scopes:['memory:read']};let legacy=0;
 const session=createApiMemorySession({core:{getDb:()=>f.db,execTransaction:fn=>f.db.transaction(fn).immediate(),checkpointAfterWrite:()=>{}},request,selected:{projectId:null,workspaceId:f.scope.workspaceId,runtimeId:f.execution.runtimeId},authenticate:()=>({principal}),resolveExistingScope:()=>{legacy++;throw Error('No legacy substitute')},resolveProjectlessScope:()=>({...f.scope,status:'authorized'}),resolveExecution:()=>f.execution,resolveChatBinding:()=>({...f.execution,visibility:'private',chatId:f.chatId}),authorizeOperation:()=>true,resolveSourceState:input=>contextMemorySourceState({db:f.db,...input,readAvailability:reader.view})});
 assert.equal(session.readSource(f.scope,f.chatId,f.ref.id),null);await reader.prime([f.ref]);reader.withVerifiedSources(()=>{const source=session.readSource(f.scope,f.chatId,f.ref.id);assert.equal(source.content,f.raw);assert.equal(source.instructionAuthority,false);assert.equal(source.contentKind,'untrusted_context_data')});assert.equal(legacy,0);
}));
