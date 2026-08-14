import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { getTestRunApiTokenPath, type TestRunContext, type TestRunManifest } from "../test-run-context";

export const DASHBOARD_API_TOKEN_FILE_ENV = "INGENIUM_API_TOKEN_FILE";
export const DASHBOARD_STORAGE_STATE_FILENAME = "browser-storage-state.json";
export const DASHBOARD_GLOBAL_PROJECT_STORAGE_KEY = "ingenium_global_project";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const TOKEN_MODE = 0o600;

function pathIsInside(parent: string, child: string): boolean {
  const fromParent = relative(resolve(parent), resolve(child));
  return fromParent === "" || (!fromParent.startsWith("..") && !isAbsolute(fromParent));
}

function assertRunOwnedPath(manifest: TestRunManifest, tokenFile: string): void {
  const runDir = resolve(manifest.runDir);
  const expected = getTestRunApiTokenPath(manifest);
  if (tokenFile !== expected || !pathIsInside(runDir, tokenFile)) {
    throw new Error("Refusing to create a dashboard credential outside the test-run directory");
  }

  let cursor = tokenFile;
  while (true) {
    try {
      const metadata = lstatSync(cursor);
      if (metadata.isSymbolicLink()) {
        throw new Error("Refusing to use a symlinked dashboard credential path");
      }
      if (cursor === runDir) break;
      const parent = dirname(cursor);
      if (parent === cursor) throw new Error("Dashboard credential has no run-directory ancestor");
      cursor = parent;
    } catch (error) {
      if (error instanceof Error && /symlinked|no run-directory/.test(error.message)) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("Dashboard credential path cannot be inspected safely");
      }
      const parent = dirname(cursor);
      if (parent === cursor) throw new Error("Dashboard credential has no run-directory ancestor");
      cursor = parent;
    }
  }

  if (realpathSync(runDir) !== runDir) {
    throw new Error("Refusing to use a symlinked test-run directory for the dashboard credential");
  }
}

function assertTokenFileMetadata(tokenFile: string, expectedToken: string): void {
  const metadata = lstatSync(tokenFile);
  if (!metadata.isFile() || (metadata.mode & 0o777) !== TOKEN_MODE) {
    throw new Error("Dashboard API token file must be a regular 0600 file");
  }
  if (
    process.platform !== "win32"
    && typeof process.getuid === "function"
    && metadata.uid !== process.getuid()
  ) {
    throw new Error("Dashboard API token file must be owned by the test process");
  }
  const contents = readFileSync(tokenFile, "utf8");
  const token = contents.endsWith("\n") ? contents.slice(0, -1) : contents;
  if (token !== expectedToken) throw new Error("Dashboard API token file contents do not match the fixture token");
}

function validateToken(token: string): void {
  if (!TOKEN_PATTERN.test(token)) throw new Error("Dashboard fixture token has an invalid format");
}

/**
 * Create or validate the manifest-owned dashboard credential file.
 *
 * The file is created with exclusive creation and `O_NOFOLLOW`, then its mode
 * is forced to 0600. An existing file is accepted only when it is the exact
 * regular file for this run and contains the expected fixture token.
 */
export function ensureDashboardApiTokenFile(context: TestRunContext, token: string): string {
  validateToken(token);
  const tokenFile = getTestRunApiTokenPath(context);
  assertRunOwnedPath(context, tokenFile);

  try {
    assertTokenFileMetadata(tokenFile, token);
    return tokenFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      try {
        if (lstatSync(tokenFile).isSymbolicLink()) {
          throw new Error("Refusing to use a symlinked dashboard API token file");
        }
      } catch (metadataError) {
        if (metadataError instanceof Error && metadataError.message.includes("symlinked")) throw metadataError;
      }
      if (lstatSync(tokenFile, { throwIfNoEntry: false })) throw error;
    }
  }

  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      tokenFile,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      TOKEN_MODE,
    );
    writeSync(descriptor, `${token}\n`, undefined, "utf8");
    fchmodSync(descriptor, TOKEN_MODE);
    fsyncSync(descriptor);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new Error("Unable to create dashboard API token file");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }

  assertRunOwnedPath(context, tokenFile);
  assertTokenFileMetadata(tokenFile, token);
  return tokenFile;
}

/**
 * Environment for the dashboard fixture process. The bearer is intentionally
 * absent: only the run-owned token-file path crosses the process boundary.
 */
export function getDashboardFixtureEnvironment(
  context: TestRunContext,
  token: string,
): Record<string, string> {
  const tokenFile = ensureDashboardApiTokenFile(context, token);
  return { [DASHBOARD_API_TOKEN_FILE_ENV]: tokenFile };
}

export function getDashboardStorageStatePath(context: Pick<TestRunManifest, "runDir" | "homeDir">): string {
  const storageStatePath = resolve(context.homeDir, DASHBOARD_STORAGE_STATE_FILENAME);
  if (!pathIsInside(context.runDir, storageStatePath)) {
    throw new Error("Refusing to use a dashboard storage state outside the test-run directory");
  }
  return storageStatePath;
}

interface DashboardStorageState {
  cookies: unknown[];
  origins?: unknown[];
}

export function normalizeDashboardStorageState(
  context: Pick<TestRunContext, "ports" | "project">,
  storageState: DashboardStorageState,
): DashboardStorageState {
  const localStorage = [{ name: DASHBOARD_GLOBAL_PROJECT_STORAGE_KEY, value: context.project }];
  return {
    cookies: storageState.cookies,
    origins: ["127.0.0.1", "localhost"].map((host) => ({
      origin: `http://${host}:${context.ports.dashboard}`,
      localStorage,
    })),
  };
}

export function writeDashboardStorageState(
  context: TestRunContext,
  storageState: unknown,
  exclusive = false,
): string {
  const storageStatePath = getDashboardStorageStatePath(context);
  if (realpathSync(context.homeDir) !== resolve(context.homeDir)) {
    throw new Error("Refusing to use a symlinked test-run home for browser storage");
  }
  if (lstatSync(storageStatePath, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error("Refusing to use a symlinked dashboard storage state");
  }

  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC
    | (exclusive ? constants.O_EXCL : 0) | (constants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(storageStatePath, flags, TOKEN_MODE);
  try {
    writeSync(descriptor, `${JSON.stringify(storageState)}\n`, undefined, "utf8");
    fchmodSync(descriptor, TOKEN_MODE);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  return storageStatePath;
}
