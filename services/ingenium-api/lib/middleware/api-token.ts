import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";

/** API credentials are opaque base64url values, never arbitrary bearer text. */
export const API_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/** The entrypoint copies the bootstrap credential to this ephemeral, mode-0600 file. */
export const DEFAULT_API_TOKEN_FILE = "/run/ingenium-secrets/api-token";

export class ApiTokenConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiTokenConfigurationError";
  }
}

export function isValidApiToken(value: unknown): value is string {
  return typeof value === "string" && API_TOKEN_PATTERN.test(value);
}

function normalizedTokenFileContents(contents: string): string {
  // The runtime writer terminates its one-line secret with LF. Do not broadly
  // trim: accepting whitespace would silently weaken the configuration contract.
  return contents.endsWith("\n") ? contents.slice(0, -1) : contents;
}

/**
 * Read a token from a protected regular file without following symlinks.
 *
 * Secret-file support lets the container remove the bootstrap plaintext from
 * its long-lived environment before supervised services start. Rejecting group
 * or world-readable files prevents an otherwise valid credential from quietly
 * becoming a shared capability.
 */
export function readApiTokenFile(tokenFile: string): string {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(tokenFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) {
      throw new ApiTokenConfigurationError("API token file must be a regular file");
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new ApiTokenConfigurationError("API token file must not be group- or world-readable");
    }
    if (process.platform !== "win32" && typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
      throw new ApiTokenConfigurationError("API token file must be owned by the current process user");
    }

    const token = normalizedTokenFileContents(readFileSync(descriptor, "utf8"));
    if (!isValidApiToken(token)) {
      throw new ApiTokenConfigurationError("API token file contains an invalid token");
    }
    return token;
  } catch (error) {
    if (error instanceof ApiTokenConfigurationError) throw error;
    throw new ApiTokenConfigurationError("API token file is unavailable or unsafe");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/**
 * Resolve the API credential from the protected runtime file when configured,
 * falling back to the inline variable only for non-container development.
 */
export function loadApiToken(environment: NodeJS.ProcessEnv = process.env): string {
  const tokenFile = environment.INGENIUM_API_TOKEN_FILE;
  if (tokenFile) return readApiTokenFile(tokenFile);

  const token = environment.INGENIUM_API_TOKEN;
  if (!isValidApiToken(token)) {
    throw new ApiTokenConfigurationError("API token is missing or invalid");
  }
  return token;
}

/** Fail API startup before a listener can serve an unauthenticated request. */
export function assertApiTokenConfigured(environment: NodeJS.ProcessEnv = process.env): void {
  loadApiToken(environment);
}

/** Length-safe bearer comparison shared by Express and the public boundary. */
export function apiTokensEqual(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const maximumLength = Math.max(providedBuffer.length, expectedBuffer.length);
  const paddedProvided = Buffer.alloc(maximumLength, 0);
  const paddedExpected = Buffer.alloc(maximumLength, 0);
  providedBuffer.copy(paddedProvided);
  expectedBuffer.copy(paddedExpected);

  return timingSafeEqual(paddedProvided, paddedExpected)
    && providedBuffer.length === expectedBuffer.length;
}
