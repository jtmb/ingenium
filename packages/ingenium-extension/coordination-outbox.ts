import { createHash, randomUUID } from "node:crypto";
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
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

export const COORDINATION_OUTBOX_MAX_RECORD_BYTES = 16 * 1024;
export const COORDINATION_OUTBOX_MAX_RECORDS = 128;
export const COORDINATION_OUTBOX_MAX_BYTES = 2 * 1024 * 1024;
export const COORDINATION_OUTBOX_AUTHORIZED_OVERFLOW_KEY = "098781a9c6484288bd5f9d9a0cba6b049d3c8a2f15b023b56d5ccc08237bafd0";

export type CoordinationOutboxKind =
  | "register"
  | "claim"
  | "completion"
  | "quarantine"
  | "snapshot"
  | "memory"
  | "publication"
  | "ack"
  | "memory_ack"
  | "heartbeat"
  | "recovery"
  | "close"
  | "overflow";

export type CoordinationOutboxFailure =
  | "unavailable"
  | "conflict"
  | "authentication"
  | "rate_limited"
  | "quarantined"
  | "invalid_response";

export type CoordinationOutboxMutationOperation =
  | "write" | "edit" | "create" | "delete" | "rename" | "apply_patch" | "repository" | "build";

export interface CoordinationOutboxFootprint {
  pathSegments: string[] | null;
  pathSha256: string;
  beforeSha256: string | null;
  afterSha256: string | null;
}

export interface CoordinationOutboxRemoteClaim {
  worktreeId: string;
  sessionId: string;
  incarnation: number;
  expectedRevision: number;
  fence: number;
  ownershipToken: string;
  clientClaimKey: string;
  acceptedEpoch: number;
  remoteOperationId: string;
}

export interface CoordinationOutboxMutationEvidence {
  phase: "claim_failed" | "local_applied" | "completion_ambiguous";
  operation: CoordinationOutboxMutationOperation;
  declaredPathSegments: string[][];
  footprint: CoordinationOutboxFootprint[];
  remoteClaim: CoordinationOutboxRemoteClaim | null;
}

export interface CoordinationOutboxRecord {
  version: 1;
  operationId: string;
  key: string;
  kind: CoordinationOutboxKind;
  sessionHash: string;
  createdAt: string;
  failure: CoordinationOutboxFailure;
  revision: number | null;
  cursor: number | null;
  digest: string;
  ambiguous: boolean;
  count: number;
  mutation: CoordinationOutboxMutationEvidence | null;
}

export interface LegacyCoordinationOutboxDisposition {
  schemaVersion: 1;
  recordKey: string;
  recordSha256: string;
  operationId: string;
  decision: "abandoned";
  authority: "explicit_user_authorization";
  reason: "nonrecoverable_identityless_overflow";
  createdAt: string;
}

export interface CoordinationOutboxDispositionAuthorization {
  schemaVersion: 1;
  authorizationId: string;
  recordKey: string;
  mode: "abandon_identityless_overflow";
  authority: "explicit_user_authorization";
  scope: "exact_key_same_record_family";
  reason: "nonrecoverable_identityless_overflow";
  issuedAt: string;
  expiresAt: string;
}

export interface CoordinationOutboxDisposition {
  schemaVersion: 2;
  recordKey: string;
  recordSha256: string;
  recordCount: number;
  operationId: string;
  authorizationSha256: string;
  decision: "abandoned";
  authority: "explicit_user_authorization";
  reason: "nonrecoverable_identityless_overflow";
  createdAt: string;
}

export interface PreparedCoordinationOutboxDisposition {
  disposition: CoordinationOutboxDisposition;
  rollback(): void;
}

export interface CoordinationOutboxInput {
  exactKey: string;
  kind: Exclude<CoordinationOutboxKind, "overflow">;
  sessionHash: string;
  failure: CoordinationOutboxFailure;
  revision?: number;
  cursor?: number;
  digest?: string;
  ambiguous?: boolean;
  mutation?: CoordinationOutboxMutationEvidence;
}

