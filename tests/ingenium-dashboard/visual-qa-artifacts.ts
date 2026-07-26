import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { getCanonicalRepoRoot } from "../test-run-context";

function pathIsInside(parent: string, child: string): boolean {
  const fromParent = relative(resolve(parent), resolve(child));
  return fromParent === "" || (!fromParent.startsWith("..") && !isAbsolute(fromParent));
}

function assertNoSymlinkAncestors(path: string, containmentRoot: string): void {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(containmentRoot);
  if (!pathIsInside(resolvedRoot, resolvedPath)) {
    throw new Error(`Visual-QA artifact path escaped the canonical repository root: ${path}`);
  }

  let cursor = resolvedPath;
  while (true) {
    try {
      const metadata = lstatSync(cursor);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Visual-QA artifact path has a symlinked ancestor: ${path}`);
      }
      if (cursor === resolvedRoot) return;
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    } catch (error) {
      if (error instanceof Error && error.message.includes("symlinked ancestor")) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`Visual-QA artifact path cannot be inspected safely: ${path}`);
      }
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  throw new Error(`Visual-QA artifact path has no canonical repository ancestor: ${path}`);
}

function assertCanonicalArtifactPath(
  path: string,
  containmentRoot: string,
  name: string,
  mustExist: boolean,
): void {
  const resolvedPath = resolve(path);
  if (!pathIsInside(containmentRoot, resolvedPath)) {
    throw new Error(`Visual-QA ${name} escaped its canonical containment root: ${path}`);
  }

  // Check every existing component before realpath and mkdir. This catches a
  // symlink in a parent even when the final directory has not been created.
  assertNoSymlinkAncestors(resolvedPath, containmentRoot);

  try {
    const canonicalPath = realpathSync(resolvedPath);
    if (canonicalPath !== resolvedPath || !pathIsInside(containmentRoot, canonicalPath)) {
      throw new Error(`Visual-QA ${name} is not a canonical path: ${path}`);
    }
    if (!lstatSync(resolvedPath).isDirectory()) {
      throw new Error(`Visual-QA ${name} is not a directory: ${path}`);
    }
  } catch (error) {
    if (error instanceof Error && /canonical path|not a directory/.test(error.message)) throw error;
    if (!mustExist && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error(`Visual-QA ${name} cannot be validated as a canonical directory: ${path}`);
  }
}

function ensureCanonicalArtifactDirectory(
  directory: string,
  containmentRoot: string,
  name: string,
): void {
  // Validate an existing root/run directory with realpath before mkdir, or
  // validate its canonical existing ancestors when it is not present yet.
  assertCanonicalArtifactPath(directory, containmentRoot, name, false);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // A post-mkdir check closes the normal symlink/escape path and prevents a
  // caller from receiving a directory whose physical location is elsewhere.
  assertCanonicalArtifactPath(directory, containmentRoot, name, true);
}

function safeComponent(value: string, name: string): string {
  if (value === "." || value === "..") {
    throw new Error(`Visual-QA ${name} must not be a dot path component`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`Visual-QA ${name} must be a single lexical path component`);
  }
  return value;
}

/**
 * Resolve and validate the repository root before creating artifacts. A
 * caller-provided path must be absolute, canonical, and identify this repo;
 * silently resolving an arbitrary path would make screenshots escape the
 * repository's run-scoped artifact tree.
 */
export function resolvePlaywrightRepoRoot(input = process.env.INGENIUM_PLAYWRIGHT_REPO_ROOT): string {
  const candidate = input === undefined ? process.cwd() : input;
  if (!isAbsolute(candidate) || candidate.length === 0 || /[\u0000-\u001f\u007f]/.test(candidate)) {
    throw new Error("INGENIUM_PLAYWRIGHT_REPO_ROOT must be an absolute path without control characters");
  }
  if (candidate !== resolve(candidate)) {
    throw new Error(`Playwright repository root must use a canonical lexical path: ${candidate}`);
  }
  try {
    return getCanonicalRepoRoot(candidate);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Playwright repository root is not the canonical git worktree root: ${reason}`);
  }
}

/**
 * Allocate an isolated visual-QA directory for one spec process.
 *
 * The optional run ID is useful in CI when a runner already has one. The UUID
 * fallback prevents screenshots from separate mail/manual processes from
 * overwriting one another.
 */
export function visualQaArtifactDirectory(scope: string): string {
  const configuredRunId = (
    process.env.INGENIUM_VISUAL_QA_RUN_ID
    ?? process.env.INGENIUM_TEST_RUN_NONCE
  )?.trim();
  const runId = configuredRunId === undefined || configuredRunId === ""
    ? `run-${randomUUID()}`
    : safeComponent(configuredRunId, "run id");
  const safeScope = safeComponent(scope, "scope");
  const repoRoot = resolvePlaywrightRepoRoot();
  const visualQaRoot = join(repoRoot, "tests", "artifacts", "visual-qa");
  ensureCanonicalArtifactDirectory(visualQaRoot, repoRoot, "visual-QA root");

  const runDirectory = join(visualQaRoot, runId);
  ensureCanonicalArtifactDirectory(runDirectory, visualQaRoot, "run directory");

  const directory = join(runDirectory, safeScope);
  ensureCanonicalArtifactDirectory(directory, runDirectory, "scope directory");
  return directory;
}

/**
 * Allocate a run-scoped directory for operator/manual captures. Manual
 * evidence is kept separate from automated visual-QA output so a one-off
 * screenshot cannot overwrite a test run or be mistaken for a gate result.
 */
export function manualArtifactDirectory(scope?: string): string {
  const configuredRunId = (
    process.env.INGENIUM_MANUAL_SCREENSHOT_RUN_ID
    ?? process.env.INGENIUM_VISUAL_QA_RUN_ID
    ?? process.env.INGENIUM_TEST_RUN_NONCE
  )?.trim();
  const runId = configuredRunId === undefined || configuredRunId === ""
    ? `manual-${new Date().toISOString().replace(/[.:]/g, "-")}-${randomUUID()}`
    : safeComponent(configuredRunId, "manual run id");
  const safeScope = scope === undefined ? undefined : safeComponent(scope, "scope");
  const repoRoot = resolvePlaywrightRepoRoot();
  const manualRoot = join(repoRoot, "tests", "artifacts", "manual");
  ensureCanonicalArtifactDirectory(manualRoot, repoRoot, "manual artifact root");

  const runDirectory = join(manualRoot, runId);
  ensureCanonicalArtifactDirectory(runDirectory, manualRoot, "manual run directory");
  if (safeScope === undefined) return runDirectory;

  const directory = join(runDirectory, safeScope);
  ensureCanonicalArtifactDirectory(directory, runDirectory, "manual scope directory");
  return directory;
}

export const manualScreenshotArtifactDirectory = manualArtifactDirectory;
