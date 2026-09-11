#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BUILD_TIMEOUT_MS = 300_000;
const CLEANUP_GRACE_MS = 5_000;
const GENERATED_TIMEOUT_GRACE_MS = 30_000;
const MAX_TIMER_MS = 2_147_483_647;
const CHILD_NONCE = "INGENIUM_RECOVERY_SHIM_CHILD_NONCE";
const CANONICAL_WORKTREE = "INGENIUM_RECOVERY_CANONICAL_WORKTREE";
const GENERATED_BOOTSTRAP_SHA256 = "INGENIUM_RECOVERY_GENERATED_BOOTSTRAP_SHA256";
const RECOVERY_ATTESTED_CONTEXT = "INGENIUM_RECOVERY_ATTESTED_CONTEXT";
const ADMITTED_RECOVERY_CONTEXT = "INGENIUM_ADMITTED_RECOVERY_CONTEXT";
const GIT = "/usr/bin/git";
export const CANONICAL_DIRECTORY_AUDIT_PATH = `/tmp/opencode-${ownerUid()}/recovery-bootstrap-directory-audit.jsonl`;
export const CANONICAL_DIRECTORY_ROLES = Object.freeze([
  "repository_root",
  "packages_root",
  "extension_root",
  "scripts_root",
]);
const CHECKPOINT_PATHS = [
  "opencode.json",
  "package.json",
  "package-lock.json",
  "tsconfig.base.json",
  ".opencode/agents/execution/ingenium-recovery-engineer.md",
  ".opencode/agents/primary/ingenium-orchestrator.md",
  "packages/ingenium-extension",
  "services/ingenium-server",
  "tests/test-agent-validation.sh",
];
const COMMON_ENVIRONMENT = ["CI", "FORCE_COLOR", "HOME", "NO_COLOR", "TERM", "TMPDIR"];
const BUILD_ENVIRONMENT = ["CI", "FORCE_COLOR", "NO_COLOR", "TERM", "TMPDIR"];
const EXECUTABLE_GIT_CONFIGURATION = /^(?:core\.(?:askPass|editor|fsmonitor|gitproxy|hooksPath|pager|sshCommand)|credential\..*helper|diff(?:\.external|\..*\.(?:command|textconv))|filter\..*\.(?:clean|process|smudge)|gpg(?:\..*)?\.program|interactive\.diffFilter|merge\..*\.driver|sequence\.editor)$/i;
const RECOVERY_ENVIRONMENT = [
  ...COMMON_ENVIRONMENT,
  "INGENIUM_API_URL",
  "INGENIUM_MCP_AUDIENCE",
  "INGENIUM_MCP_CREDENTIAL_FILE",
  "INGENIUM_MCP_CREDENTIAL_PURPOSE",
  "INGENIUM_PROJECT",
  "INGENIUM_PROJECT_ID",
  "INGENIUM_RECOVERY_OWNER_NONCE",
  "INGENIUM_RECOVERY_OWNER_PID",
  "INGENIUM_RECOVERY_OWNER_START_TICKS",
  ADMITTED_RECOVERY_CONTEXT,
  "INGENIUM_STORAGE_MAPPING_HASH",
  "INGENIUM_WORKSPACE_ID",
  "INGENIUM_WORKTREE",
];
const SIGNALS = ["SIGHUP", "SIGINT", "SIGTERM"];
const HASH = /^[0-9a-f]{64}$/;
const GIT_OID = /^[0-9a-f]{40,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_PROJECT = /^(?!\.{1,2}$)[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SAFE_SESSION = /^[A-Za-z0-9_-]{1,256}$/;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
const API_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const RECOVERY_SOURCE_MAX_BYTES = 256 * 1024;
const RECOVERY_ADMISSION_MAX_BYTES = 16 * 1024;
const RECOVERY_ADMISSION_LIFETIME_MS = 15 * 60 * 1_000;
const SERVER_ADMISSION_KEYS = [
  "schema", "version", "action", "preflightDigest", "head", "parent", "project", "projectId",
  "worktreeId", "workspace", "storage", "worktree", "issuedAt", "expiresAt", "revision", "fence",
];
const SERVER_RECEIPT_KEYS = ["id", "schema", "version", "action", "admissionDigest", "consumedAt"];
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const LEGACY_DISPOSITION_KEY = "196a4bf40b3672e0245a6a39fabeddcefb155b56fe264dc3b29b355f6258b1e2";
const LEGACY_DISPOSITION_OPERATION_ID = "e3b31090e32ac32474f150958ecd2c2cedff8a92f3ddcad03b9a9acb108e68fc";
const LEGACY_DISPOSITION_RECORD_SHA256 = "b00ae79c982e8e3948e1ee421ef09ac12e2a7b71e83f49ac4381b56a306e0a3c";
export const RECOVERY_ADMISSION_RELATIVE_PATH = "tests/artifacts/tui-recovery/production-restart-admission.json";

function parsedAttestedContext(value) {
  if (value === undefined) return null;
  let context;
  try { context = JSON.parse(value); } catch { throw new Error("Recovery bootstrap attested context is invalid"); }
  if (!hasExactKeys(context, ["schemaVersion", "kind", "sourcePath", "repositoryRoot", "head", "sourceSha256"])
    || context.schemaVersion !== 1 || context.kind !== "source-bootstrap"
    || resolve(context.sourcePath ?? "") !== context.sourcePath
    || resolve(context.repositoryRoot ?? "") !== context.repositoryRoot
    || !GIT_OID.test(context.head ?? "") || !HASH.test(context.sourceSha256 ?? "")
    || context.sourcePath !== resolve(context.repositoryRoot, "packages/ingenium-extension/scripts/recovery-bootstrap.js")) {
    throw new Error("Recovery bootstrap attested context is invalid");
  }
  return Object.freeze({ ...context });
}

const MODULE_ATTESTATION = parsedAttestedContext(process.env[RECOVERY_ATTESTED_CONTEXT]);
delete process.env[RECOVERY_ATTESTED_CONTEXT];

export const CANONICAL_OWNED_DIRECTORY_FAILURE_REASONS = Object.freeze([
  "directory",
  "canonical",
  "owner",
  "writable",
]);

export class CanonicalOwnedDirectoryError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "CanonicalOwnedDirectoryError";
    this.code = "CANONICAL_OWNED_DIRECTORY_INVALID";
    this.reason = reason;
  }
}

export const TRUSTED_REGULAR_FILE_FAILURE_REASONS = Object.freeze([
  "regular_file",
  "symlink",
  "link_count",
  "identity",
  "owner",
  "writable",
  "realpath",
  "executable",
  "mode",
]);

export class TrustedRegularFileError extends Error {
  constructor(label, reason) {
    super(`${label} failed trust validation: ${reason}`);
    this.name = "TrustedRegularFileError";
    this.code = "TRUSTED_REGULAR_FILE_INVALID";
    this.reason = reason;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function ownerUid() {
  if (process.platform !== "linux" || typeof process.getuid !== "function") {
    throw new Error("Recovery bootstrap shim requires Linux process identity support");
  }
  return process.getuid();
}

function directoryIdentityMatches(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function directoryMode(stat) {
  return stat.mode & 0o7777;
}

function auditMode(mode) {
  return mode === undefined ? null : mode.toString(8).padStart(4, "0");
}

export function canonicalOwnedDirectory(path, _label, owner = ownerUid(), options = {}) {
  const canonical = resolve(path);
  const fileSystem = {
    closeSync,
    fchmodSync,
    fstatSync,
    fsyncSync,
    lstatSync,
    openSync,
    realpathSync,
    ...options.fileSystem,
  };
  let audited = false;
  let beforeMode;
  let afterMode;
  let result = "rejected";
  const retainAudit = () => {
    if (!options.retainAudit || audited) return;
    audited = true;
    options.retainAudit({
      role: options.auditRole,
      directoryPathSha256: sha256(canonical),
      beforeMode: auditMode(beforeMode),
      afterMode: auditMode(afterMode),
      result,
      timestamp: new Date().toISOString(),
    });
  };
  const fail = (reason) => {
    retainAudit();
    throw new CanonicalOwnedDirectoryError(reason);
  };
  if (options.retainAudit && !CANONICAL_DIRECTORY_ROLES.includes(options.auditRole)) fail("canonical");
  let reference;
  try {
    reference = fileSystem.lstatSync(canonical);
  } catch {
    fail("directory");
  }
  if (!reference.isDirectory() && !reference.isSymbolicLink()) fail("directory");
  if (reference.isSymbolicLink()) fail("canonical");
  let real;
  try {
    real = fileSystem.realpathSync(canonical);
  } catch {
    fail("canonical");
  }
  if (real !== canonical) fail("canonical");
  let descriptor;
  try {
    try {
      descriptor = fileSystem.openSync(canonical, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    } catch {
      fail("canonical");
    }
    const opened = fileSystem.fstatSync(descriptor);
    const current = fileSystem.lstatSync(canonical);
    beforeMode = directoryMode(opened);
    afterMode = beforeMode;
    if (!opened.isDirectory() || !current.isDirectory()) fail("directory");
    if (current.isSymbolicLink() || !directoryIdentityMatches(reference, opened)
      || !directoryIdentityMatches(opened, current) || directoryMode(reference) !== beforeMode
      || directoryMode(current) !== beforeMode) fail("canonical");
    if (reference.uid !== owner || opened.uid !== owner || current.uid !== owner) fail("owner");
    try {
      if (fileSystem.realpathSync(canonical) !== canonical) fail("canonical");
    } catch (error) {
      if (error instanceof CanonicalOwnedDirectoryError) throw error;
      fail("canonical");
    }
    if ((beforeMode & 0o022) === 0) {
      result = "validated";
      retainAudit();
      return canonical;
    }
    if (options.hardenWritablePath !== canonical) fail("writable");

    const hardenedMode = beforeMode & ~0o022;
    try {
      options.afterOpen?.(canonical);
      fileSystem.fchmodSync(descriptor, hardenedMode);
      fileSystem.fsyncSync(descriptor);
      const hardened = fileSystem.fstatSync(descriptor);
      const hardenedPath = fileSystem.lstatSync(canonical);
      afterMode = directoryMode(hardened);
      if (!hardened.isDirectory() || !hardenedPath.isDirectory()) fail("directory");
      if (hardenedPath.isSymbolicLink() || !directoryIdentityMatches(opened, hardened)
        || !directoryIdentityMatches(opened, hardenedPath)) fail("canonical");
      if (hardened.uid !== owner || hardenedPath.uid !== owner) fail("owner");
      if (directoryMode(hardenedPath) !== afterMode || afterMode !== hardenedMode
        || (afterMode & 0o022) !== 0) fail("writable");
      if (fileSystem.realpathSync(canonical) !== canonical) fail("canonical");
    } catch (error) {
      if (error instanceof CanonicalOwnedDirectoryError) throw error;
      fail("writable");
    }
    result = "hardened";
    retainAudit();
    return canonical;
  } catch (error) {
    if (error instanceof CanonicalOwnedDirectoryError) throw error;
    fail("canonical");
  } finally {
    if (descriptor !== undefined) fileSystem.closeSync(descriptor);
  }
}

export function readTrustedRegularFile(path, label, options = {}) {
  const owner = options.expectedOwner ?? ownerUid();
  const requested = resolve(path);
  const fail = (reason) => { throw new TrustedRegularFileError(label, reason); };
  let reference;
  try {
    reference = lstatSync(requested);
  } catch {
    fail("regular_file");
  }
  if (!reference.isFile() && !reference.isSymbolicLink()) fail("regular_file");
  if (!options.allowReferenceSymlink && reference.isSymbolicLink()) fail("symlink");
  let canonical;
  try {
    canonical = realpathSync(requested);
  } catch {
    fail("realpath");
  }
  let descriptor;
  try {
    try {
      descriptor = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      fail("identity");
    }
    const opened = fstatSync(descriptor);
    const before = lstatSync(canonical);
    if (!opened.isFile() || (!before.isFile() && !before.isSymbolicLink())) fail("regular_file");
    if (before.isSymbolicLink()) fail("symlink");
    if (opened.nlink !== 1 || before.nlink !== 1) fail("link_count");
    if (opened.dev !== before.dev || opened.ino !== before.ino) fail("identity");
    if (opened.uid !== owner || before.uid !== owner) fail("owner");
    if ((opened.mode & 0o022) !== 0 || (before.mode & 0o022) !== 0) fail("writable");
    try {
      if (realpathSync(canonical) !== canonical || (!options.allowReferenceSymlink && canonical !== requested)) fail("realpath");
    } catch {
      fail("realpath");
    }
    if (options.executable && (opened.mode & 0o111) === 0) fail("executable");
    if (options.expectedMode !== undefined && (opened.mode & 0o777) !== options.expectedMode) fail("mode");
    options.afterOpen?.(canonical);
    const bytes = readFileSync(descriptor);
    const afterDescriptor = fstatSync(descriptor);
    const afterPath = lstatSync(canonical);
    if (!afterDescriptor.isFile() || (!afterPath.isFile() && !afterPath.isSymbolicLink())) fail("regular_file");
    if (afterPath.isSymbolicLink()) fail("symlink");
    if (afterDescriptor.nlink !== 1 || afterPath.nlink !== 1) fail("link_count");
    if (afterDescriptor.dev !== opened.dev || afterDescriptor.ino !== opened.ino || afterDescriptor.size !== opened.size
      || afterDescriptor.mtimeMs !== opened.mtimeMs || afterDescriptor.ctimeMs !== opened.ctimeMs
      || afterPath.dev !== opened.dev || afterPath.ino !== opened.ino) fail("identity");
    if (afterDescriptor.uid !== owner || afterPath.uid !== owner) fail("owner");
    if ((afterDescriptor.mode & 0o022) !== 0 || (afterPath.mode & 0o022) !== 0) fail("writable");
    try {
      if (realpathSync(canonical) !== canonical || (!options.allowReferenceSymlink && canonical !== requested)) fail("realpath");
    } catch {
      fail("realpath");
    }
    if (options.executable && (afterDescriptor.mode & 0o111) === 0) fail("executable");
    if (options.expectedMode !== undefined && (afterDescriptor.mode & 0o777) !== options.expectedMode) fail("mode");
    return { bytes, path: canonical, sha256: sha256(bytes) };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonicalValue(entry)]));
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function isCanonicalRfc3339(value) {
  if (typeof value !== "string") return false;
  const match = RFC3339.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, 0);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    && calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1
    && calendar.getUTCDate() === day && calendar.getUTCHours() === hour
    && calendar.getUTCMinutes() === minute && calendar.getUTCSeconds() === second;
}

export function recoveryPreflightOutput(preflight) {
  const digest = sha256(canonicalJson(preflight));
  return { digest, output: canonicalJson({ digest, preflight }) };
}

function readBoundedDescriptor(descriptor, maximumBytes, allowEmpty = false) {
  const buffer = Buffer.allocUnsafe(maximumBytes + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const count = readSync(descriptor, buffer, offset, buffer.length - offset, null);
    if (count === 0) break;
    offset += count;
  }
  if ((!allowEmpty && offset < 1) || offset > maximumBytes) throw new Error("Recovery preflight file is unavailable");
  return buffer.subarray(0, offset);
}

function readExactDescriptor(descriptor, size) {
  if (!Number.isSafeInteger(size) || size < 1 || size > RECOVERY_SOURCE_MAX_BYTES) {
    throw new Error("Recovery bootstrap source is unavailable");
  }
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
    if (count === 0) break;
    offset += count;
  }
  if (offset !== size) throw new Error("Recovery bootstrap source is unavailable");
  return bytes;
}

function sourceIdentityMatches(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
    && left.uid === right.uid && left.nlink === right.nlink;
}

export function openVerifiedRecoverySource(context = MODULE_ATTESTATION, options = {}) {
  if (!context) throw new Error("Recovery bootstrap requires attested stdin execution");
  const owner = ownerUid();
  const root = context.repositoryRoot;
  const path = context.sourcePath;
  if (realpathSync(root) !== root || realpathSync(path) !== path
    || resolve(root, "packages/ingenium-extension/scripts/recovery-bootstrap.js") !== path
    || gitConfiguration(root).some(isExecutableGitConfiguration)) {
    throw new Error("Recovery bootstrap source is unavailable");
  }
  const topLevel = git(root, ["rev-parse", "--show-toplevel"], "utf8").trim();
  const head = git(root, ["rev-parse", "--verify", "HEAD"], "utf8").trim();
  if (topLevel !== root || head !== context.head) throw new Error("Recovery bootstrap Git HEAD changed");
  const reviewed = Buffer.from(git(root, ["show", `${head}:packages/ingenium-extension/scripts/recovery-bootstrap.js`]));
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || opened.uid !== owner || (opened.mode & 0o777) !== 0o644
      || opened.size !== reviewed.length || opened.size > RECOVERY_SOURCE_MAX_BYTES) {
      throw new Error("Recovery bootstrap source is unavailable");
    }
    options.afterOpen?.(path);
    const bytes = readExactDescriptor(descriptor, opened.size);
    const after = fstatSync(descriptor);
    const current = lstatSync(path);
    if (!bytes.equals(reviewed) || sha256(bytes) !== context.sourceSha256 || !sourceIdentityMatches(opened, after)
      || !current.isFile() || current.isSymbolicLink() || !sourceIdentityMatches(opened, current)
      || realpathSync(path) !== path || (current.mode & 0o777) !== 0o644) throw new Error("Recovery bootstrap source changed during attestation");

