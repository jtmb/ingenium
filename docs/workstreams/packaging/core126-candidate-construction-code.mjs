// In-memory source proposal fragments; canonical targets are returned by the generator.
export const imageOwnerImport = `import {readInstalledCandidateSource,assertCandidateMeasuredClosure} from './core126-candidate-observation.mjs';
import {assertCandidateInertIntentLive,MAX_CANDIDATE_LEASE_MS} from '../../tools/veyra-release/core126-candidate-intent.mjs';
`;
export const candidateClientMethod = `async acquireCandidate(runtimeId){
  if(!UUID.test(runtimeId??''))unavailable('candidate runtime selection');
  const raw=await requestOriginalManager('/v1/runtimes/'+encodeURIComponent(runtimeId)+'/candidate-closure');
  if(!raw||Object.keys(raw).sort().join('|')!=='completedAt|exec|kind|measurement|proof|schemaVersion|selectionSha256'||raw.schemaVersion!==1||raw.kind!=='original-manager-unapproved-candidate-closure-v1'||!hex(raw.selectionSha256)||!raw.exec||Object.keys(raw.exec).sort().join('|')!=='exitCode|id|inspectSha256|stdoutSha256'||!hex(raw.exec.id)||raw.exec.exitCode!==0||!hex(raw.exec.stdoutSha256)||!hex(raw.exec.inspectSha256)||!integer(raw.completedAt))unavailable('actual original candidate measurement');
  const value=freeze(structuredClone(raw));validateProof(value.proof,now());if(value.proof.parent.runtimeId!==runtimeId||value.completedAt<value.proof.observedAt||value.completedAt>=value.proof.expiresAt)unavailable('candidate observation deadline');
  const token=Object.freeze({});observations.set(token,{client:owner,value:value.proof,candidate:value});return token;
 },`;
