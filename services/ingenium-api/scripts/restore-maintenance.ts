import Database from "better-sqlite3";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fchmodSync,
  fchownSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import type { Dirent, Stats } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  backups,
  closeDbForMaintenance,
  getDb,
  projects,
} from "ingenium-core";

const PROGRAM = "restore-maintenance";
const JOURNAL_FILE = "journal.json";
const LOCK_FILE = "lock";
const ARCHIVE_DIR = "archive";
const CANONICAL_INGENIUM_DB = "/app/.ingenium/data";
const CANONICAL_OPENCODE_DB = "/home/appuser/.local/share/opencode/opencode.db";
const CANONICAL_MAINTENANCE_ROOT = "/app/.ingenium/restore-maintenance";
const CANONICAL_JOURNAL_KEY = "/app/.ingenium/restore-journal-key";
const CANONICAL_BACKUPS = "/app/.ingenium/backups";
const CANONICAL_STAGING = "/app/.ingenium/restore-staging";
const CANONICAL_SIGNING_KEY = "/app/.ingenium/backup-signing-key";
const PHASES = new Set([
  "claimed", "quiescing", "snapshotting", "swapping", "buffers_written", "ingenium_rollback", "ingenium_installed",
  "opencode_rollback", "opencode_installed", "pair_committed", "rehydrated", "restarting", "completed",
  "rolling_back", "rolled_back", "rollback_failed",
]);
const USER_PROGRAMS = ["ttyd-opencode", "vscode", "opencode-web", "ingenium-api"] as const;
const RESTART_PROGRAMS = ["ingenium-api", "opencode-web", "ttyd-opencode", "vscode"] as const;

type Phase = "claimed" | "quiescing" | "snapshotting" | "swapping" | "buffers_written" | "ingenium_rollback" | "ingenium_installed"
  | "opencode_rollback" | "opencode_installed" | "pair_committed" | "rehydrated" | "restarting" | "completed"
  | "rolling_back" | "rolled_back" | "rollback_failed";
type MaintenanceCode = "DEADLINE_EXCEEDED" | "HOLDER_REFUSED" | "SAFETY_SNAPSHOT_FAILED" | "BUFFER_WRITE_FAILED"
  | "SWAP_FAILED" | "VERIFY_FAILED" | "HEALTH_FAILED" | "ROLLBACK_FAILED" | "JOURNAL_INVALID" | "SUPERVISOR_FAILED" | "EXECUTOR_SETUP_FAILED";
type Journal = {
  version: 1;
  runId: string;
  phase: Phase;
  capsule: backups.RestoreExecutionCapsule;
  targets: TargetMetadata;
  hmac: string;
};

type TargetPaths = { ingenium: string; opencode: string };
type FileMetadata = { uid: number; gid: number; mode: number; dev: number; ino: number; nlink?: number };
type TargetMetadata = {
  files: Record<keyof TargetPaths, FileMetadata>;
  parents: Record<keyof TargetPaths, FileMetadata>;
  sidecars: Record<"ingenium-wal" | "ingenium-shm" | "opencode-wal" | "opencode-shm", FileMetadata | null>;
};
type TargetParent = { fd: number; metadata: FileMetadata };
type TargetParents = Record<keyof TargetPaths, TargetParent>;
type LockedTarget = { fd: number; metadata: FileMetadata; path: string };
type LockedTargets = LockedTarget[];

let loadedJournalKey: Buffer | null = null;
let trustedCorePathsConfigured = false;

function wipeJournalKey(): void {
  loadedJournalKey?.fill(0);
  loadedJournalKey = null;
}

class MaintenanceError extends Error {
  constructor(readonly code: MaintenanceCode) {
    super(code);
  }
}

function maintenanceCode(error: unknown): MaintenanceCode {
  if (error instanceof MaintenanceError) return error.code;
  if (error instanceof backups.BackupError && error.code === "RESTORE_EXECUTION_DEADLINE_EXCEEDED") {
    return "DEADLINE_EXCEEDED";
  }
  return "SWAP_FAILED";
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

function sha256File(path: string): string {
  const fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const digest = createHash("sha256");
    const bytes = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const count = readSync(fd, bytes, 0, bytes.length, null);
      if (count === 0) return digest.digest("hex");
      digest.update(bytes.subarray(0, count));
    }
  } finally {
    closeSync(fd);
  }
}

function fixtureRoot(): string | null {
  const value = process.env.INGENIUM_RESTORE_TEST_ROOT;
  if (!value) return null;
  const root = resolve(value);
  if (process.env.NODE_ENV !== "test" || dirname(root) !== "/tmp" || !/^ingenium-restore-fixture-[A-Za-z0-9_-]+$/.test(basename(root))) {
    throw new MaintenanceError("JOURNAL_INVALID");
  }
  return root;
}

function targetPaths(): TargetPaths {
  const root = fixtureRoot();
  if (root) return { ingenium: `${root}/data`, opencode: `${root}/opencode.db` };
  // The static root program never trusts caller-controlled database locations.
  if (!trustedCorePathsConfigured && (process.env.INGENIUM_CORE_DB_PATH || process.env.OPENCODE_DB_PATH || process.env.INGENIUM_RESTORE_MAINTENANCE_DIR)) {
    throw new MaintenanceError("JOURNAL_INVALID");
  }
  return { ingenium: CANONICAL_INGENIUM_DB, opencode: CANONICAL_OPENCODE_DB };
}

function configureTrustedCorePaths(paths: TargetPaths): void {
  const root = fixtureRoot();
  process.env.INGENIUM_CORE_DB_PATH = paths.ingenium;
  process.env.OPENCODE_DB_PATH = paths.opencode;
  process.env.INGENIUM_BACKUPS_DIR = root ? `${root}/backups` : CANONICAL_BACKUPS;
  process.env.INGENIUM_RESTORE_STAGING_DIR = root ? `${root}/restore-staging` : CANONICAL_STAGING;
  process.env.INGENIUM_BACKUP_SIGNING_KEY_FILE = root ? `${root}/backup-signing-key` : CANONICAL_SIGNING_KEY;
  process.env.INGENIUM_RESTORE_JOURNAL_KEY_FILE = root ? `${root}/restore-journal-key` : CANONICAL_JOURNAL_KEY;
  trustedCorePathsConfigured = true;
}

