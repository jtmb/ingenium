import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const TOKEN_FILE_NAME = ".ingenium-api-token";
const MAX_TOKEN_LENGTH = 4096;
const TOKEN_FILE_REFERENCE = /^\{file:([^{}\u0000\r\n]+)\}$/;

function normalizeToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const token = value.trim();
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return undefined;
  // Reject whitespace, control characters, and non-ASCII bytes so a token can
  // never alter the HTTP Authorization header structure.
  if (!/^[\x21-\x7e]+$/.test(token)) return undefined;
  return token;
}

function isContainedBy(parent: string, candidate: string): boolean {
  const relativePath = relative(parent, candidate);
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function readTokenFile(worktree: string | undefined, reference = `.opencode/${TOKEN_FILE_NAME}`): string | undefined {
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

    const tokenStat = statSync(tokenPath);
    // The token must be owner-readable and inaccessible to group/other users.
    if ((tokenStat.mode & 0o400) === 0 || (tokenStat.mode & 0o077) !== 0) return undefined;
    if (process.platform !== "win32" && typeof process.getuid === "function" && tokenStat.uid !== process.getuid()) {
      return undefined;
    }

    return normalizeToken(readFileSync(tokenPath, "utf8"));
  } catch {
    // Missing, unsafe, or unreadable fallback files are intentionally silent.
    return undefined;
  }
}

/**
 * Builds request headers without exposing the credential to callers or logs.
 * The environment remains authoritative; plugins fall back to a protected
 * worktree-local token file only when that variable is absent or unusable.
 */
export function apiRequestHeaders(worktree?: string, headers?: HeadersInit): Headers {
  const requestHeaders = new Headers(headers);
  const configuredToken = process.env.INGENIUM_API_TOKEN;
  const placeholder = configuredToken?.match(TOKEN_FILE_REFERENCE)?.[1];
  const token = placeholder !== undefined
    ? readTokenFile(worktree, placeholder)
    : normalizeToken(configuredToken)
      ?? readTokenFile(worktree, process.env.INGENIUM_API_TOKEN_FILE);
  if (token) requestHeaders.set("Authorization", `Bearer ${token}`);
  return requestHeaders;
}
