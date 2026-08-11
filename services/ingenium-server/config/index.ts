import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const TOKEN_FILE_NAME = ".ingenium-api-token";
const TOKEN_FILE_REFERENCE = /^\{file:([^{}\u0000\r\n]+)\}$/;
const MAX_TOKEN_LENGTH = 4096;
const RUNTIME_API_TOKEN_FILE = "/run/ingenium-secrets/api-token";

function normalizedApiToken(value: string | undefined): string | undefined {
  const token = value?.trim();
  if (!token || token.length > MAX_TOKEN_LENGTH || !/^[\x21-\x7e]+$/.test(token)) return undefined;
  return token;
}

function isContainedBy(parent: string, candidate: string): boolean {
  const relativePath = relative(parent, candidate);
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function readPrivateTokenFile(tokenPath: string): string | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(tokenPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const tokenStat = fstatSync(descriptor);
    if (!tokenStat.isFile() || (tokenStat.mode & 0o400) === 0 || (tokenStat.mode & 0o077) !== 0) return undefined;
    if (process.platform !== "win32" && typeof process.getuid === "function" && tokenStat.uid !== process.getuid()) {
      return undefined;
    }
    return normalizedApiToken(readFileSync(descriptor, "utf8"));
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/**
 * Read only the protected token file represented by the tracked MCP config.
 * Arbitrary file references are rejected so an untrusted OpenCode config cannot
 * turn this process into a general-purpose file reader.
 */
function readTokenFile(reference: string): string | undefined {
  // The entrypoint owns this fixed owner-private file; arbitrary absolute paths remain rejected.
  if (isAbsolute(reference)) return reference === RUNTIME_API_TOKEN_FILE ? readPrivateTokenFile(reference) : undefined;

  try {
    const worktreeRoot = realpathSync(process.cwd());
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

    return readPrivateTokenFile(tokenPath);
  } catch {
    // A missing or unsafe fallback is deliberately indistinguishable from no token.
    return undefined;
  }
}

/** Resolve an explicit token first, then the tracked protected-file fallback. */
function resolveApiToken(): string | undefined {
  const configuredToken = process.env.INGENIUM_API_TOKEN;
  const placeholder = configuredToken?.match(TOKEN_FILE_REFERENCE)?.[1];
  if (placeholder !== undefined) return readTokenFile(placeholder);

  return normalizedApiToken(configuredToken)
    ?? readTokenFile(process.env.INGENIUM_API_TOKEN_FILE ?? `.opencode/${TOKEN_FILE_NAME}`);
}

/**
 * Centralised configuration for the Ingenium MCP server.
 * All values loaded from environment variables with sensible defaults.
 * NOTE: This service has ZERO direct DB access — all data flows through API.
 */
export const config = {
  /** Base URL of the Ingenium REST API (port 4097, NOT 3000/4098/4099). */
  apiUrl: process.env.INGENIUM_API_URL ?? "http://localhost:4097/api/v1",
  /** Request timeout in ms. 10s default — generous for LLM-backed endpoints but short enough to avoid cascading stalls. */
  apiTimeout: parseInt(process.env.INGENIUM_API_TIMEOUT ?? "10000", 10),
  /** MCP server identity — used in protocol handshake and capability advertisement. */
  mcpName: "ingenium-server",
  mcpVersion: "0.1.0",
};

/** Add API authentication without exposing the configured token to callers. */
export function apiRequestHeaders(headers?: HeadersInit): Headers {
  const requestHeaders = new Headers(headers);
  const token = resolveApiToken();
  if (token) requestHeaders.set("Authorization", `Bearer ${token}`);
  return requestHeaders;
}
