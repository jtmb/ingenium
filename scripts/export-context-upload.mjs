#!/usr/bin/env node

/**
 * Create one complete OpenCode export that is safe for context_upload_file.
 * Export stdout is written directly to a private file descriptor so large
 * exports never pass through a process buffer or command-substitution result.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";

const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
const MAX_STDERR_BYTES = 8 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 50;
const MAX_TIMEOUT_MS = 5 * 60_000;
const PROCESS_GROUP_KILL_GRACE_MS = 250;
// Session IDs stay single safe CLI arguments while retaining OpenCode's
// punctuation; the allowlist excludes path separators and control bytes.
const SESSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
// Limit output to one JSON filename so it stays under the prepared upload path.
const OUTPUT_BASENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;
// Control bytes are unsafe in process arguments and filesystem names.
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

class ExportError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new ExportError(code);
}

function usage() {
  process.stderr.write(
    "Usage: export-context-upload.mjs --session <safe-session-id> --worktree <canonical-absolute-worktree> --output <safe-output.json> [--timeout-ms <50-300000>]\n",
  );
}

function parseArguments(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help") {
      usage();
      process.exit(0);
    }
    if (typeof flag !== "string" || !flag.startsWith("--") || options.has(flag)) fail("INVALID_ARGUMENTS");
    const value = argv[index + 1];
    if (typeof value !== "string" || value.startsWith("--")) fail("INVALID_ARGUMENTS");
    options.set(flag, value);
    index += 1;
  }

  const allowed = new Set(["--session", "--worktree", "--output", "--timeout-ms"]);
  if ([...options.keys()].some((flag) => !allowed.has(flag))) fail("INVALID_ARGUMENTS");

  const session = options.get("--session");
  const worktree = options.get("--worktree");
  const output = options.get("--output");
  if (session === undefined || worktree === undefined || output === undefined) fail("INVALID_ARGUMENTS");

  const timeoutValue = options.get("--timeout-ms");
  const timeoutMs = timeoutValue === undefined ? DEFAULT_TIMEOUT_MS : Number(timeoutValue);
  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    fail("INVALID_ARGUMENTS");
  }

  return { session, worktree, output, timeoutMs };
}

function currentUid() {
  return process.platform !== "win32" && typeof process.getuid === "function" ? process.getuid() : null;
}

function belongsToCurrentUser(stat) {
  const uid = currentUid();
  return uid === null || stat.uid === uid;
}

function isPrivateDirectory(stat) {
  return stat.isDirectory() && belongsToCurrentUser(stat) && (stat.mode & 0o022) === 0;
}

function isPrivateOutputFile(stat) {
  return stat.isFile()
    && stat.nlink === 1
    && belongsToCurrentUser(stat)
    && (stat.mode & 0o777) === 0o600;
}

function canonicalWorktree(value) {
  if (
    !isAbsolute(value)
    || value !== resolve(value)
    || CONTROL_CHARACTER_PATTERN.test(value)
    || value.includes("\\")
  ) {
    fail("INVALID_WORKTREE");
  }

  try {
    const stat = lstatSync(value);
    if (!isPrivateDirectory(stat) || stat.isSymbolicLink() || realpathSync(value) !== value) {
      fail("INVALID_WORKTREE");
    }
  } catch (error) {
    if (error instanceof ExportError) throw error;
    fail("INVALID_WORKTREE");
  }
  return value;
}

function safeSession(value) {
  if (
    value.length === 0
    || value.length > 128
    || value !== value.trim()
    || !SESSION_PATTERN.test(value)
    || value === "."
    || value === ".."
  ) {
    fail("INVALID_SESSION");
  }
  return value;
}

function safeOutputBasename(value) {
  if (
    value.length === 0
    || value.length > 255
    || value !== basename(value)
    || value.includes(sep)
    || value.includes("\\")
    || CONTROL_CHARACTER_PATTERN.test(value)
    || !OUTPUT_BASENAME_PATTERN.test(value)
  ) {
    fail("INVALID_OUTPUT");
  }
  return value;
}

function noFollowDirectoryFlags() {
  if (!constants.O_NOFOLLOW || !constants.O_DIRECTORY) fail("UNSUPPORTED_PLATFORM");
  return constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY;
}

function ensurePrivateDirectory(path, exactMode) {
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "EEXIST") {
      fail("OUTPUT_DIRECTORY_UNAVAILABLE");
    }
  }

  let descriptor;
  try {
    descriptor = openSync(path, noFollowDirectoryFlags());
    const before = fstatSync(descriptor);
    if (!isPrivateDirectory(before)) fail("OUTPUT_DIRECTORY_UNAVAILABLE");
    if (exactMode !== undefined) fchmodSync(descriptor, exactMode);
    const after = fstatSync(descriptor);
    if (!isPrivateDirectory(after) || (exactMode !== undefined && (after.mode & 0o777) !== exactMode)) {
      fail("OUTPUT_DIRECTORY_UNAVAILABLE");
    }
  } catch (error) {
    if (error instanceof ExportError) throw error;
    fail("OUTPUT_DIRECTORY_UNAVAILABLE");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function prepareUploadDirectory(worktree) {
  const ingeniumDirectory = join(worktree, ".ingenium");
  ensurePrivateDirectory(ingeniumDirectory);
  const uploadDirectory = join(ingeniumDirectory, "context-uploads");
  ensurePrivateDirectory(uploadDirectory, 0o700);
  return uploadDirectory;
}

function sameIdentity(stat, owned) {
  return stat.dev === owned.dev && stat.ino === owned.ino;
}

function createOwnedOutputFile(path) {
  let descriptor;
  let identity;
  try {
    descriptor = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || !belongsToCurrentUser(opened)) fail("OUTPUT_FILE_UNAVAILABLE");
    identity = { dev: opened.dev, ino: opened.ino };
    fchmodSync(descriptor, 0o600);
    if (!isPrivateOutputFile(fstatSync(descriptor))) fail("OUTPUT_FILE_UNAVAILABLE");
    return { path, descriptor, identity };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (identity !== undefined) removeOwnedFile({ path, identity });
    if (error instanceof ExportError) throw error;
    fail("OUTPUT_FILE_UNAVAILABLE");
  }
}

function closeOwnedDescriptor(owned) {
  if (owned.descriptor === undefined) return;
  try {
    fsyncSync(owned.descriptor);
  } catch {
    throw new ExportError("OUTPUT_SYNC_FAILED");
  } finally {
    closeSync(owned.descriptor);
    owned.descriptor = undefined;
  }
}

function removeOwnedFile(owned) {
  try {
    const stat = lstatSync(owned.path);
    if (isPrivateOutputFile(stat) && sameIdentity(stat, owned.identity)) unlinkSync(owned.path);
  } catch {
    // The file was never created, is already gone, or is no longer the owned inode.
  }
}

function terminateProcessGroup(child, signal) {
  if (child.pid === undefined) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through to the direct child if its process group has already exited.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The child has already exited.
  }
}

function runExport(worktree, session, descriptor, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("opencode", ["export", session], {
        cwd: worktree,
        // POSIX descendants share a group so timeout cleanup reaches helpers;
        // Windows falls back to terminating the direct child.
        detached: process.platform !== "win32",
        // Keep session arguments literal and stream stdout to the validated file.
        shell: false,
        stdio: ["ignore", descriptor, "pipe"],
        // This non-interactive helper must not open a console window on Windows.
        windowsHide: true,
      });
    } catch {
      resolve({ code: null, signal: null, spawned: false, timedOut: false });
      return;
    }

    let settled = false;
    let timedOut = false;
    let stderrBytes = 0;
    let forceKillTimer;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      // Stop the group first, then force-kill after a short grace period so a
      // stuck exporter or descendant cannot keep writing after the timeout.
      terminateProcessGroup(child, "SIGTERM");
      forceKillTimer = setTimeout(() => terminateProcessGroup(child, "SIGKILL"), PROCESS_GROUP_KILL_GRACE_MS);
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(chunk);
      stderrBytes = Math.min(MAX_STDERR_BYTES, stderrBytes + bytes);
    });
    child.once("error", () => settle({ code: null, signal: null, spawned: false, timedOut }));
    child.once("close", (code, signal) => settle({ code, signal, spawned: true, timedOut }));
  });
}

function validateCompleteExport(owned) {
  let descriptor;
  try {
    const before = lstatSync(owned.path);
    if (!isPrivateOutputFile(before) || !sameIdentity(before, owned.identity)) fail("INVALID_EXPORT");
    if (before.size > MAX_EXPORT_BYTES) fail("EXPORT_TOO_LARGE");

    descriptor = openSync(owned.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (!isPrivateOutputFile(opened) || !sameIdentity(opened, owned.identity) || opened.size > MAX_EXPORT_BYTES) {
      fail("INVALID_EXPORT");
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (
      !isPrivateOutputFile(after)
      || !sameIdentity(after, owned.identity)
      || after.size !== opened.size
      || bytes.byteLength !== opened.size
    ) {
      fail("INVALID_EXPORT");
    }

    let parsed;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      parsed = JSON.parse(text);
    } catch {
      fail("INVALID_EXPORT");
    }
    if (
      typeof parsed !== "object"
      || parsed === null
      || Array.isArray(parsed)
      || typeof parsed.info !== "object"
      || parsed.info === null
      || Array.isArray(parsed.info)
      || !Array.isArray(parsed.messages)
    ) {
      fail("INVALID_EXPORT");
    }

    return {
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    if (error instanceof ExportError) throw error;
    fail("INVALID_EXPORT");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

async function main() {
  const startedAt = performance.now();
  let owned;
  try {
    const arguments_ = parseArguments(process.argv.slice(2));
    const session = safeSession(arguments_.session);
    const worktree = canonicalWorktree(arguments_.worktree);
    const outputBasename = safeOutputBasename(arguments_.output);
    const outputPath = join(prepareUploadDirectory(worktree), outputBasename);
    owned = createOwnedOutputFile(outputPath);

    const result = await runExport(worktree, session, owned.descriptor, arguments_.timeoutMs);
    closeOwnedDescriptor(owned);
    if (!result.spawned || result.timedOut || result.code !== 0 || result.signal !== null) fail("EXPORT_FAILED");

    const verified = validateCompleteExport(owned);
    process.stdout.write(`${JSON.stringify({
      path: owned.path,
      sha256: verified.sha256,
      bytes: verified.bytes,
      elapsedMs: Math.round(performance.now() - startedAt),
    })}\n`);
  } catch (error) {
    if (owned !== undefined) {
      try {
        closeOwnedDescriptor(owned);
      } catch {
        // Cleanup still proceeds when descriptor synchronization fails.
      }
      removeOwnedFile(owned);
    }
    const code = error instanceof ExportError ? error.code : "EXPORT_FAILED";
    process.stderr.write(`context export failed: ${code}\n`);
    process.exitCode = 1;
  }
}

await main();
