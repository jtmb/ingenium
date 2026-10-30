import { UUID, identity, realm, requireValue } from "./local-protocol.mjs";

/** A selection index only. Never allocates a workspace or adopts a Project. */
async function retainedFlows(store, actual, newFlowID, firstID) {
  const checked = identity(actual), key = "veyra.local-chat.flows.v1:" + encodeURIComponent(realm(checked));
  return store.withLock(key, async () => {
    const raw = store.read(key);
    let ids;
    try { ids = raw === null ? [] : JSON.parse(raw); } catch { throw new Error("Saved local chat selection is unreadable; its bytes were kept."); }
    requireValue(Array.isArray(ids) && ids.length <= 128 && ids.every(id => UUID.test(id)) && new Set(ids).size === ids.length, "Saved local chat selection is invalid; it was kept.");
    if (ids.length === 0 && firstID) newFlowID = firstID();
    if (newFlowID !== null) {
      requireValue(UUID.test(newFlowID) && !ids.includes(newFlowID) && ids.length < 128, "A distinct bounded local original is required.");
      ids = [...ids, newFlowID]; store.put(key, raw, JSON.stringify(ids));
    }
    return ids;
  });
}
export const localFlows = (store, actual, newFlowID = null) => retainedFlows(store, actual, newFlowID, null);
/** Fresh view creates only one client-retained draft selection under the lock. */
export const initialLocalFlows = (store, actual, uuid = () => crypto.randomUUID()) => retainedFlows(store, actual, null, uuid);
