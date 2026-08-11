import Database from "better-sqlite3";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  constants as fsConstants,
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
  fchownSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { checkpointAfterWrite, execTransaction, getDb, resolveCoreDbPath } from "../db.js";
import { BackupRecord } from "../schema.js";
import { getGlobalProject } from "./projects.js";

export const BACKUP_BUNDLE_FORMAT = 2;
export const BACKUP_RESTORE_SCHEMA_VERSION = 85;
export const BACKUP_SIGNING_KEY_DEFAULT_FILE = "/app/.ingenium/backup-signing-key";
export const BACKUP_RESTORE_STAGING_DEFAULT_DIR = "/app/.ingenium/restore-staging";
const BACKUP_TYPES = new Set(["manual", "scheduled_hourly", "scheduled_daily", "pre_restore"]);
const BUNDLE_COMPONENTS = ["manifest.json", "ingenium.db", "opencode.db"] as const;
const RESTORE_AUTHORIZATION_TTL_MS = 10 * 60 * 1_000;
const RESTORE_EXECUTION_AUTHORIZATION_TTL_MS = 15 * 60 * 1_000;
const RESTORE_EXECUTION_DEADLINE_MS = 15 * 60 * 1_000;
const MAX_KEY_BYTES = 4_096;
const MAX_MANIFEST_BYTES = 64 * 1_024;
const DEFAULT_BACKUP_DOWNLOAD_MAX_BYTES = 256 * 1024 * 1024;
const DEFAULT_RESTORE_HANDOFF_MAX_BYTES = 256 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TRUSTED_ARTIFACT_UID_ENV = "INGENIUM_TRUSTED_ARTIFACT_UID";
const TRUSTED_ARTIFACT_GID_ENV = "INGENIUM_TRUSTED_ARTIFACT_GID";

export type BackupErrorCode =
  | "BACKUP_NOT_FOUND"
  | "BACKUP_INVALID"
  | "BACKUP_LEGACY_UNSUPPORTED"
  | "BACKUP_REFERENCED"
  | "RESTORE_PLAN_NOT_FOUND"
  | "RESTORE_REVISION_CONFLICT"
  | "RESTORE_STATE_CONFLICT"
  | "RESTORE_AUTHORIZATION_INVALID"
  | "RESTORE_AUTHORIZATION_EXPIRED"
  | "RESTORE_IDEMPOTENCY_CONFLICT"
  | "RESTORE_EXECUTION_AUTHORIZATION_INVALID"
  | "RESTORE_EXECUTION_AUTHORIZATION_EXPIRED"
  | "RESTORE_EXECUTION_NOT_FOUND"
  | "RESTORE_EXECUTION_DEADLINE_EXCEEDED"
  | "RESTORE_EXECUTION_CONFLICT"
  | "RESTORE_MIGRATION_REQUIRED"
  | "RESTORE_PROJECT_SCOPE";

export class BackupError extends Error {
  constructor(
    public readonly code: BackupErrorCode,
    public readonly currentRevision?: number,
  ) {
    super(code);
    this.name = "BackupError";
  }
}

type BackupComponent = {
  filename: "ingenium.db" | "opencode.db";
  sha256: string;
  size_bytes: number;
};

type DatabaseCompatibility = {
  schema_fingerprint: string;
  required_tables: string[];
  user_version: number;
};

type BackupManifestUnsigned = {
  format: 2;
  backup_id: string;
  created_at: string;
  components: { ingenium: BackupComponent; opencode: BackupComponent };
  schema_compatibility: { restore_min_migration: 83 | 84 | 85 };
  compatibility: { ingenium: DatabaseCompatibility; opencode: DatabaseCompatibility };
  key_id: string;
};

type BackupManifest = BackupManifestUnsigned & { signature: string };

type FileIdentity = { dev: number; ino: number; size: number };
type OpenedFile = { fd: number; identity: FileIdentity };
export type ArtifactPolicy = { ownerUid: number; ownerGid: number };

type VerifiedBundle = {
  manifest: BackupManifest;
  manifestHash: string;
  totalSize: number;
};

type BackupDeletionReservation = {
  state: "reserved" | "deleting";
  attempt_count: number;
};

type StoredRestorePlan = {
  id: string;
  project_id: string;
  backup_id: string;
  dry_run: number;
  manifest_hash: string;
  plan_hash: string;
  components_json: string;
  blockers_json: string;
  warnings_json: string;
  created_at: string;
};

/** A plan loaded from the immutable restore-plan store, never caller-supplied data. */
export type TrustedRestorePlan = Pick<StoredRestorePlan,
  "id" | "project_id" | "backup_id" | "manifest_hash" | "plan_hash" | "components_json">;

type StoredPlanRevision = {
  project_id: string;
  plan_id: string;
  backup_id: string;
  revision: number;
  from_state: RestorePlanState | null;
  to_state: RestorePlanState;
  stage_hash: string | null;
  created_at: string;
};

type StoredExecutorPlanRevision = {
  project_id: string;
  plan_id: string;
  backup_id: string;
  revision: number;
  from_state: RestorePlanState;
  to_state: RestorePlanState;
  execution_run_id: string | null;
  stage_hash: string;
  created_at: string;
};

