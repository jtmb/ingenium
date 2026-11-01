import type { Request } from "express";
import { authorization, runtimes } from "ingenium-core";
import { revalidateRequestIdentity } from "../request-identity.js";
import { toAuthorizationPrincipal } from "../authorization-policy.js";
import { resolveRequestExecution, resolveRequestChatBinding } from "../projects-v2/request-execution.js";
import { createRequestMemorySession } from "./request-session.js";
import { withManagedRequestPlacement } from "../runtime-placement.js";
import { MemoryError } from "./lifecycle.mjs";
import { hasMemoryCapability } from "./adapters.mjs";

const scalar=(v:unknown):v is string=>typeof v==="string"&&v.length>0&&v.length<=512&&v===v.trim()&&!/[\u0000-\u001f\u007f]/u.test(v);
/** Acquire IDs through actual current ownership; selector fields never grant access. */
export async function readWorkMemoryBinding(request:Request,ports:{createSession:typeof createRequestMemorySession;withPlacement:typeof withManagedRequestPlacement}) {
  if(Object.keys(request.query).some(key=>!["workspaceId","runtimeId","engineSessionId","expectedProjectId","expectedProjectless"].includes(key)))throw new MemoryError("INVALID_INPUT");
  const {workspaceId,runtimeId,engineSessionId,expectedProjectId,expectedProjectless}=request.query;
  if(!scalar(workspaceId)||!scalar(runtimeId)||!scalar(engineSessionId)||(expectedProjectId!==undefined&&!scalar(expectedProjectId))
    ||(expectedProjectless!==undefined&&expectedProjectless!=="true")||(expectedProjectless!==undefined&&expectedProjectId!==undefined))throw new MemoryError("INVALID_INPUT");
  const before=revalidateRequestIdentity(request),workspace=runtimes.getAuthorizedWorkspace(workspaceId)??runtimes.getAuthorizedWorkspaceV2(workspaceId);
  if(before?.principal.type!=="user"||!before.principal.session||!workspace||workspace.status!=="authorized"
    ||workspace.ownerUserId!==before.principal.id)throw new MemoryError("FORBIDDEN");
  // The actual schema2 getter and original execution/Context owner admit null;
  // a missing Project selector alone never grants projectless ownership.
  if(workspace.projectId===null&&workspace.schemaVersion!==2)throw new MemoryError("MEMORY_ADAPTER_UNAVAILABLE");
  if(expectedProjectless==="true"&&workspace.projectId!==null)throw new MemoryError("BINDING_CHANGED");
  if(expectedProjectId!==undefined&&expectedProjectId!==workspace.projectId)throw new MemoryError("BINDING_CHANGED");
  const initialUserId=before.principal.id,initialSessionId=before.principal.session.id;
  const selected=Object.freeze({projectId:workspace.projectId,workspaceId,runtimeId});
  return ports.withPlacement(request,selected,()=>{
    const session=ports.createSession(request,selected),scope=session.resolveScope("read",engineSessionId);
    const execution=resolveRequestExecution(request,selected),chat=resolveRequestChatBinding(request,execution,engineSessionId,"active");
    const identity=revalidateRequestIdentity(request);
    if(identity?.principal.type!=="user"||!identity.principal.session||identity.principal.id!==scope.ownerUserId
      ||identity.principal.id!==initialUserId||identity.principal.session.id!==initialSessionId)throw new MemoryError("FORBIDDEN");
    // Preview permissions are metadata, never a GET mutation-authorization probe.
    // Existing read scope has already checked live identity, capability and axes.
    const actor=toAuthorizationPrincipal(identity.principal);
    const decision=selected.projectId===null?authorization.requireOrganizationPermission(actor,scope.organizationId,"memory","write")
      :authorization.requireProjectPermission(actor,selected.projectId,"memory","write");
    const canWrite=hasMemoryCapability(identity.principal,"write-policy")&&decision.allowed===true;
    const policy=session.memory.policy(scope,engineSessionId);
    return {schemaVersion:selected.projectId===null?2 as const:1 as const,available:true,actorUserId:identity.principal.id,organizationId:scope.organizationId,
      projectId:selected.projectId,workspaceId,runtimeId,engineSessionId,contextConversationId:chat.contextConversationId,
      scopeHash:policy.scopeHash,bindingHash:scope.bindingHash,bindingEpoch:scope.bindingEpoch,canChange:canWrite,canForget:canWrite};
  });
}
