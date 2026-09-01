import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import {
  resolveExtensionBinding,
  type ExtensionBinding,
  type ExtensionCredentialPurpose,
} from "./extension-binding.js";

const API_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_REVISION_PATTERN = /^[0-9a-f]{40}$/;
const DEFAULT_PREFLIGHT_TIMEOUT_MS = 5_000;

/** Startup probes remain deliberately small and finite so plugin loading cannot hang. */
export const EXTENSION_STARTUP_READINESS_ATTEMPTS = 3;
export const EXTENSION_STARTUP_PREFLIGHT_TIMEOUT_MS = 1_000;
export const EXTENSION_STARTUP_RETRY_DELAY_MS = 250;

function normalizeToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Match the API's exact one-line token contract. Broad trimming would accept
  // otherwise-invalid credentials and can mask a damaged protected file.
  const token = value.endsWith("\n") ? value.slice(0, -1) : value;
  return API_TOKEN_PATTERN.test(token) ? token : undefined;
}

function readProtectedTokenFile(tokenPath: string): string | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(tokenPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const tokenStat = fstatSync(descriptor);
    if (!tokenStat.isFile() || (tokenStat.mode & 0o400) === 0 || (tokenStat.mode & 0o077) !== 0) return undefined;
    if (process.platform !== "win32" && typeof process.getuid === "function" && tokenStat.uid !== process.getuid()) return undefined;
    return normalizeToken(readFileSync(descriptor, "utf8"));
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export interface ApiRequestAuthOptions {
  purpose?: ExtensionCredentialPurpose;
  binding?: ExtensionBinding;
}

/**
 * Builds request headers without exposing the credential to callers or logs.
 * The environment remains authoritative; plugins fall back to a protected
 * worktree-local or protected absolute token file only when that variable is
 * absent or unusable. The token is used only to construct the request header.
 */
export function apiRequestHeaders(
  worktree?: string,
  headers?: HeadersInit,
  options: ApiRequestAuthOptions = {},
): Headers {
  const requestHeaders = new Headers(headers);
  // Callers must never be able to smuggle a caller-controlled credential onto
  // an extension request. Only a token resolved from the protected sources
  // below may be sent to the API.
  requestHeaders.delete("Authorization");
  requestHeaders.delete("Proxy-Authorization");
  let binding: ExtensionBinding;
  try {
    binding = options.binding ?? resolveExtensionBinding(worktree ?? process.cwd(), { purpose: options.purpose });
  } catch {
    return requestHeaders;
  }
  const token = readProtectedTokenFile(binding.credentialFile);
  if (token) requestHeaders.set("Authorization", `Bearer ${token}`);
  requestHeaders.set("X-Ingenium-Audience", binding.audience);
  requestHeaders.set("X-Ingenium-Workspace", binding.workspaceId);
  requestHeaders.set("X-Ingenium-Launcher-Worktree", binding.launcherWorktree);
  return requestHeaders;
}

export interface ApiAuthenticationPreflightResult {
  authenticated: boolean;
  error?: "Unable to authenticate with Ingenium API";
  /** Safe category only; it never contains a status, URL, response body, or credential detail. */
  failure?: ApiAuthenticationFailureKind;
  binding?: ApiAuthenticationBinding;
  runtime?: ApiAuthenticationRuntime;
}

export type ApiAuthenticationFailureKind = "authentication" | "scope" | "not_found" | "unavailable" | "invalid_target";

export interface ApiAuthenticationBinding {
  scopes: string[];
  organizationId: string;
  projectId: string;
  projectIds: string[];
  audience: "mcp" | "runtime" | "repository-sync";
  workspaceId: string;
  launcherWorktree: string;
  storageMappingHash: string;
  /**
   * Legacy compatibility signal. New clients use credentialChangeMode for
   * content-only credential rotation while older clients conservatively
   * restart when this remains true.
   */
  restartRequiredOnCredentialChange: boolean;
  /** Content rotation is live only for an already-attested MCP binding. */
  credentialChangeMode?: ApiAuthenticationCredentialChangeMode;
}

export type ApiAuthenticationCredentialChangeMode = "live-mcp-reload" | "restart";

export interface ApiAuthenticationRuntime {
  id: string;
  imageRevision: string;
  state: "READY" | "IDLE";
}

export interface ApiAuthenticationPreflightOptions {
  timeoutMs?: number;
  credentialPurpose?: ExtensionCredentialPurpose;
  runtimeId?: string;
}

export interface ApiAuthenticationReadinessOptions extends ApiAuthenticationPreflightOptions {
  attempts?: number;
  retryDelayMs?: number;
  request?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value === undefined) return fallback;
  return Math.min(Math.max(value, minimum), maximum);
}