function expectedUid(): number {
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  if (!fixtureRoot() && uid !== 0) throw new MaintenanceError("JOURNAL_INVALID");
  return fixtureRoot() ? uid : 0;
}

function maintenanceRoot(): string {
  const root = fixtureRoot() ? `${fixtureRoot()}/maintenance` : CANONICAL_MAINTENANCE_ROOT;
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || stat.uid !== expectedUid()) {
    throw new MaintenanceError("JOURNAL_INVALID");
  }
  return root;
}

function safeChild(root: string, name: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new MaintenanceError("JOURNAL_INVALID");
  const path = resolve(root, name);
  if (dirname(path) !== root) throw new MaintenanceError("JOURNAL_INVALID");
  return path;
}

function fsyncDirectory(path: string): void {
  const fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function sameMetadata(left: FileMetadata, right: ReturnType<typeof fstatSync>): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameTargetMetadata(left: FileMetadata, right: ReturnType<typeof fstatSync>): boolean {
  return sameMetadata(left, right) && left.nlink === right.nlink;
}

function boundChild(parent: TargetParent, name: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new MaintenanceError("SWAP_FAILED");
  return `/proc/self/fd/${parent.fd}/${name}`;
}

function assertTargetParent(parent: TargetParent): void {
  const stat = fstatSync(parent.fd);
  if (!stat.isDirectory() || !sameMetadata(parent.metadata, stat)) throw new MaintenanceError("SWAP_FAILED");
}

function fsyncTargetParent(parent: TargetParent): void {
  assertTargetParent(parent);
  fsyncSync(parent.fd);
}

function writeAll(fd: number, bytes: Buffer): void {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset);
    if (written <= 0) throw new MaintenanceError("BUFFER_WRITE_FAILED");
    offset += written;
  }
}

function atomicWrite(root: string, name: string, text: string): void {
  const destination = safeChild(root, name);
  const temporary = safeChild(root, `.${name}.${randomBytes(8).toString("hex")}`);
  const fd = openSync(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
  try {
    writeAll(fd, Buffer.from(text, "utf8"));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, destination);
  fsyncDirectory(root);
}

function journalPayload(journal: Omit<Journal, "hmac">): string {
  return canonicalJson(journal);
}

function journalKey(): Buffer {
  if (loadedJournalKey) return loadedJournalKey;
  const path = process.env.INGENIUM_RESTORE_JOURNAL_KEY_FILE!;
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.uid !== expectedUid()
    || (before.mode & 0o777) !== 0o600 || before.size < 32 || before.size > 4_096) {
    throw new MaintenanceError("JOURNAL_INVALID");
  }
  const fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const after = fstatSync(fd);
    if (after.dev !== before.dev || after.ino !== before.ino || after.uid !== before.uid || after.nlink !== 1
      || (after.mode & 0o777) !== 0o600 || after.size !== before.size) {
      throw new MaintenanceError("JOURNAL_INVALID");
    }
    const bytes = Buffer.allocUnsafe(after.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count <= 0) throw new MaintenanceError("JOURNAL_INVALID");
      offset += count;
    }
    loadedJournalKey = bytes;
    return bytes;
  } finally {
    closeSync(fd);
  }
}

function signJournal(payload: string): string {
  return createHmac("sha256", journalKey()).update(payload, "utf8").digest("hex");
}

function writeJournal(root: string, runId: string, phase: Phase, capsule: backups.RestoreExecutionCapsule, targets: TargetMetadata): void {
  const unsigned = { version: 1 as const, runId, phase, capsule, targets };
  const journal: Journal = { ...unsigned, hmac: signJournal(journalPayload(unsigned)) };
  atomicWrite(root, JOURNAL_FILE, canonicalJson(journal));
}

function readJournal(root: string): Journal | null {
  const path = safeChild(root, JOURNAL_FILE);
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== expectedUid() || (stat.mode & 0o777) !== 0o600) throw new MaintenanceError("JOURNAL_INVALID");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new MaintenanceError("JOURNAL_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new MaintenanceError("JOURNAL_INVALID");
  const journal = parsed as Partial<Journal>;
  if (journal.version !== 1 || typeof journal.runId !== "string" || !/^[0-9a-f-]{36}$/i.test(journal.runId)
    || typeof journal.phase !== "string" || !PHASES.has(journal.phase) || !journal.capsule || !journal.targets
    || typeof journal.hmac !== "string" || !/^[0-9a-f]{64}$/.test(journal.hmac)) {
    throw new MaintenanceError("JOURNAL_INVALID");
  }
  const payload = journalPayload({ version: 1, runId: journal.runId, phase: journal.phase as Phase, capsule: journal.capsule, targets: journal.targets });
  const expected = signJournal(payload);
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(journal.hmac, "hex"))) {
    throw new MaintenanceError("JOURNAL_INVALID");
  }
  return journal as Journal;
}

function acquireLock(root: string, runId: string): () => void {
  const path = safeChild(root, LOCK_FILE);
  const fd = openSync(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
  try {
    writeAll(fd, Buffer.from(`${runId}\n`, "utf8"));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  fsyncDirectory(root);
  return () => {
    if (existsSync(path)) unlinkSync(path);
    fsyncDirectory(root);
  };
}

function readLock(root: string): string | null {
  const path = safeChild(root, LOCK_FILE);
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== expectedUid() || (stat.mode & 0o777) !== 0o600 || stat.size !== 37) {
    throw new MaintenanceError("JOURNAL_INVALID");
  }
  const fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) throw new MaintenanceError("JOURNAL_INVALID");
    const bytes = Buffer.allocUnsafe(stat.size);
    if (readSync(fd, bytes, 0, bytes.length, 0) !== bytes.length) throw new MaintenanceError("JOURNAL_INVALID");
    const runId = bytes.toString("utf8");
    if (!/^[0-9a-f-]{36}\n$/i.test(runId)) throw new MaintenanceError("JOURNAL_INVALID");
    return runId.trim();
  } finally {
    closeSync(fd);
  }
}