const RECORD_KEYS = [
  "version", "operationId", "key", "kind", "sessionHash", "createdAt", "failure",
  "revision", "cursor", "digest", "ambiguous", "count", "mutation",
] as const;
const LEGACY_DISPOSITION_KEYS = [
  "schemaVersion", "recordKey", "recordSha256", "operationId", "decision", "authority", "reason", "createdAt",
] as const;
const DISPOSITION_KEYS = [
  "schemaVersion", "recordKey", "recordSha256", "recordCount", "operationId", "authorizationSha256",
  "decision", "authority", "reason", "createdAt",
] as const;
const AUTHORIZATION_KEYS = [
  "schemaVersion", "authorizationId", "recordKey", "mode", "authority", "scope", "reason", "issuedAt", "expiresAt",
] as const;
const KINDS = new Set<CoordinationOutboxKind>([
  "register", "claim", "completion", "quarantine", "snapshot", "memory", "publication",
  "ack", "memory_ack", "heartbeat", "recovery", "close", "overflow",
]);
const FAILURES = new Set<CoordinationOutboxFailure>([
  "unavailable", "conflict", "authentication", "rate_limited", "quarantined", "invalid_response",
]);
const HASH = /^[0-9a-f]{64}$/;
const SESSION_REFERENCE = /^[0-9a-f]{64}$/;
const STORED_SESSION_REFERENCE = /^(?:[0-9a-f]{16}|[0-9a-f]{64})$/;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_ID = /^(?:session|worktree)-[0-9a-f]{64}$/;
const MUTATION_OPERATIONS = new Set<CoordinationOutboxMutationOperation>([
  "write", "edit", "create", "delete", "rename", "apply_patch", "repository", "build",
]);
const FILESYSTEM_SENTINEL_KEY = hash("coordination-outbox-filesystem-sentinel");
const FILESYSTEM_SENTINEL_CREATED_AT = new Date(0).toISOString();
const MAX_AUTHORIZATION_LIFETIME_MS = 24 * 60 * 60 * 1_000;

interface CoordinationOutboxRecordSnapshot {
  record: CoordinationOutboxRecord;
  sha256: string | undefined;
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validPathSegments(value: unknown): value is string[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 128
    && value.every((segment) => typeof segment === "string" && /^[A-Za-z0-9_-]{1,342}$/.test(segment));
}

function validMutation(value: unknown): value is CoordinationOutboxMutationEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const mutation = value as Record<string, unknown>;
  if (Object.keys(mutation).length !== 5
    || !["phase", "operation", "declaredPathSegments", "footprint", "remoteClaim"].every((key) => Object.hasOwn(mutation, key))
    || (mutation.phase !== "claim_failed" && mutation.phase !== "local_applied" && mutation.phase !== "completion_ambiguous")
    || typeof mutation.operation !== "string" || !MUTATION_OPERATIONS.has(mutation.operation as CoordinationOutboxMutationOperation)
    || !Array.isArray(mutation.declaredPathSegments) || mutation.declaredPathSegments.length > 32
    || !mutation.declaredPathSegments.every(validPathSegments)
    || !Array.isArray(mutation.footprint) || mutation.footprint.length > 256) return false;
  for (const value of mutation.footprint) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const entry = value as Record<string, unknown>;
    if (Object.keys(entry).length !== 4
      || !["pathSegments", "pathSha256", "beforeSha256", "afterSha256"].every((key) => Object.hasOwn(entry, key))
      || (entry.pathSegments !== null && !validPathSegments(entry.pathSegments))
      || typeof entry.pathSha256 !== "string" || !HASH.test(entry.pathSha256)
      || (entry.beforeSha256 !== null && (typeof entry.beforeSha256 !== "string" || !HASH.test(entry.beforeSha256)))
      || (entry.afterSha256 !== null && (typeof entry.afterSha256 !== "string" || !HASH.test(entry.afterSha256)))) return false;
  }
  if (mutation.remoteClaim === null) return mutation.phase !== "completion_ambiguous";
  if (typeof mutation.remoteClaim !== "object" || Array.isArray(mutation.remoteClaim)) return false;
  const claim = mutation.remoteClaim as Record<string, unknown>;
  return Object.keys(claim).length === 9
    && ["worktreeId", "sessionId", "incarnation", "expectedRevision", "fence", "ownershipToken", "clientClaimKey", "acceptedEpoch", "remoteOperationId"]
      .every((key) => Object.hasOwn(claim, key))
    && typeof claim.worktreeId === "string" && OPAQUE_ID.test(claim.worktreeId)
    && typeof claim.sessionId === "string" && OPAQUE_ID.test(claim.sessionId)
    && safeInteger(claim.incarnation) && claim.incarnation >= 1
    && safeInteger(claim.expectedRevision)
    && safeInteger(claim.fence) && claim.fence >= 1
    && typeof claim.ownershipToken === "string" && TOKEN.test(claim.ownershipToken)
    && typeof claim.clientClaimKey === "string" && TOKEN.test(claim.clientClaimKey)
    && claim.clientClaimKey !== claim.ownershipToken
    && safeInteger(claim.acceptedEpoch) && claim.acceptedEpoch >= 1
    && typeof claim.remoteOperationId === "string" && UUID.test(claim.remoteOperationId)
    && mutation.phase === "completion_ambiguous";
}

