import {AsyncLocalStorage} from 'node:async_hooks';
import {CORE126_PROTOCOL,UUID,hash,originalJsonHash,freeze,hex,imageId,text,integer,validateManifest,unavailable} from './core126-image-contract.mjs';
const clients=new WeakMap(),observations=new WeakMap(),registries=new WeakMap(),definitions=new WeakMap();
const limitsOf=r=>Object.fromEntries(['cpuMillis','memoryBytes','pidsLimit','diskBytes','processLimit'].map(k=>[k,r[k]]));
function scopeOf(f){
 const r=f?.runtime,w=f?.workspace,j=f?.job,run=f?.run;
 if(!r||!w||!j||!run||![r.id,r.organizationId,r.projectId,r.ownerUserId,j.id,run.id].every(v=>UUID.test(v??''))||!hex(r.backendContainerId)||r.workspaceId!==w.id||r.organizationId!==w.organizationId||r.projectId!==w.projectId||r.ownerUserId!==w.ownerUserId||r.securityEpoch!==w.securityEpoch||w.status!=='authorized'||j.project_id!==r.projectId||j.organization_id!==r.organizationId||run.job_id!==j.id||run.project_id!==j.project_id||run.organization_id!==j.organization_id||!['READY','IDLE'].includes(r.state)||!hex(w.storageMappingHash)||!integer(r.revision)||!integer(r.securityEpoch))unavailable('current original Core scope');
 const limits=limitsOf(r);if(Object.values(limits).some(v=>!integer(v)||v<=0))unavailable('current Core limits');
 return {runId:run.id,jobId:j.id,projectId:r.projectId,organizationId:r.organizationId,ownerUserId:r.ownerUserId,runtimeId:r.id,runtimeRevision:r.revision,parentContainerId:r.backendContainerId,workspaceId:w.id,bindingHash:w.storageMappingHash,bindingEpoch:w.securityEpoch,limits,agentHash:originalJsonHash(f.agentConfig)};
}
function validateProof(p,now){
 if(!p||p.schemaVersion!==1||p.kind!=='original-manager-core126-parent-v1'||!text(p.daemonId)||p.hostId!=='docker-daemon:'+hash('veyra-docker-host-v1\0'+p.daemonId)||!integer(p.observedAt)||p.expiresAt!==p.observedAt+5000||p.observedAt>now||p.expiresAt<=now||!p.parent||!hex(p.parent.id)||!hex(p.parent.publicProfileSha256)||!hex(p.parent.startIdentity)||!imageId(p.parent.imageId)||p.image?.id!==p.parent.imageId||!integer(p.parent.provisioningRevision)||!integer(p.parent.bindingEpoch)||!integer(p.parent.memoryBytes)||!integer(p.parent.nanoCpus)||!integer(p.parent.effectivePids))unavailable('fresh full original manager proof');
 return p;
}
/** requestOriginalManager must be the original private authenticated client; no caller header/token owner. */
export function createCore126ObservationClient({requestOriginalManager,now=Date.now}){
 if(typeof requestOriginalManager!=='function')unavailable('original authenticated manager client export');
 const owner={async acquire(runtimeId){
  if(!UUID.test(runtimeId??''))unavailable('runtime selection');
  const raw=await requestOriginalManager('/v1/runtimes/'+encodeURIComponent(runtimeId)+'/job-role-proof');
  const value=freeze(structuredClone(validateProof(raw,now())));if(value.parent.runtimeId!==runtimeId)unavailable('manager runtime response');
  const token=Object.freeze({});observations.set(token,{client:owner,value});return token;
 }};clients.set(owner,{now});return Object.freeze(owner);
}
export function createCore126ImageRegistry({loadManifestBytes,now=Date.now},approvedImages){
 if(typeof loadManifestBytes!=='function'||!Array.isArray(approvedImages))unavailable('independent image approval owner');
 const policy=new Map();for(const row of approvedImages){if(!imageId(row.imageId)||!hex(row.manifestSha256)||!hex(row.sourceSha256)||!/^[a-f0-9]{40}$/.test(row.sourceRevision??'')||!integer(row.validUntil)||policy.has(row.imageId))unavailable('immutable approval record');policy.set(row.imageId,freeze(structuredClone(row)));}
 const cache=new Map(),registry={async load(id){
  const approval=policy.get(id);if(!approval||approval.validUntil<=now())unavailable('unapproved original image');
  if(!cache.has(id))cache.set(id,(async()=>{const bytes=await loadManifestBytes(id);if(!Buffer.isBuffer(bytes)||bytes.length>256*1024||hash(bytes)!==approval.manifestSha256)unavailable('approved manifest raw digest');
   const m=freeze(validateManifest(JSON.parse(bytes.toString('utf8'))));if(m.imageId!==id||m.source.revision!==approval.sourceRevision||m.source.sha256!==approval.sourceSha256)unavailable('independent immutable source/image approval');
   const token=Object.freeze({});definitions.set(token,{registry,manifest:m,approval});return token;})());
  return await cache.get(id);
 }};registries.set(registry,{now});return Object.freeze(registry);
}
function definition(token,registry,now){const d=definitions.get(token);if(!d||d.registry!==registry||d.approval.validUntil<=now)unavailable('sealed approved image definition');return d;}
function proofFrom(token,client,now){const p=observations.get(token);if(!p||p.client!==client)unavailable('sealed original observation');return validateProof(p.value,now);}
function bindOriginal(f,proof,expected,manifest,now){
 const s=scopeOf(f),p=proof.parent;
 if([f.runtime.absoluteExpiresAt,f.runtime.idleExpiresAt].some(value=>!Number.isFinite(Date.parse(value))||Date.parse(value)<=now))unavailable('original runtime deadline');
 if(p.id!==s.parentContainerId||p.name!=='/ingenium-runtime-'+s.runtimeId.replaceAll('-','')||p.runtimeId!==s.runtimeId||p.organizationId!==s.organizationId||p.projectId!==s.projectId||p.ownerUserId!==s.ownerUserId||p.workspaceId!==s.workspaceId||p.bindingHash!==s.bindingHash||p.bindingEpoch!==s.bindingEpoch||p.imageId!==manifest.imageId||p.provisioningRevision>s.runtimeRevision||p.memoryBytes!==s.limits.memoryBytes||p.nanoCpus!==s.limits.cpuMillis*1000000||p.effectivePids!==Math.min(s.limits.pidsLimit,s.limits.processLimit))unavailable('current parent/Core/resources changed');
 if(!expected||expected.imageId!==p.imageId||expected.startIdentity!==p.startIdentity||expected.runtimeId!==s.runtimeId||expected.parentContainerId!==s.parentContainerId||expected.hostId!==proof.hostId||expected.workspaceId!==s.workspaceId||expected.bindingHash!==s.bindingHash||expected.bindingEpoch!==s.bindingEpoch||expected.provisioningRevision!==p.provisioningRevision||expected.publicProfileSha256!==p.publicProfileSha256||hash(expected.limits)!==hash(s.limits))unavailable('original nonsecret provisioning/profile owner unavailable or changed');
 if(hash(proof.image.config)!==hash(manifest.config))unavailable('current immutable image configuration');return s;
}
function imageIdentity(s,proof,manifestSha,model,modelBindingHash){
 if(!text(model)||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}\/[^\s\u0000-\u001f\u007f]{1,256}$/u.test(model)||!hex(modelBindingHash))unavailable('current Core model binding');
 return hash({scope:s,daemonId:proof.daemonId,imageId:proof.parent.imageId,parentStartIdentity:proof.parent.startIdentity,provisioningRevision:proof.parent.provisioningRevision,publicProfileSha256:proof.parent.publicProfileSha256,manifestSha256:manifestSha,model,modelBindingHash});
}
/** No DB authority is introduced: Core supplies/rechecks its own facts. Every
 * request uses its own ALS-sealed observation and synchronous original projection. */
