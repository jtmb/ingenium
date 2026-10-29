export function createDeferredDisposal(dispose: () => void, enqueue?: (callback: () => void) => void): { attach(): () => void };