function validRecord(value: unknown): value is CoordinationOutboxRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === RECORD_KEYS.length && RECORD_KEYS.every((key) => Object.hasOwn(record, key))
    && record.version === 1 && typeof record.operationId === "string" && HASH.test(record.operationId)
    && typeof record.key === "string" && HASH.test(record.key)
    && typeof record.kind === "string" && KINDS.has(record.kind as CoordinationOutboxKind)
    && typeof record.sessionHash === "string" && STORED_SESSION_REFERENCE.test(record.sessionHash)
    && typeof record.createdAt === "string" && Number.isFinite(Date.parse(record.createdAt))
    && typeof record.failure === "string" && FAILURES.has(record.failure as CoordinationOutboxFailure)
    && (record.revision === null || safeInteger(record.revision))
    && (record.cursor === null || safeInteger(record.cursor))
    && typeof record.digest === "string" && HASH.test(record.digest)
    && typeof record.ambiguous === "boolean" && safeInteger(record.count) && record.count >= 1
    && (record.mutation === null || validMutation(record.mutation));
}

function validLegacyDisposition(value: unknown): value is LegacyCoordinationOutboxDisposition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const disposition = value as Record<string, unknown>;
  return Object.keys(disposition).length === LEGACY_DISPOSITION_KEYS.length
    && LEGACY_DISPOSITION_KEYS.every((key) => Object.hasOwn(disposition, key))
    && disposition.schemaVersion === 1
    && typeof disposition.recordKey === "string" && HASH.test(disposition.recordKey)
    && typeof disposition.recordSha256 === "string" && HASH.test(disposition.recordSha256)
    && typeof disposition.operationId === "string" && HASH.test(disposition.operationId)
    && disposition.decision === "abandoned"
    && disposition.authority === "explicit_user_authorization"
    && disposition.reason === "nonrecoverable_identityless_overflow"
    && typeof disposition.createdAt === "string" && Number.isFinite(Date.parse(disposition.createdAt));
}

function validAuthorization(
  value: unknown,
  now?: number,
): value is CoordinationOutboxDispositionAuthorization {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const authorization = value as Record<string, unknown>;
  if (Object.keys(authorization).length !== AUTHORIZATION_KEYS.length
    || !AUTHORIZATION_KEYS.every((key) => Object.hasOwn(authorization, key))
    || authorization.schemaVersion !== 1
    || typeof authorization.authorizationId !== "string" || !HASH.test(authorization.authorizationId)
    || typeof authorization.recordKey !== "string" || authorization.recordKey !== COORDINATION_OUTBOX_AUTHORIZED_OVERFLOW_KEY
    || authorization.mode !== "abandon_identityless_overflow"
    || authorization.authority !== "explicit_user_authorization"
    || authorization.scope !== "exact_key_same_record_family"
    || authorization.reason !== "nonrecoverable_identityless_overflow"
    || typeof authorization.issuedAt !== "string" || typeof authorization.expiresAt !== "string") return false;
  const issuedAt = Date.parse(authorization.issuedAt);
  const expiresAt = Date.parse(authorization.expiresAt);
  return Number.isFinite(issuedAt) && Number.isFinite(expiresAt) && expiresAt > issuedAt
    && expiresAt - issuedAt <= MAX_AUTHORIZATION_LIFETIME_MS
    && (now === undefined || (issuedAt <= now && now < expiresAt));
}

