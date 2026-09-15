#!/usr/bin/env node

/**
 * Raw CLI/stdin input stays in bounded memory; only redacted visible text reaches disk.
 * Final mode additionally verifies the caller's explicit frozen snapshot boundary.
 */
import { spawn } from "node:child_process";
import { completedAssistant, visibleContextExport } from "../packages/ingenium-extension/context-upload-codec.mjs";
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
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";

const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
// Diagnostic parts can exceed the importer limit before visible-text filtering.
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
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
    "Usage: export-context-upload.mjs --session <safe-session-id> --worktree <canonical-absolute-worktree> --output <safe-output.json> [--input -] [--timeout-ms <50-300000>] [--mode final --project-id <OpenCode-project-id> --cutoff-ms <frozen-epoch-ms> --cutoff-message <last-source-message-id> --expected-messages <source-count>]\n",
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

  const finalFlags = ["--project-id", "--cutoff-ms", "--cutoff-message", "--expected-messages"];
  const allowed = new Set(["--session", "--worktree", "--output", "--timeout-ms", "--input", "--mode", ...finalFlags]);
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

  const input = options.get("--input");
  const mode = options.get("--mode") ?? "incremental";
  if ((input !== undefined && input !== "-") || !["incremental", "final"].includes(mode)) fail("INVALID_ARGUMENTS");
  let frozen;
  if (mode === "final") {
    if (finalFlags.some((flag) => !options.has(flag))) fail("INVALID_ARGUMENTS");
    const cutoffMs = Number(options.get("--cutoff-ms"));
    const expectedMessages = Number(options.get("--expected-messages"));
    if (!Number.isSafeInteger(cutoffMs) || cutoffMs <= 0 || cutoffMs > Date.now()
      || !Number.isSafeInteger(expectedMessages) || expectedMessages <= 0) fail("INVALID_ARGUMENTS");
    frozen = { projectId: safeSession(options.get("--project-id")), cutoffMs,
      cutoffMessage: safeSession(options.get("--cutoff-message")), expectedMessages };
  } else if (finalFlags.some((flag) => options.has(flag))) fail("INVALID_ARGUMENTS");

  return { session, worktree, output, timeoutMs, input, frozen };
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

function runExport(worktree, session, timeoutMs, input) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      if (input !== "-") child = spawn("opencode", ["export", session, "--pure"], {
        cwd: worktree,
        // POSIX descendants share a group so timeout cleanup reaches helpers;
        // Windows falls back to terminating the direct child.
        detached: process.platform !== "win32",
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
        // This non-interactive helper must not open a console window on Windows.
        windowsHide: true,
      });
    } catch {
      reject(new ExportError("EXPORT_FAILED"));
      return;
    }

    const stream = child?.stdout ?? process.stdin;
    let settled = false;
    let failure;
    let eof = false;
    let size = 0;
    const chunks = [];
    let forceKillTimer;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      if (failure) reject(new ExportError(failure));
      else resolve(Buffer.concat(chunks, size));
      chunks.length = 0;
    };
    const abort = (code, graceMs = 0) => {
      if (settled || failure) return;
      failure = code;
      chunks.length = 0;
      if (child) terminateProcessGroup(child, graceMs ? "SIGTERM" : "SIGKILL");
      const finish = () => {
        if (child) terminateProcessGroup(child, "SIGKILL");
        stream.destroy();
        settle();
      };
      if (graceMs) forceKillTimer = setTimeout(finish, graceMs);
      else finish();
    };
    const timeout = setTimeout(() => {
      abort("EXPORT_TIMEOUT", PROCESS_GROUP_KILL_GRACE_MS);
    }, timeoutMs);

    stream.on("data", (chunk) => {
      if (settled || failure) return;
      size += chunk.length;
      if (size > MAX_SOURCE_BYTES) abort("EXPORT_TOO_LARGE");
      else chunks.push(chunk);
    });
    stream.once("error", () => abort("EXPORT_FAILED"));
    stream.once("end", () => {
      eof = true;
      if (!child && !failure) settle();
    });
    stream.once("close", () => { if (!eof) abort("EXPORT_INCOMPLETE"); });
    child?.once("error", () => abort("EXPORT_FAILED"));
    child?.once("close", (code, signal) => {
      if (failure) return;
      if (code !== 0 || signal !== null) abort("EXPORT_FAILED");
      else if (!eof) abort("EXPORT_INCOMPLETE");
      else settle();
    });
  });
}

