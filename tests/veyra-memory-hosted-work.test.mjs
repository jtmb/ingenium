// AUTHORED, UNRUN by this worker. Pure boundary fixtures; not hosted UI acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hostedSelection,hostedBinding,controllerBinding,validateInspection,managementReceipt,definitiveRejection } from '../services/ingenium-dashboard/src/app/components/memory-v2/hosted-contract.mjs';
import { createHostedJournal } from '../services/ingenium-dashboard/src/app/components/memory-v2/hosted-journal.mjs';
import { createHostedMemoryHttp } from '../services/ingenium-dashboard/src/app/components/memory-v2/hosted-http.mjs';
import { createMemoryController } from '../services/ingenium-dashboard/src/app/components/memory-v2/controller.mjs';
const selected=Object.freeze({actorUserId:'user-a',organizationId:'org-a',workspaceId:'workspace-a',runtimeId:'runtime-a',engineSessionId:'engine-session-a'});
const original=Object.freeze({...selected,projectId:'project-a',schemaVersion:1,available:true,contextConversationId:'canonical-context-b',scopeHash:'a'.repeat(64),bindingHash:'b'.repeat(64),bindingEpoch:2,canChange:true,canForget:true});
const policy={revision:0,enabled:true,generate:false,useMemory:true,externalContext:false},chat={revision:0,useMemory:true,contribute:false};
const change=(b,id='memory-op-a')=>({identity:controllerBinding(b),operationId:id,change:{target:'chat',expectedRevision:0,values:{...chat,contribute:true}}});
const management=(b,id='memory-forget-a')=>({scopeHash:b.scopeHash,origin:controllerBinding(b),operationId:id,action:'forget',memoryId:'memory-original-a',expectedVersion:4});
class Storage {
  map=new Map();get length(){return this.map.size;} key(i){return [...this.map.keys()][i]??null;}
  getItem(k){return this.map.get(k)??null;}setItem(k,v){this.map.set(k,v);}removeItem(k){this.map.delete(k);}
}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function transport(handler=()=>null) {
  const calls=[];
  const dashboardFetch=async(url,options)=>{
    const path=new URL(url,'http://dashboard.invalid');calls.push({path,options});
    const custom=await handler(path,options,calls);if(custom)return custom;
    if(path.pathname.endsWith('/work-binding'))return json({data:original});
    if(path.pathname.endsWith('/policy')&&options.method==='GET')return json({data:{scopeHash:original.scopeHash,chatId:original.engineSessionId,bindingHash:original.bindingHash,bindingEpoch:original.bindingEpoch,available:true,policy,chat}});
    return json({error:{code:'NOT_FOUND'}},404);
  };
  return {http:createHostedMemoryHttp({dashboardFetch,base:'/api/v1'}),calls};
}
test('draft/compatibility/partial/name selectors refuse rather than adopting a default Project',()=>{
  for(const input of [null,{}, {...selected,projectId:null},{...selected,engineSessionId:null},{...selected,workspaceId:''},
    {...selected,project:'global-default'},{...selected,projectName:'Displayed name'},{...selected,runtimeId:'compatibility'},{...selected,expectedProjectId:null}])assert.throws(()=>hostedSelection(input));
});
test('initial binding request uses actual workspace/runtime/engine without a client Project ID',async()=>{
  assert.equal(Object.hasOwn(hostedSelection({...selected,expectedProjectId:undefined}),'expectedProjectId'),false);
  const {http,calls}=transport();const b=await http.loadBinding(selected),url=calls[0].path;
  assert.equal(url.searchParams.get('workspaceId'),selected.workspaceId);assert.equal(url.searchParams.get('runtimeId'),selected.runtimeId);
  assert.equal(url.searchParams.get('engineSessionId'),selected.engineSessionId);
  for(const key of ['projectId','projectName','project','projectless','expectedProjectId','actorUserId','organizationId'])assert.equal(url.searchParams.has(key),false);
  assert.equal(b.projectId,original.projectId);
});
test('optional expected Project ID only narrows server-derived original, never provides authority',async()=>{
  const {http,calls}=transport();const b=await http.loadBinding({...selected,expectedProjectId:original.projectId});
  assert.equal(calls[0].path.searchParams.get('expectedProjectId'),original.projectId);assert.equal(b.projectId,original.projectId);
  await assert.rejects(http.loadBinding({...selected,expectedProjectId:'other-project'}));
});
test('server-derived null Project remains unavailable even when client Project ID is absent',async()=>{
  const {http,calls}=transport(path=>path.pathname.endsWith('/work-binding')?json({data:{...original,projectId:null}}):null);
  await assert.rejects(http.loadBinding(selected));assert.equal(calls.length,1);
});
test('all later lifecycle requests use acquired real Project; refresh narrows the same original',async()=>{
  const {http,calls}=transport();const b=await http.loadBinding(selected);await http.forBinding(b).controller.read(controllerBinding(b));
  const refresh=calls.find((c,i)=>i>0&&c.path.pathname.endsWith('/work-binding'));
  assert.equal(refresh.path.searchParams.get('expectedProjectId'),original.projectId);assert.equal(refresh.path.searchParams.has('projectId'),false);
  const policyRead=calls.find(c=>c.path.pathname.endsWith('/policy'));
  assert.equal(policyRead.path.searchParams.get('projectId'),original.projectId);assert.equal(policyRead.path.searchParams.has('expectedProjectId'),false);
});
test('server mapping keeps engine and canonical Context IDs distinct; missing grants refuse',()=>{
  const b=hostedBinding(original,selected);assert.equal(controllerBinding(b).chatId,selected.engineSessionId);
  assert.notEqual(b.engineSessionId,b.contextConversationId);
  for(const patch of [{actorUserId:'other'},{organizationId:'other'},{projectId:null},{canChange:undefined},{contextConversationId:null},{bindingEpoch:-1}])assert.throws(()=>hostedBinding({...original,...patch},selected));
});
test('missing binding route is unavailable and never falls back to policy/guessed Context',async()=>{
  const {http,calls}=transport(()=>json({error:{code:'NOT_FOUND'}},404));
  await assert.rejects(http.loadBinding(selected));assert.equal(calls.length,1);
  assert.ok(calls[0].path.pathname.endsWith('/work-binding'));
});
test('copied JSON cannot enter this HTTP owner as a retained server binding',async()=>{
  const {http}=transport();const b=await http.loadBinding(selected);
  assert.throws(()=>http.forBinding({...b}));
});
test('policy read rechecks server binding and uses server capability instead of true default',async()=>{
  const {http}=transport(path=>path.pathname.endsWith('/work-binding')?json({data:{...original,canChange:false}}):null);
  const b=await http.loadBinding(selected),value=await http.forBinding(b).controller.read(controllerBinding(b));
  assert.equal(value.canChange,false);assert.equal(value.chatId,selected.engineSessionId);
});
test('permission revoked between acquisition and write prevents PUT',async()=>{
  let count=0;
  const {http,calls}=transport(path=>path.pathname.endsWith('/work-binding')?json({data:{...original,canChange:++count===1}}):null);
  const b=await http.loadBinding(selected);await assert.rejects(http.forBinding(b).controller.change(change(b)),{code:'FORBIDDEN'});
  assert.equal(calls.filter(c=>c.options.method==='PUT').length,0);
});
test('epoch drift between binding GET and original change prevents dispatch',async()=>{
  let count=0;
  const {http,calls}=transport(path=>path.pathname.endsWith('/work-binding')?json({data:{...original,bindingEpoch:++count===1?2:3}}):null);
  const b=await http.loadBinding(selected);await assert.rejects(http.forBinding(b).controller.change(change(b)),{code:'BINDING_CHANGED'});
  assert.equal(calls.filter(c=>c.options.method==='PUT').length,0);
});
test('policy mutation preserves CAS/operation and expected-binding headers without forwarding authority',async()=>{
  const {http,calls}=transport((path,o)=>o.method==='PUT'?json({data:{receipt:{status:'committed',scopeHash:original.scopeHash,operationId:'memory-op-a',operation:'chat-policy',revision:1}}}):null);
  const b=await http.loadBinding(selected);await http.forBinding(b).controller.change(change(b));
  const sent=calls.find(c=>c.options.method==='PUT');assert.ok(sent);
  assert.equal(sent.options.headers['Idempotency-Key'],'memory-op-a');
  assert.equal(sent.options.headers['X-Veyra-Memory-Context'],'canonical-context-b');
  assert.equal(sent.options.headers['X-Veyra-Memory-Epoch'],'2');
  assert.equal(sent.options.headers.Authorization,undefined);
  assert.deepEqual(JSON.parse(sent.options.body),{operationId:'memory-op-a',expectedRevision:0,useMemory:true,contribute:true});
});
test('CSRF rejection passes through once; adapter never creates a token or resends',async()=>{
  const {http,calls}=transport((_path,o)=>o.method==='PUT'?json({error:{code:'CSRF_REJECTED'}},403):null);
  const b=await http.loadBinding(selected);await assert.rejects(http.forBinding(b).controller.change(change(b)),{code:'CSRF_REJECTED'});
  assert.equal(calls.filter(c=>c.options.method==='PUT').length,1);
  assert.equal(definitiveRejection({status:403,code:'CSRF_REJECTED'}),false);
});
test('unknown write/reload retains original metadata and reconciles receipt without a second PUT',async()=>{
  let receiptReady=false;
  const {http,calls}=transport((path,o)=>{
    if(o.method==='PUT')throw new Error('response lost after possible commit');
    if(path.pathname.includes('/operations/'))return json({data:receiptReady?{status:'committed',scopeHash:original.scopeHash,operationId:'memory-op-a',operation:'chat-policy',revision:1}:null});
    return null;
  });
  const b=await http.loadBinding(selected),storage=new Storage(),journal=createHostedJournal(storage,b);
  const first=createMemoryController({api:http.forBinding(b).controller,journal:journal.policy,newOperationId:()=> 'memory-op-a'});
  await first.activate(controllerBinding(b));await first.change(controllerBinding(b).scopeKey,b.engineSessionId,change(b).change);
  assert.equal(first.getSnapshot().unknownOperationId,'memory-op-a');first.dispose();
  const reload=createMemoryController({api:http.forBinding(b).controller,journal:createHostedJournal(storage,b).policy});
  await reload.activate(controllerBinding(b));assert.equal(reload.getSnapshot().unknownOperationId,'memory-op-a');
  assert.equal(await reload.reconcile('memory-op-a'),false);assert.equal(storage.length,1);
  receiptReady=true;assert.equal(await reload.reconcile('memory-op-a'),true);assert.equal(storage.length,0);
  assert.equal(calls.filter(c=>c.options.method==='PUT').length,1);reload.dispose();
});
test('policy journal preserves only metadata and refuses extra content or changed original',()=>{
  const storage=new Storage(),journal=createHostedJournal(storage,original),record=change(original);
  journal.policy.set(original.scopeHash,record);
  assert.throws(()=>journal.policy.set(original.scopeHash,{...record,content:'SECRET_MEMORY'}));
  assert.throws(()=>journal.policy.set(original.scopeHash,{...record,change:{...record.change,values:{...record.change.values,contribute:false}}}));
  assert.equal(storage.length,1);assert.equal([...storage.map.values()].join().includes('SECRET_MEMORY'),false);
});
test('journal partitions actor/org/scope and never inherits another account original',()=>{
  const storage=new Storage();createHostedJournal(storage,original).policy.set(original.scopeHash,change(original));
  for(const patch of [{actorUserId:'other-user'},{organizationId:'other-org'},{scopeHash:'c'.repeat(64)}]){
    const b={...original,...patch};assert.equal(createHostedJournal(storage,b).policy.get(b.scopeHash),undefined);
  }
});
test('management blocks policy dispatch and removal requires exact original operation',()=>{
  const storage=new Storage(),journal=createHostedJournal(storage,original),record=management(original);
  journal.management.set(record);assert.throws(()=>journal.policy.get(original.scopeHash));
  assert.throws(()=>journal.policy.set(original.scopeHash,change(original)));
  assert.throws(()=>journal.management.remove('different-original'));assert.equal(storage.length,1);
  assert.throws(()=>journal.management.set({...record,content:'SECRET'}));
  journal.management.remove(record.operationId);assert.equal(storage.length,0);
});
test('separate racing-tab records remain recoverable one at a time; no overwrite',()=>{
  const storage=new Storage(),journal=createHostedJournal(storage,original);
  journal.policy.set(original.scopeHash,change(original));
  const key=[...storage.map.keys()][0],next=key.replace('memory-op-a','memory-op-b');
  const envelope=JSON.parse(storage.getItem(key));envelope.record.operationId='memory-op-b';
  storage.setItem(next,JSON.stringify(envelope));
  assert.equal(journal.policy.get(original.scopeHash).operationId,'memory-op-a');
  assert.throws(()=>journal.policy.set(original.scopeHash,change(original,'memory-op-c')));
  journal.policy.remove(original.scopeHash,'memory-op-a');assert.equal(journal.policy.get(original.scopeHash).operationId,'memory-op-b');
});
test('quota/write-readback/corrupt metadata failures never authorize a send',()=>{
  const storage=new Storage(),journal=createHostedJournal(storage,original);
  storage.setItem=()=>{throw new Error('quota');};assert.throws(()=>journal.policy.set(original.scopeHash,change(original)));
  const bad=new Storage();const good=createHostedJournal(bad,original);good.policy.set(original.scopeHash,change(original));
  bad.map.set([...bad.map.keys()][0],'{corrupt');assert.throws(()=>good.policy.get(original.scopeHash));
});
const page=(offset=0)=>({data:{items:[]},sourceWindow:{candidateOffset:offset,limit:25,scanned:25,returned:0,unavailableMemoryCount:2,deferredForSourceBudget:1,hasMore:true,nextCandidateOffset:offset+25}});
test('bounded inspection preserves unavailable sources and refuses wrong/repeated cursor',()=>{
  const result=validateInspection(page(),0,25);assert.equal(result.sourceWindow.unavailableMemoryCount,2);assert.equal(result.total,undefined);
  assert.throws(()=>validateInspection(page(25),0,25));assert.throws(()=>validateInspection({...page(),sourceWindow:{...page().sourceWindow,nextCandidateOffset:0}},0,25));
});
test('inspection after async source read rechecks original binding before presenting content',async()=>{
  let count=0;
  const {http}=transport(path=>{
    if(path.pathname.endsWith('/work-binding'))return json({data:{...original,bindingEpoch:++count<3?2:3}});
    if(path.pathname.endsWith('/entries'))return json(page());return null;
  });
  const b=await http.loadBinding(selected);await assert.rejects(http.forBinding(b).inspect(),{code:'BINDING_CHANGED'});
});
test('closed selection cannot begin a later write and does not recycle another lifetime signal',async()=>{
  const {http,calls}=transport();const b=await http.loadBinding(selected),old=new AbortController();
  const retired=http.forBinding(b,{signal:old.signal});old.abort();http.forBinding(b,{signal:new AbortController().signal});
  await assert.rejects(retired.controller.change(change(b)),{name:'AbortError'});assert.equal(calls.filter(c=>c.options.method==='PUT').length,0);
});
test('forget receipt must bind exact memory/version/scope and cannot be inferred from HTTP200',()=>{
  const record=management(original),receipt={status:'committed',operation:'forget',scopeHash:original.scopeHash,operationId:record.operationId,memoryId:record.memoryId,version:5,forgottenCount:2};
  assert.equal(managementReceipt(receipt,record),receipt);
  for(const patch of [{memoryId:'other'},{scopeHash:'c'.repeat(64)},{version:4},{forgottenCount:-1},{operation:'reset'}])assert.throws(()=>managementReceipt({...receipt,...patch},record));
});
test('component uses canonical dashboardFetch; inspection has no consumed-context disclosure',()=>{
  const source=readFileSync(new URL('../services/ingenium-dashboard/src/app/components/memory-v2/HostedWorkMemory.tsx',import.meta.url),'utf8');
  assert.match(source,/import \{ dashboardFetch, getApiBase \} from '@\/lib\/api'/);
  assert.doesNotMatch(source,/<MemoryDisclosure|fetch\(|Authorization:/);
  assert.match(source,/No prompt-consumption receipt is available/);
  assert.match(source,/total in this scope is unknown/);
});