    let closed = false;
    const revalidate = () => {
      if (closed) throw new Error("Recovery bootstrap source descriptor is closed");
      const currentHead = git(root, ["rev-parse", "--verify", "HEAD"], "utf8").trim();
      const currentBytes = readExactDescriptor(descriptor, opened.size);
      const currentDescriptor = fstatSync(descriptor);
      const currentPath = lstatSync(path);
      const currentReviewed = Buffer.from(git(root, ["show", `${currentHead}:packages/ingenium-extension/scripts/recovery-bootstrap.js`]));
      if (currentHead !== head || !sourceIdentityMatches(opened, currentDescriptor)
        || !currentPath.isFile() || currentPath.isSymbolicLink() || !sourceIdentityMatches(opened, currentPath)
        || realpathSync(path) !== path || !currentBytes.equals(bytes) || !currentBytes.equals(currentReviewed)) {
        throw new Error("Recovery bootstrap source or Git HEAD changed before admission");
      }
      return { head, bytes: currentBytes, path, sha256: context.sourceSha256 };
    };
    return {
      descriptor,
      source: Object.freeze({ head, bytes, path, sha256: context.sourceSha256 }),
      revalidate,
      close() {
        if (closed) return;
        closed = true;
        closeSync(descriptor);
      },
    };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

function readOnlyRegularFile(path, maximumBytes, allowEmpty = false, expectedMode) {
  const requested = resolve(path);
  const owner = ownerUid();
  let descriptor;
  try {
    const before = lstatSync(requested);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== owner
      || (before.mode & 0o022) !== 0 || (!allowEmpty && before.size < 1) || before.size > maximumBytes
      || (expectedMode !== undefined && (before.mode & 0o777) !== expectedMode)
      || realpathSync(requested) !== requested) throw new Error("Recovery preflight file is unavailable");
    descriptor = openSync(requested, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || opened.uid !== owner || (opened.mode & 0o022) !== 0
      || (expectedMode !== undefined && (opened.mode & 0o777) !== expectedMode)
      || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw new Error("Recovery preflight file is unavailable");
    }
    const bytes = readBoundedDescriptor(descriptor, maximumBytes, allowEmpty);
    const after = fstatSync(descriptor);
    const current = lstatSync(requested);
    if (bytes.length !== opened.size || after.dev !== opened.dev || after.ino !== opened.ino
      || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
      || !current.isFile() || current.isSymbolicLink() || current.nlink !== 1
      || current.dev !== opened.dev || current.ino !== opened.ino || current.size !== opened.size
      || current.uid !== owner || (current.mode & 0o022) !== 0
      || (expectedMode !== undefined && (current.mode & 0o777) !== expectedMode)
      || realpathSync(requested) !== requested) {
      throw new Error("Recovery preflight file changed during inspection");
    }
    return bytes;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function optionalReadOnlyRegularFile(path, maximumBytes, allowEmpty = false) {
  try {
    return { status: "validated", bytes: readOnlyRegularFile(path, maximumBytes, allowEmpty) };
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "missing" };
    return { status: "invalid" };
  }
}

function parseProcessStat(pid) {
  try {
    const source = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = source.lastIndexOf(")");
    if (closeParen < 1) return undefined;
    const fields = source.slice(closeParen + 1).trim().split(/\s+/);
    const parentPid = Number(fields[1]);
    const startTimeTicks = Number(fields[19]);
    return Number.isSafeInteger(parentPid) && parentPid >= 0 && Number.isSafeInteger(startTimeTicks) && startTimeTicks > 0
      ? { parentPid, startTimeTicks } : undefined;
  } catch {
    return undefined;
  }
}

function processEnvironment(pid) {
  try {
    return Object.fromEntries(readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").filter(Boolean).map((entry) => {
      const separator = entry.indexOf("=");
      return separator > 0 ? [entry.slice(0, separator), entry.slice(separator + 1)] : [entry, ""];
    }));
  } catch {
    return undefined;
  }
}

function processCommandLine(pid) {
  try {
    const argv = readFileSync(`/proc/${pid}/cmdline`).toString("utf8").split("\0").filter(Boolean);
    return argv.length > 0 ? argv : undefined;
  } catch {
    return undefined;
  }
}

function commandLineSession(argv) {
  const sessions = [];
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === "-s" || argv[index] === "--session") {
      if (index + 1 < argv.length) sessions.push(argv[index + 1]);
      index += 1;
    } else if (argv[index].startsWith("--session=")) {
      sessions.push(argv[index].slice("--session=".length));
    }
  }
  return sessions.length === 1 && SAFE_SESSION.test(sessions[0]) ? sessions[0] : undefined;
}

