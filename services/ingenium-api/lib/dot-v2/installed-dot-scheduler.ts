import {AsyncLocalStorage} from "node:async_hooks";
import {randomUUID} from "node:crypto";
import {getDb,execTransaction,checkpointAfterWrite,jobs,agents,jobProviders,logger,dotExecutionDelegation} from "ingenium-core";
import {launchManagedJobRun,cancelManagedJobRun,inspectManagedJobRun} from "../runtime-manager-client.js";
import {createCoreDotRuntime,type CoreDotRuntime,type CoreJob,type CoreRun} from "./core-binding.js";
import {scopeKey} from "./repository.js";
import {installedDotApprovedScopeReader} from "./installed-dot-approved-scope.js";
import {originalDotCancellationContext,withOriginalApprovedDotOperation} from "./dot-original-context.js";
import {actualManagedJobOwner} from "./core126-runtime.js";
import {originalJobRunIdentity} from "./core126-owner.mjs";
import {createManagedDotExecution} from "./managed-dot-execution.mjs";
import {createOriginalDotJobPolicy} from "./dot-job-policy.mjs";
import {DotError} from "./service.js";
import type {Actor,Authorization,DotScope,Suggestion,Operation} from "../../../../packages/veyra-automation/contracts.js";
export type DotSchedulerRuntime=Pick<CoreDotRuntime,"usesAsyncExecution"|"ownsJob"|"dispatchJob"|"recoverOperations"|"recoverOperationsAsync">;
type Approval=Awaited<ReturnType<typeof installedDotApprovedScopeReader.resolve>>;
const approvals=new AsyncLocalStorage<Approval>();
const policy=createOriginalDotJobPolicy({getDb,jobs,agents,jobProviders});
const fail=(code="DOT_RUN_BINDING_CHANGED"):never=>{throw new DotError(code);};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const actorMatches=(actor:Actor,scope:DotScope)=>actor.id===scope.ownerUserId&&actor.organizationId===scope.organizationId;
function currentApproval(scope:DotScope):Approval{
 const lease=approvals.getStore();if(!lease)return fail("DOT_APPROVAL_UNAVAILABLE");
 const current=installedDotApprovedScopeReader.revalidate(lease);if(!same(current.scope,scope))return fail();return lease;
}
/** Select exact original records. No current source content, user token or tool grant
 * is reconstructed for safety-reducing controls after withdrawal or restart. */
