// Canonical SOURCE PROPOSAL: wire only through the existing private manager token/Docker owner.
// Core ports are authenticated API operations, never a manager-local database or caller DTO authority.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha=/^[a-f0-9]{64}$/;
const error=code=>Object.assign(Error(code),{code,status:code.endsWith("UNAVAILABLE")?503:409});
const unknown=code=>({state:"unknown",code});
const jobName=a=>`ingenium-job-${a.runId.replaceAll("-","")}-${a.attemptId.replaceAll("-","")}`;
const runtimeName=id=>`ingenium-runtime-${id.replaceAll("-","")}`;
const path=id=>encodeURIComponent(id);
function identity(a){return JSON.stringify([a.runId,a.jobId,a.projectId,a.organizationId,a.ownerUserId,a.attemptId,a.runtimeId,a.runtimeRevision,a.workspaceId,a.bindingHash,a.bindingEpoch,a.jobRevision,a.scheduleRevision,a.grantRevision,a.profileId,a.profileHash,a.promptHash,a.specHash,a.daemonId,a.imageId]);}
function validate(a,runId){
 if(!a||a.runId!==runId||![a.runId,a.jobId,a.attemptId,a.runtimeId,a.projectId,a.organizationId,a.ownerUserId].every(v=>typeof v==="string"&&uuid.test(v))||!a.workspaceId||typeof a.workspaceId!=="string"||a.workspaceId.length>256||![a.bindingHash,a.profileHash,a.promptHash,a.specHash].every(v=>typeof v==="string"&&sha.test(v))||!/^sha256:[a-f0-9]{64}$/.test(a.imageId)||typeof a.daemonId!=="string"||!a.daemonId||![a.provisioningRevision,a.runtimeRevision,a.bindingEpoch,a.jobRevision,a.scheduleRevision,a.grantRevision,a.revision].every(v=>Number.isSafeInteger(v)&&v>=0)||typeof a.profileId!=="string"||!a.profileId||a.parentContainerId===a.containerId&&a.containerId)throw error("MANAGED_JOB_BINDING_CHANGED");
 return a;
}
function labels(a){return {"com.ingenium.managed":"job-run-manager","com.ingenium.job.run":a.runId,"com.ingenium.job.attempt":a.attemptId,"com.ingenium.job.id":a.jobId,"com.ingenium.job.spec":a.specHash,"com.ingenium.runtime.id":a.runtimeId,"com.ingenium.runtime.organization":a.organizationId,"com.ingenium.runtime.owner":a.ownerUserId,"com.ingenium.runtime.project":a.projectId,"com.ingenium.runtime.workspace":a.workspaceId,"com.ingenium.runtime.storage":a.bindingHash,"com.ingenium.runtime.security-epoch":String(a.bindingEpoch)};}
function validateChild(a,c){
 const expected=labels(a);
 if(!a.containerId||!sha.test(a.containerId)||!c||c.Id!==a.containerId||c.Id===a.parentContainerId||c.Name!=="/"+jobName(a)||c.Image!==a.imageId||Object.entries(expected).some(([k,v])=>c.Config?.Labels?.[k]!==v))throw error("MANAGED_JOB_CONTAINER_CHANGED");
 return c;
}
/** buildRuntimeSpec is the EXISTING canonical mapping/resource/profile provision builder.
 * Core supplies a distinct original-run scoped credential, not the parent's broad credential.
 * handoff is the existing manager attach-only stdin handoff. No shell/command/container comes from HTTP.
 */
