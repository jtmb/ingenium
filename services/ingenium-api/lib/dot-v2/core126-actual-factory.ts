import {agents,authorization,checkpointAfterWrite,execTransaction,getDb,jobs,mcpAuthorizationPolicy,mcpCredentials,runtimes,vault} from "ingenium-core";
import {createHash} from "node:crypto";
import type {Core126ImageOwner} from "../../../../packages/veyra-operations/core126-image-owner.mjs";
import type {Core126Facts,Core126Handlers} from "./managed-job-contracts.mjs";
import {createCore126Owner} from "./core126-owner.mjs";
import {createCore126ManagerGuard,createCore126ToolAuthorizer,createCore126Handlers,createCore126WithdrawalHandler} from "./core126-http.mjs";
import {loadManagerToken} from "../runtime-manager-auth.js";
import {JobResponseVerification} from "../job-response-verification.js";
import {resolveJobProviderModel} from "../job-native-provider.js";
import {createActualCore126Broker,actualManagedJobToolCatalog} from "./core126-broker.js";
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** imageOwner is Root's qualified immutable image/placement/profile owner, not labels or caller JSON.
 * Missing qualification returns unavailable; there is no image/profile/model/capability fallback.
 */
export function createActualCore126Owner({imageOwner}:{imageOwner?:Core126ImageOwner}){
 const toolCatalog=actualManagedJobToolCatalog;
 let dispatchExistingTool:ReturnType<typeof createActualCore126Broker>["dispatch"];
 const managerGuard=createCore126ManagerGuard({loadToken:loadManagerToken});
 const binding=(provider:any)=>hash([provider.connectionId,provider.providerKey,provider.authentication,provider.config]);
 const requireCurrentParentScopes=(runtimeId:string,approvedScopes:readonly string[])=>{
  const row=getDb().prepare(`SELECT credential.scopes_json FROM runtime_capability_bindings binding
    JOIN mcp_credentials credential ON credential.id=binding.mcp_credential_id AND credential.kind='runtime' AND credential.audience='runtime'
      AND credential.revoked_at IS NULL AND credential.expires_at>?
    JOIN runtime_instances runtime ON runtime.id=binding.runtime_id AND runtime.security_epoch=credential.security_epoch
      AND runtime.workspace_id=credential.workspace_id AND runtime.owner_user_id=credential.created_by_user_id
    JOIN service_principals principal ON principal.id=credential.service_principal_id AND principal.status='active'
      AND principal.security_epoch=credential.security_epoch
    WHERE binding.runtime_id=? AND binding.revoked_at IS NULL AND binding.expires_at>?`).get(new Date().toISOString(),runtimeId,new Date().toISOString()) as {scopes_json:string}|undefined;
  const scopes=row?JSON.parse(row.scopes_json):null;
  if(!Array.isArray(scopes)||approvedScopes.some(scope=>!scopes.includes(scope)))throw Error("Managed JobRun lacks an existing explicitly granted capability");
 };
 const profiles={
  async qualify(facts:any){
   if(typeof toolCatalog?.getTool!=="function"||typeof dispatchExistingTool!=="function")throw Error("Managed JobRun protected broker transport unavailable");
   agents.validateProtectedOpenCodeDeployment();
   let provider=vault.resolveJobProviderRuntime(facts.job.project_id,facts.job.id,facts.run.id);
   const before=binding(provider);let model:string;
   try{
    // Actual paid-provider secret projection is not yet part of this qualified job-role image contract.
    if(provider.authentication!=="anonymous"||provider.providerKey!=="opencode")throw Error("Managed JobRun provider secret handoff unavailable");
    model=await resolveJobProviderModel(provider);
   }finally{provider.release();}
   provider=vault.resolveJobProviderRuntime(facts.job.project_id,facts.job.id,facts.run.id);
   try{if(binding(provider)!==before)throw Error("Managed JobRun provider changed");}finally{provider.release();}
   const image=await imageOwner?.qualifyOriginalJobRole({run:facts.run,job:facts.job,runtime:facts.runtime,workspace:facts.workspace,agentConfig:facts.agentConfig,model,modelBindingHash:before});
   if(!image?.qualified||image.jobRunAudience!=="job-run"||image.transport!=="scoped-core126-mcp-v1"||image.model!==model||image.modelBindingHash!==before||!Array.isArray(image.approvedScopes))throw Error("Managed JobRun image/profile unavailable");
   requireCurrentParentScopes(facts.runtime.id,image.approvedScopes);
   const projectName=(getDb().prepare("SELECT name FROM projects WHERE id=? AND archived_at IS NULL").get(facts.job.project_id) as {name:string}|undefined)?.name;
   if(!projectName)throw Error("Original active project name unavailable");
   // The existing original Core run already consumed automation quota; no second claim or grant is created.
   return {...image,approvedScopes:[...image.approvedScopes],model,modelBindingHash:before,resourceAdmissionId:facts.run.id,
    projectName,limits:{cpuMillis:facts.runtime.cpuMillis,memoryBytes:facts.runtime.memoryBytes,pidsLimit:facts.runtime.pidsLimit,diskBytes:facts.runtime.diskBytes,processLimit:facts.runtime.processLimit}};
  },
  describeOriginalJobBootstrap(admission:any,facts:any){if(!imageOwner)throw Object.assign(Error("Qualified original image owner unavailable"),{status:503});return imageOwner.describeOriginalJobBootstrap(admission,facts);},
  assertCurrent(admission:any,facts:any){
   agents.validateProtectedOpenCodeDeployment();
   requireCurrentParentScopes(facts.runtime.id,admission.approvedScopes);
   if(hash(facts.agentConfig)!==admission.agentHash||imageOwner?.assertCurrentOriginalJobRole(admission,facts)!==true)throw Error("Managed JobRun image/profile unavailable");
   const provider=vault.resolveJobProviderRuntime(facts.job.project_id,facts.job.id,facts.run.id);
   try{if(binding(provider)!==admission.modelBindingHash)throw Error("Managed JobRun provider changed");}finally{provider.release();}
  },
 };
 const owner=createCore126Owner({getDb,execTransaction,checkpointAfterWrite,jobs,runtimes,agents,authorization,credentials:mcpCredentials,profiles,requireManager:managerGuard.requireManager,verifierFactory:()=>new JobResponseVerification()});
 const authorizeTool=createCore126ToolAuthorizer({credentials:mcpCredentials,mcpAuthorizationPolicy,authorization,jobs,toolCatalog});
 const broker=createActualCore126Broker(owner,authorizeTool);
 dispatchExistingTool=broker.dispatch;
 const withImage=<T,>(facts:Core126Facts,work:()=>T|Promise<T>):Promise<T>=>{
  if(!imageOwner)throw Object.assign(Error("Qualified original image owner unavailable"),{status:503});
  return imageOwner.withFreshOriginalJobRole(facts,work);
 };
 const rawHandlers=createCore126Handlers({owner,managerGuard,credentials:mcpCredentials,authorizeTool,dispatchExistingTool,listAuthorizedTools:broker.list});
 const withdrawOriginal=createCore126WithdrawalHandler({credentials:mcpCredentials});
 const handlers:Core126Handlers={
  async internal(request){
   const match=/^\/internal\/managed-job-runs\/([a-f0-9-]+)\/([^/]+)$/.exec(request.path),runId=match?.[1],operation=match?.[2];
   if(!runId)return rawHandlers.internal(request);
   managerGuard.context(request); // Authenticate BEFORE original Core lookup or manager observations.
   const needsImage=operation==="admission"&&request.query?.action==="launch"||["launch-material","effect-intent","created","started"].includes(operation??"");
   return needsImage?withImage(owner.factsForOriginalImageCheck(runId),()=>rawHandlers.internal(request)):rawHandlers.internal(request);
  },
  async runtime(request){
   const narrowed=await withdrawOriginal(request);if(narrowed)return narrowed;
   const match=/^\/runtime\/job-runs\/([a-f0-9-]+)\//.exec(request.path),runId=match?.[1];
   if(!runId)return rawHandlers.runtime(request);
   const header=request.headers.authorization,credential=mcpCredentials.inspectManagedJobCredential(typeof header==="string"&&header.startsWith("Bearer ")?header.slice(7):"","job-run");
   if(!credential||credential.runId!==runId)throw Object.assign(Error("Original JobRun credential required"),{status:401});
   return withImage(owner.factsForOriginalImageCheck(runId),()=>rawHandlers.runtime(request));
  },
 };
 return {owner,managerGuard,executionPorts(context:any,selection:any){return {
   inTransaction:()=>getDb().inTransaction,
   prepareManagedExecution(runId:string,job:any,prompt:string){if(job.prompt_template!==prompt)throw Error("Original JobRun prompt changed");const selected={runId,projectId:job.project_id,runtimeId:selection.runtimeId,workspaceId:selection.workspaceId};return withImage(owner.factsForImagePreparation(selected,context),()=>owner.prepare(selected,context));},
   requireOriginalRun:(scope:any,runId:string)=>owner.readOriginalRun(runId,scope,context),
   requireCancellationIntent:(_scope:any,runId:string)=>owner.requireCancellationIntent(runId),
   requireOriginalRetirementProof:(runId:string,proof:any)=>owner.requireOriginalRetirementProof(runId,proof),
  };},handlers};
}
