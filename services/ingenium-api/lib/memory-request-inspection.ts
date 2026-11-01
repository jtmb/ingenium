import type { Request } from "express";
import { runtimes } from "ingenium-core";
import { resolveRequestExecution, type RequestExecutionSelection } from "./projects-v2/request-execution.js";
import { createRequestMemorySession } from "./memory-v2/request-session.js";
import { createCanonicalRecallSourceReader } from "./memory-v2/recall-availability.js";
import { readBoundedMemoryInspection } from "./memory-v2/inspection.mjs";
import { resolveManagedMemoryEngineOwner } from "./memory-engine-owner.js";
import { withManagedRequestPlacement } from "./runtime-placement.js";
import { MemoryError, scopeKey } from "./memory-v2/lifecycle.mjs";

export interface RequestInspectionPorts {
  createSession: typeof createRequestMemorySession;
  withPlacement: typeof withManagedRequestPlacement;
}

/** Management inspection deliberately has no current-chat/injection opt-in
 * prerequisite. Each stored source still needs current history authority and
 * actual canonical-engine evidence. Pagination counts candidates, not an
 * unbounded claimed total of qualified memories. */
export async function readRequestMemoryInspection(
  request: Request, selected: RequestExecutionSelection,
  query: { candidateOffset?: number; limit?: number },
  ports: RequestInspectionPorts = { createSession: createRequestMemorySession, withPlacement: withManagedRequestPlacement },
) {
  const limit = query.limit ?? 25, candidateOffset = query.candidateOffset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100
    || !Number.isSafeInteger(candidateOffset) || candidateOffset < 0
    || candidateOffset > Number.MAX_SAFE_INTEGER - limit) throw new MemoryError("INVALID_INPUT");
  return ports.withPlacement(request, selected, async () => {
    const bootstrap = ports.createSession(request, selected), scope = bootstrap.resolveScope("read");
    const execution = resolveRequestExecution(request, selected), ownerBindings = new Map<string, string>();
    const reader = createCanonicalRecallSourceReader({ scope, execution,
      getOwner: async input => {
        const owner = await resolveManagedMemoryEngineOwner(request, selected, input.scope, input.execution, input.chatId);
        const previous = ownerBindings.get(input.chatId);
        if (previous && previous !== owner.ownerInstanceId) throw new MemoryError("SOURCE_UNAVAILABLE");
        ownerBindings.set(input.chatId, owner.ownerInstanceId);
        return owner;
      },
    });
    const session = ports.createSession(request, selected, { readAvailability: reader.view });
    const page = await readBoundedMemoryInspection({ memory: session.memory, scope, reader, candidateOffset, limit,
      consume: read => ports.withPlacement(request, selected, () => {
        if (scopeKey(session.resolveScope("read")) !== scopeKey(scope)) throw new MemoryError("FORBIDDEN");
        const runtime = scope.projectId === null ? runtimes.getWorkspaceRuntimeV2(selected.runtimeId) : runtimes.getRuntimeInstance(selected.runtimeId);
        if (ownerBindings.size && (!runtime?.backendContainerId
          || [...ownerBindings.values()].some(id => id !== `managed-container:${runtime.backendContainerId}`))) throw new MemoryError("SOURCE_UNAVAILABLE");
        return read();
      }),
    });
    return { status: 200, headers: { "Cache-Control": "no-store" },
      body: { data: { items: page.items }, sourceWindow: page.sourceWindow } };
  });
}
