import type { Request } from "express";
import { authorization, contextConversations, explicitMemory, getDb, runtimes } from "ingenium-core";
import { revalidateRequestIdentity } from "../request-identity.js";
import { toAuthorizationPrincipal } from "../authorization-policy.js";
import { deploymentMode } from "../runtime-mode.js";
import {
  createRequestExecutionResolvers, RequestExecutionError,
  type PlacementResolver, type RequestExecutionSelection, type RequestExecutionFacts,
} from "./request-execution-owner.mjs";

export type { RequestExecutionSelection, RequestExecutionFacts, RequestChatBinding,
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
  getConversation: contextConversations.getContextConversation,
  authorizeConversation(identity, chat) {
    return authorization.requireContentPermission(toAuthorizationPrincipal(identity.principal), {
      resourceType: "context_conversation", resourceId: chat.id, organizationId: chat.organization_id,
      projectId: chat.project_id, visibility: chat.visibility, ownerUserId: chat.owner_user_id,
    }, "read").allowed;
  },
  conversationIsActive(projectId, chatId) {
    // Reuse the existing Context append-only archive owner, without another state store.
    const state = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      `SELECT event_type FROM context_checkpoint_audit_events
       WHERE project_id = ? AND conversation_id = ? AND archive_sequence IS NOT NULL
       ORDER BY archive_sequence DESC LIMIT 1`,
    ).get(projectId, chatId) as { event_type: string } | undefined;
    return !state || state.event_type === "conversation_unarchived";
  },
  now: Date.now,
});

export function resolveRequestExecution(request: Request, selection: RequestExecutionSelection) {
  return resolver.resolveRequestExecution(request, selection);
}
export function resolveRequestChatBinding(request: Request, execution: RequestExecutionFacts, chatId: string) {
  return resolver.resolveRequestChatBinding(request, execution, chatId);
}
