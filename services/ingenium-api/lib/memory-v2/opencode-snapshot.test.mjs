import {runMemoryExtraction} from './jobs.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createOpenCodeSnapshotReader} from './opencode-snapshot.mjs';
import {mapCanonicalContextPair} from './opencode-context-pair.mjs';
import {readCompletedSnapshotSource} from './bounded-snapshot.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const scope={organizationId:'org',ownerUserId:'owner',projectId:'project',workspaceId:'workspace',hostId:'host',environmentId:'env',bindingHash:'binding',bindingEpoch:1,visibility:'private'};
const execution={...scope,runtimeId:'runtime',mode:'runtime',available:true,status:'authorized'};
const now=Date.parse('2026-10-30T18:00:00Z'),done=now-6*3_600_000;
const envelope=(id,role,text)=>({info:{id,sessionID:'chat',role,time:{created:done-100,...(role==='assistant'?{completed:done}:{})},...(role==='assistant'?{finish:'stop'}:{})},parts:[{id:id+':text',messageID:id,sessionID:'chat',type:'text',text}]});
function fixture() {
 let owner={scope,execution,ownerInstanceId:'real-container-instance',directory:'/workspace',target:{baseUrl:'http://owned-container:4098',directory:'/workspace'}};
 let session={id:'chat',projectID:'engine-project',directory:'/workspace',path:'/workspace',time:{created:done-1000,updated:done}};
 let list=[envelope('engine-user','user','  é\r\nexact  '),envelope('engine-assistant','assistant','Acknowledged')];
 const byId=new Map(list.map(item=>[item.info.id,structuredClone(item)]));
 const calls=[];let classification=false;let mappingBad=false;let mutateAfterRead=null;
 const options={scope,execution,chatId:'chat',minRolloutIdleHours:6,clock:()=>now,getOwner:async()=>owner,
  externalContext:async()=>classification,
  mapContext:({user,assistant})=>mappingBad?null:{conversationId:'context',sourceRefs:[{id:'context-user',contentHash:hash(user.content)},{id:'context-assistant',contentHash:hash(assistant.content)}]},
  transport:{getSession:async(o,id)=>{calls.push(['session',o.ownerInstanceId,id]);return structuredClone(session);},
   getMessages:async(o,id,limit)=>{calls.push(['list',id,limit]);return structuredClone(list);},
   getSessionMessage:async(o,id,messageId)=>{calls.push(['message',id,messageId]);const value=structuredClone(byId.get(messageId)??{error:{code:'NOT_FOUND'}});if(mutateAfterRead)mutateAfterRead();return value;}}};
 const reader=createOpenCodeSnapshotReader(options);
 const read=prepared=>readCompletedSnapshotSource(prepared.snapshot,{scope,execution,chatId:'chat',engineMessageId:'engine-user',role:'user',content:list[0].parts[0].text,contentHash:hash(list[0].parts[0].text),minRolloutIdleHours:6});
 return {reader,options,byId,calls,read,get list(){return list;},set list(v){list=v;},get owner(){return owner;},set owner(v){owner=v;},get session(){return session;},set session(v){session=v;},set classification(v){classification=v;},set mappingBad(v){mappingBad=v;},set mutateAfterRead(v){mutateAfterRead=v;}};
}
const code=expected=>error=>error.code===expected;
test('prepare requests bounded canonical original APIs, preserves exact bytes and exposes only synchronous verified admission',async()=>{
 const f=fixture(),prepared=await f.reader.prepare();
 assert.equal(prepared.snapshot.messageCount,2);assert.equal(prepared.ownerInstanceId,'real-container-instance');
 assert.deepEqual(prepared.sourceRefs.map(ref=>ref.id),['context-user','context-assistant']);
 assert.deepEqual(f.calls.find(call=>call[0]==='list'),['list','chat',32]);
 assert.equal(f.calls.filter(call=>call[0]==='message').length,2);
 assert.equal(f.read(prepared),null);
 assert.ok(f.reader.withVerifiedSources(messages=>{assert.equal(messages[0].content,f.list[0].parts[0].text);assert.ok(Object.isFrozen(messages));return f.read(prepared);}));
 assert.equal(f.read(prepared),null);assert.throws(()=>f.reader.withVerifiedSources(()=>true),code('MEMORY_ENGINE_REFRESH_REQUIRED'));
});
test('refresh reads selected exact IDs only; unrelated later incomplete material and updated session do not replace snapshot',async()=>{
 const f=fixture(),prepared=await f.reader.prepare();f.reader.withVerifiedSources(()=>f.read(prepared));
 f.list.push(envelope('later-user','user','unknown later input'));f.session={...f.session,time:{...f.session.time,updated:now}};
 const before=f.calls.length;await f.reader.refresh();
 assert.equal(f.calls.slice(before).filter(call=>call[0]==='list').length,0);
 assert.deepEqual(f.calls.slice(before).filter(call=>call[0]==='message').map(call=>call[2]),['engine-user','engine-assistant']);
 assert.ok(f.reader.withVerifiedSources(messages=>{assert.equal(messages[0].content,f.list[0].parts[0].text);assert.ok(Object.isFrozen(messages));return f.read(prepared);}));assert.equal(prepared.snapshot.messageCount,2);
});
test('selected delete, exact content edit, partial completion and unknown transport invalidate cached evidence',async()=>{
 for(const change of ['delete','edit','partial','unknown']){const f=fixture(),prepared=await f.reader.prepare();f.reader.withVerifiedSources(()=>f.read(prepared));
  const message=f.byId.get('engine-assistant');if(change==='delete')f.byId.delete('engine-assistant');
  if(change==='edit')message.parts[0].text+='changed';if(change==='partial')delete message.info.time.completed;
  if(change==='unknown')f.byId.set('engine-assistant',{error:{code:'UPSTREAM_UNAVAILABLE'}});
  await assert.rejects(f.reader.refresh(),code('MEMORY_ENGINE_SOURCE_UNAVAILABLE'));assert.equal(f.read(prepared),null);
  assert.throws(()=>f.reader.withVerifiedSources(()=>true),code('MEMORY_ENGINE_REFRESH_REQUIRED'));
 }
});
test('placement owner revoked or replaced during an awaited engine read cannot publish verification',async()=>{
 for(const change of ['revoke','replace']){const f=fixture();const prepared=await f.reader.prepare();f.reader.withVerifiedSources(()=>f.read(prepared));
  f.mutateAfterRead=()=>{f.owner=change==='revoke'?null:{...f.owner,ownerInstanceId:'replacement-container'};};
  await assert.rejects(f.reader.refresh(),error=>['MEMORY_ENGINE_OWNER_UNAVAILABLE','MEMORY_ENGINE_OWNER_CHANGED'].includes(error.code));assert.equal(f.read(prepared),null);
 }
});
test('missing actual owner instance and unknown external provenance never invent a UUID or false provenance',async()=>{
 const f=fixture();f.owner={...f.owner,ownerInstanceId:''};await assert.rejects(f.reader.prepare(),code('MEMORY_ENGINE_OWNER_UNAVAILABLE'));assert.equal(f.calls.length,0);
 const g=fixture();g.classification=null;await assert.rejects(g.reader.prepare(),code('MEMORY_EXTERNAL_PROVENANCE_UNAVAILABLE'));
});
test('actual completed timestamp and stop finish are required; synthesized step-finish time is not proof',async()=>{
 for(const change of ['missing-completed','failed','running-tool','wrong-parent']){const f=fixture(),assistant=f.list[1];
  if(change==='missing-completed'){delete assistant.info.time.completed;assistant.parts.push({id:'step',sessionID:'chat',messageID:assistant.info.id,type:'step-finish',time:{start:done,end:done}});}
  if(change==='failed')assistant.info.finish='error';
  if(change==='running-tool')assistant.parts.push({id:'tool',sessionID:'chat',messageID:assistant.info.id,type:'tool',state:{status:'running'}});
  if(change==='wrong-parent')assistant.info.parentID='different-user';
  await assert.rejects(f.reader.prepare(),code('MEMORY_ENGINE_SOURCE_UNAVAILABLE'));
 }
});
test('wrong directory/session, oversized records and missing Context mapping are not adapted into success',async()=>{
 const f=fixture();f.session={...f.session,directory:'/other'};await assert.rejects(f.reader.prepare(),code('MEMORY_ENGINE_SOURCE_UNAVAILABLE'));
 const g=fixture();g.list[0].parts[0].text='x'.repeat(1024*1024);await assert.rejects(g.reader.prepare(),code('MEMORY_ENGINE_SOURCE_UNAVAILABLE'));
 const h=fixture();h.mappingBad=true;await assert.rejects(h.reader.prepare(),code('MEMORY_CONTEXT_MAPPING_UNAVAILABLE'));
});
test('refresh rechecks explicit external provenance, Context identity and selected revert',async()=>{
 for(const change of ['external','mapping','revert']){const f=fixture(),prepared=await f.reader.prepare();f.reader.withVerifiedSources(()=>f.read(prepared));
  if(change==='external')f.classification=true;if(change==='mapping')f.mappingBad=true;if(change==='revert')f.session={...f.session,revert:{messageID:'engine-user'}};
  await assert.rejects(f.reader.refresh());assert.equal(f.read(prepared),null);
 }
});
test('Context mapper accepts exact existing private turn/checkpoint and rejects trimmed or ambiguous mappings',()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec(`CREATE TABLE context_conversations(id TEXT,project_id TEXT,organization_id TEXT,owner_user_id TEXT,visibility TEXT,metadata TEXT);
 CREATE TABLE context_messages(id TEXT,conversation_id TEXT,project_id TEXT,sequence INTEGER,role TEXT,content TEXT,content_hash TEXT,idempotency_key TEXT,metadata TEXT);
 CREATE TABLE context_checkpoints(project_id TEXT,conversation_id TEXT,through_message_id TEXT,idempotency_key TEXT,metadata TEXT,message_count INTEGER);`);
 const meta={source:'opencode-chat',sourceRuntimeId:'runtime',sourceSessionId:'chat'};
 db.prepare('INSERT INTO context_conversations VALUES (?,?,?,?,?,?)').run('context','project','org','owner','private',JSON.stringify(meta));
 const user={id:'engine-user',content:'  exact\r\nbytes  '},assistant={id:'engine-assistant',content:'Acknowledged'};
 const key=(role,id)=>`opencode-${role}:${hash(`runtime\0chat\0${id}`)}`;
 for(const [index,m,role]of[[0,user,'user'],[1,assistant,'assistant']])db.prepare('INSERT INTO context_messages VALUES (?,?,?,?,?,?,?,?,?)').run('context-'+role,'context','project',index,role,m.content,hash(m.content),key(role,m.id),JSON.stringify({...meta,sourceMessageId:m.id}));
 db.prepare('INSERT INTO context_checkpoints VALUES (?,?,?,?,?,?)').run('project','context','context-assistant',key('checkpoint',assistant.id),JSON.stringify({...meta,sourceAssistantMessageId:assistant.id}),2);
 const input={scope,execution,chatId:'chat',user,assistant};assert.deepEqual(mapCanonicalContextPair(db,input).sourceRefs.map(ref=>ref.id),['context-user','context-assistant']);
 assert.equal(mapCanonicalContextPair(db,{...input,user:{...user,content:user.content.trim()}}),null);
 db.exec("INSERT INTO context_messages SELECT 'duplicate',conversation_id,project_id,sequence,role,content,content_hash,idempotency_key,metadata FROM context_messages WHERE role='user'");assert.equal(mapCanonicalContextPair(db,input),null);
 }finally{db.close();}
});


