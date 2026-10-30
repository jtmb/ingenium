import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MemoryError} from './lifecycle.mjs';
import {readBoundedMemoryInspection} from './inspection.mjs';
import {fixture,scope,done,hash,envelope} from './source-read-test-fixtures.mjs';
function addSecond(f) {
 const text=['A second preference','Second acknowledgement'],ids=['engine-user-two','engine-assistant-two'];
 const metadata={source:'opencode-chat',sourceRuntimeId:'runtime',sourceSessionId:'source-chat'};
 for(let n=0;n<2;n++) {
  const role=n===0?'user':'assistant';
  f.db.prepare('INSERT INTO context_messages VALUES (?,?,?,?,?,?,?,?,?,?)').run('context-two-'+role,'project','context',n+2,role,text[n],hash(text[n]),JSON.stringify({...metadata,sourceMessageId:ids[n]}),`opencode-${role}:${hash(`runtime\0source-chat\0${ids[n]}`)}`,new Date(done).toISOString());
  const message=envelope(ids[n],role,text[n]);f.list.push(message);f.byId.set(ids[n],structuredClone(message));
 }
 f.db.prepare('INSERT INTO context_checkpoints VALUES (?,?,?,?,?,?,?,?)').run('project','context',1,'context-two-assistant',4,`opencode-checkpoint:${hash('runtime\0source-chat\0engine-assistant-two')}`,JSON.stringify({...metadata,sourceAssistantMessageId:ids[1]}),new Date(done).toISOString());
 const provenance={sources:[{id:'context-two-user',chatId:'source-chat',contentHash:hash(text[0]),eligibilityVersion:'retained-original-tag'}],model:'other-qualified-model',policyRevision:7,inferred:true};
 f.db.prepare('INSERT INTO veyra_memory_recall VALUES (?,?,?,?,?,3,?,?,?)').run(f.key,'second-memory','Remembered second preference',hash('Remembered second preference'),JSON.stringify(provenance),'active',new Date(done+10).toISOString(),new Date(done+10).toISOString());
 return {id:'second-memory',content:'Remembered second preference',version:3,provenance};
}
const inspect=(f,extra={})=>readBoundedMemoryInspection({memory:f.memory,scope,reader:f.reader,consume:read=>read(),...extra});
test('management inspection primes actual sources with no active chat and preserves exact per-entry provenance/version/content',async()=>{
 const f=fixture();try {const expected=addSecond(f);const result=await inspect(f);assert.deepEqual(result.items.find(item=>item.id===expected.id),expected);
 assert.equal(result.items.length,2);assert.equal(result.sourceWindow.verifiedSources,2);assert.equal(Object.hasOwn(result,'total'),false);assert.equal(Object.hasOwn(result,'nextOffset'),false);
 assert.equal(f.memory.inspect(scope).items.length,0); // consumed view, not a lasting cache
 }finally{f.db.close();}
});
test('generation/use/contribution optouts prevent injection while entries remain inspectable for review and forget',async()=>{
 const f=fixture();try {f.db.exec('UPDATE veyra_memory_policy SET enabled=0,generate=0,use_memory=0,external_context=0');f.db.exec('UPDATE veyra_memory_chat_policy SET use_memory=0,contribute=0');
 assert.equal(f.memory.recall(scope,'fresh-chat').excluded,true);const result=await inspect(f);assert.equal(result.items.length,1);assert.equal(result.items[0].id,'memory');
 f.memory.forget(scope,{operationId:'disabled-management-forget',memoryId:'memory',expectedVersion:1});assert.equal((await inspect(f)).items.length,0);assert.equal(f.memory.operation(scope,'disabled-management-forget').status,'committed');
 }finally{f.db.close();}
});
test('one changed canonical source is omitted without replacing or hiding an independently qualified entry',async()=>{
 const f=fixture();try {addSecond(f);f.byId.get('engine-user-two').parts[0].text+=' edited';const result=await inspect(f);
 assert.deepEqual(result.items.map(item=>item.id),['memory']);assert.equal(result.sourceWindow.unavailableMemoryCount,1);assert.equal(result.sourceWindow.unavailableSourceCount,1);
 }finally{f.db.close();}
});
test('current source authority, actor authority and selected Context drift are checked again at consumption',async()=>{
 for(const mode of ['source','actor','context']) {const f=fixture();try {
 const consume=read=>{if(mode==='source')f.sourceAllowed=false;if(mode==='actor')f.allowed=false;if(mode==='context')f.db.exec("DELETE FROM context_checkpoints");return read();};
 if(mode==='actor')await assert.rejects(inspect(f,{consume}),error=>error.code==='FORBIDDEN');else assert.equal((await inspect(f,{consume})).items.length,0);
 if(mode==='actor')assert.throws(()=>f.memory.inspect(scope),error=>error.code==='FORBIDDEN');else assert.equal(f.memory.inspect(scope).items.length,0);
 }finally{f.allowed=true;f.db.close();}}
});
test('candidateOffset is explicit and never impersonates source-qualified offset/global total',async()=>{
 const f=fixture();try {addSecond(f);f.byId.get('engine-user-two').parts[0].text+=' unavailable';
 const first=await inspect(f,{candidateOffset:0,limit:1});assert.equal(first.items.length,0);assert.equal(first.sourceWindow.scanned,1);assert.equal(first.sourceWindow.nextCandidateOffset,1);
 const second=await inspect(f,{candidateOffset:1,limit:1});assert.deepEqual(second.items.map(item=>item.id),['memory']);assert.equal(second.sourceWindow.hasMore,false);assert.equal(second.sourceWindow.nextCandidateOffset,null);
 assert.equal(Object.hasOwn(first,'total'),false);
 const all=f.memory.planInspectionSources(scope);await f.reader.prime(all.sourceRefs);const legacy=f.reader.withVerifiedSources(()=>f.memory.inspect(scope,{offset:0,limit:1}));
 assert.equal(legacy.total,1);assert.equal(legacy.items.length,1); // original qualified-offset method unchanged
 }finally{f.db.close();}
});
test('inspection row window cannot expand to newly inserted or revised unprimed entries',async()=>{
 const f=fixture();try {addSecond(f);const result=await inspect(f,{consume:read=>{f.seed('new-late-memory',done+20);f.db.exec("UPDATE veyra_memory_recall SET version=4 WHERE id='second-memory'");return read();}});
 assert.deepEqual(result.items.map(item=>item.id),['memory']);assert.equal(result.sourceWindow.unavailableMemoryCount,1);
 }finally{f.db.close();}
});
test('plan bounds, source budgets and purpose/instance/scope separation remain explicit',()=>{
 const f=fixture();try {addSecond(f);const plan=f.memory.planInspectionSources(scope,{limit:100,maxSources:1});assert.equal(plan.scanCount,2);assert.equal(plan.selectedMemoryCount,1);assert.equal(plan.deferredForSourceBudget,1);assert.equal(plan.sourceRefs.length,1);
 assert.throws(()=>f.memory.planInspectionSources(scope,{limit:101}),error=>error.code==='INVALID_INPUT');assert.throws(()=>f.memory.planInspectionSources(scope,{candidateOffset:-1}));
 assert.throws(()=>f.memory.inspectSourcePlan(scope,{...plan}));assert.throws(()=>f.memory.inspectSourcePlan({...scope,workspaceId:'other'},plan));
 const recallPlan=f.plan();assert.throws(()=>f.memory.inspectSourcePlan(scope,recallPlan));assert.throws(()=>f.memory.withSourceReadPlan(scope,'fresh-chat',plan,()=>true));
 }finally{f.db.close();}
});
test('Root consumption failure and invalid requests always invalidate the primed source reader',async()=>{
 const f=fixture();try {await assert.rejects(inspect(f,{consume:()=>{throw new MemoryError('FORBIDDEN');}}),error=>error.code==='FORBIDDEN');assert.throws(()=>f.reader.withVerifiedSources(()=>true),error=>error.code==='MEMORY_ENGINE_REFRESH_REQUIRED');
 await assert.rejects(inspect(f,{limit:0}),error=>error.code==='INVALID_INPUT');assert.throws(()=>f.reader.withVerifiedSources(()=>true));
 }finally{f.db.close();}
});
