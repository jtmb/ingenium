type Reauthenticate = () => Promise<boolean>;

let handler: Reauthenticate | null = null;
let pending: Promise<boolean> | null = null;

/** The mounted account shell owns the one credential dialog for concurrent requests. */
export function registerSessionReauthentication(next: Reauthenticate): () => void {
  handler = next;
  return () => { if (handler === next) handler = null; };
}

export function requestSessionReauthentication(): Promise<boolean | null> {
  if (!handler) return Promise.resolve(null);
  if (!pending) {
    const current = handler;
    pending = Promise.resolve().then(current).finally(() => { pending = null; });
  }
  return pending;
}