function validDisposition(value: unknown): value is CoordinationOutboxDisposition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const disposition = value as Record<string, unknown>;
  return Object.keys(disposition).length === DISPOSITION_KEYS.length
    && DISPOSITION_KEYS.every((key) => Object.hasOwn(disposition, key))
    && disposition.schemaVersion === 2
    && typeof disposition.recordKey === "string" && HASH.test(disposition.recordKey)
    && typeof disposition.recordSha256 === "string" && HASH.test(disposition.recordSha256)
    && safeInteger(disposition.recordCount) && disposition.recordCount >= 1
    && typeof disposition.operationId === "string" && HASH.test(disposition.operationId)
    && typeof disposition.authorizationSha256 === "string" && HASH.test(disposition.authorizationSha256)
    && disposition.decision === "abandoned"
    && disposition.authority === "explicit_user_authorization"
    && disposition.reason === "nonrecoverable_identityless_overflow"
    && typeof disposition.createdAt === "string" && Number.isFinite(Date.parse(disposition.createdAt));
}

function owner(): number | undefined {
  if (typeof process.geteuid === "function") return process.geteuid();
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

function assertDirectory(path: string, mode?: number): void {
  const stat = lstatSync(path);
  const uid = owner();
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path
    || (uid !== undefined && stat.uid !== uid) || (mode !== undefined && (stat.mode & 0o777) !== mode)) {
    throw new Error("Coordination outbox is unavailable");
  }
}

function ensurePrivateDirectory(path: string, parent: string): void {
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const canonicalParent = realpathSync(parent);
  const beforeParent = lstatSync(parent);
  const before = lstatSync(path);
  const uid = owner();
  if (canonicalParent !== resolve(parent) || !beforeParent.isDirectory() || beforeParent.isSymbolicLink()
    || dirname(resolve(path)) !== canonicalParent || !before.isDirectory() || before.isSymbolicLink()
    || realpathSync(path) !== resolve(path) || (uid !== undefined && before.uid !== uid)
    || (before.mode & 0o700) !== 0o700) {
    throw new Error("Coordination outbox is unavailable");
  }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    const openedPath = lstatSync(path);
    const openedMode = opened.mode & 0o777;
    if (!opened.isDirectory() || (uid !== undefined && opened.uid !== uid)
      || !openedPath.isDirectory() || openedPath.isSymbolicLink()
      || opened.dev !== before.dev || opened.ino !== before.ino
      || openedPath.dev !== opened.dev || openedPath.ino !== opened.ino
      || (openedMode & 0o700) !== 0o700 || (openedPath.mode & 0o777) !== openedMode) {
      throw new Error("Coordination outbox is unavailable");
    }
    if (openedMode !== 0o700) fchmodSync(descriptor, 0o700);
    const normalized = fstatSync(descriptor);
    const normalizedPath = lstatSync(path);
    const normalizedParent = lstatSync(parent);
    if (!normalized.isDirectory() || (normalized.mode & 0o777) !== 0o700
      || (uid !== undefined && normalized.uid !== uid)
      || normalized.dev !== opened.dev || normalized.ino !== opened.ino
      || !normalizedPath.isDirectory() || normalizedPath.isSymbolicLink()
      || normalizedPath.dev !== normalized.dev || normalizedPath.ino !== normalized.ino
      || normalizedParent.dev !== beforeParent.dev || normalizedParent.ino !== beforeParent.ino
      || realpathSync(parent) !== canonicalParent || realpathSync(path) !== resolve(path)) {
      throw new Error("Coordination outbox is unavailable");
    }
  } finally {
    closeSync(descriptor);
  }
}

