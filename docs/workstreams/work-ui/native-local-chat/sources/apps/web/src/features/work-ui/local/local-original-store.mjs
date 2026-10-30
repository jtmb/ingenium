import { requireValue } from "./local-protocol.mjs";

/** UI originals/drafts only. The actual service remains the workspace/session
 * authority. Never fall back to another browser origin, account or store. */
export function browserOriginalStore(storage = globalThis.localStorage, locks = globalThis.navigator?.locks) {
  return {
    read: key => storage.getItem(key),
    put(key, expected, next) {
      requireValue(next.length <= 2 * 1024 * 1024, "Original storage is full; existing records were kept.");
      requireValue(storage.getItem(key) === expected, "Another view changed these originals; nothing further was sent.");
      storage.setItem(key, next);
      requireValue(storage.getItem(key) === next, "Original retention could not be verified.");
    },
    async withLock(key, work) {
      requireValue(typeof locks?.request === "function", "Original coordination is unavailable; nothing was sent.");
      return locks.request(key, { mode: "exclusive", ifAvailable: true }, async lock => {
        requireValue(lock, "Another view is handling this original.");
        return work();
      });
    },
  };
}
