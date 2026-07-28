import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const TOKEN_FILE_NAME = ".ingenium-api-token";
const TOKEN_FILE_REFERENCE = /^\{file:([^{}\u0000\r\n]+)\}$/;
const API_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

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
}

/**
 * Confirm that a protected token can authenticate the API without exposing the
 * token, response body, URL diagnostics, or HTTP status to extension callers.
 */
export async function preflightApiAuthentication(
  apiBase: string,
  worktree?: string,
  request: typeof fetch = fetch,
): Promise<ApiAuthenticationPreflightResult> {
  try {
    const normalized = new URL(apiBase);
    if ((normalized.protocol !== "http:" && normalized.protocol !== "https:") || normalized.username || normalized.password) {
      throw new Error("unsafe API base");
    }
    const base = apiBase.replace(/\/+$/, "");
    const response = await request(`${base}/auth/preflight`, {
      headers: apiRequestHeaders(worktree),
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 200) return { authenticated: true };
  } catch {
    // Error details can contain a URL or transport diagnostic. Deliberately
    // collapse every failure into the same caller-safe response.
  }
  return { authenticated: false, error: "Unable to authenticate with Ingenium API" };
}