function originalControl(scope:DotScope,runId:string){
 if(!scope.projectId)return fail();const db=getDb();
 const rows=db.prepare("SELECT id,organization_id,owner_user_id,scope_key,revision,body FROM veyra_dot_records WHERE kind='operation' AND json_extract(body,'$.runId')=?").all(runId) as {id:string;organization_id:string;owner_user_id:string;scope_key:string;revision:number;body:string}[];
 if(rows.length!==1)return fail();const row=rows[0]!,op=JSON.parse(row.body) as Operation;
 const run=jobs.getJobRun(scope.projectId,runId);
 if(!run||row.scope_key!==scopeKey(scope)||!same(op.scope,scope)||op.id!==row.id||op.revision!==row.revision||row.organization_id!==scope.organizationId||row.owner_user_id!==scope.ownerUserId||run.project_id!==scope.projectId||run.organization_id!==scope.organizationId||!op.managedDispatch||op.managedDispatch.protocol!=="core126-original-v1"||op.managedDispatch.runIdentityHash!==originalJobRunIdentity(run))return fail();
 return {op,run,selection:{followupId:op.followupId,operationId:op.id,runId}};
}
function hasOriginalScope(scope:DotScope):boolean{
 return !!getDb().prepare("SELECT 1 FROM veyra_dot_records WHERE kind='operation' AND scope_key=? AND organization_id=? AND owner_user_id=? AND json_extract(body,'$.managedDispatch.protocol')='core126-original-v1' LIMIT 1").get(scopeKey(scope),scope.organizationId,scope.ownerUserId);
}
const authorization:Authorization={
 require(actor,scope,action,capabilities){
  if(!actorMatches(actor,scope))return fail("DOT_FORBIDDEN");
  if(action==="notify"){
   // Notifications contain only a generic status; current owner membership is still required.
   const member=getDb().prepare("SELECT 1 FROM users u JOIN organization_memberships m ON m.user_id=u.id AND m.organization_id=? AND m.status='active' LEFT JOIN project_memberships pm ON pm.project_id=? AND pm.user_id=u.id WHERE u.id=? AND u.status='active' AND (m.role IN ('owner','admin') OR (m.role!='viewer' AND pm.user_id IS NOT NULL))").get(scope.organizationId,scope.projectId??"",scope.ownerUserId);
   if(!member||!hasOriginalScope(scope))return fail("DOT_FORBIDDEN");return;
  }
  if(!approvals.getStore()){
   if(!["read","cancel"].includes(action)||capabilities.length||!hasOriginalScope(scope))return fail("DOT_FORBIDDEN");return;
  }
  const lease=currentApproval(scope);
  if(!["read","dispatch"].includes(action))return fail("DOT_FORBIDDEN");
  if(capabilities.length){
   const f=getDb().prepare("SELECT body FROM veyra_dot_records WHERE kind='followup' AND id=? AND scope_key=?").get(lease.followupId,scopeKey(scope)) as {body:string}|undefined;
   if(!f)return fail();const jobId=JSON.parse(f.body).jobId;
   const descriptor=policy.describe(scope.projectId!,jobId,scope.ownerUserId).descriptor;
   if(capabilities.length!==1||capabilities[0]!==descriptor)return fail("DOT_CAPABILITIES_UNAVAILABLE");
  }
 },
 requireSource(actor,scope,source){
  if(!actorMatches(actor,scope))return fail("DOT_FORBIDDEN");const lease=currentApproval(scope);
  const row=getDb().prepare("SELECT s.body FROM veyra_dot_records f JOIN veyra_dot_records s ON s.kind='suggestion' AND s.id=json_extract(f.body,'$.suggestionId') AND s.scope_key=f.scope_key WHERE f.kind='followup' AND f.id=? AND f.scope_key=?").get(lease.followupId,scopeKey(scope)) as {body:string}|undefined;
  if(!row||!same((JSON.parse(row.body) as Suggestion).source,source))return fail("DOT_SOURCE_REVOKED");
 },
 canReadMemory(){return false;}, // Private Memory delegation uses its own policy owner; never infer it from IDs.
};
function cancellationPorts(scope:DotScope,runId:string){
 originalControl(scope,runId);
 const row=getDb().prepare("SELECT runtime_id,workspace_id,purpose FROM job_run_managed_execution WHERE run_id=?").get(runId) as {runtime_id:string;workspace_id:string;purpose:string}|undefined;
 if(!row||row.purpose!=="production")return fail();
 return actualManagedJobOwner().executionPorts(originalDotCancellationContext(runId),{projectId:scope.projectId!,runtimeId:row.runtime_id,workspaceId:row.workspace_id});
}
const managed=createManagedDotExecution({core:{
 inTransaction:()=>getDb().inTransaction,
 prepareManagedExecution(runId:string,job:CoreJob,prompt:string){
  const lease=approvals.getStore();if(!lease)return fail("DOT_APPROVAL_UNAVAILABLE");
  return withOriginalApprovedDotOperation(lease,runId,context=>actualManagedJobOwner().executionPorts(context,{projectId:job.project_id,runtimeId:lease.execution.runtimeId,workspaceId:lease.execution.workspaceId}).prepareManagedExecution(runId,job,prompt));
 },
 requireOriginalRun:(scope:DotScope,id:string)=>cancellationPorts(scope,id).requireOriginalRun(scope,id),
 requireCancellationIntent:(scope:DotScope,id:string)=>cancellationPorts(scope,id).requireCancellationIntent(scope,id),
 requireOriginalRetirementProof:(id:string,proof:unknown)=>actualManagedJobOwner().owner.requireOriginalRetirementProof(id,proof),
},manager:{launchManagedJobRun,cancelManagedJobRun,inspectManagedJobRun}});
const asyncExecution={
 async executeJobRun(id:string,job:CoreJob,prompt:string){
  try{await managed.executeJobRun(id,job,prompt);}catch(error){
   const lease=approvals.getStore();if(lease){const original=originalControl(lease.scope,id);dotExecutionDelegation.closeOriginalUnadmittedDotOperation(original.selection);}
   throw error;
  }
 },
 async requestCancellation(scope:DotScope,run:CoreRun){
  const original=originalControl(scope,run.id);
  if(dotExecutionDelegation.closeOriginalUnadmittedDotOperation(original.selection))return;
  await managed.requestCancellation(scope,run);
 },
 async inspectOwnedRun(scope:DotScope,run:CoreRun):Promise<"running"|"success"|"failed"|"cancelled"|"unknown">{
  const original=originalControl(scope,run.id);
  if(dotExecutionDelegation.closeOriginalUnadmittedDotOperation(original.selection))return "cancelled";
  return await managed.inspectOwnedRun(scope,run);
 },
};
let originalRuntime:CoreDotRuntime|undefined;
function runtime():CoreDotRuntime{
 if(originalRuntime)return originalRuntime;
 originalRuntime=createCoreDotRuntime({getDb,execTransaction,checkpointAfterWrite,jobs:{getJob:jobs.getJob,getJobRun:jobs.getJobRun,cancelJobRun:jobs.cancelJobRun,isJobRunAuthorizationCurrent:jobs.isJobRunAuthorizationCurrent,
  startJobRun(projectId,id,trigger,provenance){
   const lease=approvals.getStore();if(!lease)return fail("DOT_APPROVAL_UNAVAILABLE");currentApproval(lease.scope);
   if(lease.scope.projectId!==projectId)return fail();const current=jobs.getJob(projectId,id);
   if(!current||current.service_principal_id!==lease.automationPrincipalId)return fail();
   return jobs.startJobRun(projectId,id,trigger,{...provenance,sourceActor:{type:"service",id:lease.automationPrincipalId}});
  },
 }},authorization,{
  authorizeJob(actor,scope,job){
   if(!actorMatches(actor,scope))return fail("DOT_FORBIDDEN");currentApproval(scope);
   const descriptor=policy.describe(job.project_id,job.id,scope.ownerUserId).descriptor;
   return {scope,capabilities:[descriptor]};
  },
  authorizeRun(actor,scope,run){if(!actorMatches(actor,scope))return fail("DOT_FORBIDDEN");originalControl(scope,run.id);},
 },{executeJobRun:asyncExecution.executeJobRun,requestCancellation(){return fail("DOT_ASYNC_RECOVERY_REQUIRED");},inspectOwnedRun(){return fail("DOT_ASYNC_RECOVERY_REQUIRED");}},
 {managedDispatch:"core126-original-v1",nestedCheckpointPolicy:"deferred-by-core-v1",asyncExecution,now:()=>new Date().toISOString(),id:randomUUID,onDiagnostic:e=>logger.warn("dot",e.code,{phase:e.phase,runId:e.runId})});
 return originalRuntime;
}
/** The existing scheduler owns the only timer. Private actual Core/reader handles
 * authorize dispatch; persisted original fences and manager joins own recovery. */
export const installedDotSchedulerRuntime:DotSchedulerRuntime={
 usesAsyncExecution:true,
 ownsJob(projectId,jobId){return !!getDb().prepare("SELECT 1 FROM veyra_dot_records WHERE kind='followup' AND json_extract(body,'$.scope.projectId')=? AND json_extract(body,'$.jobId')=? LIMIT 1").get(projectId,jobId);},
 async dispatchJob(projectId,jobId,isActive){
  if(!isActive())return;actualManagedJobOwner(); // Missing enrollment must not consume the original Run quota.
  const lease=await installedDotApprovedScopeReader.resolve(projectId,jobId);if(!isActive())return;
  await approvals.run(lease,()=>runtime().dispatchJob(projectId,jobId,isActive));
 },
 recoverOperations(){return fail("DOT_ASYNC_RECOVERY_REQUIRED");},
 async recoverOperationsAsync(limit){return await runtime().recoverOperationsAsync(limit);},
};