test('Jobs awaits verification before each synchronous admission/commit and never keeps the view open during async work',async()=>{
 let gate=false,refreshes=0,committed=false;
 const admission={inputHash:'input',policyRevision:1,chatRevision:1};
 const memory={operation:()=>null,admit:()=>{assert.equal(gate,true);return admission;},processedExtraction:()=>null,
  commitRecall:()=>{assert.equal(gate,true);committed=true;return{receipt:{operation:'recall'},idempotent:false};}};
 const result=await runMemoryExtraction({memory,scope,chatId:'chat',operationId:'job',sourceRefs:[],model:'test-fixture',leaseValid:()=>true,quota:()=> 'available',
  extract:async()=>{assert.equal(gate,false);return 'fixture candidate';},minimize:async value=>{assert.equal(gate,false);return value;},
  sourceVerification:{refresh:async()=>{assert.equal(gate,false);refreshes++;},withVerifiedSources:work=>{gate=true;try{return work();}finally{gate=false;}}}});
 assert.equal(result.status,'committed');assert.equal(refreshes,2);assert.equal(committed,true);assert.equal(gate,false);
});
test('failed final verification or revoked Jobs lease after awaited refresh prevents persistence',async()=>{
 for(const mode of ['source','lease']){
  let refreshes=0,lease=true,commits=0;
  const admission={inputHash:'input',policyRevision:1,chatRevision:1};
  await assert.rejects(runMemoryExtraction({memory:{operation:()=>null,admit:()=>admission,processedExtraction:()=>null,commitRecall:()=>{commits++;}},scope,chatId:'chat',operationId:'job',sourceRefs:[],model:'test-fixture',leaseValid:()=>lease,quota:()=> 'available',extract:async()=> 'fixture',minimize:async value=>value,
   sourceVerification:{refresh:async()=>{refreshes++;if(refreshes===2){if(mode==='source')throw new Error('selected source disappeared');else lease=false;}},withVerifiedSources:work=>work()}}));
  assert.equal(commits,0);assert.equal(refreshes,2);
 }
});

test('explicit invalidation during awaited refresh cannot be undone by a late successful read',async()=>{
 const f=fixture(),prepared=await f.reader.prepare();f.reader.withVerifiedSources(()=>f.read(prepared));
 f.mutateAfterRead=()=>f.reader.invalidate();
 await assert.rejects(f.reader.refresh(),code('MEMORY_ENGINE_REFRESH_REQUIRED'));
 assert.equal(f.read(prepared),null);
});
