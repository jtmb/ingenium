import {createWorkspaceRequestChatResolver} from './workspace-chat-binding.mjs';
import {findWorkspaceEngineContext,getWorkspaceContext,resolveWorkspaceEngineMapping,getWorkspaceExecutionV2} from './projectless-context.mjs';
import {resolveCurrentWorkspaceV2Execution} from './workspace-v2-placement.mjs';
import {createCanonicalRequestChatResolver} from "./canonical-chat-binding.mjs";
import type { Request } from "express";
import { findRequestChatSourceIds, isRequestChatConversationActive } from "./request-chat-source.mjs";
import { authorization, contextConversations, explicitMemory, getDb, runtimes } from "ingenium-core";
import { revalidateRequestIdentity } from "../request-identity.js";
import { toAuthorizationPrincipal } from "../authorization-policy.js";
import { deploymentMode } from "../runtime-mode.js";
import {
  createRequestExecutionResolvers, RequestExecutionError,
  type PlacementResolver, type RequestExecutionSelection, type RequestExecutionFacts, type RequestChatPurpose,
} from "./request-execution-owner.mjs";

export type { RequestExecutionSelection, RequestExecutionFacts, RequestChatBinding, RequestChatPurpose,
  PlacementRequest, TrustedPlacement, PlacementResolver } from "./request-execution-owner.mjs";
export { RequestExecutionError } from "./request-execution-owner.mjs";

// Root composition supplies the existing placement owner once. Missing ownership
// remains unavailable. This stores no placement, permission or readiness cache.
let placementOwner: PlacementResolver | undefined;
export function installRequestExecutionPlacementResolver(owner: PlacementResolver): void {
  if (typeof owner !== "function" || placementOwner !== undefined)
    throw new RequestExecutionError("EXECUTION_PLACEMENT_OWNER_CONFLICT",409);
  placementOwner = owner;
}

const resolver = createRequestExecutionResolvers({
  revalidateIdentity: revalidateRequestIdentity,
  deploymentMode,
  getWorkspace: runtimes.getAuthorizedWorkspace,
  getRuntime: runtimes.getRuntimeInstance,
  resolveOwnership(identity, selected) {
    const principal = identity.principal;
    if (!selected.projectId) return null;
    if (principal.type === "user") return explicitMemory.resolveExplicitMemoryScope({
      projectId: selected.projectId, workspaceId: selected.workspaceId, allowProjectVisibility: false,
      principal: { type: "user", userId: principal.id },
    });
    if (principal.type !== "service" || !principal.tokenId || !principal.storageMappingHash) return null;
    return explicitMemory.resolveExplicitMemoryScope({
      projectId: selected.projectId, workspaceId: selected.workspaceId, allowProjectVisibility: false,
      principal: { type: "service", servicePrincipalId: principal.id,
        credentialId: principal.tokenId, storageMappingHash: principal.storageMappingHash },
    });
  },
  authorizeProject(identity, workspace) {
    const decision = authorization.requireProjectPermission(
      toAuthorizationPrincipal(identity.principal), workspace.projectId, "projects", "read",
    );
    return decision.allowed && decision.organizationId === workspace.organizationId;
  },
  resolvePlacement: facts => placementOwner?.(facts) ?? null,
  findConversations(execution, engineSessionId) {
    if (execution.projectId === null) return [];
    const projectId = execution.projectId;
    const candidates = findRequestChatSourceIds(
      (sql, parameters) => getDb(process.env.INGENIUM_CORE_DB_PATH).prepare<string[]>(sql).all(...parameters) as { id: string }[],
      { ...execution, projectId }, engineSessionId,
    );
    return candidates.map(candidate => contextConversations.getContextConversation(projectId, candidate.id));
  },
  authorizeConversation(identity, chat) {
    return authorization.requireContentPermission(toAuthorizationPrincipal(identity.principal), {
      resourceType: "context_conversation", resourceId: chat.id, organizationId: chat.organization_id,
      projectId: chat.project_id, visibility: chat.visibility, ownerUserId: chat.owner_user_id,
    }, "read").allowed;
  },
  conversationIsActive(projectId, contextConversationId) {
    return isRequestChatConversationActive(
      (sql, parameters) => getDb(process.env.INGENIUM_CORE_DB_PATH).prepare<string[]>(sql).get(...parameters) as { event_type: string } | undefined,
      projectId, contextConversationId,
    );
  },
  now: Date.now,
});

export function resolveRequestExecution(request: Request, selection: RequestExecutionSelection) {
  if(selection.projectId===null)return resolveCurrentWorkspaceV2Execution(request,selection);
  return resolver.resolveRequestExecution(request, selection);
}
export function resolveRequestChatBinding(request: Request, execution: RequestExecutionFacts, chatId: string, purpose: RequestChatPurpose = "active") {
  if(execution.projectId===null)return workspaceChatResolver(request,execution,chatId,purpose,'engine');
  return resolver.resolveRequestChatBinding(request, execution, chatId, purpose);
}

/** Canonical Context ID adapter; the original engine-ID resolver remains unchanged. */
const projectContextChatResolver=createCanonicalRequestChatResolver({
  resolveExecution:resolveRequestExecution,resolveEngineChat:resolveRequestChatBinding,
  getConversation:contextConversations.getContextConversation,
});

function workspaceChatResolver(request:Request,execution:RequestExecutionFacts,id:string,purpose:RequestChatPurpose,representation:'engine'|'context') {
 // Resolve these live module bindings after initialization: the original engine
 // client also imports the voice/request binding owner. No authority is cached.
 try {
  return createWorkspaceRequestChatResolver({resolveExecution:getWorkspaceExecutionV2,findEngineContext:findWorkspaceEngineContext,getConversation:getWorkspaceContext,resolveMapping:resolveWorkspaceEngineMapping})(request,execution,id,purpose,representation);
 } catch(error) {
  if(error instanceof RequestExecutionError)throw error;
  const code=error&&typeof error==='object'&&'code' in error?error.code:null;
  if(['WORKSPACE_ENGINE_MAPPING_UNAVAILABLE','WORKSPACE_CONTEXT_NOT_FOUND','WORKSPACE_CONTEXT_ARCHIVED','WORKSPACE_CONTEXT_GENERATION_CHANGED'].includes(String(code)))throw new RequestExecutionError('CHAT_BINDING_UNAVAILABLE',404);
  if(['WORKSPACE_CONTEXT_SCOPE_UNAVAILABLE','WORKSPACE_CONTEXT_IDENTITY_UNAVAILABLE'].includes(String(code)))throw new RequestExecutionError('EXECUTION_SCOPE_UNAVAILABLE',404);
  if(['WORKSPACE_CONTEXT_MIGRATION_UNAVAILABLE','WORKSPACE_CONTEXT_EXECUTION_UNAVAILABLE','WORKSPACE_ORIGINAL_PROVISION_UNAVAILABLE'].includes(String(code)))throw new RequestExecutionError('EXECUTION_PLACEMENT_UNAVAILABLE',503);
  throw error;
 }
}
export function resolveRequestContextChatBinding(request:Request,execution:RequestExecutionFacts,contextId:string,purpose:RequestChatPurpose='active'){
 return execution.projectId===null?workspaceChatResolver(request,execution,contextId,purpose,'context'):projectContextChatResolver(request,execution,contextId,purpose);
}
