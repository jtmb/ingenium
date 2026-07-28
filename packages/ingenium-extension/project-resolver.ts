import { basename, resolve } from "node:path";
import {
  apiRequestHeaders,
  waitForAuthenticatedApiReadiness,
  type ApiAuthenticationFailureKind,
  type ApiAuthenticationReadinessOptions,
} from "./api-auth.js";

const MAX_PROJECT_NAME_LENGTH = 64;
const ensuredProjects = new Map<string, Promise<string>>();

function apiTimeoutMs(): number {
  const configured = Number(process.env.INGENIUM_API_TIMEOUT ?? "10000");
  return Number.isFinite(configured) && configured > 0 ? configured : 10000;
}

export type ExtensionProjectFailureKind = ApiAuthenticationFailureKind | "rejected";

/** A caller-safe startup failure. Never place transport diagnostics in this error. */
export class ExtensionProjectStartupError extends Error {
  constructor(readonly failure: ExtensionProjectFailureKind) {
    super("Unable to establish an extension project connection");
    this.name = "ExtensionProjectStartupError";
  }
}

export interface EnsureExtensionProjectOptions {
  request?: typeof fetch;
  readiness?: Omit<ApiAuthenticationReadinessOptions, "request">;
}

/** Extract only a stable, non-sensitive category for lifecycle diagnostics. */
export function classifyExtensionProjectFailure(error: unknown): ExtensionProjectFailureKind {
  return error instanceof ExtensionProjectStartupError ? error.failure : "unavailable";
}

function classifyProjectProvisioningFailure(status: number): ExtensionProjectFailureKind {
  if (status === 401 || status === 403) return "authentication";
  return status >= 500 ? "unavailable" : "rejected";
}

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

/**
 * Resolve an extension session without ever silently sharing the global namespace.
 *
 * An explicit CLI project takes precedence over the environment so operators can
 * target a validated project without mutating the process environment.
 */
export function resolveExtensionProject(worktree: string, requestedProject?: string): string {
  if (requestedProject !== undefined) {
    if (!isValidProjectName(requestedProject)) return rejectProjectResolution("--project is not a safe project name");
    return requestedProject;
  }
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
export async function ensureExtensionProject(
  worktree: string,
  apiBase: string,
  requestedProject?: string,
  options: EnsureExtensionProjectOptions = {},
): Promise<string> {
  const project = resolveExtensionProject(worktree, requestedProject);
  const normalizedApiBase = apiBase.replace(/\/+$/, "");
  // The protected bearer may be worktree-local. Keep two worktrees with the
  // same explicit project from sharing a cached request made with another
  // worktree's credential source.
  const cacheKey = `${normalizedApiBase}\u0000${resolve(worktree)}\u0000${project}`;
  const existing = ensuredProjects.get(cacheKey);
  if (existing) return existing;

  const pending = (async () => {
    const request = options.request ?? fetch;
    const readiness = await waitForAuthenticatedApiReadiness(normalizedApiBase, worktree, {
      ...options.readiness,
      request,
    });
    if (!readiness.authenticated) {
      throw new ExtensionProjectStartupError(readiness.failure ?? "unavailable");
    }

    let response: Response;
    try {
      response = await request(`${normalizedApiBase}/projects`, {
        method: "POST",
        headers: apiRequestHeaders(worktree, { "Content-Type": "application/json" }),
        body: JSON.stringify({ name: project, is_global: project === "global-default" }),
        signal: AbortSignal.timeout(apiTimeoutMs()),
      });
    } catch {
      throw new ExtensionProjectStartupError("unavailable");
    }
    if (!response.ok && response.status !== 409) {
      throw new ExtensionProjectStartupError(classifyProjectProvisioningFailure(response.status));
    }
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
