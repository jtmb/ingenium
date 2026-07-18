import { basename } from "node:path";

const MAX_PROJECT_NAME_LENGTH = 64;
const ensuredProjects = new Map<string, Promise<string>>();

export function isValidProjectName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_PROJECT_NAME_LENGTH &&
    value.trim().length > 0 && value === value.trim() && value !== "." && value !== ".." &&
    !/[\\/\u0000-\u001f\u007f]/.test(value);
}

function rejectProjectResolution(reason: string): never {
  // Keep the reason operationally useful without echoing environment values.
  process.stderr.write(`[project-resolver] rejected project identity: ${reason}\n`);
  throw new Error(reason);
}

/** Resolve an extension session without ever silently sharing the global namespace. */
export function resolveExtensionProject(worktree: string): string {
  const explicit = process.env.INGENIUM_PROJECT;
  if (explicit !== undefined) {
    if (!isValidProjectName(explicit)) return rejectProjectResolution("INGENIUM_PROJECT is not a safe project name");
    return explicit;
  }
  const derived = basename(worktree);
  // /workspace is the container mount, not an external worktree identity.
  if (derived === "workspace") return rejectProjectResolution("Cannot derive a project from /workspace; set INGENIUM_PROJECT explicitly");
  if (!isValidProjectName(derived)) return rejectProjectResolution("Could not derive a safe project name from the worktree");
  return derived;
}

/** Idempotently provision the resolved project before an extension writes resources. */
export async function ensureExtensionProject(worktree: string, apiBase: string): Promise<string> {
  const project = resolveExtensionProject(worktree);
  const normalizedApiBase = apiBase.replace(/\/+$/, "");
  const cacheKey = `${normalizedApiBase}\u0000${project}`;
  const existing = ensuredProjects.get(cacheKey);
  if (existing) return existing;

  const pending = (async () => {
    const response = await fetch(`${normalizedApiBase}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: project, is_global: project === "global-default" }),
    });
    if (!response.ok && response.status !== 409) throw new Error(`Unable to ensure project '${project}' (HTTP ${response.status})`);
    return project;
  })();
  ensuredProjects.set(cacheKey, pending);
  try {
    return await pending;
  } catch (error) {
    ensuredProjects.delete(cacheKey);
    throw error;
  }
}

/** Test support: provisioning failures must not poison later attempts. */
export function resetEnsuredProjects(): void {
  ensuredProjects.clear();
}