function archiveJournal(root: string, journal: Journal): void {
  const archiveRoot = safeChild(root, ARCHIVE_DIR);
  if (!existsSync(archiveRoot)) {
    mkdirSync(archiveRoot, { mode: 0o700 });
    chmodSync(archiveRoot, 0o700);
  }
  const archiveStat = lstatSync(archiveRoot);
  if (!archiveStat.isDirectory() || archiveStat.isSymbolicLink() || archiveStat.uid !== expectedUid() || (archiveStat.mode & 0o777) !== 0o700) {
    throw new MaintenanceError("JOURNAL_INVALID");
  }
  const active = safeChild(root, JOURNAL_FILE);
  if (existsSync(active)) {
    const destination = safeChild(archiveRoot, `${journal.runId}.${Date.now()}.json`);
    renameSync(active, destination);
    fsyncDirectory(archiveRoot);
    fsyncDirectory(root);
  }
  const lock = safeChild(root, LOCK_FILE);
  if (existsSync(lock)) unlinkSync(lock);
  fsyncDirectory(root);
}

function bufferPath(root: string, runId: string, component: "ingenium" | "opencode"): string {
  return safeChild(root, `${runId}.${component}.buffer`);
}

function writeBuffer(root: string, runId: string, component: "ingenium" | "opencode", bytes: Buffer, expectedHash: string): string {
  const path = bufferPath(root, runId, component);
  const fd = openSync(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
  try {
    writeAll(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (sha256File(path) !== expectedHash) throw new MaintenanceError("BUFFER_WRITE_FAILED");
  fsyncDirectory(root);
  return path;
}

function zeroAndUnlink(root: string, path: string): void {
  if (!existsSync(path)) return;
  if (dirname(path) !== root || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new MaintenanceError("JOURNAL_INVALID");
  const fd = openSync(path, fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW);
  try {
    const size = fstatSync(fd).size;
    const zeros = Buffer.alloc(Math.min(64 * 1024, Math.max(size, 1)));
    for (let offset = 0; offset < size; offset += zeros.length) {
      const count = Math.min(zeros.length, size - offset);
      let written = 0;
      while (written < count) written += writeSync(fd, zeros, written, count - written, offset + written);
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  unlinkSync(path);
  fsyncDirectory(root);
}

function sibling(path: string, runId: string, suffix: "new" | "rollback" | "failed"): string {
  const name = `.${basename(path)}.restore-${runId}.${suffix}`;
  const result = resolve(dirname(path), name);
  if (dirname(result) !== dirname(path)) throw new MaintenanceError("JOURNAL_INVALID");
  return result;
}

function copyVerified(source: string, destination: string, expectedHash: string): void {
  const from = openSync(source, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  const to = openSync(destination, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const count = readSync(from, buffer, 0, buffer.length, null);
      if (count === 0) break;
      let written = 0;
      while (written < count) written += writeSync(to, buffer, written, count - written);
    }
    fsyncSync(to);
  } finally {
    closeSync(to);
    closeSync(from);
  }
  if (sha256File(destination) !== expectedHash) throw new MaintenanceError("BUFFER_WRITE_FAILED");
}

function removeSidecars(parent: TargetParent, path: string): void {
  for (const suffix of ["-wal", "-shm"]) {
    const candidate = boundChild(parent, `${basename(path)}${suffix}`);
    if (!existsSync(candidate)) continue;
    const stat = lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new MaintenanceError("SWAP_FAILED");
    unlinkSync(candidate);
  }
  fsyncTargetParent(parent);
}

function captureTargetMetadata(paths: TargetPaths): TargetMetadata {
  const files = {} as TargetMetadata["files"];
  const parents = {} as TargetMetadata["parents"];
  const sidecars = {} as TargetMetadata["sidecars"];
  for (const component of ["ingenium", "opencode"] as const) {
    const file = lstatSync(paths[component]);
    const parent = lstatSync(dirname(paths[component]));
    if (!file.isFile() || file.isSymbolicLink() || file.nlink < 1 || !parent.isDirectory() || parent.isSymbolicLink()) {
      throw new MaintenanceError("SWAP_FAILED");
    }
    files[component] = { uid: file.uid, gid: file.gid, mode: file.mode & 0o777, dev: file.dev, ino: file.ino, nlink: file.nlink };
    parents[component] = { uid: parent.uid, gid: parent.gid, mode: parent.mode & 0o777, dev: parent.dev, ino: parent.ino };
    for (const suffix of ["-wal", "-shm"] as const) {
      const name = `${component}${suffix}` as keyof TargetMetadata["sidecars"];
      const sidecarPath = `${paths[component]}${suffix}`;
      if (!existsSync(sidecarPath)) {
        sidecars[name] = null;
        continue;
      }
      const sidecar = lstatSync(sidecarPath);
      if (!sidecar.isFile() || sidecar.isSymbolicLink() || sidecar.nlink < 1) throw new MaintenanceError("SWAP_FAILED");
      sidecars[name] = { uid: sidecar.uid, gid: sidecar.gid, mode: sidecar.mode & 0o777, dev: sidecar.dev, ino: sidecar.ino, nlink: sidecar.nlink };
    }
  }
  return { files, parents, sidecars };
}

function lockTargetParents(paths: TargetPaths, metadata: TargetMetadata): TargetParents {
  const parents = {} as TargetParents;
  try {
    for (const component of ["ingenium", "opencode"] as const) {
      const fd = openSync(dirname(paths[component]), fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
      const original = metadata.parents[component];
      const current = fstatSync(fd);
      if (!current.isDirectory() || !sameMetadata(original, current)) {
        closeSync(fd);
        throw new MaintenanceError("SWAP_FAILED");
      }
      parents[component] = { fd, metadata: original };
      if (!fixtureRoot()) {
        fchownSync(fd, 0, 0);
        fchmodSync(fd, 0o700);
        const locked = fstatSync(fd);
        if (locked.uid !== 0 || locked.gid !== 0 || (locked.mode & 0o777) !== 0o700) throw new MaintenanceError("SWAP_FAILED");
      }
    }
    return parents;
  } catch (error) {
    for (const parent of Object.values(parents).reverse()) {
      try {
        fchownSync(parent.fd, parent.metadata.uid, parent.metadata.gid);
        fchmodSync(parent.fd, parent.metadata.mode);
        const restored = fstatSync(parent.fd);
        if (restored.uid !== parent.metadata.uid || restored.gid !== parent.metadata.gid || (restored.mode & 0o777) !== parent.metadata.mode) {
          throw new MaintenanceError("SWAP_FAILED");
        }
      } finally {
        closeSync(parent.fd);
      }
    }
    throw error;
  }
}

function closeTargetParents(parents: TargetParents | null): void {
  if (!parents) return;
  for (const parent of Object.values(parents)) closeSync(parent.fd);
}

function lockTargetFile(parent: TargetParent, path: string, metadata: FileMetadata): LockedTarget {
  assertTargetParent(parent);
  const fd = openSync(boundChild(parent, basename(path)), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || !sameTargetMetadata(metadata, stat)) throw new MaintenanceError("SWAP_FAILED");
    fchmodSync(fd, 0o000);
    if ((fstatSync(fd).mode & 0o777) !== 0o000) throw new MaintenanceError("SWAP_FAILED");
    return { fd, metadata, path };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function lockTargetFiles(parents: TargetParents, paths: TargetPaths, metadata: TargetMetadata): LockedTargets {
  const locked: LockedTargets = [];
  try {
    for (const component of ["ingenium", "opencode"] as const) {
      locked.push(lockTargetFile(parents[component], paths[component], metadata.files[component]));
      for (const suffix of ["-wal", "-shm"] as const) {
        const sidecar = metadata.sidecars[`${component}${suffix}` as keyof TargetMetadata["sidecars"]];
        const sidecarPath = `${paths[component]}${suffix}`;
        if (sidecar && existsSync(boundChild(parents[component], basename(sidecarPath)))) {
          locked.push(lockTargetFile(parents[component], sidecarPath, sidecar));
        }
      }
    }
    return locked;
  } catch (error) {
    restoreLockedTargetMetadata(locked);
    closeLockedTargets(locked);
    throw error;
  }
}

function restoreLockedTargetMetadata(locked: LockedTargets): void {
  for (const target of [...locked].reverse()) {
    const stat = fstatSync(target.fd);
    const removedSidecar = /-(?:wal|shm)$/.test(target.path) && stat.nlink === 0;
    if (!stat.isFile() || !sameMetadata(target.metadata, stat) || (!removedSidecar && !sameTargetMetadata(target.metadata, stat))) {
      throw new MaintenanceError("SWAP_FAILED");
    }
    if (stat.uid !== target.metadata.uid || stat.gid !== target.metadata.gid) fchownSync(target.fd, target.metadata.uid, target.metadata.gid);
    fchmodSync(target.fd, target.metadata.mode);
    const restored = fstatSync(target.fd);
    if (restored.uid !== target.metadata.uid || restored.gid !== target.metadata.gid || (restored.mode & 0o777) !== target.metadata.mode) {
      throw new MaintenanceError("SWAP_FAILED");
    }
  }
}

function closeLockedTargets(locked: LockedTargets | null): void {
  if (!locked) return;
  for (const target of [...locked].reverse()) closeSync(target.fd);
}

function restoreAndCloseLockedTargets(locked: LockedTargets | null): null {
  if (!locked) return null;
  try {
    restoreLockedTargetMetadata(locked);
  } finally {
    closeLockedTargets(locked);
  }
  return null;
}

function requireLockedTarget(locked: LockedTargets, path: string): LockedTarget {
  const target = locked.find((candidate) => candidate.path === path);
  if (!target || !sameTargetMetadata(target.metadata, fstatSync(target.fd))) throw new MaintenanceError("SWAP_FAILED");
  return target;
}

function restoreTargetMetadata(parents: TargetParents, paths: TargetPaths, metadata: TargetMetadata): void {
  for (const component of ["ingenium", "opencode"] as const) {
    const parent = parents[component];
    assertTargetParent(parent);
    const fd = openSync(boundChild(parent, basename(paths[component])), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const file = fstatSync(fd);
      if (!file.isFile()) throw new MaintenanceError("SWAP_FAILED");
      const fileMetadata = metadata.files[component];
      if (file.uid !== fileMetadata.uid || file.gid !== fileMetadata.gid) fchownSync(fd, fileMetadata.uid, fileMetadata.gid);
      fchmodSync(fd, fileMetadata.mode);
    } finally {
      closeSync(fd);
    }
    for (const suffix of ["-wal", "-shm"] as const) {
      const sidecarMetadata = metadata.sidecars[`${component}${suffix}` as keyof TargetMetadata["sidecars"]];
      if (!sidecarMetadata) continue;
      const sidecarPath = boundChild(parent, `${basename(paths[component])}${suffix}`);
      if (!existsSync(sidecarPath)) continue;
        const sidecarFd = openSync(sidecarPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        try {
          const sidecar = fstatSync(sidecarFd);
        if (!sidecar.isFile() || !sameTargetMetadata(sidecarMetadata, sidecar)) continue;
        if (sidecar.uid !== sidecarMetadata.uid || sidecar.gid !== sidecarMetadata.gid) fchownSync(sidecarFd, sidecarMetadata.uid, sidecarMetadata.gid);
        fchmodSync(sidecarFd, sidecarMetadata.mode);
      } finally {
        closeSync(sidecarFd);
      }
    }
  }
  for (const component of ["ingenium", "opencode"] as const) {
    const parent = parents[component];
    const parentMetadata = metadata.parents[component];
    const current = fstatSync(parent.fd);
    if (current.uid !== parentMetadata.uid || current.gid !== parentMetadata.gid) fchownSync(parent.fd, parentMetadata.uid, parentMetadata.gid);
    fchmodSync(parent.fd, parentMetadata.mode);
  }
}

function ensureRuntimeSidecars(parents: TargetParents, paths: TargetPaths, metadata: TargetMetadata): void {
  for (const component of ["ingenium", "opencode"] as const) {
    const parent = parents[component];
    const file = metadata.files[component];
    for (const suffix of ["-wal", "-shm"] as const) {
      const path = boundChild(parent, `${basename(paths[component])}${suffix}`);
      if (existsSync(path)) {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new MaintenanceError("SWAP_FAILED");
        continue;
      }
      const fd = openSync(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, file.mode);
      try {
        fchownSync(fd, file.uid, file.gid);
        fchmodSync(fd, file.mode);
      } finally {
        closeSync(fd);
      }
    }
    fsyncTargetParent(parent);
  }
}

function installComponent(parent: TargetParent, locked: LockedTarget, path: string, source: string, expectedHash: string, runId: string): void {
  const current = boundChild(parent, basename(path));
  const next = boundChild(parent, basename(sibling(path, runId, "new")));
  const rollback = boundChild(parent, basename(sibling(path, runId, "rollback")));
  assertTargetParent(parent);
  if (!sameTargetMetadata(locked.metadata, fstatSync(locked.fd))) throw new MaintenanceError("SWAP_FAILED");
  if (existsSync(next) || existsSync(rollback)) throw new MaintenanceError("SWAP_FAILED");
  copyVerified(source, next, expectedHash);
  const original = lstatSync(current);
  if (!original.isFile() || original.isSymbolicLink()) throw new MaintenanceError("SWAP_FAILED");
  assertTargetParent(parent);
  renameSync(current, rollback);
  fsyncTargetParent(parent);
  assertTargetParent(parent);
  renameSync(next, current);
  fsyncTargetParent(parent);
}

function rollbackComponent(parent: TargetParent, path: string, runId: string): void {
  const current = boundChild(parent, basename(path));
  const rollback = boundChild(parent, basename(sibling(path, runId, "rollback")));
  if (!existsSync(rollback)) return;
  const failed = boundChild(parent, basename(sibling(path, runId, "failed")));
  if (existsSync(failed)) throw new MaintenanceError("ROLLBACK_FAILED");
  assertTargetParent(parent);
  if (existsSync(current)) renameSync(current, failed);
  assertTargetParent(parent);
  renameSync(rollback, current);
  fsyncTargetParent(parent);
}

function removeTransientPair(parents: TargetParents, paths: TargetPaths, root: string, runId: string): void {
  for (const component of ["ingenium", "opencode"] as const) {
    const path = paths[component];
    const parent = parents[component];
    for (const suffix of ["rollback", "failed", "new"] as const) {
      const candidate = boundChild(parent, basename(sibling(path, runId, suffix)));
      if (existsSync(candidate)) unlinkSync(candidate);
    }
    fsyncTargetParent(parent);
    zeroAndUnlink(root, bufferPath(root, runId, component));
  }
}

async function supervisor(method: "startProcess" | "stopProcess" | "getProcessInfo", program: string): Promise<string> {
  if (![...USER_PROGRAMS, "restore-maintenance"].includes(program as typeof USER_PROGRAMS[number])) {
    throw new MaintenanceError("SUPERVISOR_FAILED");
  }
  const response = await fetch("http://127.0.0.1:9001/RPC2", {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: `<?xml version="1.0"?><methodCall><methodName>supervisor.${method}</methodName><params><param><value><string>${program}</string></value></param>${method === "getProcessInfo" ? "" : "<param><value><boolean>0</boolean></value></param>"}</params></methodCall>`,
    signal: AbortSignal.timeout(5_000),
  });
  const xml = await response.text();
  if (!response.ok || xml.includes("<fault>")) throw new MaintenanceError("SUPERVISOR_FAILED");
  return xml;
}

async function waitStopped(program: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const xml = await supervisor("getProcessInfo", program);
    if (xml.includes("<string>STOPPED</string>") || xml.includes("<string>EXITED</string>")) return;
    await new Promise<void>((done) => setTimeout(done, 200));
  }
  throw new MaintenanceError("SUPERVISOR_FAILED");
}

async function stopDbUsers(): Promise<void> {
  for (const program of USER_PROGRAMS) {
    const current = await supervisor("getProcessInfo", program);
    if (current.includes("<string>RUNNING</string>") || current.includes("<string>STARTING</string>")) {
      await supervisor("stopProcess", program);
    }
    await waitStopped(program);
  }
}

type ProcInspector = {
  entries(): Dirent[];
  descriptors(pid: string): string[];
  statDescriptor(pid: string, descriptor: string): Stats;
};

function procInspector(): ProcInspector {
  const fixture = fixtureRoot();
  const configuredRoot = process.env.INGENIUM_RESTORE_TEST_PROC_ROOT;
  const root = configuredRoot ?? "/proc";
  const fault = process.env.INGENIUM_RESTORE_TEST_PROC_FAULT;
  if (!fixture && (configuredRoot || fault)) throw new MaintenanceError("JOURNAL_INVALID");
  if (fixture && configuredRoot && (resolve(configuredRoot) === "/proc" || !resolve(configuredRoot).startsWith(`${fixture}/`))) {
    throw new MaintenanceError("JOURNAL_INVALID");
  }
  if (fault && fault !== "fd-dir" && fault !== "fd") throw new MaintenanceError("JOURNAL_INVALID");
  const denied = (): never => {
    const error = new Error("proc inspection denied") as NodeJS.ErrnoException;
    error.code = "EACCES";
    throw error;
  };
  return {
    entries: () => readdirSync(root, { withFileTypes: true }),
    descriptors: (pid) => fault === "fd-dir" ? denied() : readdirSync(`${root}/${pid}/fd`),
    statDescriptor: (pid, descriptor) => fault === "fd" ? denied() : statSync(`${root}/${pid}/fd/${descriptor}`),
  };
}

async function waitForTargetLockProbe(): Promise<void> {
  const fixture = fixtureRoot();
  const enabled = process.env.INGENIUM_RESTORE_TEST_TARGET_LOCK_PROBE;
  if (!enabled) return;
  if (!fixture || enabled !== "1") throw new MaintenanceError("JOURNAL_INVALID");
  const ready = safeChild(fixture, "target-lock.ready");
  const result = safeChild(fixture, "target-lock.result");
  if (existsSync(ready) || existsSync(result)) throw new MaintenanceError("JOURNAL_INVALID");
  writeFileSync(ready, "locked\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
  const deadline = Date.now() + 5_000;
  while (!existsSync(result) && Date.now() < deadline) await new Promise<void>((done) => setTimeout(done, 10));
  if (!existsSync(result) || readFileSync(result, "utf8").trim() !== "EACCES") throw new MaintenanceError("SWAP_FAILED");
  unlinkSync(ready);
  unlinkSync(result);
}

function scanOpenHolders(paths: TargetPaths): void {
  // Compare opened descriptors by device/inode, not a printable /proc symlink:
  // deleted files, hard links, and aliases must block a destructive swap too.
  const identities = new Set<string>();
  for (const path of [paths.ingenium, paths.opencode, `${paths.ingenium}-wal`, `${paths.ingenium}-shm`, `${paths.opencode}-wal`, `${paths.opencode}-shm`]) {
    if (!existsSync(path)) continue;
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new MaintenanceError("HOLDER_REFUSED");
    identities.add(`${stat.dev}:${stat.ino}`);
  }
  const inspector = procInspector();
  const procEntries = inspector.entries();
  for (const entry of procEntries) {
    if (!entry.isDirectory() || !/^[0-9]+$/.test(entry.name)) continue;
    // The fixed root executor owns its descriptors and closes them before the
    // swap; a stale self descriptor is not an external holder.
    if (entry.name === String(process.pid)) continue;
    let descriptors: string[];
    try {
      descriptors = inspector.descriptors(entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new MaintenanceError("HOLDER_REFUSED");
    }
    for (const descriptor of descriptors) {
      try {
        const opened = inspector.statDescriptor(entry.name, descriptor);
        if (identities.has(`${opened.dev}:${opened.ino}`)) throw new MaintenanceError("HOLDER_REFUSED");
      } catch (error) {
        if (error instanceof MaintenanceError) throw error;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new MaintenanceError("HOLDER_REFUSED");
      }
    }
  }
}

function checkDatabases(paths: ReturnType<typeof targetPaths>, parents: TargetParents): void {
  const core = getDb(boundChild(parents.ingenium, basename(paths.ingenium)));
  core.pragma("wal_checkpoint(TRUNCATE)");
  if (core.pragma("integrity_check", { simple: true }) !== "ok" || (core.pragma("foreign_key_check") as unknown[]).length > 0) {
    throw new MaintenanceError("VERIFY_FAILED");
  }
  const opencode = new Database(boundChild(parents.opencode, basename(paths.opencode)), { readonly: true, fileMustExist: true });
  try {
    if (opencode.pragma("integrity_check", { simple: true }) !== "ok" || (opencode.pragma("foreign_key_check") as unknown[]).length > 0) {
      throw new MaintenanceError("VERIFY_FAILED");
    }
  } finally {
    opencode.close();
  }
}

async function startRestoredUsers(): Promise<void> {
  for (const program of RESTART_PROGRAMS) await supervisor("startProcess", program);
  const port = process.env.INGENIUM_API_PORT ?? "4096";
  const tokenPath = process.env.INGENIUM_API_TOKEN_FILE;
  if (!tokenPath) throw new MaintenanceError("HEALTH_FAILED");
  const token = readFileSync(tokenPath, "utf8").trim();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
    headers: { Authorization: `Bearer ${token}`, "X-Ingenium-Internal-Service": "1" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new MaintenanceError("HEALTH_FAILED");
  for (const program of RESTART_PROGRAMS.slice(1)) {
    const xml = await supervisor("getProcessInfo", program);
    if (!xml.includes("<string>RUNNING</string>")) throw new MaintenanceError("HEALTH_FAILED");
  }
}

function safeTransition(
  projectId: string,
  run: backups.RestoreExecutionRun,
  owner: string,
  fence: string,
  toState: "quiescing" | "snapshotting" | "swapping" | "verifying" | "restarting" | "completed" | "rolling_back" | "rolled_back" | "rollback_failed",
  options?: { safetyBackupId?: string; errorCode?: MaintenanceCode },
): backups.RestoreExecutionRun {
  return backups.transitionRestoreExecution(projectId, run.id, owner, fence, run.revision, toState, options);
}

async function execute(): Promise<void> {
  const paths = targetPaths();
  configureTrustedCorePaths(paths);
  const root = maintenanceRoot();
  if (readJournal(root) || readLock(root)) throw new MaintenanceError("JOURNAL_INVALID");
  let handoff: backups.ValidatedReadyRestoreStage | null = null;
  let journal: Journal | null = null;
  let releaseLock: (() => void) | null = null;
  let parents: TargetParents | null = null;
  let lockedTargets: LockedTargets | null = null;
  let swapStarted = false;
  let targets: TargetMetadata | null = null;
  let owner = "";
  let fence = "";
  let run: backups.RestoreExecutionRun | null = null;
  const global = projects.getGlobalProject();
  try {
    if (!global) return;
    const queued = backups.listQueuedRestoreExecutions(global.id)[0];
    if (!queued) return;
    releaseLock = acquireLock(root, queued.id);
    owner = randomBytes(32).toString("base64url");
    fence = randomBytes(32).toString("base64url");
    run = backups.claimPendingRestoreExecution(global.id, owner, fence, queued.id);
    if (!run) return;
    targets = captureTargetMetadata(paths);
    if (!targets) throw new MaintenanceError("SWAP_FAILED");
    let capsule = backups.captureRestoreExecutionCapsule(global.id, run.id);
    writeJournal(root, run.id, "claimed", capsule, targets);
    journal = readJournal(root);
    handoff = backups.getExecutionRestoreStage(global.id, run.id, owner, fence);
    run = safeTransition(global.id, run, owner, fence, "quiescing");
    writeJournal(root, run.id, "quiescing", capsule, targets);
    await stopDbUsers();
    closeDbForMaintenance();
    scanOpenHolders(paths);
    parents = lockTargetParents(paths, targets);
    run = safeTransition(global.id, run, owner, fence, "snapshotting");
    writeJournal(root, run.id, "snapshotting", capsule, targets);
    checkDatabases(paths, parents);
    backups.recordRestoreExecutionHashes(global.id, run.id, owner, fence, "pre", {
      ingenium: sha256File(paths.ingenium), opencode: sha256File(paths.opencode),
    });
    let safety: { backupId: string };
    try {
      safety = await backups.createSnapshot(
        global.id,
        "pre_restore",
        paths.ingenium,
        paths.opencode,
        backups.trustedArtifactPolicy(),
      );
    } catch {
      throw new MaintenanceError("SAFETY_SNAPSHOT_FAILED");
    }
    run = safeTransition(global.id, run, owner, fence, "swapping", { safetyBackupId: safety.backupId });
    capsule = backups.captureRestoreExecutionCapsule(global.id, run.id);
    writeJournal(root, run.id, "swapping", capsule, targets);
    closeDbForMaintenance();
    lockedTargets = lockTargetFiles(parents, paths, targets);
    if (!lockedTargets) throw new MaintenanceError("SWAP_FAILED");
    await waitForTargetLockProbe();
    scanOpenHolders(paths);
    writeBuffer(root, run.id, "ingenium", handoff.ingenium.bytes, handoff.ingenium.sha256);
    writeBuffer(root, run.id, "opencode", handoff.opencode.bytes, handoff.opencode.sha256);
    handoff.release();
    handoff = null;
    writeJournal(root, run.id, "buffers_written", capsule, targets);
    swapStarted = true;
    removeSidecars(parents.ingenium, paths.ingenium);
    removeSidecars(parents.opencode, paths.opencode);
    installComponent(parents.ingenium, requireLockedTarget(lockedTargets, paths.ingenium), paths.ingenium, bufferPath(root, run.id, "ingenium"), capsule.stage.ingenium_sha256, run.id);
    writeJournal(root, run.id, "ingenium_installed", capsule, targets);
    installComponent(parents.opencode, requireLockedTarget(lockedTargets, paths.opencode), paths.opencode, bufferPath(root, run.id, "opencode"), capsule.stage.opencode_sha256, run.id);
    writeJournal(root, run.id, "opencode_installed", capsule, targets);
    if (sha256File(boundChild(parents.ingenium, basename(paths.ingenium))) !== capsule.stage.ingenium_sha256
      || sha256File(boundChild(parents.opencode, basename(paths.opencode))) !== capsule.stage.opencode_sha256) {
      throw new MaintenanceError("VERIFY_FAILED");
    }
    writeJournal(root, run.id, "pair_committed", capsule, targets);

    closeDbForMaintenance();
    run = backups.rehydrateRestoreExecutionCapsule(capsule);
    run = backups.claimPendingRestoreExecution(global.id, owner, fence, queued.id);
    if (!run) throw new MaintenanceError("VERIFY_FAILED");
    run = safeTransition(global.id, run, owner, fence, "quiescing");
    run = safeTransition(global.id, run, owner, fence, "snapshotting");
    run = safeTransition(global.id, run, owner, fence, "swapping", { safetyBackupId: safety.backupId });
    run = safeTransition(global.id, run, owner, fence, "verifying");
    backups.recordRestoreExecutionHashes(global.id, run.id, owner, fence, "post", {
      ingenium: sha256File(boundChild(parents.ingenium, basename(paths.ingenium))),
      opencode: sha256File(boundChild(parents.opencode, basename(paths.opencode))),
    });
    if (sha256File(boundChild(parents.ingenium, basename(paths.ingenium))) !== capsule.stage.ingenium_sha256
      || sha256File(boundChild(parents.opencode, basename(paths.opencode))) !== capsule.stage.opencode_sha256) {
      throw new MaintenanceError("VERIFY_FAILED");
    }
    checkDatabases(paths, parents);
    closeDbForMaintenance();
    writeJournal(root, run.id, "rehydrated", capsule, targets);
    run = safeTransition(global.id, run, owner, fence, "restarting");
    writeJournal(root, run.id, "restarting", capsule, targets);
    restoreTargetMetadata(parents, paths, targets);
    ensureRuntimeSidecars(parents, paths, targets);
    lockedTargets = restoreAndCloseLockedTargets(lockedTargets);
    await startRestoredUsers();
    run = safeTransition(global.id, run, owner, fence, "completed");
    writeJournal(root, run.id, "completed", capsule, targets);
    removeTransientPair(parents, paths, root, run.id);
    archiveJournal(root, readJournal(root)!);
    releaseLock = null;
  } catch (error) {
    if (handoff) handoff.release();
    const code = maintenanceCode(error);
    if (!journal && run && global && owner && fence) {
      try {
        backups.failRestoreExecutionSetup(global.id, run.id, owner, fence, run.revision);
      } catch {
        // The lock is still released below; a conflicting terminalization is
        // safer than leaving the static executor holding a dead claim.
      }
    }
    if (journal && run && global && owner && fence && !parents) {
      let restartParents: TargetParents | null = null;
      try {
        const restoredRun = backups.getRestoreExecutionRun(global.id, run.id);
        if (!restoredRun) throw new MaintenanceError("ROLLBACK_FAILED");
        run = safeTransition(global.id, restoredRun, owner, fence, "rolling_back", { errorCode: code });
        writeJournal(root, run.id, "rolling_back", journal.capsule, journal.targets);
        run = safeTransition(global.id, run, owner, fence, "rolled_back", { errorCode: code });
        writeJournal(root, run.id, "rolled_back", journal.capsule, journal.targets);
        restartParents = lockTargetParents(paths, journal.targets);
        restoreTargetMetadata(restartParents, paths, journal.targets);
        ensureRuntimeSidecars(restartParents, paths, journal.targets);
        await startRestoredUsers();
        archiveJournal(root, readJournal(root)!);
        releaseLock = null;
      } catch {
        // Keep the signed journal if the no-swap terminalization cannot finish.
      } finally {
        closeTargetParents(restartParents);
      }
    }
    if (journal && run && owner && fence && parents) {
      try {
        await stopDbUsers();
        closeDbForMaintenance();
        scanOpenHolders(paths);
        rollbackComponent(parents.opencode, paths.opencode, run.id);
        rollbackComponent(parents.ingenium, paths.ingenium, run.id);
        if (swapStarted) {
          removeSidecars(parents.ingenium, paths.ingenium);
          removeSidecars(parents.opencode, paths.opencode);
        }
        checkDatabases(paths, parents);
        closeDbForMaintenance();
        const restoredRun = backups.getRestoreExecutionRun(global?.id ?? journal.capsule.run.project_id, run.id);
        if (!restoredRun) throw new MaintenanceError("ROLLBACK_FAILED");
        run = restoredRun;
        if (run.state !== "rolling_back") run = safeTransition(global?.id ?? journal.capsule.run.project_id, run, owner, fence, "rolling_back", { errorCode: code });
        writeJournal(root, run.id, "rolling_back", journal.capsule, journal.targets);
        run = safeTransition(global?.id ?? journal.capsule.run.project_id, run, owner, fence, "rolled_back", { errorCode: code });
        writeJournal(root, run.id, "rolled_back", journal.capsule, journal.targets);
        restoreTargetMetadata(parents, paths, journal.targets);
        ensureRuntimeSidecars(parents, paths, journal.targets);
        lockedTargets = restoreAndCloseLockedTargets(lockedTargets);
        await startRestoredUsers();
        removeTransientPair(parents, paths, root, run.id);
        archiveJournal(root, readJournal(root)!);
        releaseLock = null;
      } catch {
        try {
          if (run && global && owner && fence) {
            run = safeTransition(global.id, run, owner, fence, "rollback_failed", { errorCode: "ROLLBACK_FAILED" });
            writeJournal(root, run.id, "rollback_failed", journal.capsule, journal.targets);
          }
        } catch {
          // The retained HMAC journal is the only safe recovery evidence left.
        }
      }
    }
    throw new MaintenanceError(code);
  } finally {
    if (releaseLock && !journal) releaseLock();
    if (parents && targets) {
      try {
        restoreTargetMetadata(parents, paths, targets);
      } catch {
        // The signed journal retains the metadata required for root recovery.
      }
    }
    if (lockedTargets) {
      try {
        restoreLockedTargetMetadata(lockedTargets);
      } catch {
        // The terminal journal remains the recovery authority if descriptor
        // metadata cannot be restored during a failed unwind.
      }
    }
    closeLockedTargets(lockedTargets);
    closeTargetParents(parents);
    wipeJournalKey();
  }
}

function recover(): void {
  const paths = targetPaths();
  configureTrustedCorePaths(paths);
  const root = maintenanceRoot();
  let parents: TargetParents | null = null;
  let journal = readJournal(root);
  const lockRunId = readLock(root);
  if (!journal) {
    if (!lockRunId) return;
    const global = projects.getGlobalProject();
    const run = global ? backups.getRestoreExecutionRun(global.id, lockRunId) : null;
    if (!run || run.state === "queued") {
      unlinkSync(safeChild(root, LOCK_FILE));
      fsyncDirectory(root);
      return;
    }
    if (run.state !== "executor_claimed") throw new MaintenanceError("JOURNAL_INVALID");
    backups.failClaimedRestoreExecutionSetup(global!.id, run.id, run.revision);
    unlinkSync(safeChild(root, LOCK_FILE));
    fsyncDirectory(root);
    return;
  }
  if (!journal) throw new MaintenanceError("JOURNAL_INVALID");
  const recoveredJournal = journal;
  parents = lockTargetParents(paths, recoveredJournal.targets);
  if (recoveredJournal.phase === "completed") {
    // Recovery runs before Supervisor starts DB users. A terminal journal is
    // sufficient evidence; never compare live hashes after services resume.
    removeTransientPair(parents, paths, root, recoveredJournal.runId);
    restoreTargetMetadata(parents, paths, recoveredJournal.targets);
    archiveJournal(root, recoveredJournal);
    closeTargetParents(parents);
    wipeJournalKey();
    return;
  }
  if (recoveredJournal.phase === "rolled_back") {
    restoreTargetMetadata(parents, paths, recoveredJournal.targets);
    archiveJournal(root, recoveredJournal);
    closeTargetParents(parents);
    wipeJournalKey();
    return;
  }
  if (recoveredJournal.phase === "rollback_failed") {
    closeTargetParents(parents);
    wipeJournalKey();
    throw new MaintenanceError("ROLLBACK_FAILED");
  }
  try {
    scanOpenHolders(paths);
    rollbackComponent(parents.opencode, paths.opencode, recoveredJournal.runId);
    rollbackComponent(parents.ingenium, paths.ingenium, recoveredJournal.runId);
    removeSidecars(parents.ingenium, paths.ingenium);
    removeSidecars(parents.opencode, paths.opencode);
    checkDatabases(paths, parents);
    closeDbForMaintenance();
    backups.recoverRestoreExecutionCapsule(recoveredJournal.capsule, "rolled_back", "SWAP_FAILED");
    removeTransientPair(parents, paths, root, recoveredJournal.runId);
    writeJournal(root, recoveredJournal.runId, "rolled_back", recoveredJournal.capsule, recoveredJournal.targets);
    restoreTargetMetadata(parents, paths, recoveredJournal.targets);
    archiveJournal(root, readJournal(root)!);
  } catch {
    try {
      closeDbForMaintenance();
      backups.recoverRestoreExecutionCapsule(recoveredJournal.capsule, "rollback_failed", "ROLLBACK_FAILED");
      writeJournal(root, recoveredJournal.runId, "rollback_failed", recoveredJournal.capsule, recoveredJournal.targets);
    } catch {
      // The retained HMAC journal is the only safe recovery evidence left.
    }
    throw new MaintenanceError("ROLLBACK_FAILED");
  } finally {
    closeTargetParents(parents);
    wipeJournalKey();
  }
}

async function main(): Promise<void> {
  if (process.argv.length !== 2) throw new MaintenanceError("JOURNAL_INVALID");
  const mode = process.env.INGENIUM_RESTORE_MAINTENANCE_MODE;
  if (mode === "recover") {
    recover();
    return;
  }
  if (mode !== "execute") throw new MaintenanceError("JOURNAL_INVALID");
  await execute();
}

void main().catch((error: unknown) => {
  const code = error instanceof MaintenanceError ? error.code : "JOURNAL_INVALID";
  process.stderr.write(`${PROGRAM}:${code}\n`);
  process.exitCode = 1;
});
