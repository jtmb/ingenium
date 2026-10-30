
// Pending policy requests extend this original custody module, under distinct
// keys. GoalStore receipts remain authority; this is only an unsent/unknown
// witness. Prompt originals and their raw bytes are never read or rewritten.
export const nativeMemoryCustody = {
  async get(scope: string) {
    const raw = localStorage.getItem(memoryKey(scope));
    if (raw === null) return null;
    if (bytes(raw) > 64 * 1024) throw new Error("Pending memory witness exceeds bound");
    const value = JSON.parse(raw);
    if (value.identity?.scopeHash !== scope || typeof value.operationId !== "string" || !value.nativeCommand)
      throw new Error("Pending memory witness is unreadable; preserve its raw bytes");
    return value;
  },
  async set(scope: string, record: unknown) {
    const key = memoryKey(scope), raw = JSON.stringify(record);
    await withPromptLock(key, async () => {
      if (localStorage.getItem(key) !== null || bytes(raw) > 64 * 1024) throw new Error("A pending memory original already exists or exceeds its bound");
      requirePromptRoom(key, raw);
      localStorage.setItem(key, raw);
      if (localStorage.getItem(key) !== raw) throw new Error("Memory witness could not be retained");
    });
  },
  async retain(scope: string, operation: string, receipt: unknown) {
    const key = memoryKey(scope);
    await withPromptLock(key, async () => {
      const raw = localStorage.getItem(key);
      if (raw === null || row(JSON.parse(raw)).operationId !== operation) throw new Error("Pending memory original changed");
      retainPromptReceipt(key, raw, receipt);
    });
  },
  async remove(scope: string, operation: string) {
    const key = memoryKey(scope);
    await withPromptLock(key, async () => {
      const raw = localStorage.getItem(key);
      if (raw === null || row(JSON.parse(raw)).operationId !== operation) throw new Error("Pending memory original changed");
      const { rows } = history(key + ":history");
      if (!rows.some(item => row(item).raw === raw && row(row(item).receipt).operationId === operation))
        throw new Error("No retained receipt matches the pending memory original");
      localStorage.removeItem(key);
      if (localStorage.getItem(key) !== null) throw new Error("Settled memory witness could not be released");
    });
  },
};
function memoryKey(scope: string) {
  if (!/^[a-f0-9]{64}$/.test(scope)) throw new Error("Native memory scope hash is invalid");
  return "veyra.pending-learned-memory.v1:" + scope;
}
