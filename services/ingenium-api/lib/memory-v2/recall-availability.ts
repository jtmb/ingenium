import { opencodeClient } from "../opencode-client.js";
import { withOpenCodeRuntimeTarget } from "../runtime-opencode-context.js";
import { getDb } from "ingenium-core";
import { positionalCoreConnection } from "./core-session.js";
import { createRecallSourceReader, type RecallSourceReaderOptions } from "./recall-availability.mjs";
import { MemoryError } from "./lifecycle.mjs";

/** Root's history/read-source resolver must authorize each original source chat. */
export function createCanonicalRecallSourceReader(options: RecallSourceReaderOptions) {
  return createRecallSourceReader({
    ...options,
    getOwner: async (input) => {
      const owner = await options.getOwner(input);
      if (!owner?.target?.baseUrl || owner.target.directory !== owner.directory) {
        throw new MemoryError("MEMORY_ENGINE_OWNER_UNAVAILABLE");
      }
      return owner;
    },
    getDb: () => positionalCoreConnection(getDb()),
    transport: {
      getSession: (owner, chatId) => withOpenCodeRuntimeTarget(owner.target,
        () => opencodeClient.getSession(chatId, owner.directory)),
      getMessages: (owner, chatId, limit) => withOpenCodeRuntimeTarget(owner.target,
        () => opencodeClient.getRecentMessages(chatId, limit, owner.directory)),
      getSessionMessage: (owner, chatId, messageId) => withOpenCodeRuntimeTarget(owner.target,
        () => opencodeClient.getSessionMessage(chatId, messageId, owner.directory)),
    },
  });
}
