// Source-only scheduling fixtures. Extract ONLY the two private enrollment
// helpers; no production context/call/plan Map, authenticated owner, fetch,
// response, CPU/model/device or successful retirement fixture is constructed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/voice-v2/request-context.ts',import.meta.url),'utf8');
const section=(from,to)=>{const at=source.indexOf(from),end=source.indexOf(to,at);assert.ok(at>=0&&end>at);return source.slice(at,end).trim();};
const workJs=section('function retainCallWork<T>','function disposeCallPlans')
 .replace('function retainCallWork<T>(call:CallRecord,effect:()=>Promise<T>|T,signal:AbortSignal=call.lifetime.signal):Promise<T>','function retainCallWork(call,effect,signal=call.lifetime.signal)');
const retain=new Function('"use strict"; return ('+workJs+');')();
let forbiddenCalls=0;const neverAuthority=()=>{forbiddenCalls++;throw Error('Fixture must never enter authentication, selection or HTTP');};
const subJs=section('function enrollCallSubscription','export async function openHostedCurrentAgentEvents')
 .replace('function enrollCallSubscription(call:CallRecord,controller:AbortController):CallSub','function enrollCallSubscription(call,controller)')
 .replace('const sub:CallSub=','const sub=');
const subscribe=new Function('callCurrent','selectedCallTarget','openOriginalCallEventBody','"use strict"; return ('+subJs+');')(neverAuthority,neverAuthority,neverAuthority);
const fixture=()=>({state:'open',generation:0,controller:new AbortController(),lifetime:new AbortController(),work:new Set(),failure:null,sub:null});
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
test('work Promise is published before internal effect; immediate End fence starts no effect',async()=>{
 const call=fixture();let starts=0;const pending=retain(call,()=>{starts++;throw Error('must not start');});
 assert.equal(call.work.has(pending),true);assert.equal(starts,0);
 // Exact relevant End fence actions, not a fabricated production End owner.
 call.state='ending';call.generation++;call.controller.abort();call.lifetime.abort();
 const joined=await Promise.allSettled([...call.work]);assert.equal(joined[0].status,'rejected');assert.equal(starts,0);await flush();assert.equal(call.work.size,0);
});
test('caller abort or generation fence immediately after enrollment starts no effect',async()=>{
 for(const mode of ['caller-abort','generation','barge']){
  const call=fixture(),caller=new AbortController();let starts=0;const pending=retain(call,()=>{starts++;},caller.signal);
  if(mode==='caller-abort')caller.abort();else if(mode==='generation')call.generation++;else{call.state='fencing';call.controller.abort();}
  await assert.rejects(pending);assert.equal(starts,0);await flush();assert.equal(call.work.size,0);
 }
});
test('planning cleanup can run even when its enrolled effect never entered finally',async()=>{
 const call=fixture();call.planning=true;let entered=false;
 const pending=retain(call,async()=>{try{entered=true;}finally{call.innerFinally=true;}});
 pending.finally(()=>{call.planning=false;}).catch(()=>undefined);call.lifetime.abort();
 await assert.rejects(pending);await flush();assert.equal(entered,false);assert.equal(call.innerFinally,undefined);assert.equal(call.planning,false);
});
test('started original work remains enrolled until actual settlement; cleanup-unknown is retained',async()=>{
 const call=fixture();let release;const gate=new Promise(resolve=>{release=resolve;}),failure=Object.assign(Error('original cleanup unknown'),{code:'RAW_WIRE_CLEANUP_UNKNOWN'});let starts=0;
 const pending=retain(call,async()=>{starts++;assert.equal(call.work.has(pending),true);await gate;throw failure;});
 await flush();assert.equal(starts,1);call.state='ending';call.lifetime.abort();await flush();assert.equal(call.work.has(pending),true);
 release();await assert.rejects(pending,error=>error===failure);await flush();assert.equal(call.failure,failure);assert.equal(starts,1);assert.equal(call.work.size,0);
});
test('subscription slot and pending acquisition exist before immediate End/abort; no authority/effect entered',async()=>{
 for(const mode of ['end','abort','displaced']){
  const call=fixture(),controller=new AbortController(),sub=subscribe(call,controller);assert.equal(call.sub,sub);assert.equal(forbiddenCalls,0);
  if(mode==='end'){call.state='ending';sub.stopped=true;controller.abort();}else if(mode==='abort')controller.abort();else call.sub={different:true};
  await assert.rejects(sub.open);await flush();assert.equal(forbiddenCalls,0);assert.ok(sub.failure);
 }
});
test('failed enrolled subscription cannot silently replay after state changes',async()=>{
 const call=fixture(),controller=new AbortController(),sub=subscribe(call,controller),pending=sub.open;call.state='ended';
 await assert.rejects(pending);call.state='open';await flush();assert.equal(sub.open,pending);await assert.rejects(sub.open);assert.equal(forbiddenCalls,0);assert.equal(call.sub,sub);
});
