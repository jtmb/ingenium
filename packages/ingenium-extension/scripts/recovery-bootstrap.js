#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
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
// This source shim runs before extension build output exists, so it mirrors the authenticated preflight's strict cap.
const PREFLIGHT_RETRY_DELAY_CAP_MS = 2_000;
const CHILD_NONCE = "INGENIUM_RECOVERY_SHIM_CHILD_NONCE";
const CANONICAL_WORKTREE = "INGENIUM_RECOVERY_CANONICAL_WORKTREE";
const GENERATED_BOOTSTRAP_SHA256 = "INGENIUM_RECOVERY_GENERATED_BOOTSTRAP_SHA256";
const RECOVERY_ATTESTED_CONTEXT = "INGENIUM_RECOVERY_ATTESTED_CONTEXT";
const RECOVERY_PREFLIGHT = "INGENIUM_RECOVERY_PREFLIGHT";
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
const SAFE_OPERATIONAL_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_MODEL_METADATA = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
const API_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const RECOVERY_SOURCE_MAX_BYTES = 256 * 1024;
const RECOVERY_ADMISSION_MAX_BYTES = 16 * 1024;
const RECOVERY_ADMISSION_LIFETIME_MS = 15 * 60 * 1_000;
const LEGACY_SESSION_DISCOVERY_MAX_BYTES = 256 * 1024;
const LEGACY_TODO_INPUT_MAX_BYTES = 48 * 1024;
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
export const LEGACY_RECOVERY_SESSION_QUERY = `SELECT s.id AS sessionId,
       s.directory AS directory,
       s.parent_id AS parentId,
       p.id AS todoPartId,
       json_extract(p.data, '$.state.time.end') AS todoCompletedAt,
       json_extract(p.data, '$.state.input') AS todoInput,
       todoAssistant.id AS todoAssistantMessageId,
       todoAssistant.session_id AS todoAssistantSessionId,
       json_extract(todoAssistant.data, '$.role') AS todoAssistantRole,
       a.id AS assistantMessageId,
       a.session_id AS assistantSessionId,
       json_extract(a.data, '$.role') AS assistantRole,
       json_extract(a.data, '$.agent') AS assistantAgent,
       json_extract(a.data, '$.providerID') AS assistantProviderId,
       json_extract(a.data, '$.modelID') AS assistantModelId,
       CASE
         WHEN json_type(a.data, '$.error') IS NOT NULL THEN 'invalid'
         WHEN json_type(a.data, '$.time.completed') IS NULL THEN 'working'
         WHEN json_type(a.data, '$.time.completed') = 'integer' THEN 'idle'
         ELSE 'invalid'
       END AS assistantStatus
FROM session AS s
JOIN part AS p ON p.id = (
  SELECT candidate.id
  FROM part AS candidate
  WHERE candidate.session_id = s.id
    AND json_extract(candidate.data, '$.type') = 'tool'
    AND json_extract(candidate.data, '$.tool') = 'todowrite'
    AND json_extract(candidate.data, '$.state.status') = 'completed'
    AND json_type(candidate.data, '$.state.time.end') = 'integer'
  ORDER BY json_extract(candidate.data, '$.state.time.end') DESC, candidate.id DESC
  LIMIT 1
)
AND p.session_id = s.id
JOIN message AS todoAssistant ON todoAssistant.id = p.message_id
  AND todoAssistant.session_id = s.id
  AND json_extract(todoAssistant.data, '$.role') = 'assistant'
JOIN message AS a ON a.id = (
  SELECT candidate.id
  FROM message AS candidate
  WHERE candidate.session_id = s.id
    AND json_extract(candidate.data, '$.role') = 'assistant'
  ORDER BY candidate.time_created DESC, candidate.id DESC
  LIMIT 1
)
AND a.session_id = s.id
WHERE s.parent_id IS NULL
  AND length(CAST(json_extract(p.data, '$.state.input') AS BLOB)) <= 49152
  AND instr(json_extract(p.data, '$.state.input'), '[RECOVERY_BIND:') > 0
  AND instr(json_extract(p.data, '$.state.input'), '[RECOVERY_HANDOFF]') > 0
ORDER BY json_extract(p.data, '$.state.time.end') DESC, s.id DESC
LIMIT 2`;

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
const PREPARATION_REQUESTED = process.env.INGENIUM_RECOVERY_PREPARATION;
delete process.env.INGENIUM_RECOVERY_PREPARATION;
const PREFLIGHT_REQUESTED = process.env[RECOVERY_PREFLIGHT];
delete process.env[RECOVERY_PREFLIGHT];

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
  const requireNonWritable = options.allowWritableData !== true || options.executable || options.expectedMode !== undefined;
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
    if (requireNonWritable && ((opened.mode & 0o022) !== 0 || (before.mode & 0o022) !== 0)) fail("writable");
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
      || afterPath.dev !== opened.dev || afterPath.ino !== opened.ino || afterPath.size !== opened.size
      || afterPath.mtimeMs !== opened.mtimeMs || afterPath.ctimeMs !== opened.ctimeMs) fail("identity");
    if (afterDescriptor.uid !== owner || afterPath.uid !== owner) fail("owner");
    if (requireNonWritable && ((afterDescriptor.mode & 0o022) !== 0 || (afterPath.mode & 0o022) !== 0)) fail("writable");
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

function recoveryRepositoryBlob(worktree, head) {
  const inspect = (args, encoding = "utf8") => git(worktree, ["--no-replace-objects", ...args], encoding);
  if (!GIT_OID.test(head ?? "") || realpathSync(worktree) !== worktree
    || gitConfiguration(worktree).some(isExecutableGitConfiguration)
    || inspect(["rev-parse", "--show-toplevel"]).trim() !== worktree
    || inspect(["rev-parse", "--verify", "HEAD"]).trim() !== head) {
    throw new Error("Recovery preflight repository data has Git drift");
  }
  const entry = inspect(["ls-tree", "-z", head, "--", "opencode.json"]);
  const blob = entry.split(" ")[2]?.split("\t")[0];
  if (!GIT_OID.test(blob ?? "") || entry !== `100644 blob ${blob}\topencode.json\0`
    || inspect(["ls-files", "--stage", "-z", "--", "opencode.json"]) !== `100644 ${blob} 0\topencode.json\0`) {
    throw new Error("Recovery preflight repository data is not tracked at expected HEAD");
  }
  const bytes = inspect(["cat-file", "blob", blob], "buffer");
  if (inspect(["ls-files", "-v", "-f", "-z"]).split("\0").some((entry) => entry && !entry.startsWith("H "))
    || inspect(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]) !== ""
    || inspect(["rev-parse", "--verify", "HEAD"]).trim() !== head) {
    throw new Error("Recovery preflight repository data has Git drift");
  }
  return bytes;
}

