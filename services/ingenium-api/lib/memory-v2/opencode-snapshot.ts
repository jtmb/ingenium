import { opencodeClient } from "../opencode-client.js";
import { withOpenCodeRuntimeTarget } from "../runtime-opencode-context.js";
import { getDb } from "ingenium-core";
import { positionalCoreConnection } from "./core-session.js";
import { createOpenCodeSnapshotReader, type OpenCodeSnapshotOptions } from "./opencode-snapshot.mjs";
import { mapCanonicalContextPair } from "./opencode-context-pair.mjs";
import { MemoryError } from "./lifecycle.mjs";

/** Existing authenticated target/placement and external-context owners remain
 * mandatory. No credentials/default-target parser or second DB is introduced.
 */
export function createCanonicalOpenCodeSnapshotReader(options: OpenCodeSnapshotOptions) {
  return createOpenCodeSnapshotReader({
    ...options,
    getOwner: async () => {
      const owner = await options.getOwner();
      if (!owner?.target?.baseUrl || owner.target.directory !== owner.directory) {
        throw new MemoryError("MEMORY_ENGINE_OWNER_UNAVAILABLE");
      }
      return owner;
    },
    transport: {
      getSession: (owner, chatId) => withOpenCodeRuntimeTarget(owner.target,
        () => opencodeClient.getSession(chatId, owner.directory)),
      getMessages: (owner, chatId, limit) => withOpenCodeRuntimeTarget(owner.target,
        () => opencodeClient.getMessages(chatId, limit, undefined, owner.directory)),
      getSessionMessage: (owner, chatId, messageId) => withOpenCodeRuntimeTarget(owner.target,
        () => opencodeClient.getSessionMessage(chatId, messageId, owner.directory)),
    },
    mapContext: (input) => mapCanonicalContextPair(positionalCoreConnection(getDb()), input),
  });
}