export class CoordinationOutbox {
  readonly directory: string;
  readonly dispositionDirectory: string;
  readonly authorizationDirectory: string;

  constructor(worktree: string, private readonly now: () => number = Date.now) {
    const root = realpathSync(resolve(worktree));
    const opencode = join(root, ".opencode");
    mkdirSync(opencode, { mode: 0o700, recursive: true });
    assertDirectory(opencode);
    const protectedIndex = join(opencode, "protected-runtime-index");
    ensurePrivateDirectory(protectedIndex, opencode);
    this.directory = join(protectedIndex, "coordination-outbox");
    ensurePrivateDirectory(this.directory, protectedIndex);
    this.dispositionDirectory = join(protectedIndex, "coordination-outbox-dispositions");
    this.authorizationDirectory = join(protectedIndex, "coordination-outbox-authorizations");
  }

  private path(key: string): string {
    return join(this.directory, `${key}.json`);
  }

  private exists(path: string): boolean {
    try {
      lstatSync(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  private readPrivateBuffer(path: string): Buffer | undefined {
    let descriptor: number | undefined;
    try {
      const before = lstatSync(path);
      const uid = owner();
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1
        || before.size > COORDINATION_OUTBOX_MAX_RECORD_BYTES || (before.mode & 0o777) !== 0o600
        || (uid !== undefined && before.uid !== uid)) return undefined;
      descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const opened = fstatSync(descriptor);
      const content = readFileSync(descriptor);
      const afterDescriptor = fstatSync(descriptor);
      const afterPath = lstatSync(path);
      if (!opened.isFile() || opened.nlink !== 1 || opened.size !== content.byteLength
        || opened.dev !== before.dev || opened.ino !== before.ino
        || opened.dev !== afterDescriptor.dev || opened.ino !== afterDescriptor.ino
        || opened.size !== afterDescriptor.size || opened.mtimeMs !== afterDescriptor.mtimeMs
        || opened.ctimeMs !== afterDescriptor.ctimeMs || !afterPath.isFile() || afterPath.isSymbolicLink()
        || afterPath.nlink !== 1 || afterPath.dev !== opened.dev || afterPath.ino !== opened.ino
        || afterPath.size !== opened.size || (opened.mode & 0o777) !== 0o600
        || (afterPath.mode & 0o777) !== 0o600 || (uid !== undefined && opened.uid !== uid)
        || (uid !== undefined && afterPath.uid !== uid)) return undefined;
      return content;
    } catch {
      return undefined;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  private readRecordSnapshot(path: string): CoordinationOutboxRecordSnapshot | undefined {
    try {
      const content = this.readPrivateBuffer(path);
      if (!content) return undefined;
      const parsed: unknown = JSON.parse(content.toString("utf8"));
      if (!validRecord(parsed) || this.path(parsed.key) !== path) return undefined;
      const record = parsed.kind === "overflow" || parsed.mutation?.phase === "completion_ambiguous"
        ? { ...parsed, ambiguous: true }
        : parsed;
      return { record, sha256: hash(content) };
    } catch {
      return undefined;
    }
  }

  private read(path: string): CoordinationOutboxRecord | undefined {
    return this.readRecordSnapshot(path)?.record;
  }

  private dispositionPath(key: string, recordSha256?: string): string {
    return join(this.dispositionDirectory, `${key}${recordSha256 ? `.${recordSha256}` : ""}.json`);
  }

  private authorizationPath(key: string): string {
    return join(this.authorizationDirectory, `${key}.json`);
  }

  private readDisposition(
    record: CoordinationOutboxRecord,
    recordSha256: string | undefined,
  ): LegacyCoordinationOutboxDisposition | CoordinationOutboxDisposition | undefined {
    if (record.kind !== "overflow" || !record.ambiguous || !/^0+$/.test(record.sessionHash) || record.mutation !== null) {
      return undefined;
    }
    if (!this.exists(this.dispositionDirectory)) return undefined;
    assertDirectory(this.dispositionDirectory, 0o700);
    const versionedPath = recordSha256 ? this.dispositionPath(record.key, recordSha256) : undefined;
    const path = versionedPath && this.exists(versionedPath) ? versionedPath : this.dispositionPath(record.key);
    if (!this.exists(path)) return undefined;
    try {
      const content = this.readPrivateBuffer(path);
      if (!content || !recordSha256) return undefined;
      const parsed: unknown = JSON.parse(content.toString("utf8"));
      if (validLegacyDisposition(parsed)) {
        return parsed.recordKey === record.key && parsed.operationId === record.operationId
          && parsed.recordSha256 === recordSha256 ? parsed : undefined;
      }
      if (!validDisposition(parsed) || parsed.recordKey !== record.key || parsed.operationId !== record.operationId
        || parsed.recordSha256 !== recordSha256 || parsed.recordCount !== record.count
        || !this.exists(this.authorizationDirectory)) return undefined;
      assertDirectory(this.authorizationDirectory, 0o700);
      const authorizationContent = this.readPrivateBuffer(this.authorizationPath(record.key));
      if (!authorizationContent || hash(authorizationContent) !== parsed.authorizationSha256) return undefined;
      const authorization: unknown = JSON.parse(authorizationContent.toString("utf8"));
      const dispositionTime = Date.parse(parsed.createdAt);
      return validAuthorization(authorization)
        && authorization.recordKey === record.key
        && authorization.authority === parsed.authority
        && Date.parse(authorization.issuedAt) <= dispositionTime
        && dispositionTime < Date.parse(authorization.expiresAt)
        ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  private snapshots(): CoordinationOutboxRecordSnapshot[] {
    assertDirectory(this.directory, 0o700);
    const snapshots: CoordinationOutboxRecordSnapshot[] = [];
    let rejected = 0;
    for (const name of readdirSync(this.directory)) {
      const snapshot = /^[0-9a-f]{64}\.json$/.test(name) ? this.readRecordSnapshot(join(this.directory, name)) : undefined;
      if (snapshot) snapshots.push(snapshot);
      else rejected += 1;
    }
    if (rejected > 0) {
      snapshots.push({
        record: {
          version: 1,
          operationId: hash(`operation\0${FILESYSTEM_SENTINEL_KEY}`),
          key: FILESYSTEM_SENTINEL_KEY,
          kind: "overflow",
          sessionHash: "0".repeat(64),
          createdAt: FILESYSTEM_SENTINEL_CREATED_AT,
          failure: "invalid_response",
          revision: null,
          cursor: null,
          digest: hash(`coordination-outbox-rejected\0${rejected}`),
          ambiguous: true,
          count: rejected,
          mutation: null,
        },
        sha256: undefined,
      });
    }
    return snapshots.sort((left, right) => left.record.createdAt.localeCompare(right.record.createdAt)
      || left.record.operationId.localeCompare(right.record.operationId));
  }

  list(): CoordinationOutboxRecord[] {
    return this.snapshots().map(({ record }) => record);
  }

  unresolved(): CoordinationOutboxRecord[] {
    return this.snapshots().filter(({ record, sha256 }) => this.readDisposition(record, sha256) === undefined)
      .map(({ record }) => record);
  }

  private writeNewPrivateFile(path: string, serialized: string): void {
    let descriptor: number | undefined;
    let completed = false;
    try {
      descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      writeFileSync(descriptor, serialized, "utf8");
      fsyncSync(descriptor);
      completed = true;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      if (!completed) try { unlinkSync(path); } catch {}
    }
    const directory = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }

  prepareIdentitylessOverflowDisposition(
    requestedAuthorization: CoordinationOutboxDispositionAuthorization,
  ): PreparedCoordinationOutboxDisposition {
    const now = this.now();
    if (!validAuthorization(requestedAuthorization, now)
      || requestedAuthorization.recordKey !== COORDINATION_OUTBOX_AUTHORIZED_OVERFLOW_KEY) {
      throw new Error("Invalid coordination outbox authorization");
    }
    ensurePrivateDirectory(this.authorizationDirectory, dirname(this.authorizationDirectory));
    const authorizationPath = this.authorizationPath(requestedAuthorization.recordKey);
    if (!this.exists(authorizationPath)) {
      this.writeNewPrivateFile(authorizationPath, `${JSON.stringify(requestedAuthorization)}\n`);
    }
    const authorizationContent = this.readPrivateBuffer(authorizationPath);
    if (!authorizationContent) throw new Error("Coordination outbox authorization is unavailable");
    let authorization: unknown;
    try { authorization = JSON.parse(authorizationContent.toString("utf8")); } catch {
      throw new Error("Coordination outbox authorization is unavailable");
    }
    if (!validAuthorization(authorization, now)
      || authorization.authorizationId !== requestedAuthorization.authorizationId
      || authorization.recordKey !== requestedAuthorization.recordKey
      || authorization.mode !== requestedAuthorization.mode
      || authorization.authority !== requestedAuthorization.authority
      || authorization.scope !== requestedAuthorization.scope
      || authorization.reason !== requestedAuthorization.reason) {
      throw new Error("Coordination outbox authorization is unavailable");
    }

    const snapshot = this.readRecordSnapshot(this.path(authorization.recordKey));
    const record = snapshot?.record;
    if (!record || !snapshot.sha256 || record.kind !== "overflow" || !record.ambiguous
      || !/^0+$/.test(record.sessionHash) || record.mutation !== null) {
      throw new Error("Coordination outbox record cannot be abandoned");
    }
    const existing = this.readDisposition(record, snapshot.sha256);
    if (existing) {
      if (!validDisposition(existing)) throw new Error("Coordination outbox authorization is unavailable");
      return { disposition: existing, rollback() {} };
    }
    ensurePrivateDirectory(this.dispositionDirectory, dirname(this.dispositionDirectory));
    const dispositionPath = this.dispositionPath(record.key, snapshot.sha256);
    if (this.exists(dispositionPath)) throw new Error("Coordination outbox disposition is unavailable");
    const disposition: CoordinationOutboxDisposition = {
      schemaVersion: 2,
      recordKey: record.key,
      recordSha256: snapshot.sha256,
      recordCount: record.count,
      operationId: record.operationId,
      authorizationSha256: hash(authorizationContent),
      decision: "abandoned",
      authority: authorization.authority,
      reason: authorization.reason,
      createdAt: new Date(now).toISOString(),
    };
    const serialized = `${JSON.stringify(disposition)}\n`;
    this.writeNewPrivateFile(dispositionPath, serialized);
    const retained = this.readDisposition(record, snapshot.sha256);
    if (!retained || !validDisposition(retained)) {
      try { unlinkSync(dispositionPath); } catch {}
      throw new Error("Coordination outbox disposition is unavailable");
    }
    const dispositionSha256 = hash(serialized);
    return {
      disposition: retained,
      rollback: () => {
        const current = this.readPrivateBuffer(dispositionPath);
        if (!current || hash(current) !== dispositionSha256) {
          throw new Error("Coordination outbox disposition changed before rollback");
        }
        unlinkSync(dispositionPath);
        const directory = openSync(this.dispositionDirectory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try { fsyncSync(directory); } finally { closeSync(directory); }
      },
    };
  }

  private atomicWrite(record: CoordinationOutboxRecord): void {
    const serialized = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > COORDINATION_OUTBOX_MAX_RECORD_BYTES) {
      throw new Error("Coordination outbox record is too large");
    }
    const destination = this.path(record.key);
    const temporary = join(this.directory, `.${record.key}.${randomUUID()}.tmp`);
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      writeFileSync(descriptor, serialized, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, destination);
      const directory = openSync(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { fsyncSync(directory); } finally { closeSync(directory); }
    } catch (error) {
      try { unlinkSync(temporary); } catch {}
      throw error;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  private overflow(input: CoordinationOutboxInput): CoordinationOutboxRecord {
    let key = hash("coordination-outbox-overflow");
    let path = this.path(key);
    let existing = this.readRecordSnapshot(path);
    while (existing) {
      if (!this.readDisposition(existing.record, existing.sha256) || !existing.sha256) {
        throw new Error("Coordination outbox is unavailable");
      }
      key = hash(`coordination-outbox-overflow\0${key}\0${existing.sha256}`);
      path = this.path(key);
      existing = this.readRecordSnapshot(path);
    }
    if (!existing && this.exists(path)) throw new Error("Coordination outbox is unavailable");
    const digest = hash(`\0${input.kind}\0${input.failure}\0${input.digest ?? ""}`);
    const record: CoordinationOutboxRecord = {
      version: 1,
      operationId: hash(`operation\0${key}`),
      key,
      kind: "overflow",
      sessionHash: "0".repeat(64),
      createdAt: new Date(this.now()).toISOString(),
      failure: "unavailable",
      revision: null,
      cursor: null,
      digest,
      ambiguous: true,
      count: 1,
      mutation: null,
    };
    this.atomicWrite(record);
    return record;
  }

  put(input: CoordinationOutboxInput): CoordinationOutboxRecord {
    if (!input.exactKey || input.exactKey.length > 1024 || !SESSION_REFERENCE.test(input.sessionHash)
      || !KINDS.has(input.kind) || !FAILURES.has(input.failure)
      || (input.revision !== undefined && !safeInteger(input.revision))
      || (input.cursor !== undefined && !safeInteger(input.cursor))
      || (input.digest !== undefined && !HASH.test(input.digest))
      || (input.mutation !== undefined && !validMutation(input.mutation))) {
      throw new Error("Invalid coordination outbox record");
    }
    const key = hash(input.exactKey);
    const path = this.path(key);
    const prior = this.read(path);
    if (!prior && this.exists(path)) return this.overflow(input);
    const records = this.list().filter((record) => record.key !== FILESYSTEM_SENTINEL_KEY);
    const existingBytes = prior ? statSync(this.path(key)).size : 0;
    const currentBytes = records.reduce((total, record) => total + statSync(this.path(record.key)).size, 0);
    const record: CoordinationOutboxRecord = {
      version: 1,
      operationId: prior?.operationId ?? hash(`operation\0${input.kind}\0${input.exactKey}`),
      key,
      kind: input.kind,
      sessionHash: input.sessionHash,
      createdAt: prior?.createdAt ?? new Date(this.now()).toISOString(),
      failure: input.failure,
      revision: input.revision ?? null,
      cursor: input.cursor ?? null,
      digest: input.digest ?? hash(`${input.kind}\0${input.sessionHash}`),
      ambiguous: input.mutation?.phase === "completion_ambiguous" || (input.ambiguous ?? false),
      count: Math.min(Number.MAX_SAFE_INTEGER, (prior?.count ?? 0) + 1),
      mutation: input.mutation ?? null,
    };
    const bytes = Buffer.byteLength(`${JSON.stringify(record)}\n`, "utf8");
    const normalCount = records.filter((entry) => entry.kind !== "overflow" && entry.key !== key).length;
    if (normalCount >= COORDINATION_OUTBOX_MAX_RECORDS - 1
      || currentBytes - existingBytes + bytes > COORDINATION_OUTBOX_MAX_BYTES - COORDINATION_OUTBOX_MAX_RECORD_BYTES) {
      return this.overflow(input);
    }
    this.atomicWrite(record);
    return record;
  }

  async replay(deliver: (record: CoordinationOutboxRecord) => Promise<boolean>): Promise<void> {
    for (const record of this.unresolved()) {
      if (record.key === FILESYSTEM_SENTINEL_KEY) continue;
      if (!(await deliver(record).catch(() => false))) continue;
      unlinkSync(this.path(record.key));
      const directory = openSync(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  }
}