function processListeningPorts(pid) {
  const sockets = new Set();
  try {
    for (const entry of readdirSync(`/proc/${pid}/fd`)) {
      try {
        const match = /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${pid}/fd/${entry}`));
        if (match) sockets.add(match[1]);
      } catch {}
    }
  } catch {
    return [];
  }
  const ports = new Set();
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let source;
    try { source = readFileSync(table, "utf8"); } catch { continue; }
    for (const line of source.trim().split(/\r?\n/).slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields[3] !== "0A" || !sockets.has(fields[9])) continue;
      const separator = fields[1].lastIndexOf(":");
      const address = fields[1].slice(0, separator).toUpperCase();
      const port = Number.parseInt(fields[1].slice(separator + 1), 16);
      if (port >= 1024 && port <= 65535 && (/^[0-9A-F]{6}7F$/.test(address)
        || address === "00000000000000000000000001000000"
        || /^0000000000000000FFFF0000[0-9A-F]{6}7F$/.test(address))) ports.add(port);
    }
  }
  return [...ports].sort((left, right) => left - right);
}

function inspectAncestor(pid) {
  const before = parseProcessStat(pid);
  const argv = processCommandLine(pid);
  if (!before || !argv) return undefined;
  let descriptor;
  try {
    descriptor = openSync(`/proc/${pid}/exe`, constants.O_RDONLY);
    const opened = fstatSync(descriptor);
    const executableSha256 = sha256(readFileSync(descriptor));
    const afterDescriptor = fstatSync(descriptor);
    const after = parseProcessStat(pid);
    const cwd = realpathSync(readlinkSync(`/proc/${pid}/cwd`));
    if (!opened.isFile() || (opened.mode & 0o111) === 0 || !after
      || before.parentPid !== after.parentPid || before.startTimeTicks !== after.startTimeTicks
      || opened.dev !== afterDescriptor.dev || opened.ino !== afterDescriptor.ino
      || opened.size !== afterDescriptor.size || opened.mtimeMs !== afterDescriptor.mtimeMs
      || opened.ctimeMs !== afterDescriptor.ctimeMs) return undefined;
    return {
      pid,
      parentPid: before.parentPid,
      startTimeTicks: before.startTimeTicks,
      executableSha256,
      cwd,
      commandName: basename(argv[0]),
      cmdlineSha256: sha256(Buffer.from(argv.join("\0"))),
      argv,
    };
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function stableRecoveryAncestryMembers(ancestry, parent) {
  if (!parent) return ancestry;
  const parentIndex = ancestry.findIndex((member) => member.pid === parent.pid
    && member.startTimeTicks === parent.startTimeTicks
    && member.executableSha256 === parent.executableSha256);
  return parentIndex < 0 ? [] : ancestry.slice(parentIndex);
}

function inspectAncestry(worktree) {
  const ancestry = [];
  const candidates = [];
  let pid = process.ppid;
  for (let depth = 0; depth < 32 && pid > 1; depth += 1) {
    const inspected = inspectAncestor(pid);
    if (!inspected) return { status: "ambiguous", members: [], parent: null };
    const { argv, ...member } = inspected;
    ancestry.push(member);
    const sessionId = commandLineSession(argv);
    const sessionArgument = argv.some((arg) => arg === "-s" || arg === "--session" || arg.startsWith("--session="));
    if (inspected.commandName === "opencode" && inspected.cwd === worktree && (sessionId || !sessionArgument)) {
      const environment = processEnvironment(pid);
      const dataHomeCandidate = environment?.XDG_DATA_HOME
        ?? (environment?.HOME ? resolve(environment.HOME, ".local/share") : undefined);
      let dataHome;
      try { dataHome = dataHomeCandidate && realpathSync(dataHomeCandidate); } catch {}
      const ports = processListeningPorts(pid);
      const nonce = environment?.INGENIUM_RESTART_NONCE;
      if (environment && dataHome && ports.length <= 1 && (!nonce || /^[A-Za-z0-9_-]{43,128}$/.test(nonce))) {
        candidates.push({
          pid,
          startTimeTicks: inspected.startTimeTicks,
          executableSha256: inspected.executableSha256,
          cwd: inspected.cwd,
          cmdlineSha256: inspected.cmdlineSha256,
          sessionId: sessionId ?? null,
          dataHome,
          port: ports[0] ?? null,
          nonceSha256: nonce ? sha256(nonce) : "0".repeat(64),
          environment,
        });
      }
    }
    if (inspected.parentPid === pid) break;
    pid = inspected.parentPid;
  }
  const parent = candidates.length === 1 ? candidates[0] : null;
  const members = stableRecoveryAncestryMembers(ancestry, parent);
  return {
    status: parent && members.length > 0 ? "exact" : "ambiguous",
    members,
    parent: members.length > 0 ? parent : null,
  };
}

function safeHandoffPath(path) {
  return typeof path === "string" && path.length >= 1 && path.length <= 1024 && path === path.trim()
    && !path.startsWith("/") && !path.startsWith("~") && !path.includes("\\")
    && !/[\u0000-\u001f\u007f]/.test(path)
    && path.split("/").every((segment) => segment && segment !== "." && segment !== ".." && segment !== ".git");
}

function safeHandoffSummary(value) {
  if (!isRecord(value) || !["active", "working", "idle", "completed", "error"].includes(value.status)
    || !(value.taskHash === null || HASH.test(value.taskHash)) || !Array.isArray(value.actions) || value.actions.length > 64
    || !Array.isArray(value.changedPaths) || value.changedPaths.length > 32
    || !Array.isArray(value.checks) || value.checks.length > 32 || !isRecord(value.todos) || !isRecord(value.nextWork)) return undefined;
  if (value.actions.some((entry) => !hasExactKeys(entry, ["kind", "result", "path", "targetHash"])
    || !["read", "search", "write", "edit", "execute"].includes(entry.kind) || entry.result !== "succeeded"
    || (entry.path === null) === (entry.targetHash === null)
    || (entry.path !== null && !safeHandoffPath(entry.path)) || (entry.targetHash !== null && !HASH.test(entry.targetHash)))) return undefined;
  if (value.changedPaths.some((entry) => !hasExactKeys(entry, ["path", "operation", "additions", "deletions", "changeRevision"])
    || !safeHandoffPath(entry.path) || !["write", "edit"].includes(entry.operation)
    || ![entry.additions, entry.deletions].every((count) => Number.isSafeInteger(count) && count >= 0 && count <= 1_000_000)
    || !Number.isSafeInteger(entry.changeRevision) || entry.changeRevision < 1)) return undefined;
  if (value.checks.some((entry) => !hasExactKeys(entry, ["name", "status", "result", "exitCode", "targetHash"])
    || !["typecheck", "lint", "test", "build", "format", "security", "other"].includes(entry.name)
    || !["completed", "failed"].includes(entry.status) || !["passed", "failed"].includes(entry.result)
    || (entry.status === "completed") !== (entry.result === "passed") || !HASH.test(entry.targetHash)
    || !(entry.exitCode === null || (Number.isSafeInteger(entry.exitCode) && entry.exitCode >= 0 && entry.exitCode <= 255)))) return undefined;
  const todoKeys = ["total", "pending", "inProgress", "completed", "cancelled", "state"];
  const counts = todoKeys.slice(0, 5).map((key) => value.todos[key]);
  const populated = counts.slice(1).filter((count) => count > 0).length;
  const expectedTodoState = populated === 0 ? "none" : populated > 1 ? "mixed" : counts[1] > 0 ? "pending"
    : counts[2] > 0 ? "in_progress" : counts[3] > 0 ? "complete" : "cancelled";
  if (!todoKeys.every((key) => Object.hasOwn(value.todos, key)) || !counts.every((count) => Number.isSafeInteger(count) && count >= 0)
    || counts[0] !== counts.slice(1).reduce((sum, count) => sum + count, 0)
    || value.todos.state !== expectedTodoState
    || !["none", "continue_task", "review_changes", "run_checks", "address_failure"].includes(value.nextWork.kind)
    || !(value.nextWork.referenceHash === null || HASH.test(value.nextWork.referenceHash))) return undefined;
  return {
    status: value.status,
    taskHash: value.taskHash,
    actionCount: value.actions.length,
    changedPathCount: value.changedPaths.length,
    checkCount: value.checks.length,
    todos: Object.fromEntries(todoKeys.map((key) => [key, value.todos[key]])),
    nextWork: { kind: value.nextWork.kind, referenceHash: value.nextWork.referenceHash },
  };
}

function safeRecoveryIdentity(value) {
  return isRecord(value) && Number.isSafeInteger(value.pid) && value.pid >= 2
    && Number.isSafeInteger(value.startTimeTicks) && value.startTimeTicks >= 1
    && HASH.test(value.executableSha256 ?? "") && HASH.test(value.nonceSha256 ?? "");
}

function safeEnrolledParent(value) {
  return safeRecoveryIdentity(value) && resolve(value.worktree ?? "") === value.worktree
    && SAFE_PROJECT.test(value.project ?? "") && UUID.test(value.projectId ?? "") && SAFE_ID.test(value.workspaceId ?? "")
    && HASH.test(value.storageMappingHash ?? "") && (value.port === null
      || (Number.isSafeInteger(value.port) && value.port >= 1024 && value.port <= 65535))
    && typeof value.dataHome === "string" && resolve(value.dataHome) === value.dataHome;
}

function readRecoverySummary(worktree) {
  const directory = resolve(worktree, ".opencode/protected-runtime-index/tui-recovery");
  const stateFile = optionalReadOnlyRegularFile(resolve(directory, "state.json"), 64 * 1024);
  const journalFile = optionalReadOnlyRegularFile(resolve(directory, "journal.json"), 64 * 1024);
  const legacyFile = optionalReadOnlyRegularFile(resolve(directory, "legacy-handoff.json"), 64 * 1024);
  if ([stateFile, journalFile, legacyFile].every((file) => file.status === "missing")) {
    return { summary: { status: "missing", state: null, handoff: null }, enrollment: null };
  }
  try {
    const state = stateFile.bytes ? JSON.parse(stateFile.bytes.toString("utf8")) : undefined;
    const journal = journalFile.bytes ? JSON.parse(journalFile.bytes.toString("utf8")) : undefined;
    const legacy = legacyFile.bytes ? JSON.parse(legacyFile.bytes.toString("utf8")) : undefined;
    const handoffValue = journal ?? (isRecord(legacy) ? legacy.handoff : undefined);
    const handoff = safeHandoffSummary(handoffValue);
    if (!hasExactKeys(state, ["schemaVersion", "owner", "fence", "generation", "phase", "activeParent", "replacement", "updatedAt"])
      || state.schemaVersion !== 1 || !Number.isSafeInteger(state.fence) || state.fence < 1
      || !Number.isSafeInteger(state.generation) || state.generation < 1
      || !["owner_ready", "enrolled", "replacement_prepared", "replacement_committed"].includes(state.phase)
      || typeof state.updatedAt !== "string" || !Number.isFinite(Date.parse(state.updatedAt))
      || !safeRecoveryIdentity(state.owner) || !(state.activeParent === null || safeEnrolledParent(state.activeParent))
      || !(state.replacement === null || isRecord(state.replacement))
      || (state.phase === "owner_ready" && (state.activeParent !== null || state.replacement !== null))
      || (state.phase === "enrolled" && (state.activeParent === null || state.replacement !== null))
      || (["replacement_prepared", "replacement_committed"].includes(state.phase)
        && (state.activeParent === null || state.replacement === null)) || !handoff) throw new Error("invalid");
    return {
      summary: {
        status: "validated",
        state: {
          phase: state.phase,
          fence: state.fence,
          generation: state.generation,
          activeParent: state.activeParent !== null,
          replacement: state.replacement !== null,
          sha256: sha256(stateFile.bytes),
        },
        handoff: { ...handoff, sha256: sha256(canonicalJson(handoffValue)) },
      },
      enrollment: state.phase === "enrolled" && isRecord(state.activeParent) ? state.activeParent : null,
    };
  } catch {
    return { summary: { status: "invalid", state: null, handoff: null }, enrollment: null };
  }
}

function inspectSummaryDirectory(path, maximumBytes, validate) {
  const empty = (status) => ({
    summary: { status, count: 0, ambiguousCount: 0, sha256: null },
    entries: [],
  });
  try {
    const directory = resolve(path);
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== ownerUid() || (stat.mode & 0o022) !== 0
      || realpathSync(directory) !== directory) return empty("invalid");
    const records = [];
    const entries = [];
    let ambiguousCount = 0;
    for (const name of readdirSync(directory).sort()) {
      if (!/^[0-9a-f]{64}(?:\.[0-9a-f]{64})?\.json$/.test(name)) {
        return empty("invalid");
      }
      const bytes = readOnlyRegularFile(resolve(directory, name), maximumBytes);
      const value = JSON.parse(bytes.toString("utf8"));
      if (!isRecord(value) || !validate(value, name.split(".", 1)[0], name)) {
        return empty("invalid");
      }
      if (value.ambiguous === true || value.kind === "overflow") ambiguousCount += 1;
      records.push(`${name}:${sha256(bytes)}`);
      entries.push({ name, sha256: sha256(bytes), value });
    }
    return {
      summary: { status: "validated", count: records.length, ambiguousCount, sha256: sha256(records.join("\n")) },
      entries,
    };
  } catch (error) {
    return empty(error?.code === "ENOENT" ? "missing" : "invalid");
  }
}

function validOutboxPathSegments(value) {
  return Array.isArray(value) && value.length >= 1 && value.length <= 128
    && value.every((segment) => typeof segment === "string" && /^[A-Za-z0-9_-]{1,342}$/.test(segment));
}

function validOutboxMutation(value) {
  if (!hasExactKeys(value, ["phase", "operation", "declaredPathSegments", "footprint", "remoteClaim"])
    || !["claim_failed", "local_applied", "completion_ambiguous"].includes(value.phase)
    || !["write", "edit", "create", "delete", "rename", "apply_patch", "repository", "build"].includes(value.operation)
    || !Array.isArray(value.declaredPathSegments) || value.declaredPathSegments.length > 32
    || !value.declaredPathSegments.every(validOutboxPathSegments)
    || !Array.isArray(value.footprint) || value.footprint.length > 256) return false;
  if (value.footprint.some((entry) => !hasExactKeys(entry, ["pathSegments", "pathSha256", "beforeSha256", "afterSha256"])
    || (entry.pathSegments !== null && !validOutboxPathSegments(entry.pathSegments))
    || !HASH.test(entry.pathSha256 ?? "")
    || !(entry.beforeSha256 === null || HASH.test(entry.beforeSha256 ?? ""))
    || !(entry.afterSha256 === null || HASH.test(entry.afterSha256 ?? "")))) return false;
  if (value.remoteClaim === null) return value.phase !== "completion_ambiguous";
  const claim = value.remoteClaim;
  return hasExactKeys(claim, ["worktreeId", "sessionId", "incarnation", "expectedRevision", "fence", "ownershipToken",
    "clientClaimKey", "acceptedEpoch", "remoteOperationId"])
    && /^worktree-[0-9a-f]{64}$/.test(claim.worktreeId ?? "")
    && /^session-[0-9a-f]{64}$/.test(claim.sessionId ?? "")
    && [claim.incarnation, claim.expectedRevision, claim.fence, claim.acceptedEpoch]
      .every((entry) => Number.isSafeInteger(entry) && entry >= 0)
    && claim.incarnation >= 1 && claim.fence >= 1 && claim.acceptedEpoch >= 1
    && /^[A-Za-z0-9_-]{32,128}$/.test(claim.ownershipToken ?? "")
    && /^[A-Za-z0-9_-]{32,128}$/.test(claim.clientClaimKey ?? "")
    && claim.clientClaimKey !== claim.ownershipToken && UUID.test(claim.remoteOperationId ?? "")
    && value.phase === "completion_ambiguous";
}

function validOutboxSummaryRecord(value, key, name) {
  const keys = ["version", "operationId", "key", "kind", "sessionHash", "createdAt", "failure",
    "revision", "cursor", "digest", "ambiguous", "count", "mutation"];
  return name === `${key}.json` && hasExactKeys(value, keys) && value.version === 1
    && value.key === key && HASH.test(value.key ?? "")
    && HASH.test(value.operationId ?? "") && HASH.test(value.digest ?? "")
    && ["register", "claim", "completion", "quarantine", "snapshot", "memory", "publication", "ack",
      "memory_ack", "heartbeat", "recovery", "close", "overflow"].includes(value.kind)
    && ["unavailable", "conflict", "authentication", "rate_limited", "quarantined", "invalid_response"].includes(value.failure)
    && /^(?:[0-9a-f]{16}|[0-9a-f]{64})$/.test(value.sessionHash ?? "")
    && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt))
    && [value.revision, value.cursor].every((entry) => entry === null || (Number.isSafeInteger(entry) && entry >= 0))
    && (value.mutation === null || validOutboxMutation(value.mutation))
    && typeof value.ambiguous === "boolean" && Number.isSafeInteger(value.count) && value.count >= 1;
}

function validDispositionSummaryRecord(value, key, name) {
  const keys = value.schemaVersion === 1
    ? ["schemaVersion", "recordKey", "recordSha256", "operationId", "decision", "authority", "reason", "createdAt"]
    : ["schemaVersion", "recordKey", "recordSha256", "recordCount", "operationId", "authorizationSha256",
        "decision", "authority", "reason", "createdAt"];
  return [1, 2].includes(value.schemaVersion) && hasExactKeys(value, keys)
    && value.recordKey === key && HASH.test(value.recordKey ?? "")
    && HASH.test(value.recordSha256 ?? "") && HASH.test(value.operationId ?? "")
    && (value.schemaVersion === 1 ? name === `${key}.json`
      : name === `${key}.${value.recordSha256}.json` && Number.isSafeInteger(value.recordCount)
        && value.recordCount >= 1 && HASH.test(value.authorizationSha256 ?? ""))
    && value.decision === "abandoned" && value.authority === "explicit_user_authorization"
    && value.reason === "nonrecoverable_identityless_overflow" && typeof value.createdAt === "string"
    && Number.isFinite(Date.parse(value.createdAt));
}

export function summarizeCoordinationOutboxState(protectedIndex) {
  const inspectedOutbox = inspectSummaryDirectory(
    resolve(protectedIndex, "coordination-outbox"),
    16 * 1024,
    validOutboxSummaryRecord,
  );
  const inspectedDisposition = inspectSummaryDirectory(
    resolve(protectedIndex, "coordination-outbox-dispositions"),
    16 * 1024,
    validDispositionSummaryRecord,
  );
  const legacyDisposed = inspectedDisposition.entries.some(({ value }) => value.schemaVersion === 1
    && value.recordKey === LEGACY_DISPOSITION_KEY
    && value.recordSha256 === LEGACY_DISPOSITION_RECORD_SHA256
    && value.operationId === LEGACY_DISPOSITION_OPERATION_ID);
  const versionedDisposed = ({ sha256: recordSha256, value: record }) => {
    if (record.kind !== "overflow" || record.ambiguous !== true || !/^0+$/.test(record.sessionHash)
      || record.mutation !== null || record.key !== "098781a9c6484288bd5f9d9a0cba6b049d3c8a2f15b023b56d5ccc08237bafd0") return false;
    const matches = inspectedDisposition.entries.filter(({ value }) => value.schemaVersion === 2
      && value.recordKey === record.key && value.recordSha256 === recordSha256
      && value.recordCount === record.count && value.operationId === record.operationId);
    if (matches.length !== 1 || inspectedDisposition.summary.status !== "validated") return false;
    try {
      const directory = resolve(protectedIndex, "coordination-outbox-authorizations");
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== ownerUid()
        || (stat.mode & 0o777) !== 0o700 || realpathSync(directory) !== directory) return false;
      const bytes = readOnlyRegularFile(resolve(directory, `${record.key}.json`), 16 * 1024, false, 0o600);
      const disposition = matches[0].value;
      if (sha256(bytes) !== disposition.authorizationSha256) return false;
      const authorization = JSON.parse(bytes);
      const authorityHash = sha256(`explicit_user_authorization\0abandon_identityless_overflow\0${record.key}\0exact_key_same_record_family\0nonrecoverable_identityless_overflow`);
      const issued = Date.parse(authorization.issuedAt);
      const expires = Date.parse(authorization.expiresAt);
      const disposed = Date.parse(disposition.createdAt);
      return hasExactKeys(authorization, ["schemaVersion", "authorizationId", "recordKey", "mode", "authority", "scope", "reason", "issuedAt", "expiresAt"])
        && authorization.schemaVersion === 1 && authorization.authorizationId === authorityHash
        && authorization.recordKey === record.key && authorization.mode === "abandon_identityless_overflow"
        && authorization.authority === disposition.authority && authorization.scope === "exact_key_same_record_family"
        && authorization.reason === disposition.reason && Number.isFinite(issued) && Number.isFinite(expires)
        && expires > issued && expires - issued <= 24 * 60 * 60 * 1_000 && issued <= disposed && disposed < expires;
    } catch { return false; }
  };
  const ambiguousCount = inspectedOutbox.entries.filter(({ sha256: recordSha256, value }) =>
    (value.ambiguous === true || value.kind === "overflow")
    && !versionedDisposed({ sha256: recordSha256, value })
    && !(legacyDisposed && value.key === LEGACY_DISPOSITION_KEY
      && value.operationId === LEGACY_DISPOSITION_OPERATION_ID
      && recordSha256 === LEGACY_DISPOSITION_RECORD_SHA256)).length;
  return {
    outbox: { ...inspectedOutbox.summary, ambiguousCount },
    disposition: inspectedDisposition.summary,
  };
}

function summarizeFreeze(path) {
  const file = optionalReadOnlyRegularFile(path, 4 * 1024, true);
  return file.bytes !== undefined
    ? { status: "present", sha256: sha256(file.bytes) }
    : { status: file.status === "missing" ? "clear" : "invalid", sha256: null };
}

function collectGitSummary(root, sourcePath, sourceBytes) {
  try {
    if (gitConfiguration(root).some(isExecutableGitConfiguration)) throw new Error("configuration");
    const topLevel = git(root, ["rev-parse", "--show-toplevel"], "utf8").trim();
    const head = git(root, ["rev-parse", "--verify", "HEAD"], "utf8").trim();
    const relativeSource = "packages/ingenium-extension/scripts/recovery-bootstrap.js";
    const status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]);
    const dirtyPaths = status.toString("utf8").split("\0").filter(Boolean).map((entry) => entry.slice(3)).sort();
    const sourceMatchesHead = resolve(root, relativeSource) === sourcePath
      && Buffer.from(git(root, ["show", `${head}:${relativeSource}`])).equals(sourceBytes);
    return {
      status: topLevel === root && GIT_OID.test(head) && sourceMatchesHead ? "validated" : "invalid",
      head: GIT_OID.test(head) ? head : null,
      dirtyPaths,
      sourceMatchesHead,
    };
  } catch {
    return { status: "invalid", head: null, dirtyPaths: [], sourceMatchesHead: false };
  }
}

async function collectApiHealth(environment, request) {
  const configured = environment.INGENIUM_API_URL;
  if (!configured) return { status: "unconfigured", httpStatus: null };
  try {
    const base = new URL(configured);
    if (base.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(base.hostname)
      || base.username || base.password) return { status: "invalid", httpStatus: null };
    const response = await request(`${base.href.replace(/\/$/, "")}/health`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    const value = await response.json();
    return { status: response.status === 200 && value?.status === "ok" ? "healthy" : "unhealthy", httpStatus: response.status };
  } catch {
    return { status: "unavailable", httpStatus: null };
  }
}

export function inspectRecoveryDeployment(worktree, head, run = execFileSync) {
  try {
    const docker = (args) => run("/usr/bin/docker", ["--host", "unix:///var/run/docker.sock", ...args], {
      encoding: "utf8", timeout: 5_000, maxBuffer: 1024 * 1024, env: { PATH: "/usr/bin:/bin" },
    });
    const ids = docker(["ps", "--filter", `label=com.docker.compose.project.working_dir=${worktree}`,
      "--filter", "label=com.docker.compose.service=ingenium", "--format", "{{.ID}}"])
      .trim().split("\n").filter(Boolean);
    if (ids.length !== 1 || !/^[0-9a-f]{12,64}$/.test(ids[0])) throw new Error("ambiguous deployment");
    const containers = JSON.parse(docker(["inspect", ids[0]]));
    if (!Array.isArray(containers) || containers.length !== 1) throw new Error("ambiguous deployment");
    const container = containers[0];
    const labels = container.Config?.Labels;
    if (!HASH.test(container.Id ?? "") || !container.Id.startsWith(ids[0])
      || labels?.["com.docker.compose.project.working_dir"] !== worktree
      || labels?.["com.docker.compose.service"] !== "ingenium" || !/^sha256:[0-9a-f]{64}$/.test(container.Image ?? "")
      || container.State?.Running !== true || container.State?.Health?.Status !== "healthy") throw new Error("unhealthy deployment");
    const images = JSON.parse(docker(["image", "inspect", container.Image]));
    if (!Array.isArray(images) || images.length !== 1 || images[0].Id !== container.Image
      || images[0].Config?.Labels?.["org.opencontainers.image.revision"] !== head
      || !GIT_OID.test(head ?? "")) throw new Error("foreign deployment source");
    return { status: "attested", provider: "docker-local", revision: head, image: container.Image, container: container.Id };
  } catch { return { status: "unavailable", provider: "docker-local", revision: null }; }
}

export function prepareRecoveryOwnerContract(binding, sourceHead) {
  if (!hasExactKeys(binding, ["project", "projectId", "workspaceId", "storageMappingHash", "worktree"])
    || !SAFE_PROJECT.test(binding.project) || !UUID.test(binding.projectId) || !SAFE_ID.test(binding.workspaceId)
    || !HASH.test(binding.storageMappingHash) || resolve(binding.worktree) !== binding.worktree || !GIT_OID.test(sourceHead ?? "")) {
    throw new Error("Recovery owner preparation binding is invalid");
  }
  return { schemaVersion: 1, kind: "recovery-owner-preparation", authorizesRestart: false,
    provider: "systemd-user", job: "ingenium-recovery-owner.service", binding: { ...binding }, sourceHead,
    maximumLeaseMs: 60_000, nonceTarget: "successor_or_supervisor_only" };
}

export function inspectRecoveryOwnerStatus(contract, options = {}) {
  const unavailable = { status: "unavailable", authorizesRestart: false };
  try {
    if (canonicalJson(contract) !== canonicalJson(prepareRecoveryOwnerContract(contract.binding, contract.sourceHead))) return unavailable;
    const directory = resolve(contract.binding.worktree, ".opencode/protected-runtime-index/tui-recovery");
    for (const path of [dirname(directory), directory]) {
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== ownerUid()
        || (stat.mode & 0o777) !== 0o700 || realpathSync(path) !== path) return unavailable;
    }
    const bytes = readOnlyRegularFile(resolve(directory, "owner-status.json"), 16 * 1024, false, 0o600);
    const value = JSON.parse(bytes);
    const now = options.now ?? Date.now();
    if (!hasExactKeys(value, ["schemaVersion", "job", "invocationId", "binding", "sourceHead", "scriptSha256", "owner", "fence", "lease", "health"])
      || value.schemaVersion !== 1 || value.job !== contract.job || !/^[0-9a-f]{32}$/.test(value.invocationId ?? "")
      || canonicalJson(value.binding) !== canonicalJson(contract.binding) || value.sourceHead !== contract.sourceHead
      || !HASH.test(value.scriptSha256 ?? "") || !hasExactKeys(value.owner, ["pid", "startTimeTicks", "executableSha256", "nonceSha256"])
      || !safeRecoveryIdentity(value.owner) || value.owner.nonceSha256 === "0".repeat(64)
      || !Number.isSafeInteger(value.fence) || value.fence < 1 || value.health !== "ready"
      || !hasExactKeys(value.lease, ["issuedAt", "expiresAt"]) || !Number.isSafeInteger(value.lease.issuedAt)
      || !Number.isSafeInteger(value.lease.expiresAt) || value.lease.issuedAt > now || value.lease.expiresAt <= now
      || value.lease.expiresAt - value.lease.issuedAt > contract.maximumLeaseMs) return unavailable;
    const stateBytes = readOnlyRegularFile(resolve(directory, "state.json"), 64 * 1024, false, 0o600);
    const state = JSON.parse(stateBytes);
    if (!hasExactKeys(state, ["schemaVersion", "owner", "fence", "generation", "phase", "activeParent", "replacement", "updatedAt"])
      || state.schemaVersion !== 1 || !Number.isSafeInteger(state.generation) || state.generation < 1
      || !["owner_ready", "enrolled"].includes(state.phase) || state.replacement !== null
      || (state.phase === "owner_ready" ? state.activeParent !== null : !safeEnrolledParent(state.activeParent))
      || !isCanonicalRfc3339(state.updatedAt) || state.fence !== value.fence
      || canonicalJson(state.owner) !== canonicalJson(value.owner)) return unavailable;
    const run = options.run ?? execFileSync;
    const unit = run("/usr/bin/systemctl", ["--user", "show", contract.job,
      "--property=MainPID,InvocationID,ActiveState,SubState"], { encoding: "utf8", timeout: 5_000, maxBuffer: 16 * 1024,
      env: { PATH: "/usr/bin:/bin", XDG_RUNTIME_DIR: `/run/user/${ownerUid()}`,
        DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${ownerUid()}/bus` } });
    const properties = Object.fromEntries(unit.trim().split("\n").map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }));
    if (properties.MainPID !== String(value.owner.pid) || properties.InvocationID !== value.invocationId
      || properties.ActiveState !== "active" || properties.SubState !== "running") return unavailable;
    const inspect = options.inspect ?? inspectAncestor;
    const environment = (options.environment ?? processEnvironment)(value.owner.pid);
    const owner = inspect(value.owner.pid);
    const script = resolve(contract.binding.worktree, "packages/ingenium-extension/dist/scripts/recovery-owner.js");
    if (!owner || owner.startTimeTicks !== value.owner.startTimeTicks || owner.executableSha256 !== value.owner.executableSha256
      || owner.cwd !== contract.binding.worktree || owner.commandName !== "node" || owner.argv.length !== 3 || owner.argv[1] !== script
      || !OPAQUE_TOKEN.test(environment?.INGENIUM_RECOVERY_OWNER_NONCE ?? "")
      || sha256(environment.INGENIUM_RECOVERY_OWNER_NONCE) !== value.owner.nonceSha256
      || environment.INGENIUM_RECOVERY_OWNER_SOURCE_HEAD !== contract.sourceHead
      || environment.INGENIUM_RECOVERY_OWNER_SCRIPT_SHA256 !== value.scriptSha256
      || readTrustedRegularFile(script, "Recovery owner executable").sha256 !== value.scriptSha256) return unavailable;
    if (!bytes.equals(readOnlyRegularFile(resolve(directory, "owner-status.json"), 16 * 1024, false, 0o600))
      || !stateBytes.equals(readOnlyRegularFile(resolve(directory, "state.json"), 64 * 1024, false, 0o600))
      || canonicalJson(inspect(value.owner.pid)) !== canonicalJson(owner)) return unavailable;
    return { status: "attested", authorizesRestart: false, job: value.job, invocationId: value.invocationId,
      owner: value.owner, fence: value.fence, lease: value.lease, health: value.health,
      binding: value.binding, sourceHead: value.sourceHead, evidenceSha256: sha256(bytes) };
  } catch { return unavailable; }
}

