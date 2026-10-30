/** Pure decoded-data checks only. Never reads files, runs workloads or issues approval. */
import {createHash} from 'node:crypto';
const fail=code=>{throw Object.assign(Error(code),{code});};
export const canonical=v=>v&&typeof v==='object'?Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),positive=n=>Number.isSafeInteger(n)&&n>0;
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const must=(v,code='CAPTURE_IDENTITY_INVALID')=>{if(!v)fail(code);};
function data(v,depth=0,budget={n:0}){must(depth<24&&++budget.n<32768);if(v===null||typeof v==='string'||typeof v==='boolean')return;if(typeof v==='number'){must(Number.isSafeInteger(v));return;}must(v&&typeof v==='object'&&(Array.isArray(v)?Object.getPrototypeOf(v)===Array.prototype:[Object.prototype,null].includes(Object.getPrototypeOf(v))));for(const k of Reflect.ownKeys(v)){if(Array.isArray(v)&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(v,k);must(typeof k==='string'&&d.enumerable&&Object.hasOwn(d,'value'));data(d.value,depth+1,budget);}}
function exact(v,keys){must(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join());}
const common=['owner','kernelSourceSha256','profileDigest','helperSha256','witnessSha256','codeBundleDigest','modelManifestSha256','modelSetDigest','installedClosureSha256'];
const digests=['profileDigest','codeBundleDigest','helperSha256','witnessSha256','modelManifestSha256','modelSetDigest','kernelSourceSha256','dependencyClosureSha256'];
export const SUPPORTED_CAPTURE_SCHEMAS=Object.freeze({
 'model-r1':Object.freeze({case:'model-cold-hot',source:'e662fa81cd3709e9581c9b5c020731d204cbbb5c6bd02fdfed1cc3d6a8e981ac',child:'f2d362d3b735dab9164515a07456cdc60b36a87db2bb69e867c4d4e09f9cab89',legacy:true}),
 'resource-probe-r1':Object.freeze({case:'probe',source:'e1103ac06a98f675a93c41c8da163513928b713f7f342e81446a2ed5de7280b8',child:'83acea4c22ea83056f04e5996f88b4ee2a3fb58c1fa485680cb7599dcdff7224',legacy:true}),
 'resource-probe-r2':Object.freeze({case:'probe',source:'ff4867c9e3f60ba6b40592adc8ef93f92e05594dfb675d68e0e5ef4b78d046cc',child:'604d8cfcd4b258f08dfaaff5cda98a9afdd48156c17a3fd6b595ef4589b26e86',legacy:false}),
});
export function assertStableConfiguration(configuration){data(configuration);exact(configuration,['kind',...digests]);must(configuration.kind==='root-cpu-configuration-v1'&&digests.every(k=>sha(configuration[k])));}
export function assertKernelEnvironment(environment){data(environment);exact(environment,['bootId','namespaceInode']);must(uuid(environment.bootId)&&positive(environment.namespaceInode),'CAPTURE_KERNEL_INVALID');}
export function assertCaptureDecoder(descriptor,expectedCase){must(descriptor&&Object.hasOwn(SUPPORTED_CAPTURE_SCHEMAS,descriptor.decoder)&&SUPPORTED_CAPTURE_SCHEMAS[descriptor.decoder].case===expectedCase,'CAPTURE_PRODUCER_UNSUPPORTED');}
export function projectCapturedConfiguration({capture,captureSha256,grant,grantSha256,descriptor,review,closureSha256,events}){
 data({capture,grant,descriptor,review,events});
 exact(descriptor,['decoder','producerSha256','grantPath','grantSha256','receiptSha256','legacySourceAttested']);
 assertCaptureDecoder(descriptor,capture.case);const schema=SUPPORTED_CAPTURE_SCHEMAS[descriptor.decoder];
 must(review.kind==='root-cpu-qualification-review-v2'&&review.approved===true&&review.fixtureEvidence===false&&review.templateOnly!==true,'ACTUAL_ROOT_REVIEW_REQUIRED');
 assertStableConfiguration(review.bindings);assertKernelEnvironment(review.kernelEnvironment);must(uuid(review.owner));
 must(sha(captureSha256)&&sha(grantSha256)&&descriptor.receiptSha256===captureSha256&&descriptor.grantSha256===grantSha256&&capture.grantSha256===grantSha256&&descriptor.producerSha256===schema.source&&descriptor.legacySourceAttested===schema.legacy&&typeof descriptor.grantPath==='string'&&descriptor.grantPath.startsWith('/'),'CAPTURE_PROVENANCE_MISMATCH');
 must(capture.version===1&&capture.case===schema.case&&grant.case===schema.case&&grant.kind==='root-qualification-envelope-v1'&&grant.productionApproval===false&&grant.templateOnly!==true&&uuid(capture.runId)&&capture.runId===grant.runId,'CAPTURE_CASE_MISMATCH');
 must(capture.successful===true&&capture.productionApproval===false&&['ownerExitJoined','ownerCloseJoined','stdoutJoined','stderrJoined'].every(k=>capture[k]===true)&&capture.exit?.code===0&&capture.exit.signal===null,'CAPTURE_ORIGINAL_JOINS_REQUIRED');
 const b=capture.bindings;exact(b,descriptor.decoder==='model-r1'?[...common,'actualHostAvailableBytes','purpose']:[...common,'kernelBootId']);must(canonical(b)===canonical(grant.bindings)&&b.owner===review.owner,'CAPTURE_BINDINGS_MISMATCH');
 for(const k of common.filter(k=>k!=='owner'))must(sha(b[k]));
 const configuration={kind:'root-cpu-configuration-v1',...Object.fromEntries(digests.map(k=>[k,k==='dependencyClosureSha256'?b.installedClosureSha256:b[k]]))};
 must(sha(closureSha256)&&configuration.dependencyClosureSha256===closureSha256&&canonical(configuration)===canonical(review.bindings),'CAPTURE_CONFIGURATION_CHANGED');
 must(b.kernelSourceSha256==='1275dd230f10756d1f651e650f5b9f7195712ae836492bfe92c0cdf766f147d3','CAPTURE_KERNEL_SOURCE_CHANGED');
 const owner=capture.kernelOwner,env=review.kernelEnvironment;
 must(owner&&owner.runId===capture.runId&&owner.bootId===env.bootId&&owner.namespaceInode===env.namespaceInode&&owner.waited===true&&owner.populated===false&&owner.leafRemoved===true&&owner.stdoutEOF===true&&owner.stderrEOF===true&&owner.deadlineKilled===false,'CAPTURE_KERNEL_OR_JOINS_CHANGED');
 for(const k of ['memoryPeakBytes','leaderMaxRssBytes','pidsPeak','childStartTicks','inode','device'])must(positive(owner[k]),'CAPTURE_MEASUREMENT_REQUIRED');
 if(descriptor.decoder!=='model-r1')must(b.kernelBootId===owner.bootId,'CAPTURE_BOOT_BINDING_CHANGED');
 exact(capture.hardLimits,['memoryBytes','pids','quotaUsec','periodUsec','timeoutMs']);must(canonical(capture.hardLimits)===canonical(grant.hardLimits),'CAPTURE_LIMITS_CHANGED');
 const limits=capture.hardLimits;must(Object.values(limits).every(positive)&&positive(grant.hostReserveBytes)&&positive(grant.expiresAt));
 const sourceLimits={memoryBytes:descriptor.decoder==='model-r1'?8589934592:1073741824,pids:64,quotaUsec:200000,periodUsec:100000,timeoutMs:descriptor.decoder==='model-r1'?600000:30000};
 must(canonical(limits)===canonical(sourceLimits)&&grant.hostReserveBytes===3221225472&&grant.uid===1000&&grant.gid===1000,'CAPTURE_SOURCE_ENVELOPE_CHANGED');
 must(owner.memoryMaxBytes===limits.memoryBytes&&owner.pidsMax===limits.pids&&owner.cpuQuotaUsec===limits.quotaUsec&&owner.cpuPeriodUsec===limits.periodUsec&&owner.memoryPeakBytes<=owner.memoryMaxBytes&&owner.pidsPeak<=owner.pidsMax,'CAPTURE_LIMIT_READBACK_CHANGED');
 must(Array.isArray(capture.command)&&canonical(capture.command)===canonical(grant.command)&&Array.isArray(capture.inputFacts)&&Array.isArray(grant.readonlyInputs));
 const childPath=capture.command[descriptor.decoder==='model-r1'?4:1];must(capture.command.length===(descriptor.decoder==='model-r1'?7:3)&&typeof childPath==='string');
 function input(path,hash){const a=capture.inputFacts.filter(f=>f.path===path),g=grant.readonlyInputs.filter(f=>f.path===path);must(a.length===1&&g.length===1&&a[0].sha256===hash&&g[0].sha256===hash&&positive(a[0].bytes)&&typeof a[0].inode==='string'&&typeof a[0].device==='string','CAPTURE_ORIGINAL_INPUT_REQUIRED');}
 input(childPath,schema.child);input(grant.kernelOwner,'036ffcc8dd2d8ca93e11854231d24dd66c92bd7426380057cd0d8ff59baddea8');
 let operatorMeasurements=null,probeMeasurements=null;
 if(descriptor.decoder==='model-r1'){
  must(grant.producer===undefined&&b.purpose==='actual CPU model qualification only; no production approval or wire acceptance'&&positive(b.actualHostAvailableBytes)&&b.actualHostAvailableBytes>=limits.memoryBytes+grant.hostReserveBytes,'CAPTURE_MODEL_OBSERVATION_INVALID');operatorMeasurements={hostAvailableBytes:b.actualHostAvailableBytes,observedAt:null};
 }else if(schema.legacy){must(grant.producer===undefined,'CAPTURE_PRODUCER_MISMATCH');}
 else{
  const p=grant.producer;exact(p,['schema','sourcePath','sourceSha256','childSha256','operatorMeasurements']);must(p.schema==='root-cpu-resource-probe-v2'&&p.sourceSha256===schema.source&&p.childSha256===schema.child&&typeof p.sourcePath==='string','CAPTURE_PRODUCER_MISMATCH');input(p.sourcePath,schema.source);
  const m=p.operatorMeasurements;exact(m,['observedAt','hostAvailableBytes','hostReserveBytes']);must(positive(m.observedAt)&&positive(m.hostAvailableBytes)&&m.hostReserveBytes===grant.hostReserveBytes&&m.hostAvailableBytes>=limits.memoryBytes+m.hostReserveBytes,'CAPTURE_OPERATOR_MEASUREMENT_INVALID');
  const completed=events.filter(e=>e.phase==='resource-probe-complete');must(completed.length===1,'CAPTURE_PROBE_EVENT_REQUIRED');const e=completed[0];
  must(e.runId===capture.runId&&e.actualReadLinuxCpuCapacityUsed===true&&e.actualProtectedProfileHashProbeUsed===true&&e.profileDigest===b.profileDigest&&e.helperSha256===b.helperSha256&&e.witnessSha256===b.witnessSha256&&e.modelsImported===false&&e.productionWireValidated===false&&e.productionApproval===false&&String(e.capacityOriginal?.chain?.[0]?.inode)===String(owner.inode),'CAPTURE_PROBE_EVENT_CHANGED');
  must(positive(e.hostAvailableBytes)&&positive(e.hostAvailableObservedAt)&&e.hostAvailableBytes>=limits.memoryBytes+m.hostReserveBytes&&e.hostAvailableObservedAt>=m.observedAt&&e.hostAvailableObservedAt-m.observedAt<=limits.timeoutMs&&e.hostAvailableObservedAt<grant.expiresAt,'CAPTURE_PROBE_MEASUREMENT_INVALID');
  operatorMeasurements={...m};probeMeasurements={hostAvailableBytes:e.hostAvailableBytes,observedAt:e.hostAvailableObservedAt};
 }
 return Object.freeze({configuration:Object.freeze(configuration),kernelEnvironment:Object.freeze({...env}),decoder:descriptor.decoder,operatorMeasurements,probeMeasurements,legacySourceAttested:schema.legacy,rawCaptureSha256:captureSha256,rawGrantSha256:grantSha256,projectionSha256:createHash('sha256').update(canonical(configuration)).digest('hex')});
}
