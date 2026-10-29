/** React's setup/cleanup/setup probe must not end a user-started connection. */
export function createDeferredDisposal(dispose, enqueue = queueMicrotask) {
  let epoch = 0, disposed = false;
  return {
    attach() {
      const current = ++epoch; let released = false;
      return () => {
        if (released) return; released = true;
        enqueue(() => { if (epoch === current && !disposed) { disposed = true; dispose(); } });
      };
    },
  };
}
