import { checkpointAfterWrite, execTransaction, explicitMemory, getDb } from "ingenium-core";
import { createApiMemorySession, type MemoryApiPorts } from "./adapters.mjs";

/** Binds existing API persistence exports; the authenticated caller supplies the
 * actual execution, chat, authorization and source-state owners.
 */
export function createCoreMemorySession<RequestContext>(
  ports: Omit<MemoryApiPorts<RequestContext>, "core" | "resolveExistingScope">,
) {
  return createApiMemorySession({
    ...ports,
    core: { getDb, execTransaction, checkpointAfterWrite },
    resolveExistingScope: explicitMemory.resolveExplicitMemoryScope,
  });
}