function readOnlyRegularFile(path, maximumBytes, allowEmpty = false, expectedMode, repository) {
  const requested = resolve(path);
  const owner = ownerUid();
  let descriptor;
  try {
    const before = lstatSync(requested);
    const sharedData = (before.mode & 0o022) !== 0 && expectedMode === undefined && repository?.head !== undefined
      && requested === resolve(repository.worktree, "opencode.json");
    // An ACL mask may set group execute (0674) on Git data; executable/private inputs never get this exception.
    const forbiddenMode = sharedData ? 0o7101 : 0o022;
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== owner
      || (before.mode & forbiddenMode) !== 0 || (!allowEmpty && before.size < 1) || before.size > maximumBytes
      || (expectedMode !== undefined && (before.mode & 0o777) !== expectedMode)
      || realpathSync(requested) !== requested) throw new Error("Recovery preflight file is unavailable");
    const reviewed = sharedData ? recoveryRepositoryBlob(repository.worktree, repository.head) : null;
    descriptor = openSync(requested, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || opened.uid !== owner || (opened.mode & forbiddenMode) !== 0
      || (expectedMode !== undefined && (opened.mode & 0o777) !== expectedMode)
      || !sourceIdentityMatches(before, opened) || opened.mode !== before.mode) {
      throw new Error("Recovery preflight file is unavailable");
    }
    repository?.afterOpen?.(requested);
    const bytes = readBoundedDescriptor(descriptor, maximumBytes, allowEmpty);
    if (sharedData && (!bytes.equals(reviewed) || !bytes.equals(recoveryRepositoryBlob(repository.worktree, repository.head)))) {
      throw new Error("Recovery preflight repository data changed from expected Git blob");
    }
    const after = fstatSync(descriptor);
    const current = lstatSync(requested);
    if (bytes.length !== opened.size || !sourceIdentityMatches(opened, after) || after.mode !== opened.mode
      || !current.isFile() || current.isSymbolicLink() || current.nlink !== 1
      || !sourceIdentityMatches(opened, current) || current.mode !== opened.mode
      || current.uid !== owner || (current.mode & forbiddenMode) !== 0
      || (expectedMode !== undefined && (current.mode & 0o777) !== expectedMode)
      || realpathSync(requested) !== requested) {
      throw new Error("Recovery preflight file changed during inspection");
    }
    return bytes;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function readRecoveryRepositoryData(worktree, head = MODULE_ATTESTATION?.head, afterOpen) {
  return readOnlyRegularFile(resolve(worktree, "opencode.json"), 1024 * 1024, false, undefined, { worktree, head, afterOpen });
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

export function inspectAncestry(worktree, options = {}) {
  const ancestry = [];
  const candidates = [];
  const ambiguous = { status: "ambiguous", members: [], parent: null };
  const owner = ownerUid();
  const processOwner = options.processOwner ?? ((pid) => lstatSync(`/proc/${pid}`).uid);
  const processStat = options.processStat ?? parseProcessStat;
  const inspect = options.inspect ?? inspectAncestor;
  const environmentFor = options.environment ?? processEnvironment;
  const listeningPortsFor = options.listeningPorts ?? processListeningPorts;
  let pid = options.parentPid ?? process.ppid;
  for (let depth = 0; depth < 32 && pid > 1; depth += 1) {
    try {
      const uid = processOwner(pid);
      if (uid !== owner) {
        // Foreign supervisors contribute lineage, never recoverable parent authority.
        const before = processStat(pid);
        const after = processStat(pid);
        if (!before || !after || before.parentPid === pid || before.parentPid !== after.parentPid
          || before.startTimeTicks !== after.startTimeTicks || processOwner(pid) !== uid) return ambiguous;
        pid = before.parentPid;
        continue;
      }
    } catch { return ambiguous; }
    const inspected = inspect(pid);
    if (!inspected) return ambiguous;
    try {
      if (processOwner(pid) !== owner) return ambiguous;
    } catch { return ambiguous; }
    const { argv, ...member } = inspected;
    ancestry.push(member);
    const sessionId = commandLineSession(argv);
    const sessionArgument = argv.some((arg) => arg === "-s" || arg === "--session" || arg.startsWith("--session="));
    if (inspected.commandName === "opencode" && inspected.cwd === worktree && (sessionId || !sessionArgument)) {
      const environment = environmentFor(pid);
      const dataHomeCandidate = environment?.XDG_DATA_HOME
        ?? (environment?.HOME ? resolve(environment.HOME, ".local/share") : undefined);
      let dataHome;
      try { dataHome = dataHomeCandidate && realpathSync(dataHomeCandidate); } catch {}
      const ports = listeningPortsFor(pid);
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

function validOutboxQuarantine(value) {
  return value === null || hasExactKeys(value, ["schemaVersion", "status", "recordKey", "recordSha256", "recordCount"])
    && value.schemaVersion === 1 && value.status === "fenced" && value.recordKey === QUARANTINED_OVERFLOW_KEY
    && HASH.test(value.recordSha256 ?? "") && value.recordCount === QUARANTINED_OVERFLOW_COUNT;
}

function validRecoveryOutboxQuarantineState(value) {
  return isRecord(value) && Number.isSafeInteger(value.ambiguousCount) && value.ambiguousCount >= 0
    && Object.hasOwn(value, "quarantine") && validOutboxQuarantine(value.quarantine)
    && value.ambiguousCount === (value.quarantine === null ? 0 : 1);
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
  const unresolvedAmbiguous = inspectedOutbox.entries.filter(({ sha256: recordSha256, value }) =>
    (value.ambiguous === true || value.kind === "overflow")
    && !versionedDisposed({ sha256: recordSha256, value })
    && !(legacyDisposed && value.key === LEGACY_DISPOSITION_KEY
      && value.operationId === LEGACY_DISPOSITION_OPERATION_ID && recordSha256 === LEGACY_DISPOSITION_RECORD_SHA256));
  const fenced = unresolvedAmbiguous.length === 1 ? unresolvedAmbiguous[0] : undefined;
  const quarantine = fenced && fenced.value.key === QUARANTINED_OVERFLOW_KEY && fenced.value.kind === "overflow"
    && fenced.value.ambiguous === true && /^0+$/.test(fenced.value.sessionHash) && fenced.value.mutation === null
    && fenced.value.count === QUARANTINED_OVERFLOW_COUNT
    ? Object.freeze({ schemaVersion: 1, status: "fenced", recordKey: fenced.value.key,
      recordSha256: fenced.sha256, recordCount: fenced.value.count }) : null;
  return {
    outbox: { ...inspectedOutbox.summary, ambiguousCount: unresolvedAmbiguous.length, quarantine },
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
    const indexFlagsNormal = git(root, ["ls-files", "-v", "-f", "-z"], "utf8")
      .split("\0").every((entry) => !entry || entry.startsWith("H "));
    const sourceMatchesHead = resolve(root, relativeSource) === sourcePath
      && Buffer.from(git(root, ["show", `${head}:${relativeSource}`])).equals(sourceBytes);
    return {
      status: topLevel === root && GIT_OID.test(head) && sourceMatchesHead && indexFlagsNormal ? "validated" : "invalid",
      head: GIT_OID.test(head) ? head : null,
      clean: dirtyPaths.length === 0,
      dirtyPaths,
      indexFlagsNormal,
      sourceMatchesHead,
    };
  } catch {
    return { status: "invalid", head: null, clean: false, dirtyPaths: [], indexFlagsNormal: false, sourceMatchesHead: false };
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
    const retained = readPreparationRequest(contract.binding.worktree);
    if (canonicalJson(retained.value.contract) !== canonicalJson(contract)) return unavailable;
    const evidence = inspectPreparedRecoveryOwner(retained.value, options);
    return evidence ? { ...evidence, binding: contract.binding } : unavailable;
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

function liveToolOutcome(tool, state) {
  const unknown = { result: "unknown", exitCode: null };
  if (!["completed", "error"].includes(state.status)) return unknown;
  if (!["bash", "shell"].includes(tool)) {
    return { result: state.status === "completed" ? "passed" : "failed", exitCode: null };
  }
  if (state.metadata !== undefined && !isRecord(state.metadata)) return unknown;
  const sources = isRecord(state.metadata) ? [state, state.metadata] : [state];
  const codes = sources.flatMap((source) => ["exit", "exitCode", "exit_code", "code"]
    .filter((key) => Object.hasOwn(source, key)).map((key) => source[key]));
  const exitCode = codes[0];
  if (typeof exitCode !== "number" || !Number.isSafeInteger(exitCode) || exitCode < 0 || exitCode > 255
    || codes.some((code) => code !== exitCode) || (state.status === "error" && exitCode === 0)) return unknown;
  return { result: exitCode === 0 ? "passed" : "failed", exitCode };
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
    // The strict handoff has no unknown check variant; a hash chain retains every unresolved target in bounded space.
    let unresolvedOperationsHash = null;
    for (const message of messages) {
      if (!isRecord(message) || !Array.isArray(message.parts)) continue;
      for (const part of message.parts) {
        if (!isRecord(part) || part.type !== "tool" || !isRecord(part.state)
          || !["completed", "error"].includes(part.state.status) || !isRecord(part.state.input)) continue;
        const tool = String(part.tool).toLowerCase().replace(/[.-]/g, "_");
        if (["bash", "shell"].includes(tool)
          && part.state.input.command === "ingenium-build deployment production-restart") continue;
        const { result, exitCode } = liveToolOutcome(tool, part.state);
        if (result === "unknown") {
          unresolvedOperationsHash = sha256(JSON.stringify({ kind: "unresolved_operation", result,
            sourceTargetHash: sha256(`${tool}\0${JSON.stringify(part.state.input)}`), previousHash: unresolvedOperationsHash }));
        }
        const changes = liveInputChanges(tool, part.state.input, worktree);
        const path = changes.length === 1 ? changes[0].path : undefined;
        const kind = tool === "read" ? "read" : tool === "grep" || tool === "glob" ? "search"
          : tool === "write" || tool === "file_write" ? "write"
            : tool === "edit" || tool === "file_edit" ? "edit" : "execute";
        if (result === "passed") {
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
        if (name && result !== "unknown") {
          const checkStatus = result === "passed" ? "completed" : "failed";
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
    const nextWork = unresolvedOperationsHash ? { kind: "review_changes", referenceHash: unresolvedOperationsHash }
      : failedCheck ? { kind: "address_failure", referenceHash: failedCheck.targetHash }
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

function parseOperationalList(value, maximum) {
  const items = value.split(",");
  if (items.length < 1 || items.length > maximum || items.some((item) => !SAFE_OPERATIONAL_TOKEN.test(item))
    || new Set(items).size !== items.length) throw new Error("Recovery legacy handoff marker is invalid");
  return items;
}

export function parseLegacyRecoveryTodoInput(input, parent, binding, sourceHead, sessionId) {
  if (!hasExactKeys(input, ["todos"]) || !Array.isArray(input.todos) || input.todos.length < 2 || input.todos.length > 64
    || Buffer.byteLength(canonicalJson(input), "utf8") > LEGACY_TODO_INPUT_MAX_BYTES) {
    throw new Error("Recovery legacy Todo input is invalid");
  }
  const todos = input.todos.map((todo) => {
    if (!hasExactKeys(todo, ["content", "status", "priority"]) || typeof todo.content !== "string"
      || todo.content.length < 1 || todo.content.length > 2048 || /[\u0000-\u001f\u007f]/.test(todo.content)
      || !["pending", "in_progress", "completed", "cancelled"].includes(todo.status)
      || !["high", "medium", "low"].includes(todo.priority)) throw new Error("Recovery legacy Todo input is invalid");
    return Object.freeze({ content: todo.content, status: todo.status, priority: todo.priority });
  });
  if (new Set(todos.map((todo) => todo.content)).size !== todos.length) throw new Error("Recovery legacy Todo input is invalid");
  const bindingItems = todos.filter((todo) => todo.content.startsWith("[RECOVERY_BIND"));
  const handoffItems = todos.filter((todo) => todo.content.startsWith("[RECOVERY_HANDOFF"));
  if (bindingItems.length === 0 && handoffItems.length === 0) return null;
  if (bindingItems.length !== 1 || handoffItems.length !== 1) throw new Error("Recovery legacy Todo markers are ambiguous");

  const bindingMatch = /^\[RECOVERY_BIND:([A-Za-z0-9_-]+)\] pid=([1-9][0-9]*) startTicks=([1-9][0-9]*) head=([0-9a-f]{40}) project=([^ ]+) projectId=([0-9a-f-]+) workspace=([^ ]+) worktree=(.+) storageHash=([0-9a-f]{64})$/
    .exec(bindingItems[0].content);
  if (!bindingMatch || !SAFE_SESSION.test(sessionId ?? "") || bindingMatch[1] !== sessionId
    || !SAFE_PROJECT.test(bindingMatch[5]) || !LOWER_UUID.test(bindingMatch[6])
    || !SAFE_OPERATIONAL_TOKEN.test(bindingMatch[7])) throw new Error("Recovery legacy binding marker is invalid");
  const pid = Number(bindingMatch[2]);
  const startTimeTicks = Number(bindingMatch[3]);
  const markerWorktree = bindingMatch[8];
  if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(startTimeTicks)
    || pid !== parent.pid || startTimeTicks !== parent.startTimeTicks || bindingMatch[4] !== sourceHead
    || bindingMatch[5] !== binding.project || bindingMatch[6] !== binding.projectId
    || bindingMatch[7] !== binding.workspaceId
    || markerWorktree !== binding.worktree || resolve(markerWorktree) !== markerWorktree
    || realpathSync(markerWorktree) !== markerWorktree || bindingMatch[9] !== binding.storageMappingHash) {
    throw new Error("Recovery legacy binding marker does not match");
  }

  const handoffMatch = /^\[RECOVERY_HANDOFF\] actions=([^;]+); changedPaths=([^;]+); checks=([^;]+); task=([^;]+); status=([^;]+); nextWork=([^;]+)$/
    .exec(handoffItems[0].content);
  if (!handoffMatch || ![handoffMatch[1], handoffMatch[4], handoffMatch[5], handoffMatch[6]]
    .every((value) => SAFE_OPERATIONAL_TOKEN.test(value))) throw new Error("Recovery legacy handoff marker is invalid");
  const changedPaths = handoffMatch[2].split(",");
  if (changedPaths.length > 32 || new Set(changedPaths).size !== changedPaths.length
    || changedPaths.some((path) => !safeHandoffPath(path)
      || relative(binding.worktree, resolve(binding.worktree, path)) !== path)) {
    throw new Error("Recovery legacy handoff marker is invalid");
  }
  const checks = parseOperationalList(handoffMatch[3], 32);
  const declaredOperational = Object.freeze({
    actionsSha256: sha256(handoffMatch[1]),
    changedPathsSha256: sha256(canonicalJson(changedPaths)),
    checksSha256: sha256(canonicalJson(checks)),
    taskSha256: sha256(handoffMatch[4]),
    statusSha256: sha256(handoffMatch[5]),
    nextWorkSha256: sha256(handoffMatch[6]),
  });
  return Object.freeze({
    marker: Object.freeze({ sessionIdSha256: sha256(sessionId), bindingSha256: sha256(bindingItems[0].content),
      handoffSha256: sha256(handoffItems[0].content) }),
    todos: Object.freeze(todos.map((todo) => Object.freeze({
      idSha256: sha256(`todo-${sha256(`todo\0${JSON.stringify(todo.content)}`)}`),
      status: todo.status,
    }))),
    declaredOperational,
  });
}

function validLegacyRecoveryTodoHandoff(value, sessionId) {
  return hasExactKeys(value, ["marker", "todos", "declaredOperational"])
    && hasExactKeys(value.marker, ["sessionIdSha256", "bindingSha256", "handoffSha256"])
    && value.marker.sessionIdSha256 === sha256(sessionId)
    && typeof value.marker.bindingSha256 === "string" && HASH.test(value.marker.bindingSha256)
    && typeof value.marker.handoffSha256 === "string" && HASH.test(value.marker.handoffSha256)
    && Array.isArray(value.todos) && value.todos.length >= 2 && value.todos.length <= 64
    && value.todos.every((todo) => hasExactKeys(todo, ["idSha256", "status"])
      && HASH.test(todo.idSha256 ?? "") && ["pending", "in_progress", "completed", "cancelled"].includes(todo.status))
    && new Set(value.todos.map((todo) => todo.idSha256)).size === value.todos.length
    && hasExactKeys(value.declaredOperational, ["actionsSha256", "changedPathsSha256", "checksSha256", "taskSha256",
      "statusSha256", "nextWorkSha256"])
    && Object.values(value.declaredOperational).every((digest) => typeof digest === "string" && HASH.test(digest));
}

function legacyRecoveryProjection(captured, assistant) {
  const counts = { pending: 0, inProgress: 0, completed: 0, cancelled: 0 };
  for (const todo of captured.todos) {
    if (todo.status === "in_progress") counts.inProgress += 1;
    else counts[todo.status] += 1;
  }
  const open = counts.pending > 0 || counts.inProgress > 0;
  const populated = Object.values(counts).filter((count) => count > 0).length;
  const todoState = populated > 1 ? "mixed" : counts.pending ? "pending"
    : counts.inProgress ? "in_progress" : counts.completed ? "complete" : "cancelled";
  const nextWork = {
    kind: open ? "continue_task" : "review_changes",
    referenceHash: captured.declaredOperational.nextWorkSha256,
  };
  const operational = Object.freeze({
    role: assistant.agent,
    model: Object.freeze({ providerId: assistant.providerId, modelId: assistant.modelId }),
    status: assistant.status,
    taskHash: captured.declaredOperational.taskSha256,
    actionsSha256: captured.declaredOperational.actionsSha256,
    changedPathsSha256: captured.declaredOperational.changedPathsSha256,
    checksSha256: captured.declaredOperational.checksSha256,
    todos: captured.todos,
    nextWork: Object.freeze(nextWork),
  });
  const handoff = {
    status: operational.status,
    taskHash: operational.taskHash,
    actionsSha256: operational.actionsSha256,
    changedPathsSha256: operational.changedPathsSha256,
    checksSha256: operational.checksSha256,
    todos: { total: captured.todos.length, ...counts, state: todoState },
    nextWork,
  };
  return Object.freeze({ operational, handoff: Object.freeze({ ...handoff, sha256: sha256(canonicalJson(handoff)) }) });
}

export function discoverLegacyRecoverySession(parent, binding, source, execute = spawnSync) {
  let stdout;
  let stderr;
  try {
    prepareRecoveryOwnerContract(binding, source?.head);
    const home = parent?.environment?.HOME;
    if (!parent || parent.port !== null || parent.cwd !== binding.worktree || !safeRecoveryIdentity(parent)
      || parent.nonceSha256 !== "0".repeat(64) || parent.sessionId !== null && !SAFE_SESSION.test(parent.sessionId)
      || source.status !== "validated" || source.dirtyPaths.length !== 0 || !source.sourceMatchesHead
      || !/^[0-9a-f]{40}$/.test(source.head) || typeof home !== "string" || resolve(home) !== home
      || typeof parent.dataHome !== "string" || resolve(parent.dataHome) !== parent.dataHome) return null;
    const result = execute(`/proc/${parent.pid}/exe`, ["db", LEGACY_RECOVERY_SESSION_QUERY, "--format", "json"], {
      cwd: binding.worktree,
      encoding: null,
      timeout: 10_000,
      maxBuffer: LEGACY_SESSION_DISCOVERY_MAX_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
      env: { HOME: home, XDG_DATA_HOME: parent.dataHome, PATH: "/usr/local/bin:/usr/bin:/bin" },
    });
    stdout = Buffer.isBuffer(result.stdout) ? result.stdout : undefined;
    stderr = Buffer.isBuffer(result.stderr) ? result.stderr : undefined;
    if (result.error || result.signal || result.status !== 0 || !stdout || stdout.length < 2
      || stdout.length > LEGACY_SESSION_DISCOVERY_MAX_BYTES) return null;
    const text = stdout.toString("utf8");
    if (!Buffer.from(text).equals(stdout)) return null;
    const rows = JSON.parse(text);
    if (!Array.isArray(rows) || rows.length > 2) return null;
    const seen = new Set();
    const matches = [];
    for (const row of rows) {
      if (!hasExactKeys(row, ["sessionId", "directory", "parentId", "todoPartId", "todoCompletedAt", "todoInput",
        "todoAssistantMessageId", "todoAssistantSessionId", "todoAssistantRole", "assistantMessageId",
        "assistantSessionId", "assistantRole", "assistantAgent", "assistantProviderId", "assistantModelId", "assistantStatus"])
        || !SAFE_SESSION.test(row.sessionId ?? "") || typeof row.directory !== "string" || row.parentId !== null
        || !SAFE_ID.test(row.todoPartId ?? "") || !Number.isSafeInteger(row.todoCompletedAt) || row.todoCompletedAt < 1
        || typeof row.todoInput !== "string" || Buffer.byteLength(row.todoInput, "utf8") > LEGACY_TODO_INPUT_MAX_BYTES
        || !SAFE_ID.test(row.todoAssistantMessageId ?? "") || row.todoAssistantSessionId !== row.sessionId
        || row.todoAssistantRole !== "assistant" || !SAFE_ID.test(row.assistantMessageId ?? "")
        || row.assistantSessionId !== row.sessionId || row.assistantRole !== "assistant"
        || !SAFE_ID.test(row.assistantAgent ?? "") || !SAFE_MODEL_METADATA.test(row.assistantProviderId ?? "")
        || !SAFE_MODEL_METADATA.test(row.assistantModelId ?? "") || row.assistantStatus !== "working"
        || seen.has(row.sessionId)) return null;
      seen.add(row.sessionId);
      if (row.directory !== binding.worktree) continue;
      const input = JSON.parse(row.todoInput);
      const captured = parseLegacyRecoveryTodoInput(input, parent, binding, source.head, row.sessionId);
      if (captured) matches.push(Object.freeze({
        sessionId: row.sessionId,
        ...captured,
        ...legacyRecoveryProjection(captured, {
          agent: row.assistantAgent,
          providerId: row.assistantProviderId,
          modelId: row.assistantModelId,
          status: row.assistantStatus,
        }),
        querySha256: sha256(canonicalJson(row)),
      }));
    }
    if (matches.length !== 1 || parent.sessionId !== null && parent.sessionId !== matches[0].sessionId) return null;
    return matches[0];
  } catch {
    return null;
  } finally {
    stdout?.fill(0);
    stderr?.fill(0);
  }
}

export async function captureLegacyRecoveryPreAdmission(parent, binding, source, request = fetch,
  inspect = (pid) => ({ ...inspectAncestor(pid), nonce: processEnvironment(pid)?.INGENIUM_RESTART_NONCE, ports: processListeningPorts(pid) }),
  executeParent = spawnSync) {
  try { prepareRecoveryOwnerContract(binding, source?.head); } catch { return null; }
  if (!parent || !binding || !source || source.status !== "validated" || source.dirtyPaths.length !== 0
    || !source.sourceMatchesHead || !GIT_OID.test(source.head ?? "") || parent.cwd !== binding.worktree
    || !safeRecoveryIdentity(parent) || parent.nonceSha256 !== "0".repeat(64)
    || parent.port === null && parent.sessionId !== null && !SAFE_SESSION.test(parent.sessionId)) return null;
  const sameProcess = () => {
    const actual = inspect(parent.pid);
    return actual && actual.commandName === "opencode" && actual.pid === parent.pid
      && actual.startTimeTicks === parent.startTimeTicks && actual.executableSha256 === parent.executableSha256
      && actual.cwd === binding.worktree && actual.cmdlineSha256 === parent.cmdlineSha256
      && actual.nonce === undefined && (parent.port === null
        ? actual.ports?.length === 0 : actual.ports?.length === 1 && actual.ports[0] === parent.port);
  };
  if (!sameProcess()) return null;
  try {
    if (parent.port === null) {
      const discovered = discoverLegacyRecoverySession(parent, binding, source, executeParent);
      if (!discovered || !sameProcess()) return null;
      const config = JSON.parse(readRecoveryRepositoryData(binding.worktree, source.head));
      if (!isRecord(config.agent) || !Object.hasOwn(config.agent, discovered.operational.role)
        || config.agent[discovered.operational.role]?.disable === true) return null;
      const confirmed = discoverLegacyRecoverySession(parent, binding, source, executeParent);
      if (!confirmed || canonicalJson(confirmed) !== canonicalJson(discovered) || !sameProcess()) return null;
      const identity = Object.fromEntries(["pid", "startTimeTicks", "executableSha256", "nonceSha256"].map((key) => [key, parent[key]]));
      const snapshot = { schemaVersion: 1, kind: "legacy-pre-admission", parent: identity,
        nonceProvenance: "absent_process_environment", sessionId: discovered.sessionId, binding, sourceHead: source.head,
        marker: discovered.marker, todos: discovered.todos, declaredOperational: discovered.declaredOperational,
        operational: discovered.operational };
      return { snapshot, sha256: sha256(canonicalJson(snapshot)), summary: discovered.handoff };
    }
    const password = parent.environment?.OPENCODE_SERVER_PASSWORD;
    const username = parent.environment?.OPENCODE_SERVER_USERNAME ?? "opencode";
    if (!OPAQUE_TOKEN.test(password ?? "") || !/^[A-Za-z0-9._-]{1,64}$/.test(username)) return null;
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
    const config = JSON.parse(readRecoveryRepositoryData(binding.worktree, source.head));
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

export async function captureCurrentRecoveryPreAdmission(parent, binding, source, request = fetch,
  inspect = (pid) => ({ ...inspectAncestor(pid), nonce: processEnvironment(pid)?.INGENIUM_RESTART_NONCE, ports: processListeningPorts(pid) })) {
  try { prepareRecoveryOwnerContract(binding, source?.head); } catch { return null; }
  if (!parent || !binding || !source || source.status !== "validated" || source.dirtyPaths.length !== 0
    || !source.sourceMatchesHead || !GIT_OID.test(source.head ?? "") || parent.cwd !== binding.worktree
    || !safeRecoveryIdentity(parent) || parent.port === null || parent.nonceSha256 === "0".repeat(64)) return null;
  const sameProcess = () => {
    const actual = inspect(parent.pid);
    return actual && actual.commandName === "opencode" && actual.pid === parent.pid
      && actual.startTimeTicks === parent.startTimeTicks && actual.executableSha256 === parent.executableSha256
      && actual.cwd === binding.worktree && actual.cmdlineSha256 === parent.cmdlineSha256
      && OPAQUE_TOKEN.test(actual.nonce ?? "") && sha256(actual.nonce) === parent.nonceSha256
      && actual.ports?.length === 1 && actual.ports[0] === parent.port;
  };
  if (!sameProcess()) return null;
  const discovered = currentParentEvidence(binding.worktree, parent, binding, source.head);
  if (!discovered.record) return null;
  const session = discovered.record.sessions[0];
  const live = await readLiveRecoverySummary({ ...parent, sessionId: session.sessionId }, binding.worktree, request);
  if (!live?.operational || !sameProcess()
    || currentParentEvidence(binding.worktree, parent, binding, source.head, Date.now(), live.handoff).record === null
    || live.operational.role !== session.role) return null;
  const identity = Object.fromEntries(["pid", "startTimeTicks", "executableSha256", "nonceSha256"].map((key) => [key, parent[key]]));
  const snapshot = { schemaVersion: 1, kind: "current-pre-admission", parent: identity,
    nonceProvenance: "process_environment", sessionId: session.sessionId, binding, sourceHead: source.head,
    operational: { role: session.role, ...session.handoff } };
  return { snapshot, sha256: sha256(canonicalJson(snapshot)), summary: live.handoff };
}

export function recoveryConfiguredEnvironment(worktree, inherited = {}, head = MODULE_ATTESTATION?.head) {
  const config = JSON.parse(readRecoveryRepositoryData(worktree, head));
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

export async function corroborateRecoveryBinding(worktree, environment, request = fetch, options = {}) {
  const token = readRecoveryApiToken(worktree, environment);
  const get = async (path) => {
    const url = `${environment.INGENIUM_API_URL}${path}`;
    const init = Object.freeze({
      method: "GET", redirect: "error", signal: AbortSignal.timeout(5_000),
      headers: Object.freeze({ Authorization: `Bearer ${token}`, "X-Ingenium-Audience": "mcp",
        "X-Ingenium-Workspace": environment.INGENIUM_WORKSPACE_ID, "X-Ingenium-Launcher-Worktree": worktree }),
    });
    const probe = () => request(url, init);
    let response = await probe();
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After")?.trim();
      const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : NaN;
      const retryAt = retryAfter ? Date.parse(retryAfter) : NaN;
      const delay = Number.isFinite(seconds) ? seconds * 1_000
        : Number.isFinite(retryAt) && new Date(retryAt).toUTCString() === retryAfter
          ? retryAt - (options.now ?? Date.now)() : NaN;
      await response.body?.cancel();
      if (!Number.isFinite(delay) || delay < 0 || delay > PREFLIGHT_RETRY_DELAY_CAP_MS) {
        throw new Error("Recovery binding authority is unavailable");
      }
      await (options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))))(delay);
      response = await probe();
    }
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

const PREPARATION_JOB = "ingenium-recovery-owner.service";
const PREPARATION_OWNER_ARGUMENT = "--recovery-preparation-owner";
const PREPARATION_LIFETIME_MS = 15 * 60 * 1_000;
const QUARANTINED_OVERFLOW_KEY = "098781a9c6484288bd5f9d9a0cba6b049d3c8a2f15b023b56d5ccc08237bafd0";
const QUARANTINED_OVERFLOW_COUNT = 11_617;
const PREPARATION_PARENT_CONTROL_PLANE_FAILURE = Object.freeze({
  code: "RECOVERY_PREPARATION_PARENT_CONTROL_PLANE_UNAVAILABLE",
  path: "inspect.parent_control_plane",
});

export function inspectInstalledRecoveryBuild(worktree, source, inherited = process.env) {
  const home = inherited.HOME;
  if (typeof home !== "string" || !isAbsolute(home) || resolve(home) !== home || realpathSync(home) !== home) {
    throw new Error("Recovery preflight managed launcher home is unavailable");
  }
  const release = resolve(home, ".local/share/ingenium/host-build/releases", source.head);
  const manifestBytes = readOnlyRegularFile(resolve(release, "release.json"), 64 * 1024, false, 0o400);
  const manifest = JSON.parse(manifestBytes);
  if (!hasExactKeys(manifest, ["schemaVersion", "head", "repositoryRoot", "owner", "node", "sourceSha256", "files", "launchers"])
    || manifest.schemaVersion !== 1 || manifest.head !== source.head || manifest.repositoryRoot !== worktree
    || manifest.sourceSha256 !== source.sha256 || manifest.owner !== ownerUid()) {
    throw new Error("Recovery preflight installed release is unavailable");
  }
  const launchers = {};
  for (const [name, relativePath] of [["ingenium-build", "dist/scripts/build-command.js"],
    ["ingenium-opencode", "dist/scripts/opencode.js"]]) {
    const entry = resolve(release, relativePath);
    const artifact = readOnlyRegularFile(entry, 16 * 1024 * 1024, false, 0o400);
    const expected = manifest.files?.[relativePath];
    const expectedLauncher = manifest.launchers?.[name];
    const launcher = readTrustedRegularFile(resolve(home, ".local/bin", name), `Installed managed ${name} launcher`, {
      executable: true, expectedMode: 0o500,
    });
    if (!hasExactKeys(expected, ["sha256", "mode"]) || expected.mode !== 0o400
      || !hasExactKeys(expectedLauncher, ["sha256", "mode", "entry"]) || expectedLauncher.mode !== 0o500
      || expectedLauncher.entry !== relativePath || expectedLauncher.sha256 !== launcher.sha256
      || expected.sha256 !== sha256(artifact) || !launcher.bytes.includes(Buffer.from(release))
      || !launcher.bytes.includes(Buffer.from(entry))) {
      throw new Error("Recovery preflight installed launcher source is unavailable");
    }
    launchers[name] = { path: launcher.path, sha256: launcher.sha256, artifactSha256: expected.sha256 };
  }
  return { status: "attested", release: { path: release, sha256: sha256(manifestBytes) }, launchers };
}

function inspectInstalledManagedLauncher(parent, binding, source, environment) {
  const home = parent.environment?.HOME;
  const installed = inspectInstalledRecoveryBuild(binding.worktree, source, { HOME: home });
  const launcher = installed.launchers["ingenium-opencode"];
  const executablePath = realpathSync(`/proc/${parent.pid}/exe`);
  const executableOwner = lstatSync(executablePath).uid;
  const executable = readTrustedRegularFile(executablePath, "Recovery preparation OpenCode executable", {
    expectedOwner: executableOwner, executable: true,
  });
  if (basename(executable.path) !== "opencode" || executable.sha256 !== parent.executableSha256) {
    throw new Error("Recovery preparation OpenCode executable changed");
  }
  return {
    schemaVersion: 1,
    kind: "legacy-managed-parent",
    sessionId: parent.sessionId,
    dataHome: parent.dataHome,
    launcher: { path: launcher.path, sha256: launcher.sha256, releaseSha256: installed.release.sha256,
      artifactSha256: launcher.artifactSha256 },
    executable: { path: executable.path, sha256: executable.sha256 },
    environment: {
      HOME: home,
      XDG_DATA_HOME: parent.dataHome,
      INGENIUM_API_URL: environment.INGENIUM_API_URL,
      INGENIUM_PROJECT: binding.project,
      INGENIUM_PROJECT_ID: binding.projectId,
      INGENIUM_WORKSPACE_ID: binding.workspaceId,
      INGENIUM_STORAGE_MAPPING_HASH: binding.storageMappingHash,
      INGENIUM_WORKTREE: binding.worktree,
      INGENIUM_MCP_AUDIENCE: "mcp",
      INGENIUM_MCP_CREDENTIAL_FILE: resolve(binding.worktree, environment.INGENIUM_MCP_CREDENTIAL_FILE),
      INGENIUM_MCP_CREDENTIAL_PURPOSE: "general",
      INGENIUM_OPENCODE_EXECUTABLE: executable.path,
    },
  };
}

function recoveryPreparationFailureDetail(error, phase) {
  return error?.code === PREPARATION_PARENT_CONTROL_PLANE_FAILURE.code
    && error.failurePath === PREPARATION_PARENT_CONTROL_PLANE_FAILURE.path
    ? PREPARATION_PARENT_CONTROL_PLANE_FAILURE
    : { code: "RECOVERY_PREPARATION_INTERNAL_FAILURE", path: phase };
}

export function recoveryPreparationFailureOutput(error) {
  const phase = ["inspect", "prepare", "start", "attest", "confirm"].includes(error?.phase) ? error.phase : "source";
  const failure = error?.failure?.code === PREPARATION_PARENT_CONTROL_PLANE_FAILURE.code
    && error.failure.path === PREPARATION_PARENT_CONTROL_PLANE_FAILURE.path
    ? PREPARATION_PARENT_CONTROL_PLANE_FAILURE
    : { code: "RECOVERY_PREPARATION_INTERNAL_FAILURE", path: phase };
  return { action: "recovery-prepare", authorizesRestart: false,
    code: error?.code === "RECOVERY_PREPARATION_RECONCILIATION_REQUIRED" ? error.code : "RECOVERY_PREPARATION_FAILED",
    phase, failure };
}

function preparationDirectory(worktree) {
  return resolve(worktree, ".opencode/protected-runtime-index/tui-recovery/preparation");
}

function privatePreparationDirectory(path) {
  canonicalOwnedDirectory(path, "Recovery preparation directory");
  if ((lstatSync(path).mode & 0o777) !== 0o700) throw new Error("Recovery preparation directory is not private");
}

function preparationSystemd(command, args, run = execFileSync) {
  return run(`/usr/bin/${command}`, ["--user", ...args], {
    encoding: "utf8", shell: false, timeout: 5_000, maxBuffer: 16 * 1024,
    env: { PATH: "/usr/bin:/bin", XDG_RUNTIME_DIR: `/run/user/${ownerUid()}`,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${ownerUid()}/bus` },
  });
}

export function inspectPreparationJob(run = execFileSync) {
  let output;
  let missingUnitExit = false;
  try {
    output = preparationSystemd("systemctl", ["show", PREPARATION_JOB, "--all",
      "--property=LoadState,ActiveState,SubState,MainPID,InvocationID,Job"], run);
  } catch (error) {
    if (error.status !== 1 || typeof error.stdout !== "string" || Buffer.byteLength(error.stdout) > 16 * 1024) throw error;
    output = error.stdout;
    missingUnitExit = true;
  }
  const entries = output.trim().split("\n").map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1)];
  });
  const value = Object.fromEntries(entries);
  if (entries.length !== 6 || !hasExactKeys(value, ["LoadState", "ActiveState", "SubState", "MainPID", "InvocationID", "Job"])) {
    throw new Error("Recovery preparation job probe is invalid");
  }
  if (missingUnitExit && !absentPreparationJob(value)) throw new Error("Recovery preparation job probe failed");
  return value;
}

function absentPreparationJob(job) {
  return job.LoadState === "not-found" && job.ActiveState === "inactive" && job.MainPID === "0"
    && job.InvocationID === "" && job.Job === "";
}

function anchoredPreparationPath(path, action) {
  const parent = dirname(path);
  canonicalOwnedDirectory(parent, "Recovery preparation parent");
  const descriptor = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const identity = fstatSync(descriptor);
  const verify = () => {
    canonicalOwnedDirectory(parent, "Recovery preparation parent");
    if (!directoryIdentityMatches(identity, lstatSync(parent))) throw new Error("Recovery preparation directory changed");
  };
  try {
    verify();
    const result = action(`/proc/self/fd/${descriptor}/${basename(path)}`);
    fsyncSync(descriptor);
    verify();
    return result;
  } finally { closeSync(descriptor); }
}

function writePreparationFile(path, bytes, retainOwnership, mode = 0o600) {
  anchoredPreparationPath(path, (anchored) => {
    const descriptor = openSync(anchored, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    let complete = false;
    try { writeFileSync(descriptor, bytes); fchmodSync(descriptor, mode); fsyncSync(descriptor); complete = true; } finally {
      try { retainOwnership?.(fstatSync(descriptor), complete); } finally { closeSync(descriptor); }
    }
  });
}

export function planPreparationQuarantine(index) {
  const state = summarizeCoordinationOutboxState(index);
  if (state.outbox.status === "invalid" || state.disposition.status === "invalid") throw new Error("Recovery preparation outbox is invalid");
  if (state.outbox.ambiguousCount === 0) return null;
  if (state.outbox.ambiguousCount !== 1 || state.outbox.quarantine === null
    || !validOutboxQuarantine(state.outbox.quarantine)) {
    throw new Error("Recovery preparation outbox is ambiguous");
  }
  privatePreparationDirectory(index);
  const directory = resolve(index, "coordination-outbox");
  privatePreparationDirectory(directory);
  const key = state.outbox.quarantine.recordKey;
  const path = resolve(directory, `${key}.json`);
  const bytes = readOnlyRegularFile(path, 16 * 1024, false, 0o600);
  const record = JSON.parse(bytes);
  if (!validOutboxSummaryRecord(record, key, `${key}.json`) || record.kind !== "overflow" || record.ambiguous !== true
    || !/^0+$/.test(record.sessionHash) || record.mutation !== null || sha256(bytes) !== state.outbox.quarantine.recordSha256
    || record.count !== state.outbox.quarantine.recordCount) throw new Error("Recovery preparation quarantine changed");
  return { path, bytes, ambiguousCount: state.outbox.ambiguousCount, quarantine: state.outbox.quarantine };
}

function validatePreparationQuarantine(plan) {
  if (!plan) return;
  const bytes = readOnlyRegularFile(plan.path, 16 * 1024, false, 0o600);
  if (!Number.isSafeInteger(plan.ambiguousCount) || plan.ambiguousCount !== 1
    || !plan.bytes.equals(bytes) || sha256(bytes) !== plan.quarantine.recordSha256) {
    throw new Error("Recovery preparation quarantine changed");
  }
}

function preparationQuarantineMatches(outbox, plan) {
  const ambiguousCount = plan === null ? 0 : plan?.ambiguousCount;
  return Number.isSafeInteger(ambiguousCount) && ambiguousCount >= 0
    && Number.isSafeInteger(outbox?.ambiguousCount) && outbox.ambiguousCount === ambiguousCount
    && canonicalJson(outbox.quarantine) === canonicalJson(plan?.quarantine ?? null);
}

export async function collectPreparationInputs(sourceHandle, options = {}) {
  const source = sourceHandle.revalidate();
  const worktree = dirname(dirname(dirname(dirname(source.path))));
  const collectGit = options.gitSummary ?? collectGitSummary;
  let gitSummary = collectGit(worktree, source.path, source.bytes);
  let installedBuild = null;
  let deployment = null;
  if (options.preflight === true) {
    if (gitSummary.status !== "validated" || gitSummary.head !== source.head || gitSummary.clean !== true
      || gitSummary.dirtyPaths.length !== 0 || gitSummary.indexFlagsNormal !== true || !gitSummary.sourceMatchesHead) {
      throw new Error("Recovery preflight repository source is unavailable");
    }
    installedBuild = (options.inspectInstalledBuild ?? inspectInstalledRecoveryBuild)(worktree, source,
      options.environment ?? process.env);
    deployment = (options.inspectDeployment ?? inspectRecoveryDeployment)(worktree, source.head,
      options.inspectDeploymentCommand);
    if (deployment.status !== "attested" || deployment.revision !== source.head) {
      throw new Error("Recovery preflight deployed source is unavailable");
    }
    const confirmedSource = sourceHandle.revalidate();
    const confirmedGit = collectGit(worktree, confirmedSource.path, confirmedSource.bytes);
    if (confirmedSource.head !== source.head || confirmedSource.sha256 !== source.sha256
      || canonicalJson(confirmedGit) !== canonicalJson(gitSummary)) {
      throw new Error("Recovery preflight source changed before configuration");
    }
    gitSummary = confirmedGit;
  }
  const environment = (options.configuredEnvironment ?? recoveryConfiguredEnvironment)(
    worktree,
    options.environment ?? process.env,
    source.head,
  );
  const binding = await (options.corroborateBinding ?? corroborateRecoveryBinding)(
    worktree,
    environment,
    options.request ?? fetch,
  );
  const ancestry = (options.ancestry ?? inspectAncestry)(worktree);
  if (ancestry.status !== "exact" || !ancestry.parent) throw new Error("Recovery preparation parent is ambiguous");
  for (const [key, expected] of Object.entries({ INGENIUM_PROJECT: binding.project, INGENIUM_PROJECT_ID: binding.projectId,
    INGENIUM_WORKSPACE_ID: binding.workspaceId, INGENIUM_STORAGE_MAPPING_HASH: binding.storageMappingHash,
    INGENIUM_WORKTREE: worktree, INGENIUM_API_URL: environment.INGENIUM_API_URL })) {
    const inherited = ancestry.parent.environment?.[key];
    if (inherited !== undefined && inherited !== expected) throw new Error("Recovery preparation parent binding conflicts");
  }
  let launch = null;
  let legacyDeploymentAttested = false;
  if (gitSummary.status === "validated" && gitSummary.dirtyPaths.length === 0 && gitSummary.sourceMatchesHead
    && ancestry.parent.port === null && ancestry.parent.nonceSha256 === "0".repeat(64)) {
    deployment ??= (options.inspectDeployment ?? inspectRecoveryDeployment)(worktree, gitSummary.head,
      options.inspectDeploymentCommand);
    if (deployment.status !== "attested" || deployment.revision !== gitSummary.head) {
      throw new Error("Recovery preparation deployed source is unavailable");
    }
    legacyDeploymentAttested = true;
  } else if (gitSummary.status === "validated" && gitSummary.dirtyPaths.length === 0 && gitSummary.sourceMatchesHead
    && ancestry.parent.port === null) {
    const error = new Error("Recovery preparation parent control plane is unavailable");
    error.code = PREPARATION_PARENT_CONTROL_PLANE_FAILURE.code;
    error.failurePath = PREPARATION_PARENT_CONTROL_PLANE_FAILURE.path;
    throw error;
  }
  const capture = ancestry.parent.nonceSha256 === "0".repeat(64)
    ? await (options.captureLegacy ?? captureLegacyRecoveryPreAdmission)(ancestry.parent, binding, gitSummary,
      options.request ?? fetch, options.inspectParent, options.exportSession)
    : await (options.captureCurrent ?? captureCurrentRecoveryPreAdmission)(ancestry.parent, binding, gitSummary,
      options.request ?? fetch, options.inspectParent);
  if (!capture) throw new Error("Recovery preparation capture is unavailable");
  if (legacyDeploymentAttested) {
    launch = (options.inspectLauncher ?? inspectInstalledManagedLauncher)({
      ...ancestry.parent,
      sessionId: capture.snapshot.sessionId,
    }, binding, { ...source, ...gitSummary, sha256: source.sha256 }, environment);
  }
  const health = await collectApiHealth(environment, options.request ?? fetch);
  if (health.status !== "healthy") throw new Error("Recovery preparation API health is unavailable");
  const index = resolve(worktree, ".opencode/protected-runtime-index");
  if (summarizeFreeze(resolve(index, "coordination-outbox-mutation.lock")).status !== "clear") {
    throw new Error("Recovery preparation outbox is frozen");
  }
  const quarantine = planPreparationQuarantine(index);
  sourceHandle.revalidate();
  return { binding, capture, quarantine, source, git: gitSummary, deployment, installedBuild, launch,
    contract: prepareRecoveryOwnerContract(binding, source.head) };
}

export function recoveryPreflightFailureOutput() {
  return { schemaVersion: 1, action: "recovery-preflight", status: "rejected", admissible: false,
    mutationFree: true, authorizesRestart: false, session: null, binding: null, source: null, deployment: null,
    launcher: null, quarantine: null, admission: { decision: "reject", nextOperation: null } };
}

export async function runRecoveryPreflight(argv = process.argv, dependencies = {}) {
  if (argv.length !== 2) throw new Error("Recovery preflight accepts no arguments");
  const sourceHandle = (dependencies.openSource ?? openVerifiedRecoverySource)(dependencies.attestation ?? MODULE_ATTESTATION);
  try {
    const inputs = await (dependencies.collectInputs ?? collectPreparationInputs)(sourceHandle, {
      ...(dependencies.inputOptions ?? {}),
      environment: dependencies.environment ?? process.env,
      preflight: true,
    });
    const source = sourceHandle.revalidate();
    const snapshot = inputs.capture.snapshot;
    const installed = inputs.installedBuild;
    if (!installed || installed.status !== "attested" || inputs.deployment?.status !== "attested"
      || inputs.deployment.revision !== source.head) throw new Error("Recovery preflight attestation is incomplete");
    const output = {
      schemaVersion: 1,
      action: "recovery-preflight",
      status: "admitted",
      admissible: true,
      mutationFree: true,
      authorizesRestart: false,
      session: {
        kind: snapshot.kind,
        status: inputs.capture.summary?.status ?? snapshot.operational?.status ?? "validated",
        sessionIdSha256: sha256(snapshot.sessionId),
        markerSha256: sha256(canonicalJson(snapshot)),
      },
      binding: inputs.binding,
      source: { status: "attested", head: source.head, sha256: source.sha256,
        clean: inputs.git.clean, blobMatches: inputs.git.sourceMatchesHead, indexFlagsNormal: inputs.git.indexFlagsNormal },
      deployment: { status: inputs.deployment.status, provider: inputs.deployment.provider, revision: inputs.deployment.revision },
      launcher: {
        status: installed.status,
        releaseSha256: installed.release.sha256,
        buildSha256: installed.launchers["ingenium-build"].sha256,
        opencodeSha256: installed.launchers["ingenium-opencode"].sha256,
      },
      quarantine: inputs.quarantine?.quarantine ?? null,
      admission: { decision: "admit", nextOperation: "recovery-prepare" },
    };
    if (Buffer.byteLength(canonicalJson(output)) > RECOVERY_ADMISSION_MAX_BYTES) {
      throw new Error("Recovery preflight output exceeds its bound");
    }
    return output;
  } finally {
    sourceHandle.close();
  }
}

function validPreparationLaunch(value, request) {
  return hasExactKeys(value, ["schemaVersion", "kind", "sessionId", "dataHome", "launcher", "executable", "environment"])
    && value.schemaVersion === 1 && value.kind === "legacy-managed-parent" && SAFE_SESSION.test(value.sessionId ?? "")
    && typeof value.dataHome === "string" && resolve(value.dataHome) === value.dataHome
    && hasExactKeys(value.launcher, ["path", "sha256", "releaseSha256", "artifactSha256"])
    && isAbsolute(value.launcher.path) && HASH.test(value.launcher.sha256 ?? "")
    && HASH.test(value.launcher.releaseSha256 ?? "") && HASH.test(value.launcher.artifactSha256 ?? "")
    && hasExactKeys(value.executable, ["path", "sha256"]) && isAbsolute(value.executable.path)
    && value.executable.sha256 === request.parent.executableSha256
    && hasExactKeys(value.environment, ["HOME", "XDG_DATA_HOME", "INGENIUM_API_URL", "INGENIUM_PROJECT",
      "INGENIUM_PROJECT_ID", "INGENIUM_WORKSPACE_ID", "INGENIUM_STORAGE_MAPPING_HASH", "INGENIUM_WORKTREE",
      "INGENIUM_MCP_AUDIENCE", "INGENIUM_MCP_CREDENTIAL_FILE", "INGENIUM_MCP_CREDENTIAL_PURPOSE", "INGENIUM_OPENCODE_EXECUTABLE"])
    && isAbsolute(value.environment.HOME) && value.environment.XDG_DATA_HOME === value.dataHome
    && value.environment.INGENIUM_PROJECT === request.contract.binding.project
    && value.environment.INGENIUM_PROJECT_ID === request.contract.binding.projectId
    && value.environment.INGENIUM_WORKSPACE_ID === request.contract.binding.workspaceId
    && value.environment.INGENIUM_STORAGE_MAPPING_HASH === request.contract.binding.storageMappingHash
    && value.environment.INGENIUM_WORKTREE === request.contract.binding.worktree
    && value.environment.INGENIUM_MCP_AUDIENCE === "mcp"
    && isAbsolute(value.environment.INGENIUM_MCP_CREDENTIAL_FILE)
    && value.environment.INGENIUM_MCP_CREDENTIAL_PURPOSE === "general"
    && value.environment.INGENIUM_OPENCODE_EXECUTABLE === value.executable.path;
}

function readPreparationRequest(worktree) {
  const directory = preparationDirectory(worktree);
  for (const path of [resolve(worktree, ".opencode/protected-runtime-index"), dirname(directory), directory]) privatePreparationDirectory(path);
  const bytes = readOnlyRegularFile(resolve(directory, "request.json"), 64 * 1024, false, 0o600);
  const value = JSON.parse(bytes);
  const keys = ["schemaVersion", "kind", "authorizesRestart", "contract", "sourceSha256", "nonce", "handoffSha256", "parent", "quarantine", "issuedAt", "expiresAt"];
  if (!(hasExactKeys(value, keys) || hasExactKeys(value, [...keys, "launch"]))
    || value.schemaVersion !== 1 || value.kind !== "recovery-preparation" || value.authorizesRestart !== false
    || canonicalJson(value.contract) !== canonicalJson(prepareRecoveryOwnerContract(value.contract?.binding, value.contract?.sourceHead))
    || value.contract.binding.worktree !== worktree || !HASH.test(value.sourceSha256 ?? "") || !OPAQUE_TOKEN.test(value.nonce ?? "")
    || !HASH.test(value.handoffSha256 ?? "") || !safeRecoveryIdentity(value.parent)
    || !hasExactKeys(value.parent, ["pid", "startTimeTicks", "executableSha256", "nonceSha256"])
    || !validOutboxQuarantine(value.quarantine)
    || !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt)
    || value.expiresAt - value.issuedAt !== PREPARATION_LIFETIME_MS
    || value.launch !== undefined && (value.parent.nonceSha256 !== "0".repeat(64)
      || !validPreparationLaunch(value.launch, value))) throw new Error("Recovery preparation request is invalid");
  const handoff = readOnlyRegularFile(resolve(directory, "handoff.json"), 64 * 1024, false, 0o600);
  if (sha256(handoff) !== value.handoffSha256) throw new Error("Recovery preparation handoff changed");
  if (value.launch !== undefined) {
    const captured = JSON.parse(handoff);
    if (!hasExactKeys(captured, ["schemaVersion", "kind", "parent", "nonceProvenance", "sessionId", "binding", "sourceHead",
      "marker", "todos", "declaredOperational", "operational"])
      || captured.schemaVersion !== 1 || captured.kind !== "legacy-pre-admission"
      || captured.sessionId !== value.launch.sessionId || captured.sourceHead !== value.contract.sourceHead
      || canonicalJson(captured.parent) !== canonicalJson(value.parent)
      || canonicalJson(captured.binding) !== canonicalJson(value.contract.binding)) {
      throw new Error("Recovery preparation handoff changed");
    }
    if (!validLegacyRecoveryTodoHandoff({ marker: captured.marker, todos: captured.todos,
      declaredOperational: captured.declaredOperational }, captured.sessionId)) {
      throw new Error("Recovery preparation handoff changed");
    }
  }
  return { value, bytes, directory };
}

function directProcessChildren(pid) {
  try {
    const value = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim();
    if (!value) return [];
    const children = value.split(/\s+/).map(Number);
    return children.every((child) => Number.isSafeInteger(child) && child > 1) ? children : [];
  } catch { return []; }
}

function removeManagedParentAuthentication(record) {
  let current;
  try { current = lstatSync(record.path); } catch (error) {
    if (error?.code === "ENOENT") return;
    throw new Error("Managed recovery parent authentication rollback failed");
  }
  if (!current.isFile() || current.isSymbolicLink() || (current.mode & 0o777) !== 0o600
    || !sourceIdentityMatches(record.identity, current)
    || record.sha256 && sha256(readOnlyRegularFile(record.path, 1024, false, 0o600)) !== record.sha256) {
    throw new Error("Managed recovery parent authentication changed");
  }
  anchoredPreparationPath(record.path, (anchored) => {
    if (!sourceIdentityMatches(record.identity, lstatSync(anchored))) {
      throw new Error("Managed recovery parent authentication changed");
    }
    unlinkSync(anchored);
  });
}

function persistManagedParentAuthentication(dataHome, authentication) {
  let directory;
  try { directory = realpathSync(resolve(dataHome)); } catch {
    throw new Error("Managed recovery parent authentication is unavailable");
  }
  if (directory !== dataHome) throw new Error("Managed recovery parent authentication is unavailable");
  canonicalOwnedDirectory(directory, "Managed recovery parent data home");
  const path = resolve(directory, ".ingenium-recovery-server-auth.json");
  const bytes = Buffer.from(`${JSON.stringify({ username: "opencode", password: authentication })}\n`);
  const record = { path, identity: null, sha256: sha256(bytes) };
  try {
    writePreparationFile(path, bytes, (identity) => { record.identity = identity; });
    if (!record.identity || !bytes.equals(readOnlyRegularFile(path, 1024, false, 0o600))
      || !sourceIdentityMatches(record.identity, lstatSync(path))) {
      throw new Error("Managed recovery parent authentication is unavailable");
    }
    return record;
  } catch {
    if (record.identity) {
      try { removeManagedParentAuthentication({ ...record, sha256: null }); } catch {}
    }
    throw new Error("Managed recovery parent authentication is unavailable");
  } finally { bytes.fill(0); }
}

function inspectManagedParent(request, launch, child, authentication, dependencies, expected) {
  const inspect = dependencies.inspect ?? inspectAncestor;
  const environment = dependencies.environment ?? processEnvironment;
  const children = dependencies.children ?? directProcessChildren;
  const listeningPorts = dependencies.listeningPorts ?? processListeningPorts;
  const inspectOnce = () => {
    if (!Number.isSafeInteger(child.pid) || child.pid < 2) return null;
    const launcher = inspect(child.pid);
    const descendantPids = children(child.pid);
    if (!launcher || launcher.pid !== child.pid || launcher.commandName !== "node"
      || launcher.cwd !== request.contract.binding.worktree || descendantPids.length !== 1) return null;
    const replacement = inspect(descendantPids[0]);
    const launcherEnvironment = environment(child.pid);
    const replacementEnvironment = environment(descendantPids[0]);
    const port = Number(replacementEnvironment?.INGENIUM_OPENCODE_PORT);
    const nonce = replacementEnvironment?.INGENIUM_RESTART_NONCE;
    const ports = listeningPorts(descendantPids[0]);
    if (launcherEnvironment?.INGENIUM_RECOVERY_PREPARATION_NONCE !== request.nonce
      || replacement?.pid !== descendantPids[0] || replacement.commandName !== "opencode"
      || replacement.parentPid !== child.pid || replacement.cwd !== request.contract.binding.worktree
      || replacement.executableSha256 !== launch.executable.sha256 || !OPAQUE_TOKEN.test(nonce ?? "")
      || !Number.isSafeInteger(port) || port < 1024 || port > 65535
      || replacementEnvironment?.OPENCODE_SERVER_PASSWORD !== authentication
      || replacementEnvironment?.INGENIUM_RECOVERY_PREPARATION_NONCE !== request.nonce
      || replacementEnvironment?.INGENIUM_RECOVERY_OWNER_PID !== String(child.pid)
      || replacementEnvironment?.INGENIUM_RECOVERY_OWNER_START_TICKS !== String(launcher.startTimeTicks)
      || ports.length !== 1 || ports[0] !== port) return null;
    return {
      launcher: { pid: launcher.pid, startTimeTicks: launcher.startTimeTicks,
        executableSha256: launcher.executableSha256, nonceSha256: sha256(request.nonce) },
      replacement: { pid: replacement.pid, startTimeTicks: replacement.startTimeTicks,
        executableSha256: replacement.executableSha256, nonceSha256: sha256(nonce), port, dataHome: launch.dataHome },
    };
  };
  const before = inspectOnce();
  const after = before && inspectOnce();
  if (!before || !after || canonicalJson(before) !== canonicalJson(after)
    || expected && canonicalJson(after) !== canonicalJson(expected)) return null;
  return after;
}

async function managedParentHealth(managed, authentication, request = fetch) {
  const response = await request(`http://127.0.0.1:${managed.replacement.port}/global/health`, {
    method: "GET",
    headers: { authorization: `Basic ${Buffer.from(`opencode:${authentication}`).toString("base64")}` },
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  const payload = response.status === 200 ? responseValue(await response.json()) : null;
  if (payload?.healthy !== true) throw new Error("Managed recovery parent health is unavailable");
  return { status: "healthy", checkedAt: Date.now(), versionSha256: sha256(String(payload.version ?? "unknown")) };
}

export async function startPreparedManagedParent(request, dependencies = {}) {
  const launch = request.launch;
  if (!validPreparationLaunch(launch, request)) throw new Error("Managed recovery parent request is invalid");
  if (readTrustedRegularFile(launch.launcher.path, "Installed managed OpenCode launcher", {
    executable: true, expectedMode: 0o500,
  }).sha256 !== launch.launcher.sha256
    || readTrustedRegularFile(launch.executable.path, "Recovery preparation OpenCode executable", {
      expectedOwner: lstatSync(launch.executable.path).uid, executable: true,
    }).sha256 !== launch.executable.sha256) throw new Error("Managed recovery parent launcher changed");
  const authentication = randomBytes(32).toString("base64url");
  const authenticationRecord = persistManagedParentAuthentication(launch.dataHome, authentication);
  let authenticationRetained = true;
  const removeAuthentication = () => {
    if (!authenticationRetained) return;
    removeManagedParentAuthentication(authenticationRecord);
    authenticationRetained = false;
  };
  let child;
  try {
    child = (dependencies.spawn ?? spawn)(launch.launcher.path, ["serve"], {
      cwd: request.contract.binding.worktree,
      shell: false,
      stdio: "ignore",
      env: { ...launch.environment, PATH: "/usr/local/bin:/usr/bin:/bin", TERM: "dumb", NO_COLOR: "1",
        OPENCODE_SERVER_PASSWORD: authentication, INGENIUM_RECOVERY_PREPARATION_NONCE: request.nonce },
    });
  } catch {
    removeAuthentication();
    throw new Error("Managed recovery parent did not start");
  }
  let spawnError;
  child.once?.("error", (error) => { spawnError = error; });
  const wait = dependencies.wait ?? (() => new Promise((done) => setTimeout(done, 100)));
  let managed;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (spawnError) break;
    managed = inspectManagedParent(request, launch, child, authentication, dependencies);
    if (managed) {
      try {
        const evidence = (identity, health) => ({
          schemaVersion: 1,
          ...identity,
          health,
          handoff: { sessionId: launch.sessionId, sha256: request.handoffSha256, status: "captured" },
          ownership: { job: PREPARATION_JOB, ownerNonceSha256: sha256(request.nonce), status: "external" },
          rollback: { status: "armed", scope: "exact-owned-replacement" },
          adoption: { status: "pending", requires: "replacement-first-restart" },
          fencing: { current: 1, successorMinimum: 2, staleCalls: "reject" },
        });
        const initial = evidence(managed, await managedParentHealth(managed, authentication, dependencies.request ?? fetch));
        return {
          child,
          evidence: initial,
          removeAuthentication,
          refresh: async () => {
            const current = inspectManagedParent(request, launch, child, authentication, dependencies, managed);
            if (!current) throw new Error("Managed recovery parent identity changed");
            return evidence(current, await managedParentHealth(current, authentication, dependencies.request ?? fetch));
          },
        };
      } catch { /* Continue until the reserved server is ready. */ }
    }
    await wait();
  }
  if (managed) stopPreparedManagedParent({ evidence: managed, removeAuthentication },
    dependencies.inspect ?? inspectAncestor, dependencies.kill ?? process.kill);
  else try { child.kill?.("SIGTERM"); } catch { /* An already-exited launcher needs no rollback signal. */ }
  removeAuthentication();
  throw new Error("Managed recovery parent did not become healthy");
}

function stopPreparedManagedParent(control, inspect = inspectAncestor, kill = process.kill) {
  try {
    for (const identity of [control?.evidence?.replacement, control?.evidence?.launcher]) {
      if (!identity) continue;
      const actual = inspect(identity.pid);
      if (actual && actual.startTimeTicks === identity.startTimeTicks && actual.executableSha256 === identity.executableSha256) {
        try { kill(identity.pid, "SIGTERM"); } catch { /* An already-exited owned process needs no rollback signal. */ }
      }
    }
  } finally { control?.removeAuthentication?.(); }
}

function validManagedPreparationStatus(managed, request, now) {
  return hasExactKeys(managed, ["schemaVersion", "launcher", "replacement", "health", "handoff", "ownership", "rollback", "adoption", "fencing"])
    && managed.schemaVersion === 1
    && hasExactKeys(managed.launcher, ["pid", "startTimeTicks", "executableSha256", "nonceSha256"])
    && safeRecoveryIdentity(managed.launcher) && managed.launcher.nonceSha256 === sha256(request.nonce)
    && hasExactKeys(managed.replacement, ["pid", "startTimeTicks", "executableSha256", "nonceSha256", "port", "dataHome"])
    && safeRecoveryIdentity(managed.replacement) && managed.replacement.executableSha256 === request.launch.executable.sha256
    && Number.isSafeInteger(managed.replacement.port) && managed.replacement.port >= 1024 && managed.replacement.port <= 65535
    && managed.replacement.dataHome === request.launch.dataHome
    && hasExactKeys(managed.health, ["status", "checkedAt", "versionSha256"])
    && managed.health.status === "healthy" && Number.isSafeInteger(managed.health.checkedAt)
    && managed.health.checkedAt >= request.issuedAt && managed.health.checkedAt <= now && now - managed.health.checkedAt <= 5_000
    && HASH.test(managed.health.versionSha256 ?? "")
    && canonicalJson(managed.handoff) === canonicalJson({ sessionId: request.launch.sessionId, sha256: request.handoffSha256, status: "captured" })
    && canonicalJson(managed.ownership) === canonicalJson({ job: PREPARATION_JOB, ownerNonceSha256: sha256(request.nonce), status: "external" })
    && canonicalJson(managed.rollback) === canonicalJson({ status: "armed", scope: "exact-owned-replacement" })
    && canonicalJson(managed.adoption) === canonicalJson({ status: "pending", requires: "replacement-first-restart" })
    && canonicalJson(managed.fencing) === canonicalJson({ current: 1, successorMinimum: 2, staleCalls: "reject" });
}

export function inspectPreparedRecoveryOwner(request, options = {}) {
  try {
    const retained = readPreparationRequest(request.contract.binding.worktree);
    if (canonicalJson(retained.value) !== canonicalJson(request)) return null;
    const statusBytes = readOnlyRegularFile(resolve(retained.directory, "owner-status.json"), 16 * 1024, false, 0o600);
    const status = JSON.parse(statusBytes);
    const now = options.now ?? Date.now();
    const statusKeys = ["schemaVersion", "requestSha256", "job", "invocationId", "owner", "fence", "fenceState", "lease", "health", "authorizesRestart"];
    if (!(hasExactKeys(status, statusKeys) || request.launch !== undefined && hasExactKeys(status, [...statusKeys, "managed"]))
      || status.schemaVersion !== 1 || status.requestSha256 !== sha256(retained.bytes) || status.job !== PREPARATION_JOB
      || !/^[0-9a-f]{32}$/.test(status.invocationId ?? "") || !safeRecoveryIdentity(status.owner)
      || status.owner.nonceSha256 !== sha256(request.nonce) || status.fence !== 1 || status.fenceState !== "reserved"
      || status.authorizesRestart !== false || status.health !== "ready"
      || !hasExactKeys(status.lease, ["issuedAt", "expiresAt"]) || !Number.isSafeInteger(status.lease.issuedAt)
      || !Number.isSafeInteger(status.lease.expiresAt) || status.lease.issuedAt > now || status.lease.expiresAt <= now
      || status.lease.expiresAt > request.expiresAt || status.lease.expiresAt - status.lease.issuedAt > request.contract.maximumLeaseMs
      || now < request.issuedAt || now >= request.expiresAt
      || request.launch !== undefined && !validManagedPreparationStatus(status.managed, request, now)
      || recoveryAdmissionExists(resolve(retained.directory, "rollback.json"))) return null;
    const job = inspectPreparationJob(options.run);
    if (job.LoadState !== "loaded" || job.ActiveState !== "active" || job.SubState !== "running" || job.Job !== ""
      || job.MainPID !== String(status.owner.pid) || job.InvocationID !== status.invocationId) return null;
    const inspect = options.inspect ?? inspectAncestor;
    const owner = inspect(status.owner.pid);
    const script = resolve(retained.directory, "owner.mjs");
    const canonicalSource = resolve(request.contract.binding.worktree, "packages/ingenium-extension/scripts/recovery-bootstrap.js");
    const environment = (options.environment ?? processEnvironment)(status.owner.pid);
    if (!owner || owner.startTimeTicks !== status.owner.startTimeTicks || owner.executableSha256 !== status.owner.executableSha256
      || owner.cwd !== request.contract.binding.worktree || owner.commandName !== "node" || owner.argv.length !== 3
      || owner.argv[1] !== script || owner.argv[2] !== PREPARATION_OWNER_ARGUMENT
      || environment?.INVOCATION_ID !== status.invocationId
      || readTrustedRegularFile(canonicalSource, "Recovery preparation source", { expectedMode: 0o644 }).sha256 !== request.sourceSha256
      || readTrustedRegularFile(script, "Recovery preparation staged source", { expectedMode: 0o400 }).sha256 !== request.sourceSha256
      || !statusBytes.equals(readOnlyRegularFile(resolve(retained.directory, "owner-status.json"), 16 * 1024, false, 0o600))
      || canonicalJson(inspect(status.owner.pid)) !== canonicalJson(owner)) return null;
    if (request.launch !== undefined) {
      const launcher = inspect(status.managed.launcher.pid);
      const replacement = inspect(status.managed.replacement.pid);
      const launcherEnvironment = (options.environment ?? processEnvironment)(status.managed.launcher.pid);
      const replacementEnvironment = (options.environment ?? processEnvironment)(status.managed.replacement.pid);
      if (!launcher || launcher.startTimeTicks !== status.managed.launcher.startTimeTicks
        || launcher.executableSha256 !== status.managed.launcher.executableSha256
        || launcher.cwd !== request.contract.binding.worktree
        || launcherEnvironment?.INGENIUM_RECOVERY_PREPARATION_NONCE !== request.nonce
        || !replacement || replacement.parentPid !== launcher.pid || replacement.commandName !== "opencode"
        || replacement.startTimeTicks !== status.managed.replacement.startTimeTicks
        || replacement.executableSha256 !== status.managed.replacement.executableSha256
        || replacement.cwd !== request.contract.binding.worktree
        || sha256(replacementEnvironment?.INGENIUM_RESTART_NONCE ?? "") !== status.managed.replacement.nonceSha256
        || Number(replacementEnvironment?.INGENIUM_OPENCODE_PORT) !== status.managed.replacement.port) return null;
    }
    return { status: "attested", authorizesRestart: false, job: status.job, invocationId: status.invocationId,
      owner: status.owner, fence: status.fence, fenceState: status.fenceState, lease: status.lease, health: status.health,
      ...(status.managed ? { managed: status.managed } : {}),
      sourceHead: request.contract.sourceHead, sourceSha256: request.sourceSha256,
      bindingSha256: sha256(canonicalJson(request.contract.binding)), handoffSha256: request.handoffSha256,
      evidenceSha256: sha256(statusBytes) };
  } catch { return null; }
}

export async function runPreparedRecoveryOwner(argv = process.argv, dependencies = {}) {
  const invocationId = (dependencies.environment ?? process.env).INVOCATION_ID;
  if (argv.length !== 3 || argv[2] !== PREPARATION_OWNER_ARGUMENT || !/^[0-9a-f]{32}$/.test(invocationId ?? "")) {
    throw new Error("Recovery preparation owner invocation is invalid");
  }
  const path = dependencies.sourcePath ?? fileURLToPath(import.meta.url);
  const worktree = resolve(dirname(path), "../../../..");
  if (path !== resolve(preparationDirectory(worktree), "owner.mjs") || argv[1] !== path
    || (dependencies.cwd ?? process.cwd()) !== worktree) throw new Error("Recovery preparation owner source is invalid");
  const retained = readPreparationRequest(worktree);
  const request = retained.value;
  if (readTrustedRegularFile(path, "Recovery preparation staged source", { expectedMode: 0o400 }).sha256 !== request.sourceSha256) {
    throw new Error("Recovery preparation staged source changed");
  }
  const source = (dependencies.openSource ?? openVerifiedRecoverySource)({ repositoryRoot: worktree,
    sourcePath: resolve(worktree, "packages/ingenium-extension/scripts/recovery-bootstrap.js"),
    head: request.contract.sourceHead, sourceSha256: request.sourceSha256 });
  const inspect = dependencies.inspect ?? inspectAncestor;
  const self = inspect(process.pid);
  if (!self) { source.close(); throw new Error("Recovery preparation owner identity is unavailable"); }
  const statusPath = resolve(retained.directory, "owner-status.json");
  let previous;
  let managedControl;
  try {
    if (request.launch) managedControl = await (dependencies.startManagedParent ?? startPreparedManagedParent)(request, dependencies);
    while (Date.now() < request.expiresAt) {
      if (recoveryAdmissionExists(resolve(retained.directory, "rollback.json"))) break;
      source.revalidate();
      if (!retained.bytes.equals(readPreparationRequest(worktree).bytes)) throw new Error("Recovery preparation request changed");
      const job = inspectPreparationJob(dependencies.run);
      if (job.LoadState !== "loaded" || job.ActiveState !== "active" || job.MainPID !== String(self.pid)
        || job.InvocationID !== invocationId) throw new Error("Recovery preparation owner job changed");
      const parent = inspect(request.parent.pid);
      if (!parent || parent.startTimeTicks !== request.parent.startTimeTicks || parent.executableSha256 !== request.parent.executableSha256) break;
      const now = Date.now();
      if (now < request.issuedAt) throw new Error("Recovery preparation clock changed");
      if (managedControl) managedControl.evidence = await managedControl.refresh();
      const status = { schemaVersion: 1, requestSha256: sha256(retained.bytes), job: PREPARATION_JOB,
        invocationId,
        owner: { pid: self.pid, startTimeTicks: self.startTimeTicks, executableSha256: self.executableSha256, nonceSha256: sha256(request.nonce) },
        fence: 1, fenceState: "reserved", lease: { issuedAt: now, expiresAt: Math.min(now + request.contract.maximumLeaseMs, request.expiresAt) },
        health: "ready", authorizesRestart: false, ...(managedControl ? { managed: managedControl.evidence } : {}) };
      const bytes = Buffer.from(canonicalJson(status));
      if (previous) {
        if (!previous.equals(readOnlyRegularFile(statusPath, 16 * 1024, false, 0o600))) throw new Error("Recovery preparation status changed");
        writePreparationFile(resolve(retained.directory, "owner-status.next"), bytes);
        anchoredPreparationPath(statusPath, (anchored) => renameSync(resolve(dirname(anchored), "owner-status.next"), anchored));
      } else writePreparationFile(statusPath, bytes);
      previous = bytes;
      await (dependencies.wait ?? (() => new Promise((done) => setTimeout(done, 1_000))))();
    }
  } finally {
    if (managedControl) (dependencies.stopManagedParent ?? stopPreparedManagedParent)(managedControl,
      dependencies.inspect ?? inspectAncestor, dependencies.kill ?? process.kill);
    source.close();
  }
}

export async function runRecoveryPreparation(argv = process.argv, dependencies = {}) {
  if (argv.length !== 2) throw new Error("Recovery preparation accepts no arguments");
  const sourceHandle = (dependencies.openSource ?? openVerifiedRecoverySource)(dependencies.attestation ?? MODULE_ATTESTATION);
  const undo = [];
  let directory;
  let request;
  let startAttempted = false;
  let startConfirmed = false;
  let phase = "inspect";
  const run = dependencies.run ?? execFileSync;
  const wait = dependencies.wait ?? (() => new Promise((done) => setTimeout(done, 100)));
  const ownedFile = (path, bytes, requiresStoppedOwner = true, mode = 0o600) => {
    writePreparationFile(path, bytes, (identity, complete) => {
      undo.push({ requiresStoppedOwner, rollback: () => {
        const current = lstatSync(path);
        if (!current.isFile() || current.isSymbolicLink() || !sourceIdentityMatches(identity, current)
          || complete && !bytes.equals(readOnlyRegularFile(path, RECOVERY_SOURCE_MAX_BYTES, false, mode))) {
          throw new Error("Recovery preparation rollback file changed");
        }
        anchoredPreparationPath(path, (anchored) => {
          if (!sourceIdentityMatches(identity, lstatSync(anchored))) throw new Error("Recovery preparation rollback file changed");
          unlinkSync(anchored);
        });
      } });
    }, mode);
  };
  const ownedDirectory = (path, exclusive = false, requiresStoppedOwner = true) => {
    if (!exclusive && recoveryAdmissionExists(path)) { privatePreparationDirectory(path); return; }
    anchoredPreparationPath(path, (anchored) => {
      mkdirSync(anchored, { mode: 0o700 });
      const identity = lstatSync(anchored);
      undo.push({ requiresStoppedOwner, rollback: () => {
        privatePreparationDirectory(path);
        anchoredPreparationPath(path, (current) => {
          if (!directoryIdentityMatches(identity, lstatSync(current))) throw new Error("Recovery preparation rollback directory changed");
          rmdirSync(current);
        });
      } });
    });
  };
  try {
    const inputs = await (dependencies.collectInputs ?? collectPreparationInputs)(sourceHandle);
    if (!absentPreparationJob(inspectPreparationJob(run))) throw new Error("Recovery preparation owner already exists");
    phase = "prepare";
    const worktree = inputs.binding.worktree;
    canonicalOwnedDirectory(resolve(worktree, ".opencode"), "Recovery preparation project directory");
    const index = resolve(worktree, ".opencode/protected-runtime-index");
    directory = preparationDirectory(worktree);
    if (recoveryAdmissionExists(directory)) throw new Error("Recovery preparation requires reconciliation of retained state");
    for (const path of [index, dirname(directory)]) ownedDirectory(path);
    ownedDirectory(directory, true);
    const handoffBytes = Buffer.from(canonicalJson(inputs.capture.snapshot));
    ownedFile(resolve(directory, "handoff.json"), handoffBytes);
    const now = Date.now();
    request = { schemaVersion: 1, kind: "recovery-preparation", authorizesRestart: false, contract: inputs.contract,
      sourceSha256: inputs.source.sha256, nonce: randomBytes(32).toString("base64url"), handoffSha256: sha256(handoffBytes),
      parent: inputs.capture.snapshot.parent, ...(inputs.launch ? { launch: inputs.launch } : {}),
      quarantine: inputs.quarantine?.quarantine ?? null, issuedAt: now, expiresAt: now + PREPARATION_LIFETIME_MS };
    ownedFile(resolve(directory, "request.json"), Buffer.from(canonicalJson(request)));
    const stagedSource = resolve(directory, "owner.mjs");
    ownedFile(stagedSource, inputs.source.bytes, true, 0o400);
    validatePreparationQuarantine(inputs.quarantine);
    const preparedCoordination = summarizeCoordinationOutboxState(index);
    if (!preparationQuarantineMatches(preparedCoordination.outbox, inputs.quarantine)) {
      throw new Error("Recovery preparation quarantine changed");
    }
    sourceHandle.revalidate();
    const runtimePath = realpathSync(process.execPath);
    const runtimeOwner = lstatSync(runtimePath).uid;
    if (runtimeOwner !== 0 && runtimeOwner !== ownerUid()) throw new Error("Recovery preparation runtime owner is invalid");
    const runtime = readTrustedRegularFile(runtimePath, "Recovery preparation runtime", { expectedOwner: runtimeOwner, executable: true });
    phase = "start";
    startAttempted = true;
    preparationSystemd("systemd-run", ["--unit", PREPARATION_JOB, "--collect", "--no-block",
      "--property=Type=exec", "--property=Restart=no", "--property=UMask=0077",
      `--property=WorkingDirectory=${worktree}`, "--property=StandardOutput=null", "--property=StandardError=null",
      "--property=UnsetEnvironment=NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_DEBUG_OUTPUT LD_PROFILE LD_PROFILE_OUTPUT GLIBC_TUNABLES OPENSSL_CONF OPENSSL_MODULES INGENIUM_RECOVERY_ATTESTED_CONTEXT INGENIUM_RECOVERY_PREPARATION",
      "--", runtime.path, stagedSource, PREPARATION_OWNER_ARGUMENT], run);
    startConfirmed = true;
    phase = "attest";
    let evidence;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      evidence = (dependencies.inspectOwner ?? inspectPreparedRecoveryOwner)(request, { run });
      if (evidence) break;
      await wait();
    }
    if (!evidence) throw new Error("Recovery preparation owner attestation failed");
    phase = "confirm";
    const confirmed = await (dependencies.collectInputs ?? collectPreparationInputs)(sourceHandle);
    if (canonicalJson(confirmed.capture.snapshot) !== canonicalJson(inputs.capture.snapshot)
      || canonicalJson(confirmed.binding) !== canonicalJson(inputs.binding)
      || canonicalJson(confirmed.launch ?? null) !== canonicalJson(inputs.launch ?? null)) {
      throw new Error("Recovery preparation capture changed");
    }
    sourceHandle.revalidate();
    evidence = (dependencies.inspectOwner ?? inspectPreparedRecoveryOwner)(request, { run });
    if (!evidence) throw new Error("Recovery preparation owner changed");
    validatePreparationQuarantine(inputs.quarantine);
    const finalCoordination = summarizeCoordinationOutboxState(index);
    if (canonicalJson(confirmed.quarantine ?? null) !== canonicalJson(inputs.quarantine ?? null)
      || finalCoordination.outbox.status === "invalid" || finalCoordination.disposition.status === "invalid"
      || !preparationQuarantineMatches(finalCoordination.outbox, inputs.quarantine)
      || canonicalJson(finalCoordination.disposition) !== canonicalJson(preparedCoordination.disposition)) {
      throw new Error("Recovery preparation final quarantine changed");
    }
    return { schemaVersion: 1, action: "recovery-prepare", authorizesRestart: false, status: "prepared", owner: evidence,
      quarantine: inputs.quarantine?.quarantine ?? null };
  } catch (cause) {
    let reconciled = true;
    if (startAttempted) {
      // The manager may have accepted a timed-out start. A durable stop request also covers a late owner.
      try {
        ownedFile(resolve(directory, "rollback.json"), Buffer.from(canonicalJson({ nonceSha256: sha256(request.nonce), authorizesRestart: false })));
        reconciled = false;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          if (absentPreparationJob(inspectPreparationJob(run)) && startConfirmed) { reconciled = true; break; }
          await wait();
        }
        if (reconciled) {
          for (const name of ["owner-status.json", "owner-status.next"]) {
            const path = resolve(directory, name);
            if (!recoveryAdmissionExists(path)) continue;
            const bytes = readOnlyRegularFile(path, 16 * 1024, false, 0o600);
            const value = JSON.parse(bytes);
            if (value.requestSha256 !== sha256(canonicalJson(request)) || value.owner?.nonceSha256 !== sha256(request.nonce)) {
              throw new Error("Recovery preparation rollback status is foreign");
            }
            anchoredPreparationPath(path, (anchored) => {
              if (!bytes.equals(readFileSync(anchored))) throw new Error("Recovery preparation rollback status changed");
              unlinkSync(anchored);
            });
          }
        }
      } catch { reconciled = false; }
    }
    for (const entry of undo.reverse()) {
      if (!reconciled && entry.requiresStoppedOwner) continue;
      try { entry.rollback(); } catch { reconciled = false; }
    }
    const error = new Error(reconciled ? "Recovery preparation failed; owned preparation rolled back" : "Recovery preparation requires reconciliation; retained protected evidence");
    error.code = reconciled ? "RECOVERY_PREPARATION_ROLLED_BACK" : "RECOVERY_PREPARATION_RECONCILIATION_REQUIRED";
    error.phase = phase;
    error.authorizesRestart = false;
    error.failure = recoveryPreparationFailureDetail(cause, phase);
    throw error;
  } finally { sourceHandle.close(); }
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
function currentParentEvidence(worktree, parent, binding, head, now = Date.now(), handoff) {
  const empty = (status) => ({ summary: { status, role: null, project: null, enrollmentSha256: null }, record: null });
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
        || parent.sessionId !== null && record.sessions[0].sessionId !== parent.sessionId
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
    return { summary: { status: "validated", role: record.sessions[0].role, project: record.binding.project,
      enrollmentSha256: record.enrollmentSha256 }, record };
  } catch (error) {
    return empty(error?.code === "ENOENT" ? "missing" : "invalid");
  }
}

export function readCurrentParentSummary(worktree, parent, binding, head, now = Date.now(), handoff) {
  return currentParentEvidence(worktree, parent, binding, head, now, handoff).summary;
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
    configuredEnvironment = recoveryConfiguredEnvironment(worktree, environment, source?.head);
    const parentEnvironment = parentInternal?.environment ?? {};
    for (const key of ["INGENIUM_PROJECT", "INGENIUM_PROJECT_ID", "INGENIUM_WORKSPACE_ID", "INGENIUM_WORKTREE", "INGENIUM_STORAGE_MAPPING_HASH", "INGENIUM_API_URL"]) {
      if (parentEnvironment[key] !== undefined && configuredEnvironment[key] !== undefined
        && parentEnvironment[key] !== configuredEnvironment[key]) throw new Error("Recovery parent binding mismatch");
    }
    binding = await corroborateRecoveryBinding(worktree, configuredEnvironment, options.request ?? fetch);
    if (parentEnvironment.INGENIUM_PROJECT_ID !== undefined && parentEnvironment.INGENIUM_PROJECT_ID !== binding.projectId
      || parentEnvironment.INGENIUM_STORAGE_MAPPING_HASH !== undefined && parentEnvironment.INGENIUM_STORAGE_MAPPING_HASH !== binding.storageMappingHash) binding = null;
  } catch {}
  const gitSummary = worktree && source
    ? collectGitSummary(worktree, source.path, source.bytes)
    : { status: "invalid", head: null, dirtyPaths: [], sourceMatchesHead: false };
  const currentParentDiscovery = worktree ? currentParentEvidence(worktree, parent, binding,
    gitSummary.dirtyPaths.length === 0 ? gitSummary.head : null) : { record: null };
  if (currentParentDiscovery.record && parentInternal && parent) {
    parentInternal.sessionId = currentParentDiscovery.record.sessions[0].sessionId;
    parent.sessionId = parentInternal.sessionId;
  }
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
  const protectedIndex = worktree ? resolve(worktree, ".opencode/protected-runtime-index") : null;
  const confirmedCurrentParent = worktree ? currentParentEvidence(worktree, parent, binding,
    gitSummary.dirtyPaths.length === 0 ? gitSummary.head : null, Date.now(), recovery.summary.handoff)
    : { summary: { status: "invalid", role: null, project: null, enrollmentSha256: null }, record: null };
  const currentSession = confirmedCurrentParent.record?.sessions[0];
  const currentParent = { ...confirmedCurrentParent.summary, session: currentSession ? {
    incarnation: currentSession.incarnation,
    revision: currentSession.revision,
    fence: currentSession.fence,
  } : null };
  const preAdmissionCapture = currentParent.status === "missing"
    ? await captureLegacyRecoveryPreAdmission(parentInternal, binding, gitSummary, options.request ?? fetch) : null;
  if (preAdmissionCapture) {
    parent.sessionId = preAdmissionCapture.snapshot.sessionId;
    recovery.summary = { status: "validated", state: recovery.summary.state, handoff: preAdmissionCapture.summary };
  }
  const coordination = protectedIndex ? summarizeCoordinationOutboxState(protectedIndex) : {
    outbox: { status: "invalid", count: 0, ambiguousCount: 0, sha256: null, quarantine: null },
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
  if (outbox.status === "invalid" || !validRecoveryOutboxQuarantineState(outbox)) failures.push("outbox");
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
    || !GIT_OID.test(preflight.git?.head ?? "") || !preflight.parent || !preflight.binding
    || !validRecoveryOutboxQuarantineState(preflight.outbox)) {
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
    outboxQuarantine: preflight.outbox?.quarantine ?? null,
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

export async function mintRecoveryAdmissionArtifact(preflight, preflightDigest, path, options = {}) {
  const expected = expectedRecoveryAdmission(preflight, preflightDigest);
  const session = preflight.currentParent?.session;
  if (!hasExactKeys(session, ["incarnation", "revision", "fence"])
    || !Number.isSafeInteger(session.incarnation) || session.incarnation < 1 || session.incarnation >= Number.MAX_SAFE_INTEGER
    || !Number.isSafeInteger(session.revision) || session.revision < 0
    || !Number.isSafeInteger(session.fence) || session.fence < 1) {
    throw new Error("Recovery admission session evidence is unavailable");
  }
  const environment = options.environment ?? recoveryEnvironmentForBinding(expected.binding);
  const parentEnvironment = (options.parentEnvironment ?? processEnvironment)(expected.parent.pid);
  const parentNonce = parentEnvironment?.INGENIUM_RESTART_NONCE;
  const parentExecutable = options.parentExecutable ?? `/proc/${expected.parent.pid}/exe`;
  let executableSha256;
  try { executableSha256 = sha256(readFileSync(realpathSync(parentExecutable))); } catch {}
  if (!OPAQUE_TOKEN.test(parentNonce ?? "") || sha256(parentNonce) !== expected.parent.nonceSha256
    || executableSha256 !== expected.parent.executableSha256) {
    throw new Error("Recovery admission parent secret evidence is unavailable");
  }
  let base;
  try { base = new URL(environment.INGENIUM_API_URL); } catch {}
  if (!base || base.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(base.hostname)
    || base.username || base.password || base.search || base.hash
    || environment.INGENIUM_PROJECT !== expected.binding.project
    || environment.INGENIUM_PROJECT_ID !== expected.binding.projectId
    || environment.INGENIUM_WORKSPACE_ID !== expected.binding.workspaceId
    || environment.INGENIUM_STORAGE_MAPPING_HASH !== expected.binding.storageMappingHash
    || environment.INGENIUM_WORKTREE !== expected.binding.worktree || environment.INGENIUM_MCP_AUDIENCE !== "mcp") {
    throw new Error("Recovery admission binding changed");
  }
  const credential = readRecoveryApiToken(expected.binding.worktree, environment);
  const request = options.request ?? fetch;
  const worktreeId = `worktree-${sha256(`${expected.binding.workspaceId}\0${expected.binding.storageMappingHash}`)}`;
  const incarnation = session.incarnation + 1;
  const ownershipToken = randomBytes(32).toString("base64url");
  const headers = { Authorization: `Bearer ${credential}`, "Content-Type": "application/json",
    "X-Ingenium-Audience": "mcp", "X-Ingenium-Workspace": expected.binding.workspaceId,
    "X-Ingenium-Launcher-Worktree": expected.binding.worktree };
  const endpoint = (suffix) => {
    const target = new URL(`${base.href.replace(/\/$/, "")}/coordination/${suffix}`);
    target.searchParams.set("project", expected.binding.project);
    return target;
  };
  const post = async (suffix, body) => {
    const response = await request(endpoint(suffix), { method: "POST", redirect: "error",
      signal: AbortSignal.timeout(5_000), headers, body: canonicalJson(body) });
    let payload;
    try { payload = await response.json(); } catch {}
    return { response, data: payload?.data };
  };
  let lease;
  let registrationAttempted = false;
  let artifactIdentity;
  let artifactBytes;
  let directoryCreated = false;
  const requested = resolve(path);
  const directory = dirname(requested);
  const removeArtifact = () => {
    if (!artifactIdentity || !recoveryAdmissionExists(requested)) return;
    const current = lstatSync(requested);
    if (!current.isFile() || current.isSymbolicLink() || !sourceIdentityMatches(artifactIdentity, current)
      || !artifactBytes.equals(readOnlyRegularFile(requested, RECOVERY_ADMISSION_MAX_BYTES, false, 0o600))) {
      throw new Error("Recovery admission rollback artifact changed");
    }
    unlinkSync(requested);
  };
  const inspectLease = async () => {
    const target = endpoint("snapshot");
    target.searchParams.set("worktree_id", worktreeId);
    target.searchParams.set("session_id", expected.parent.sessionId);
    target.searchParams.set("incarnation", String(incarnation));
    const response = await request(target, { method: "GET", redirect: "error", signal: AbortSignal.timeout(5_000),
      headers: { ...headers, "X-Ingenium-Coordination-Ownership": ownershipToken } });
    if (response.status === 404) return null;
    let payload;
    try { payload = await response.json(); } catch {}
    const current = payload?.data?.session;
    if (response.status !== 200 || !Number.isSafeInteger(current?.revision) || current.revision < 0
      || !Number.isSafeInteger(current?.fence) || current.fence < 1 || !["active", "closed"].includes(current.state)) {
      throw new Error("Recovery admission session rollback inspection failed");
    }
    return current;
  };
  const closeLease = async () => {
    if (!registrationAttempted) return;
    const current = await inspectLease();
    if (!current || current.state === "closed") {
      lease = undefined;
      registrationAttempted = false;
      return;
    }
    const closed = await post("close", { worktree_id: worktreeId, session_id: expected.parent.sessionId,
      incarnation, expected_revision: current.revision, fence: current.fence, ownership_token: ownershipToken,
      idempotency_key: randomUUID() });
    if (closed.response.status !== 200 || closed.data?.session?.state !== "closed"
      || closed.data.session.revision !== current.revision + 1 || closed.data.session.fence !== current.fence) {
      throw new Error("Recovery admission session rollback failed");
    }
    lease = undefined;
    registrationAttempted = false;
  };
  const rollback = async () => {
    let remoteFailure;
    try { await closeLease(); } catch (error) { remoteFailure = error; }
    if (remoteFailure) throw new AggregateError([remoteFailure], "Recovery admission rollback requires reconciliation");
    let localFailure;
    try { removeArtifact(); } catch (error) { localFailure = error; }
    if (directoryCreated) {
      try { rmdirSync(directory); } catch (error) { localFailure ??= error; }
    }
    if (localFailure) throw new AggregateError([localFailure],
      "Recovery admission rollback requires reconciliation");
  };
  try {
    registrationAttempted = true;
    const registered = await post("register", { worktree_id: worktreeId, session_id: expected.parent.sessionId,
      incarnation, ownership_token: ownershipToken, ttl_ms: RECOVERY_ADMISSION_LIFETIME_MS,
      idempotency_key: randomUUID() });
    lease = registered.data?.session;
    if (registered.response.status !== 201 || !Number.isSafeInteger(lease?.revision) || lease.revision !== 0
      || !Number.isSafeInteger(lease?.fence) || lease.fence < 1 || lease.state !== "active") {
      throw new Error("Recovery admission session registration failed");
    }
    const minted = await post("recovery-admissions/mint", { worktree_id: worktreeId,
      session_id: expected.parent.sessionId, incarnation, expected_revision: lease.revision, fence: lease.fence,
      ownership_token: ownershipToken, preflight_digest: expected.preflightDigest, head: expected.head,
      parent_pid: expected.parent.pid, parent_start: String(expected.parent.startTimeTicks),
      parent_executable: parentExecutable, parent_nonce: parentNonce, ttl_ms: RECOVERY_ADMISSION_LIFETIME_MS,
      idempotency_key: randomUUID() });
    const mintedLease = minted.data?.session;
    const record = { incarnation, admission: minted.data?.admission, consumeToken: minted.data?.consumeToken };
    if (minted.response.status !== 201 || !Number.isSafeInteger(mintedLease?.revision) || mintedLease.revision !== 1
      || mintedLease?.fence !== lease.fence || mintedLease.state !== "active"
      || record.admission?.revision !== mintedLease.revision || record.admission?.fence !== mintedLease.fence) {
      throw new Error("Recovery admission mint failed");
    }
    lease = mintedLease;
    try {
      mkdirSync(directory, { mode: 0o700 });
      directoryCreated = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    privatePreparationDirectory(directory);
    artifactBytes = Buffer.from(canonicalJson(record));
    writePreparationFile(requested, artifactBytes, (identity) => { artifactIdentity = identity; });
    readRecoveryAdmission(requested, preflight, preflightDigest, options.now ?? Date.now());
    return Object.freeze({ status: "created", pathSha256: sha256(requested), admissionSha256: sha256(artifactBytes), rollback });
  } catch (error) {
    try { await rollback(); } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Recovery admission creation requires reconciliation");
    }
    throw new Error("Recovery admission creation failed");
  }
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
      admittedRecoveryContext(admission.admission, receipt, context.outboxQuarantine),
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

function admittedRecoveryContext(admission, receipt, outboxQuarantine) {
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
    outboxQuarantine: outboxQuarantine ? Object.freeze({ ...outboxQuarantine }) : null,
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
    outboxQuarantine: expected.outboxQuarantine ? Object.freeze({ ...expected.outboxQuarantine }) : null,
  });
}

function validatedAdmittedRecoveryContext(context, expected, admission) {
  if (!hasExactKeys(context, ["schemaVersion", "action", "preflightDigest", "head", "parent", "binding", "outboxQuarantine", "receipt"])
    || !Object.isFrozen(context) || !Object.isFrozen(context.parent) || !Object.isFrozen(context.binding)
    || !Object.isFrozen(context.receipt) || context.outboxQuarantine !== null && !Object.isFrozen(context.outboxQuarantine)
    || canonicalJson({
      schemaVersion: context.schemaVersion,
      action: context.action,
      preflightDigest: context.preflightDigest,
      head: context.head,
      parent: context.parent,
      binding: context.binding,
      outboxQuarantine: context.outboxQuarantine,
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

export function createPrivateRecoveryStage(root, head, parent = privateTemporaryRoot(ownerUid())) {
  if (realpathSync(root) !== root || !/^[0-9a-f]{40}$/.test(head)
    || git(root, ["rev-parse", "--show-toplevel"], "utf8").trim() !== root
    || git(root, ["rev-parse", "HEAD"], "utf8").trim() !== head
    || gitConfiguration(root).some(isExecutableGitConfiguration)
    || git(root, ["status", "--porcelain=v1", "--untracked-files=all"]).length
    || git(root, ["ls-files", "-v", "-z"], "utf8").split("\0").some((line) => line && line[0] !== "H")) {
    throw new Error("Private staging requires exact clean Git HEAD");
  }
  const owner = ownerUid();
  canonicalOwnedDirectory(parent, "Private build parent", owner);
  if ((lstatSync(parent).mode & 0o7777) !== 0o700) throw new Error("Private build parent mode is invalid");
  if (parent === root || parent.startsWith(`${root}/`)) throw new Error("Private build parent is inside the shared worktree");
  for (let path = parent; ; path = dirname(path)) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || realpathSync(path) !== path || ![0, owner].includes(stat.uid)
      || ((stat.mode & 0o022) !== 0 && !(stat.uid === 0 && (stat.mode & 0o1000)))) {
      throw new Error("Private build parent ancestry is unsafe");
    }
    if (path === dirname(path)) break;
  }
  const directory = mkdtempSync(resolve(parent, "git-stage-"));
  const workspace = resolve(directory, "workspace");
  mkdirSync(workspace, { mode: 0o700 });
  const entries = git(root, ["ls-tree", "-rz", "--full-tree", head], "utf8").split("\0").filter(Boolean).map((line) => {
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (!match || !safeHandoffPath(match[3]) || match[3].split("/").some((part) => ["node_modules", ".git"].includes(part))) {
      throw new Error("Git archive contains an unsupported entry");
    }
    return { mode: match[1] === "100755" ? 0o700 : 0o600, oid: match[2], path: match[3] };
  });
  const archive = execFileSync(GIT, ["-C", root, "-c", "tar.umask=0077", "archive", "--format=tar", head], {
    env: gitEnvironment(), timeout: 30_000, maxBuffer: 256 * 1024 * 1024,
  });
  const archivePath = resolve(directory, "source.tar");
  writeFileSync(archivePath, archive, { flag: "wx", mode: 0o400 });
  const archiveFd = openSync(archivePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(archiveFd); } finally { closeSync(archiveFd); }
  execFileSync("/usr/bin/tar", ["--extract", "--no-same-owner", "--no-same-permissions", "--file", archivePath, "--directory", workspace], {
    env: { PATH: "/usr/bin:/bin" }, timeout: 30_000,
  });
  const files = {};
  for (const entry of entries) {
    const path = resolve(workspace, entry.path);
    const bytes = readTrustedRegularFile(path, "Archived source", { expectedOwner: owner }).bytes;
    const oid = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    // Shared checkout bytes are compared as data; only the blob-verified private archive is built.
    const original = readTrustedRegularFile(resolve(root, entry.path), "Canonical source input", { expectedOwner: owner, allowWritableData: true });
    if (oid !== entry.oid || !bytes.equals(original.bytes)) throw new Error("Git archive/source hash mismatch");
    files[entry.path] = { sha256: sha256(bytes), mode: entry.mode };
  }
  const inspect = (path, prefix = "") => {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.uid !== owner || realpathSync(path) !== path || (stat.mode & 0o7777) !== 0o700) {
      throw new Error("Git archive directory is not private");
    }
    for (const name of readdirSync(path)) {
      const child = resolve(path, name);
      const key = prefix + name;
      if (lstatSync(child).isDirectory()) inspect(child, `${key}/`);
      else {
        if (!files[key]) throw new Error("Git archive has an unexpected entry");
        const value = readTrustedRegularFile(child, "Archived source", { expectedMode: files[key].mode });
        if (value.sha256 !== files[key].sha256) throw new Error("Git archive changed");
        const fd = openSync(child, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { fsyncSync(fd); } finally { closeSync(fd); }
      }
    }
    const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  };
  inspect(workspace);
  if (git(root, ["rev-parse", "HEAD"], "utf8").trim() !== head) throw new Error("Git HEAD changed during staging");
  // A shallow, private object database lets checkpoint tests inspect HEAD without attaching to shared Git state.
  const objects = [head, git(root, ["rev-parse", `${head}^{tree}`], "utf8").trim(),
    ...git(root, ["ls-tree", "-rtz", head], "utf8").split("\0").filter(Boolean).map((line) => line.split("\t")[0].split(" ")[2])];
  const pack = execFileSync(GIT, ["-C", root, "pack-objects", "--stdout"], {
    input: [...new Set(objects)].join("\n") + "\n", env: gitEnvironment(), timeout: 30_000, maxBuffer: 256 * 1024 * 1024,
  });
  const mask = process.umask(0o077);
  try {
    git(workspace, ["init", "--quiet", "--template="]);
    execFileSync(GIT, ["-C", workspace, "unpack-objects", "-q"], { input: pack, env: gitEnvironment(), timeout: 30_000 });
    writeFileSync(resolve(workspace, ".git/shallow"), `${head}\n`, { flag: "wx", mode: 0o600 });
    git(workspace, ["update-ref", "HEAD", head]);
    git(workspace, ["read-tree", head]);
  } finally { process.umask(mask); }
  const nodePath = realpathSync(process.execPath);
  if (![0, owner].includes(lstatSync(nodePath).uid)) throw new Error("Stage Node runtime owner is not trusted");
  const node = readTrustedRegularFile(nodePath, "Stage Node runtime", { executable: true, expectedOwner: lstatSync(nodePath).uid });
  const manifest = { schemaVersion: 1, repositoryRoot: root, head, archiveSha256: sha256(archive),
    node: { path: node.path, sha256: node.sha256 }, files };
  const manifestPath = resolve(directory, "stage.json");
  writeFileSync(manifestPath, canonicalJson(manifest) + "\n", { flag: "wx", mode: 0o400 });
  for (const path of [manifestPath, directory, parent]) {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
  return { directory, workspace, manifestPath, manifest, manifestSha256: sha256(readFileSync(manifestPath)) };
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
  const repoRoot = declaredWorktree;
  const stage = createPrivateRecoveryStage(repoRoot, context.head);
  const packageRoot = resolve(stage.workspace, "packages/ingenium-extension");

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
  const record = (status) => {
    const path = resolve(stage.directory, "execution.json");
    const temporary = `${path}.tmp`;
    const fd = openSync(temporary, "wx", 0o600);
    try { writeFileSync(fd, canonicalJson({ status, head: context.head, stageSha256: stage.manifestSha256 }) + "\n"); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temporary, path);
    const parent = openSync(stage.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(parent); } finally { closeSync(parent); }
  };
  try {
    const recoveryEnvironment = {
      ...selectedEnvironment(recoveryEnvironmentForBinding(context.binding), RECOVERY_ENVIRONMENT),
      [CANONICAL_WORKTREE]: repoRoot,
      INGENIUM_WORKTREE: repoRoot,
      [ADMITTED_RECOVERY_CONTEXT]: canonicalJson(context),
      INGENIUM_RECOVERY_STAGE_DIRECTORY: stage.directory,
      INGENIUM_RECOVERY_STAGE_SHA256: stage.manifestSha256,
    };
    const buildEnvironment = childEnvironment(BUILD_ENVIRONMENT, runtime, {
      HOME: stage.directory,
      NPM_CONFIG_GLOBALCONFIG: npmConfiguration.globalConfig,
      NPM_CONFIG_SCRIPT_SHELL: "/bin/sh",
      NPM_CONFIG_USERCONFIG: npmConfiguration.userConfig,
      NPM_CONFIG_CACHE: resolve(stage.directory, "npm-cache"),
    });
    record("installing");
    const installed = await runFixed(runtime, [npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--include=dev"],
      BUILD_TIMEOUT_MS, buildEnvironment, stage.workspace);
    if (!propagate(installed, "Private recovery dependency preparation")) { record(installed.timedOut ? "unknown" : "failed"); return; }
    record("building");
    const build = await runFixed(
      runtime,
      [npm, "run", "build", "--workspace=packages/ingenium-extension"],
      BUILD_TIMEOUT_MS,
      buildEnvironment,
      stage.workspace,
    );
    if (!propagate(build, "Extension recovery bootstrap build")) { record(build.timedOut ? "unknown" : "failed"); return; }
    if (git(repoRoot, ["rev-parse", "HEAD"], "utf8").trim() !== context.head) throw new Error("Recovery source HEAD changed");

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
    if (generated.path !== resolve(stage.workspace, "packages/ingenium-extension/dist/scripts/recovery-bootstrap.js")) {
      throw new Error("Generated recovery bootstrap path is invalid");
    }
      const generatedModule = await import(`${pathToFileURL(generated.path).href}?inspect=1`);
      generatedModule.verifyRecoveryBuildStage({ ...recoveryEnvironment });
      const declaredRuntimeMs = generatedModule.RECOVERY_BOOTSTRAP_MAX_RUNTIME_MS;
      if (!Number.isSafeInteger(declaredRuntimeMs) || declaredRuntimeMs < 1
        || declaredRuntimeMs > MAX_TIMER_MS - GENERATED_TIMEOUT_GRACE_MS) {
        throw new Error("Generated recovery bootstrap timeout declaration is invalid");
      }
      record("running");
      const generatedResult = await runFixed(
        runtime,
        [generated.path],
        declaredRuntimeMs + GENERATED_TIMEOUT_GRACE_MS,
        childEnvironment(RECOVERY_ENVIRONMENT, runtime, {
          ...recoveryEnvironment,
          HOME: stage.directory,
          [GENERATED_BOOTSTRAP_SHA256]: generated.sha256,
        }),
        stage.workspace,
      );
      propagate(generatedResult, "Generated recovery bootstrap");
      record(generatedResult.timedOut || generatedResult.signal ? "unknown" : generatedResult.status === 0 ? "complete" : "failed");
  } catch (error) {
    record("unknown");
    throw error;
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
    let minted;
    if (admissionPath && !exists(admissionPath) && preflight.admissible && preflight.currentParent?.session) {
      minted = await (dependencies.mintAdmissionArtifact ?? mintRecoveryAdmissionArtifact)(preflight, digest, admissionPath);
    }
    if (!admissionPath || !exists(admissionPath)) {
      (dependencies.writeOutput ?? ((value) => process.stdout.write(value)))(`${output}\n`);
      return preflight.admissible ? 0 : 1;
    }
    try {
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
      (dependencies.postConsumeCheck ?? recheckHeadAndParent)(context, sourceHandle);
      try {
        (dependencies.discardAdmission ?? unlinkSync)(admissionPath);
      } finally {
        admission = undefined;
      }
      minted = undefined;
      await (dependencies.executeAdmitted ?? runAdmittedRecoveryBootstrapShim)(argv, context, sourceHandle.source);
      return process.exitCode ?? 0;
    } catch (error) {
      if (minted) await minted.rollback();
      throw error;
    }
  } finally {
    sourceHandle.close();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : undefined;
if (PREFLIGHT_REQUESTED !== undefined) {
  if (!MODULE_ATTESTATION || invokedPath !== undefined || PREFLIGHT_REQUESTED !== "1" || PREPARATION_REQUESTED !== undefined) {
    throw new Error("Recovery preflight invocation is invalid");
  }
  try {
    console.log(canonicalJson(await runRecoveryPreflight([process.execPath, MODULE_ATTESTATION.sourcePath])));
  } catch {
    console.error(canonicalJson(recoveryPreflightFailureOutput()));
    process.exitCode = 1;
  }
} else if (MODULE_ATTESTATION && PREPARATION_REQUESTED !== undefined) {
  if (PREPARATION_REQUESTED !== "1") throw new Error("Recovery preparation invocation is invalid");
  try {
    console.log(canonicalJson(await runRecoveryPreparation([process.execPath, MODULE_ATTESTATION.sourcePath])));
  } catch (error) {
    console.error(canonicalJson(recoveryPreparationFailureOutput(error)));
    process.exitCode = 1;
  }
} else if (invokedPath === import.meta.url && process.argv[2] === PREPARATION_OWNER_ARGUMENT) {
  await runPreparedRecoveryOwner();
} else if (MODULE_ATTESTATION || invokedPath === import.meta.url) {
  process.exitCode = await runRecoveryBootstrapShim(MODULE_ATTESTATION ? [process.execPath, MODULE_ATTESTATION.sourcePath] : process.argv);
}
