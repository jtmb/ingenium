// SOURCE/pure-data tests only. Never import/call kernel probe or model libraries.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateGpuPeakPlan,evaluateGpuHeadroom} from './gpu-budget.mjs';
import {beginGpuPreferredPrelaunch,inspectGpuPreferredPrelaunch,takeKnownNoGpuStartCpuBackup} from './gpu-prelaunch-fallback.mjs';
const GiB=1073741824,now=10000,sha='1'.repeat(64);
const plan=()=>({version:1,backend:'rocm',profileDigest:sha,providerDigest:sha,modelSetDigest:sha,measurementDigest:sha,sttMeasured:true,ttsMeasured:true,
 reserveVramBytes:GiB,externalGrowthBytes:GiB,reserveRamBytes:GiB,reserveTasks:2,cpuMilli:2000,
 phases:{cold:{vramPeakBytes:4*GiB,ramPeakBytes:3*GiB,additionalTasks:8},hot:{vramPeakBytes:3*GiB,ramPeakBytes:2*GiB,additionalTasks:4},retirement:{vramPeakBytes:GiB,ramPeakBytes:GiB,additionalTasks:2}}});
const kernel=()=>({deviceIdentity:sha,bootId:'11111111-1111-4111-8111-111111111111',sampleStartedAt:now-5,observedAt:now,totalBytes:16*GiB,usedBytes:8*GiB,availableBytes:8*GiB,scope:'visible-amdgpu-driver',observationOnly:true});
const host=()=>({memoryHeadroom:12*GiB,pidsHeadroom:32,cpuMilli:8000});
test('headroom includes existing desktop/LLM usage and does not double-subtract it',()=>{
 const result=evaluateGpuHeadroom(plan(),kernel(),host(),'cold',now);
 assert.equal(result.fits,true);assert.equal(result.requiredVramBytes,6*GiB);
 assert.equal(result.observationOnly,true);assert.equal(result.admissionAuthorized,false);
});
test('external allocation growth defeats prior fit; observation never reserves',()=>{
 const k=kernel();k.usedBytes=11*GiB;k.availableBytes=5*GiB;
 assert.deepEqual(evaluateGpuHeadroom(plan(),k,host(),'cold',now).reasons,['GPU_VRAM_HEADROOM']);
});
test('both reserve and future external growth are additive',()=>{
 const k=kernel();k.usedBytes=11*GiB;k.availableBytes=5*GiB;
 assert.equal(evaluateGpuHeadroom(plan(),k,host(),'hot',now).fits,true);
 const p=plan();p.externalGrowthBytes+=1;
 assert.equal(evaluateGpuHeadroom(p,k,host(),'hot',now).fits,false);
});
for(const [field,value,reason] of [['memoryHeadroom',GiB,'GPU_RAM_HEADROOM'],['pidsHeadroom',1,'GPU_TASK_HEADROOM'],['cpuMilli',1000,'GPU_CPU_HEADROOM']])test('GPU fit still requires '+field,()=>{
 const h=host();h[field]=value;assert.ok(evaluateGpuHeadroom(plan(),kernel(),h,'cold',now).reasons.includes(reason));
});
for(const phase of ['cold','hot','retirement'])test('phase '+phase+' budget is independent',()=>{
 assert.equal(evaluateGpuHeadroom(plan(),kernel(),host(),phase,now).admissionAuthorized,false);
 const p=plan();p.phases[phase].vramPeakBytes=15*GiB;
 assert.equal(evaluateGpuHeadroom(p,kernel(),host(),phase,now).fits,false);
});
for(const [name,mutate] of [
 ['operator name DTO',k=>{k.name='AMD';}],['operator-only capacity',k=>{delete k.usedBytes;}],
 ['inconsistent free',k=>{k.availableBytes++;}],['negative usage',k=>{k.usedBytes=-1;}],
 ['unsafe integer',k=>{k.totalBytes=Number.MAX_SAFE_INTEGER+1;}],['future sample',k=>{k.observedAt=now+1;}],
 ['expired sample',k=>{k.sampleStartedAt=now-251;}],['clock reversal',k=>{k.sampleStartedAt=now+1;}],
 ['DirectML local pool is not global',k=>{k.scope='directml-local-pool';}],['DTO authorization flag',k=>{k.observationOnly=false;}],
])test('reject observation '+name,()=>{const k=kernel();mutate(k);assert.throws(()=>evaluateGpuHeadroom(plan(),k,host(),'cold',now));});
for(const [name,mutate] of [
 ['missing STT measurement',p=>{p.sttMeasured=false;}],['missing TTS measurement',p=>{p.ttsMeasured=false;}],
 ['missing provider pin',p=>{p.providerDigest='health:ready';}],['missing model set pin',p=>{p.modelSetDigest='';}],
 ['zero reserve',p=>{p.reserveVramBytes=0;}],['no growth margin',p=>{p.externalGrowthBytes=0;}],
 ['overflow',p=>{p.phases.cold.vramPeakBytes=Number.MAX_SAFE_INTEGER;}],['unknown phase',p=>{p.phases.warm=p.phases.hot;}],
 ['negative tasks',p=>{p.phases.cold.additionalTasks=-1;}],['invalid backend',p=>{p.backend='auto';}],
])test('reject plan '+name,()=>{const p=plan();mutate(p);assert.throws(()=>validateGpuPeakPlan(p));});
test('known-no-start backup is private and once-only, with no GPU qualification claim',()=>{
 const original=beginGpuPreferredPrelaunch(),data=inspectGpuPreferredPrelaunch(original);
 assert.equal(data.preferred,'gpu');assert.equal(data.selected,'cpu-onnx');assert.equal(data.gpuAttempted,false);
 assert.equal(data.gpuQualified,false);assert.equal(data.implementationIncomplete,true);
 assert.throws(()=>takeKnownNoGpuStartCpuBackup({...original}));
 assert.equal(takeKnownNoGpuStartCpuBackup(original),'cpu-onnx');
 assert.throws(()=>takeKnownNoGpuStartCpuBackup(original));
});
for(const proof of [{retired:true},{drained:true},{gpuReady:true},{device:'AMD',freeBytes:32*GiB},{kind:'physical',backend:'cpu-onnx'},Object.freeze({})])test('unrelated/serialized post-start proof cannot authorize backup',()=>{
 assert.throws(()=>takeKnownNoGpuStartCpuBackup(proof));
});
test('negative gate cannot create GPU effects or replay delivery',()=>{
 const s=readFileSync(new URL('./gpu-prelaunch-fallback.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(s,/\b(?:import|fetch|spawn|exec|createVoiceOperationOwner|reserveCpu|sendPrompt)\s*(?:\(|\{)/);
});
test('kernel observation source has no provider initialization or device-control call',()=>{
 const s=readFileSync(new URL('./linux-gpu-observation.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(s,/from ['"](?:node:child_process|torch|torch_directml|onnxruntime)/);
 assert.doesNotMatch(s,/\b(?:spawn|exec|ioctl|writeFileSync)\s*\(/);
 assert.match(s,/GPU_HOST_ACCOUNTING_DOMAIN_UNKNOWN/);assert.match(s,/Math\.max\(used1,used2\)/);
});
