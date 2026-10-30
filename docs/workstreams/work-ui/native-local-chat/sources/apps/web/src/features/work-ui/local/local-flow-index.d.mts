import type { OriginalStore } from "./local-chat-controller.mjs";
import type { LocalIdentity } from "./local-protocol.mjs";
export function localFlows(store: OriginalStore, actual: LocalIdentity, newFlowID?: string | null): Promise<string[]>;