function responseValue(value) {
  return isRecord(value) && Object.hasOwn(value, "data") ? value.data : value;
}

function liveCheckName(command) {
  if (typeof command !== "string") return undefined;
  const value = command.toLowerCase();
  if (/\b(typecheck|tsc\b)/.test(value)) return "typecheck";
  if (/\b(eslint|lint\b)/.test(value)) return "lint";
  if (/\b(prettier|format\b)/.test(value)) return "format";
  if (/\b(audit|security|snyk)\b/.test(value)) return "security";
  if (/\b(build|compile)\b/.test(value)) return "build";
  if (/\b(test|vitest|jest|pytest|playwright)\b/.test(value)) return "test";
  if (/^\s*git\s+status(?:\s|$)/.test(value)) return "other";
  return undefined;
}

function liveExitCode(state) {
  const metadata = isRecord(state.metadata) ? state.metadata : state;
  const value = metadata.exitCode ?? metadata.exit_code ?? metadata.code;
  return Number.isSafeInteger(value) && value >= 0 && value <= 255 ? value : null;
}

function liveInputChanges(tool, input, worktree) {
  const candidate = input.filePath ?? input.path;
  if (typeof candidate === "string") {
    const path = isAbsolute(candidate) ? relative(worktree, resolve(candidate)) : candidate;
    if (!safeHandoffPath(path)) throw new Error("Recovery live changed path is invalid");
    return [{ path, operation: tool === "write" || tool === "file_write" ? "write" : "edit" }];
  }
  if (tool !== "apply_patch") return [];
  const patch = input.patchText ?? input.patch;
  if (typeof patch !== "string" || Buffer.byteLength(patch, "utf8") > 1024 * 1024) {
    throw new Error("Recovery live patch capture is invalid");
  }
  const changes = [...patch.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)].map((match) => ({
    path: match[2],
    operation: match[1] === "Add" ? "write" : "edit",
  }));
  if (changes.length === 0 || changes.some((change) => !safeHandoffPath(change.path))) {
    throw new Error("Recovery live patch capture is invalid");
  }
  return changes;
}

