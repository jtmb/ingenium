// Root-only scheduling fixtures. These do not establish CPU/Core authority.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const additions=readFileSync(new URL('./attachment-bootstrap.additions.mjs',import.meta.url),'utf8');
const recipe=JSON.parse(readFileSync(new URL('./attachment-bootstrap-splices.json',import.meta.url),'utf8'));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function fixture(open){
 const calls=[];
 // Only the bootstrap's scheduling/reference code is extracted. The fixture
 // queue is deliberately NOT a positive production CPU/scope authority.
 const Harness=new Function('validateScope','randomUUID','fail','open','calls',`return class {
  #attachmentBootstraps=new WeakMap(); #scopes=new Map();
  current=null;
  #queueScope(input,record){return open(input,record);}
  isOwnedScope(scope){return scope.owned===true;}
  requireCpuAdmission(){}
  bindContext(context,scope){return {context,scope};}
  stopScope(scope){calls.push(scope);return Promise.resolve();}
  ${additions}
 }`)(value=>value,randomUUID,code=>{throw Object.assign(Error(code),{code});},open,calls);
 return {producer:new Harness(),calls};
}
const input=signal=>({context:{},scope:{id:'fixture-only'},deadlineAt:Date.now()+60000,signal});
const ready=()=>({owned:true,ready:true,closing:false,physicalRetired:false,sessions:new Set(),admission:{},child:{}});
test('begin enrolls before first opening effect; queued cancellation prevents entry',async()=>{
 let entered=0;const {producer}=fixture(()=>{entered++;});const controller=new AbortController();
 const handle=producer.beginOriginalAttachmentScope(input(controller.signal));
 assert.equal(entered,0);controller.abort();await producer.releaseOriginalAttachmentScope(handle);assert.equal(entered,0);
});
test('forged bootstrap cannot bind, wait or release',async()=>{
 const {producer}=fixture(()=>assert.fail('must not open'));
 assert.throws(()=>producer.bindOriginalAttachmentScope({},{}),/ORIGINAL_REQUIRED/);
 assert.throws(()=>producer.releaseOriginalAttachmentScope({}),/ORIGINAL_REQUIRED/);
 await assert.rejects(producer.waitOriginalAttachmentScope({},new AbortController().signal),/ORIGINAL_REQUIRED/);
});
test('release joins actual pending opening before exact reference removal',async()=>{
 const gate=deferred(),scope=ready();const {producer,calls}=fixture(async(_,record)=>{
  record.scope=scope;scope.sessions.add(record.sessionId);await gate.promise;return {ready:true};
 });const handle=producer.beginOriginalAttachmentScope(input(new AbortController().signal));
 await Promise.resolve();let settled=false;const release=producer.releaseOriginalAttachmentScope(handle).then(()=>settled=true);
 await Promise.resolve();assert.equal(settled,false);assert.equal(scope.sessions.size,1);
 gate.resolve();await release;assert.equal(scope.sessions.size,0);assert.deepEqual(calls,[scope]);
});
test('replaced current scope is never selected by bootstrap release',async()=>{
 const scope=ready(),other=ready();const {producer,calls}=fixture((_,record)=>{
  record.scope=scope;scope.sessions.add(record.sessionId);return {ready:true};
 });const controller=new AbortController(),handle=producer.beginOriginalAttachmentScope(input(controller.signal));
 await producer.waitOriginalAttachmentScope(handle,controller.signal);producer.current=other;
 await producer.releaseOriginalAttachmentScope(handle);assert.deepEqual(calls,[scope]);assert.equal(other.ready,true);
});
test('real call reference survives bootstrap release; binding is exact retained scope',async()=>{
 const scope=ready();const {producer,calls}=fixture((_,record)=>{
  record.scope=scope;scope.sessions.add(record.sessionId);return {ready:true};
 });const controller=new AbortController(),handle=producer.beginOriginalAttachmentScope(input(controller.signal));
 await producer.waitOriginalAttachmentScope(handle,controller.signal);
 assert.equal(producer.bindOriginalAttachmentScope(handle,{}).scope,scope);
 scope.sessions.add('actual-call-fixture');await producer.releaseOriginalAttachmentScope(handle);
 assert.deepEqual([...scope.sessions],['actual-call-fixture']);assert.equal(calls.length,0);
});
test('unknown cleanup rejects persistently and keeps exact scope reference',async()=>{
 const scope=ready();scope.cleanupFailure=Error('unknown');const {producer,calls}=fixture((_,record)=>{
  record.scope=scope;scope.sessions.add(record.sessionId);throw Error('admission-unknown');
 });const handle=producer.beginOriginalAttachmentScope(input(new AbortController().signal));
 await Promise.resolve();const release=producer.releaseOriginalAttachmentScope(handle);
 await assert.rejects(release,/CLEANUP_UNKNOWN/);assert.equal(producer.releaseOriginalAttachmentScope(handle),release);
 assert.equal(scope.sessions.size,1);assert.equal(calls.length,0);
});
test('opening splice retains scope before recovery and gates no-start receipt',()=>{
 const all=recipe.edits.map(edit=>edit.after).join('\n');
 assert.match(all,/bootstrap\.scope=scope/);assert.match(all,/openingPhase="recovering"/);
 assert.match(all,/openingPhase="admitting"/);assert.match(all,/scope\.controlReservationAttempted=true/);
 assert.match(all,/if\(scope\.controlReservationAttempted\)/);
 assert.match(all,/CPU_OPEN_EXTERNAL_CLEANUP_UNKNOWN/);
});
