import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const TOKEN_FILE_NAME = ".ingenium-api-token";
const TOKEN_FILE_REFERENCE = /^\{file:([^{}\u0000\r\n]+)\}$/;
const API_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
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

function isContainedBy(parent: string, candidate: string): boolean {
  const relativePath = relative(parent, candidate);
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
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

function readWorktreeTokenFile(worktree: string | undefined, reference = `.opencode/${TOKEN_FILE_NAME}`): string | undefined {
  if (!worktree || !isAbsolute(worktree)) return undefined;
  if (isAbsolute(reference)) return undefined;

  try {
    const worktreeRoot = realpathSync(resolve(worktree));
    if (!statSync(worktreeRoot).isDirectory()) return undefined;

    const opencodeDir = resolve(worktreeRoot, ".opencode");
    if (!isContainedBy(worktreeRoot, opencodeDir)) return undefined;
    const opencodeStat = lstatSync(opencodeDir);
    if (!opencodeStat.isDirectory() || opencodeStat.isSymbolicLink()) return undefined;

    const tokenPath = resolve(worktreeRoot, reference);
    const expectedTokenPath = resolve(opencodeDir, TOKEN_FILE_NAME);
    if (tokenPath !== expectedTokenPath || !isContainedBy(opencodeDir, tokenPath)) return undefined;
    const tokenLinkStat = lstatSync(tokenPath);
    if (!tokenLinkStat.isFile() || tokenLinkStat.isSymbolicLink()) return undefined;
    // O_NOFOLLOW closes the lstat/read race: a token path swapped to a symlink
    // after validation is rejected by the descriptor open rather than followed.
    return readProtectedTokenFile(tokenPath);
  } catch {
    // Missing, unsafe, or unreadable fallback files are intentionally silent.
    return undefined;
  }
}

function configuredTokenFile(worktree: string | undefined, reference: string | undefined): string | undefined {
  if (!reference) return readWorktreeTokenFile(worktree);
  if (isAbsolute(reference)) return readProtectedTokenFile(reference);
  return readWorktreeTokenFile(worktree, reference);
}

/**
 * Builds request headers without exposing the credential to callers or logs.
 * The environment remains authoritative; plugins fall back to a protected
 * worktree-local or protected absolute token file only when that variable is
 * absent or unusable. The token is used only to construct the request header.
 */
export function apiRequestHeaders(worktree?: string, headers?: HeadersInit): Headers {
  const requestHeaders = new Headers(headers);
  // Callers must never be able to smuggle a caller-controlled credential onto
  // an extension request. Only a token resolved from the protected sources
  // below may be sent to the API.
  requestHeaders.delete("Authorization");
  requestHeaders.delete("Proxy-Authorization");
  const configuredToken = process.env.INGENIUM_API_TOKEN;
  const placeholder = configuredToken?.match(TOKEN_FILE_REFERENCE)?.[1];
  const token = placeholder !== undefined
    ? configuredTokenFile(worktree, placeholder)
    : normalizeToken(configuredToken)
      ?? configuredTokenFile(worktree, process.env.INGENIUM_API_TOKEN_FILE);
  if (token) requestHeaders.set("Authorization", `Bearer ${token}`);
  return requestHeaders;
}

export interface ApiAuthenticationPreflightResult {
  authenticated: boolean;
  error?: "Unable to authenticate with Ingenium API";
  /** Safe category only; it never contains a status, URL, response body, or credential detail. */
  failure?: ApiAuthenticationFailureKind;
}

export type ApiAuthenticationFailureKind = "authentication" | "unavailable" | "invalid_target";

export interface ApiAuthenticationPreflightOptions {
  timeoutMs?: number;
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
  const base = normalizeApiBase(apiBase);
  if (!base) return failedPreflight("invalid_target");

  try {
    const response = await request(`${base}/auth/preflight`, {
      headers: apiRequestHeaders(worktree),
      signal: AbortSignal.timeout(boundedInteger(options.timeoutMs, DEFAULT_PREFLIGHT_TIMEOUT_MS, 1, DEFAULT_PREFLIGHT_TIMEOUT_MS)),
    });
    if (response.status === 200) return { authenticated: true };
    if (response.status === 401 || response.status === 403) return failedPreflight("authentication");
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
