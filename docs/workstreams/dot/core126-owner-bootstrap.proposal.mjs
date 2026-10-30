import {projectCore126AgentMaterial} from "../../../../packages/veyra-operations/core126-agent-material.mjs";
import {createHash,randomUUID} from "node:crypto";
const sha=value=>createHash("sha256").update(typeof value==="string"?value:JSON.stringify(value)).digest("hex");
const fail=code=>{throw Object.assign(Error(code),{code,status:code.endsWith("UNAVAILABLE")?503:409});};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const scopes=value=>Array.isArray(value)&&value.length>0&&value.length<=64&&value.every(v=>typeof v==="string"&&/^[a-z][a-z0-9:._-]{0,127}$/.test(v)&&!["child-mcp:runtime","user:admin"].includes(v));
export const originalJobRunIdentity=run=>sha([run.id,run.job_id,run.project_id,run.organization_id,run.effective_service_principal_id,run.job_revision,run.schedule_revision??null,run.authorization_revision,run.trigger,run.scheduled_for??null,run.created_at]);
/** Core sole writer. All async profile/catalog work finishes before synchronous DB transactions. */
export function createCore126Owner(ports){
 const {getDb,execTransaction,checkpointAfterWrite,jobs,runtimes,agents,authorization,credentials,profiles,requireManager,verifierFactory}=ports;
 const clock=ports.now??(()=>new Date()),id=ports.id??randomUUID,db=getDb(),fenceIssuer=randomUUID();
 const same=()=>{if(getDb()!==db)fail("MANAGED_JOB_DATABASE_REPLACED");};
 const write=fn=>{same();if(db.inTransaction)fail("MANAGED_JOB_OUTER_TRANSACTION");const value=execTransaction(fn,1);if(db.inTransaction)fail("MANAGED_JOB_COMMIT_UNCONFIRMED");checkpointAfterWrite();return value;};
 const row=runId=>{same();if(!uuid.test(runId))fail("MANAGED_JOB_INVALID_ID");return db.prepare("SELECT * FROM job_run_managed_execution WHERE run_id=?").get(runId);};
 const read=runId=>{const r=row(runId);if(!r)fail("MANAGED_JOB_NOT_FOUND");return {r,a:{...JSON.parse(r.admission_json),phase:r.phase,revision:r.revision,containerId:r.original_container_id,effectFence:r.effect_fence??"untracked",retirementProof:r.retirement_proof?JSON.parse(r.retirement_proof):null,cancelRequested:r.phase==="cancel_requested",outcomeConsumed:!!r.outcome_consumed_at}};};
 function base(selection,ctx){
  same();const run=jobs.getJobRun(selection.projectId,selection.runId),job=run&&jobs.getJob(selection.projectId,run.job_id);
  if(!run||!job||run.project_id!==selection.projectId||run.organization_id!==job.organization_id||run.job_id!==job.id||run.job_revision!==job.revision||run.schedule_revision!==job.schedule_revision||run.effective_service_principal_id!==job.service_principal_id||!jobs.isJobRunAuthorizationCurrent(run.project_id,run.id))fail("MANAGED_JOB_AUTHORIZATION_UNAVAILABLE");
  const workspace=runtimes.getAuthorizedWorkspace(selection.workspaceId),runtime=runtimes.resolveRuntimePreflightScope({runtimeId:selection.runtimeId,organizationId:job.organization_id,projectId:job.project_id,workspaceId:selection.workspaceId,storageMappingHash:workspace?.storageMappingHash});
  if(!runtime||!workspace||workspace.status!=="authorized"||runtime.workspaceId!==workspace.id||runtime.ownerUserId!==workspace.ownerUserId||runtime.securityEpoch!==workspace.securityEpoch||runtime.organizationId!==job.organization_id||runtime.projectId!==job.project_id||!runtime.backendContainerId||!runtime.absoluteExpiresAt||Date.parse(runtime.absoluteExpiresAt)<=clock().getTime()||!runtime.idleExpiresAt||Date.parse(runtime.idleExpiresAt)<=clock().getTime())fail("MANAGED_JOB_RUNTIME_UNAVAILABLE");
  if(job.owner_kind==="user"&&job.owner_user_id!==runtime.ownerUserId)fail("MANAGED_JOB_PRIVATE_DENIED");
  if(ctx){const p=ctx.revalidate?.();if(!p||!["browser-user","user-token","service-principal"].includes(p.type)||!authorization.requireProjectPermission(p,job.project_id,"jobs","execute").allowed)fail("MANAGED_JOB_PRIVATE_DENIED");if(job.visibility==="private"&&(!["browser-user","user-token"].includes(p.type)||p.id!==job.owner_user_id))fail("MANAGED_JOB_PRIVATE_DENIED");}
  const member=db.prepare("SELECT 1 FROM organization_memberships m JOIN users u ON u.id=m.user_id AND u.status='active' LEFT JOIN project_memberships pm ON pm.project_id=? AND pm.user_id=m.user_id WHERE m.organization_id=? AND m.user_id=? AND m.status='active' AND (m.role IN ('owner','admin') OR pm.user_id IS NOT NULL)").get(job.project_id,job.organization_id,runtime.ownerUserId);
  if(!member)fail("MANAGED_JOB_MEMBERSHIP_UNAVAILABLE");
  const op=db.prepare("SELECT 1 FROM veyra_dot_records WHERE kind='operation' AND json_extract(body,'$.state') IN ('claimed','running') AND json_extract(body,'$.runId')=? AND json_extract(body,'$.scope.projectId')=? AND json_extract(body,'$.scope.organizationId')=? AND json_extract(body,'$.scope.ownerUserId')=? AND json_extract(body,'$.scope.executionBindingId')=? LIMIT 1").get(run.id,job.project_id,job.organization_id,runtime.ownerUserId,workspace.id);
  if(!op)fail("MANAGED_JOB_ORIGINAL_OPERATION_UNAVAILABLE");
  const counts=db.prepare("SELECT count(*) AS global_count,count(*) FILTER(WHERE organization_id=?) AS org_count,count(*) FILTER(WHERE effective_service_principal_id=?) AS principal_count FROM job_runs WHERE status IN ('running','queued')").get(run.organization_id,run.effective_service_principal_id);
  if(counts.global_count>2||counts.org_count>1||counts.principal_count>1)fail("MANAGED_JOB_QUOTA_UNAVAILABLE");
  const principalEpoch=db.prepare("SELECT security_epoch FROM service_principals WHERE id=? AND status='active'").get(run.effective_service_principal_id)?.security_epoch;
  if(!Number.isSafeInteger(principalEpoch))fail("MANAGED_JOB_AUTHORIZATION_UNAVAILABLE");
  return {run,job,runtime,workspace,principalEpoch,agentConfig:agents.getJobAgentConfig(job.project_id,job.agent)};
 }
 const hasCancelIntent=runId=>!!db.prepare("SELECT 1 FROM veyra_dot_records WHERE kind='operation' AND json_extract(body,'$.runId')=? AND json_extract(body,'$.state')='cancel_requested' LIMIT 1").get(runId);
 function current(runId,action){
  const value=read(runId),{r,a}=value,run=jobs.getJobRun(r.project_id,runId);
  if(!run||originalJobRunIdentity(run)!==r.run_identity_hash)fail("MANAGED_JOB_RUN_IDENTITY_CHANGED");
  if(action==="launch"){
   const facts=base({runId,projectId:r.project_id,runtimeId:r.runtime_id,workspaceId:r.workspace_id});
   if(run.status!=="running"||a.cancelRequested||hasCancelIntent(runId)||clock().getTime()>=Date.parse(r.deadline_at)||facts.principalEpoch!==a.principalSecurityEpoch||facts.runtime.revision!==a.runtimeRevision||facts.runtime.backendContainerId!==a.parentContainerId||facts.workspace.storageMappingHash!==a.bindingHash||facts.workspace.securityEpoch!==a.bindingEpoch||sha(facts.agentConfig)!==a.agentHash)fail("MANAGED_JOB_AUTHORIZATION_UNAVAILABLE");
   profiles.assertCurrent(a,facts); // Server-owned immutable-image/profile/resource qualification, never request body.
  }
  return {...value,run};
 }
 const cas=(r,fields)=>{
  const allowed=new Set(["phase","effect_fence","original_container_id","credential_id","material_consumed_at","result_json","retirement_proof","outcome_consumed_at","container_removed_at"]);
  const entries=Object.entries(fields);if(entries.some(([k])=>!allowed.has(k)))fail("MANAGED_JOB_INVALID_WRITE");
  const changed=db.prepare(`UPDATE job_run_managed_execution SET ${entries.map(([k])=>k+"=?").join(",")},revision=revision+1,updated_at=? WHERE run_id=? AND revision=?`).run(...entries.map(([,v])=>v),clock().toISOString(),r.run_id,r.revision).changes;
  if(changed!==1)fail("MANAGED_JOB_REVISION_CONFLICT");return read(r.run_id).a;
 };
 const fence=(runId,key,action)=>{const c=current(runId,action);if(!key||Object.keys(key).some(k=>!["attemptId","revision","specHash","kind","containerId","phase","proof"].includes(k))||key.attemptId!==c.a.attemptId||key.specHash!==c.a.specHash||key.revision!==c.r.revision)fail("MANAGED_JOB_REVISION_CONFLICT");return c;};
 const noCreateProof=c=>{
  const {r,a}=c,p=a.retirementProof;
  if(r.effect_fence!=="closed-no-create-v1"||r.phase!=="retired"||r.original_container_id||r.material_consumed_at||r.credential_id||r.result_json||db.prepare("SELECT 1 FROM job_run_mcp_credentials WHERE run_id=?").get(r.run_id)
    ||!p||p.schemaVersion!==1||p.kind!=="core-no-create-effect-v1"||p.runId!==r.run_id||p.attemptId!==r.attempt_id||p.specHash!==r.spec_hash||p.runIdentityHash!==r.run_identity_hash||p.effectFence!==r.effect_fence||!Number.isSafeInteger(p.closedRevision)||p.closedRevision>r.revision||p.closedRevision<1||!Number.isFinite(Date.parse(p.closedAt)))fail("MANAGED_JOB_NO_CREATE_PROOF_UNAVAILABLE");
  return p;
 };
 const manager=ctx=>{requireManager(ctx);same();};
 return Object.freeze({
  factsForImagePreparation(selection,ctx){
   if(Object.keys(selection).sort().join("|")!=="projectId|runId|runtimeId|workspaceId")fail("MANAGED_JOB_INVALID_SELECTION");
   return base(selection,ctx);
  },
  factsForOriginalImageCheck(runId){
   const {r}=current(runId,"inspect");
   return base({runId,projectId:r.project_id,runtimeId:r.runtime_id,workspaceId:r.workspace_id});
  },
  async prepare(selection,ctx){
   if(Object.keys(selection).sort().join("|")!=="projectId|runId|runtimeId|workspaceId")fail("MANAGED_JOB_INVALID_SELECTION");
   const before=base(selection,ctx);if(row(selection.runId))return current(selection.runId,"launch").a;if(before.run.status!=="running")fail("MANAGED_JOB_AUTHORIZATION_UNAVAILABLE");
   const profile=await profiles.qualify(before); // Existing broker/provider factories; no SQL transaction crosses await.
   const after=base(selection,ctx);if(originalJobRunIdentity(after.run)!==originalJobRunIdentity(before.run)||sha(after.agentConfig)!==sha(before.agentConfig)||after.runtime.revision!==before.runtime.revision)fail("MANAGED_JOB_AUTHORIZATION_UNAVAILABLE");
   if(profile?.qualified!==true||!Number.isFinite(profile.expiresAt)||profile.expiresAt<=clock().getTime()||!scopes(profile.approvedScopes)||!/^[a-f0-9]{64}$/.test(profile.hash??"")||!/^[a-f0-9]{64}$/.test(profile.modelBindingHash??"")||profile.imageId!==profile.parentImageId||!/^sha256:[a-f0-9]{64}$/.test(profile.imageId)||!profile.resourceAdmissionId||!profile.daemonId||!Number.isSafeInteger(profile.provisioningRevision))fail("MANAGED_JOB_PROFILE_UNAVAILABLE");
   const deadline=new Date(Math.min(clock().getTime()+after.job.timeout_minutes*60_000,Date.parse(after.runtime.absoluteExpiresAt),profile.expiresAt)).toISOString();
   const a={runId:after.run.id,jobId:after.job.id,projectId:after.job.project_id,organizationId:after.job.organization_id,ownerUserId:after.runtime.ownerUserId,attemptId:id(),runtimeId:after.runtime.id,runtimeRevision:after.runtime.revision,provisioningRevision:profile.provisioningRevision,parentContainerId:after.runtime.backendContainerId,workspaceId:after.workspace.id,bindingHash:after.workspace.storageMappingHash,bindingEpoch:after.workspace.securityEpoch,jobRevision:after.run.job_revision,scheduleRevision:after.run.schedule_revision,effectFenceIssuer:fenceIssuer,grantRevision:after.run.authorization_revision,principalSecurityEpoch:after.principalEpoch,profileId:profile.id,profileHash:profile.hash,promptHash:sha(after.job.prompt_template),daemonId:profile.daemonId,imageId:profile.imageId,approvedScopes:[...profile.approvedScopes].sort(),resourceAdmissionId:profile.resourceAdmissionId,agentHash:sha(after.agentConfig),modelBindingHash:profile.modelBindingHash,model:profile.model,limits:profile.limits,projectName:profile.projectName,deadlineAt:deadline};a.specHash=sha(a);
   return write(()=>{
    const currentFacts=base(selection,ctx);if(row(a.runId))return current(a.runId,"launch").a;
    profiles.assertCurrent({...a,phase:"prepared",revision:0,containerId:null,cancelRequested:false,outcomeConsumed:false},currentFacts);
    const columns={run_id:a.runId,project_id:a.projectId,organization_id:a.organizationId,owner_user_id:a.ownerUserId,job_id:a.jobId,attempt_id:a.attemptId,runtime_id:a.runtimeId,parent_container_id:a.parentContainerId,workspace_id:a.workspaceId,binding_hash:a.bindingHash,binding_epoch:a.bindingEpoch,runtime_revision:a.runtimeRevision,provisioning_revision:a.provisioningRevision,job_revision:a.jobRevision,schedule_revision:a.scheduleRevision,grant_revision:a.grantRevision,profile_id:a.profileId,profile_hash:a.profileHash,prompt_hash:a.promptHash,spec_hash:a.specHash,daemon_id:a.daemonId,image_id:a.imageId,phase:"prepared",effect_fence:"open-v1",resource_admission_id:a.resourceAdmissionId,admission_json:JSON.stringify(a),run_identity_hash:originalJobRunIdentity(after.run),deadline_at:deadline,created_at:clock().toISOString(),updated_at:clock().toISOString()};
    db.prepare(`INSERT INTO job_run_managed_execution (${Object.keys(columns).join(",")}) VALUES (${Object.keys(columns).map(()=>"?").join(",")})`).run(...Object.values(columns));return read(a.runId).a;
   });
  },
  admit(runId,action,ctx){manager(ctx);if(!["launch","inspect","cancel","cleanup"].includes(action))fail("MANAGED_JOB_INVALID_ACTION");if(action==="cancel"&&hasCancelIntent(runId)&&read(runId).r.phase!=="retired")return write(()=>{const {r}=current(runId,"inspect");return r.phase==="cancel_requested"?read(runId).a:cas(r,{phase:"cancel_requested"});});const c=current(runId,action);if(c.r.effect_fence==="closed-no-create-v1")noCreateProof(c);return c.a;},
  claimEffect(runId,key,ctx){manager(ctx);return write(()=>{const {r,a}=fence(runId,key,"launch"),expected=key.kind==="create"?"prepared":key.kind==="start"?"created":null;if(!expected||a.effectFenceIssuer!==fenceIssuer||r.phase!==expected||a.cancelRequested||(key.kind==="create"&&(r.effect_fence!=="material-admitted-v1"||!r.material_consumed_at||!r.credential_id))||(key.kind==="start"&&r.effect_fence!=="create-admitted-v1"))return {accepted:false};const admission=cas(r,{phase:key.kind+"_intent",...(key.kind==="create"?{effect_fence:"create-admitted-v1"}:{})});return {accepted:true,admission};});},
  recordCreated(runId,key,ctx){manager(ctx);return write(()=>{const {r,a}=fence(runId,key,"launch");if(r.phase!=="create_intent"||r.original_container_id||!/^[a-f0-9]{64}$/.test(key.containerId)||key.containerId===a.parentContainerId)fail("MANAGED_JOB_EFFECT_CONFLICT");return cas(r,{original_container_id:key.containerId,phase:"created"});});},
  recordStarted(runId,key,ctx){manager(ctx);return write(()=>{const {r}=fence(runId,key,"launch");if(r.phase!=="start_intent")fail("MANAGED_JOB_EFFECT_CONFLICT");return cas(r,{phase:"running"});});},
  recordUnknown(runId,key,ctx){manager(ctx);return write(()=>{const {r}=fence(runId,key,"inspect");if(r.phase==="cancel_requested")return read(runId).a;if(!["create","start"].includes(key.phase)||r.phase!==key.phase+"_intent")fail("MANAGED_JOB_EFFECT_CONFLICT");return cas(r,{phase:key.phase+"_unknown"});});},
  async launchMaterial(runId,key,ctx){manager(ctx);let before=fence(runId,key,"launch");if(before.r.phase!=="prepared"||before.r.effect_fence!=="open-v1"||before.a.effectFenceIssuer!==fenceIssuer||before.r.material_consumed_at)fail("MANAGED_JOB_MATERIAL_UNAVAILABLE");
   // Accepted material requests are fenced BEFORE any await/credential work, even if their acknowledgement is lost.
   write(()=>{const c=fence(runId,key,"launch");if(c.r.effect_fence!=="open-v1")fail("MANAGED_JOB_MATERIAL_UNAVAILABLE");cas(c.r,{effect_fence:"material-admitted-v1"});});
   before=current(runId,"launch");key={attemptId:before.a.attemptId,revision:before.r.revision,specHash:before.a.specHash};
   const facts=base({runId,projectId:before.a.projectId,runtimeId:before.a.runtimeId,workspaceId:before.a.workspaceId});const profile=await profiles.qualify(facts);
   if(!profile.qualified||profile.hash!==before.a.profileHash||profile.modelBindingHash!==before.a.modelBindingHash)fail("MANAGED_JOB_PROFILE_UNAVAILABLE");
   manager(ctx);return write(()=>{const {r,a}=fence(runId,key,"launch");if(r.material_consumed_at)fail("MANAGED_JOB_MATERIAL_UNAVAILABLE");
    const finalFacts=base({runId,projectId:a.projectId,runtimeId:a.runtimeId,workspaceId:a.workspaceId});
    const agentMaterial=projectCore126AgentMaterial({admission:a,agentName:finalFacts.job.agent,agentConfig:finalFacts.agentConfig},clock().getTime());
    const credential=credentials.issueManagedJobCredential({runId,attemptId:a.attemptId});
    const updated=cas(r,{credential_id:credential.id,material_consumed_at:clock().toISOString()});
    const workspace=runtimes.getAuthorizedWorkspace(a.workspaceId);
    return {admission:updated,runId,attemptId:a.attemptId,credentialRunId:runId,profileQualified:true,agentMaterial,capability:credential.token,provision:{runtimeId:a.runtimeId,backendName:"ingenium-runtime-"+a.runtimeId.replaceAll("-",""),organizationId:a.organizationId,projectId:a.projectId,projectName:a.projectName,ownerUserId:a.ownerUserId,workspaceId:a.workspaceId,storagePath:workspace.storagePath,storageMappingHash:a.bindingHash,securityEpoch:a.bindingEpoch,revision:a.provisioningRevision,capability:credential.token,capabilityExpiresAt:credential.expiresAt,limits:a.limits}};
   });
  },
  closeNoCreate(runId,key,ctx){manager(ctx);return write(()=>{
   const c=fence(runId,key,"inspect"),{r,a,run}=c;
   if(r.effect_fence!=="open-v1"||a.effectFenceIssuer!==fenceIssuer||!["prepared","cancel_requested"].includes(r.phase)||r.original_container_id||r.material_consumed_at||r.credential_id||r.result_json||r.retirement_proof||db.prepare("SELECT 1 FROM job_run_mcp_credentials WHERE run_id=?").get(runId)||!["running","queued"].includes(run.status))fail("MANAGED_JOB_NO_CREATE_PROOF_UNAVAILABLE");
   const proof={schemaVersion:1,kind:"core-no-create-effect-v1",runId,attemptId:a.attemptId,specHash:a.specHash,runIdentityHash:r.run_identity_hash,effectFence:"closed-no-create-v1",closedRevision:r.revision+1,closedAt:clock().toISOString()};
   const cancelled=r.phase==="cancel_requested"||hasCancelIntent(runId);
   cas(r,{effect_fence:"closed-no-create-v1",phase:"retired",retirement_proof:JSON.stringify(proof)});
   if(cancelled)jobs.cancelJobRun(r.project_id,runId);else jobs.finishJobRun(r.project_id,runId,"failed",null);
   const closed=current(runId,"inspect");noCreateProof(closed);return closed.a;
  });},
  recordRetired(runId,key,ctx){manager(ctx);return write(()=>{const {r,a,run}=fence(runId,key,"inspect"),p=key.proof;if(!["create-admitted-v1","untracked"].includes(r.effect_fence)||!r.original_container_id||!/^[a-f0-9]{64}$/.test(r.original_container_id)||!p||Object.keys(p).sort().join("|")!=="attemptId|containerId|daemonId|exitCode|kind|runId|schemaVersion|specHash"||p.schemaVersion!==1||p.runId!==runId||p.attemptId!==a.attemptId||p.containerId!==r.original_container_id||p.daemonId!==a.daemonId||p.specHash!==a.specHash||p.kind!=="original-daemon-container-wait-join"||!Number.isInteger(p.exitCode))fail("MANAGED_JOB_RETIREMENT_UNAVAILABLE");
   const cancelled=r.phase==="cancel_requested";cas(r,{phase:"retired",retirement_proof:JSON.stringify(p)});credentials.revokeManagedJobCredential(runId);
   const result=r.result_json?JSON.parse(r.result_json):null;
   if(["running","queued"].includes(run.status)){if(cancelled)jobs.cancelJobRun(r.project_id,runId);else jobs.finishJobRun(r.project_id,runId,clock().getTime()>=Date.parse(r.deadline_at)?"timeout":p.exitCode===0&&result?.exitCode===0&&result?.verified?"success":"failed",p.exitCode);}
   return read(runId).a;
  });},
  consume(runId,ctx){manager(ctx);return write(()=>{const {r,run}=current(runId,"inspect");if(r.phase!=="retired"||!r.retirement_proof||!["success","failed","cancelled","timeout"].includes(run.status)||!db.prepare("SELECT 1 FROM veyra_dot_records WHERE kind='operation' AND json_extract(body,'$.runId')=? AND json_extract(body,'$.state') IN ('success','failed','cancelled') LIMIT 1").get(runId))fail("MANAGED_JOB_OUTCOME_UNAVAILABLE");return r.outcome_consumed_at?read(runId).a:cas(r,{outcome_consumed_at:clock().toISOString()});});},
  recordRemoved(runId,key,ctx){manager(ctx);return write(()=>{const {r}=fence(runId,key,"cleanup");if(r.phase!=="retired"||r.effect_fence==="closed-no-create-v1"||!r.original_container_id||!r.outcome_consumed_at||!r.retirement_proof)fail("MANAGED_JOB_CLEANUP_UNAVAILABLE");return cas(r,{container_removed_at:clock().toISOString()});});},
  readOriginalRun(runId,scope,ctx){const {r,a,run}=current(runId,"inspect"),principal=ctx?.revalidate?.();
   if(!principal||scope.projectId!==r.project_id||scope.organizationId!==r.organization_id||scope.ownerUserId!==r.owner_user_id||scope.executionBindingId!==r.workspace_id||!authorization.requireProjectPermission(principal,r.project_id,"jobs","read").allowed)fail("MANAGED_JOB_PRIVATE_DENIED");
   const job=jobs.getJob(r.project_id,r.job_id);if(job.visibility==="private"&&(!["browser-user","user-token"].includes(principal.type)||principal.id!==job.owner_user_id))fail("MANAGED_JOB_PRIVATE_DENIED");return run;
  },
  requireCancellationIntent(runId){if(!hasCancelIntent(runId)&&read(runId).r.phase!=="cancel_requested")fail("MANAGED_JOB_CANCEL_INTENT_REQUIRED");},
  requireOriginalRetirementProof(runId,proof){const r=row(runId);if(!r?.retirement_proof||JSON.stringify(JSON.parse(r.retirement_proof))!==JSON.stringify(proof))fail("MANAGED_JOB_RETIREMENT_UNAVAILABLE");},
  requestCancel(runId,ctx){const c=read(runId),principal=ctx?.revalidate?.();if(!principal||!authorization.requireProjectPermission(principal,c.r.project_id,"jobs","write").allowed)fail("MANAGED_JOB_PRIVATE_DENIED");const job=jobs.getJob(c.r.project_id,c.r.job_id);if(job.visibility==="private"&&(!["browser-user","user-token"].includes(principal.type)||principal.id!==job.owner_user_id))fail("MANAGED_JOB_PRIVATE_DENIED");return write(()=>{const {r}=current(runId,"inspect");if(r.phase==="retired")return read(runId).a;return cas(r,{phase:"cancel_requested"});});},
  assignment(runId,credential){const {r,a,run}=current(runId,"launch");if(!credential||credential.kind!=="job-run"||credential.audience!=="job-run"||credential.runId!==runId||credential.attemptId!==a.attemptId||credential.id!==r.credential_id||credential.projectId!==a.projectId||credential.organizationId!==a.organizationId||credential.ownerUserId!==a.ownerUserId||credential.workspaceId!==a.workspaceId||credential.storageMappingHash!==a.bindingHash||credential.securityEpoch!==a.bindingEpoch||credential.servicePrincipalId!==run.effective_service_principal_id||!["start_intent","running"].includes(r.phase))fail("MANAGED_JOB_CREDENTIAL_DENIED");const job=jobs.getJob(r.project_id,r.job_id);return {runId,attemptId:a.attemptId,workspaceId:a.workspaceId,bindingHash:a.bindingHash,runtimeId:a.runtimeId,projectId:a.projectId,organizationId:a.organizationId,ownerUserId:a.ownerUserId,profileQualified:true,executable:"opencode",cwd:"/workspace",credentialBoundToOriginalRun:true,agent:job.agent,prompt:job.prompt_template,promptHash:a.promptHash,model:a.model};},
  bootstrapAssignment(runId,credential){const assignment=this.assignment(runId,credential),{a}=current(runId,"launch");const facts=base({runId,projectId:a.projectId,runtimeId:a.runtimeId,workspaceId:a.workspaceId});const binding=Object.fromEntries(["runId","attemptId","runtimeId","projectId","organizationId","ownerUserId","workspaceId","bindingHash","bindingEpoch","profileHash","imageId","agentHash","deadlineAt"].map(k=>[k,a[k]]));return {binding,agent:assignment.agent,model:a.model,staticProfile:profiles.describeOriginalJobBootstrap(a,facts)};},
  result(runId,input,credential){const assignment=this.assignment(runId,credential);if(!input||Object.keys(input).sort().join("|")!=="attemptId|result"||input.attemptId!==assignment.attemptId||!input.result||Object.keys(input.result).some(k=>!["exitCode","events","verifiedResponse"].includes(k))||!Number.isInteger(input.result.exitCode)||!Array.isArray(input.result.events)||input.result.events.length>128||Buffer.byteLength(JSON.stringify(input.result.events))>65536)fail("MANAGED_JOB_RESULT_DENIED");
   const verifier=verifierFactory();for(const event of input.result.events){if(typeof event!=="string")fail("MANAGED_JOB_RESULT_DENIED");verifier.accept(event+"\n");}const verified=verifier.finish().verified===true;
   return write(()=>{const {r}=current(runId,"launch");if(r.result_json)fail("MANAGED_JOB_RESULT_CONFLICT");cas(r,{result_json:JSON.stringify({exitCode:input.result.exitCode,verified,receivedAt:clock().toISOString()})});return {recorded:true};});
  },
 });
}
