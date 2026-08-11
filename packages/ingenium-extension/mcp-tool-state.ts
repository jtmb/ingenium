import { apiRequestHeaders } from "./api-auth.js";
import { ensureMcpProject } from "./mcp-client.js";
import { resolveExtensionProject } from "./project-resolver.js";

const DEFAULT_API_BASE = "http://localhost:4097/api/v1";
const TOOL_STATE_TIMEOUT_MS = 10_000;

export const EXTENSION_TOOL_STATE_ERRORS = {
  disabled: "TOOL_DISABLED",
  unavailable: "TOOL_STATE_UNAVAILABLE",
} as const;

export type ExtensionToolStateErrorCode =
  (typeof EXTENSION_TOOL_STATE_ERRORS)[keyof typeof EXTENSION_TOOL_STATE_ERRORS];

/** A fixed, caller-safe error for manual extension tool execution. */
export class ExtensionToolStateError extends Error {
  constructor(readonly code: ExtensionToolStateErrorCode) {
    super(code);
    this.name = "ExtensionToolStateError";
  }
}

export interface AssertExtensionToolEnabledOptions {
  request?: typeof fetch;
}

function apiBase(): string {
  return (typeof process !== "undefined" ? process.env.INGENIUM_API_URL : undefined) ?? DEFAULT_API_BASE;
}

function unavailable(): ExtensionToolStateError {
  return new ExtensionToolStateError(EXTENSION_TOOL_STATE_ERRORS.unavailable);
}

function isExactEnabledState(
  value: unknown,
  toolName: string,
  project: string,
): value is { tool_name: string; enabled: boolean } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  if (state.tool_name !== toolName || typeof state.enabled !== "boolean") return false;

  // Newer API responses may echo the resolved project. If present, it is an
  // authority check, not a hint; never execute against a mismatched snapshot.
  return state.project === undefined || state.project === project;
}

/**
 * Resolve the extension project and fail closed unless the API confirms the
 * exact catalog entry is enabled for that project.
 *
 * Lifecycle hooks intentionally do not use this helper. They retain their
 * existing best-effort automation semantics; only manual tool execution is
 * protected by the per-project toggle.
 */
export async function assertExtensionToolEnabled(
  toolName: string,
  worktree: string,
  options: AssertExtensionToolEnabledOptions = {},
): Promise<string> {
  const request = options.request ?? fetch;
  let project: string;
  try {
    project = resolveExtensionProject(worktree);
    await ensureMcpProject(worktree);
  } catch {
    throw unavailable();
  }

  let response: Response;
  try {
    response = await request(
      `${apiBase().replace(/\/+$/, "")}/mcp-tools/${encodeURIComponent(toolName)}/state?project=${encodeURIComponent(project)}`,
      {
        headers: apiRequestHeaders(worktree),
        signal: AbortSignal.timeout(TOOL_STATE_TIMEOUT_MS),
      },
    );
  } catch {
    throw unavailable();
  }

  if (!response.ok) throw unavailable();

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw unavailable();
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) throw unavailable();
  const bodyRecord = body as Record<string, unknown>;
  if (bodyRecord.project !== undefined && bodyRecord.project !== project) throw unavailable();
  const data = bodyRecord.data;
  if (!isExactEnabledState(data, toolName, project)) throw unavailable();
  if (data.enabled === false) {
    throw new ExtensionToolStateError(EXTENSION_TOOL_STATE_ERRORS.disabled);
  }

  return project;
}