async function readLiveRecoverySummary(parent, worktree, request) {
  const password = parent?.environment?.OPENCODE_SERVER_PASSWORD;
  const username = parent?.environment?.OPENCODE_SERVER_USERNAME ?? "opencode";
  if (!parent || parent.port === null || !/^[A-Za-z0-9._-]{1,64}$/.test(username)
    || !/^[A-Za-z0-9_-]{43,128}$/.test(password ?? "")) return undefined;
  try {
    const headers = { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
    const base = `http://127.0.0.1:${parent.port}`;
    const get = async (path) => {
      const response = await request(`${base}${path}`, {
        method: "GET",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status !== 200) throw new Error("unavailable");
      return responseValue(await response.json());
    };
    const [health, session, messages, statuses] = await Promise.all([
      get("/global/health"),
      get(`/session/${encodeURIComponent(parent.sessionId)}`),
      get(`/session/${encodeURIComponent(parent.sessionId)}/message`),
      get("/session/status"),
    ]);
    if (!isRecord(health) || health.healthy !== true || typeof health.version !== "string" || !isRecord(session)
      || session.id !== parent.sessionId || session.directory !== worktree || !Array.isArray(messages)
      || !isRecord(statuses)) return undefined;
    let todos = [];
    for (const message of [...messages].reverse()) {
      if (!isRecord(message) || !Array.isArray(message.parts)) continue;
      const part = [...message.parts].reverse().find((entry) => isRecord(entry) && entry.type === "tool"
        && entry.tool === "todowrite" && isRecord(entry.state) && entry.state.status === "completed"
        && isRecord(entry.state.input) && Array.isArray(entry.state.input.todos));
      if (isRecord(part) && isRecord(part.state) && isRecord(part.state.input)) {
        todos = part.state.input.todos;
        break;
      }
    }
    const todoCounts = { pending: 0, inProgress: 0, completed: 0, cancelled: 0 };
    for (const todo of todos) {
      if (!isRecord(todo) || !["pending", "in_progress", "completed", "cancelled"].includes(todo.status)) return undefined;
      if (todo.status === "in_progress") todoCounts.inProgress += 1;
      else todoCounts[todo.status] += 1;
    }
    const actions = [];
    const changedPaths = new Map();
    const checks = [];
    for (const message of messages) {
      if (!isRecord(message) || !Array.isArray(message.parts)) continue;
      for (const part of message.parts) {
        if (!isRecord(part) || part.type !== "tool" || !isRecord(part.state)
          || !["completed", "error"].includes(part.state.status) || !isRecord(part.state.input)) continue;
        const tool = String(part.tool).toLowerCase().replace(/[.-]/g, "_");
        if (["bash", "shell"].includes(tool)
          && part.state.input.command === "ingenium-build deployment production-restart") continue;
        const changes = liveInputChanges(tool, part.state.input, worktree);
        const path = changes.length === 1 ? changes[0].path : undefined;
        const kind = tool === "read" ? "read" : tool === "grep" || tool === "glob" ? "search"
          : tool === "write" || tool === "file_write" ? "write"
            : tool === "edit" || tool === "file_edit" ? "edit" : "execute";
        if (part.state.status === "completed") {
          actions.push({
            kind,
            result: "succeeded",
            path: path ?? null,
            targetHash: path ? null : sha256(`${tool}\0${JSON.stringify(part.state.input)}`),
          });
        }
        for (const change of changes) {
          if (!["write", "edit", "apply_patch", "file_write", "file_edit"].includes(tool)) continue;
          changedPaths.set(change.path, {
            ...change,
            additions: 0,
            deletions: 0,
            changeRevision: changedPaths.size + 1,
          });
        }
        const name = ["bash", "shell"].includes(tool) ? liveCheckName(part.state.input.command) : undefined;
        if (name) {
          const result = part.state.status === "completed" ? "passed" : "failed";
          const checkStatus = result === "passed" ? "completed" : "failed";
          const exitCode = liveExitCode(part.state);
          checks.push({
            name,
            status: checkStatus,
            result,
            exitCode,
            targetHash: sha256(JSON.stringify({
              name,
              status: checkStatus,
              result,
              exitCode,
              sourceTargetHash: sha256(`${tool}\0${JSON.stringify(part.state.input)}`),
            })),
          });
        }
      }
    }
    const statusValue = statuses[parent.sessionId];
    const rawStatus = isRecord(statusValue) ? statusValue.type ?? statusValue.status : statusValue;
    const open = todoCounts.pending > 0 || todoCounts.inProgress > 0;
    const status = rawStatus === "idle" ? "idle"
      : ["busy", "retry", "working"].includes(rawStatus) || open ? "working" : "active";
    const task = session.currentTaskId ?? session.current_task_id ?? session.taskId ?? session.task_id;
    const taskHash = typeof task === "string" && task.length > 0 && task.length <= 512
      && !/[\u0000-\u001f\u007f]/.test(task) ? sha256(task) : null;
    const boundedActions = actions.slice(-64);
    const boundedChangedPaths = [...changedPaths.values()].slice(-32);
    const boundedChecks = checks.slice(-32);
    const failedCheck = [...boundedChecks].reverse().find((check) => check.result === "failed");
    const latestCheck = boundedChecks.at(-1);
    const latestAction = boundedActions.at(-1);
    const populated = Object.values(todoCounts).filter((count) => count > 0).length;
    const todoState = populated === 0 ? "none" : populated > 1 ? "mixed" : todoCounts.pending ? "pending"
      : todoCounts.inProgress ? "in_progress" : todoCounts.completed ? "complete" : "cancelled";
    const nextWork = failedCheck ? { kind: "address_failure", referenceHash: failedCheck.targetHash }
      : open ? { kind: "continue_task", referenceHash: taskHash }
        : latestCheck ? { kind: "run_checks", referenceHash: latestCheck.targetHash }
          : latestAction ? { kind: "review_changes", referenceHash: latestAction.targetHash ?? sha256(latestAction.path) }
            : { kind: "none", referenceHash: null };
    const handoff = {
      status,
      taskHash,
      actionCount: boundedActions.length,
      changedPathCount: boundedChangedPaths.length,
      checkCount: boundedChecks.length,
      todos: { total: todos.length, ...todoCounts, state: todoState },
      nextWork,
    };
    const assistant = [...messages].reverse().find((message) => message?.info?.role === "assistant");
    const role = assistant?.info?.agent;
    const typedTodos = todos.map((todo) => ({ idSha256: typeof todo.id === "string" && todo.id.length > 0 ? sha256(todo.id)
      : typeof todo.content === "string" && todo.content.trim() && todo.content.length <= 2048
        ? sha256(`todo-${sha256(`todo\0${JSON.stringify(todo.content)}`)}`) : null, status: todo.status }));
    const operational = SAFE_ID.test(role ?? "") && typedTodos.length <= 64
      && typedTodos.every((todo) => todo.idSha256 !== null) && new Set(typedTodos.map((todo) => todo.idSha256)).size === typedTodos.length
      ? { role, status, taskHash, actionsSha256: sha256(canonicalJson(boundedActions)),
        changedPathsSha256: sha256(canonicalJson(boundedChangedPaths)), checks: boundedChecks, todos: typedTodos, nextWork }
      : null;
    return { status: "validated", state: null, handoff: { ...handoff, sha256: sha256(canonicalJson(handoff)) }, operational };
  } catch {
    return undefined;
  }
}

export async function captureLegacyRecoveryPreAdmission(parent, binding, source, request = fetch,
  inspect = (pid) => ({ ...inspectAncestor(pid), nonce: processEnvironment(pid)?.INGENIUM_RESTART_NONCE, ports: processListeningPorts(pid) })) {
  try { prepareRecoveryOwnerContract(binding, source?.head); } catch { return null; }
  if (!parent || !binding || !source || source.status !== "validated" || source.dirtyPaths.length !== 0
    || !source.sourceMatchesHead || !GIT_OID.test(source.head ?? "") || parent.cwd !== binding.worktree
    || !safeRecoveryIdentity(parent) || parent.port === null || parent.nonceSha256 !== "0".repeat(64)) return null;
  const sameProcess = () => {
    const actual = inspect(parent.pid);
    return actual && actual.commandName === "opencode" && actual.pid === parent.pid
      && actual.startTimeTicks === parent.startTimeTicks && actual.executableSha256 === parent.executableSha256
      && actual.cwd === binding.worktree && actual.cmdlineSha256 === parent.cmdlineSha256
      && actual.nonce === undefined && actual.ports?.length === 1 && actual.ports[0] === parent.port;
  };
  if (!sameProcess()) return null;
  const password = parent.environment?.OPENCODE_SERVER_PASSWORD;
  const username = parent.environment?.OPENCODE_SERVER_USERNAME ?? "opencode";
  if (!OPAQUE_TOKEN.test(password ?? "") || !/^[A-Za-z0-9._-]{1,64}$/.test(username)) return null;
  try {
    const headers = { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
    const get = async (path) => {
      const response = await request(`http://127.0.0.1:${parent.port}${path}`, {
        method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(5_000),
      });
      if (response.status !== 200) throw new Error("Legacy capture unavailable");
      return responseValue(await response.json());
    };
    const [sessions, statuses] = await Promise.all([get("/session"), get("/session/status")]);
    if (!Array.isArray(sessions) || !isRecord(statuses)) return null;
    const matches = sessions.filter((session) => session?.directory === binding.worktree && !session.parentID
      && ["busy", "retry", "working"].includes(statuses[session.id]?.type));
    if (matches.length !== 1 || !SAFE_SESSION.test(matches[0].id ?? "")
      || parent.sessionId !== null && parent.sessionId !== matches[0].id) return null;
    const sessionId = matches[0].id;
    const live = await readLiveRecoverySummary({ ...parent, sessionId }, binding.worktree, request);
    if (!live?.operational || !sameProcess()) return null;
    const config = JSON.parse(readOnlyRegularFile(resolve(binding.worktree, "opencode.json"), 1024 * 1024));
    if (!isRecord(config.agent) || !Object.hasOwn(config.agent, live.operational.role)
      || config.agent[live.operational.role]?.disable === true) return null;
    const confirmed = await get("/session/status");
    if (canonicalJson(confirmed) !== canonicalJson(statuses)) return null;
    const identity = Object.fromEntries(["pid", "startTimeTicks", "executableSha256", "nonceSha256"].map((key) => [key, parent[key]]));
    const snapshot = { schemaVersion: 1, kind: "legacy-pre-admission", parent: identity,
      nonceProvenance: "absent_process_environment", sessionId, binding, sourceHead: source.head,
      operational: live.operational };
    return { snapshot, sha256: sha256(canonicalJson(snapshot)), summary: live.handoff };
  } catch { return null; }
}

export function recoveryConfiguredEnvironment(worktree, inherited = {}) {
  const config = JSON.parse(readOnlyRegularFile(resolve(worktree, "opencode.json"), 1024 * 1024));
  const candidates = Object.entries(config.mcp ?? {}).filter(([name, entry]) => name === "ingenium"
    || entry?.environment?.INGENIUM_MCP_AUDIENCE !== undefined
    || entry?.command?.some?.((part) => typeof part === "string" && part.endsWith("/packages/ingenium-extension/dist/scripts/mcp-server.js")));
  if (candidates.length !== 1 || candidates[0][0] !== "ingenium") throw new Error("Recovery binding is unavailable");
  const entry = candidates[0][1];
  const configured = entry.environment;
  if (entry.type !== "local" || entry.enabled === false || !isRecord(configured)
    || Object.values(configured).some((value) => typeof value !== "string")
    || configured.INGENIUM_MCP_CREDENTIAL !== undefined || inherited.INGENIUM_MCP_CREDENTIAL !== undefined
    || configured.INGENIUM_TRUSTED_API_URL !== undefined) throw new Error("Recovery binding is unavailable");
  const keys = ["INGENIUM_PROJECT", "INGENIUM_PROJECT_ID", "INGENIUM_WORKSPACE_ID", "INGENIUM_WORKTREE",
    "INGENIUM_STORAGE_MAPPING_HASH", "INGENIUM_API_URL", "INGENIUM_MCP_AUDIENCE", "INGENIUM_MCP_CREDENTIAL_FILE"];
  if (keys.some((key) => inherited[key] !== undefined && configured[key] !== undefined && inherited[key] !== configured[key])) {
    throw new Error("Recovery binding conflicts with configured binding");
  }
  const environment = { ...inherited, ...configured };
  environment.INGENIUM_WORKTREE ??= worktree;
  environment.INGENIUM_API_URL ??= "http://localhost:4097/api/v1";
  environment.INGENIUM_MCP_CREDENTIAL_FILE ??= ".opencode/.ingenium-mcp-credential";
  const url = new URL(environment.INGENIUM_API_URL);
  if (!SAFE_PROJECT.test(environment.INGENIUM_PROJECT ?? "") || !SAFE_ID.test(environment.INGENIUM_WORKSPACE_ID ?? "")
    || environment.INGENIUM_WORKTREE !== worktree || realpathSync(worktree) !== worktree
    || environment.INGENIUM_MCP_AUDIENCE !== "mcp"
    || (environment.INGENIUM_PROJECT_ID !== undefined && !UUID.test(environment.INGENIUM_PROJECT_ID))
    || (environment.INGENIUM_STORAGE_MAPPING_HASH !== undefined && !HASH.test(environment.INGENIUM_STORAGE_MAPPING_HASH))
    || url.username || url.password || url.search || url.hash
    || !["http://localhost:4097/api/v1", "http://127.0.0.1:4097/api/v1"].includes(environment.INGENIUM_API_URL)
    || basename(environment.INGENIUM_MCP_CREDENTIAL_FILE) !== ".ingenium-mcp-credential") {
    throw new Error("Recovery binding is unavailable");
  }
  return environment;
}

export async function corroborateRecoveryBinding(worktree, environment, request = fetch) {
  const token = readRecoveryApiToken(worktree, environment);
  const get = async (path) => {
    const response = await request(`${environment.INGENIUM_API_URL}${path}`, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(5_000),
      headers: { Authorization: `Bearer ${token}`, "X-Ingenium-Audience": "mcp",
        "X-Ingenium-Workspace": environment.INGENIUM_WORKSPACE_ID, "X-Ingenium-Launcher-Worktree": worktree },
    });
    if (response.status !== 200) throw new Error("Recovery binding authority is unavailable");
    return responseValue(await response.json());
  };
  const authority = await get("/auth/preflight");
  if (!isRecord(authority) || authority.audience !== "mcp" || !UUID.test(authority.projectId ?? "")
    || !HASH.test(authority.storageMappingHash ?? "") || !authority.projectIds?.includes(authority.projectId)
    || authority.workspaceId !== environment.INGENIUM_WORKSPACE_ID || authority.launcherWorktree !== worktree
    || (environment.INGENIUM_PROJECT_ID !== undefined && authority.projectId !== environment.INGENIUM_PROJECT_ID)
    || (environment.INGENIUM_STORAGE_MAPPING_HASH !== undefined && authority.storageMappingHash !== environment.INGENIUM_STORAGE_MAPPING_HASH)) {
    throw new Error("Recovery binding authority mismatch");
  }
  const detail = await get(`/projects/${encodeURIComponent(environment.INGENIUM_PROJECT)}/detail`);
  if (detail?.project?.id !== authority.projectId || detail.project.name !== environment.INGENIUM_PROJECT) {
    throw new Error("Recovery project authority mismatch");
  }
  return { project: environment.INGENIUM_PROJECT, projectId: authority.projectId,
    workspaceId: authority.workspaceId, storageMappingHash: authority.storageMappingHash, worktree };
}

export function recoveryEnvironmentForBinding(binding, inherited = process.env) {
  const environment = recoveryConfiguredEnvironment(binding.worktree, inherited);
  for (const [key, value] of Object.entries({ INGENIUM_PROJECT: binding.project, INGENIUM_PROJECT_ID: binding.projectId,
    INGENIUM_WORKSPACE_ID: binding.workspaceId, INGENIUM_STORAGE_MAPPING_HASH: binding.storageMappingHash,
    INGENIUM_WORKTREE: binding.worktree })) {
    if (environment[key] !== undefined && environment[key] !== value) throw new Error("Recovery admission binding changed");
    environment[key] = value;
  }
  return environment;
}

function enrollmentClassification(parent, binding, recovery) {
  if (!parent || !binding) return "ambiguous";
  if (!recovery.enrollment) return parent.nonceSha256 === "0".repeat(64) ? "legacy_unenrolled" : "unenrolled";
  const enrolled = recovery.enrollment;
  return enrolled.pid === parent.pid && enrolled.startTimeTicks === parent.startTimeTicks
    && enrolled.executableSha256 === parent.executableSha256 && enrolled.nonceSha256 === parent.nonceSha256
    && enrolled.worktree === binding.worktree && enrolled.project === binding.project
    && enrolled.projectId === binding.projectId && enrolled.workspaceId === binding.workspaceId
    && enrolled.storageMappingHash === binding.storageMappingHash && enrolled.dataHome === parent.dataHome
    && enrolled.port === parent.port ? "enrolled" : "ambiguous";
}

// The stdin-attested bootstrap cannot import generated extension code before admission.
export function readCurrentParentSummary(worktree, parent, binding, head, now = Date.now(), handoff) {
  const empty = (status) => ({ status, role: null, project: null, enrollmentSha256: null });
  const directory = resolve(worktree, ".opencode/protected-runtime-index/tui-recovery");
  try {
    for (const path of [resolve(worktree, ".opencode"), dirname(directory), directory]) {
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== ownerUid() || realpathSync(path) !== path
        || (path !== resolve(worktree, ".opencode") && (stat.mode & 0o777) !== 0o700)) return empty("invalid");
    }
    const namesAt = () => readdirSync(directory).filter((name) => name.startsWith("current-parent-") && name.endsWith(".json")).sort();
    const names = namesAt();
    if (!names.length) return empty("missing");
    if (names.length > 128 || !parent || !binding) return empty("invalid");
    const records = names.map((name) => readOnlyRegularFile(resolve(directory, name), 64 * 1024, false, 0o600));
    const candidates = [];
    for (const [index, bytes] of records.entries()) {
      const record = JSON.parse(bytes.toString("utf8"));
      if (!hasExactKeys(record, ["schemaVersion", "binding", "runtimeId", "parent", "controlPlane", "sourceHead",
        "sourceClean", "expiresAt", "sessions", "enrollmentSha256"]) || record.schemaVersion !== 1
        || !UUID.test(record.runtimeId ?? "") || names[index] !== `current-parent-${record.runtimeId}.json`
        || !hasExactKeys(record.binding, ["project", "projectId", "workspaceId", "launcherWorktree", "storageMappingHash"])
        || record.binding.project !== binding.project || record.binding.projectId !== binding.projectId
        || record.binding.workspaceId !== binding.workspaceId || record.binding.storageMappingHash !== binding.storageMappingHash
        || record.binding.launcherWorktree !== worktree || binding.worktree !== worktree
        || !hasExactKeys(record.parent, ["pid", "startTimeTicks", "executableSha256", "nonceSha256"])
        || !safeRecoveryIdentity(record.parent) || record.parent.nonceSha256 === "0".repeat(64)
        || !GIT_OID.test(record.sourceHead ?? "") || typeof record.sourceClean !== "boolean"
        || !Number.isSafeInteger(record.expiresAt) || record.expiresAt > now + 60_000
        || !Array.isArray(record.sessions) || record.sessions.length > 1) return empty("invalid");
      const { enrollmentSha256, ...payload } = record;
      if (!HASH.test(enrollmentSha256 ?? "") || sha256(JSON.stringify(payload)) !== enrollmentSha256) return empty("invalid");
      const url = new URL(record.controlPlane);
      if (url.origin !== record.controlPlane || !["http:", "https:"].includes(url.protocol)
        || !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) || url.username || url.password) return empty("invalid");
      for (const session of record.sessions) {
        if (!hasExactKeys(session, ["role", "sessionId", "coordinationSessionId", "worktreeId", "incarnation", "revision", "fence",
          "epoch", "claimReferenceSha256", "handoff"]) || typeof session.role !== "string" || !SAFE_ID.test(session.role)
          || typeof session.sessionId !== "string" || !SAFE_SESSION.test(session.sessionId)
          || session.coordinationSessionId !== `session-${sha256(session.sessionId)}`
          || session.worktreeId !== `worktree-${sha256(`${binding.workspaceId}\0${binding.storageMappingHash}`)}`
          || !Number.isSafeInteger(session.incarnation) || session.incarnation < 1
          || !Number.isSafeInteger(session.revision) || session.revision < 0
          || !Number.isSafeInteger(session.fence) || session.fence < 1
          || !(session.epoch === null || Number.isSafeInteger(session.epoch) && session.epoch > 0)
          || !(session.claimReferenceSha256 === null || typeof session.claimReferenceSha256 === "string" && HASH.test(session.claimReferenceSha256))
          || session.epoch === null && session.claimReferenceSha256 !== null) return empty("invalid");
        const h = session.handoff;
        if (!hasExactKeys(h, ["status", "taskHash", "actionsSha256", "changedPathsSha256", "checks", "todos", "nextWork"])
          || !HASH.test(h.actionsSha256 ?? "") || !HASH.test(h.changedPathsSha256 ?? "")
          || !Array.isArray(h.todos) || h.todos.length > 256
          || h.todos.some((todo) => !hasExactKeys(todo, ["idSha256", "status"]) || !HASH.test(todo.idSha256 ?? "")
            || !["pending", "in_progress", "completed", "cancelled"].includes(todo.status))
          || new Set(h.todos.map((todo) => todo.idSha256)).size !== h.todos.length
          || !hasExactKeys(h.nextWork, ["kind", "referenceHash"])
          || !safeHandoffSummary({ ...h, actions: [], changedPaths: [],
            todos: { total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0, state: "none" } })) return empty("invalid");
      }
      if (record.expiresAt <= now || !record.sessions.length) continue;
      if (!record.sourceClean || record.sourceHead !== head
        || Object.keys(record.parent).some((key) => record.parent[key] !== parent[key])
        || record.sessions[0].sessionId !== parent.sessionId
        || parent.port !== null && Number(url.port) !== parent.port) return empty("invalid");
      if (handoff) {
        const current = record.sessions[0].handoff;
        const counts = { pending: 0, inProgress: 0, completed: 0, cancelled: 0 };
        for (const todo of current.todos) counts[todo.status === "in_progress" ? "inProgress" : todo.status] += 1;
        if (current.status !== handoff.status || current.taskHash !== handoff.taskHash
          || current.checks.length !== handoff.checkCount || current.todos.length !== handoff.todos.total
          || Object.keys(counts).some((key) => counts[key] !== handoff.todos[key])
          || canonicalJson(current.nextWork) !== canonicalJson(handoff.nextWork)) return empty("invalid");
      }
      candidates.push(record);
    }
    if (JSON.stringify(namesAt()) !== JSON.stringify(names)
      || names.some((name, index) => !records[index].equals(readOnlyRegularFile(resolve(directory, name), 64 * 1024, false, 0o600)))) return empty("invalid");
    if (candidates.length !== 1) return empty("invalid");
    const record = candidates[0];
    return { status: "validated", role: record.sessions[0].role, project: record.binding.project, enrollmentSha256: record.enrollmentSha256 };
  } catch (error) {
    return empty(error?.code === "ENOENT" ? "missing" : "invalid");
  }
}

