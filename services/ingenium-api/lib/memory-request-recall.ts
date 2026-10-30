import type { Request } from "express";
import { runtimes } from "ingenium-core";
import { resolveRequestExecution, type RequestExecutionSelection } from "./projects-v2/request-execution.js";
import { createRequestMemorySession } from "./memory-v2/request-session.js";
import { createCanonicalRecallSourceReader } from "./memory-v2/recall-availability.js";
import { resolveManagedMemoryEngineOwner } from "./memory-engine-owner.js";
import { withManagedRequestPlacement } from "./runtime-placement.js";
import { MemoryError, scopeKey } from "./memory-v2/lifecycle.mjs";

export interface RequestRecallPorts {
  createSession: typeof createRequestMemorySession;
  withPlacement: typeof withManagedRequestPlacement;
}

/** Bounded public read, with current original-engine proof immediately before
 * synchronous source/permission checks. No model, queue or transcript writes.
 */
export async function readRequestMemoryRecall(
  request: Request, selected: RequestExecutionSelection, chatId: string | undefined,
  query: { maxItems?: number; maxTokens?: number; sourceOffset?: number },
  ports: RequestRecallPorts = { createSession: createRequestMemorySession, withPlacement: withManagedRequestPlacement },
) {
  const maxItems = query.maxItems ?? 16, maxTokens = query.maxTokens ?? 2048, offset = query.sourceOffset ?? 0;
  if (!chatId || !Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 16
    || !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 2048
    || !Number.isSafeInteger(offset) || offset < 0 || offset > Number.MAX_SAFE_INTEGER - 16) throw new MemoryError("INVALID_INPUT");
  return ports.withPlacement(request, selected, async () => {
    const bootstrap = ports.createSession(request, selected), scope = bootstrap.resolveScope("read", chatId);
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
    try {
      const session = ports.createSession(request, selected, { readAvailability: reader.view });
      const plan = session.memory.planSourceReads(scope, chatId, { offset, limit: 16, maxSources: 32 });
      const qualification = await reader.prime(plan.sourceRefs);
      return await ports.withPlacement(request, selected, () => {
        if (scopeKey(session.resolveScope("read", chatId)) !== scopeKey(scope)) throw new MemoryError("FORBIDDEN");
        const runtime = runtimes.getRuntimeInstance(selected.runtimeId);
        if (ownerBindings.size && (!runtime?.backendContainerId
          || [...ownerBindings.values()].some(id => id !== `managed-container:${runtime.backendContainerId}`))) throw new MemoryError("SOURCE_UNAVAILABLE");
        const page = reader.withVerifiedSources(() => session.memory.withSourceReadPlan(scope, chatId, plan,
          () => session.memory.recall(scope, chatId, { maxItems, maxTokens })));
        return { status: 200, headers: { "Cache-Control": "no-store" }, body: { data: page,
          sourceWindow: { offset: plan.offset, scanned: plan.scanCount, selected: plan.selectedMemoryCount,
            deferredForSourceBudget: plan.deferredForSourceBudget, hasMore: plan.hasMore,
            nextOffset: plan.hasMore ? plan.offset + plan.limit : null,
            verifiedSources: qualification.verifiedSources, unavailableSourceCount: qualification.unavailableSources.length },
        } };
      });
    } finally { reader.invalidate(); }
  });
}
