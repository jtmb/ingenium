// Model-free original-Promise harness; no server, DB, tool or process starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSelectedStateAdmission,selectedSessionMutation} from './selected-state-admission.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('one compound typed selection/prompt excludes attachment until original send returns',async()=>{
 const fence=createSelectedStateAdmission(),entered=deferred(),send=deferred(),events=[];
 const typed=fence.run('runtime:actual','ses_one',async()=>{events.push('inspect');await fence.write('runtime:actual','ses_one',async()=>{events.push('model');return {};});entered.resolve();return fence.write('runtime:actual','ses_one',async()=>{events.push('send');await send.promise;return {data:{id:'original'}};});});
 await entered.promise;await assert.rejects(fence.run('runtime:actual','ses_one',()=>events.push('wrong-effect')),/BUSY/);assert.deepEqual(events,['inspect','model','send']);send.resolve();await typed;
 await fence.run('runtime:actual','ses_one',()=>events.push('next-admission'));assert.equal(events.at(-1),'next-admission');
});
test('reentrant helpers retain one owner; cross-owner nesting refuses before effect',async()=>{
 const fence=createSelectedStateAdmission();let count=0;
 await fence.run('runtime:actual','ses_one',async()=>{await fence.run('runtime:actual','ses_one',()=>count++);await assert.rejects(fence.run('runtime:actual','ses_other',()=>count++),/CROSS_OWNER/);});assert.equal(count,1);
});
test('detached enrolled original keeps admission held after outer callback returns',async()=>{
 const fence=createSelectedStateAdmission(),entered=deferred(),child=deferred();let returned=false,original;
 const outer=fence.run('runtime:actual','ses_one',()=>{original=fence.write('runtime:actual','ses_one',async()=>{entered.resolve();await child.promise;return {};});return 'outer-result';}).then(value=>{returned=true;return value;});
 await entered.promise;await tick();assert.equal(returned,false);await assert.rejects(fence.run('runtime:actual','ses_one',()=>{}),/BUSY/);child.resolve();await original;assert.equal(await outer,'outer-result');
});
test('an async continuation cannot reuse a returned context to start a late effect',async()=>{
 const fence=createSelectedStateAdmission(),late=deferred();let child,ran=false;
 await fence.run('runtime:actual','ses_one',()=>{child=late.promise.then(()=>fence.write('runtime:actual','ses_one',()=>{ran=true;}));});late.resolve();await assert.rejects(child,/STALE_CONTEXT/);assert.equal(ran,false);
});
test('ambiguous write result/throw retains unknown slot while other sessions still work',async()=>{
 for(const throws of [false,true]){
  const fence=createSelectedStateAdmission();const write=fence.write('runtime:actual','ses_one',()=>{if(throws)throw new Error('transport aborted');return {error:{code:'ACK_UNKNOWN'}};});
  if(throws)await assert.rejects(write,/aborted/);else await write;
  await assert.rejects(fence.run('runtime:actual','ses_one',()=>assert.fail('unknown effect replayed')),/UNKNOWN/);
  await fence.run('runtime:actual','ses_other',()=>{});
 }
});
test('readonly pre-effect refusal releases; exception after mutation quarantines',async()=>{
 const fence=createSelectedStateAdmission();await assert.rejects(fence.run('runtime:actual','ses_one',()=>{throw new Error('auth denied');}),/auth denied/);await fence.run('runtime:actual','ses_one',()=>{});
 await assert.rejects(fence.run('runtime:actual','ses_one',async()=>{await fence.write('runtime:actual','ses_one',()=>({}));throw new Error('receipt uncertain');}),/uncertain/);await assert.rejects(fence.run('runtime:actual','ses_one',()=>{}),/UNKNOWN/);
 const detached=createSelectedStateAdmission();await assert.rejects(detached.run('runtime:actual','ses_one',()=>{void detached.write('runtime:actual','ses_one',()=>({error:{code:'unknown'}}));return true;}),/UNKNOWN/);
});
test('session path classifier covers encoded aliases, model/agent/prompt/experimental writes',()=>{
 for(const path of ['/api/session/ses_one/model','/api/session/%73es_one/agent','/api/session/ses_one/prompt','/api/experimental/session/ses_one/instructions/entries/x'])assert.equal(selectedSessionMutation(path,'POST'),'ses_one');
 assert.equal(selectedSessionMutation('/api/session/ses_one','GET'),null);assert.equal(selectedSessionMutation('/api/provider/x','POST'),null);
 assert.throws(()=>selectedSessionMutation('/api/session/%2fescape/model','POST'),/PATH_INVALID/);
 assert.equal(selectedSessionMutation('/api/session/old/../ses_one/model','POST'),'ses_one');
 assert.throws(()=>selectedSessionMutation('/api/session/ses_one/../../provider/x','POST'),/PATH_INVALID/);
});
test('bounded unknown retention refuses new slot instead of evicting an original',async()=>{
 const fence=createSelectedStateAdmission({maxSlots:1});await fence.write('runtime:actual','ses_one',()=>({error:{code:'unknown'}}));await assert.rejects(fence.run('runtime:actual','ses_other',()=>{}),/CAPACITY/);
});
