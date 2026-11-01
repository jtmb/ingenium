import {Router,type Request,type Response,type NextFunction} from "express";
import {randomUUID} from "node:crypto";
import {authorization,getDb,logger,projects,jobs,agents,jobProviders} from "ingenium-core";
import {toAuthorizationPrincipal} from "../authorization-policy.js";
import {revalidateRequestIdentity} from "../request-identity.js";
import {launchManagedJobRun,cancelManagedJobRun,inspectManagedJobRun} from "../runtime-manager-client.js";
import {withManagedRequestPlacement} from "../runtime-placement.js";
import {dotErrorResponse} from "./commands.js";
import {RequestExecutionError} from "../projects-v2/request-execution.js";
import {resolveRequestExecution} from "../projects-v2/request-execution.js";
import {createOriginalDotJobPolicy} from "./dot-job-policy.mjs";
import {actualManagedJobOwner} from "./core126-runtime.js";
import {createManagedDotExecution} from "./managed-dot-execution.mjs";
import {createCoreRequestDotSession,type DotQualifiedRunnerOwner} from "./request-session.js";
import {createRequestDotRouter} from "./router.js";
import {DotError} from "./service.js";
import type {DotRequestSelection} from "./request-binding.js";
import type {CoreDotOptions} from "./core-binding.js";
const jobPolicy=createOriginalDotJobPolicy({getDb,jobs,agents,jobProviders});
const text=(v:unknown):v is string=>typeof v==="string"&&v.length>0&&v.length<=256&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
/** No body-selected scope, projectless/global fallback or request-authority retention. */
export function selectInstalledDotRequest(request:Request):DotRequestSelection {
 if(!revalidateRequestIdentity(request))throw new DotError("DOT_REQUEST_UNAUTHENTICATED");
 const query=request.query;
 if(Object.keys(query).some(key=>!["project","workspaceId","runtimeId","chatId","limit","cursor"].includes(key))||!text(query.project)||!text(query.workspaceId)||!text(query.runtimeId)||(query.chatId!==undefined&&!text(query.chatId)))throw new DotError("DOT_VALIDATION");
 const project=projects.getProject(query.project);if(!project||project.archived_at)throw new DotError("DOT_FORBIDDEN");
 return {projectId:project.id,workspaceId:query.workspaceId,runtimeId:query.runtimeId,chatId:query.chatId??null};
}
/** Descriptors compare original current policy; they do not grant a tool or approve an image. */
export function installedDotRequestRunner(request:Request,selected:DotRequestSelection):DotQualifiedRunnerOwner {
 return {
  requireCapabilities(principal,execution,capabilities){
   for(const capability of capabilities){if(capability.startsWith("dot-job-policy:")){if(!execution.projectId)throw new DotError("DOT_CAPABILITIES_UNAVAILABLE");try{jobPolicy.require(execution.projectId,execution.ownerUserId,capability);}catch{throw new DotError("DOT_CAPABILITIES_UNAVAILABLE");}continue;}const match=/^([a-z][a-z0-9-]*):(read|write|execute|admin)$/.exec(capability);if(!match||!execution.projectId)throw new DotError("DOT_CAPABILITIES_UNAVAILABLE");
    const permission=match[2] as "read"|"write"|"execute"|"admin";
    const decision=authorization.requireProjectPermission(toAuthorizationPrincipal(principal),execution.projectId,match[1]!,permission);
    if(!decision.allowed||decision.organizationId!==execution.organizationId)throw new DotError("DOT_FORBIDDEN");
   }
  },
  assertExecutionSupported(execution,job){
   // Scope compatibility only; not an image approval or launch-readiness claim.
   if(execution.mode!=="runtime"||execution.available!==true||execution.projectId!==job.project_id||execution.organizationId!==job.organization_id)throw new DotError("DOT_EXECUTION_UNAVAILABLE");
  },
  capabilitiesForJob(job){const execution=resolveRequestExecution(request,{projectId:selected.projectId,workspaceId:selected.workspaceId,runtimeId:selected.runtimeId});try{return [jobPolicy.describe(job.project_id,job.id,execution.ownerUserId).descriptor];}catch{throw new DotError("DOT_CAPABILITIES_UNAVAILABLE");}},
  inspectSettlement(){return "unknown";}, // Sync settlement is never used by the async session and never infers success.
 };
}
export function createInstalledDotRequestSession(request:Request){
 const selected=selectInstalledDotRequest(request);
 const original=()=>actualManagedJobOwner().executionPorts({revalidate:()=>{const current=revalidateRequestIdentity(request);return current?toAuthorizationPrincipal(current.principal):null;}},selected);
 const asyncExecution=createManagedDotExecution({core:{
  inTransaction:()=>getDb().inTransaction,
  prepareManagedExecution:(...args)=>original().prepareManagedExecution(...args),
  requireOriginalRun:(...args)=>original().requireOriginalRun(...args),
  requireCancellationIntent:(...args)=>original().requireCancellationIntent(...args),
  requireOriginalRetirementProof:(...args)=>original().requireOriginalRetirementProof(...args),
 },manager:{launchManagedJobRun,cancelManagedJobRun,inspectManagedJobRun}});
 const options:CoreDotOptions={managedDispatch:"core126-original-v1",nestedCheckpointPolicy:"deferred-by-core-v1",asyncExecution,now:()=>new Date().toISOString(),id:randomUUID,onDiagnostic:event=>{logger.warn("dot",event.code,{phase:event.phase,runId:event.runId});}};
 return createCoreRequestDotSession(request,selected,installedDotRequestRunner(request,selected),options);
}
/** Mount only behind original auth, project-policy and CSRF middleware. */
export function createInstalledDotRouter(){
 const router=Router();
 router.use((request,response,next)=>{response.setHeader("Cache-Control","no-store");try{const selected=selectInstalledDotRequest(request);void withManagedRequestPlacement(request,{projectId:selected.projectId,workspaceId:selected.workspaceId,runtimeId:selected.runtimeId},()=>{next();}).catch(next);}catch(error){next(error);}});
 router.get("/job-policy/:id",(request,response,next)=>{try{
  const session=createInstalledDotRequestSession(request),scope=session.context.scope;
  if(!scope.projectId)throw new DotError("DOT_PROJECTLESS_UNBOUND");
  session.service.page(session.context.actor,scope,"operation","",1);
  const job=jobs.getJob(scope.projectId,request.params.id!);
  if(!job||job.owner_kind==="user"&&job.owner_user_id!==scope.ownerUserId||job.visibility==="private"&&job.owner_user_id!==scope.ownerUserId)throw new DotError("DOT_FORBIDDEN");
  try{response.json({data:jobPolicy.describe(scope.projectId,job.id,scope.ownerUserId)});}catch{throw new DotError("DOT_CAPABILITIES_UNAVAILABLE");}
 }catch(error){next(error);}});
 router.use(createRequestDotRouter(createInstalledDotRequestSession));
 router.use((error:unknown,_request:Request,response:Response,next:NextFunction)=>{
  if(error instanceof DotError){const result=dotErrorResponse(error);response.status(result.status).json(result.body);return;}
  if(error instanceof RequestExecutionError){response.status(error.status).json({error:{code:error.code,message:"veyra-bot execution is unavailable"}});return;}
  if(error&&typeof error==="object"&&"status" in error&&error.status===503){response.status(503).json({error:{code:"DOT_EXECUTION_UNAVAILABLE",message:"Dot execution unavailable"}});return;}
  next(error);
 });return router;
}
