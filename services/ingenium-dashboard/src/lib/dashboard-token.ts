import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

/** API credentials are opaque base64url values, never arbitrary bearer text. */
export const DASHBOARD_API_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export class DashboardTokenConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardTokenConfigurationError";
  }
}

function isValidDashboardApiToken(value: unknown): value is string {
  return typeof value === "string" && DASHBOARD_API_TOKEN_PATTERN.test(value);
}

function normalizeTokenFileContents(contents: string): string {
  // Runtime secret writers terminate the one-line token with LF. Do not
  // broadly trim here: accepting surrounding whitespace weakens the contract.
  return contents.endsWith("\n") ? contents.slice(0, -1) : contents;
}

function validateTokenFilePath(tokenFile: string): string {
  if (
    !isAbsolute(tokenFile)
    || tokenFile.length === 0
    || /[\u0000-\u001f\u007f]/.test(tokenFile)
  ) {
    throw new DashboardTokenConfigurationError("API token file path is unsafe");
  }
  return tokenFile;
}

/**
 * Read a dashboard API token from a protected regular file without following
 * symlinks. The descriptor is opened before metadata is checked so the file
 * being validated is the file that is read.
 */
export function readDashboardApiTokenFile(tokenFile: string): string {
  const safePath = validateTokenFilePath(tokenFile);
  let descriptor: number | undefined;

  try {
    descriptor = openSync(safePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) {
      throw new DashboardTokenConfigurationError("API token file must be a regular file");
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new DashboardTokenConfigurationError("API token file must not be group- or world-readable");
    }
    if (
      process.platform !== "win32"
      && typeof process.getuid === "function"
      && metadata.uid !== process.getuid()
    ) {
      throw new DashboardTokenConfigurationError("API token file must be owned by the current process user");
    }
    if (metadata.size > 129) {
      throw new DashboardTokenConfigurationError("API token file is too large");
    }

    const token = normalizeTokenFileContents(readFileSync(descriptor, "utf8"));
    if (!isValidDashboardApiToken(token)) {
      throw new DashboardTokenConfigurationError("API token file contains an invalid token");
    }
    return token;
  } catch (error) {
    if (error instanceof DashboardTokenConfigurationError) throw error;
    // Do not expose the configured path, errno, or secret material through a
    // dashboard response. The proxy converts this into a generic 503.
    throw new DashboardTokenConfigurationError("API token file is unavailable or unsafe");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

type DashboardTokenEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Resolve the server-only dashboard credential.
 *
 * Every server runtime, including development and tests, must use the
 * protected token-file path. Invalid file configuration fails closed; there
 * is intentionally no inline environment-variable fallback.
 */
export function loadDashboardApiToken(
  environment: DashboardTokenEnvironment = process.env,
): string | null {
  const configuredFile = environment.INGENIUM_API_TOKEN_FILE;
  if (configuredFile !== undefined) {
    try {
      return readDashboardApiTokenFile(configuredFile.trim());
    } catch {
      return null;
    }
  }

  return null;
}