function normalizeApiBase(apiBase: string): string | null {
  try {
    const parsed = new URL(apiBase);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:")
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash) {
      return null;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function failedPreflight(failure: ApiAuthenticationFailureKind): ApiAuthenticationPreflightResult {
  return { authenticated: false, error: "Unable to authenticate with Ingenium API", failure };
}

function authenticationBinding(value: unknown): ApiAuthenticationBinding | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = "data" in value && value.data && typeof value.data === "object" ? value.data as Record<string, unknown> : value as Record<string, unknown>;
  if (!Array.isArray(data.scopes) || !data.scopes.every((scope) => typeof scope === "string")
    || typeof data.organizationId !== "string" || typeof data.projectId !== "string"
    || !Array.isArray(data.projectIds) || !data.projectIds.every((project) => typeof project === "string")
    || (data.audience !== "mcp" && data.audience !== "runtime" && data.audience !== "repository-sync")
    || typeof data.workspaceId !== "string" || typeof data.launcherWorktree !== "string"
    || typeof data.storageMappingHash !== "string" || !/^[0-9a-f]{64}$/.test(data.storageMappingHash)
    || !data.projectIds.includes(data.projectId)
    || typeof data.restartRequiredOnCredentialChange !== "boolean") return undefined;

  const hasCredentialChangeMode = Object.prototype.hasOwnProperty.call(data, "credentialChangeMode");
  let credentialChangeMode: ApiAuthenticationCredentialChangeMode;
  if (!hasCredentialChangeMode) {
    if (data.restartRequiredOnCredentialChange !== true) return undefined;
    credentialChangeMode = "restart";
  } else {
    if (data.credentialChangeMode !== "live-mcp-reload" && data.credentialChangeMode !== "restart") return undefined;
    credentialChangeMode = data.credentialChangeMode;
    if (credentialChangeMode === "restart" && data.restartRequiredOnCredentialChange !== true) return undefined;
    if (credentialChangeMode === "live-mcp-reload" && data.audience !== "mcp") return undefined;
  }

  return {
    scopes: data.scopes,
    organizationId: data.organizationId,
    projectId: data.projectId,
    projectIds: data.projectIds,
    audience: data.audience,
    workspaceId: data.workspaceId,
    launcherWorktree: data.launcherWorktree,
    storageMappingHash: data.storageMappingHash,
    restartRequiredOnCredentialChange: credentialChangeMode === "restart",
    credentialChangeMode,
  };
}

function authenticationRuntime(value: unknown): ApiAuthenticationRuntime | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = "data" in value && value.data && typeof value.data === "object" ? value.data as Record<string, unknown> : value as Record<string, unknown>;
  const runtime = data.runtime;
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) return undefined;
  const candidate = runtime as Record<string, unknown>;
  if (Object.keys(candidate).sort().join(",") !== "id,imageRevision,state"
    || typeof candidate.id !== "string" || !UUID_PATTERN.test(candidate.id)
    || typeof candidate.imageRevision !== "string" || !IMAGE_REVISION_PATTERN.test(candidate.imageRevision)
    || (candidate.state !== "READY" && candidate.state !== "IDLE")) return undefined;
  return candidate as unknown as ApiAuthenticationRuntime;
}

function matchesImmutableBinding(
  attested: ApiAuthenticationBinding,
  expected: ExtensionBinding,
): boolean {
  return attested.audience === expected.audience
    && attested.workspaceId === expected.workspaceId
    && attested.launcherWorktree === expected.launcherWorktree
    && (expected.projectId === undefined || attested.projectId === expected.projectId)
    && (expected.storageMappingHash === undefined || attested.storageMappingHash === expected.storageMappingHash);
}

function sleepFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Confirm that a protected token can authenticate the API without exposing the
 * token, response body, URL diagnostics, or HTTP status to extension callers.
 */
export async function preflightApiAuthentication(
  apiBase: string,
  worktree?: string,
  request: typeof fetch = fetch,
  options: ApiAuthenticationPreflightOptions = {},
): Promise<ApiAuthenticationPreflightResult> {
  if (options.runtimeId !== undefined && !UUID_PATTERN.test(options.runtimeId)) return failedPreflight("invalid_target");
  const base = normalizeApiBase(apiBase);
  if (!base) return failedPreflight("invalid_target");
  let expectedBinding: ExtensionBinding;
  try {
    expectedBinding = resolveExtensionBinding(worktree ?? process.cwd(), { purpose: options.credentialPurpose });
  } catch {
    return failedPreflight("invalid_target");
  }
  if (base !== expectedBinding.apiUrl) return failedPreflight("invalid_target");

  try {
    const preflightUrl = new URL(`${expectedBinding.apiUrl}/auth/preflight`);
    if (options.runtimeId !== undefined) {
      const query = new URLSearchParams();
      query.set("runtime_id", options.runtimeId);
      preflightUrl.search = query.toString();
    }
    const response = await request(preflightUrl.toString(), {
      headers: apiRequestHeaders(worktree, undefined, { binding: expectedBinding }),
      signal: AbortSignal.timeout(boundedInteger(options.timeoutMs, DEFAULT_PREFLIGHT_TIMEOUT_MS, 1, DEFAULT_PREFLIGHT_TIMEOUT_MS)),
    });
    if (response.status === 200) {
      const payload = await response.json().catch(() => null);
      const attestedBinding = authenticationBinding(payload);
      if (!attestedBinding) return failedPreflight("authentication");
      if (!matchesImmutableBinding(attestedBinding, expectedBinding)) return failedPreflight("not_found");
      if (options.runtimeId === undefined) return { authenticated: true, binding: attestedBinding };
      const runtime = authenticationRuntime(payload);
      return runtime?.id === options.runtimeId
        ? { authenticated: true, binding: attestedBinding, runtime }
        : failedPreflight("not_found");
    }
    if (response.status === 401) return failedPreflight("authentication");
    if (response.status === 403) return failedPreflight("scope");
    if (response.status === 404) return failedPreflight("not_found");
  } catch {
    // Error details can contain a URL or transport diagnostic. Deliberately
    // collapse every failure into the same caller-safe response.
  }
  return failedPreflight("unavailable");
}

/**
 * Wait for a bounded number of authenticated capability probes before startup
 * project provisioning. Authentication and invalid-target failures fail closed
 * immediately; only a transient unavailable API consumes the retry budget.
 */
export async function waitForAuthenticatedApiReadiness(
  apiBase: string,
  worktree?: string,
  options: ApiAuthenticationReadinessOptions = {},
): Promise<ApiAuthenticationPreflightResult> {
  const attempts = boundedInteger(
    options.attempts,
    EXTENSION_STARTUP_READINESS_ATTEMPTS,
    1,
    EXTENSION_STARTUP_READINESS_ATTEMPTS,
  );
  const retryDelayMs = boundedInteger(options.retryDelayMs, EXTENSION_STARTUP_RETRY_DELAY_MS, 0, 1_000);
  const request = options.request ?? fetch;
  const sleep = options.sleep ?? sleepFor;
  let result = failedPreflight("unavailable");

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = await preflightApiAuthentication(apiBase, worktree, request, {
      credentialPurpose: options.credentialPurpose,
      runtimeId: options.runtimeId,
      timeoutMs: boundedInteger(
        options.timeoutMs,
        EXTENSION_STARTUP_PREFLIGHT_TIMEOUT_MS,
        1,
        DEFAULT_PREFLIGHT_TIMEOUT_MS,
      ),
    });
    if (result.authenticated || result.failure !== "unavailable" || attempt === attempts) return result;
    await sleep(retryDelayMs);
  }

  return result;
}