type StoredExecutionAuthorization = {
  id: string;
  project_id: string;
  plan_id: string;
  backup_id: string;
  plan_revision: number;
  manifest_hash: string;
  plan_hash: string;
  stage_hash: string;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

type RestoreExecutionState = Exclude<RestorePlanState, "previewed" | "authorized" | "confirmed" | "ready_for_executor" | "execution_authorized" | "failed" | "cancelled" | "executing">;

type StoredExecutionRun = {
  id: string;
  project_id: string;
  plan_id: string;
  backup_id: string;
  authorization_id: string;
  plan_revision: number;
  manifest_hash: string;
  plan_hash: string;
  stage_hash: string;
  state: RestoreExecutionState;
  phase: RestoreExecutionState;
  revision: number;
  owner_hash: string | null;
  fence_hash: string | null;
  deadline_at: string;
  safety_backup_id: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type StoredExecutionItem = {
  id: string;
  project_id: string;
  run_id: string;
  component: "ingenium" | "opencode";
  expected_sha256: string;
  size_bytes: number;
  pre_hash: string | null;
  post_hash: string | null;
  created_at: string;
};

export const RESTORE_EXECUTION_PHASE_CODES = [
  "claim", "artifact", "parent-lock", "holder-scan", "safety",
  "install_ingenium", "install_opencode", "capsule", "verify", "restart",
  "rollback_prepare", "rollback_ingenium", "rollback_opencode", "rollback_complete",
] as const;
export type RestoreExecutionPhaseCode = typeof RESTORE_EXECUTION_PHASE_CODES[number];
export type RestoreExecutionPhaseStatus = "entered" | "failed" | "completed";
type StoredExecutionPhaseEvent = {
  id: string;
  project_id: string;
  plan_id: string;
  backup_id: string;
  run_id: string;
  phase_code: RestoreExecutionPhaseCode;
  status: RestoreExecutionPhaseStatus;
  error_code: string | null;
  created_at: string;
};
export type RestoreExecutionPhaseEvent = {
  id: string;
  runId: string;
  phase: RestoreExecutionPhaseCode;
  status: RestoreExecutionPhaseStatus;
  errorCode: string | null;
  createdAt: string;
};

export type RestoreExecutionRun = {
  id: string;
  planId: string;
  backupId: string;
  state: RestoreExecutionState;
  phase: RestoreExecutionState;
  revision: number;
  deadlineAt: string;
  safetyBackupId: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type RestoreStage = {
  project_id: string;
  plan_id: string;
  backup_id: string;
  manifest_hash: string;
  plan_hash: string;
  ingenium_sha256: string;
  ingenium_size_bytes: number;
  opencode_sha256: string;
  opencode_size_bytes: number;
  stage_hash: string;
  created_at: string;
};

type RestorePlanState =
  | "previewed"
  | "authorized"
  | "confirmed"
  | "ready_for_executor"
  | "execution_authorized"
  | "queued"
  | "executor_start_failed"
  | "executor_setup_failed"
  | "executor_claimed"
  | "quiescing"
  | "snapshotting"
  | "swapping"
  | "verifying"
  | "restarting"
  | "executing"
  | "completed"
  | "rolling_back"
  | "rolled_back"
  | "rollback_failed"
  | "failed"
  | "cancelled";

type StoredReceipt = {
  operation: "preview_restore" | "confirm_restore";
  request_hash: string;
  result_json: string;
};

type StoredAuthorization = {
  id: string;
  project_id: string;
  plan_id: string;
  backup_id: string;
  operation: "confirm_restore";
  plan_revision: number;
  manifest_hash: string;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

export type RestorePlan = {
  id: string;
  backupId: string;
  state: RestorePlanState;
  revision: number;
  dryRun: true;
  manifestHash: string;
  planHash: string;
  blockers: string[];
  warnings: string[];
  createdAt: string;
  updatedAt: string;
  execution?: {
    state: RestoreExecutionState;
    phase: RestoreExecutionState;
    errorCode: string | null;
    phaseEvents: RestoreExecutionPhaseEvent[];
  };
};

export type RestoreAuditEvent = {
  id: string;
  planId: string;
  backupId: string;
  eventType: "previewed" | "authorized" | "confirmed" | "ready_for_executor" | "stage_integrity_failed"
    | "EXECUTION_AUTHORIZED" | "EXECUTION_QUEUED" | "EXECUTOR_CLAIMED" | "QUIESCING" | "SNAPSHOTTING"
    | "EXECUTOR_START_FAILED" | "EXECUTOR_SETUP_FAILED" | "SWAPPING" | "VERIFYING" | "RESTARTING" | "COMPLETED" | "ROLLING_BACK" | "ROLLED_BACK" | "ROLLBACK_FAILED";
  fromState: string | null;
  toState: RestorePlanState;
  revision: number;
  manifestHash: string;
  planHash: string;
  createdAt: string;
};

/** In-process-only buffer handoff for a freshly validated staged restore. */
export type ValidatedReadyRestoreStage = {
  planId: string;
  backupId: string;
  manifestHash: string;
  planHash: string;
  stageHash: string;
  ingenium: { bytes: Buffer; size: number; sha256: string };
  opencode: { bytes: Buffer; size: number; sha256: string };
  release: () => void;
};

function now(): string {
  return new Date().toISOString();
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function requestHash(value: unknown): string {
  return sha256(canonicalJson(value));
}

/** Bind an opaque one-time token to the exact plan state it may confirm. */
function authorizationTokenHash(
  confirmationToken: string,
  plan: Pick<StoredRestorePlan, "project_id" | "id" | "backup_id" | "manifest_hash">,
  revision: number,
): string {
  return requestHash({
    confirmationToken,
    projectId: plan.project_id,
    planId: plan.id,
    backupId: plan.backup_id,
    manifestHash: plan.manifest_hash,
    operation: "confirm_restore",
    revision,
  });
}

function timingSafeHexEqual(left: string, right: string): boolean {
  if (!SHA256.test(left) || !SHA256.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function backupDbPath(): string {
  return resolveCoreDbPath();
}

/**
 * Artifact ownership is an image/startup policy, not the UID of whichever
 * process happens to validate a backup. This lets the root executor consume
 * appuser-created artifacts without accepting root-created substitutions.
 */
export function trustedArtifactPolicy(): ArtifactPolicy {
  const parse = (value: string | undefined): number => {
    if (!value || !/^[0-9]{1,10}$/.test(value)) throw new BackupError("BACKUP_INVALID");
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new BackupError("BACKUP_INVALID");
    return parsed;
  };
  return { ownerUid: parse(process.env[TRUSTED_ARTIFACT_UID_ENV]), ownerGid: parse(process.env[TRUSTED_ARTIFACT_GID_ENV]) };
}

/** Resolve the single absolute directory used for all snapshot components. */
export function resolveBackupDirectory(dbPath: string): string {
  const configuredDirectory = process.env.INGENIUM_BACKUPS_DIR?.trim();
  return configuredDirectory ? resolve(configuredDirectory) : resolve(dirname(dbPath), "backups");
}

/** Restore staging is deliberately a separate, owner-only tree from backup sources. */
export function resolveRestoreStagingDirectory(dbPath: string): string {
  const configuredDirectory = process.env.INGENIUM_RESTORE_STAGING_DIR?.trim();
  const directory = configuredDirectory ? resolve(configuredDirectory) : resolve(dirname(dbPath), "restore-staging");
  const backups = resolveBackupDirectory(dbPath);
  const between = relative(backups, directory);
  const reverse = relative(directory, backups);
  if (!between || !reverse || (!between.startsWith("..") && !isAbsolute(between)) || (!reverse.startsWith("..") && !isAbsolute(reverse))) {
    throw new BackupError("BACKUP_INVALID");
  }
  return directory;
}

/** The signing-key path is explicit, absolute, and independent from backups. */
export function resolveBackupSigningKeyPath(): string {
  const configured = process.env.INGENIUM_BACKUP_SIGNING_KEY_FILE?.trim();
  const keyPath = configured || BACKUP_SIGNING_KEY_DEFAULT_FILE;
  if (!isAbsolute(keyPath)) throw new BackupError("BACKUP_INVALID");
  return resolve(keyPath);
}

function identity(stat: Stats): FileIdentity {
  return { dev: Number(stat.dev), ino: Number(stat.ino), size: Number(stat.size) };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size;
}

function assertRegular(stat: Stats, maxBytes?: number, policy?: ArtifactPolicy, mode?: number): void {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
    || (maxBytes !== undefined && stat.size > maxBytes)
    || (policy && (stat.uid !== policy.ownerUid || stat.gid !== policy.ownerGid))
    || (mode !== undefined && (stat.mode & 0o777) !== mode)) {
    throw new BackupError("BACKUP_INVALID");
  }
}

function openExactRegular(path: string, maxBytes?: number, policy?: ArtifactPolicy, mode?: number): OpenedFile {
  const before = lstatSync(path);
  assertRegular(before, maxBytes, policy, mode);
  const fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    assertRegular(opened, maxBytes, policy, mode);
    const beforeIdentity = identity(before);
    const openedIdentity = identity(opened);
    if (!sameIdentity(beforeIdentity, openedIdentity)) throw new BackupError("BACKUP_INVALID");
    return { fd, identity: openedIdentity };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

/** Read the owner-only signing key without exposing it to logs, API DTOs, or manifests. */
export function loadBackupSigningKey(): Buffer {
  const policy = trustedArtifactPolicy();
  const keyPath = resolveBackupSigningKeyPath();
  const parent = lstatSync(dirname(keyPath));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new BackupError("BACKUP_INVALID");
  const opened = openExactRegular(keyPath, MAX_KEY_BYTES, policy, 0o600);
  try {
    const key = readFileSync(opened.fd);
    if (key.length < 32 || key.length > MAX_KEY_BYTES) throw new BackupError("BACKUP_INVALID");
    if (!sameIdentity(opened.identity, identity(fstatSync(opened.fd)))) throw new BackupError("BACKUP_INVALID");
    return key;
  } finally {
    closeSync(opened.fd);
  }
}

function keyId(key: Buffer): string {
  return sha256(key).slice(0, 16);
}

function signManifest(unsigned: BackupManifestUnsigned, key: Buffer): string {
  return createHmac("sha256", key).update(canonicalJson(unsigned), "utf8").digest("hex");
}

function hashFd(fd: number): string {
  const digest = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  for (;;) {
    const bytes = readSync(fd, buffer, 0, buffer.length, position);
    if (bytes === 0) break;
    digest.update(buffer.subarray(0, bytes));
    position += bytes;
  }
  return digest.digest("hex");
}

function configuredMaxBytes(environmentVariable: string, defaultMaxBytes: number): number {
  const configured = process.env[environmentVariable]?.trim();
  if (!configured) return defaultMaxBytes;
  if (!/^[1-9][0-9]{0,15}$/.test(configured)) throw new BackupError("BACKUP_INVALID");
  const maxBytes = Number(configured);
  if (!Number.isSafeInteger(maxBytes) || maxBytes > Number.MAX_SAFE_INTEGER) throw new BackupError("BACKUP_INVALID");
  return maxBytes;
}

function backupDownloadMaxBytes(): number {
  return configuredMaxBytes("INGENIUM_BACKUP_DOWNLOAD_MAX_BYTES", DEFAULT_BACKUP_DOWNLOAD_MAX_BYTES);
}

function restoreHandoffMaxBytes(): number {
  return configuredMaxBytes("INGENIUM_RESTORE_HANDOFF_MAX_BYTES", DEFAULT_RESTORE_HANDOFF_MAX_BYTES);
}

function readVerifiedBuffer(file: OpenedFile, expected: { sha256: string; sizeBytes: number }): Buffer {
  const bytes = Buffer.alloc(expected.sizeBytes);
  let position = 0;
  while (position < bytes.length) {
    const read = readSync(file.fd, bytes, position, bytes.length - position, position);
    if (read <= 0) {
      bytes.fill(0);
      throw new BackupError("BACKUP_INVALID");
    }
    position += read;
  }
  if (
    hashFd(file.fd) !== expected.sha256
    || sha256(bytes) !== expected.sha256
    || !sameIdentity(file.identity, identity(fstatSync(file.fd)))
  ) {
    bytes.fill(0);
    throw new BackupError("BACKUP_INVALID");
  }
  return bytes;
}

/** Wipe an in-memory backup download after its HTTP response has finished. */
export function wipeBackupDownloadBuffer(bytes: Buffer): void {
  bytes.fill(0);
}

function fsyncFile(path: string): void {
  const fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDirectory(path: string): void {
  const fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function applyArtifactDirectoryPolicy(path: string, policy: ArtifactPolicy, mode: number): void {
  const fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  try {
    fchownSync(fd, policy.ownerUid, policy.ownerGid);
    fchmodSync(fd, mode);
    const stat = fstatSync(fd);
    if (!stat.isDirectory() || stat.uid !== policy.ownerUid || stat.gid !== policy.ownerGid || (stat.mode & 0o777) !== mode) {
      throw new BackupError("BACKUP_INVALID");
    }
  } finally {
    closeSync(fd);
  }
}

function applyArtifactFilePolicy(path: string, policy: ArtifactPolicy, mode: number): void {
  const fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    fchownSync(fd, policy.ownerUid, policy.ownerGid);
    fchmodSync(fd, mode);
    assertRegular(fstatSync(fd), undefined, policy, mode);
  } finally {
    closeSync(fd);
  }
}

function ensureBackupRoot(directory: string, policy = trustedArtifactPolicy()): string {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const before = lstatSync(directory);
  if (!before.isDirectory() || before.isSymbolicLink() || before.uid !== policy.ownerUid || before.gid !== policy.ownerGid) throw new BackupError("BACKUP_INVALID");
  chmodSync(directory, 0o700);
  const root = lstatSync(directory);
  if (!sameIdentity(identity(before), identity(root)) || !root.isDirectory() || root.isSymbolicLink()
    || root.uid !== policy.ownerUid || root.gid !== policy.ownerGid || (root.mode & 0o777) !== 0o700) throw new BackupError("BACKUP_INVALID");
  return realpathSync(directory);
}

function exactBundlePath(root: string, backupId: string, partial = false): string {
  if (!UUID.test(backupId)) throw new BackupError("BACKUP_INVALID");
  const name = partial ? `.${backupId}.partial` : backupId;
  const path = resolve(root, name);
  if (dirname(path) !== root || basename(path) !== name) throw new BackupError("BACKUP_INVALID");
  return path;
}

function removeExactPartial(root: string, backupId: string): void {
  const partial = exactBundlePath(root, backupId, true);
  if (existsSync(partial)) rmSync(partial, { recursive: true, force: true });
}

function validateSourceDatabase(path: string): void {
  const source = lstatSync(path);
  assertRegular(source);
}

function inspectDatabaseCompatibility(database: Database.Database): DatabaseCompatibility {
  const rows = database.prepare(
    `SELECT type, name, tbl_name, sql FROM sqlite_master
     WHERE type IN ('table', 'index', 'trigger') AND name NOT LIKE 'sqlite_%'
     ORDER BY type ASC, name ASC`,
  ).all().map((row: any) => ({
    type: row.type,
    name: row.name,
    table: row.tbl_name,
    sql: typeof row.sql === "string" ? row.sql.replace(/\s+/g, " ").trim() : null,
  }));
  const requiredTables = rows.filter((row) => row.type === "table").map((row) => row.name);
  const userVersion = Number(database.pragma("user_version", { simple: true }));
  if (!Number.isSafeInteger(userVersion) || requiredTables.length === 0) throw new BackupError("BACKUP_INVALID");
  return {
    schema_fingerprint: requestHash({ userVersion, schema: rows }),
    required_tables: requiredTables,
    user_version: userVersion,
  };
}

function verifySnapshotFile(path: string): DatabaseCompatibility {
  const snapshot = new Database(path, { readonly: true, fileMustExist: true });
  try {
    if (snapshot.pragma("integrity_check", { simple: true }) !== "ok") throw new BackupError("BACKUP_INVALID");
    return inspectDatabaseCompatibility(snapshot);
  } finally {
    snapshot.close();
  }
}

function currentCompatibility(kind: "ingenium" | "opencode"): DatabaseCompatibility {
  const path = kind === "ingenium"
    ? backupDbPath()
    : process.env.OPENCODE_DB_PATH ?? process.env.INGENIUM_OPENCODE_DB_PATH;
  if (!path || !existsSync(path)) throw new BackupError("BACKUP_INVALID");
  return verifySnapshotFile(path);
}

function assertCompatibility(
  database: Database.Database,
  declared: DatabaseCompatibility,
  kind: "ingenium" | "opencode",
): void {
  assertCompatibilityMetadata(inspectDatabaseCompatibility(database), declared, kind);
}

function assertCompatibilityMetadata(
  actual: DatabaseCompatibility,
  declared: DatabaseCompatibility,
  kind: "ingenium" | "opencode",
): void {
  if (
    actual.schema_fingerprint !== declared.schema_fingerprint
    || actual.user_version !== declared.user_version
    || canonicalJson(actual.required_tables) !== canonicalJson(declared.required_tables)
  ) throw new BackupError("BACKUP_INVALID");
  const supported = currentCompatibility(kind);
  if (kind === "ingenium") {
    // RESTORE-101 may install a signed 083 snapshot while all services are
    // stopped, then migrate it to 084 before reopening it. OpenCode remains an
    // exact schema match because it is never migrated by Ingenium.
    const restore100Tables = [
      "backup_restore_plans", "backup_restore_plan_revisions", "backup_restore_authorizations",
      "backup_restore_stages", "backup_restore_events", "backup_restore_receipts",
    ];
    if (!restore100Tables.every((table) => declared.required_tables.includes(table))) {
      throw new BackupError("BACKUP_INVALID");
    }
    return;
  }
  if (
    supported.schema_fingerprint !== declared.schema_fingerprint
    || supported.user_version !== declared.user_version
    || canonicalJson(supported.required_tables) !== canonicalJson(declared.required_tables)
  ) throw new BackupError("BACKUP_INVALID");
}

function manifestComponent(filename: "ingenium.db" | "opencode.db", path: string): BackupComponent {
  const stat = lstatSync(path);
  assertRegular(stat);
  return { filename, sha256: sha256(readFileSync(path)), size_bytes: stat.size };
}

function assertGlobalBackupProject(projectId: string): void {
  const global = getGlobalProject();
  if (!global || global.id !== projectId) throw new BackupError("RESTORE_PROJECT_SCOPE");
}

function parseV2Manifest(value: string, backupId: string, key: Buffer): BackupManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new BackupError("BACKUP_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new BackupError("BACKUP_INVALID");
  const manifest = parsed as Record<string, unknown>;
  const expectedTopLevel = ["backup_id", "compatibility", "components", "created_at", "format", "key_id", "schema_compatibility", "signature"];
  if (Object.keys(manifest).sort().join("\0") !== expectedTopLevel.sort().join("\0")) throw new BackupError("BACKUP_INVALID");
  const components = manifest.components as Record<string, unknown> | undefined;
  const compatibility = manifest.schema_compatibility as Record<string, unknown> | undefined;
  const databaseCompatibility = manifest.compatibility as Record<string, unknown> | undefined;
  if (
    manifest.format !== BACKUP_BUNDLE_FORMAT
    || manifest.backup_id !== backupId
    || typeof manifest.created_at !== "string"
    || manifest.created_at.length < 1
    || manifest.created_at.length > 64
    || !components
    || Object.keys(components).sort().join("\0") !== "ingenium\0opencode"
    || !compatibility
    || Object.keys(compatibility).join("\0") !== "restore_min_migration"
     || (compatibility.restore_min_migration !== 83 && compatibility.restore_min_migration !== BACKUP_RESTORE_SCHEMA_VERSION)
    || !databaseCompatibility
    || Object.keys(databaseCompatibility).sort().join("\0") !== "ingenium\0opencode"
    || manifest.key_id !== keyId(key)
    || typeof manifest.signature !== "string"
    || !SHA256.test(manifest.signature)
  ) throw new BackupError("BACKUP_INVALID");

  const component = (name: "ingenium" | "opencode", filename: "ingenium.db" | "opencode.db"): BackupComponent => {
    const candidate = components[name] as Record<string, unknown> | undefined;
    if (!candidate || Object.keys(candidate).sort().join("\0") !== "filename\0sha256\0size_bytes") {
      throw new BackupError("BACKUP_INVALID");
    }
    const size = candidate.size_bytes;
    if (candidate.filename !== filename || typeof candidate.sha256 !== "string" || !SHA256.test(candidate.sha256)
      || typeof size !== "number" || !Number.isSafeInteger(size) || size < 1) {
      throw new BackupError("BACKUP_INVALID");
    }
    return { filename, sha256: candidate.sha256, size_bytes: size };
  };

  const database = (name: "ingenium" | "opencode"): DatabaseCompatibility => {
    const candidate = databaseCompatibility[name] as Record<string, unknown> | undefined;
    if (!candidate || Object.keys(candidate).sort().join("\0") !== "required_tables\0schema_fingerprint\0user_version") {
      throw new BackupError("BACKUP_INVALID");
    }
    const tables = candidate.required_tables;
    if (
      typeof candidate.schema_fingerprint !== "string" || !SHA256.test(candidate.schema_fingerprint)
      || !Number.isSafeInteger(candidate.user_version) || (candidate.user_version as number) < 0
      || !Array.isArray(tables) || tables.length === 0 || !tables.every((table) => typeof table === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(table))
      || canonicalJson(tables) !== canonicalJson([...tables].sort())
    ) throw new BackupError("BACKUP_INVALID");
    return {
      schema_fingerprint: candidate.schema_fingerprint,
      required_tables: tables as string[],
      user_version: candidate.user_version as number,
    };
  };

  const unsigned: BackupManifestUnsigned = {
    format: BACKUP_BUNDLE_FORMAT,
    backup_id: backupId,
    created_at: manifest.created_at,
    components: { ingenium: component("ingenium", "ingenium.db"), opencode: component("opencode", "opencode.db") },
      schema_compatibility: { restore_min_migration: compatibility.restore_min_migration as 83 | 84 | 85 },
    compatibility: { ingenium: database("ingenium"), opencode: database("opencode") },
    key_id: manifest.key_id,
  };
  const canonical = canonicalJson({ ...unsigned, signature: manifest.signature });
  if (canonical !== value) throw new BackupError("BACKUP_INVALID");
  if (!timingSafeHexEqual(signManifest(unsigned, key), manifest.signature)) throw new BackupError("BACKUP_INVALID");
  return { ...unsigned, signature: manifest.signature };
}

function openBundleComponent(
  root: string,
  bundlePath: string,
  filename: typeof BUNDLE_COMPONENTS[number],
  maxBytes?: number,
  fileMode = 0o600,
  directoryMode = 0o700,
): OpenedFile {
  const policy = trustedArtifactPolicy();
  const rootIdentity = lstatSync(root);
  if (!rootIdentity.isDirectory() || rootIdentity.isSymbolicLink() || rootIdentity.uid !== policy.ownerUid || rootIdentity.gid !== policy.ownerGid
    || (rootIdentity.mode & 0o777) !== 0o700) throw new BackupError("BACKUP_INVALID");
  const rootReal = realpathSync(root);
  const bundle = lstatSync(bundlePath);
  if (!bundle.isDirectory() || bundle.isSymbolicLink() || bundle.uid !== policy.ownerUid || bundle.gid !== policy.ownerGid || (bundle.mode & 0o777) !== directoryMode
    || realpathSync(bundlePath) !== bundlePath) throw new BackupError("BACKUP_INVALID");
  if (dirname(bundlePath) !== rootReal) throw new BackupError("BACKUP_INVALID");
  const path = resolve(bundlePath, filename);
  if (dirname(path) !== bundlePath || basename(path) !== filename) throw new BackupError("BACKUP_INVALID");
  return openExactRegular(path, maxBytes, policy, fileMode);
}

function assertOpenedIdentity(file: OpenedFile): void {
  if (!sameIdentity(file.identity, identity(fstatSync(file.fd)))) throw new BackupError("BACKUP_INVALID");
}

function validateDescriptorDatabase(
  fd: number,
  compatibility: DatabaseCompatibility,
  kind: "ingenium" | "opencode",
): void {
  const snapshot = new Database(`/proc/self/fd/${fd}`, { readonly: true, fileMustExist: true });
  try {
    snapshot.pragma("query_only = ON");
    if (snapshot.pragma("integrity_check", { simple: true }) !== "ok") throw new BackupError("BACKUP_INVALID");
    assertCompatibility(snapshot, compatibility, kind);
  } finally {
    snapshot.close();
  }
}

function isV2Record(record: BackupRecord): boolean {
  try {
    const parsed = JSON.parse(record.components) as { format?: unknown };
    return parsed?.format === BACKUP_BUNDLE_FORMAT && record.filename === record.id;
  } catch {
    return false;
  }
}

function getBackupDeletionReservation(
  db: Database.Database,
  projectId: string,
  backupId: string,
): BackupDeletionReservation | null {
  const reservation = db.prepare(
    `SELECT state, attempt_count
     FROM backup_deletion_reservations
     WHERE project_id = ? AND backup_id = ?`,
  ).get(projectId, backupId) as BackupDeletionReservation | undefined;
  return reservation ?? null;
}

function assertBackupDeletionIsNotReserved(
  db: Database.Database,
  projectId: string,
  backupId: string,
): void {
  if (getBackupDeletionReservation(db, projectId, backupId)) {
    throw new BackupError("BACKUP_REFERENCED");
  }
}

function hasRestorePlanReference(db: Database.Database, projectId: string, backupId: string): boolean {
  return (db.prepare(
    "SELECT count(*) AS count FROM backup_restore_plans WHERE project_id = ? AND backup_id = ?",
  ).get(projectId, backupId) as { count: number }).count > 0;
}

function reserveBackupDeletion(projectId: string, backupId: string): { exists: boolean; created: boolean } {
  return execTransaction(() => {
    const db = getDb(backupDbPath());
    const record = db.prepare(
      "SELECT * FROM backup_records WHERE project_id = ? AND id = ?",
    ).get(projectId, backupId) as BackupRecord | undefined;
    if (!record) return { exists: false, created: false };
    if (!isV2Record(record)) throw new BackupError("BACKUP_LEGACY_UNSUPPORTED");
    if (hasRestorePlanReference(db, projectId, backupId)) throw new BackupError("BACKUP_REFERENCED");
    if (getBackupDeletionReservation(db, projectId, backupId)) return { exists: true, created: false };

    const timestamp = now();
    db.prepare(
      `INSERT INTO backup_deletion_reservations
       (project_id, backup_id, state, attempt_count, created_at, updated_at)
       VALUES (?, ?, 'reserved', 0, ?, ?)`,
    ).run(projectId, backupId, timestamp, timestamp);
    return { exists: true, created: true };
  });
}

function beginBackupDeletionAttempt(projectId: string, backupId: string): boolean {
  return execTransaction(() => {
    const db = getDb(backupDbPath());
    const record = db.prepare(
      "SELECT * FROM backup_records WHERE project_id = ? AND id = ?",
    ).get(projectId, backupId) as BackupRecord | undefined;
    if (!record) return false;
    if (!isV2Record(record)) throw new BackupError("BACKUP_LEGACY_UNSUPPORTED");
    if (hasRestorePlanReference(db, projectId, backupId)) throw new BackupError("BACKUP_REFERENCED");
    if (!getBackupDeletionReservation(db, projectId, backupId)) throw new BackupError("BACKUP_INVALID");

    const attempt = db.prepare(
      `UPDATE backup_deletion_reservations
       SET state = 'deleting', attempt_count = attempt_count + 1, updated_at = ?
       WHERE project_id = ? AND backup_id = ? AND state IN ('reserved', 'deleting')`,
    ).run(now(), projectId, backupId);
    if (attempt.changes !== 1) throw new BackupError("BACKUP_INVALID");
    return true;
  });
}

function removeReservedBackupBundle(backupId: string): void {
  const policy = trustedArtifactPolicy();
  const root = ensureBackupRoot(resolveBackupDirectory(backupDbPath()), policy);
  const bundle = exactBundlePath(root, backupId);
  let bundleStat: Stats | undefined;
  try {
    bundleStat = lstatSync(bundle);
  } catch (error) {
    if (!error || typeof error !== "object" || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!bundleStat) return;
  if (
    !bundleStat.isDirectory()
    || bundleStat.isSymbolicLink()
    || bundleStat.uid !== policy.ownerUid
    || bundleStat.gid !== policy.ownerGid
    || (bundleStat.mode & 0o777) !== 0o700
    || realpathSync(bundle) !== bundle
  ) throw new BackupError("BACKUP_INVALID");
  rmSync(bundle, { recursive: true, force: true });
}

function finalizeBackupDeletion(projectId: string, backupId: string): boolean {
  return execTransaction(() => {
    const db = getDb(backupDbPath());
    const record = db.prepare(
      "SELECT * FROM backup_records WHERE project_id = ? AND id = ?",
    ).get(projectId, backupId) as BackupRecord | undefined;
    if (!record) return false;
    if (!isV2Record(record)) throw new BackupError("BACKUP_LEGACY_UNSUPPORTED");
    if (hasRestorePlanReference(db, projectId, backupId)) throw new BackupError("BACKUP_REFERENCED");
    if (!getBackupDeletionReservation(db, projectId, backupId)) throw new BackupError("BACKUP_INVALID");

    const deleted = db.prepare(
      "DELETE FROM backup_records WHERE project_id = ? AND id = ?",
    ).run(projectId, backupId);
    if (deleted.changes !== 1) throw new BackupError("BACKUP_NOT_FOUND");
    return true;
  });
}

function verifyBundle(projectId: string, backupId: string): VerifiedBundle {
  const record = getBackup(projectId, backupId);
  if (!record) throw new BackupError("BACKUP_NOT_FOUND");
  assertBackupDeletionIsNotReserved(getDb(backupDbPath()), projectId, backupId);
  if (!isV2Record(record)) throw new BackupError("BACKUP_LEGACY_UNSUPPORTED");

  const root = ensureBackupRoot(resolveBackupDirectory(backupDbPath()));
  const bundlePath = exactBundlePath(root, backupId);
  const key = loadBackupSigningKey();
  const manifestFile = openBundleComponent(root, bundlePath, "manifest.json", MAX_MANIFEST_BYTES);
  let ingenium: OpenedFile | undefined;
  let opencode: OpenedFile | undefined;
  try {
    const manifestRaw = readFileSync(manifestFile.fd, "utf8");
    const manifest = parseV2Manifest(manifestRaw, backupId, key);
    const manifestHash = sha256(manifestRaw);
    if (record.sha256 !== manifestHash || record.components !== manifestRaw) throw new BackupError("BACKUP_INVALID");
    ingenium = openBundleComponent(root, bundlePath, "ingenium.db");
    opencode = openBundleComponent(root, bundlePath, "opencode.db");
    const components: Array<[OpenedFile, BackupComponent, DatabaseCompatibility, "ingenium" | "opencode"]> = [
      [ingenium, manifest.components.ingenium, manifest.compatibility.ingenium, "ingenium"],
      [opencode, manifest.components.opencode, manifest.compatibility.opencode, "opencode"],
    ];
    let totalSize = 0;
    for (const [file, component, compatibility, kind] of components) {
      if (file.identity.size !== component.size_bytes || hashFd(file.fd) !== component.sha256) {
        throw new BackupError("BACKUP_INVALID");
      }
      validateDescriptorDatabase(file.fd, compatibility, kind);
      totalSize += component.size_bytes;
    }
    if (record.size_bytes !== totalSize) throw new BackupError("BACKUP_INVALID");
    assertOpenedIdentity(manifestFile);
    assertOpenedIdentity(ingenium);
    assertOpenedIdentity(opencode);
    return { manifest, manifestHash, totalSize };
  } finally {
    closeSync(manifestFile.fd);
    if (ingenium) closeSync(ingenium.fd);
    if (opencode) closeSync(opencode.fd);
  }
}

/** Create a signed v2 bundle, publish it atomically, then insert its inventory row. */
export async function createSnapshot(
  projectId: string,
  backupType: string,
  dbPath: string,
  opencodeDbPath: string,
  artifactPolicy = trustedArtifactPolicy(),
): Promise<{ backupId: string; filename: string; sizeBytes: number; sha256: string }> {
  assertGlobalBackupProject(projectId);
  if (!BACKUP_TYPES.has(backupType)) throw new Error(`Unsupported backup type: ${backupType}`);
  if (!existsSync(opencodeDbPath)) throw new Error("OpenCode database does not exist");
  validateSourceDatabase(opencodeDbPath);

  const backupId = randomUUID();
  const root = ensureBackupRoot(resolveBackupDirectory(dbPath), artifactPolicy);
  const partial = exactBundlePath(root, backupId, true);
  const published = exactBundlePath(root, backupId);
  const key = loadBackupSigningKey();
  mkdirSync(partial, { mode: 0o700 });
  applyArtifactDirectoryPolicy(partial, artifactPolicy, 0o700);
  try {
    const ingeniumPath = resolve(partial, "ingenium.db");
    const opencodePath = resolve(partial, "opencode.db");
    await getDb(dbPath).backup(ingeniumPath);
    const opencode = new Database(opencodeDbPath, { readonly: true, fileMustExist: true });
    try {
      await opencode.backup(opencodePath);
    } finally {
      opencode.close();
    }
    applyArtifactFilePolicy(ingeniumPath, artifactPolicy, 0o600);
    applyArtifactFilePolicy(opencodePath, artifactPolicy, 0o600);
    const ingeniumCompatibility = verifySnapshotFile(ingeniumPath);
    const opencodeCompatibility = verifySnapshotFile(opencodePath);
    const createdAt = now();
    const unsigned: BackupManifestUnsigned = {
      format: BACKUP_BUNDLE_FORMAT,
      backup_id: backupId,
      created_at: createdAt,
      components: {
        ingenium: manifestComponent("ingenium.db", ingeniumPath),
        opencode: manifestComponent("opencode.db", opencodePath),
      },
      schema_compatibility: { restore_min_migration: BACKUP_RESTORE_SCHEMA_VERSION },
      compatibility: { ingenium: ingeniumCompatibility, opencode: opencodeCompatibility },
      key_id: keyId(key),
    };
    const manifest: BackupManifest = { ...unsigned, signature: signManifest(unsigned, key) };
    const manifestRaw = canonicalJson(manifest);
    const manifestPath = resolve(partial, "manifest.json");
    writeFileSync(manifestPath, manifestRaw, { encoding: "utf8", mode: 0o600, flag: "wx" });
    applyArtifactFilePolicy(manifestPath, artifactPolicy, 0o600);
    fsyncFile(ingeniumPath);
    fsyncFile(opencodePath);
    fsyncFile(manifestPath);
    fsyncDirectory(partial);
    if (existsSync(published)) throw new BackupError("BACKUP_INVALID");
    renameSync(partial, published);
    applyArtifactDirectoryPolicy(published, artifactPolicy, 0o700);
    fsyncDirectory(root);

    const manifestHash = sha256(manifestRaw);
    const sizeBytes = unsigned.components.ingenium.size_bytes + unsigned.components.opencode.size_bytes;
    execTransaction(() => {
      getDb(dbPath).prepare(
        `INSERT INTO backup_records
         (id, project_id, filename, size_bytes, sha256, backup_type, components, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')`,
      ).run(backupId, projectId, backupId, sizeBytes, manifestHash, backupType, manifestRaw);
    });
    checkpointAfterWrite();
    return { backupId, filename: backupId, sizeBytes, sha256: manifestHash };
  } catch (error) {
    removeExactPartial(root, backupId);
    if (existsSync(published)) rmSync(published, { recursive: true, force: true });
    throw error;
  }
}

/** List records in the explicit project scope. API callers pass the active global project. */
export function listBackups(projectId: string): BackupRecord[] {
  return getDb(backupDbPath()).prepare(
    "SELECT * FROM backup_records WHERE project_id = ? ORDER BY created_at DESC, id DESC",
  ).all(projectId) as BackupRecord[];
}

/** Read one record only from the exact caller-provided project scope. */
export function getBackup(projectId: string, backupId: string): BackupRecord | null {
  return getDb(backupDbPath()).prepare(
    "SELECT * FROM backup_records WHERE project_id = ? AND id = ?",
  ).get(projectId, backupId) as BackupRecord | undefined ?? null;
}

/** Return a verified, bounded component snapshot with no retained descriptor or pathname. */
export function readVerifiedBackupComponent(
  projectId: string,
  backupId: string,
  component: "ingenium" | "opencode" = "ingenium",
): { bytes: Buffer; size: number; filename: string } {
  const verified = verifyBundle(projectId, backupId);
  const root = ensureBackupRoot(resolveBackupDirectory(backupDbPath()));
  const bundle = exactBundlePath(root, backupId);
  const filename = component === "ingenium" ? "ingenium.db" : "opencode.db";
  const expected = verified.manifest.components[component];
  if (expected.size_bytes > backupDownloadMaxBytes()) throw new BackupError("BACKUP_INVALID");
  const opened = openBundleComponent(root, bundle, filename, expected.size_bytes);
  let snapshotPath: string | null = null;
  let bytes: Buffer | null = null;
  try {
    const stagingRoot = ensureRestoreStagingRoot(backupDbPath());
    snapshotPath = resolve(stagingRoot, `.download-${randomUUID()}`);
    if (dirname(snapshotPath) !== stagingRoot) throw new BackupError("BACKUP_INVALID");
    const snapshotFile = snapshotPath;
    copyVerifiedDescriptor(opened, snapshotFile, { sha256: expected.sha256, sizeBytes: expected.size_bytes });
    const snapshot = openExactRegular(snapshotFile, expected.size_bytes, trustedArtifactPolicy(), 0o400);
    try {
      bytes = readVerifiedBuffer(snapshot, { sha256: expected.sha256, sizeBytes: expected.size_bytes });
    } catch (error) {
      throw error;
    } finally {
      closeSync(snapshot.fd);
    }
    unlinkSync(snapshotFile);
    snapshotPath = null;
    return { bytes, size: bytes.length, filename };
  } catch (error) {
    if (bytes) wipeBackupDownloadBuffer(bytes);
    if (snapshotPath && existsSync(snapshotPath)) unlinkSync(snapshotPath);
    throw error;
  } finally {
    closeSync(opened.fd);
  }
}

/** Delete only an unreferenced v2 bundle. Legacy records/files are preserved. */
export function deleteBackup(projectId: string, backupId: string): void {
  const reservation = reserveBackupDeletion(projectId, backupId);
  if (!reservation.exists) return;
  if (reservation.created) checkpointAfterWrite();

  if (!beginBackupDeletionAttempt(projectId, backupId)) return;
  checkpointAfterWrite();
  removeReservedBackupBundle(backupId);

  if (finalizeBackupDeletion(projectId, backupId)) checkpointAfterWrite();
}

/** Content-free validation output used by restore preview and confirmation. */
export function validateRestorePreflight(projectId: string, backupId: string): {
  valid: boolean;
  blockers: string[];
  manifestHash: string | null;
  totalSize: number | null;
  components: { ingenium: BackupComponent; opencode: BackupComponent } | null;
} {
  try {
    const verified = verifyBundle(projectId, backupId);
    return {
      valid: true,
      blockers: [],
      manifestHash: verified.manifestHash,
      totalSize: verified.totalSize,
      components: verified.manifest.components,
    };
  } catch (error) {
    const code = error instanceof BackupError ? error.code : "BACKUP_INVALID";
    return { valid: false, blockers: [code], manifestHash: null, totalSize: null, components: null };
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function getLatestRevision(projectId: string, planId: string): StoredPlanRevision | null {
  return getDb(backupDbPath()).prepare(
    `SELECT project_id, plan_id, backup_id, revision, from_state, to_state, stage_hash, created_at
     FROM backup_restore_plan_revisions WHERE project_id = ? AND plan_id = ?
     ORDER BY revision DESC LIMIT 1`,
  ).get(projectId, planId) as StoredPlanRevision | undefined ?? null;
}

function requireLatestRevision(projectId: string, planId: string): StoredPlanRevision {
  const revision = getLatestRevision(projectId, planId);
  if (!revision) throw new BackupError("BACKUP_INVALID");
  return revision;
}

function getLatestExecutorRevision(projectId: string, planId: string): StoredExecutorPlanRevision | null {
  return getDb(backupDbPath()).prepare(
    `SELECT project_id, plan_id, backup_id, revision, from_state, to_state, execution_run_id, stage_hash, created_at
     FROM backup_restore_executor_plan_revisions WHERE project_id = ? AND plan_id = ?
     ORDER BY revision DESC LIMIT 1`,
  ).get(projectId, planId) as StoredExecutorPlanRevision | undefined ?? null;
}

function requireLatestPlanRevision(plan: StoredRestorePlan): StoredPlanRevision | StoredExecutorPlanRevision {
  return getLatestExecutorRevision(plan.project_id, plan.id) ?? requireLatestRevision(plan.project_id, plan.id);
}

function planDto(
  plan: StoredRestorePlan,
  revision: StoredPlanRevision | StoredExecutorPlanRevision = requireLatestPlanRevision(plan),
): RestorePlan {
  const execution = getExecutionRunByPlan(plan.project_id, plan.id);
  return {
    id: plan.id,
    backupId: plan.backup_id,
    state: revision.to_state,
    revision: revision.revision,
    dryRun: true,
    manifestHash: plan.manifest_hash,
    planHash: plan.plan_hash,
    blockers: parseStringArray(plan.blockers_json),
    warnings: parseStringArray(plan.warnings_json),
    createdAt: plan.created_at,
    updatedAt: revision.created_at,
    ...(execution ? {
      execution: {
        state: execution.state,
        phase: execution.phase,
        errorCode: execution.errorCode,
        phaseEvents: listRestoreExecutionPhaseEvents(plan.project_id, plan.id),
      },
    } : {}),
  };
}

function validatedPlanDto(plan: StoredRestorePlan): RestorePlan {
  const current = requireLatestPlanRevision(plan);
  if (current.to_state !== "confirmed" && current.to_state !== "ready_for_executor") return planDto(plan, current);
  try {
    const stage = validateReadyRestoreStage(plan);
    stage.release();
  } catch (error) {
    const failed = requireLatestRevision(plan.project_id, plan.id);
    if (failed.to_state === "failed") return planDto(plan, failed);
    throw error;
  }
  return planDto(plan, requireLatestPlanRevision(plan));
}

function getPlanRecord(projectId: string, planId: string): StoredRestorePlan | null {
  return getDb(backupDbPath()).prepare(
    "SELECT * FROM backup_restore_plans WHERE project_id = ? AND id = ?",
  ).get(projectId, planId) as StoredRestorePlan | undefined ?? null;
}

function requirePlan(projectId: string, planId: string): StoredRestorePlan {
  const plan = getPlanRecord(projectId, planId);
  if (!plan) throw new BackupError("RESTORE_PLAN_NOT_FOUND");
  return plan;
}

function requireIdempotencyKey(key: string): void {
  if (!IDEMPOTENCY_KEY.test(key)) throw new BackupError("BACKUP_INVALID");
}

function findReceipt(projectId: string, key: string): StoredReceipt | null {
  return getDb(backupDbPath()).prepare(
    "SELECT operation, request_hash, result_json FROM backup_restore_receipts WHERE project_id = ? AND idempotency_key = ?",
  ).get(projectId, key) as StoredReceipt | undefined ?? null;
}

function receiptReplay<T>(projectId: string, operation: StoredReceipt["operation"], key: string, hash: string): T | null {
  const receipt = findReceipt(projectId, key);
  if (!receipt) return null;
  if (receipt.operation !== operation || !timingSafeHexEqual(receipt.request_hash, hash)) {
    throw new BackupError("RESTORE_IDEMPOTENCY_CONFLICT");
  }
  try {
    return JSON.parse(receipt.result_json) as T;
  } catch {
    throw new BackupError("BACKUP_INVALID");
  }
}

function insertReceipt(
  projectId: string,
  planId: string | null,
  operation: StoredReceipt["operation"],
  key: string,
  hash: string,
  result: unknown,
): void {
  const resultJson = canonicalJson(result);
  if (Buffer.byteLength(resultJson, "utf8") > 2_048) throw new BackupError("BACKUP_INVALID");
  getDb(backupDbPath()).prepare(
    `INSERT INTO backup_restore_receipts
     (id, project_id, plan_id, operation, idempotency_key, request_hash, result_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), projectId, planId, operation, key, hash, resultJson, now());
}

function appendRevision(
  plan: StoredRestorePlan,
  prior: StoredPlanRevision | null,
  toState: RestorePlanState,
  stageHash: string | null = null,
): StoredPlanRevision {
  const revision = prior ? prior.revision + 1 : 0;
  const createdAt = now();
  getDb(backupDbPath()).prepare(
    `INSERT INTO backup_restore_plan_revisions
     (id, project_id, plan_id, backup_id, revision, from_state, to_state, stage_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), plan.project_id, plan.id, plan.backup_id, revision, prior?.to_state ?? null, toState, stageHash, createdAt);
  return {
    project_id: plan.project_id,
    plan_id: plan.id,
    backup_id: plan.backup_id,
    revision,
    from_state: prior?.to_state ?? null,
    to_state: toState,
    stage_hash: stageHash,
    created_at: createdAt,
  };
}

/** Create or replay the durable dry-run restore plan. It never writes snapshot sources. */
export function previewRestore(projectId: string, input: { backupId: string; dryRun: true; idempotencyKey: string }): RestorePlan {
  assertGlobalBackupProject(projectId);
  requireIdempotencyKey(input.idempotencyKey);
  const hash = requestHash({ backupId: input.backupId, dryRun: input.dryRun });
  const replay = receiptReplay<{ planId: string }>(projectId, "preview_restore", input.idempotencyKey, hash);
  if (replay) {
    const plan = requirePlan(projectId, replay.planId);
    assertBackupDeletionIsNotReserved(getDb(backupDbPath()), plan.project_id, plan.backup_id);
    return planDto(plan);
  }
  const record = getBackup(projectId, input.backupId);
  if (!record) throw new BackupError("BACKUP_NOT_FOUND");
  assertBackupDeletionIsNotReserved(getDb(backupDbPath()), projectId, input.backupId);
  const validation = validateRestorePreflight(projectId, input.backupId);
  const manifestHash = validation.manifestHash ?? requestHash({ backupId: input.backupId, blockers: validation.blockers });
  const components = validation.components;
  const warnings = ["Restore execution is unavailable through this API."];
  const componentBinding = components ? {
    ingenium: { sha256: components.ingenium.sha256, sizeBytes: components.ingenium.size_bytes },
    opencode: { sha256: components.opencode.sha256, sizeBytes: components.opencode.size_bytes },
  } : null;
  const planHash = requestHash({
    backupId: input.backupId,
    dryRun: true,
    manifestHash,
    components: componentBinding,
    blockers: validation.blockers,
    warnings,
  });
  const result = execTransaction(() => {
    const db = getDb(backupDbPath());
    const current = db.prepare(
      "SELECT 1 FROM backup_records WHERE project_id = ? AND id = ?",
    ).get(projectId, input.backupId);
    if (!current) throw new BackupError("BACKUP_NOT_FOUND");
    assertBackupDeletionIsNotReserved(db, projectId, input.backupId);
    const timestamp = now();
    const planId = randomUUID();
    db.prepare(
      `INSERT INTO backup_restore_plans
       (id, project_id, backup_id, dry_run, manifest_hash, plan_hash, components_json, blockers_json, warnings_json, created_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    ).run(
      planId, projectId, input.backupId, manifestHash, planHash, canonicalJson(componentBinding),
      canonicalJson(validation.blockers), canonicalJson(warnings), timestamp,
    );
    const plan = getPlanRecord(projectId, planId)!;
    const revision = appendRevision(plan, null, "previewed");
    insertReceipt(projectId, plan.id, "preview_restore", input.idempotencyKey, hash, { planId: plan.id });
    return { plan, revision };
  });
  checkpointAfterWrite();
  return planDto(result.plan, result.revision);
}

function revalidatePlanBackup(projectId: string, plan: StoredRestorePlan): void {
  const validation = validateRestorePreflight(projectId, plan.backup_id);
  if (!validation.valid || validation.manifestHash !== plan.manifest_hash) throw new BackupError("BACKUP_INVALID");
}

/** Authorize exactly one confirmation token. The raw token exists only in this return value. */
export function authorizeRestore(projectId: string, planId: string, expectedRevision: number): {
  plan: RestorePlan;
  confirmationToken: string;
  expiresAt: string;
} {
  assertGlobalBackupProject(projectId);
  const plan = requirePlan(projectId, planId);
  const revision = requireLatestRevision(projectId, planId);
  if (revision.revision !== expectedRevision) throw new BackupError("RESTORE_REVISION_CONFLICT", revision.revision);
  if (revision.to_state !== "previewed" || parseStringArray(plan.blockers_json).length > 0) {
    throw new BackupError("RESTORE_STATE_CONFLICT", revision.revision);
  }
  revalidatePlanBackup(projectId, plan);
  const confirmationToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESTORE_AUTHORIZATION_TTL_MS).toISOString();
  const transitioned = execTransaction(() => {
    const current = requirePlan(projectId, planId);
    const currentRevision = requireLatestRevision(projectId, planId);
    if (currentRevision.revision !== expectedRevision) throw new BackupError("RESTORE_REVISION_CONFLICT", currentRevision.revision);
    if (currentRevision.to_state !== "previewed") throw new BackupError("RESTORE_STATE_CONFLICT", currentRevision.revision);
    const nextRevision = currentRevision.revision + 1;
    const tokenHash = authorizationTokenHash(confirmationToken, current, nextRevision);
    getDb(backupDbPath()).prepare(
      `INSERT INTO backup_restore_authorizations
       (id, project_id, plan_id, backup_id, operation, plan_revision, manifest_hash, token_hash, expires_at, consumed_at, created_at)
       VALUES (?, ?, ?, ?, 'confirm_restore', ?, ?, ?, ?, NULL, ?)`,
    ).run(randomUUID(), projectId, planId, current.backup_id, nextRevision, current.manifest_hash, tokenHash, expiresAt, now());
    const updated = appendRevision(current, currentRevision, "authorized");
    return { plan: current, revision: updated };
  });
  checkpointAfterWrite();
  return { plan: planDto(transitioned.plan, transitioned.revision), confirmationToken, expiresAt };
}

function parsePlanComponents(plan: TrustedRestorePlan): {
  ingenium: { sha256: string; sizeBytes: number };
  opencode: { sha256: string; sizeBytes: number };
} {
  try {
    const parsed = JSON.parse(plan.components_json) as Record<string, any>;
    for (const name of ["ingenium", "opencode"] as const) {
      const component = parsed[name];
      if (!component || !SHA256.test(component.sha256) || !Number.isSafeInteger(component.sizeBytes) || component.sizeBytes < 1) {
        throw new Error("invalid components");
      }
    }
    return parsed as ReturnType<typeof parsePlanComponents>;
  } catch {
    throw new BackupError("BACKUP_INVALID");
  }
}

function planManifest(plan: TrustedRestorePlan): BackupManifest {
  const record = getBackup(plan.project_id, plan.backup_id);
  if (!record || !isV2Record(record) || record.sha256 !== plan.manifest_hash || sha256(record.components) !== plan.manifest_hash) {
    throw new BackupError("BACKUP_INVALID");
  }
  return parseV2Manifest(record.components, plan.backup_id, loadBackupSigningKey());
}

function expectedStageHash(plan: TrustedRestorePlan, components = parsePlanComponents(plan)): string {
  return requestHash({ planHash: plan.plan_hash, manifestHash: plan.manifest_hash, components });
}

function assertStageManifestBinding(
  manifest: BackupManifest,
  components: ReturnType<typeof parsePlanComponents>,
): void {
  if (
    manifest.components.ingenium.sha256 !== components.ingenium.sha256
    || manifest.components.ingenium.size_bytes !== components.ingenium.sizeBytes
    || manifest.components.opencode.sha256 !== components.opencode.sha256
    || manifest.components.opencode.size_bytes !== components.opencode.sizeBytes
  ) throw new BackupError("BACKUP_INVALID");
}

function ensureRestoreStagingRoot(dbPath: string): string {
  const policy = trustedArtifactPolicy();
  const directory = resolveRestoreStagingDirectory(dbPath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const before = lstatSync(directory);
  if (!before.isDirectory() || before.isSymbolicLink() || before.uid !== policy.ownerUid || before.gid !== policy.ownerGid) {
    throw new BackupError("BACKUP_INVALID");
  }
  chmodSync(directory, 0o700);
  const root = lstatSync(directory);
  if (!sameIdentity(identity(before), identity(root)) || !root.isDirectory() || root.isSymbolicLink()
    || root.uid !== policy.ownerUid || root.gid !== policy.ownerGid || (root.mode & 0o777) !== 0o700) {
    throw new BackupError("BACKUP_INVALID");
  }
  return realpathSync(directory);
}

function exactStagePath(root: string, planId: string, partial = false): string {
  if (!UUID.test(planId)) throw new BackupError("BACKUP_INVALID");
  const name = partial ? `.${planId}.partial` : planId;
  const path = resolve(root, name);
  if (dirname(path) !== root || basename(path) !== name) throw new BackupError("BACKUP_INVALID");
  return path;
}

function copyVerifiedDescriptor(source: OpenedFile, target: string, expected: { sha256: string; sizeBytes: number }): void {
  const destination = openSync(target, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o400);
  try {
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    for (;;) {
      const bytes = readSync(source.fd, buffer, 0, buffer.length, position);
      if (bytes === 0) break;
      digest.update(buffer.subarray(0, bytes));
      let written = 0;
      while (written < bytes) {
        const output = writeSync(destination, buffer, written, bytes - written, position + written);
        if (output <= 0) throw new BackupError("BACKUP_INVALID");
        written += output;
      }
      position += bytes;
    }
    const destinationStat = fstatSync(destination);
    if (
      position !== expected.sizeBytes || destinationStat.size !== expected.sizeBytes
      || digest.digest("hex") !== expected.sha256 || hashFd(source.fd) !== expected.sha256
      || !sameIdentity(source.identity, identity(fstatSync(source.fd))) || !destinationStat.isFile()
    ) throw new BackupError("BACKUP_INVALID");
    fsyncSync(destination);
  } finally {
    closeSync(destination);
  }
}

function validateStageComponent(
  file: OpenedFile,
  expected: { sha256: string; sizeBytes: number },
  compatibility: DatabaseCompatibility,
  kind: "ingenium" | "opencode",
): void {
  if (
    (fstatSync(file.fd).mode & 0o777) !== 0o444
    || file.identity.size !== expected.sizeBytes
    || hashFd(file.fd) !== expected.sha256
  ) throw new BackupError("BACKUP_INVALID");
  const root = ensureRestoreStagingRoot(backupDbPath());
  const validationCopy = resolve(root, `.validate-${randomUUID()}`);
  if (dirname(validationCopy) !== root) throw new BackupError("BACKUP_INVALID");
  try {
    // SQLite's integrity check needs a writable owner-only file. This copy is
    // ephemeral; the staged descriptor is rehashed again below before success.
    copyVerifiedDescriptor(file, validationCopy, expected);
    chmodSync(validationCopy, 0o600);
    assertCompatibilityMetadata(verifySnapshotFile(validationCopy), compatibility, kind);
  } finally {
    if (existsSync(validationCopy)) unlinkSync(validationCopy);
  }
  // Rehash after SQLite inspection so a same-UID write during validation is rejected.
  if (hashFd(file.fd) !== expected.sha256) throw new BackupError("BACKUP_INVALID");
  assertOpenedIdentity(file);
}

function validateExistingStage(root: string, plan: StoredRestorePlan, stageHash: string, manifest: BackupManifest): RestoreStage | null {
  const stagePath = exactStagePath(root, plan.id);
  if (!existsSync(stagePath)) return null;
  const components = parsePlanComponents(plan);
  assertStageManifestBinding(manifest, components);
  const stageDirectory = lstatSync(stagePath);
  const policy = trustedArtifactPolicy();
  if (
    !stageDirectory.isDirectory() || stageDirectory.isSymbolicLink() || realpathSync(stagePath) !== stagePath
    || stageDirectory.uid !== policy.ownerUid || stageDirectory.gid !== policy.ownerGid || (stageDirectory.mode & 0o777) !== 0o500
  ) throw new BackupError("BACKUP_INVALID");
  const ingenium = openBundleComponent(root, stagePath, "ingenium.db", components.ingenium.sizeBytes, 0o444, 0o500);
  const opencode = openBundleComponent(root, stagePath, "opencode.db", components.opencode.sizeBytes, 0o444, 0o500);
  try {
    validateStageComponent(ingenium, components.ingenium, manifest.compatibility.ingenium, "ingenium");
    validateStageComponent(opencode, components.opencode, manifest.compatibility.opencode, "opencode");
    return {
      project_id: plan.project_id,
      plan_id: plan.id,
      backup_id: plan.backup_id,
      manifest_hash: plan.manifest_hash,
      plan_hash: plan.plan_hash,
      ingenium_sha256: components.ingenium.sha256,
      ingenium_size_bytes: components.ingenium.sizeBytes,
      opencode_sha256: components.opencode.sha256,
      opencode_size_bytes: components.opencode.sizeBytes,
      stage_hash: stageHash,
      created_at: now(),
    };
  } finally {
    closeSync(ingenium.fd);
    closeSync(opencode.fd);
  }
}

function createRestoreStage(projectId: string, plan: StoredRestorePlan): { stage: RestoreStage; created: boolean } {
  const verified = verifyBundle(projectId, plan.backup_id);
  const components = parsePlanComponents(plan);
  if (
    verified.manifestHash !== plan.manifest_hash
    || verified.manifest.components.ingenium.sha256 !== components.ingenium.sha256
    || verified.manifest.components.ingenium.size_bytes !== components.ingenium.sizeBytes
    || verified.manifest.components.opencode.sha256 !== components.opencode.sha256
    || verified.manifest.components.opencode.size_bytes !== components.opencode.sizeBytes
  ) throw new BackupError("BACKUP_INVALID");
  const stageHash = expectedStageHash(plan, components);
  const root = ensureRestoreStagingRoot(backupDbPath());
  const existing = validateExistingStage(root, plan, stageHash, verified.manifest);
  if (existing) return { stage: existing, created: false };

  const partial = exactStagePath(root, plan.id, true);
  const published = exactStagePath(root, plan.id);
  mkdirSync(partial, { mode: 0o700 });
  let partialCreated = true;
  let publishedCreated = false;
  chmodSync(partial, 0o700);
  try {
    const sourceRoot = ensureBackupRoot(resolveBackupDirectory(backupDbPath()));
    const bundle = exactBundlePath(sourceRoot, plan.backup_id);
    const ingenium = openBundleComponent(sourceRoot, bundle, "ingenium.db");
    const opencode = openBundleComponent(sourceRoot, bundle, "opencode.db");
    try {
      copyVerifiedDescriptor(ingenium, resolve(partial, "ingenium.db"), components.ingenium);
      copyVerifiedDescriptor(opencode, resolve(partial, "opencode.db"), components.opencode);
    } finally {
      closeSync(ingenium.fd);
      closeSync(opencode.fd);
    }
    chmodSync(resolve(partial, "ingenium.db"), 0o444);
    chmodSync(resolve(partial, "opencode.db"), 0o444);
    fsyncFile(resolve(partial, "ingenium.db"));
    fsyncFile(resolve(partial, "opencode.db"));
    fsyncDirectory(partial);
    renameSync(partial, published);
    partialCreated = false;
    publishedCreated = true;
    chmodSync(published, 0o500);
    fsyncDirectory(root);
    const stage = validateExistingStage(root, plan, stageHash, verified.manifest);
    if (!stage) throw new BackupError("BACKUP_INVALID");
    return { stage, created: true };
  } catch (error) {
    if (partialCreated && existsSync(partial)) rmSync(partial, { recursive: true, force: true });
    if (publishedCreated && existsSync(published)) {
      chmodSync(published, 0o700);
      rmSync(published, { recursive: true, force: true });
    }
    throw error;
  }
}

function getRestoreStage(plan: TrustedRestorePlan): RestoreStage | null {
  return getDb(backupDbPath()).prepare(
    `SELECT project_id, plan_id, backup_id, manifest_hash, plan_hash, ingenium_sha256, ingenium_size_bytes,
            opencode_sha256, opencode_size_bytes, stage_hash, created_at
     FROM backup_restore_stages WHERE project_id = ? AND plan_id = ?`,
  ).get(plan.project_id, plan.id) as RestoreStage | undefined ?? null;
}

function assertPersistedStageBinding(
  plan: TrustedRestorePlan,
  stage: RestoreStage,
  components: ReturnType<typeof parsePlanComponents>,
  stageHash: string,
): void {
  if (
    stage.project_id !== plan.project_id || stage.plan_id !== plan.id || stage.backup_id !== plan.backup_id
    || stage.manifest_hash !== plan.manifest_hash || stage.plan_hash !== plan.plan_hash || stage.stage_hash !== stageHash
    || stage.ingenium_sha256 !== components.ingenium.sha256 || stage.ingenium_size_bytes !== components.ingenium.sizeBytes
    || stage.opencode_sha256 !== components.opencode.sha256 || stage.opencode_size_bytes !== components.opencode.sizeBytes
  ) throw new BackupError("BACKUP_INVALID");
}

function markStageIntegrityFailed(plan: TrustedRestorePlan): void {
  let changed = false;
  execTransaction(() => {
    const currentPlan = requirePlan(plan.project_id, plan.id);
    const current = requireLatestRevision(plan.project_id, plan.id);
    if (current.to_state === "failed") return;
    if (current.to_state !== "confirmed" && current.to_state !== "ready_for_executor") {
      throw new BackupError("RESTORE_STATE_CONFLICT", current.revision);
    }
    appendRevision(currentPlan, current, "failed", current.stage_hash);
    changed = true;
  });
  if (changed) checkpointAfterWrite();
}

/**
 * Reopen and validate a staged plan before any status success or in-process handoff.
 * RESTORE-101 must consume only these independent buffers and call release().
 */
export function validateReadyRestoreStage(plan: TrustedRestorePlan): ValidatedReadyRestoreStage {
  const stored = requirePlan(plan.project_id, plan.id);
  if (
    stored.backup_id !== plan.backup_id || stored.manifest_hash !== plan.manifest_hash
    || stored.plan_hash !== plan.plan_hash || stored.components_json !== plan.components_json
  ) throw new BackupError("BACKUP_INVALID");
  const revision = requireLatestRevision(stored.project_id, stored.id);
  if (revision.to_state !== "confirmed" && revision.to_state !== "ready_for_executor") {
    throw new BackupError("RESTORE_STATE_CONFLICT", revision.revision);
  }

  let ingenium: OpenedFile | undefined;
  let opencode: OpenedFile | undefined;
  let ingeniumBytes: Buffer | undefined;
  let opencodeBytes: Buffer | undefined;
  try {
    const manifest = planManifest(stored);
    const components = parsePlanComponents(stored);
    const stageHash = expectedStageHash(stored, components);
    const stage = getRestoreStage(stored);
    if (!stage) throw new BackupError("BACKUP_INVALID");
    assertPersistedStageBinding(stored, stage, components, stageHash);
    if (revision.to_state === "ready_for_executor" && revision.stage_hash !== stageHash) throw new BackupError("BACKUP_INVALID");
    const maxBytes = restoreHandoffMaxBytes();
    if (
      components.ingenium.sizeBytes > maxBytes || components.opencode.sizeBytes > maxBytes
      || components.ingenium.sizeBytes + components.opencode.sizeBytes > maxBytes
    ) throw new BackupError("BACKUP_INVALID");

    const root = ensureRestoreStagingRoot(backupDbPath());
    // Validate the fixed stage path first, then snapshot it through nofollow descriptors.
    if (!validateExistingStage(root, stored, stageHash, manifest)) throw new BackupError("BACKUP_INVALID");
    const stagePath = exactStagePath(root, stored.id);
    ingenium = openBundleComponent(root, stagePath, "ingenium.db", components.ingenium.sizeBytes, 0o444, 0o500);
    opencode = openBundleComponent(root, stagePath, "opencode.db", components.opencode.sizeBytes, 0o444, 0o500);
    validateStageComponent(ingenium, components.ingenium, manifest.compatibility.ingenium, "ingenium");
    validateStageComponent(opencode, components.opencode, manifest.compatibility.opencode, "opencode");
    ingeniumBytes = readVerifiedBuffer(ingenium, components.ingenium);
    opencodeBytes = readVerifiedBuffer(opencode, components.opencode);
    closeSync(ingenium.fd);
    ingenium = undefined;
    closeSync(opencode.fd);
    opencode = undefined;

    let released = false;
    return {
      planId: stored.id,
      backupId: stored.backup_id,
      manifestHash: stored.manifest_hash,
      planHash: stored.plan_hash,
      stageHash,
      ingenium: { bytes: ingeniumBytes, size: components.ingenium.sizeBytes, sha256: components.ingenium.sha256 },
      opencode: { bytes: opencodeBytes, size: components.opencode.sizeBytes, sha256: components.opencode.sha256 },
      release: () => {
        if (released) return;
        released = true;
        ingeniumBytes!.fill(0);
        opencodeBytes!.fill(0);
      },
    };
  } catch (error) {
    if (ingeniumBytes) ingeniumBytes.fill(0);
    if (opencodeBytes) opencodeBytes.fill(0);
    if (ingenium) closeSync(ingenium.fd);
    if (opencode) closeSync(opencode.fd);
    markStageIntegrityFailed(stored);
    throw new BackupError("BACKUP_INVALID");
  }
}

/** Future restore executors must use this validated in-process buffer handoff. */
export function getReadyRestoreStage(projectId: string, planId: string): ValidatedReadyRestoreStage {
  const plan = requirePlan(projectId, planId);
  const revision = requireLatestRevision(projectId, planId);
  if (revision.to_state !== "ready_for_executor") throw new BackupError("RESTORE_STATE_CONFLICT", revision.revision);
  return validateReadyRestoreStage(plan);
}

function findAuthorization(projectId: string, plan: StoredRestorePlan, revision: number): StoredAuthorization | null {
  return getDb(backupDbPath()).prepare(
    `SELECT * FROM backup_restore_authorizations
     WHERE project_id = ? AND plan_id = ? AND backup_id = ? AND operation = 'confirm_restore'
       AND plan_revision = ? AND manifest_hash = ?`,
  ).get(projectId, plan.id, plan.backup_id, revision, plan.manifest_hash) as StoredAuthorization | undefined ?? null;
}

/** Consume the exact token, stage from verified descriptors, then append ready_for_executor. */
export function confirmRestore(
  projectId: string,
  planId: string,
  input: { confirmationToken: string; expectedRevision: number; idempotencyKey: string },
): RestorePlan {
  assertGlobalBackupProject(projectId);
  requireIdempotencyKey(input.idempotencyKey);
  const tokenRequestHash = sha256(input.confirmationToken);
  const hash = requestHash({ planId, tokenRequestHash, expectedRevision: input.expectedRevision });
  const replay = receiptReplay<{ planId: string }>(projectId, "confirm_restore", input.idempotencyKey, hash);
  if (replay) return validatedPlanDto(requirePlan(projectId, replay.planId));
  const plan = requirePlan(projectId, planId);
  const initial = requireLatestRevision(projectId, planId);
  if (initial.to_state === "authorized" && initial.revision !== input.expectedRevision) {
    throw new BackupError("RESTORE_REVISION_CONFLICT", initial.revision);
  }
  if (initial.to_state !== "authorized" && initial.to_state !== "confirmed") {
    throw new BackupError("RESTORE_STATE_CONFLICT", initial.revision);
  }
  revalidatePlanBackup(projectId, plan);

  const confirmed = execTransaction(() => {
    const currentPlan = requirePlan(projectId, planId);
    const current = requireLatestRevision(projectId, planId);
    if (current.to_state !== "authorized" && current.to_state !== "confirmed") {
      throw new BackupError("RESTORE_STATE_CONFLICT", current.revision);
    }
    const authorization = findAuthorization(projectId, currentPlan, input.expectedRevision);
    const tokenHash = authorizationTokenHash(input.confirmationToken, currentPlan, input.expectedRevision);
    if (!authorization || !timingSafeHexEqual(authorization.token_hash, tokenHash)) throw new BackupError("RESTORE_AUTHORIZATION_INVALID");
    if (current.to_state === "authorized") {
      if (current.revision !== input.expectedRevision) throw new BackupError("RESTORE_REVISION_CONFLICT", current.revision);
      if (authorization.consumed_at) throw new BackupError("RESTORE_AUTHORIZATION_INVALID");
      if (Date.parse(authorization.expires_at) <= Date.now()) throw new BackupError("RESTORE_AUTHORIZATION_EXPIRED");
      const consumed = getDb(backupDbPath()).prepare(
        "UPDATE backup_restore_authorizations SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL",
      ).run(now(), authorization.id);
      if (consumed.changes !== 1) throw new BackupError("RESTORE_AUTHORIZATION_INVALID");
      return { plan: currentPlan, revision: appendRevision(currentPlan, current, "confirmed") };
    }
    if (!authorization.consumed_at) throw new BackupError("RESTORE_AUTHORIZATION_INVALID");
    return { plan: currentPlan, revision: current };
  });
  checkpointAfterWrite();

  const staged = createRestoreStage(projectId, confirmed.plan);
  try {
    const ready = execTransaction(() => {
      const currentPlan = requirePlan(projectId, planId);
      const current = requireLatestRevision(projectId, planId);
      if (current.to_state === "ready_for_executor") return { plan: currentPlan, revision: current };
      if (current.to_state !== "confirmed") throw new BackupError("RESTORE_STATE_CONFLICT", current.revision);
      const authorization = findAuthorization(projectId, currentPlan, input.expectedRevision);
      if (!authorization?.consumed_at) throw new BackupError("RESTORE_AUTHORIZATION_INVALID");
      const existing = getDb(backupDbPath()).prepare(
        "SELECT * FROM backup_restore_stages WHERE project_id = ? AND plan_id = ?",
      ).get(projectId, planId) as RestoreStage | undefined;
      if (existing) {
        if (existing.stage_hash !== staged.stage.stage_hash) throw new BackupError("BACKUP_INVALID");
      } else {
        getDb(backupDbPath()).prepare(
          `INSERT INTO backup_restore_stages
           (id, project_id, plan_id, backup_id, manifest_hash, plan_hash, ingenium_sha256, ingenium_size_bytes, opencode_sha256, opencode_size_bytes, stage_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          randomUUID(), staged.stage.project_id, staged.stage.plan_id, staged.stage.backup_id,
          staged.stage.manifest_hash, staged.stage.plan_hash, staged.stage.ingenium_sha256,
          staged.stage.ingenium_size_bytes, staged.stage.opencode_sha256, staged.stage.opencode_size_bytes,
          staged.stage.stage_hash, staged.stage.created_at,
        );
      }
      const revision = appendRevision(currentPlan, current, "ready_for_executor", staged.stage.stage_hash);
      insertReceipt(projectId, currentPlan.id, "confirm_restore", input.idempotencyKey, hash, { planId: currentPlan.id });
      return { plan: currentPlan, revision };
    });
    checkpointAfterWrite();
    return validatedPlanDto(ready.plan);
  } catch (error) {
    if (staged.created) {
      const persisted = getDb(backupDbPath()).prepare(
        "SELECT 1 FROM backup_restore_stages WHERE project_id = ? AND plan_id = ?",
      ).get(projectId, planId);
      if (!persisted) {
        const root = ensureRestoreStagingRoot(backupDbPath());
        const path = exactStagePath(root, planId);
        if (existsSync(path)) {
          chmodSync(path, 0o700);
          rmSync(path, { recursive: true, force: true });
        }
      }
    }
    throw error;
  }
}

export function getRestorePlan(projectId: string, planId: string): RestorePlan | null {
  const plan = getPlanRecord(projectId, planId);
  return plan ? validatedPlanDto(plan) : null;
}

export function listRestoreAudit(projectId: string, planId: string, limit = 50): RestoreAuditEvent[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new BackupError("BACKUP_INVALID");
  requirePlan(projectId, planId);
  const legacy = getDb(backupDbPath()).prepare(
    `SELECT id, plan_id, backup_id, event_type, from_state, to_state, revision, manifest_hash, plan_hash, created_at
     FROM backup_restore_events WHERE project_id = ? AND plan_id = ?
       ORDER BY revision DESC LIMIT ?`,
  ).all(projectId, planId, limit).map((row: any) => ({
    id: row.id,
    planId: row.plan_id,
    backupId: row.backup_id,
    eventType: row.event_type,
    fromState: row.from_state,
    toState: row.to_state,
    revision: row.revision,
    manifestHash: row.manifest_hash,
    planHash: row.plan_hash,
    createdAt: row.created_at,
  })) as RestoreAuditEvent[];
  const executor = getDb(backupDbPath()).prepare(
    `SELECT id, plan_id, backup_id, event_code, from_state, to_state, revision, manifest_hash, plan_hash, created_at
     FROM backup_restore_execution_events WHERE project_id = ? AND plan_id = ?
     ORDER BY revision DESC LIMIT ?`,
  ).all(projectId, planId, limit).map((row: any) => ({
    id: row.id,
    planId: row.plan_id,
    backupId: row.backup_id,
    eventType: row.event_code,
    fromState: row.from_state,
    toState: row.to_state,
    revision: row.revision,
    manifestHash: row.manifest_hash,
    planHash: row.plan_hash,
    createdAt: row.created_at,
  })) as RestoreAuditEvent[];
  return [...legacy, ...executor].sort((left, right) => right.revision - left.revision).slice(0, limit);
}

function executionAuthorizationTokenHash(
  executionToken: string,
  plan: StoredRestorePlan,
  revision: number,
  stageHash: string,
): string {
  return requestHash({
    executionToken,
    projectId: plan.project_id,
    planId: plan.id,
    backupId: plan.backup_id,
    manifestHash: plan.manifest_hash,
    planHash: plan.plan_hash,
    stageHash,
    operation: "execute_restore",
    revision,
  });
}

function requireExecutorToken(value: string): void {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(value)) throw new BackupError("BACKUP_INVALID");
}

function getExecutionAuthorization(projectId: string, planId: string, revision: number): StoredExecutionAuthorization | null {
  return getDb(backupDbPath()).prepare(
    `SELECT id, project_id, plan_id, backup_id, plan_revision, manifest_hash, plan_hash, stage_hash, token_hash, expires_at, consumed_at, created_at
     FROM backup_restore_execution_authorizations
     WHERE project_id = ? AND plan_id = ? AND plan_revision = ? AND operation = 'execute_restore'`,
  ).get(projectId, planId, revision) as StoredExecutionAuthorization | undefined ?? null;
}

function getExecutionRunRecord(projectId: string, runId: string): StoredExecutionRun | null {
  return getDb(backupDbPath()).prepare(
    "SELECT * FROM backup_restore_execution_runs WHERE project_id = ? AND id = ?",
  ).get(projectId, runId) as StoredExecutionRun | undefined ?? null;
}

function getExecutionRunByPlan(projectId: string, planId: string): RestoreExecutionRun | null {
  const run = getDb(backupDbPath()).prepare(
    "SELECT * FROM backup_restore_execution_runs WHERE project_id = ? AND plan_id = ? ORDER BY created_at DESC LIMIT 1",
  ).get(projectId, planId) as StoredExecutionRun | undefined;
  return run ? executionRunDto(run) : null;
}

export function listRestoreExecutionPhaseEvents(projectId: string, planId: string, limit = 100): RestoreExecutionPhaseEvent[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new BackupError("BACKUP_INVALID");
  return getDb(backupDbPath()).prepare(
    `SELECT id, run_id, phase_code, status, error_code, created_at
     FROM backup_restore_execution_phase_events
     WHERE project_id = ? AND plan_id = ?
     ORDER BY created_at ASC, id ASC LIMIT ?`,
  ).all(projectId, planId, limit).map((event: any) => ({
    id: event.id,
    runId: event.run_id,
    phase: event.phase_code,
    status: event.status,
    errorCode: event.error_code,
    createdAt: event.created_at,
  })) as RestoreExecutionPhaseEvent[];
}

/** The fixed root executor records bounded phase evidence; no paths, tokens, or error text are stored. */
export function recordRestoreExecutionPhase(
  projectId: string,
  runId: string,
  phase: RestoreExecutionPhaseCode,
  status: RestoreExecutionPhaseStatus,
  errorCode: string | null = null,
): void {
  if (!RESTORE_EXECUTION_PHASE_CODES.includes(phase)
    || (status === "failed") !== Boolean(errorCode)
    || (errorCode !== null && !/^(?:DEADLINE_EXCEEDED|HOLDER_REFUSED|SAFETY_SNAPSHOT_FAILED|BUFFER_WRITE_FAILED|SWAP_FAILED|VERIFY_FAILED|HEALTH_FAILED|ROLLBACK_FAILED|JOURNAL_INVALID|SUPERVISOR_FAILED|EXECUTOR_SETUP_FAILED)$/.test(errorCode))) {
    throw new BackupError("BACKUP_INVALID");
  }
  const run = getExecutionRunRecord(projectId, runId);
  if (!run) throw new BackupError("RESTORE_EXECUTION_NOT_FOUND");
  execTransaction(() => {
    getDb(backupDbPath()).prepare(
      `INSERT INTO backup_restore_execution_phase_events
       (id, project_id, plan_id, backup_id, run_id, phase_code, status, error_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), projectId, run.plan_id, run.backup_id, run.id, phase, status, errorCode, now());
  });
  checkpointAfterWrite();
}

function executionRunDto(run: StoredExecutionRun): RestoreExecutionRun {
  return {
    id: run.id,
    planId: run.plan_id,
    backupId: run.backup_id,
    state: run.state,
    phase: run.phase,
    revision: run.revision,
    deadlineAt: run.deadline_at,
    safetyBackupId: run.safety_backup_id,
    errorCode: run.error_code,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    completedAt: run.completed_at,
  };
}

function appendExecutorPlanRevision(
  plan: StoredRestorePlan,
  prior: StoredPlanRevision | StoredExecutorPlanRevision,
  toState: RestorePlanState,
  stageHash: string,
  runId: string | null,
): StoredExecutorPlanRevision {
  const revision = prior.revision + 1;
  const createdAt = now();
  getDb(backupDbPath()).prepare(
    `INSERT INTO backup_restore_executor_plan_revisions
     (id, project_id, plan_id, backup_id, revision, from_state, to_state, execution_run_id, stage_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), plan.project_id, plan.id, plan.backup_id, revision, prior.to_state, toState, runId, stageHash, createdAt);
  return {
    project_id: plan.project_id,
    plan_id: plan.id,
    backup_id: plan.backup_id,
    revision,
    from_state: prior.to_state,
    to_state: toState,
    execution_run_id: runId,
    stage_hash: stageHash,
    created_at: createdAt,
  };
}

/** Issue a distinct one-time 15 minute token after the stage-confirmation flow. */
export function authorizeRestoreExecution(projectId: string, planId: string, expectedRevision: number): {
  plan: RestorePlan;
  executionToken: string;
  expiresAt: string;
} {
  assertGlobalBackupProject(projectId);
  const plan = requirePlan(projectId, planId);
  const current = requireLatestPlanRevision(plan);
  if (current.revision !== expectedRevision) throw new BackupError("RESTORE_REVISION_CONFLICT", current.revision);
  if (current.to_state !== "ready_for_executor" || !current.stage_hash) {
    throw new BackupError("RESTORE_STATE_CONFLICT", current.revision);
  }
  const validated = getReadyRestoreStage(projectId, planId);
  const stageHash = validated.stageHash;
  validated.release();
  const executionToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESTORE_EXECUTION_AUTHORIZATION_TTL_MS).toISOString();
  const result = execTransaction(() => {
    const currentPlan = requirePlan(projectId, planId);
    const latest = requireLatestPlanRevision(currentPlan);
    if (latest.revision !== expectedRevision) throw new BackupError("RESTORE_REVISION_CONFLICT", latest.revision);
    if (latest.to_state !== "ready_for_executor") throw new BackupError("RESTORE_STATE_CONFLICT", latest.revision);
    const tokenHash = executionAuthorizationTokenHash(executionToken, currentPlan, latest.revision, stageHash);
    getDb(backupDbPath()).prepare(
      `INSERT INTO backup_restore_execution_authorizations
       (id, project_id, plan_id, backup_id, operation, plan_revision, manifest_hash, plan_hash, stage_hash, token_hash, expires_at, consumed_at, created_at)
       VALUES (?, ?, ?, ?, 'execute_restore', ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      randomUUID(), projectId, planId, currentPlan.backup_id, latest.revision, currentPlan.manifest_hash,
      currentPlan.plan_hash, stageHash, tokenHash, expiresAt, now(),
    );
    const revision = appendExecutorPlanRevision(currentPlan, latest, "execution_authorized", stageHash, null);
    return { plan: currentPlan, revision };
  });
  checkpointAfterWrite();
  return { plan: planDto(result.plan, result.revision), executionToken, expiresAt };
}

function findExecutionReceipt(projectId: string, key: string): { request_hash: string; result_json: string } | null {
  return getDb(backupDbPath()).prepare(
    "SELECT request_hash, result_json FROM backup_restore_execution_receipts WHERE project_id = ? AND idempotency_key = ?",
  ).get(projectId, key) as { request_hash: string; result_json: string } | undefined ?? null;
}

/** Consume the execution token and persist a queued run. This never applies bytes. */
export function executeRestore(projectId: string, planId: string, input: {
  executionToken: string;
  expectedRevision: number;
  idempotencyKey: string;
}): { plan: RestorePlan; run: RestoreExecutionRun } {
  assertGlobalBackupProject(projectId);
  requireIdempotencyKey(input.idempotencyKey);
  requireExecutorToken(input.executionToken);
  const hash = requestHash({ planId, executionTokenHash: sha256(input.executionToken), expectedRevision: input.expectedRevision });
  const receipt = findExecutionReceipt(projectId, input.idempotencyKey);
  if (receipt) {
    if (!timingSafeHexEqual(receipt.request_hash, hash)) throw new BackupError("RESTORE_IDEMPOTENCY_CONFLICT");
    const replay = JSON.parse(receipt.result_json) as { runId?: string };
    if (!replay.runId) throw new BackupError("BACKUP_INVALID");
    const run = getExecutionRunRecord(projectId, replay.runId);
    if (!run) throw new BackupError("BACKUP_INVALID");
    return { plan: planDto(requirePlan(projectId, planId)), run: executionRunDto(run) };
  }
  const result = execTransaction(() => {
    const plan = requirePlan(projectId, planId);
    const latest = requireLatestPlanRevision(plan);
    if (latest.revision !== input.expectedRevision) throw new BackupError("RESTORE_REVISION_CONFLICT", latest.revision);
    if (latest.to_state !== "execution_authorized") throw new BackupError("RESTORE_STATE_CONFLICT", latest.revision);
    const authorization = getExecutionAuthorization(projectId, planId, latest.revision - 1);
    const expectedTokenHash = executionAuthorizationTokenHash(input.executionToken, plan, latest.revision - 1, latest.stage_hash!);
    if (!authorization || !timingSafeHexEqual(authorization.token_hash, expectedTokenHash)) {
      throw new BackupError("RESTORE_EXECUTION_AUTHORIZATION_INVALID");
    }
    if (authorization.consumed_at) throw new BackupError("RESTORE_EXECUTION_AUTHORIZATION_INVALID");
    if (Date.parse(authorization.expires_at) <= Date.now()) throw new BackupError("RESTORE_EXECUTION_AUTHORIZATION_EXPIRED");
    const stage = getReadyRestoreStage(projectId, planId);
    stage.release();
    const consumed = getDb(backupDbPath()).prepare(
      "UPDATE backup_restore_execution_authorizations SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL",
    ).run(now(), authorization.id);
    if (consumed.changes !== 1) throw new BackupError("RESTORE_EXECUTION_AUTHORIZATION_INVALID");
    const runId = randomUUID();
    const createdAt = now();
    const deadlineAt = new Date(Date.parse(createdAt) + RESTORE_EXECUTION_DEADLINE_MS).toISOString();
    getDb(backupDbPath()).prepare(
      `INSERT INTO backup_restore_execution_runs
       (id, project_id, plan_id, backup_id, authorization_id, plan_revision, manifest_hash, plan_hash, stage_hash,
        state, phase, revision, owner_hash, fence_hash, deadline_at, safety_backup_id, error_code, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'queued', 0, NULL, NULL, ?, NULL, NULL, ?, ?, NULL)`,
    ).run(
      runId, projectId, planId, plan.backup_id, authorization.id, authorization.plan_revision, plan.manifest_hash,
      plan.plan_hash, authorization.stage_hash, deadlineAt, createdAt, createdAt,
    );
    const components = parsePlanComponents(plan);
    for (const [component, expected] of Object.entries(components) as Array<["ingenium" | "opencode", { sha256: string; sizeBytes: number }]>) {
      getDb(backupDbPath()).prepare(
        `INSERT INTO backup_restore_execution_items
         (id, project_id, run_id, component, expected_sha256, size_bytes, pre_hash, post_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      ).run(randomUUID(), projectId, runId, component, expected.sha256, expected.sizeBytes, createdAt);
    }
    const revision = appendExecutorPlanRevision(plan, latest, "queued", authorization.stage_hash, runId);
    const resultJson = canonicalJson({ runId });
    getDb(backupDbPath()).prepare(
      `INSERT INTO backup_restore_execution_receipts
       (id, project_id, plan_id, operation, idempotency_key, request_hash, result_json, created_at)
       VALUES (?, ?, ?, 'execute_restore', ?, ?, ?, ?)`,
    ).run(randomUUID(), projectId, planId, input.idempotencyKey, hash, resultJson, createdAt);
    return { plan, revision, run: getExecutionRunRecord(projectId, runId)! };
  });
  checkpointAfterWrite();
  return { plan: planDto(result.plan, result.revision), run: executionRunDto(result.run) };
}

/** Claim the one queued run. Owner and fence values never leave this process boundary. */
export function claimPendingRestoreExecution(
  projectId: string,
  ownerToken: string,
  fenceToken: string,
  expectedRunId?: string,
): RestoreExecutionRun | null {
  assertGlobalBackupProject(projectId);
  requireExecutorToken(ownerToken);
  requireExecutorToken(fenceToken);
  const claimed = execTransaction(() => {
    const candidate = getDb(backupDbPath()).prepare(
      expectedRunId
        ? "SELECT * FROM backup_restore_execution_runs WHERE project_id = ? AND id = ? AND state = 'queued'"
        : "SELECT * FROM backup_restore_execution_runs WHERE project_id = ? AND state = 'queued' ORDER BY created_at ASC, id ASC LIMIT 1",
    ).get(...(expectedRunId ? [projectId, expectedRunId] : [projectId])) as StoredExecutionRun | undefined;
    if (!candidate) return null;
    if (Date.parse(candidate.deadline_at) <= Date.now()) throw new BackupError("RESTORE_EXECUTION_DEADLINE_EXCEEDED");
    const ownerHash = sha256(ownerToken);
    const fenceHash = sha256(fenceToken);
    const updated = getDb(backupDbPath()).prepare(
      `UPDATE backup_restore_execution_runs
       SET state = 'executor_claimed', phase = 'executor_claimed', revision = revision + 1,
           owner_hash = ?, fence_hash = ?, updated_at = ?
       WHERE project_id = ? AND id = ? AND state = 'queued' AND revision = ?`,
    ).run(ownerHash, fenceHash, now(), projectId, candidate.id, candidate.revision);
    if (updated.changes !== 1) throw new BackupError("RESTORE_EXECUTION_CONFLICT");
    const run = getExecutionRunRecord(projectId, candidate.id)!;
    const plan = requirePlan(projectId, run.plan_id);
    const latest = requireLatestPlanRevision(plan);
    appendExecutorPlanRevision(plan, latest, "executor_claimed", run.stage_hash, run.id);
    return run;
  });
  if (claimed) checkpointAfterWrite();
  return claimed ? executionRunDto(claimed) : null;
}

/** Return queued work for the fixed local executor; no capability material is exposed. */
export function listQueuedRestoreExecutions(projectId: string): RestoreExecutionRun[] {
  assertGlobalBackupProject(projectId);
  return (getDb(backupDbPath()).prepare(
    "SELECT * FROM backup_restore_execution_runs WHERE project_id = ? AND state = 'queued' AND deadline_at > ? ORDER BY created_at ASC, id ASC",
  ).all(projectId, now()) as StoredExecutionRun[]).map(executionRunDto);
}

/**
 * The API records a failed fixed-Supervisor launch instead of returning a
 * successful queue response that no privileged process can consume.
 */
export function failRestoreExecutionStart(
  projectId: string,
  runId: string,
  expectedRevision: number,
): RestoreExecutionRun {
  const result = execTransaction(() => {
    const run = getExecutionRunRecord(projectId, runId);
    if (!run) throw new BackupError("RESTORE_EXECUTION_NOT_FOUND");
    if (run.state !== "queued" || run.revision !== expectedRevision) {
      throw new BackupError("RESTORE_EXECUTION_CONFLICT", run.revision);
    }
    const completedAt = now();
    const changed = getDb(backupDbPath()).prepare(
      `UPDATE backup_restore_execution_runs
       SET state = 'executor_start_failed', phase = 'executor_start_failed', revision = revision + 1,
           error_code = 'SUPERVISOR_FAILED', updated_at = ?, completed_at = ?
       WHERE project_id = ? AND id = ? AND state = 'queued' AND revision = ?`,
    ).run(completedAt, completedAt, projectId, runId, expectedRevision);
    if (changed.changes !== 1) throw new BackupError("RESTORE_EXECUTION_CONFLICT");
    const updated = getExecutionRunRecord(projectId, runId)!;
    const plan = requirePlan(projectId, updated.plan_id);
    appendExecutorPlanRevision(plan, requireLatestPlanRevision(plan), "executor_start_failed", updated.stage_hash, updated.id);
    return updated;
  });
  checkpointAfterWrite();
  return executionRunDto(result);
}

/** Terminalize a claimed run if privileged setup fails before its journal exists. */
export function failRestoreExecutionSetup(
  projectId: string,
  runId: string,
  ownerToken: string,
  fenceToken: string,
  expectedRevision: number,
): RestoreExecutionRun {
  const result = execTransaction(() => {
    const run = requireExecutionOwnership(projectId, runId, ownerToken, fenceToken);
    if (run.state !== "executor_claimed" || run.revision !== expectedRevision) {
      throw new BackupError("RESTORE_EXECUTION_CONFLICT", run.revision);
    }
    const completedAt = now();
    const changed = getDb(backupDbPath()).prepare(
      `UPDATE backup_restore_execution_runs
       SET state = 'executor_setup_failed', phase = 'executor_setup_failed', revision = revision + 1,
           error_code = 'EXECUTOR_SETUP_FAILED', updated_at = ?, completed_at = ?
       WHERE project_id = ? AND id = ? AND state = 'executor_claimed' AND revision = ?`,
    ).run(completedAt, completedAt, projectId, runId, expectedRevision);
    if (changed.changes !== 1) throw new BackupError("RESTORE_EXECUTION_CONFLICT");
    const updated = getExecutionRunRecord(projectId, runId)!;
    const plan = requirePlan(projectId, updated.plan_id);
    appendExecutorPlanRevision(plan, requireLatestPlanRevision(plan), "executor_setup_failed", updated.stage_hash, updated.id);
    return updated;
  });
  checkpointAfterWrite();
  return executionRunDto(result);
}

/** Resolve a crashed pre-journal claim; the root recovery path has no tokens to replay. */
export function failClaimedRestoreExecutionSetup(
  projectId: string,
  runId: string,
  expectedRevision: number,
): RestoreExecutionRun {
  const result = execTransaction(() => {
    const run = getExecutionRunRecord(projectId, runId);
    if (!run) throw new BackupError("RESTORE_EXECUTION_NOT_FOUND");
    if (run.state !== "executor_claimed" || run.revision !== expectedRevision || !run.owner_hash || !run.fence_hash) {
      throw new BackupError("RESTORE_EXECUTION_CONFLICT", run.revision);
    }
    const completedAt = now();
    const changed = getDb(backupDbPath()).prepare(
      `UPDATE backup_restore_execution_runs
       SET state = 'executor_setup_failed', phase = 'executor_setup_failed', revision = revision + 1,
           error_code = 'EXECUTOR_SETUP_FAILED', updated_at = ?, completed_at = ?
       WHERE project_id = ? AND id = ? AND state = 'executor_claimed' AND revision = ?`,
    ).run(completedAt, completedAt, projectId, runId, expectedRevision);
    if (changed.changes !== 1) throw new BackupError("RESTORE_EXECUTION_CONFLICT");
    const updated = getExecutionRunRecord(projectId, runId)!;
    const plan = requirePlan(projectId, updated.plan_id);
    appendExecutorPlanRevision(plan, requireLatestPlanRevision(plan), "executor_setup_failed", updated.stage_hash, updated.id);
    return updated;
  });
  checkpointAfterWrite();
  return executionRunDto(result);
}

function requireExecutionOwnership(projectId: string, runId: string, ownerToken: string, fenceToken: string): StoredExecutionRun {
  requireExecutorToken(ownerToken);
  requireExecutorToken(fenceToken);
  const run = getExecutionRunRecord(projectId, runId);
  if (!run) throw new BackupError("RESTORE_EXECUTION_NOT_FOUND");
  if (!run.owner_hash || !run.fence_hash || !timingSafeHexEqual(run.owner_hash, sha256(ownerToken))
    || !timingSafeHexEqual(run.fence_hash, sha256(fenceToken))) {
    throw new BackupError("RESTORE_EXECUTION_CONFLICT");
  }
  return run;
}

/** Get the verified independent stage only for the currently fenced maintenance owner. */
export function getExecutionRestoreStage(projectId: string, runId: string, ownerToken: string, fenceToken: string): ValidatedReadyRestoreStage {
  const run = requireExecutionOwnership(projectId, runId, ownerToken, fenceToken);
  if (Date.parse(run.deadline_at) <= Date.now()) throw new BackupError("RESTORE_EXECUTION_DEADLINE_EXCEEDED");
  if (!["executor_claimed", "quiescing", "snapshotting"].includes(run.state)) {
    throw new BackupError("RESTORE_STATE_CONFLICT", run.revision);
  }
  return getReadyRestoreStage(projectId, run.plan_id);
}

/** Advance one executor phase with owner/fence and per-run revision CAS. */
export function transitionRestoreExecution(
  projectId: string,
  runId: string,
  ownerToken: string,
  fenceToken: string,
  expectedRevision: number,
  toState: RestoreExecutionState,
  options: { safetyBackupId?: string; errorCode?: StoredExecutionRun["error_code"] } = {},
): RestoreExecutionRun {
  const result = execTransaction(() => {
    const run = requireExecutionOwnership(projectId, runId, ownerToken, fenceToken);
    if (run.revision !== expectedRevision) throw new BackupError("RESTORE_REVISION_CONFLICT", run.revision);
    if (toState !== "rolling_back" && Date.parse(run.deadline_at) <= Date.now()) {
      throw new BackupError("RESTORE_EXECUTION_DEADLINE_EXCEEDED");
    }
    const safetyBackupId = options.safetyBackupId ?? run.safety_backup_id;
    const errorCode = options.errorCode ?? run.error_code;
    const completedAt = ["completed", "rolled_back", "rollback_failed"].includes(toState) ? now() : null;
    const update = getDb(backupDbPath()).prepare(
      `UPDATE backup_restore_execution_runs
       SET state = ?, phase = ?, revision = revision + 1, safety_backup_id = ?, error_code = ?, updated_at = ?, completed_at = ?
       WHERE project_id = ? AND id = ? AND revision = ?`,
    ).run(toState, toState, safetyBackupId, errorCode, now(), completedAt, projectId, runId, expectedRevision);
    if (update.changes !== 1) throw new BackupError("RESTORE_EXECUTION_CONFLICT");
    const updated = getExecutionRunRecord(projectId, runId)!;
    const plan = requirePlan(projectId, updated.plan_id);
    const latest = requireLatestPlanRevision(plan);
    appendExecutorPlanRevision(plan, latest, toState, updated.stage_hash, updated.id);
    return updated;
  });
  checkpointAfterWrite();
  return executionRunDto(result);
}

/** Persist only component hashes after the executor observes a stopped target. */
export function recordRestoreExecutionHashes(
  projectId: string,
  runId: string,
  ownerToken: string,
  fenceToken: string,
  kind: "pre" | "post",
  hashes: Record<"ingenium" | "opencode", string>,
): void {
  const run = requireExecutionOwnership(projectId, runId, ownerToken, fenceToken);
  if ((kind === "pre" && run.state !== "snapshotting") || (kind === "post" && run.state !== "verifying")) {
    throw new BackupError("RESTORE_STATE_CONFLICT", run.revision);
  }
  for (const component of ["ingenium", "opencode"] as const) {
    if (!SHA256.test(hashes[component])) throw new BackupError("BACKUP_INVALID");
  }
  const column = kind === "pre" ? "pre_hash" : "post_hash";
  execTransaction(() => {
    for (const component of ["ingenium", "opencode"] as const) {
      const changed = getDb(backupDbPath()).prepare(
        `UPDATE backup_restore_execution_items SET ${column} = ?
         WHERE project_id = ? AND run_id = ? AND component = ? AND ${column} IS NULL`,
      ).run(hashes[component], projectId, runId, component);
      if (changed.changes !== 1) throw new BackupError("RESTORE_EXECUTION_CONFLICT");
    }
  });
  checkpointAfterWrite();
}

export function getRestoreExecutionRun(projectId: string, runId: string): RestoreExecutionRun | null {
  const run = getExecutionRunRecord(projectId, runId);
  return run ? executionRunDto(run) : null;
}

/**
 * Metadata-only evidence kept in the maintenance journal. It deliberately has
 * no raw authorization/owner/fence tokens or database bytes.
 */
export type RestoreExecutionCapsule = {
  plan: StoredRestorePlan;
  legacyRevisions: StoredPlanRevision[];
  legacyAuthorizations: StoredAuthorization[];
  stage: RestoreStage;
  legacyReceipts: Array<Record<string, unknown>>;
  executionAuthorization: StoredExecutionAuthorization;
  run: StoredExecutionRun;
  items: StoredExecutionItem[];
  executionReceipts: Array<Record<string, unknown>>;
  phaseEvents: StoredExecutionPhaseEvent[];
  sourceRecord: BackupRecord;
  safetyRecord: BackupRecord | null;
};

/** Capture the exact durable restore metadata before replacing the Ingenium DB. */
export function captureRestoreExecutionCapsule(projectId: string, runId: string): RestoreExecutionCapsule {
  const run = getExecutionRunRecord(projectId, runId);
  if (!run) throw new BackupError("RESTORE_EXECUTION_NOT_FOUND");
  const plan = requirePlan(projectId, run.plan_id);
  const stage = getRestoreStage(plan);
  const authorization = getExecutionAuthorization(projectId, plan.id, run.plan_revision);
  const sourceRecord = getBackup(projectId, plan.backup_id);
  if (!stage || !authorization || !sourceRecord) throw new BackupError("BACKUP_INVALID");
  const db = getDb(backupDbPath());
  return {
    plan,
    legacyRevisions: db.prepare(
      "SELECT project_id, plan_id, backup_id, revision, from_state, to_state, stage_hash, created_at FROM backup_restore_plan_revisions WHERE project_id = ? AND plan_id = ? ORDER BY revision ASC",
    ).all(projectId, plan.id) as StoredPlanRevision[],
    legacyAuthorizations: db.prepare(
      "SELECT * FROM backup_restore_authorizations WHERE project_id = ? AND plan_id = ? ORDER BY plan_revision ASC",
    ).all(projectId, plan.id) as StoredAuthorization[],
    stage,
    legacyReceipts: db.prepare(
      "SELECT * FROM backup_restore_receipts WHERE project_id = ? AND plan_id = ? ORDER BY created_at ASC, id ASC",
    ).all(projectId, plan.id) as Array<Record<string, unknown>>,
    executionAuthorization: authorization,
    run,
    items: db.prepare(
      "SELECT * FROM backup_restore_execution_items WHERE project_id = ? AND run_id = ? ORDER BY component ASC",
    ).all(projectId, run.id) as StoredExecutionItem[],
    executionReceipts: db.prepare(
      "SELECT * FROM backup_restore_execution_receipts WHERE project_id = ? AND plan_id = ? ORDER BY created_at ASC, id ASC",
    ).all(projectId, plan.id) as Array<Record<string, unknown>>,
    phaseEvents: db.prepare(
      "SELECT * FROM backup_restore_execution_phase_events WHERE project_id = ? AND plan_id = ? ORDER BY created_at ASC, id ASC",
    ).all(projectId, plan.id) as StoredExecutionPhaseEvent[],
    sourceRecord,
    safetyRecord: run.safety_backup_id ? getBackup(projectId, run.safety_backup_id) : null,
  };
}

function insertBackupRecordIfMissing(record: BackupRecord): void {
  getDb(backupDbPath()).prepare(
    `INSERT OR IGNORE INTO backup_records
     (id, project_id, filename, size_bytes, sha256, backup_type, components, status, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id, record.project_id, record.filename, record.size_bytes, record.sha256, record.backup_type,
    record.components, record.status, record.error_message, record.created_at,
  );
}

/**
 * Rebuild the approval ledger in a restored 083/084 database. Active ownership
 * is intentionally reset to the same queued run ID: only the static executor
 * can claim and resolve that run after journal recovery.
 */
export function rehydrateRestoreExecutionCapsule(capsule: RestoreExecutionCapsule): RestoreExecutionRun {
  const result = execTransaction(() => {
    const db = getDb(backupDbPath());
    insertBackupRecordIfMissing(capsule.sourceRecord);
    if (capsule.safetyRecord) insertBackupRecordIfMissing(capsule.safetyRecord);
    db.prepare(
      `INSERT OR IGNORE INTO backup_restore_plans
       (id, project_id, backup_id, dry_run, manifest_hash, plan_hash, components_json, blockers_json, warnings_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      capsule.plan.id, capsule.plan.project_id, capsule.plan.backup_id, capsule.plan.dry_run,
      capsule.plan.manifest_hash, capsule.plan.plan_hash, capsule.plan.components_json, capsule.plan.blockers_json,
      capsule.plan.warnings_json, capsule.plan.created_at,
    );
    for (const revision of capsule.legacyRevisions) {
      if (revision.to_state === "authorized") {
        const authorization = capsule.legacyAuthorizations.find((entry) => entry.plan_revision === revision.revision);
        if (!authorization) throw new BackupError("BACKUP_INVALID");
        db.prepare(
          `INSERT OR IGNORE INTO backup_restore_authorizations
           (id, project_id, plan_id, backup_id, operation, plan_revision, manifest_hash, token_hash, expires_at, consumed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        ).run(
          authorization.id, authorization.project_id, authorization.plan_id, authorization.backup_id,
          authorization.operation, authorization.plan_revision, authorization.manifest_hash, authorization.token_hash,
          authorization.expires_at, authorization.created_at,
        );
      }
      if (revision.to_state === "confirmed") {
        const authorization = capsule.legacyAuthorizations.find((entry) => entry.plan_revision === revision.revision - 1);
        if (!authorization?.consumed_at) throw new BackupError("BACKUP_INVALID");
        db.prepare("UPDATE backup_restore_authorizations SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")
          .run(authorization.consumed_at, authorization.id);
      }
      if (revision.to_state === "ready_for_executor") {
        const stage = capsule.stage;
        db.prepare(
          `INSERT OR IGNORE INTO backup_restore_stages
           (id, project_id, plan_id, backup_id, manifest_hash, plan_hash, ingenium_sha256, ingenium_size_bytes,
            opencode_sha256, opencode_size_bytes, stage_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          randomUUID(), stage.project_id, stage.plan_id, stage.backup_id, stage.manifest_hash, stage.plan_hash,
          stage.ingenium_sha256, stage.ingenium_size_bytes, stage.opencode_sha256, stage.opencode_size_bytes,
          stage.stage_hash, stage.created_at,
        );
      }
      db.prepare(
        `INSERT OR IGNORE INTO backup_restore_plan_revisions
         (id, project_id, plan_id, backup_id, revision, from_state, to_state, stage_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(), revision.project_id, revision.plan_id, revision.backup_id, revision.revision,
        revision.from_state, revision.to_state, revision.stage_hash, revision.created_at,
      );
    }
    for (const receipt of capsule.legacyReceipts) {
      db.prepare(
        `INSERT OR IGNORE INTO backup_restore_receipts
         (id, project_id, plan_id, operation, idempotency_key, request_hash, result_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        receipt["id"], receipt["project_id"], receipt["plan_id"], receipt["operation"], receipt["idempotency_key"],
        receipt["request_hash"], receipt["result_json"], receipt["created_at"],
      );
    }
    const existing = getExecutionRunRecord(capsule.run.project_id, capsule.run.id);
    if (existing) return existing;
    const authorization = capsule.executionAuthorization;
    db.prepare(
      `INSERT INTO backup_restore_execution_authorizations
       (id, project_id, plan_id, backup_id, operation, plan_revision, manifest_hash, plan_hash, stage_hash, token_hash, expires_at, consumed_at, created_at)
       VALUES (?, ?, ?, ?, 'execute_restore', ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      authorization.id, authorization.project_id, authorization.plan_id, authorization.backup_id,
      authorization.plan_revision, authorization.manifest_hash, authorization.plan_hash, authorization.stage_hash,
      authorization.token_hash, authorization.expires_at, authorization.created_at,
    );
    const legacyLatest = requireLatestRevision(capsule.plan.project_id, capsule.plan.id);
    appendExecutorPlanRevision(capsule.plan, legacyLatest, "execution_authorized", authorization.stage_hash, null);
    if (!authorization.consumed_at) throw new BackupError("BACKUP_INVALID");
    db.prepare("UPDATE backup_restore_execution_authorizations SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")
      .run(authorization.consumed_at, authorization.id);
    const createdAt = capsule.run.created_at;
    db.prepare(
      `INSERT INTO backup_restore_execution_runs
       (id, project_id, plan_id, backup_id, authorization_id, plan_revision, manifest_hash, plan_hash, stage_hash,
        state, phase, revision, owner_hash, fence_hash, deadline_at, safety_backup_id, error_code, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'queued', 0, NULL, NULL, ?, NULL, NULL, ?, ?, NULL)`,
    ).run(
      capsule.run.id, capsule.run.project_id, capsule.run.plan_id, capsule.run.backup_id, authorization.id,
      capsule.run.plan_revision, capsule.run.manifest_hash, capsule.run.plan_hash, capsule.run.stage_hash,
      capsule.run.deadline_at, createdAt, createdAt,
    );
    for (const item of capsule.items) {
      db.prepare(
        `INSERT INTO backup_restore_execution_items
         (id, project_id, run_id, component, expected_sha256, size_bytes, pre_hash, post_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      ).run(item.id, item.project_id, item.run_id, item.component, item.expected_sha256, item.size_bytes, item.pre_hash, item.created_at);
    }
    const executionAuthorized = getLatestExecutorRevision(capsule.plan.project_id, capsule.plan.id)!;
    appendExecutorPlanRevision(capsule.plan, executionAuthorized, "queued", authorization.stage_hash, capsule.run.id);
    for (const receipt of capsule.executionReceipts) {
      db.prepare(
        `INSERT OR IGNORE INTO backup_restore_execution_receipts
         (id, project_id, plan_id, operation, idempotency_key, request_hash, result_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        receipt["id"], receipt["project_id"], receipt["plan_id"], receipt["operation"], receipt["idempotency_key"],
        receipt["request_hash"], receipt["result_json"], receipt["created_at"],
      );
    }
    for (const event of capsule.phaseEvents) {
      db.prepare(
        `INSERT OR IGNORE INTO backup_restore_execution_phase_events
         (id, project_id, plan_id, backup_id, run_id, phase_code, status, error_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        event.id, event.project_id, event.plan_id, event.backup_id, event.run_id,
        event.phase_code, event.status, event.error_code, event.created_at,
      );
    }
    return getExecutionRunRecord(capsule.run.project_id, capsule.run.id)!;
  });
  checkpointAfterWrite();
  return executionRunDto(result);
}

/**
 * Complete a journal-authenticated maintenance recovery without recovering an
 * executor capability token. This is intentionally not exposed by API or MCP.
 */
export function recoverRestoreExecutionCapsule(
  capsule: RestoreExecutionCapsule,
  outcome: "rolled_back" | "rollback_failed",
  errorCode: NonNullable<StoredExecutionRun["error_code"]>,
): RestoreExecutionRun {
  rehydrateRestoreExecutionCapsule(capsule);
  const result = execTransaction(() => {
    const db = getDb(backupDbPath());
    let run = getExecutionRunRecord(capsule.run.project_id, capsule.run.id);
    if (!run) throw new BackupError("RESTORE_EXECUTION_NOT_FOUND");
    if (["completed", "rolled_back", "rollback_failed"].includes(run.state)) {
      if (run.state !== outcome) throw new BackupError("RESTORE_STATE_CONFLICT", run.revision);
      return run;
    }

    if (run.state === "queued") {
      const claimed = db.prepare(
        `UPDATE backup_restore_execution_runs
         SET state = 'executor_claimed', phase = 'executor_claimed', revision = revision + 1,
             owner_hash = ?, fence_hash = ?, updated_at = ?
         WHERE project_id = ? AND id = ? AND state = 'queued' AND revision = ?`,
      ).run(
        sha256(randomBytes(32)), sha256(randomBytes(32)), now(),
        capsule.run.project_id, run.id, run.revision,
      );
      if (claimed.changes !== 1) throw new BackupError("RESTORE_EXECUTION_CONFLICT");
      run = getExecutionRunRecord(capsule.run.project_id, run.id)!;
      const plan = requirePlan(capsule.run.project_id, run.plan_id);
      appendExecutorPlanRevision(plan, requireLatestPlanRevision(plan), "executor_claimed", run.stage_hash, run.id);
    }

    const advance = (toState: "rolling_back" | "rolled_back" | "rollback_failed"): StoredExecutionRun => {
      const completedAt = toState === "rolling_back" ? null : now();
      const changed = db.prepare(
        `UPDATE backup_restore_execution_runs
         SET state = ?, phase = ?, revision = revision + 1, error_code = ?, updated_at = ?, completed_at = ?
         WHERE project_id = ? AND id = ? AND revision = ?`,
      ).run(
        toState, toState, errorCode, now(), completedAt,
        capsule.run.project_id, run!.id, run!.revision,
      );
      if (changed.changes !== 1) throw new BackupError("RESTORE_EXECUTION_CONFLICT");
      const updated = getExecutionRunRecord(capsule.run.project_id, run!.id);
      if (!updated) throw new BackupError("RESTORE_EXECUTION_NOT_FOUND");
      const plan = requirePlan(capsule.run.project_id, updated.plan_id);
      appendExecutorPlanRevision(plan, requireLatestPlanRevision(plan), toState, updated.stage_hash, updated.id);
      return updated;
    };

    if (run.state !== "rolling_back") run = advance("rolling_back");
    return advance(outcome);
  });
  checkpointAfterWrite();
  return executionRunDto(result);
}

/** The old boolean-confirm path is intentionally unavailable after RESTORE-100. */
export function startRestore(): never {
  throw new BackupError("RESTORE_MIGRATION_REQUIRED");
}

/** Legacy restore-job status cannot represent a RESTORE-100 plan. */
export function getRestoreStatus(projectId: string, planId: string): RestorePlan | null {
  return getRestorePlan(projectId, planId);
}

/** Retained no-op compatibility hook; legacy rows are deliberately not rewritten. */
export function migrateLegacyBackupOwnership(_globalProjectId: string): { backupRecords: number; restoreJobs: number } {
  return { backupRecords: 0, restoreJobs: 0 };
}