export async function collectRecoveryPreflight(options = {}) {
  const environment = options.environment ?? process.env;
  const sourcePath = resolve(options.sourcePath ?? MODULE_ATTESTATION?.sourcePath ?? fileURLToPath(import.meta.url));
  const declaredWorktree = environment.INGENIUM_WORKTREE ?? resolve(dirname(sourcePath), "../../..");
  let worktree;
  try {
    worktree = declaredWorktree && realpathSync(declaredWorktree);
    if (!worktree || worktree !== resolve(declaredWorktree)) throw new Error("worktree");
  } catch {
    worktree = null;
  }
  let source;
  if (options.verifiedSource) {
    source = options.verifiedSource;
  } else try {
    source = readTrustedRegularFile(sourcePath, "Recovery bootstrap shim", {
      expectedMode: 0o644,
      expectedOwner: ownerUid(),
    });
  } catch {}
  const ancestry = worktree ? inspectAncestry(worktree) : { status: "ambiguous", members: [], parent: null };
  const parentInternal = ancestry.parent;
  const parent = parentInternal ? Object.fromEntries(Object.entries(parentInternal).filter(([key]) => key !== "environment")) : null;
  let configuredEnvironment;
  let binding = null;
  if (worktree) try {
    configuredEnvironment = recoveryConfiguredEnvironment(worktree, environment);
    const parentEnvironment = parentInternal?.environment ?? {};
    for (const key of ["INGENIUM_PROJECT", "INGENIUM_PROJECT_ID", "INGENIUM_WORKSPACE_ID", "INGENIUM_WORKTREE", "INGENIUM_STORAGE_MAPPING_HASH", "INGENIUM_API_URL"]) {
      if (parentEnvironment[key] !== undefined && configuredEnvironment[key] !== undefined
        && parentEnvironment[key] !== configuredEnvironment[key]) throw new Error("Recovery parent binding mismatch");
    }
    binding = await corroborateRecoveryBinding(worktree, configuredEnvironment, options.request ?? fetch);
    if (parentEnvironment.INGENIUM_PROJECT_ID !== undefined && parentEnvironment.INGENIUM_PROJECT_ID !== binding.projectId
      || parentEnvironment.INGENIUM_STORAGE_MAPPING_HASH !== undefined && parentEnvironment.INGENIUM_STORAGE_MAPPING_HASH !== binding.storageMappingHash) binding = null;
  } catch {}
  let recovery = worktree ? readRecoverySummary(worktree) : {
    summary: { status: "invalid", state: null, handoff: null }, enrollment: null,
  };
  if (worktree && parentInternal && parentInternal.port !== null) {
    const live = await readLiveRecoverySummary(parentInternal, worktree, options.request ?? fetch);
    recovery = {
      summary: live ? { ...live, state: recovery.summary.state } : { status: "invalid", state: recovery.summary.state, handoff: null },
      enrollment: recovery.enrollment,
    };
  }
  const gitSummary = worktree && source
    ? collectGitSummary(worktree, source.path, source.bytes)
    : { status: "invalid", head: null, dirtyPaths: [], sourceMatchesHead: false };
  const protectedIndex = worktree ? resolve(worktree, ".opencode/protected-runtime-index") : null;
  const currentParent = worktree ? readCurrentParentSummary(worktree, parent, binding,
    gitSummary.dirtyPaths.length === 0 ? gitSummary.head : null, Date.now(), recovery.summary.handoff)
    : { status: "invalid", role: null, project: null, enrollmentSha256: null };
  const preAdmissionCapture = currentParent.status === "missing"
    ? await captureLegacyRecoveryPreAdmission(parentInternal, binding, gitSummary, options.request ?? fetch) : null;
  if (preAdmissionCapture) {
    parent.sessionId = preAdmissionCapture.snapshot.sessionId;
    recovery.summary = { status: "validated", state: recovery.summary.state, handoff: preAdmissionCapture.summary };
  }
  const coordination = protectedIndex ? summarizeCoordinationOutboxState(protectedIndex) : {
    outbox: { status: "invalid", count: 0, ambiguousCount: 0, sha256: null },
    disposition: { status: "invalid", count: 0, ambiguousCount: 0, sha256: null },
  };
  const { outbox, disposition } = coordination;
  const freeze = protectedIndex
    ? summarizeFreeze(resolve(protectedIndex, "coordination-outbox-mutation.lock"))
    : { status: "invalid", sha256: null };
  const classification = enrollmentClassification(parentInternal, binding, recovery);
  const apiHealth = await collectApiHealth(configuredEnvironment ?? {}, options.request ?? fetch);
  const ociRevision = binding && gitSummary.status === "validated"
    ? inspectRecoveryDeployment(worktree, gitSummary.head, options.inspectDeploymentCommand)
    : { status: "unavailable", provider: "docker-local", revision: null };
  const ownerPreparation = binding && gitSummary.status === "validated" ? prepareRecoveryOwnerContract(binding, gitSummary.head) : null;
  const recoveryOwner = ownerPreparation ? inspectRecoveryOwnerStatus(ownerPreparation) : { status: "unavailable", authorizesRestart: false };
  const failures = [];
  if (!worktree) failures.push("worktree");
  if (!source) failures.push("source");
  if (ancestry.status !== "exact" || !parent) failures.push("parent_identity");
  if (!binding) failures.push("binding");
  if (currentParent.status !== "validated" && !preAdmissionCapture) failures.push("current_parent");
  if (gitSummary.status !== "validated") failures.push("git");
  if (recovery.summary.status !== "validated") failures.push("recovery_handoff");
  if (recovery.summary.state && recovery.summary.state.phase !== "enrolled") failures.push("recovery_phase");
  if (classification === "ambiguous") failures.push("nonce_enrollment");
  if (recoveryOwner.status !== "attested") failures.push("recovery_owner");
  if (outbox.status === "invalid" || outbox.ambiguousCount > 0) failures.push("outbox");
  if (disposition.status === "invalid") failures.push("disposition");
  if (freeze.status === "invalid" || freeze.status === "present") failures.push("freeze");
  if (apiHealth.status !== "healthy") failures.push("api_health");
  if (ociRevision.status !== "attested") failures.push("oci_revision");
  return {
    schemaVersion: 1,
    action: "production-restart",
    admissible: failures.length === 0,
    failures: [...new Set(failures)].sort(),
    source: source ? {
      status: "validated",
      sha256: source.sha256,
      regularFile: true,
      gitMatching: gitSummary.sourceMatchesHead,
      ownerControlled: true,
      groupWorldWritable: false,
      mode: "0644",
      expectedMode: "0644",
    } : {
      status: "invalid",
      sha256: null,
      regularFile: null,
      gitMatching: false,
      ownerControlled: null,
      groupWorldWritable: null,
      mode: null,
      expectedMode: "0644",
    },
    ancestry: { status: ancestry.status, members: ancestry.members },
    parent,
    nonceEnrollment: { classification, provenance: parent?.nonceSha256 === "0".repeat(64)
      ? "absent_process_environment" : parent ? "process_environment" : "unavailable" },
    binding,
    git: gitSummary,
    recovery: recovery.summary,
    currentParent,
    preAdmissionCapture,
    ownerPreparation,
    recoveryOwner,
    outbox,
    disposition,
    freeze,
    deployed: { ociRevision, apiHealth },
  };
}

export function recoveryAdmissionPath(worktree) {
  const root = resolve(worktree);
  if (realpathSync(root) !== root) throw new Error("Recovery admission worktree is not canonical");
  return resolve(root, RECOVERY_ADMISSION_RELATIVE_PATH);
}

function recoveryAdmissionExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function expectedRecoveryAdmission(preflight, preflightDigest) {
  if (!preflight.admissible || !HASH.test(preflightDigest) || preflightDigest !== sha256(canonicalJson(preflight))
    || !GIT_OID.test(preflight.git?.head ?? "") || !preflight.parent || !preflight.binding) {
    throw new Error("Recovery admission preflight is not admissible");
  }
  return {
    schemaVersion: 1,
    action: "production-restart",
    preflightDigest,
    head: preflight.git.head,
    sourceSha256: preflight.source.sha256,
    parent: {
      pid: preflight.parent.pid,
      startTimeTicks: preflight.parent.startTimeTicks,
      executableSha256: preflight.parent.executableSha256,
      nonceSha256: preflight.parent.nonceSha256,
      sessionId: preflight.parent.sessionId,
    },
    binding: {
      project: preflight.binding.project,
      projectId: preflight.binding.projectId,
      workspaceId: preflight.binding.workspaceId,
      storageMappingHash: preflight.binding.storageMappingHash,
      worktree: preflight.binding.worktree,
    },
  };
}

export function readRecoveryAdmission(path, preflight, preflightDigest, now = Date.now()) {
  const expected = expectedRecoveryAdmission(preflight, preflightDigest);
  const requested = resolve(path);
  const parent = dirname(requested);
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || parentStat.uid !== ownerUid()
    || (parentStat.mode & 0o022) !== 0 || realpathSync(parent) !== parent) {
    throw new Error("Recovery admission directory is not trusted");
  }
  const bytes = readOnlyRegularFile(requested, RECOVERY_ADMISSION_MAX_BYTES, false, 0o600);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error("Recovery admission artifact is invalid");
  let admission;
  try { admission = JSON.parse(text); } catch { throw new Error("Recovery admission artifact is invalid"); }
  const server = admission?.admission;
  const issuedAt = Date.parse(server?.issuedAt);
  const expiresAt = Date.parse(server?.expiresAt);
  let executableSha256;
  try { executableSha256 = sha256(readFileSync(realpathSync(server?.parent?.executable))); } catch {}
  if (!hasExactKeys(admission, ["incarnation", "admission", "consumeToken"])
    || !Number.isSafeInteger(admission.incarnation) || admission.incarnation < 1
    || !OPAQUE_TOKEN.test(admission.consumeToken ?? "") || admission.consumeToken.length !== 43
    || !hasExactKeys(server, SERVER_ADMISSION_KEYS)
    || server.schema !== "ingenium.recovery-admission" || server.version !== 1 || server.action !== expected.action
    || server.preflightDigest !== expected.preflightDigest || server.head !== expected.head
    || !hasExactKeys(server.parent, ["pid", "start", "executable", "nonce", "session"])
    || server.parent.pid !== expected.parent.pid || server.parent.start !== String(expected.parent.startTimeTicks)
    || executableSha256 !== expected.parent.executableSha256 || sha256(server.parent.nonce ?? "") !== expected.parent.nonceSha256
    || server.parent.session !== expected.parent.sessionId || !OPAQUE_TOKEN.test(server.parent.nonce ?? "")
    || server.project !== expected.binding.project || server.projectId !== expected.binding.projectId
    || server.workspace !== expected.binding.workspaceId || server.storage !== expected.binding.storageMappingHash
    || server.worktree !== expected.binding.worktree
    || server.worktreeId !== `worktree-${sha256(`${expected.binding.workspaceId}\0${expected.binding.storageMappingHash}`)}`
    || !Number.isSafeInteger(server.revision) || server.revision < 0
    || !Number.isSafeInteger(server.fence) || server.fence < 1
    || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
    || new Date(issuedAt).toISOString() !== server.issuedAt || new Date(expiresAt).toISOString() !== server.expiresAt
    || issuedAt > now + 30_000 || expiresAt <= now || expiresAt <= issuedAt
    || expiresAt - issuedAt > RECOVERY_ADMISSION_LIFETIME_MS) {
    throw new Error("Recovery admission artifact does not match the current preflight");
  }
  return Object.freeze({
    ...admission,
    admission: Object.freeze({ ...server, parent: Object.freeze({ ...server.parent }) }),
  });
}

function readRecoveryApiToken(worktree, environment) {
  const reference = environment.INGENIUM_MCP_CREDENTIAL_FILE;
  if (typeof reference !== "string" || reference.length < 1 || reference.length > 1024) {
    throw new Error("Recovery admission authentication is unavailable");
  }
  const path = isAbsolute(reference) ? resolve(reference) : resolve(worktree, reference);
  let descriptor;
  let bytes;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || opened.uid !== ownerUid()
      || (opened.mode & 0o777) !== 0o600 || opened.size < 32 || opened.size > 256) {
      throw new Error("Recovery admission authentication is unavailable");
    }
    bytes = readBoundedDescriptor(descriptor, 256);
    const after = fstatSync(descriptor);
    const current = lstatSync(path);
    if (!sourceIdentityMatches(opened, after) || !current.isFile() || current.isSymbolicLink()
      || !sourceIdentityMatches(opened, current) || (current.mode & 0o777) !== 0o600) {
      throw new Error("Recovery admission authentication is unavailable");
    }
  } catch {
    throw new Error("Recovery admission authentication is unavailable");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  const token = bytes.toString("utf8").replace(/\n$/, "");
  if (!API_TOKEN.test(token) || Buffer.byteLength(`${token}${bytes.at(-1) === 0x0a ? "\n" : ""}`) !== bytes.length) {
    throw new Error("Recovery admission authentication is unavailable");
  }
  return token;
}