export function createCore126ImageOwner({client,registry,originalProvisionProfile,inTransaction,now=Date.now}){
 if(!clients.has(client)||!registries.has(registry)||typeof originalProvisionProfile!=='function'||typeof inTransaction!=='function')unavailable('original owner exports missing');
 const local=new AsyncLocalStorage();
 function current(f){const lease=local.getStore();if(!lease?.active)unavailable('fresh request-scoped observation missing');const proof=proofFrom(lease.observation,client,now()),d=definition(lease.definition,registry,now());
  const scope=bindOriginal(f,proof,originalProvisionProfile(f),d.manifest,now());if(hash(scope)!==lease.scopeHash)unavailable('request scope changed');return{scope,proof,d};}
 return Object.freeze({
  async withFreshOriginalJobRole(f,work){
   if(inTransaction())unavailable('manager observation must precede Core transaction');if(typeof work!=='function')unavailable('request continuation');
   const observation=await client.acquire(f.runtime.id),proof=proofFrom(observation,client,now()),def=await registry.load(proof.parent.imageId),d=definition(def,registry,now());
   proofFrom(observation,client,now());
   const scope=bindOriginal(f,proof,originalProvisionProfile(f),d.manifest,now());
   const lease={observation,definition:def,scopeHash:hash(scope),active:true}; try{return await local.run(lease,work);}finally{lease.active=false;}
  },
  async qualifyOriginalJobRole(f){
   const {scope,proof,d}=current(f),profileHash=imageIdentity(scope,proof,d.approval.manifestSha256,f.model,f.modelBindingHash);
   return freeze({qualified:true,id:'core126-image:'+d.approval.manifestSha256,hash:profileHash,imageId:d.manifest.imageId,parentImageId:proof.parent.imageId,daemonId:proof.daemonId,provisioningRevision:proof.parent.provisioningRevision,
    approvedScopes:[...d.manifest.approvedScopes],expiresAt:Math.min(d.approval.validUntil,Date.parse(f.runtime.absoluteExpiresAt)),agentHash:scope.agentHash,model:f.model,modelBindingHash:f.modelBindingHash,jobRunAudience:'job-run',transport:CORE126_PROTOCOL});
  },
  describeOriginalJobBootstrap(admission,f){
   this.assertCurrentOriginalJobRole(admission,f);const {d}=current(f);return freeze({imageId:d.manifest.imageId,files:structuredClone(d.manifest.files)});
  },
  assertCurrentOriginalJobRole(admission,f){
   const {scope,proof,d}=current(f);
   const admittedScope=Object.fromEntries(Object.keys(scope).map(key=>[key,admission[key]]));
   if(hash(admittedScope)!==hash(scope)||hash(admission.approvedScopes)!==hash(d.manifest.approvedScopes)||!Number.isFinite(Date.parse(admission.deadlineAt))||Date.parse(admission.deadlineAt)<=now())unavailable('admitted current scope/limits/deadline');
   if(admission.profileId!=='core126-image:'+d.approval.manifestSha256||admission.profileHash!==imageIdentity(scope,proof,d.approval.manifestSha256,admission.model,admission.modelBindingHash)||admission.imageId!==proof.parent.imageId||admission.parentContainerId!==proof.parent.id||admission.daemonId!==proof.daemonId||admission.provisioningRevision!==proof.parent.provisioningRevision)unavailable('original qualified admission changed');return true;
  },
 });
}
/** Manager calls after its own fresh raw Docker probe before EACH create/start.
 * The admitted Core profile hash was previously bound to the original projection. */
