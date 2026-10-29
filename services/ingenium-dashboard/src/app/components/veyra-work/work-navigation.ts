export function parseWorkRouteParams(params: Record<string, string | string[] | undefined>): {
  initialSessionId: string | null; requestedRuntime: string | null; requestedProject: string | null; routeError: string | null;
} {
  for (const key of ["session", "runtime", "project"] as const) {
    const value = params[key];
    if (value !== undefined && (typeof value !== "string" || value.length === 0)) {
      return { initialSessionId: null, requestedRuntime: null, requestedProject: null,
        routeError: `The Work URL contains an empty or repeated ${key} value. Its conversation was not opened or replaced.` };
    }
  }
  return { initialSessionId: typeof params.session === "string" ? params.session : null,
    requestedRuntime: typeof params.runtime === "string" ? params.runtime : null,
    requestedProject: typeof params.project === "string" ? params.project : null, routeError: null };
}

export function workConversationNavigation(input: {
  search: string;
  hash: string;
  sessionId: string;
  runtimeId: string;
  project: string;
  intent: "select" | "canonicalize";
}): { action: "none" | "push" | "replace"; href: string } {
  if (!input.sessionId || !input.runtimeId || !input.project) throw new Error("A conversation needs its exact workspace identity.");
  if (input.hash && !input.hash.startsWith("#")) throw new Error("Invalid conversation fragment.");
  const current = new URLSearchParams(input.search);
  // A Back/Forward URL can arrive before the server's session prop. Canonical
  // binding repair must not redirect that newer navigation to the old session.
  if (input.intent === "canonicalize" && current.get("session") !== input.sessionId) {
    return { action: "none", href: `/work${current.size ? `?${current.toString()}` : ""}${input.hash}` };
  }
  const next = new URLSearchParams(current);
  next.set("session", input.sessionId);
  next.set("runtime", input.runtimeId);
  next.set("project", input.project);
  const href = `/work?${next.toString()}${input.hash}`;
  if (next.toString() === current.toString()) return { action: "none", href };
  const sameSession = current.get("session") === input.sessionId;
  return { action: input.intent === "canonicalize" || sameSession ? "replace" : "push", href };
}