export const imageOwnerCandidateSetup = `
 const candidateLocal=new AsyncLocalStorage();
 const candidateCurrent=f=>{
  const lease=candidateLocal.getStore();if(!lease?.active)unavailable('original candidate request observation missing');
  const proof=proofFrom(lease.observation,client,now()),raw=observations.get(lease.observation)?.candidate,selected=readInstalledCandidateSource(now()),d=selected.definition;
  if(!raw||selected.selectionSha256!==lease.selectionSha256||raw.selectionSha256!==selected.selectionSha256)unavailable('original candidate source changed');
  assertCandidateMeasuredClosure(raw.measurement,d);
  const scope=bindOriginal(f,proof,originalProvisionProfile(f),d,now()),c=d.canary;
  if(scope.runId!==d.selection.runId||f.job.id!==c.jobId||f.run.effective_service_principal_id!==c.principalId||scope.organizationId!==c.organizationId||scope.projectId!==c.projectId||scope.ownerUserId!==c.ownerUserId||scope.workspaceId!==c.workspaceId||scope.agentHash!==c.agentHash||f.job.agent!=='qualification'||f.job.prompt_template!=='qualification-canary'||hash(f.job.prompt_template)!==c.promptHash||!integer(f.principalEpoch))unavailable('actual original public canary scope changed');
  if(lease.scopeHash&&lease.scopeHash!==hash(scope))unavailable('original candidate request scope changed');return{lease,scope,proof,d};
 };
 const candidateState={async observe(f,work){
  if(inTransaction()||typeof work!=='function')unavailable('candidate observation outside original transaction required');
  const selected=readInstalledCandidateSource(now()),observation=await client.acquireCandidate(f.runtime.id),lease={observation,selectionSha256:selected.selectionSha256,scopeHash:null,active:true,spent:false};
  try{return await candidateLocal.run(lease,async()=>{const current=candidateCurrent(f);lease.scopeHash=hash(current.scope);return await work();});}finally{lease.active=false;}
 },spend(f,attemptId,runIdentityHash){
  const {lease,scope,proof,d}=candidateCurrent(f);if(lease.spent||!inTransaction()||!UUID.test(attemptId??'')||!hex(runIdentityHash))unavailable('one-use original candidate observation unavailable');lease.spent=true;
  const issuedAt=now(),expiresAt=Math.min(issuedAt+MAX_CANDIDATE_LEASE_MS,d.validUntil,Date.parse(f.runtime.absoluteExpiresAt),Date.parse(f.runtime.idleExpiresAt),issuedAt+f.job.timeout_minutes*60000);
  const intent={schemaVersion:1,purpose:'candidate-inert-v1',caseId:d.selection.caseId,nonce:d.selection.nonce,source:{revision:d.source.revision,sha256:d.source.sha256,filesSha256:hash(d.source.files)},imageId:d.imageId,artifactClosureSha256:hash(d.files),rawSchemaSha256:d.rawSchemaSha256,probeSha256:d.probeSha256,
   parent:{runtimeId:scope.runtimeId,containerId:scope.parentContainerId,daemonId:proof.daemonId,hostId:proof.hostId,startIdentity:proof.parent.startIdentity,publicProfileSha256:proof.parent.publicProfileSha256,provisioningRevision:proof.parent.provisioningRevision},
   scope:{organizationId:scope.organizationId,projectId:scope.projectId,ownerUserId:scope.ownerUserId,workspaceId:scope.workspaceId,bindingHash:scope.bindingHash,bindingEpoch:scope.bindingEpoch,principalId:f.run.effective_service_principal_id,principalSecurityEpoch:f.principalEpoch,grantRevision:f.run.authorization_revision},
   run:{runId:scope.runId,jobId:scope.jobId,attemptId,runIdentityHash,jobRevision:f.run.job_revision,scheduleRevision:f.run.schedule_revision,promptHash:hash(f.job.prompt_template),agentHash:scope.agentHash},resource:{admissionId:scope.runId,runtimeRevision:scope.runtimeRevision,limits:scope.limits},canary:{agent:'qualification',model:'opencode/qualification-canary',tool:'ingenium_project_detail',projectName:d.canary.projectName,trapOrigin:'http://127.0.0.1:39261',catalogSha256:d.catalogSha256},issuedAt:new Date(issuedAt).toISOString(),expiresAt:new Date(expiresAt).toISOString()};
  assertCandidateInertIntentLive(intent,issuedAt);return freeze({intent,selectionSha256:lease.selectionSha256});
 }};
`;
export const imageOwnerCandidateExports = `
/** Observation/data construction only; Core must authorize and commit the original
 * candidate claim before minting its own lexical execution lease. */
export function withOriginalCandidateSourceObservation(owner,facts,work){const state=candidateImageOwners.get(owner);if(!state)unavailable('same original image owner required');return state.observe(facts,work);}
export function spendOriginalCandidateSourceObservation(owner,facts,attemptId,runIdentityHash){const state=candidateImageOwners.get(owner);if(!state)unavailable('same original image owner required');return state.spend(facts,attemptId,runIdentityHash);}
`;
export const coreCandidatePrepare = `  async prepareCandidateInert(selection,ctx){
   if(Object.keys(selection).sort().join('|')!=='projectId|runId|runtimeId|workspaceId')fail('MANAGED_JOB_INVALID_SELECTION');
   if(typeof ports.originalCandidate?.require!=='function')fail('MANAGED_JOB_ORIGINAL_CANDIDATE_CONTEXT_UNAVAILABLE');if(ports.originalCandidate.require(ctx,selection)!==undefined)fail('MANAGED_JOB_ORIGINAL_CANDIDATE_CONTEXT_UNAVAILABLE');
   const before=base(selection,ctx);if(row(selection.runId)||before.run.status!=='running')fail('MANAGED_JOB_CANDIDATE_ALREADY_SEEN');
   return withOriginalCandidateSourceObservation(ports.imageOwner,before,()=>write(()=>{
    if(typeof ports.originalCandidate?.require!=='function')fail('MANAGED_JOB_ORIGINAL_CANDIDATE_CONTEXT_UNAVAILABLE');if(ports.originalCandidate.require(ctx,selection)!==undefined)fail('MANAGED_JOB_ORIGINAL_CANDIDATE_CONTEXT_UNAVAILABLE');const facts=base(selection,ctx);
    if(row(selection.runId)||originalJobRunIdentity(facts.run)!==originalJobRunIdentity(before.run)||facts.runtime.revision!==before.runtime.revision||facts.principalEpoch!==before.principalEpoch)fail('MANAGED_JOB_CANDIDATE_ALREADY_SEEN');
    const {intent,selectionSha256}=spendOriginalCandidateSourceObservation(ports.imageOwner,facts,id(),originalJobRunIdentity(facts.run)),candidateIntentHash=candidateInertIntentHash(intent);
    const project=db.prepare('SELECT name FROM projects WHERE id=? AND archived_at IS NULL').get(facts.job.project_id);if(project?.name!==intent.canary.projectName)fail('MANAGED_JOB_PUBLIC_CANARY_UNAVAILABLE');
    const a={purpose:'candidate-inert-v1',candidateIntentHash,selectionSha256,runId:intent.run.runId,jobId:intent.run.jobId,projectId:intent.scope.projectId,organizationId:intent.scope.organizationId,ownerUserId:intent.scope.ownerUserId,attemptId:intent.run.attemptId,runtimeId:intent.parent.runtimeId,runtimeRevision:intent.resource.runtimeRevision,provisioningRevision:intent.parent.provisioningRevision,parentContainerId:intent.parent.containerId,workspaceId:intent.scope.workspaceId,bindingHash:intent.scope.bindingHash,bindingEpoch:intent.scope.bindingEpoch,jobRevision:intent.run.jobRevision,scheduleRevision:intent.run.scheduleRevision,effectFenceIssuer:fenceIssuer,grantRevision:intent.scope.grantRevision,principalSecurityEpoch:intent.scope.principalSecurityEpoch,promptHash:intent.run.promptHash,daemonId:intent.parent.daemonId,imageId:intent.imageId,resourceAdmissionId:intent.resource.admissionId,agentHash:intent.run.agentHash,model:intent.canary.model,limits:intent.resource.limits,projectName:intent.canary.projectName,deadlineAt:intent.expiresAt};a.specHash=sha(a);
    const columns={run_id:a.runId,project_id:a.projectId,organization_id:a.organizationId,owner_user_id:a.ownerUserId,job_id:a.jobId,attempt_id:a.attemptId,runtime_id:a.runtimeId,parent_container_id:a.parentContainerId,workspace_id:a.workspaceId,binding_hash:a.bindingHash,binding_epoch:a.bindingEpoch,runtime_revision:a.runtimeRevision,provisioning_revision:a.provisioningRevision,job_revision:a.jobRevision,schedule_revision:a.scheduleRevision,grant_revision:a.grantRevision,profile_id:null,profile_hash:null,prompt_hash:a.promptHash,spec_hash:a.specHash,daemon_id:a.daemonId,image_id:a.imageId,phase:'prepared',effect_fence:'open-v1',resource_admission_id:a.resourceAdmissionId,admission_json:JSON.stringify(a),run_identity_hash:intent.run.runIdentityHash,deadline_at:a.deadlineAt,purpose:'candidate-inert-v1',candidate_intent_json:JSON.stringify(intent),candidate_intent_hash:candidateIntentHash,created_at:clock().toISOString(),updated_at:clock().toISOString()};
    db.prepare('INSERT INTO job_run_managed_execution ('+Object.keys(columns).join(',')+') VALUES ('+Object.keys(columns).map(()=>'?').join(',')+')').run(...Object.values(columns));
    const lease=Object.freeze({});candidateLeases.set(lease,{db,admission:Object.freeze(structuredClone(a)),intent,selectionSha256});return lease;
   }));
  },
  /** Metadata receipt, NOT child material. Opaque key is private to this Core instance. */
  describeCandidateLease(lease){same();const value=candidateLeases.get(lease);if(!value||value.db!==db)fail('MANAGED_JOB_ORIGINAL_CANDIDATE_LEASE_UNAVAILABLE');const r=row(value.intent.run.runId),p=describeStoredManagedPurpose(r);if(p.purpose!=='candidate-inert-v1'||p.candidateIntentHash!==candidateInertIntentHash(value.intent)||r.spec_hash!==value.admission.specHash||r.admission_json!==JSON.stringify(value.admission)||r.phase!=='prepared'||r.material_consumed_at||r.credential_id||r.original_container_id||Date.parse(r.deadline_at)<=clock().getTime())fail('MANAGED_JOB_ORIGINAL_CANDIDATE_LEASE_UNAVAILABLE');return Object.freeze({purpose:'candidate-inert-v1',candidateIntentHash:p.candidateIntentHash,runId:r.run_id,attemptId:r.attempt_id,stage:'prepared-no-child-material'});},
  candidateLaunchMaterial(){fail('MANAGED_JOB_ORIGINAL_CANDIDATE_READINESS_UNAVAILABLE');},`;
export const installedCandidateLoader = `
/** Explicit PRIVATE coordinator construction only. Never a missing-approval fallback. */
export function loadInstalledCore126UnapprovedCandidateImageOwner():Core126ImageOwner {
 readInstalledCandidateSource();
 const client=createCore126ObservationClient({requestOriginalManager:async path=>{
  readInstalledCandidateSource();
  const match=/^\\/v1\\/runtimes\\/([a-f0-9-]+)\\/(job-role-proof|candidate-closure)$/.exec(path);
  if(!match?.[1])return deny();return match[2]==='candidate-closure'?inspectManagedRuntimeCandidateClosure(match[1]):inspectManagedRuntimeJobRole(match[1]);
 }});
 const registry=createCore126ImageRegistry({loadManifestBytes:async()=>deny()},[]);
 return createCore126ImageOwner({client,registry,inTransaction:()=>getDb().inTransaction,originalProvisionProfile:facts=>runtimes.getRuntimeOriginalProvision(facts.runtime.id)});
}
`;