export function assertAdmissionOriginalImage(admission,proof,definitionToken,registry,now=Date.now()){
 validateProof(proof,now);const d=definition(definitionToken,registry,now),p=proof.parent;
 const scope={runId:admission.runId,jobId:admission.jobId,projectId:admission.projectId,organizationId:admission.organizationId,ownerUserId:admission.ownerUserId,runtimeId:admission.runtimeId,runtimeRevision:admission.runtimeRevision,parentContainerId:admission.parentContainerId,workspaceId:admission.workspaceId,bindingHash:admission.bindingHash,bindingEpoch:admission.bindingEpoch,limits:admission.limits,agentHash:admission.agentHash};
 if(!Number.isFinite(Date.parse(admission.deadlineAt))||Date.parse(admission.deadlineAt)<=now||hash(admission.approvedScopes)!==hash(d.manifest.approvedScopes)||admission.organizationId!==p.organizationId||admission.projectId!==p.projectId||admission.ownerUserId!==p.ownerUserId||admission.workspaceId!==p.workspaceId||p.name!=='/ingenium-runtime-'+admission.runtimeId.replaceAll('-','')||p.memoryBytes!==admission.limits.memoryBytes||p.nanoCpus!==admission.limits.cpuMillis*1000000||p.effectivePids!==Math.min(admission.limits.pidsLimit,admission.limits.processLimit)||hash(proof.image.config)!==hash(d.manifest.config)||admission.profileId!=='core126-image:'+d.approval.manifestSha256||admission.imageId!==p.imageId||d.manifest.imageId!==p.imageId||admission.parentContainerId!==p.id||admission.runtimeId!==p.runtimeId||admission.bindingHash!==p.bindingHash||admission.bindingEpoch!==p.bindingEpoch||admission.daemonId!==proof.daemonId||admission.provisioningRevision!==p.provisioningRevision||admission.profileHash!==imageIdentity(scope,proof,d.approval.manifestSha256,admission.model,admission.modelBindingHash))unavailable('fresh manager effect image/profile proof changed');return true;
}