export function createManagedJobContainerOwner({core,docker,buildRuntimeSpec,handoff}){
 for(const [name,value] of Object.entries({core,docker,buildRuntimeSpec,handoff}))if(!value)throw error("MANAGED_JOB_OWNER_UNAVAILABLE");
 const admission=async(runId,action)=>validate(await core.admit(runId,action),runId);
 const fresh=async(a,action)=>{const next=await admission(a.runId,action);if(identity(next)!==identity(a)||next.containerId!==a.containerId||next.parentContainerId!==a.parentContainerId)throw error("MANAGED_JOB_BINDING_CHANGED");return next;};
 const daemon=async a=>{const response=await docker("GET","/info");if(response.status!==200||response.data?.ID!==a.daemonId)throw error("MANAGED_JOB_DAEMON_CHANGED");};
 const child=async a=>{await daemon(a);if(!a.containerId)return null;const result=await docker("GET",`/containers/${path(a.containerId)}/json`);if(result.status===404)return null;if(result.status!==200)throw error("MANAGED_JOB_INSPECTION_UNAVAILABLE");return validateChild(a,result.data);};
 const parent=async a=>{
  await daemon(a);const response=await docker("GET",`/containers/${path(runtimeName(a.runtimeId))}/json`),p=response.data,l=p?.Config?.Labels??{};
  const expected={"com.ingenium.managed":"runtime-manager","com.ingenium.runtime.id":a.runtimeId,"com.ingenium.runtime.organization":a.organizationId,"com.ingenium.runtime.owner":a.ownerUserId,"com.ingenium.runtime.project":a.projectId,"com.ingenium.runtime.workspace":a.workspaceId,"com.ingenium.runtime.storage":a.bindingHash,"com.ingenium.runtime.security-epoch":String(a.bindingEpoch),"com.ingenium.runtime.revision":String(a.provisioningRevision)};
  if(response.status!==200||p.Id!==a.parentContainerId||p.Name!=="/"+runtimeName(a.runtimeId)||p.Image!==a.imageId||p.State?.Running!==true||p.State?.Health?.Status!=="healthy"||Object.entries(expected).some(([k,v])=>l[k]!==v))throw error("MANAGED_JOB_PARENT_CHANGED");
 };
 async function settle(a){
  const current=await fresh(a,"inspect");
  if(current.effectFence==="closed-no-create-v1"){
   const p=current.retirementProof;
   if(current.containerId!==null||!p||p.schemaVersion!==1||p.kind!=="core-no-create-effect-v1"||p.runId!==current.runId||p.attemptId!==current.attemptId||p.specHash!==current.specHash||p.effectFence!==current.effectFence||!Number.isSafeInteger(p.closedRevision)||p.closedRevision>current.revision)return unknown("MANAGED_JOB_NO_CREATE_PROOF_UNAVAILABLE");
   return {state:"settled",code:"MANAGED_JOB_CREATE_NEVER_ADMITTED",proof:p};
  }
  const c=await child(current);if(!c)return unknown("MANAGED_JOB_ORIGINAL_CONTAINER_MISSING");
  if(c.State?.Running===true)return {state:"active",code:"MANAGED_JOB_CONTAINER_ACTIVE"};
  if(!["exited","dead"].includes(c.State?.Status))return unknown("MANAGED_JOB_CONTAINER_NOT_RETIRED");
  // Positive original-daemon wait join; absent/inspect-only/PID/leader/idle is never proof.
  const joined=await docker("POST",`/containers/${path(a.containerId)}/wait?condition=not-running`);
  if(joined.status!==200||!Number.isInteger(joined.data?.StatusCode)||joined.data?.Error)return unknown("MANAGED_JOB_RETIREMENT_UNCONFIRMED");
  const again=await fresh(current,"inspect"),final=await child(again);
  if(!final||final.State?.Running!==false||!["exited","dead"].includes(final.State?.Status)||final.State?.ExitCode!==joined.data.StatusCode)return unknown("MANAGED_JOB_RETIREMENT_UNCONFIRMED");
  const proof={schemaVersion:1,runId:a.runId,attemptId:a.attemptId,containerId:a.containerId,daemonId:a.daemonId,specHash:a.specHash,exitCode:joined.data.StatusCode,kind:"original-daemon-container-wait-join"};
  await core.recordRetired(again,proof); // Core sole writer; does not imply a verified model response.
  return {state:"settled",code:"MANAGED_JOB_CONTAINER_RETIRED",proof};
 }
 return Object.freeze({
  async launch(input){
   if(!input||Object.keys(input).sort().join("|")!=="runId|runtimeId"||!uuid.test(input.runId)||!uuid.test(input.runtimeId))throw error("MANAGED_JOB_BINDING_CHANGED");
   let a=await admission(input.runId,"launch");if(a.runtimeId!==input.runtimeId)throw error("MANAGED_JOB_BINDING_CHANGED");
   // Only an existing original Core claim with a canonical immutable admission may reach this point.
   if(a.phase!=="prepared"||a.containerId)return unknown("MANAGED_JOB_LAUNCH_ALREADY_DECIDED");
   await parent(a);a=await fresh(a,"launch");
   const previous=a,material=await buildRuntimeSpec(a),spec=material?.spec;
   a=validate(material?.admission,a.runId);if(identity(a)!==identity(previous)||a.containerId!==previous.containerId)throw error("MANAGED_JOB_BINDING_CHANGED");
   if(typeof material?.capability!=="string"||!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(material.capability))throw error("MANAGED_JOB_CREDENTIAL_UNAVAILABLE"); // Reuses original canonical map and original resource/credential owners.
   if(!spec||spec.Image!==a.imageId||spec.WorkingDir!=="/workspace"||spec.User!=="1000:1000"||spec.HostConfig?.AutoRemove!==false||spec.HostConfig?.Privileged===true||spec.HostConfig?.PidMode||spec.HostConfig?.NetworkMode==="host")throw error("MANAGED_JOB_PROFILE_UNAVAILABLE");
   // Fixed managed-job role; no caller supplied entrypoint, argv, cwd, credential or container selector.
   spec.Entrypoint=["/app/scripts/runtime-entrypoint.sh"];spec.Cmd=[];
   spec.Env=[...spec.Env,"INGENIUM_RUNTIME_ROLE=job",`INGENIUM_JOB_RUN_ID=${a.runId}`,`INGENIUM_JOB_ATTEMPT_ID=${a.attemptId}`];
   spec.Labels={...spec.Labels,...labels(a)};
   // Core persists create_intent BEFORE the first Docker effect. CAS admits one original attempt only.
   const createIntent=await core.claimEffect(a,"create");if(!createIntent?.accepted)return unknown("MANAGED_JOB_LAUNCH_ALREADY_DECIDED");a=validate(createIntent.admission,a.runId);
   let created;
   try{created=await docker("POST",`/containers/create?name=${path(jobName(a))}`,spec);}catch{await core.recordUnknown(a,"create");return unknown("MANAGED_JOB_CREATE_UNKNOWN");}
   if(created.status!==201||!sha.test(created.data?.Id??"")){await core.recordUnknown(a,"create");return unknown("MANAGED_JOB_CREATE_UNKNOWN");}
   const id=created.data.Id;
   // A lost persistence acknowledgement may leave an owned container; never create/adopt/start a replacement.
   try{a=validate(await core.recordCreated(a,id),a.runId);if(a.containerId!==id)throw error("MANAGED_JOB_BINDING_CHANGED");}catch{return unknown("MANAGED_JOB_CREATE_PERSISTENCE_UNKNOWN");}
   await parent(a);a=await fresh(a,"launch");if(!await child(a))return unknown("MANAGED_JOB_ORIGINAL_CONTAINER_MISSING");
   const startIntent=await core.claimEffect(a,"start");if(!startIntent?.accepted)return unknown("MANAGED_JOB_START_ALREADY_DECIDED");a=validate(startIntent.admission,a.runId);
   try{
    const started=await docker("POST",`/containers/${path(id)}/start`);
    if(started.status!==204){await core.recordUnknown(a,"start");return unknown("MANAGED_JOB_START_UNKNOWN");}
    // Existing attach-only credential handoff; credential is scoped to this original run by Core.
    a=await fresh(a,"launch");await handoff(id,a,material.capability);a=await fresh(a,"launch");await core.recordStarted(a);return {state:"active",code:"MANAGED_JOB_CONTAINER_STARTED"};
   }catch{await core.recordUnknown(a,"start");return unknown("MANAGED_JOB_START_UNKNOWN");}
  },
  async inspect(runId){if(!uuid.test(runId))throw error("MANAGED_JOB_BINDING_CHANGED");try{return await settle(await admission(runId,"inspect"));}catch(e){return unknown(e.code??"MANAGED_JOB_INSPECTION_UNAVAILABLE");}},
  async cleanup(runId){
   if(!uuid.test(runId))throw error("MANAGED_JOB_BINDING_CHANGED");
   try{let a=await admission(runId,"cleanup");if(!a.outcomeConsumed)return unknown("MANAGED_JOB_OUTCOME_NOT_CONSUMED");
    const observed=await settle(a);if(observed.state!=="settled")return observed;
    if(observed.proof.kind==="core-no-create-effect-v1")return observed;
    a=await fresh(a,"cleanup");if(!a.outcomeConsumed)return unknown("MANAGED_JOB_OUTCOME_NOT_CONSUMED");
    const original=await child(a);if(!original||original.State?.Running!==false)return unknown("MANAGED_JOB_CLEANUP_UNCONFIRMED");
    const removed=await docker("DELETE",`/containers/${path(a.containerId)}?v=false`);
    if(removed.status!==204)return unknown("MANAGED_JOB_CLEANUP_UNCONFIRMED");
    await core.recordRemoved(a);return {state:"removed",code:"MANAGED_JOB_ORIGINAL_CONTAINER_REMOVED"};
   }catch(e){return unknown(e.code??"MANAGED_JOB_CLEANUP_UNCONFIRMED");}
  },
  async cancel(runId){
   if(!uuid.test(runId))throw error("MANAGED_JOB_BINDING_CHANGED");
   try{let a=await admission(runId,"cancel");if(a.effectFence==="closed-no-create-v1")return await settle(a);if(!a.cancelRequested)return unknown("MANAGED_JOB_CANCEL_INTENT_REQUIRED");if(a.effectFence==="open-v1"){a=await core.closeNoCreate(a);return await settle(a);}const c=await child(a);if(!c)return unknown("MANAGED_JOB_ORIGINAL_CONTAINER_MISSING");a=await fresh(a,"cancel");
    if(c.State?.Running===true){const stopped=await docker("POST",`/containers/${path(a.containerId)}/stop?t=5`);if(![204,304].includes(stopped.status))return unknown("MANAGED_JOB_CANCEL_PENDING");}
    return await settle(a);
   }catch(e){return unknown(e.code??"MANAGED_JOB_CANCEL_PENDING");}
  },
 });
}
