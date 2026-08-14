import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const TOKEN_FILE_NAME = ".ingenium-api-token";
const TOKEN_FILE_REFERENCE = /^\{file:([^{}\u0000\r\n]+)\}$/;
const MAX_TOKEN_LENGTH = 4096;
const RUNTIME_API_TOKEN_FILE = "/run/ingenium-secrets/api-token";
const MCP_CREDENTIAL_FILE_NAME = ".ingenium-mcp-credential";
const REPOSITORY_SYNC_CREDENTIAL_FILE_NAME = ".ingenium-repository-sync-credential";
const RUNTIME_CREDENTIAL_FILE_NAME = ".ingenium-runtime-credential";
const RUNTIME_CAPABILITY_FILE = "/run/ingenium-runtime/capability";

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
function readTokenFile(reference: string, expectedFileName: string): string | undefined {
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
    const expectedTokenPath = resolve(opencodeDir, expectedFileName);
    if (tokenPath !== expectedTokenPath || !isContainedBy(opencodeDir, tokenPath)) return undefined;

    const tokenLinkStat = lstatSync(tokenPath);
    if (!tokenLinkStat.isFile() || tokenLinkStat.isSymbolicLink()) return undefined;

    return readPrivateTokenFile(tokenPath);
  } catch {
    // A missing or unsafe fallback is deliberately indistinguishable from no token.
    return undefined;
  }
}

/** Resolve a scoped credential first; installation fallback requires an explicit internal launcher. */
function resolveApiCredential(): { token?: string; installation: boolean } {
  const credentialFileName = process.env.INGENIUM_MCP_AUDIENCE === "repository-sync"
    ? REPOSITORY_SYNC_CREDENTIAL_FILE_NAME
    : MCP_CREDENTIAL_FILE_NAME;
  const configuredToken = process.env.INGENIUM_MCP_CREDENTIAL;
  const placeholder = configuredToken?.match(TOKEN_FILE_REFERENCE)?.[1];
  const scopedToken = placeholder !== undefined
    ? readTokenFile(placeholder, credentialFileName)
    : normalizedApiToken(configuredToken)
      ?? readTokenFile(process.env.INGENIUM_MCP_CREDENTIAL_FILE ?? `.opencode/${credentialFileName}`, credentialFileName);
  if (scopedToken) return { token: scopedToken, installation: false };

  const installationToken = process.env.INGENIUM_INTERNAL_SERVICE === "1"
    ? normalizedApiToken(process.env.INGENIUM_API_TOKEN)
      ?? readTokenFile(process.env.INGENIUM_API_TOKEN_FILE ?? `.opencode/${TOKEN_FILE_NAME}`, TOKEN_FILE_NAME)
    : undefined;
  return { token: installationToken, installation: installationToken !== undefined };
}

function resolveRuntimeCredential(): string | undefined {
  const configured = process.env.INGENIUM_RUNTIME_CREDENTIAL_FILE;
  return normalizedApiToken(process.env.INGENIUM_RUNTIME_CREDENTIAL)
    ?? (configured === RUNTIME_CAPABILITY_FILE
      ? readPrivateTokenFile(configured)
      : readTokenFile(configured ?? `.opencode/${RUNTIME_CREDENTIAL_FILE_NAME}`, RUNTIME_CREDENTIAL_FILE_NAME));
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
export function apiRequestHeaders(headers?: HeadersInit, audience = process.env.INGENIUM_MCP_AUDIENCE ?? "mcp"): Headers {
  const requestHeaders = new Headers(headers);
  const credential = audience === "runtime"
    ? { token: resolveRuntimeCredential(), installation: false }
    : resolveApiCredential();
  const token = credential.token;
  if (token) requestHeaders.set("Authorization", `Bearer ${token}`);
  requestHeaders.set("X-Ingenium-Audience", audience);
  if (process.env.INGENIUM_WORKSPACE_ID) requestHeaders.set("X-Ingenium-Workspace", process.env.INGENIUM_WORKSPACE_ID);
  if (process.env.INGENIUM_WORKTREE) requestHeaders.set("X-Ingenium-Launcher-Worktree", process.env.INGENIUM_WORKTREE);
  if (credential.installation) {
    requestHeaders.set("X-Ingenium-Internal-Service", "1");
  }
  return requestHeaders;
}
