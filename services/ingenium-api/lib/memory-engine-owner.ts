import type { Request } from "express";
import { runtimes, workspaceRuntimeCredentialsV2 } from "ingenium-core";
import { withManagedRequestPlacement } from "./runtime-placement.js";
import { resolveRequestExecution, type RequestExecutionSelection } from "./projects-v2/request-execution.js";
import { createRequestMemorySession } from "./memory-v2/request-session.js";
import type { MemoryScope } from "./memory-v2/lifecycle.mjs";
import type { AuthenticatedExecution } from "./memory-v2/adapters.mjs";
import type { VerifiedOpenCodeMemoryOwner } from "./memory-v2/opencode-snapshot.mjs";
import { MemoryError, scopeKey } from "./memory-v2/lifecycle.mjs";

const executionAxes = ["organizationId", "ownerUserId", "projectId", "workspaceId", "bindingHash", "bindingEpoch", "runtimeId", "mode", "hostId", "environmentId", "available", "status"] as const;

/** Reacquire original manager placement and current content authority for each
 * asynchronous engine read. Scope/execution arguments are comparisons, never
 * grants. The target is the existing runtimeOpenCodeContext mapping; no new
 * URL, credential or process identity is accepted from an HTTP caller.
 */
export async function resolveManagedMemoryEngineOwner(
  request: Request,
  selected: RequestExecutionSelection,
  expectedScope: MemoryScope,
  expectedExecution: AuthenticatedExecution,
  engineSessionId: string,
): Promise<VerifiedOpenCodeMemoryOwner> {
  return withManagedRequestPlacement(request, selected, () => {
    const execution = resolveRequestExecution(request, selected);
    const session = createRequestMemorySession(request, selected);
    // The existing session owner chooses history authority for read-source and
    // still applies current project/private-chat membership and attestation.
    const scope = session.resolveScope("read-source", engineSessionId);
    if (scopeKey(scope) !== scopeKey(expectedScope)
      || executionAxes.some(axis => execution[axis] !== expectedExecution[axis])) throw new MemoryError("FORBIDDEN");
    const runtime = scope.projectId === null ? runtimes.getWorkspaceRuntimeV2(execution.runtimeId) : runtimes.getRuntimeInstance(execution.runtimeId);
    if (!runtime || execution.mode !== "runtime" || !runtime.backendContainerId
      || !/^[a-f0-9]{64}$/u.test(runtime.backendContainerId)
      || runtime.backendName !== `ingenium-runtime-${runtime.id.replaceAll("-", "")}`
      || runtime.id !== selected.runtimeId || runtime.workspaceId !== scope.workspaceId
      || runtime.projectId !== scope.projectId || runtime.organizationId !== scope.organizationId
      || runtime.ownerUserId !== scope.ownerUserId || runtime.securityEpoch !== scope.bindingEpoch
      || !["READY", "IDLE"].includes(runtime.state)) throw new MemoryError("SOURCE_UNAVAILABLE");
    const directory = "/workspace";
    return Object.freeze({
      scope: Object.freeze({ ...scope }), execution: Object.freeze({ ...execution }),
      // Actual container identity, not a fabricated native engine boot UUID.
      ownerInstanceId: `managed-container:${runtime.backendContainerId}`,
      directory,
      target: Object.freeze({ baseUrl: `http://${runtime.backendName}:4098`, directory,
        ...(scope.projectId === null ? {authHeader: workspaceRuntimeCredentialsV2.workspaceRuntimeOpenCodeAuthV2(runtime.id)} : {}),
      }),
    });
  });
}
