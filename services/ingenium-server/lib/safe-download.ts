import { constants, lstatSync, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const WORKSPACE_ROOT = "/workspace";
const HOME_ROOT = process.env.HOME ?? "/home/appuser";
const FORBIDDEN_PREFIXES = ["/etc", "/root", "/proc", "/sys", "/dev", "/tmp"];
const DEFAULT_ALLOWED_ROOTS = [WORKSPACE_ROOT, HOME_ROOT];

export interface SafeDownloadOptions {
  /** Isolated tests may provide a temporary writable root. */
  allowedRoots?: readonly string[];
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function allowedRootFor(destination: string, options: SafeDownloadOptions): string | undefined {
  const roots = (options.allowedRoots ?? DEFAULT_ALLOWED_ROOTS)
    .map((root) => path.resolve(root))
    .sort((left, right) => right.length - left.length);
  return roots.find((root) => isWithinRoot(root, destination));
}

function assertSafeExistingPath(root: string, destination: string): void {
  const relative = path.relative(root, destination);
  const components = relative ? relative.split(path.sep) : [];
  let current = root;

  for (const component of [undefined, ...components]) {
    if (component) current = path.join(current, component);
    let metadata;
    try {
      metadata = lstatSync(current);
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw error;
    }

    if (metadata.isSymbolicLink()) throw new Error(`Download path contains a symbolic link: ${current}`);
    if (current === destination) {
      if (!metadata.isFile()) throw new Error(`Download destination is not a regular file: ${destination}`);
      throw new Error(`Download destination already exists: ${destination}`);
    }
    if (!metadata.isDirectory()) throw new Error(`Download path ancestor is not a directory: ${current}`);
  }
}

function parentDirectories(root: string, destination: string): string[] {
  const parent = path.dirname(destination);
  const relative = path.relative(root, parent);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Download destination escapes permitted root: ${destination}`);
  }

  const directories = [root];
  let current = root;
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    directories.push(current);
  }
  return directories;
}

async function createSafeParentDirectories(root: string, destination: string): Promise<void> {
  for (const directory of parentDirectories(root, destination)) {
    try {
      lstatSync(directory);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      try {
        await fs.mkdir(directory);
      } catch (mkdirError) {
        if (!isMissingPathError(mkdirError) && !(typeof mkdirError === "object" && mkdirError !== null && "code" in mkdirError && mkdirError.code === "EEXIST")) {
          throw mkdirError;
        }
      }
    }

    const metadata = lstatSync(directory);
    if (metadata.isSymbolicLink()) throw new Error(`Download path contains a symbolic link: ${directory}`);
    if (!metadata.isDirectory()) throw new Error(`Download path ancestor is not a directory: ${directory}`);
  }

  // Recheck every existing component immediately before opening the final path.
  assertSafeExistingPath(root, destination);
}

async function createSafeDownloadFile(root: string, destination: string): Promise<FileHandle> {
  await createSafeParentDirectories(root, destination);
  const file = await fs.open(
    destination,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
  );
  try {
    if (!(await file.stat()).isFile()) throw new Error(`Download destination is not a regular file: ${destination}`);
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}

/** Resolve a destination that remains within the MCP process's writable roots. */
export function resolveSafeDownloadPath(outputPath: string, options: SafeDownloadOptions = {}): string {
  const resolved = path.resolve(outputPath);
  const root = allowedRootFor(resolved, options);
  if (!root) {
    throw new Error(`Path "${outputPath}" resolves to "${resolved}" — must be within ${WORKSPACE_ROOT} or ${HOME_ROOT}`);
  }
  if (!options.allowedRoots) {
    const forbidden = FORBIDDEN_PREFIXES.find((prefix) => resolved === prefix || resolved.startsWith(`${prefix}/`));
    if (forbidden) throw new Error(`Path "${outputPath}" resolves to a forbidden location (${forbidden})`);
  }
  assertSafeExistingPath(root, resolved);
  return resolved;
}

/** Stream a successful binary API response to a previously validated destination. */
export async function streamDownloadResponse(response: Response, destination: string, options: SafeDownloadOptions = {}): Promise<{
  mimeType: string;
  size: number;
}> {
  const safeDestination = resolveSafeDownloadPath(destination, options);
  const root = allowedRootFor(safeDestination, options);
  if (!root) throw new Error(`Download destination escapes permitted roots: ${safeDestination}`);

  const file = await createSafeDownloadFile(root, safeDestination);
  if (response.body) {
    const stream = file.createWriteStream();
    await pipeline(response.body, stream);
    return {
      mimeType: response.headers.get("content-type") ?? "application/octet-stream",
      size: stream.bytesWritten,
    };
  }
  try {
    await file.writeFile(Buffer.from(await response.arrayBuffer()));
    const { size } = await file.stat();
    return { mimeType: response.headers.get("content-type") ?? "application/octet-stream", size };
  } finally {
    await file.close();
  }
}