function validateFrozenExport(value, session, worktree, frozen) {
  const info = value?.info;
  if (info?.id !== session || info.directory !== worktree || info.projectID !== frozen.projectId) {
    fail("FINAL_EXPORT_BINDING_MISMATCH");
  }
  const beforeCutoff = (time) => Number.isSafeInteger(time) && time >= 0 && time <= frozen.cutoffMs;
  if (!beforeCutoff(info.time?.created) || !beforeCutoff(info.time?.updated)
    || info.time.updated < info.time.created || !Array.isArray(value.messages)
    || value.messages.length !== frozen.expectedMessages
    || value.messages.at(-1)?.info?.id !== frozen.cutoffMessage) fail("FINAL_EXPORT_CUTOFF_MISMATCH");

  const ids = new Set();
  for (const message of value.messages) {
    const info = message?.info;
    if (!info || info.sessionID !== session || typeof info.id !== "string"
      || !SESSION_PATTERN.test(info.id) || info.id.length > 128 || ids.has(info.id)) {
      fail("FINAL_EXPORT_BINDING_MISMATCH");
    }
    ids.add(info.id);
    if (!["user", "assistant"].includes(info.role) || !beforeCutoff(info.time?.created)
      || !Array.isArray(message.parts)) fail("FINAL_EXPORT_INCOMPLETE");
    if (info.role === "assistant" && (!completedAssistant(info) || !beforeCutoff(info.time.completed)
      || info.time.completed < info.time.created)) fail("FINAL_EXPORT_INCOMPLETE");
    for (const part of message.parts) {
      if (!part || typeof part !== "object" || Array.isArray(part) || typeof part.type !== "string"
        || (part.sessionID !== undefined && part.sessionID !== session)
        || (part.messageID !== undefined && part.messageID !== info.id)) fail("FINAL_EXPORT_INCOMPLETE");
      if (part.type === "text" && (typeof part.text !== "string" || (part.time !== undefined
        && (!beforeCutoff(part.time?.start) || !beforeCutoff(part.time?.end)
          || part.time.end < part.time.start)))) fail("FINAL_EXPORT_INCOMPLETE");
      if (part.type === "tool" && (!["completed", "error"].includes(part.state?.status)
        || !beforeCutoff(part.state.time?.start) || !beforeCutoff(part.state.time?.end)
        || part.state.time.end < part.state.time.start)) fail("FINAL_EXPORT_INCOMPLETE");
    }
  }
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

    let source = await runExport(worktree, session, arguments_.timeoutMs, arguments_.input);
    const sourceBytes = source.byteLength;
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source));
    } catch { fail("INVALID_EXPORT"); }
    source = undefined;
    if (arguments_.frozen) validateFrozenExport(parsed, session, worktree, arguments_.frozen);
    let visible;
    try {
      visible = visibleContextExport(parsed, session, worktree);
    } catch { fail("INVALID_EXPORT"); }
    let final;
    if (arguments_.frozen) {
      const last = visible.messages.at(-1)?.info;
      if (last?.id !== arguments_.frozen.cutoffMessage || last.role !== "assistant") fail("FINAL_EXPORT_INCOMPLETE");
      delete visible.info.contextUploadAutomatic;
      final = { projectId: arguments_.frozen.projectId, session, worktree,
        cutoffMs: arguments_.frozen.cutoffMs, cutoffMessage: arguments_.frozen.cutoffMessage,
        sourceBytes, sourceMessageCount: parsed.messages.length, visibleMessageCount: visible.messages.length,
        excludedMessageCount: parsed.messages.length - visible.messages.length, complete: true };
    }
    parsed = undefined;
    const output = JSON.stringify(visible);
    if (Buffer.byteLength(output) > MAX_EXPORT_BYTES) fail("EXPORT_TOO_LARGE");
    writeFileSync(owned.descriptor, output);
    closeOwnedDescriptor(owned);

    const verified = validateCompleteExport(owned);
    if (verified.sha256 !== createHash("sha256").update(output).digest("hex")) fail("INVALID_EXPORT");
    process.stdout.write(`${JSON.stringify({
      path: owned.path,
      sha256: verified.sha256,
      bytes: verified.bytes,
      elapsedMs: Math.round(performance.now() - startedAt),
      ...(final ? { final } : {}),
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
