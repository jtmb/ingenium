// Actual production supervisor methods with explicit synthetic dependency faults.
// No positive CPU/process/Core owner or runtime qualification is manufactured.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedCpuSupervisor} from '../lib/voice-v2/managed-supervisor.mjs';
const scope={actorId:'actor',accountId:'account',organizationId:'organization',projectId:'project',conversationId:'conversation',runtimeId:'runtime',executionBindingId:'workspace',executionRevision:'revision',agentId:'agent'};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture(options={}){
 const calls=[],captured=[],context={},admission={deadlineAt:Date.now()+60000};
 let producer;
 const ledger={
  listControls(){calls.push('list');if(options.listFailure)throw options.listFailure;return[];},
  reserveControl(_context,input){calls.push('reserve');if(options.reserveFailure)throw options.reserveFailure;return{accepted:true,fresh:true};},
  reserve(){assert.fail('no child operation');},privateRead(){assert.fail('no running control');},settle(){assert.fail('no settlement');},
  bindWorkerBoot(){assert.fail('no process boot');},claimCpuDispatch(){assert.fail('no dispatch');},retainCpu(){assert.fail('no CPU');},
  recordCpuResult(){assert.fail('no CPU result');},quarantineCpu(){assert.fail('no CPU');},cas(){assert.fail('no running transition');},
  retireOriginal(_context,input){calls.push('retire');assert.equal(producer.inspectResourceRetirement(input.physicalProof).kind,'sealed-before-fork');if(options.retentionFailure)throw options.retentionFailure;}
 };
 producer=new ManagedCpuSupervisor({
  profile:{helperSource:'fixture-not-executed',witnessSource:'fixture-not-executed',profileDigest:'a'.repeat(64),settings:{instance_id:'fixture',cpu_threads:1,scratch_root:'/not-used'},value:{defaultVoice:'af_heart',memoryBytes:1000}},ledger,
  bindContext(value,original){assert.equal(value,context);if(!captured.includes(original))captured.push(original);return value;},
  admitCpu(){calls.push('admit');return options.admit?options.admit(admission):admission;},
  requireCpuAdmission(value){assert.equal(value,admission);},
  releaseCpu(value,proof){calls.push('release');assert.equal(value,admission);assert.equal(producer.inspectResourceRetirement(proof).scope,captured[0]);},
  admitCpuWitness(){assert.fail('no witness');},releaseCpuWitness(){assert.fail('no witness');},
  spawn(){calls.push('spawn');throw options.spawnFailure??Error('unexpected fixture spawn');}
 });
 const controller=new AbortController();
 const begin=()=>producer.beginOriginalAttachmentScope({context,scope,deadlineAt:Date.now()+60000,signal:controller.signal});
 return{producer,calls,captured,controller,begin};
}
test('actual original queued cancellation enters no ledger, admission or launch',async()=>{
 const f=fixture(),handle=f.begin();f.controller.abort();
 await f.producer.releaseOriginalAttachmentScope(handle);assert.deepEqual(f.calls,[]);
});
test('actual list failure before any external admission closes only local scope',async()=>{
 const failure=Error('list unavailable'),f=fixture({listFailure:failure}),handle=f.begin();
 await assert.rejects(f.producer.waitOriginalAttachmentScope(handle,f.controller.signal),error=>error===failure);
 assert.deepEqual(f.calls,['list']);assert.equal(f.captured.length,1);assert.equal(f.producer.isOwnedScope(f.captured[0]),false);
});
test('actual rejected admission retains uncertain original and never fabricates retirement',async()=>{
 const failure=Error('admission ACK unknown'),f=fixture({admit(){throw failure;}}),handle=f.begin();
 await assert.rejects(f.producer.waitOriginalAttachmentScope(handle,f.controller.signal),/CLEANUP_UNKNOWN/);
 const release=f.producer.releaseOriginalAttachmentScope(handle);await assert.rejects(release,/CLEANUP_UNKNOWN/);
 assert.equal(f.producer.releaseOriginalAttachmentScope(handle),release);assert.deepEqual(f.calls,['list','admit']);
 assert.equal(f.producer.isOwnedScope(f.captured[0]),true);assert.equal(f.captured[0].sessions.size,1);
});
test('actual cancel during admission joins the original then releases without a fake control row',async()=>{
 const gate=deferred(),entered=deferred(),f=fixture({admit(value){entered.resolve();return gate.promise.then(()=>value);}}),handle=f.begin();
 await entered.promise;f.controller.abort();let joined=false;
 const release=f.producer.releaseOriginalAttachmentScope(handle).then(()=>{joined=true;});
 await Promise.resolve();assert.equal(joined,false);gate.resolve();await release;
 assert.deepEqual(f.calls,['list','admit','release']);assert.equal(f.producer.isOwnedScope(f.captured[0]),false);
});
test('actual reserve ACK loss retains no-start through the exact proof before resource release',async()=>{
 const failure=Error('reserve ACK unknown'),f=fixture({reserveFailure:failure}),handle=f.begin();
 await assert.rejects(f.producer.waitOriginalAttachmentScope(handle,f.controller.signal),error=>error===failure);
 assert.deepEqual(f.calls,['list','admit','reserve','retire','release']);assert.equal(f.producer.isOwnedScope(f.captured[0]),false);
});
test('actual failed no-start retention preserves admission and blocks bootstrap cleanup',async()=>{
 const f=fixture({reserveFailure:Error('reserve ACK unknown'),retentionFailure:Error('retention unknown')}),handle=f.begin();
 await assert.rejects(f.producer.waitOriginalAttachmentScope(handle,f.controller.signal),/CLEANUP_UNKNOWN/);
 assert.deepEqual(f.calls,['list','admit','reserve','retire']);assert.equal(f.producer.isOwnedScope(f.captured[0]),true);
 assert.equal(f.captured[0].sessions.size,1);
});
test('actual launch throw remains unknown and never synthesizes a no-start proof',async()=>{
 const f=fixture({spawnFailure:Error('launch acknowledgement unknown')}),handle=f.begin();
 await assert.rejects(f.producer.waitOriginalAttachmentScope(handle,f.controller.signal),/CLEANUP_UNKNOWN/);
 assert.deepEqual(f.calls,['list','admit','reserve','spawn']);assert.equal(f.producer.isOwnedScope(f.captured[0]),true);
 assert.equal(f.captured[0].physicalRetired,false);assert.equal(f.captured[0].sessions.size,1);
});