export async function consumeRecoveryAdmission(admission, context, options = {}) {
  const environment = options.environment ?? process.env;
  if (environment.INGENIUM_PROJECT !== context.binding.project
    || environment.INGENIUM_PROJECT_ID !== context.binding.projectId
    || environment.INGENIUM_WORKSPACE_ID !== context.binding.workspaceId
    || environment.INGENIUM_STORAGE_MAPPING_HASH !== context.binding.storageMappingHash
    || environment.INGENIUM_WORKTREE !== context.binding.worktree
    || environment.INGENIUM_MCP_AUDIENCE !== "mcp") {
    throw new Error("Recovery admission binding changed");
  }
  let base;
  try {
    base = new URL(environment.INGENIUM_API_URL);
  } catch {
    throw new Error("Recovery admission API is unavailable");
  }
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(base.hostname)
    || base.username || base.password || base.search || base.hash) {
    throw new Error("Recovery admission API is unavailable");
  }
  const token = readRecoveryApiToken(context.binding.worktree, environment);
  const endpoint = new URL(`${base.href.replace(/\/$/, "")}/coordination/recovery-admissions/consume`);
  endpoint.searchParams.set("project", context.binding.project);
  let response;
  try {
    response = await (options.request ?? fetch)(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Ingenium-Audience": "mcp",
        "X-Ingenium-Workspace": context.binding.workspaceId,
        "X-Ingenium-Launcher-Worktree": context.binding.worktree,
      },
      body: canonicalJson({
        worktree_id: admission.admission.worktreeId,
        session_id: admission.admission.parent.session,
        incarnation: admission.incarnation,
        expected_revision: admission.admission.revision,
        fence: admission.admission.fence,
        consume_token: admission.consumeToken,
        admission: admission.admission,
      }),
    });
    const payload = await response.json();
    if (response.status !== 200 || !hasExactKeys(payload, ["data"])
      || !hasExactKeys(payload.data, ["session", "receipt"])
      || payload.data.session?.state !== "closed"
      || payload.data.session?.revision !== admission.admission.revision + 1) {
      throw new Error("invalid");
    }
    const receipt = validatedRecoveryAdmissionReceipt(payload.data.receipt, admission.admission);
    return validatedAdmittedRecoveryContext(
      admittedRecoveryContext(admission.admission, receipt),
      context,
      admission.admission,
    );
  } catch {
    throw new Error("Recovery admission could not be consumed");
  }
}

function validatedRecoveryAdmissionReceipt(receipt, admission) {
  if (!hasExactKeys(receipt, SERVER_RECEIPT_KEYS)
    || typeof receipt.id !== "string" || !UUID.test(receipt.id)
    || receipt.schema !== "ingenium.recovery-admission-receipt"
    || receipt.version !== 1 || receipt.action !== "production-restart"
    || typeof receipt.admissionDigest !== "string" || !HASH.test(receipt.admissionDigest)
    || receipt.admissionDigest !== sha256(canonicalJson(admission))
    || !isCanonicalRfc3339(receipt.consumedAt)) {
    throw new Error("Recovery admission receipt is invalid");
  }
  return Object.freeze({ ...receipt });
}

function admittedRecoveryContext(admission, receipt) {
  const startTimeTicks = Number(admission.parent.start);
  let executableSha256;
  try { executableSha256 = sha256(readFileSync(realpathSync(admission.parent.executable))); } catch {}
  if (!Number.isSafeInteger(startTimeTicks) || startTimeTicks < 1 || !HASH.test(executableSha256 ?? "")) {
    throw new Error("Recovery admission receipt is invalid");
  }
  return Object.freeze({
    schemaVersion: receipt.version,
    action: receipt.action,
    preflightDigest: admission.preflightDigest,
    head: admission.head,
    parent: Object.freeze({
      pid: admission.parent.pid,
      startTimeTicks,
      executableSha256,
      nonceSha256: sha256(admission.parent.nonce),
      sessionId: admission.parent.session,
    }),
    binding: Object.freeze({
      project: admission.project,
      projectId: admission.projectId,
      workspaceId: admission.workspace,
      storageMappingHash: admission.storage,
      worktree: admission.worktree,
    }),
    receipt,
  });
}

function expectedAdmittedRecoveryContext(preflight, preflightDigest) {
  const expected = expectedRecoveryAdmission(preflight, preflightDigest);
  return Object.freeze({
    schemaVersion: expected.schemaVersion,
    action: expected.action,
    preflightDigest: expected.preflightDigest,
    head: expected.head,
    parent: Object.freeze({ ...expected.parent }),
    binding: Object.freeze({ ...expected.binding }),
  });
}

function validatedAdmittedRecoveryContext(context, expected, admission) {
  if (!hasExactKeys(context, ["schemaVersion", "action", "preflightDigest", "head", "parent", "binding", "receipt"])
    || !Object.isFrozen(context) || !Object.isFrozen(context.parent) || !Object.isFrozen(context.binding)
    || !Object.isFrozen(context.receipt)
    || canonicalJson({
      schemaVersion: context.schemaVersion,
      action: context.action,
      preflightDigest: context.preflightDigest,
      head: context.head,
      parent: context.parent,
      binding: context.binding,
    }) !== canonicalJson(expected)
    || canonicalJson(validatedRecoveryAdmissionReceipt(context.receipt, admission)) !== canonicalJson(context.receipt)) {
    throw new Error("Recovery admission receipt is invalid");
  }
  return context;
}

function assertUnchangedRecoveryPreflight(current, expectedDigest) {
  const currentDigest = sha256(canonicalJson(current));
  if (!current.admissible || currentDigest !== expectedDigest) {
    throw new Error("Recovery admission preflight changed before consumption");
  }
}

function recheckHeadAndParent(context, sourceHandle) {
  try {
    sourceHandle.revalidate();
  } catch {
    throw new Error("Recovery bootstrap source or Git HEAD changed after admission consumption");
  }
  const ancestry = inspectAncestry(context.binding.worktree);
  const parent = ancestry.parent;
  if (ancestry.status !== "exact" || !parent
    || canonicalJson({
      pid: parent.pid,
      startTimeTicks: parent.startTimeTicks,
      executableSha256: parent.executableSha256,
      nonceSha256: parent.nonceSha256,
      sessionId: parent.sessionId,
    }) !== canonicalJson(context.parent)) {
    throw new Error("Recovery parent changed after admission consumption");
  }
}

