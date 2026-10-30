import type { Request } from "express";
import { authorization, getDb } from "ingenium-core";
import { revalidateRequestIdentity } from "../request-identity.js";
import { resolveRequestChatBinding, resolveRequestExecution, RequestExecutionError, type RequestExecutionSelection } from "../projects-v2/request-execution.js";
import { toAuthorizationPrincipal } from "../authorization-policy.js";
import { csrfMiddleware } from "../middleware/csrf.js";
import { AppError } from "../middleware/errors.js";
import { createCoreMemorySession, positionalCoreConnection } from "./core-session.js";
import { authorizeMemoryRequestOperation, mapRequestExecutionFailure } from "./request-policy.mjs";
import { contextMemorySourceState, type ApprovedMemoryEligibilityPolicy } from "./source-state.mjs";
import type { AuthenticatedExecution } from "./adapters.mjs";
import type { MemoryScope } from "./lifecycle.mjs";

export interface InternalMemoryRequestOptions {
  readAvailability?: import('./recall-availability.mjs').RecallReadView;
  completedSnapshot?: import('./bounded-snapshot.mjs').CompletedMemorySnapshot;
  eligibilityPolicy?: (context: { request: Request; scope: MemoryScope; execution: AuthenticatedExecution; chatId: string; conversationId: string; messageId: string; contentHash: string }) => ApprovedMemoryEligibilityPolicy | null;
}
const axes = ["organizationId", "ownerUserId", "projectId", "workspaceId", "hostId", "environmentId", "bindingHash", "bindingEpoch"] as const;

function executionLookup<T>(read: () => T): T {
  try { return read(); }
  catch (error) { throw mapRequestExecutionFailure(error, RequestExecutionError); }
}

/** Public request composition only. Internal generation/backup/restore retain their own operator/job owner. */
export function createRequestMemorySession(request: Request, selected: RequestExecutionSelection, internal: InternalMemoryRequestOptions = {}) {
  const selection = Object.freeze({ ...selected });
  return createCoreMemorySession({
    request,
    selected: selection,
    authenticate: revalidateRequestIdentity,
    resolveExecution: () => executionLookup(() => resolveRequestExecution(request, selection)),
    resolveChatBinding: ({ execution, chatId, permission }) => executionLookup(() => resolveRequestChatBinding(request, execution, chatId, permission === "read-source" ? "history" : "active")),
    resolveProjectlessScope: () => {
      const execution = executionLookup(() => resolveRequestExecution(request, selection));
      return execution.projectId === null ? { ...execution, projectId: null, visibility: "private" as const } : null;
    },
    authorizeOperation: ({ principal, scope, permission }) => {
      const identity = revalidateRequestIdentity(request);
      return authorizeMemoryRequestOperation({
        permission, expectedPrincipal: principal, identity, method: request.method,
        csrf: () => {
          if (!identity || !request.res) return false;
          // Reuse existing CSRF/origin enforcement with the freshly revalidated principal, without mutating the original request.
          const checked = new Proxy(request, { get: (target, key, receiver) => key === "principal" ? identity.principal : Reflect.get(target, key, receiver) });
          let continued = false;
          try { csrfMiddleware(checked, request.res, (error?: unknown) => { if (error) throw error; continued = true; }); }
          catch (error) { if (error instanceof AppError && error.code === "CSRF_REJECTED") return false; throw error; }
          return continued;
        },
        decide: (_principal, level) => {
          if (!identity) return false;
          const execution = executionLookup(() => resolveRequestExecution(request, selection));
          if (axes.some((field) => scope[field] !== execution[field])) return false;
          const actor = toAuthorizationPrincipal(identity.principal);
          if (scope.projectId === null) {
            if (identity.principal.type !== "user" || identity.principal.id !== scope.ownerUserId || actor.projectId || actor.projectIds?.length) return false;
            return authorization.requireOrganizationPermission(actor, scope.organizationId, "memory", level).allowed;
          }
          return authorization.requireProjectPermission(actor, scope.projectId, "memory", level).allowed;
        },
      });
    },
    resolveSourceState: ({ scope, execution, chatId, messageId, conversationId, contentHash }) => contextMemorySourceState({
      db: positionalCoreConnection(getDb()), scope, execution, chatId, messageId, conversationId, contentHash,
      completedSnapshot: internal.completedSnapshot,
      readAvailability: internal.readAvailability ?? null,
      policy: internal.eligibilityPolicy?.({ request, scope, execution, chatId, conversationId, messageId, contentHash }) ?? null,
    }),
  });
}
