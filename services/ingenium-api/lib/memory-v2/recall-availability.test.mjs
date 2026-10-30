import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {MemoryLifecycle,scopeKey} from './lifecycle.mjs';
import {createRecallSourceReader} from './recall-availability.mjs';
import {contextMemorySourceState} from './source-state.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const scope={organizationId:'org',ownerUserId:'owner',projectId:'project',workspaceId:'workspace',hostId:'host',environmentId:'env',bindingHash:'binding',bindingEpoch:1,visibility:'private'};
const execution={...scope,runtimeId:'runtime',mode:'runtime',available:true,status:'authorized'};
const content='  exact é\r\npreference  ',done=Date.parse('2026-10-30T12:00:00Z');
const envelope=(id,role,text)=>({info:{id,sessionID:'source-chat',role,time:{created:done-10,...(role==='assistant'?{completed:done}:{})},...(role==='assistant'?{finish:'stop'}:{})},parts:[{id:id+':text',sessionID:'source-chat',messageID:id,type:'text',text}]});
function fixture({assistantOnly=false}={}) {
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 db.exec(`CREATE TABLE context_conversations(id TEXT,project_id TEXT,organization_id TEXT,owner_user_id TEXT,visibility TEXT,metadata TEXT);
 CREATE TABLE context_messages(id TEXT,project_id TEXT,conversation_id TEXT,sequence INTEGER,role TEXT,content TEXT,content_hash TEXT,metadata TEXT,idempotency_key TEXT,created_at TEXT);
 CREATE TABLE context_checkpoints(project_id TEXT,conversation_id TEXT,sequence INTEGER,through_message_id TEXT,message_count INTEGER,idempotency_key TEXT,metadata TEXT,created_at TEXT);`);
 const meta={source:'opencode-chat',sourceRuntimeId:'runtime',sourceSessionId:'source-chat'};
 db.prepare('INSERT INTO context_conversations VALUES (?,?,?,?,?,?)').run('context','project','org','owner','private',JSON.stringify(meta));
 const text=[content,'Acknowledged'];
 for(const [sequence,role]of[[0,'user'],[1,'assistant']])db.prepare('INSERT INTO context_messages VALUES (?,?,?,?,?,?,?,?,?,?)').run('context-'+role,'project','context',sequence,role,text[sequence],hash(text[sequence]),JSON.stringify({...meta,sourceMessageId:'engine-'+role}),`opencode-${role}:${hash(`runtime\0source-chat\0engine-${role}`)}`,new Date(done).toISOString());
 db.prepare('INSERT INTO context_checkpoints VALUES (?,?,?,?,?,?,?,?)').run('project','context',0,'context-assistant',2,`opencode-checkpoint:${hash('runtime\0source-chat\0engine-assistant')}`,JSON.stringify({...meta,sourceAssistantMessageId:'engine-assistant'}),new Date(done).toISOString());
 const key=scopeKey(scope);db.prepare('INSERT INTO veyra_memory_policy VALUES (?,?,?,?,?,?)').run(key,1,1,0,1,0);
 db.prepare('INSERT INTO veyra_memory_chat_policy VALUES (?,?,?,?,?)').run(key,'source-chat',1,1,0);
 const ref={id:assistantOnly?'context-assistant':'context-user',chatId:'source-chat',contentHash:hash(assistantOnly?text[1]:content)};
 const provenance={sources:[ref],model:'past-qualified-model',policyRevision:1,inferred:true};
 function seed(id='memory',time=done){db.prepare('INSERT INTO veyra_memory_recall VALUES (?,?,?,?,?,1,?,?,?)').run(key,id,'Remembered preference',hash('Remembered preference'),JSON.stringify(provenance),'active',new Date(time).toISOString(),new Date(time).toISOString());}
 seed();
 let owner={scope,execution,ownerInstanceId:'actual-container',directory:'/workspace',target:{baseUrl:'http://owned:4098',directory:'/workspace'}},allowed=true,sourceAllowed=true;
 let list=[envelope('engine-user','user',content),envelope('engine-assistant','assistant',text[1])];
 const byId=new Map(list.map(item=>[item.info.id,structuredClone(item)])),calls=[],queries=[];let afterRead=null;
 const options={scope,execution,getDb:()=>db,getOwner:async({chatId})=>{calls.push(['owner',chatId]);return owner;},
  transport:{getSession:async(o,chatId)=>({id:chatId,projectID:'native-project',directory:'/workspace',path:'/workspace',time:{created:done-100,updated:done+1_000_000}}),
   getMessages:async(o,chatId,limit)=>{calls.push(['list',chatId,limit]);return structuredClone(list);},
   getSessionMessage:async(o,chatId,id)=>{calls.push(['message',chatId,id]);const value=structuredClone(byId.get(id)??{error:{code:'NOT_FOUND'}});if(afterRead)afterRead();return value;}}};
 const reader=createRecallSourceReader(options);
 const memory=new MemoryLifecycle({db:{exec:sql=>db.exec(sql),prepare:sql=>{queries.push(sql);return db.prepare(sql);}},authorize:(s,p,chatId)=>allowed&&(p!=='read-source'||sourceAllowed),checkpoint:()=>{},
  sources:(s,chatId,id)=>{const row=db.prepare('SELECT conversation_id,content_hash FROM context_messages WHERE id=?').get(id);if(!row)return null;return {...contextMemorySourceState({db,scope:s,execution,chatId,messageId:id,conversationId:row.conversation_id,contentHash:row.content_hash,readAvailability:reader.view}),contentHash:row.content_hash,kind:'transcript'};}});
 const plan=()=>memory.planSourceReads(scope,'fresh-chat');
 const recall=plan=>reader.withVerifiedSources(()=>memory.withSourceReadPlan(scope,'fresh-chat',plan,()=>memory.recall(scope,'fresh-chat')));
 return {db,key,ref,reader,memory,options,byId,calls,queries,seed,plan,recall,get list(){return list;},set list(value){list=value;},get owner(){return owner;},set owner(value){owner=value;},set allowed(value){allowed=value;},set sourceAllowed(value){sourceAllowed=value;},set afterRead(value){afterRead=value;}};
}
test('persisted Context ref/hash primes current exact engine pair; later incomplete tail does not hide fresh-chat recall',async()=>{
 const f=fixture();try {
 f.db.prepare('INSERT INTO context_messages VALUES (?,?,?,?,?,?,?,?,?,?)').run('later','project','context',2,'user','Unknown later input',hash('Unknown later input'),'{}','later',new Date(done+1).toISOString());
 f.list.push(envelope('later-engine-user','user','Unfinished later input'));
 const plan=f.plan();assert.equal(plan.hasMore,false);assert.equal(plan.sourceRefs[0].id,'context-user');assert.equal(Object.hasOwn(plan.sourceRefs[0],'engineRevision'),false);
 const result=await f.reader.prime(plan.sourceRefs);assert.equal(result.verifiedSources,1);
 assert.deepEqual(f.calls.filter(call=>call[0]==='message').map(call=>call[2]),['engine-user','engine-assistant']);
 const recalled=f.recall(plan);assert.equal(recalled.items.length,1);assert.equal(recalled.items[0].id,'memory');assert.equal(recalled.items[0].provenance.sources[0].chatId,'source-chat');
 assert.equal(f.memory.recall(scope,'fresh-chat').items.length,0);
 }finally{f.db.close();}
});
test('read availability never enables generation even with generation policy on',async()=>{
 const f=fixture();try {const plan=f.plan();await f.reader.prime(plan.sourceRefs);f.db.exec('UPDATE veyra_memory_policy SET generate=1');f.db.exec('UPDATE veyra_memory_chat_policy SET contribute=1');
 f.reader.withVerifiedSources(()=>{const state=contextMemorySourceState({db:f.db,scope,execution,chatId:'source-chat',messageId:'context-user',conversationId:'context',contentHash:hash(content),readAvailability:f.reader.view});assert.equal(state.uncertain,false);assert.equal(state.idleEligible,false);assert.throws(()=>f.memory.admit(scope,'source-chat',[f.ref]),error=>error.code==='SOURCE_UNAVAILABLE');});
 }finally{f.db.close();}
});
test('selected canonical edit/delete/unknown and owner loss omit source, never infer proof from retained Context',async()=>{
 for(const mode of ['edit','delete','unknown','owner']){const f=fixture();try {const plan=f.plan();
 if(mode==='edit')f.byId.get('engine-assistant').parts[0].text+='changed';if(mode==='delete')f.byId.delete('engine-user');if(mode==='unknown')f.byId.get('engine-assistant').info.finish='error';if(mode==='owner')f.owner=null;
 const result=await f.reader.prime(plan.sourceRefs);assert.equal(result.verifiedSources,0,mode);assert.ok(result.unavailableSources.length>0);assert.equal(f.recall(plan).items.length,0);
 }finally{f.db.close();}}
});
test('current Context selected pair hash/checkpoint/owner drift after prime defeats availability without latest-tail coupling',async()=>{
 for(const sql of ["UPDATE context_messages SET content='edited' WHERE id='context-user'","DELETE FROM context_messages WHERE id='context-assistant'",'DELETE FROM context_checkpoints',"UPDATE context_conversations SET owner_user_id='other'"]){const f=fixture();try {const plan=f.plan();await f.reader.prime(plan.sourceRefs);f.db.exec(sql);assert.equal(f.recall(plan).items.length,0);}finally{f.db.close();}}
});
test('forget/suppression on selected user blocks assistant-only provenance even after unchanged source reappears',async()=>{
 const f=fixture({assistantOnly:true});try {const plan=f.plan();await f.reader.prime(plan.sourceRefs);
 f.db.prepare('INSERT INTO veyra_memory_suppression VALUES (?,?,?,?)').run(f.key,'source','context-user','forget-receipt');
 assert.equal(f.recall(plan).items.length,0);
 await f.reader.prime(plan.sourceRefs);assert.equal(f.recall(plan).items.length,0);
 }finally{f.db.close();}
});
test('current source authority and host use policy are rechecked after async prime',async()=>{
 for(const mode of ['source','actor','policy']){const f=fixture();try {const plan=f.plan();await f.reader.prime(plan.sourceRefs);if(mode==='source')f.sourceAllowed=false;if(mode==='actor')f.allowed=false;if(mode==='policy')f.db.exec('UPDATE veyra_memory_policy SET use_memory=0');
 if(mode==='actor')assert.throws(()=>f.recall(plan),error=>error.code==='FORBIDDEN');else assert.equal(f.recall(plan).items.length,0);
 }finally{f.db.close();}}
});
test('bounded plan scans at most16 rows and exact recall window cannot expand to new or changed unprimed rows',async()=>{
 const f=fixture();try {for(let n=0;n<40;n++)f.seed('m-'+n,done+n+1);const plan=f.plan();assert.equal(plan.scanCount,16);assert.equal(plan.selectedMemoryCount,16);assert.equal(plan.sourceRefs.length,1);assert.equal(plan.hasMore,true);
 await f.reader.prime(plan.sourceRefs);f.seed('new-unprimed-memory',done+100);f.queries.length=0;
 const page=f.recall(plan);assert.equal(page.items.length,16);assert.ok(!page.items.some(item=>item.id==='new-unprimed-memory'));assert.ok(f.queries.some(sql=>sql.includes('id IN (')));assert.ok(!f.queries.some(sql=>sql.startsWith('SELECT * FROM veyra_memory_recall')&&!sql.includes('id IN (')));
 const next=f.memory.planSourceReads(scope,'fresh-chat',{limit:1});await f.reader.prime(next.sourceRefs);f.db.exec("UPDATE veyra_memory_recall SET provenance_json='{"+'"sources":[]'+"}' WHERE id='new-unprimed-memory'");assert.equal(f.recall(next).items.length,0);
 }finally{f.db.close();}
});
test('no parent relation or bounded canonical ordered page cannot become a fabricated pair proof',async()=>{
 const f=fixture();try {f.list=[];const plan=f.plan();const result=await f.reader.prime(plan.sourceRefs);assert.equal(result.verifiedSources,0);assert.equal(result.unavailableSources[0].reason,'MEMORY_ENGINE_PAIR_RELATION_UNAVAILABLE');assert.equal(f.recall(plan).items.length,0);
 const other=createRecallSourceReader({...f.options,verifyPair:async()=>true});const failed=await other.prime(plan.sourceRefs);assert.equal(failed.verifiedSources,0);
 const actualPort=createRecallSourceReader({...f.options,verifyPair:async({owner,chatId,user,assistant})=>({ownerInstanceId:owner.ownerInstanceId,chatId,userId:user.info.id,assistantId:assistant.info.id})});assert.equal((await actualPort.prime(plan.sourceRefs)).verifiedSources,1);
 }finally{f.db.close();}
});
test('unprimed/forged views, fake plans, excessive refs and invalidation during async prime cannot serve recall',async()=>{
 const f=fixture();try {const plan=f.plan();assert.equal(f.memory.recall(scope,'fresh-chat').items.length,0);assert.throws(()=>f.memory.withSourceReadPlan(scope,'fresh-chat',{...plan},()=>true));
 await assert.rejects(f.reader.prime(Array(33).fill(f.ref)),error=>error.code==='INVALID_ADAPTER');
 f.afterRead=()=>f.reader.invalidate();await assert.rejects(f.reader.prime(plan.sourceRefs),error=>error.code==='MEMORY_ENGINE_REFRESH_REQUIRED');assert.throws(()=>f.recall(plan));
 }finally{f.db.close();}
});

test('a bounded recall window cannot narrow forget/reset scope or bypass a durable forget receipt',async()=>{
 const f=fixture();try {for(let n=0;n<4;n++)f.seed('older-'+n,done+n+1);const plan=f.memory.planSourceReads(scope,'fresh-chat',{limit:1});await f.reader.prime(plan.sourceRefs);
 f.reader.withVerifiedSources(()=>f.memory.withSourceReadPlan(scope,'fresh-chat',plan,()=>assert.equal(f.memory.previewReset(scope).count,5)));
 const original=f.memory.planSourceReads(scope,'fresh-chat');await f.reader.prime(original.sourceRefs);
 f.memory.forget(scope,{operationId:'forget-original',memoryId:'memory',expectedVersion:1});
 assert.equal(f.recall(original).items.length,0);
 assert.equal(f.memory.operation(scope,'forget-original').status,'committed');
 }finally{f.db.close();}
});