export function normalizeTrustedRegularFileMode(path, label, expectedMode, expectedOwner = ownerUid()) {
  const canonical = resolve(path);
  if ((expectedMode & 0o022) !== 0) throw new TrustedRegularFileError(label, "mode");
  const reference = lstatSync(canonical);
  let descriptor;
  try {
    descriptor = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    const mode = opened.mode & 0o777;
    if (!reference.isFile() || reference.isSymbolicLink() || reference.nlink !== 1
      || !opened.isFile() || opened.nlink !== 1) throw new TrustedRegularFileError(label, "regular_file");
    if (reference.dev !== opened.dev || reference.ino !== opened.ino) throw new TrustedRegularFileError(label, "identity");
    if (reference.uid !== expectedOwner || opened.uid !== expectedOwner) throw new TrustedRegularFileError(label, "owner");
    if ((mode & expectedMode) !== expectedMode) throw new TrustedRegularFileError(label, "mode");
    if (mode !== expectedMode) {
      fchmodSync(descriptor, expectedMode);
      fsyncSync(descriptor);
    }
    const hardened = fstatSync(descriptor);
    const current = lstatSync(canonical);
    if (!hardened.isFile() || hardened.nlink !== 1 || (hardened.mode & 0o777) !== expectedMode
      || hardened.dev !== opened.dev || hardened.ino !== opened.ino || hardened.size !== opened.size
      || hardened.mtimeMs !== opened.mtimeMs || !current.isFile() || current.isSymbolicLink()
      || current.dev !== opened.dev || current.ino !== opened.ino || (current.mode & 0o777) !== expectedMode) {
      throw new TrustedRegularFileError(label, "identity");
    }
    return canonical;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function privateTemporaryRoot(owner) {
  const root = dirname(CANONICAL_DIRECTORY_AUDIT_PATH);
  try {
    mkdirSync(root, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return canonicalOwnedDirectory(root, "Recovery temporary root", owner);
}

export function canonicalDirectoryAuditJsonl(audits) {
  const keys = ["afterMode", "beforeMode", "directoryPathSha256", "result", "role", "timestamp"];
  if (audits.length !== CANONICAL_DIRECTORY_ROLES.length
    || audits.some((audit, index) => audit.role !== CANONICAL_DIRECTORY_ROLES[index]
      || Object.keys(audit).sort().some((key, keyIndex) => key !== keys[keyIndex])
      || !/^[0-9a-f]{64}$/.test(audit.directoryPathSha256)
      || !/^[0-7]{4}$/.test(audit.beforeMode) || !/^[0-7]{4}$/.test(audit.afterMode)
      || !["hardened", "validated"].includes(audit.result)
      || new Date(audit.timestamp).toISOString() !== audit.timestamp)) {
    throw new Error("Recovery canonical directory audit is incomplete");
  }
  const lines = audits.map((audit) => JSON.stringify(audit));
  if (lines.some((line) => Buffer.byteLength(line) >= 512)) {
    throw new Error("Recovery canonical directory audit record is too large");
  }
  return Buffer.from(`${lines.join("\n")}\n`);
}

function retainCanonicalDirectoryAudit(audits, owner) {
  const root = privateTemporaryRoot(owner);
  const directory = mkdtempSync(resolve(root, "recovery-directory-audit-"));
  const stagedPath = resolve(directory, "audit.json");
  const bytes = canonicalDirectoryAuditJsonl(audits);
  let moved = false;
  try {
    writeFileSync(stagedPath, bytes, { flag: "wx", mode: 0o600 });
    const staged = readTrustedRegularFile(stagedPath, "Recovery directory audit", {
      expectedMode: 0o600,
      expectedOwner: owner,
    });
    if (!staged.bytes.equals(bytes)) throw new Error("Recovery directory audit content changed");
    renameSync(stagedPath, CANONICAL_DIRECTORY_AUDIT_PATH);
    moved = true;
    const rootDescriptor = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      fsyncSync(rootDescriptor);
    } finally {
      closeSync(rootDescriptor);
    }
  } finally {
    if (!moved) {
      try {
        unlinkSync(stagedPath);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    rmdirSync(directory);
  }
}

export function hardenCanonicalRepositoryDirectories(sourcePath, expectedRepositoryRoot, owner = ownerUid(), options = {}) {
  const source = resolve(sourcePath);
  const scriptsPath = dirname(source);
  const packageRoot = resolve(scriptsPath, "..");
  const packagesRoot = resolve(packageRoot, "..");
  const repoRoot = resolve(packagesRoot, "..");
  if (repoRoot !== resolve(expectedRepositoryRoot)
    || basename(packageRoot) !== "ingenium-extension" || basename(packagesRoot) !== "packages"
    || packagesRoot !== resolve(repoRoot, "packages")
    || packageRoot !== resolve(packagesRoot, "ingenium-extension")
    || scriptsPath !== resolve(packageRoot, "scripts")
    || source !== resolve(scriptsPath, "recovery-bootstrap.js")) {
    throw new Error("Recovery bootstrap shim is outside the canonical extension package");
  }

  const audits = [];
  const directories = [
    { role: CANONICAL_DIRECTORY_ROLES[0], path: repoRoot, label: "Repository root" },
    { role: CANONICAL_DIRECTORY_ROLES[1], path: packagesRoot, label: "Packages root" },
    { role: CANONICAL_DIRECTORY_ROLES[2], path: packageRoot, label: "Extension package root" },
    { role: CANONICAL_DIRECTORY_ROLES[3], path: scriptsPath, label: "Extension scripts directory" },
  ];
  for (const directory of directories) {
    canonicalOwnedDirectory(directory.path, directory.label, owner, {
      auditRole: directory.role,
      hardenWritablePath: directory.path,
      retainAudit: (audit) => audits.push(audit),
      fileSystem: options.fileSystem,
      afterOpen: options.afterOpen,
    });
  }
  options.retainAudit?.(audits);
  return { repoRoot, packagesRoot, packageRoot, scriptsPath };
}

export function hardenGeneratedBootstrapDirectories(packageRoot, owner = ownerUid(), options = {}) {
  const distPath = resolve(packageRoot, "dist");
  const scriptsPath = resolve(distPath, "scripts");
  for (const [path, label] of [[distPath, "Generated distribution directory"], [scriptsPath, "Generated scripts directory"]]) {
    canonicalOwnedDirectory(path, label, owner, {
      hardenWritablePath: path,
      fileSystem: options.fileSystem,
      afterOpen: options.afterOpen,
    });
  }
  return scriptsPath;
}

function gitEnvironment() {
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_LITERAL_PATHSPECS: "1",
    GIT_OPTIONAL_LOCKS: "0",
  };
}

function git(root, args, encoding = "buffer") {
  return execFileSync(GIT, ["-C", root, "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], {
    encoding,
    env: gitEnvironment(),
    maxBuffer: 16 * 1024 * 1024,
    timeout: 10_000,
  });
}

function gitConfigurationEnvironment() {
  const env = gitEnvironment();
  delete env.GIT_CONFIG_GLOBAL;
  return env;
}

function gitConfiguration(root) {
  const options = {
    encoding: "utf8",
    env: gitConfigurationEnvironment(),
    maxBuffer: 16 * 1024 * 1024,
    timeout: 10_000,
  };
  let worktreeConfig;
  try {
    worktreeConfig = execFileSync(
      GIT,
      ["-C", root, "config", "--local", "--bool", "--get", "extensions.worktreeConfig"],
      options,
    ).trim();
  } catch (error) {
    if (error?.status === 1) worktreeConfig = "false";
    else throw new Error("Recovery bootstrap worktreeConfig probe failed", { cause: error });
  }
  if (worktreeConfig !== "true" && worktreeConfig !== "false") {
    throw new Error("Recovery bootstrap worktreeConfig probe is invalid");
  }
  const configuration = execFileSync(
    GIT,
    ["-C", root, "config", "--null", "--local", "--list", "--includes"],
    options,
  ).split("\0");
  if (worktreeConfig === "true") {
    configuration.push(...execFileSync(
      GIT,
      ["-C", root, "config", "--null", "--worktree", "--list", "--includes"],
      options,
    ).split("\0"));
  }
  return configuration;
}

export function isExecutableGitConfiguration(entry) {
  const separator = entry.indexOf("\n");
  const key = separator === -1 ? entry : entry.slice(0, separator);
  const value = separator === -1 ? "" : entry.slice(separator + 1);
  return EXECUTABLE_GIT_CONFIGURATION.test(key)
    || (/^alias\./i.test(key) && value.trimStart().startsWith("!"));
}

export function verifyScopedCheckpoint(root, sourcePath, sourceBytes) {
  const canonicalRoot = canonicalOwnedDirectory(root, "Repository root");
  const configuration = gitConfiguration(canonicalRoot);
  if (configuration.some(isExecutableGitConfiguration)) {
    throw new Error("Recovery bootstrap checkpoint rejected executable Git configuration");
  }
  const topLevel = git(canonicalRoot, ["rev-parse", "--show-toplevel"], "utf8").trim();
  const head = git(canonicalRoot, ["rev-parse", "--verify", "HEAD"], "utf8").trim();
  if (topLevel !== canonicalRoot || !/^[0-9a-f]{40,64}$/.test(head)) {
    throw new Error("Recovery bootstrap checkpoint identity is invalid");
  }
  const relativeSource = "packages/ingenium-extension/scripts/recovery-bootstrap.js";
  if (resolve(canonicalRoot, relativeSource) !== sourcePath
    || !Buffer.from(git(canonicalRoot, ["show", `${head}:${relativeSource}`])).equals(sourceBytes)) {
    throw new Error("Recovery bootstrap shim does not match reviewed Git HEAD");
  }
  try {
    git(canonicalRoot, ["diff", "--no-ext-diff", "--quiet", head, "--", ...CHECKPOINT_PATHS]);
  } catch {
    throw new Error("Recovery bootstrap scoped checkpoint has tracked drift");
  }
  const untracked = git(canonicalRoot, ["ls-files", "-z", "--others", "--exclude-standard", "--", ...CHECKPOINT_PATHS]);
  if (untracked.length !== 0) throw new Error("Recovery bootstrap scoped checkpoint has untracked drift");
  return head;
}

function selectedEnvironment(source, names) {
  return Object.fromEntries(names.flatMap((name) => source[name] === undefined ? [] : [[name, source[name]]]));
}

function childEnvironment(names, runtime, extra = {}) {
  return {
    ...selectedEnvironment(process.env, names),
    PATH: `${dirname(runtime)}:/usr/local/bin:/usr/bin:/bin`,
    ...extra,
  };
}

function processStat(pid) {
  try {
    const source = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = source.lastIndexOf(")");
    if (closeParen < 1) return undefined;
    const fields = source.slice(closeParen + 1).trim().split(/\s+/);
    const processGroupId = Number(fields[2]);
    const startTimeTicks = Number(fields[19]);
    return Number.isSafeInteger(processGroupId) && processGroupId > 0
      && Number.isSafeInteger(startTimeTicks) && startTimeTicks > 0
      ? { processGroupId, startTimeTicks }
      : undefined;
  } catch {
    return undefined;
  }
}

function processEnvironmentHasNonce(pid, nonce) {
  try {
    return readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").includes(`${CHILD_NONCE}=${nonce}`);
  } catch {
    return false;
  }
}

function processIdentity(pid, nonce) {
  const stat = processStat(pid);
  if (!stat || !processEnvironmentHasNonce(pid, nonce)) return undefined;
  try {
    const executable = realpathSync(readlinkSync(`/proc/${pid}/exe`));
    return { pid, ...stat, executableSha256: sha256(readFileSync(executable)) };
  } catch {
    return undefined;
  }
}

function processGroupMembers(processGroupId, nonce) {
  const members = new Map();
  for (const entry of readdirSync("/proc")) {
    if (!/^[1-9][0-9]*$/.test(entry)) continue;
    const pid = Number(entry);
    if (processStat(pid)?.processGroupId !== processGroupId) continue;
    const identity = processIdentity(pid, nonce);
    if (!identity) throw new Error("Recovery child process group contains an unattested member");
    members.set(identity.pid, identity);
  }
  return members;
}

function sameProcess(left, right) {
  return left?.pid === right.pid && left.startTimeTicks === right.startTimeTicks
    && left.processGroupId === right.processGroupId && left.executableSha256 === right.executableSha256;
}

function attestProcessGroup(identity, allowNewMembers) {
  const current = processGroupMembers(identity.pid, identity.nonce);
  if (current.size === 0) return false;
  for (const [pid, member] of current) {
    const expected = identity.members.get(pid);
    if (expected && !sameProcess(member, expected)) throw new Error("Recovery child process-group identity changed before signal");
    if (!expected && !allowNewMembers) throw new Error("Recovery child process group gained an ambiguous member");
    identity.members.set(pid, member);
  }
  const confirmed = processGroupMembers(identity.pid, identity.nonce);
  if (confirmed.size !== current.size
    || [...confirmed].some(([pid, member]) => !sameProcess(member, identity.members.get(pid)))) {
    throw new Error("Recovery child process group changed during signal attestation");
  }
  return true;
}

function signalProcessGroup(identity, signal, allowNewMembers) {
  if (!attestProcessGroup(identity, allowNewMembers)) return;
  try {
    process.kill(-identity.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function waitForProcessLeader(pid, nonce) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const identity = processIdentity(pid, nonce);
    if (identity?.processGroupId === pid) return identity;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  return undefined;
}

async function runFixed(command, args, timeoutMs, env, cwd) {
  const nonce = randomBytes(32).toString("base64url");
  const child = spawn(command, args, {
    cwd,
    detached: true,
    env: { ...env, [CHILD_NONCE]: nonce },
    shell: false,
    stdio: "inherit",
  });
  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once("error", rejectSpawn);
    child.once("spawn", resolveSpawn);
  });
  if (!child.pid) throw new Error("Recovery bootstrap shim could not identify its child");
  const leader = await waitForProcessLeader(child.pid, nonce);
  if (!leader) {
    throw new Error("Recovery bootstrap shim child identity is unavailable");
  }
  const identity = { pid: child.pid, nonce, members: new Map([[child.pid, leader]]) };

  return await new Promise((resolveResult, reject) => {
    let timedOut = false;
    let forwardedSignal;
    let forceTimer;
    let settled = false;
    const finish = () => {
      clearTimeout(timeout);
      if (forceTimer) clearTimeout(forceTimer);
      for (const [signal, handler] of Object.entries(handlers)) process.off(signal, handler);
    };
    const failClosed = (error) => {
      if (settled) return;
      settled = true;
      finish();
      child.unref();
      reject(error);
    };
    const forward = (signal, allowNewMembers) => {
      try {
        signalProcessGroup(identity, signal, allowNewMembers);
      } catch (error) {
        failClosed(error);
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      forward("SIGTERM", true);
      if (!settled) forceTimer = setTimeout(() => forward("SIGKILL", false), CLEANUP_GRACE_MS);
    }, timeoutMs);
    const handlers = Object.fromEntries(SIGNALS.map((signal) => [signal, () => {
      forwardedSignal ??= signal;
      forward(signal, true);
      if (!settled) forceTimer ??= setTimeout(() => forward("SIGKILL", false), CLEANUP_GRACE_MS);
    }]));
    for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler);
    child.once("error", failClosed);
    child.once("close", (status, signal) => {
      if (settled) return;
      if (timedOut || forwardedSignal) forward("SIGKILL", false);
      if (settled) return;
      settled = true;
      finish();
      resolveResult({ status, signal: forwardedSignal ?? signal, timedOut });
    });
  });
}

function propagate(result, timeoutLabel) {
  if (result.timedOut) {
    console.error(`${timeoutLabel} timed out`);
    process.exitCode = 124;
    return false;
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return false;
  }
  process.exitCode = result.status ?? 1;
  return result.status === 0;
}

function privateStagedBootstrap(bytes, owner) {
  const root = privateTemporaryRoot(owner);
  const directory = mkdtempSync(resolve(root, "recovery-bootstrap-"));
  canonicalOwnedDirectory(directory, "Recovery staging directory", owner);
  const path = resolve(directory, "recovery-bootstrap.js");
  writeFileSync(path, bytes, { flag: "wx", mode: 0o400 });
  const staged = readTrustedRegularFile(path, "Staged recovery bootstrap", { expectedMode: 0o400, expectedOwner: owner });
  if (!staged.bytes.equals(bytes)) throw new Error("Staged recovery bootstrap content changed");
  return {
    path,
    sha256: staged.sha256,
    cleanup() {
      unlinkSync(path);
      rmdirSync(directory);
    },
  };
}

export function privateNpmConfiguration(owner = ownerUid()) {
  const root = privateTemporaryRoot(owner);
  const directory = mkdtempSync(resolve(root, "recovery-npm-config-"));
  canonicalOwnedDirectory(directory, "Recovery npm configuration directory", owner);
  const created = [];
  const create = (name) => {
    const path = resolve(directory, name);
    writeFileSync(path, "", { flag: "wx", mode: 0o400 });
    created.push(path);
    const file = readTrustedRegularFile(path, `Recovery npm ${name}`, { expectedMode: 0o400, expectedOwner: owner });
    if (file.bytes.length !== 0) throw new Error("Recovery npm configuration is not empty");
    return file.path;
  };
  let userConfig;
  let globalConfig;
  try {
    userConfig = create("user.npmrc");
    globalConfig = create("global.npmrc");
  } catch (error) {
    for (const path of created.reverse()) unlinkSync(path);
    rmdirSync(directory);
    throw error;
  }
  return {
    userConfig,
    globalConfig,
    cleanup() {
      try {
        unlinkSync(userConfig);
      } finally {
        try {
          unlinkSync(globalConfig);
        } finally {
          rmdirSync(directory);
        }
      }
    },
  };
}

async function runAdmittedRecoveryBootstrapShim(argv, context, attestedSource) {
  if (argv.length !== 2) throw new Error("Recovery bootstrap shim accepts no arguments");
  if (!Object.isFrozen(context) || !Object.isFrozen(context.parent) || !Object.isFrozen(context.binding)
    || !Object.isFrozen(context.receipt) || context.head !== attestedSource.head
    || sha256(attestedSource.bytes) !== attestedSource.sha256) {
    throw new Error("Recovery bootstrap admitted context is invalid");
  }
  const owner = ownerUid();
  const sourcePath = resolve(attestedSource.path);
  const declaredWorktree = context.binding.worktree;
  try {
    if (realpathSync(declaredWorktree) !== resolve(declaredWorktree)
      || sourcePath !== resolve(declaredWorktree, "packages/ingenium-extension/scripts/recovery-bootstrap.js")) {
      throw new Error("Recovery bootstrap shim requires the attested canonical worktree");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Recovery bootstrap shim requires the attested canonical worktree") {
      throw error;
    }
    throw new Error("Recovery bootstrap shim requires the attested canonical worktree");
  }
  const { repoRoot, packageRoot, scriptsPath } = hardenCanonicalRepositoryDirectories(
    sourcePath,
    declaredWorktree,
    owner,
    { retainAudit: (audits) => retainCanonicalDirectoryAudit(audits, owner) },
  );
  const source = { path: sourcePath, bytes: attestedSource.bytes };
  verifyScopedCheckpoint(repoRoot, source.path, source.bytes);

  const runtimeOwner = lstatSync(realpathSync(process.execPath)).uid;
  if (runtimeOwner !== 0 && runtimeOwner !== owner) throw new Error("Node runtime owner is not trusted");
  const runtime = readTrustedRegularFile(process.execPath, "Node runtime", {
    executable: true,
    expectedOwner: runtimeOwner,
  }).path;
  const npm = readTrustedRegularFile(resolve(dirname(process.execPath), "npm"), "Adjacent npm executable", {
    allowReferenceSymlink: true,
    executable: true,
    expectedOwner: runtimeOwner,
  }).path;
  const npmConfiguration = privateNpmConfiguration(owner);
  try {
    const recoveryEnvironment = {
      ...selectedEnvironment(recoveryEnvironmentForBinding(context.binding), RECOVERY_ENVIRONMENT),
      [CANONICAL_WORKTREE]: repoRoot,
      INGENIUM_WORKTREE: repoRoot,
      [ADMITTED_RECOVERY_CONTEXT]: canonicalJson(context),
    };
    const build = await runFixed(
      npm,
      ["run", "build", "--workspace=packages/ingenium-extension"],
      BUILD_TIMEOUT_MS,
      childEnvironment(BUILD_ENVIRONMENT, runtime, {
        ...recoveryEnvironment,
        NPM_CONFIG_GLOBALCONFIG: npmConfiguration.globalConfig,
        NPM_CONFIG_SCRIPT_SHELL: "/bin/sh",
        NPM_CONFIG_USERCONFIG: npmConfiguration.userConfig,
      }),
      repoRoot,
    );
    if (!propagate(build, "Extension recovery bootstrap build")) return;
    verifyScopedCheckpoint(repoRoot, source.path, source.bytes);

    const generatedDirectory = hardenGeneratedBootstrapDirectories(packageRoot, owner);
    normalizeTrustedRegularFileMode(
      resolve(generatedDirectory, "recovery-bootstrap.js"),
      "Generated recovery bootstrap",
      0o555,
      owner,
    );
    const generated = readTrustedRegularFile(resolve(generatedDirectory, "recovery-bootstrap.js"), "Generated recovery bootstrap", {
      executable: true,
      expectedMode: 0o555,
      expectedOwner: owner,
    });
    if (generated.path !== resolve(repoRoot, "packages/ingenium-extension/dist/scripts/recovery-bootstrap.js")) {
      throw new Error("Generated recovery bootstrap path is invalid");
    }
    const staged = privateStagedBootstrap(generated.bytes, owner);
    try {
      const generatedModule = await import(`${pathToFileURL(staged.path).href}?inspect=1`);
      const declaredRuntimeMs = generatedModule.RECOVERY_BOOTSTRAP_MAX_RUNTIME_MS;
      if (!Number.isSafeInteger(declaredRuntimeMs) || declaredRuntimeMs < 1
        || declaredRuntimeMs > MAX_TIMER_MS - GENERATED_TIMEOUT_GRACE_MS) {
        throw new Error("Generated recovery bootstrap timeout declaration is invalid");
      }
      const generatedResult = await runFixed(
        runtime,
        [staged.path],
        declaredRuntimeMs + GENERATED_TIMEOUT_GRACE_MS,
        childEnvironment(RECOVERY_ENVIRONMENT, runtime, {
          ...recoveryEnvironment,
          [GENERATED_BOOTSTRAP_SHA256]: staged.sha256,
        }),
        repoRoot,
      );
      propagate(generatedResult, "Generated recovery bootstrap");
    } finally {
      staged.cleanup();
    }
  } finally {
    npmConfiguration.cleanup();
  }
}

export async function runRecoveryBootstrapShim(argv = process.argv, dependencies = {}) {
  if (argv.length !== 2) throw new Error("Recovery bootstrap shim accepts no arguments");
  const sourceHandle = (dependencies.openSource ?? openVerifiedRecoverySource)(dependencies.attestation ?? MODULE_ATTESTATION);
  try {
    const collect = dependencies.collectPreflight ?? collectRecoveryPreflight;
    const preflight = await collect({
      environment: process.env,
      sourcePath: sourceHandle.source.path,
      verifiedSource: sourceHandle.source,
    });
    const { digest, output } = recoveryPreflightOutput(preflight);
    const admissionPath = dependencies.admissionPath
      ?? (preflight.binding?.worktree ? recoveryAdmissionPath(preflight.binding.worktree) : undefined);
    const exists = dependencies.admissionExists ?? recoveryAdmissionExists;
    if (!admissionPath || !exists(admissionPath)) {
      (dependencies.writeOutput ?? ((value) => process.stdout.write(value)))(`${output}\n`);
      return;
    }
    let admission = (dependencies.readAdmission ?? readRecoveryAdmission)(
      admissionPath,
      preflight,
      digest,
      (dependencies.now ?? Date.now)(),
    );
    const current = await collect({
      environment: process.env,
      sourcePath: sourceHandle.source.path,
      verifiedSource: sourceHandle.revalidate(),
    });
    assertUnchangedRecoveryPreflight(current, digest);
    const expectedContext = expectedAdmittedRecoveryContext(current, digest);
    sourceHandle.revalidate();
    const context = validatedAdmittedRecoveryContext(
      await (dependencies.consumeAdmission ?? ((record, expected) => consumeRecoveryAdmission(record, expected, {
        environment: recoveryEnvironmentForBinding(expected.binding),
      })))(admission, expectedContext),
      expectedContext,
      admission.admission,
    );
    try {
      (dependencies.discardAdmission ?? unlinkSync)(admissionPath);
    } finally {
      admission = undefined;
    }
    (dependencies.postConsumeCheck ?? recheckHeadAndParent)(context, sourceHandle);
    await (dependencies.executeAdmitted ?? runAdmittedRecoveryBootstrapShim)(argv, context, sourceHandle.source);
  } finally {
    sourceHandle.close();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : undefined;
if (MODULE_ATTESTATION || invokedPath === import.meta.url) {
  await runRecoveryBootstrapShim(MODULE_ATTESTATION ? [process.execPath, MODULE_ATTESTATION.sourcePath] : process.argv);
}
