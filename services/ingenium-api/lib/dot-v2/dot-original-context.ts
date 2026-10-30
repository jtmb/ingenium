import {AsyncLocalStorage} from "node:async_hooks";
import {dotExecutionDelegation,getDb} from "ingenium-core";
import {installedDotApprovedScopeReader,revalidateInstalledDotApproval,readInstalledDotOperationEvidence} from "./installed-dot-approved-scope.js";
import {scopeKey} from "./repository.js";
import type {Core126Selection,ManagedJobAdmission} from "./managed-job-contracts.mjs";

type Approval=Parameters<typeof revalidateInstalledDotApproval>[0];
type Original=ReturnType<typeof dotExecutionDelegation.acquireApprovedDotExecutionOriginal>;
export interface OriginalDotDeclaration {
 schemaVersion:1;kind:"approved-dot-original-v1";followupId:string;operationId:string;
 automationPrincipalId:string;approvalDigest:string;scopeKey:string;runIdentityHash:string;
}
type Context={database:ReturnType<typeof getDb>;mode:"execute"|"cancel";original:Original;declaration:OriginalDotDeclaration;approval?:Approval};
const contexts=new WeakMap<object,Context>(),current=new AsyncLocalStorage<object>();
const fail=():never=>{throw Object.assign(Error("DOT_ORIGINAL_CONTEXT_UNAVAILABLE"),{code:"DOT_ORIGINAL_CONTEXT_UNAVAILABLE",status:503});};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function originalDeclaration(value:unknown):OriginalDotDeclaration{
 if(!value||typeof value!=="object"||Array.isArray(value))return fail();
 const v=value as Record<string,unknown>;
 if(Object.keys(v).sort().join("|")!=="approvalDigest|automationPrincipalId|followupId|kind|operationId|runIdentityHash|schemaVersion|scopeKey"||v.schemaVersion!==1||v.kind!=="approved-dot-original-v1"||![v.followupId,v.operationId,v.automationPrincipalId,v.scopeKey].every(x=>typeof x==="string"&&x.length>0&&x.length<=4096)||![v.approvalDigest,v.runIdentityHash].every(x=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x)))return fail();
 return structuredClone(value) as OriginalDotDeclaration;
}
const expected=(selection:Core126Selection)=>({runId:selection.runId,projectId:selection.projectId,runtimeId:selection.runtimeId,workspaceId:selection.workspaceId});
function requireContext(context:object,selection:Core126Selection,action:"execute"|"read"|"cancel"):Context{
 const original=contexts.get(context);if(!original||original.database!==getDb()||original.mode==="cancel"&&action==="execute")return fail();
 const facts=dotExecutionDelegation.requireApprovedDotExecutionOriginal(original.original,expected(selection),original.mode);
 if(facts.selection.followupId!==original.declaration.followupId||facts.selection.operationId!==original.declaration.operationId||facts.automationPrincipalId!==original.declaration.automationPrincipalId||facts.runIdentityHash!==original.declaration.runIdentityHash||scopeKey(facts.scope)!==original.declaration.scopeKey)return fail();
 if(original.mode==="execute"){
  if(!original.approval)return fail();
  const evidence=readInstalledDotOperationEvidence(original.approval,selection.runId);
  if(!["claimed","running"].includes(evidence.operation.state)||evidence.approvalDigest!==original.declaration.approvalDigest||evidence.operation.id!==original.declaration.operationId||evidence.runIdentityHash!==facts.runIdentityHash||scopeKey(evidence.scope)!==original.declaration.scopeKey||evidence.execution.runtimeId!==selection.runtimeId||evidence.execution.workspaceId!==selection.workspaceId||evidence.automationPrincipalId!==facts.automationPrincipalId)return fail();
 }
 return original;
}
/** Only genuine original-reader and Core handles enter this process-local context. */
export function withOriginalApprovedDotOperation<T>(approval:Approval,runId:string,work:(context:object)=>T):T{
 const evidence=readInstalledDotOperationEvidence(approval,runId);
 if(!["claimed","running"].includes(evidence.operation.state)||!evidence.scope.projectId)return fail();
 const original=dotExecutionDelegation.acquireApprovedDotExecutionOriginal({followupId:evidence.followupId,operationId:evidence.operation.id,runId});
 const declaration:OriginalDotDeclaration={schemaVersion:1,kind:"approved-dot-original-v1",followupId:evidence.followupId,operationId:evidence.operation.id,automationPrincipalId:evidence.automationPrincipalId,approvalDigest:evidence.approvalDigest,scopeKey:scopeKey(evidence.scope),runIdentityHash:evidence.runIdentityHash};
 const context=Object.freeze({});contexts.set(context,{database:getDb(),mode:"execute",original,declaration,approval});
 requireContext(context,{runId,projectId:evidence.scope.projectId,runtimeId:evidence.execution.runtimeId,workspaceId:evidence.execution.workspaceId},"execute");
 return current.run(context,()=>work(context));
}
function persisted(runId:string):{database:ReturnType<typeof getDb>;projectId:string;jobId:string;declaration:OriginalDotDeclaration}|null{
 const db=getDb(),row=db.prepare("SELECT project_id,job_id,purpose,admission_json FROM job_run_managed_execution WHERE run_id=?").get(runId) as {project_id:string;job_id:string;purpose:string;admission_json:string}|undefined;
 if(!row)return null;if(row.purpose!=="production")return fail();
 let a:Record<string,unknown>;try{a=JSON.parse(row.admission_json);}catch{return fail();}
 if(!a||typeof a!=="object"||Array.isArray(a))return fail();
 if(!Object.hasOwn(a,"dotDelegation"))return null;
 if(db!==getDb())return fail();return {database:db,projectId:row.project_id,jobId:row.job_id,declaration:originalDeclaration(a.dotDelegation)};
}
/** Original authenticated manager callers use this before each new effect. */
export async function withPersistedApprovedDotOperation<T>(runId:string,work:()=>T|Promise<T>):Promise<T>{
 const saved=persisted(runId);if(!saved)return work();
 const approval=await installedDotApprovedScopeReader.resolve(saved.projectId,saved.jobId);
 if(saved.database!==getDb())return fail();
 return withOriginalApprovedDotOperation(approval,runId,context=>{
  const active=contexts.get(context);if(!active||!same(active.declaration,saved.declaration))return fail();return work();
 });
}
/** Exact original control after source/grant revocation; no new effect or quota release. */
export function originalDotCancellationContext(runId:string):object{
 const saved=persisted(runId);if(!saved)return fail();
 const original=dotExecutionDelegation.acquireApprovedDotExecutionOriginal({followupId:saved.declaration.followupId,operationId:saved.declaration.operationId,runId},"cancel");
 const context=Object.freeze({});contexts.set(context,{database:saved.database,mode:"cancel",original,declaration:saved.declaration});return context;
}
/** Fixed production port. It cannot be manufactured by an HTTP body or descriptor. */
export const originalDotContextAuthority=Object.freeze({
 authorize(context:unknown,selection:Core126Selection,action:"execute"|"read"|"cancel"):boolean{
  if(!context||typeof context!=="object"||!contexts.has(context))return false;requireContext(context,selection,action);return true;
 },
 describe(context:unknown,selection:Core126Selection):OriginalDotDeclaration|undefined{
  if(!context||typeof context!=="object"||!contexts.has(context))return undefined;
  return structuredClone(requireContext(context,selection,"execute").declaration);
 },
 assertCurrent(admission:ManagedJobAdmission,selection:Core126Selection):void{
  const active=current.getStore(),declaration=admission.dotDelegation;
  if(declaration===undefined){if(active&&contexts.has(active))return fail();return;}
  if(!active||!same(requireContext(active,selection,"execute").declaration,originalDeclaration(declaration)))return fail();
 },
});
/** Refresh the SAME private approved operation after async provider work.
 * An expired observation can select a fresh original read; it cannot supply authority. */
export async function refreshOriginalApprovedDotContext<T>(context:unknown,selection:Core126Selection,work:(context:any)=>T|Promise<T>):Promise<T>{
 if(!context||typeof context!=="object"||!contexts.has(context))return work(context);
 const old=contexts.get(context)!;if(old.mode!=="execute"||old.database!==getDb())return fail();
 const row=getDb().prepare("SELECT job_id FROM job_runs WHERE id=? AND project_id=?").get(selection.runId,selection.projectId) as {job_id:string}|undefined;
 if(!row)return fail();const approval=await installedDotApprovedScopeReader.resolve(selection.projectId,row.job_id);
 if(old.database!==getDb())return fail();
 return withOriginalApprovedDotOperation(approval,selection.runId,fresh=>{
  const value=requireContext(fresh,selection,"execute");if(!same(value.declaration,old.declaration))return fail();return work(fresh);
 });
}