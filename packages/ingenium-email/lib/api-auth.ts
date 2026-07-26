import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";

/**
 * Shared authentication headers for direct Ingenium API requests made by the
 * email package. Third-party provider and LLM requests must not use this helper.
 */
const API_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

function isValidApiToken(value: unknown): value is string {
  return typeof value === "string" && API_TOKEN_PATTERN.test(value);
}

function normalizedTokenFileContents(contents: string): string {
  // Match the API's one-line secret contract exactly: its writer appends one
  // LF, but whitespace is not otherwise part of a valid opaque credential.
  return contents.endsWith("\n") ? contents.slice(0, -1) : contents;
}

/**
 * Read the canonical runtime credential without following a token-file symlink.
 *
 * Invalid or unavailable files deliberately resolve to no credential. The
 * watcher is best-effort and must neither expose secret material nor turn a
 * configuration issue into a provider-facing failure.
 */
function readApiTokenFile(tokenFile: string): string | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(tokenFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) return undefined;
    if (process.platform !== "win32" && typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
      return undefined;
    }

    const token = normalizedTokenFileContents(readFileSync(descriptor, "utf8"));
    return isValidApiToken(token) ? token : undefined;
  } catch {
    // Do not distinguish missing, unsafe, and malformed secret files in logs.
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function resolveApiToken(): string | undefined {
  const environmentToken = process.env.INGENIUM_API_TOKEN;
  if (isValidApiToken(environmentToken)) return environmentToken;

  const tokenFile = process.env.INGENIUM_API_TOKEN_FILE;
  return tokenFile ? readApiTokenFile(tokenFile) : undefined;
}

/** Adds the API bearer token without exposing it to callers or error messages. */
export function apiRequestHeaders(headers?: HeadersInit): Headers {
  const requestHeaders = new Headers(headers);
  const token = resolveApiToken();
  if (token) requestHeaders.set("Authorization", `Bearer ${token}`);
  return requestHeaders;
}
