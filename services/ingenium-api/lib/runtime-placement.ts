import {withManagedWorkspaceV2Placement} from './projects-v2/workspace-v2-placement.mjs';
import { AsyncLocalStorage } from "node:async_hooks";
import type { Request } from "express";
import { authorization, explicitMemory, getDb, runtimes } from "ingenium-core";
import { toAuthorizationPrincipal } from "./authorization-policy.js";
import { revalidateRequestIdentity } from "./request-identity.js";
import { inspectManagedRuntimePlacement } from "./runtime-manager-client.js";
import { qualifyManagedRuntimePlacement, type ManagedRuntimeObservation } from "./runtime-placement-contract.js";
import { installRequestExecutionPlacementResolver, RequestExecutionError,
  type RequestExecutionSelection } from "./projects-v2/request-execution.js";

type PlacementContext = {database:ReturnType<typeof getDb>;installationId:string;observation:ManagedRuntimeObservation};
const requestPlacement=new AsyncLocalStorage<PlacementContext>();
let installed=false;
/** Install one request-local provider; never cache identity, permissions or placement across requests. */
export function installManagedRequestPlacementOwner():void {
  if(installed)return;
  installRequestExecutionPlacementResolver(expected=>{
    const context=requestPlacement.getStore();
    if(!context || context.database!==getDb())return null;
    return qualifyManagedRuntimePlacement(expected,context.observation,context.installationId);
  });
  installed=true;
}

/** Refresh actual manager placement before synchronous domain/transaction work.
 * Long-running jobs reacquire this original owner before each admission/commit;
 * retaining an expired request context is not a grant or a reconnect strategy.
 */
export async function withManagedRequestPlacement<T>(request:Request,selected:RequestExecutionSelection,work:()=>T|Promise<T>):Promise<T> {
  if(!selected || typeof selected!=="object" || Array.isArray(selected)
    || Object.keys(selected).sort().join(",")!=="projectId,runtimeId,workspaceId"
    || !(selected.projectId===null || typeof selected.projectId==="string")
    || typeof selected.workspaceId!=="string" || typeof selected.runtimeId!=="string")
    throw new RequestExecutionError("INVALID_EXECUTION_SELECTION",422);
  const selection={...selected};
  if(selection.projectId===null)return withManagedWorkspaceV2Placement(request,selection,work);
  const identity=revalidateRequestIdentity(request);
  if(!identity)throw new RequestExecutionError("EXECUTION_IDENTITY_UNAVAILABLE",401);
  const principal=identity.principal;
  const decision=authorization.requireProjectPermission(toAuthorizationPrincipal(principal),selection.projectId,"projects","read");
  if(!decision.allowed)throw new RequestExecutionError("EXECUTION_SCOPE_UNAVAILABLE",404);
  const scope=explicitMemory.resolveExplicitMemoryScope({projectId:selection.projectId,workspaceId:selection.workspaceId,allowProjectVisibility:false,
    principal:principal.type==="user" ? {type:"user",userId:principal.id}
      : {type:"service",servicePrincipalId:principal.id,credentialId:principal.tokenId,storageMappingHash:principal.storageMappingHash??""}});
  const database=getDb(),runtime=runtimes.getRuntimeInstance(selection.runtimeId),workspace=runtimes.getAuthorizedWorkspace(selection.workspaceId);
  if(!workspace || workspace.status!=="authorized" || !runtime || !["READY","IDLE"].includes(runtime.state)
    || workspace.id!==scope.workspaceId || workspace.projectId!==scope.projectId || workspace.organizationId!==scope.organizationId
    || workspace.ownerUserId!==scope.ownerUserId || runtime.workspaceId!==workspace.id
    || runtime.projectId!==workspace.projectId || runtime.organizationId!==workspace.organizationId
    || runtime.ownerUserId!==workspace.ownerUserId || runtime.securityEpoch!==workspace.securityEpoch)
    throw new RequestExecutionError("EXECUTION_RUNTIME_UNAVAILABLE",404);
  const installation=database.prepare("SELECT instance_id FROM veyra_installation_identity WHERE singleton=1").get() as {instance_id:string}|undefined;
  if(!installation || !/^[a-f0-9]{32}$/u.test(installation.instance_id))throw new RequestExecutionError("EXECUTION_PLACEMENT_UNAVAILABLE",503);
  let observation:ManagedRuntimeObservation;
  try{observation=await inspectManagedRuntimePlacement(runtime.id);}
  catch{throw new RequestExecutionError("EXECUTION_PLACEMENT_UNAVAILABLE",503);}
  if(database!==getDb())throw new RequestExecutionError("EXECUTION_BINDING_CHANGED",409);
  installManagedRequestPlacementOwner();
  return requestPlacement.run(Object.freeze({database,installationId:installation.instance_id,observation}),work);
}