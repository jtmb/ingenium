import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const backupRmControl = vi.hoisted(() => ({
  beforePath: null as string | null,
  beforeRemove: null as (() => void) | null,
  failPath: null as string | null,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    rmSync(...args: Parameters<typeof actual.rmSync>) {
      const [path] = args;
      if (backupRmControl.beforePath === path && backupRmControl.beforeRemove) {
        const beforeRemove = backupRmControl.beforeRemove;
        backupRmControl.beforePath = null;
        backupRmControl.beforeRemove = null;
        beforeRemove();
      }
      if (backupRmControl.failPath === path) {
        backupRmControl.failPath = null;
        throw new Error("injected backup removal failure");
      }
      return actual.rmSync(...args);
    },
  };
});

import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import {
  BackupError,
  authorizeRestore,
  authorizeRestoreExecution,
  captureRestoreExecutionCapsule,
  claimPendingRestoreExecution,
  confirmRestore,
  createSnapshot,
  deleteBackup,
  failRestoreExecutionStart,
  getReadyRestoreStage,
  getBackup,
  getRestorePlan,
  getRestoreExecutionRun,
  listRestoreAudit,
  listQueuedRestoreExecutions,
  loadBackupSigningKey,
  previewRestore,
  readVerifiedBackupComponent,
  recoverRestoreExecutionCapsule,
  executeRestore,
  failRestoreExecutionSetup,
  transitionRestoreExecution,
  validateRestorePreflight,
  wipeBackupDownloadBuffer,
} from "../lib/tools/backups.js";

let tempDir: string;
let dbPath: string;
let backupsDir: string;
let opencodeDbPath: string;
let signingKeyPath: string;
let globalProjectId: string;
let externalProjectId: string;

function canonical(value: unknown): string {
  const sort = (entry: unknown): unknown => Array.isArray(entry)
    ? entry.map(sort)
    : entry && typeof entry === "object"
      ? Object.fromEntries(Object.entries(entry as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sort(nested)]))
      : entry;
  return JSON.stringify(sort(value));
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Update a deliberately tampered fixture so signature/hash validation reaches SQLite checks. */
function resignFixture(backupId: string): void {
  const bundle = join(backupsDir, backupId);
  const manifestPath = join(bundle, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, any>;
  for (const [name, filename] of [["ingenium", "ingenium.db"], ["opencode", "opencode.db"]] as const) {
    const bytes = readFileSync(join(bundle, filename));
    manifest.components[name].sha256 = createHash("sha256").update(bytes).digest("hex");
    manifest.components[name].size_bytes = bytes.length;
  }
  const { signature: _signature, ...unsigned } = manifest;
  const key = readFileSync(signingKeyPath);
  manifest.signature = createHmac("sha256", key).update(canonical(unsigned)).digest("hex");
  const raw = canonical(manifest);
  writeFileSync(manifestPath, raw, { mode: 0o600 });
  getDb(dbPath).prepare(
    "UPDATE backup_records SET components = ?, sha256 = ?, size_bytes = ? WHERE project_id = ? AND id = ?",
  ).run(
    raw,
    createHash("sha256").update(raw).digest("hex"),
    manifest.components.ingenium.size_bytes + manifest.components.opencode.size_bytes,
    globalProjectId,
    backupId,
  );
}

async function snapshot(type = "manual") {
  return createSnapshot(globalProjectId, type, dbPath, opencodeDbPath);
}

function deletionReservation(backupId: string): { state: string; attempt_count: number } | undefined {
  return getDb(dbPath).prepare(
    "SELECT state, attempt_count FROM backup_deletion_reservations WHERE project_id = ? AND backup_id = ?",
  ).get(globalProjectId, backupId) as { state: string; attempt_count: number } | undefined;
}

function reserveDeletionForCrash(backupId: string): void {
  const timestamp = new Date().toISOString();
  getDb(dbPath).prepare(
    `INSERT INTO backup_deletion_reservations
     (project_id, backup_id, state, attempt_count, created_at, updated_at)
     VALUES (?, ?, 'reserved', 0, ?, ?)`,
  ).run(globalProjectId, backupId, timestamp, timestamp);
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-restore-100-"));
  dbPath = join(tempDir, "data");
  backupsDir = join(tempDir, "backups");
  opencodeDbPath = join(tempDir, "opencode.db");
  signingKeyPath = join(tempDir, "backup-signing-key");
  writeFileSync(signingKeyPath, Buffer.alloc(32, 7), { mode: 0o600 });
  chmodSync(signingKeyPath, 0o600);
  process.env.INGENIUM_CORE_DB_PATH = dbPath;
  process.env.INGENIUM_BACKUPS_DIR = backupsDir;
  process.env.OPENCODE_DB_PATH = opencodeDbPath;
  process.env.INGENIUM_BACKUP_SIGNING_KEY_FILE = signingKeyPath;
  process.env.INGENIUM_TRUSTED_ARTIFACT_UID = String(process.getuid?.() ?? 0);
  process.env.INGENIUM_TRUSTED_ARTIFACT_GID = String(process.getgid?.() ?? 0);
  getDb(dbPath);
  const opencode = new Database(opencodeDbPath);
  opencode.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY)");
  opencode.close();
  globalProjectId = createProject("global-default", true).id;
  externalProjectId = createProject("external-project").id;
});

afterAll(() => {
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  delete process.env.INGENIUM_BACKUPS_DIR;
  delete process.env.OPENCODE_DB_PATH;
  delete process.env.INGENIUM_BACKUP_SIGNING_KEY_FILE;
  delete process.env.INGENIUM_TRUSTED_ARTIFACT_UID;
  delete process.env.INGENIUM_TRUSTED_ARTIFACT_GID;
  delete process.env.INGENIUM_BACKUP_DOWNLOAD_MAX_BYTES;
  delete process.env.INGENIUM_RESTORE_HANDOFF_MAX_BYTES;
  const stagingRoot = join(tempDir, "restore-staging");
  if (existsSync(stagingRoot)) {
    for (const entry of readdirSync(stagingRoot)) chmodSync(join(stagingRoot, entry), 0o700);
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("RESTORE-100 v2 bundles", () => {
  it("publishes a signed fixed-name directory atomically and inventories its manifest hash", async () => {
    const created = await snapshot();
    const bundle = join(backupsDir, created.backupId);
    expect(created.filename).toBe(created.backupId);
    expect(existsSync(join(bundle, "manifest.json"))).toBe(true);
    expect(existsSync(join(bundle, "ingenium.db"))).toBe(true);
    expect(existsSync(join(bundle, "opencode.db"))).toBe(true);
    expect(existsSync(join(backupsDir, `.${created.backupId}.partial`))).toBe(false);
    expect(lstatSync(bundle).isSymbolicLink()).toBe(false);
    for (const path of [bundle, join(bundle, "manifest.json"), join(bundle, "ingenium.db"), join(bundle, "opencode.db")]) {
      const stat = lstatSync(path);
      expect([stat.uid, stat.gid]).toEqual([Number(process.env.INGENIUM_TRUSTED_ARTIFACT_UID), Number(process.env.INGENIUM_TRUSTED_ARTIFACT_GID)]);
      expect(stat.mode & 0o777).toBe(path === bundle ? 0o700 : 0o600);
    }
    const manifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ format: 2, backup_id: created.backupId, schema_compatibility: { restore_min_migration: 85 } });
    expect(manifest.components.ingenium.filename).toBe("ingenium.db");
    expect(manifest.components.opencode.filename).toBe("opencode.db");
    expect(manifest.compatibility).toMatchObject({
      ingenium: { schema_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/), required_tables: expect.any(Array) },
      opencode: { schema_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/), required_tables: expect.any(Array) },
    });
    expect(manifest.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(getBackup(globalProjectId, created.backupId)).toMatchObject({
      sha256: hashFile(join(bundle, "manifest.json")), status: "completed",
    });
    expect(deletionReservation(created.backupId)).toBeUndefined();
    expect(validateRestorePreflight(globalProjectId, created.backupId)).toMatchObject({ valid: true, blockers: [] });
  });

  it("creates scheduled bundles with the same v2 format", async () => {
    const created = await snapshot("scheduled_daily");
    expect(getBackup(globalProjectId, created.backupId)?.backup_type).toBe("scheduled_daily");
    expect(validateRestorePreflight(globalProjectId, created.backupId).valid).toBe(true);
  });

  it("fails closed for manifest tampering, traversal, symlinks, and component hash changes", async () => {
    const created = await snapshot();
    const bundle = join(backupsDir, created.backupId);
    const manifestPath = join(bundle, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.components.ingenium.filename = "../data";
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(validateRestorePreflight(globalProjectId, created.backupId)).toMatchObject({ valid: false, blockers: ["BACKUP_INVALID"] });

    const symlinked = await snapshot();
    const symlinkBundle = join(backupsDir, symlinked.backupId);
    rmSync(join(symlinkBundle, "opencode.db"));
    symlinkSync(opencodeDbPath, join(symlinkBundle, "opencode.db"));
    expect(validateRestorePreflight(globalProjectId, symlinked.backupId)).toMatchObject({ valid: false, blockers: ["BACKUP_INVALID"] });

    const changed = await snapshot();
    writeFileSync(join(backupsDir, changed.backupId, "ingenium.db"), "not a sqlite database");
    expect(validateRestorePreflight(globalProjectId, changed.backupId)).toMatchObject({ valid: false, blockers: ["BACKUP_INVALID"] });
  });

  it("checks each database integrity and restore-schema compatibility after authenticating the manifest", async () => {
    const invalidOpenCode = await snapshot();
    writeFileSync(join(backupsDir, invalidOpenCode.backupId, "opencode.db"), "not sqlite");
    resignFixture(invalidOpenCode.backupId);
    expect(validateRestorePreflight(globalProjectId, invalidOpenCode.backupId)).toMatchObject({ valid: false, blockers: ["BACKUP_INVALID"] });

    const incompatible = await snapshot();
    const path = join(backupsDir, incompatible.backupId, "ingenium.db");
    rmSync(path);
    const legacy = new Database(path);
    legacy.exec("CREATE TABLE only_old_schema (id TEXT PRIMARY KEY)");
    legacy.close();
    resignFixture(incompatible.backupId);
    expect(validateRestorePreflight(globalProjectId, incompatible.backupId)).toMatchObject({ valid: false, blockers: ["BACKUP_INVALID"] });

    const incompatibleOpenCode = await snapshot();
    const openCodePath = join(backupsDir, incompatibleOpenCode.backupId, "opencode.db");
    rmSync(openCodePath);
    const fakeOpenCode = new Database(openCodePath);
    fakeOpenCode.exec("CREATE TABLE only_fake_schema (id TEXT PRIMARY KEY)");
    fakeOpenCode.close();
    resignFixture(incompatibleOpenCode.backupId);
    expect(validateRestorePreflight(globalProjectId, incompatibleOpenCode.backupId))
      .toMatchObject({ valid: false, blockers: ["BACKUP_INVALID"] });
  });

  it("rejects legacy records without rewriting or deleting their files", () => {
    const legacyId = randomUUID();
    getDb(dbPath).prepare(
      `INSERT INTO backup_records (id, project_id, filename, size_bytes, sha256, backup_type, components, status)
       VALUES (?, ?, ?, 1, ?, 'manual', ?, 'completed')`,
    ).run(legacyId, globalProjectId, `${legacyId}.db`, "a".repeat(64), JSON.stringify({ schema_version: 47 }));
    expect(validateRestorePreflight(globalProjectId, legacyId)).toMatchObject({ valid: false, blockers: ["BACKUP_LEGACY_UNSUPPORTED"] });
    expect(() => deleteBackup(globalProjectId, legacyId)).toThrow(expect.objectContaining({ code: "BACKUP_LEGACY_UNSUPPORTED" }));
    expect(getBackup(globalProjectId, legacyId)).not.toBeNull();
  });

  it("reserves deletion before removal so a preview cannot win the race", async () => {
    const created = await snapshot();
    const bundle = join(backupsDir, created.backupId);
    backupRmControl.beforePath = bundle;
    backupRmControl.beforeRemove = () => {
      expect(deletionReservation(created.backupId)).toEqual({ state: "deleting", attempt_count: 1 });
      expect(existsSync(bundle)).toBe(true);
      expect(() => previewRestore(globalProjectId, {
        backupId: created.backupId,
        dryRun: true,
        idempotencyKey: "reserved-preview",
      })).toThrow(expect.objectContaining({ code: "BACKUP_REFERENCED" }));
      expect(getDb(dbPath).prepare(
        "SELECT count(*) AS count FROM backup_restore_plans WHERE project_id = ? AND backup_id = ?",
      ).get(globalProjectId, created.backupId)).toEqual({ count: 0 });
    };

    deleteBackup(globalProjectId, created.backupId);
    expect(getBackup(globalProjectId, created.backupId)).toBeNull();
    expect(deletionReservation(created.backupId)).toBeUndefined();
    expect(existsSync(bundle)).toBe(false);
    expect(getDb(dbPath).prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("keeps the bundle when preview creates the immutable reference first", async () => {
    const created = await snapshot();
    const bundle = join(backupsDir, created.backupId);
    const plan = previewRestore(globalProjectId, {
      backupId: created.backupId,
      dryRun: true,
      idempotencyKey: "preview-wins",
    });

    expect(() => deleteBackup(globalProjectId, created.backupId))
      .toThrow(expect.objectContaining({ code: "BACKUP_REFERENCED" }));
    expect(getBackup(globalProjectId, created.backupId)).not.toBeNull();
    expect(deletionReservation(created.backupId)).toBeUndefined();
    expect(existsSync(bundle)).toBe(true);
    expect(listRestoreAudit(globalProjectId, plan.id)).toHaveLength(1);
  });

  it("retains the inventory row when bundle removal fails", async () => {
    const created = await snapshot();
    const bundle = join(backupsDir, created.backupId);
    backupRmControl.failPath = bundle;

    expect(() => deleteBackup(globalProjectId, created.backupId)).toThrow("injected backup removal failure");
    expect(getBackup(globalProjectId, created.backupId)).not.toBeNull();
    expect(deletionReservation(created.backupId)).toEqual({ state: "deleting", attempt_count: 1 });
    expect(() => previewRestore(globalProjectId, {
      backupId: created.backupId,
      dryRun: true,
      idempotencyKey: "deleting-preview",
    })).toThrow(expect.objectContaining({ code: "BACKUP_REFERENCED" }));
    expect(existsSync(bundle)).toBe(true);

    deleteBackup(globalProjectId, created.backupId);
    expect(getBackup(globalProjectId, created.backupId)).toBeNull();
    expect(deletionReservation(created.backupId)).toBeUndefined();
    expect(existsSync(bundle)).toBe(false);
  });

  it("resumes crash-like reserved states with present or missing bundles idempotently", async () => {
    const present = await snapshot();
    reserveDeletionForCrash(present.backupId);
    expect(() => previewRestore(globalProjectId, {
      backupId: present.backupId,
      dryRun: true,
      idempotencyKey: "crash-reserved-preview",
    })).toThrow(expect.objectContaining({ code: "BACKUP_REFERENCED" }));
    deleteBackup(globalProjectId, present.backupId);
    expect(getBackup(globalProjectId, present.backupId)).toBeNull();
    expect(deletionReservation(present.backupId)).toBeUndefined();
    expect(existsSync(join(backupsDir, present.backupId))).toBe(false);

    const missing = await snapshot();
    const missingBundle = join(backupsDir, missing.backupId);
    reserveDeletionForCrash(missing.backupId);
    rmSync(missingBundle, { recursive: true, force: true });
    expect(() => deleteBackup(globalProjectId, missing.backupId)).not.toThrow();
    expect(getBackup(globalProjectId, missing.backupId)).toBeNull();
    expect(deletionReservation(missing.backupId)).toBeUndefined();
    expect(() => deleteBackup(globalProjectId, missing.backupId)).not.toThrow();
    expect(getDb(dbPath).prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("retains the deletion reservation rather than following a substituted bundle symlink", async () => {
    const created = await snapshot();
    const bundle = join(backupsDir, created.backupId);
    const outside = join(tempDir, `outside-${created.backupId}`);
    const sentinel = join(outside, "sentinel");
    mkdirSync(outside, { mode: 0o700 });
    writeFileSync(sentinel, "keep");
    rmSync(bundle, { recursive: true, force: true });
    symlinkSync(outside, bundle, "dir");

    expect(() => deleteBackup(globalProjectId, created.backupId))
      .toThrow(expect.objectContaining({ code: "BACKUP_INVALID" }));
    expect(getBackup(globalProjectId, created.backupId)).not.toBeNull();
    expect(deletionReservation(created.backupId)).toEqual({ state: "deleting", attempt_count: 1 });
    expect(existsSync(sentinel)).toBe(true);
    expect(() => previewRestore(globalProjectId, {
      backupId: created.backupId,
      dryRun: true,
      idempotencyKey: "symlink-deleting-preview",
    })).toThrow(expect.objectContaining({ code: "BACKUP_REFERENCED" }));
  });

  it("uses owner-only, non-symlink signing keys", () => {
    expect(loadBackupSigningKey()).toHaveLength(32);
    const badKey = join(tempDir, "bad-signing-key");
    symlinkSync(signingKeyPath, badKey);
    const previous = process.env.INGENIUM_BACKUP_SIGNING_KEY_FILE;
    process.env.INGENIUM_BACKUP_SIGNING_KEY_FILE = badKey;
    expect(() => loadBackupSigningKey()).toThrow(expect.objectContaining({ code: "BACKUP_INVALID" }));
    process.env.INGENIUM_BACKUP_SIGNING_KEY_FILE = previous;
  });

  it("rejects a bundle when verification uses a distinct signing key", async () => {
    const created = await snapshot();
    const originalKey = readFileSync(signingKeyPath);
    try {
      writeFileSync(signingKeyPath, Buffer.alloc(32, 8), { mode: 0o600 });
      chmodSync(signingKeyPath, 0o600);
      expect(validateRestorePreflight(globalProjectId, created.backupId))
        .toMatchObject({ valid: false, blockers: ["BACKUP_INVALID"] });
    } finally {
      writeFileSync(signingKeyPath, originalKey, { mode: 0o600 });
      chmodSync(signingKeyPath, 0o600);
    }
    expect(validateRestorePreflight(globalProjectId, created.backupId)).toMatchObject({ valid: true, blockers: [] });
  });
});

describe("RESTORE-100 restore plans", () => {
  it("creates one durable preview/event per idempotency key and replays only the same request", async () => {
    const created = await snapshot();
    const first = previewRestore(globalProjectId, { backupId: created.backupId, dryRun: true, idempotencyKey: "preview-a" });
    const replay = previewRestore(globalProjectId, { backupId: created.backupId, dryRun: true, idempotencyKey: "preview-a" });
    expect(replay.id).toBe(first.id);
    const distinct = previewRestore(globalProjectId, { backupId: created.backupId, dryRun: true, idempotencyKey: "preview-distinct" });
    expect(distinct.id).not.toBe(first.id);
    expect(first).toMatchObject({ state: "previewed", revision: 0, dryRun: true, blockers: [] });
    expect(listRestoreAudit(globalProjectId, first.id)).toHaveLength(1);
    expect(() => previewRestore(globalProjectId, { backupId: randomUUID(), dryRun: true, idempotencyKey: "preview-a" }))
      .toThrow(expect.objectContaining({ code: "RESTORE_IDEMPOTENCY_CONFLICT" }));
    expect(getRestorePlan(externalProjectId, first.id)).toBeNull();
  });

  it("rejects direct SQL plan mutation, revision jumps, and fabricated events", async () => {
    const created = await snapshot();
    const plan = previewRestore(globalProjectId, { backupId: created.backupId, dryRun: true, idempotencyKey: "sql-guards" });
    const db = getDb(dbPath);
    expect(() => db.prepare("UPDATE backup_restore_plans SET created_at = ? WHERE project_id = ? AND id = ?")
      .run("2026-01-01T00:00:00.000Z", globalProjectId, plan.id)).toThrow("restore plans are immutable");
    expect(() => db.prepare("DELETE FROM backup_restore_plans WHERE project_id = ? AND id = ?")
      .run(globalProjectId, plan.id)).toThrow("restore plans are immutable");
    expect(() => db.prepare(
      `INSERT INTO backup_restore_plan_revisions
       (id, project_id, plan_id, backup_id, revision, from_state, to_state, stage_hash, created_at)
       VALUES (?, ?, ?, ?, 1, 'previewed', 'ready_for_executor', NULL, ?)`,
    ).run(randomUUID(), globalProjectId, plan.id, created.backupId, "2026-01-01T00:00:01.000Z")).toThrow("restore revision transition is invalid");
    expect(() => db.prepare(
      `INSERT INTO backup_restore_plan_revisions
       (id, project_id, plan_id, backup_id, revision, from_state, to_state, stage_hash, created_at)
       VALUES (?, ?, ?, ?, 1, 'previewed', 'authorized', NULL, ?)`,
    ).run(randomUUID(), globalProjectId, plan.id, created.backupId, "2099-01-01T00:00:01.500Z"))
      .toThrow("restore authorized revision requires unconsumed authorization");
    expect(() => db.prepare(
      `INSERT INTO backup_restore_plan_revisions
       (id, project_id, plan_id, backup_id, revision, from_state, to_state, stage_hash, created_at)
       VALUES (?, ?, ?, ?, 2, 'previewed', 'authorized', NULL, ?)`,
    ).run(randomUUID(), globalProjectId, plan.id, created.backupId, "2026-01-01T00:00:02.000Z")).toThrow("restore revision must be next append-only revision");
    expect(() => db.prepare(
      `INSERT INTO backup_restore_events
       (id, project_id, plan_id, backup_id, event_type, from_state, to_state, revision, manifest_hash, plan_hash, created_at)
       VALUES (?, ?, ?, ?, 'previewed', NULL, 'previewed', 0, ?, ?, ?)`,
    ).run(randomUUID(), globalProjectId, plan.id, created.backupId, plan.manifestHash, plan.planHash, "2026-01-01T00:00:03.000Z"))
      .toThrow();
  });

  it("enforces CAS, token binding, one-time use, replay receipts, and the fixed transition graph", async () => {
    const created = await snapshot();
    const plan = previewRestore(globalProjectId, { backupId: created.backupId, dryRun: true, idempotencyKey: "preview-b" });
    expect(() => authorizeRestore(globalProjectId, plan.id, plan.revision + 1))
      .toThrow(expect.objectContaining({ code: "RESTORE_REVISION_CONFLICT" }));
    const authorization = authorizeRestore(globalProjectId, plan.id, plan.revision);
    expect(authorization.plan).toMatchObject({ state: "authorized", revision: 1 });
    expect(JSON.stringify(authorization.plan)).not.toContain(authorization.confirmationToken);
    const storedAuthorization = getDb(dbPath).prepare(
      "SELECT token_hash FROM backup_restore_authorizations WHERE project_id = ? AND plan_id = ?",
    ).get(globalProjectId, plan.id) as { token_hash: string };
    expect(storedAuthorization.token_hash).toBe(createHash("sha256").update(canonical({
      confirmationToken: authorization.confirmationToken,
      projectId: globalProjectId,
      planId: plan.id,
      backupId: created.backupId,
      manifestHash: authorization.plan.manifestHash,
      operation: "confirm_restore",
      revision: authorization.plan.revision,
    })).digest("hex"));
    expect(() => confirmRestore(globalProjectId, plan.id, {
      confirmationToken: "x".repeat(43), expectedRevision: authorization.plan.revision, idempotencyKey: "confirm-bad",
    })).toThrow(expect.objectContaining({ code: "RESTORE_AUTHORIZATION_INVALID" }));
    const confirmed = confirmRestore(globalProjectId, plan.id, {
      confirmationToken: authorization.confirmationToken,
      expectedRevision: authorization.plan.revision,
      idempotencyKey: "confirm-ok",
    });
    expect(confirmed).toMatchObject({ state: "ready_for_executor", revision: 3 });
    expect(confirmRestore(globalProjectId, plan.id, {
      confirmationToken: authorization.confirmationToken,
      expectedRevision: authorization.plan.revision,
      idempotencyKey: "confirm-ok",
    })).toMatchObject({ id: plan.id, state: "ready_for_executor", revision: 3 });
    expect(() => confirmRestore(globalProjectId, plan.id, {
      confirmationToken: authorization.confirmationToken,
      expectedRevision: confirmed.revision,
      idempotencyKey: "confirm-other",
    })).toThrow(expect.objectContaining({ code: "RESTORE_STATE_CONFLICT" }));
    expect(listRestoreAudit(globalProjectId, plan.id).map((event) => event.toState).reverse())
      .toEqual(["previewed", "authorized", "confirmed", "ready_for_executor"]);
  });

  it("requires a distinct execution authorization, queues idempotently, and fences phase CAS", async () => {
    const created = await snapshot();
    const plan = previewRestore(globalProjectId, { backupId: created.backupId, dryRun: true, idempotencyKey: "execution-preview" });
    const confirmation = authorizeRestore(globalProjectId, plan.id, plan.revision);
    const ready = confirmRestore(globalProjectId, plan.id, {
      confirmationToken: confirmation.confirmationToken,
      expectedRevision: confirmation.plan.revision,
      idempotencyKey: "execution-confirm",
    });
    const execution = authorizeRestoreExecution(globalProjectId, ready.id, ready.revision);
    expect(execution.plan).toMatchObject({ state: "execution_authorized", revision: 4 });
    expect(JSON.stringify(execution.plan)).not.toContain(execution.executionToken);
    expect(() => executeRestore(globalProjectId, plan.id, {
      executionToken: confirmation.confirmationToken,
      expectedRevision: execution.plan.revision,
      idempotencyKey: "execution-stage-token",
    })).toThrow(expect.objectContaining({ code: "RESTORE_EXECUTION_AUTHORIZATION_INVALID" }));

    const openCodeBefore = hashFile(opencodeDbPath);
    const queued = executeRestore(globalProjectId, plan.id, {
      executionToken: execution.executionToken,
      expectedRevision: execution.plan.revision,
      idempotencyKey: "execution-queue",
    });
    expect(queued).toMatchObject({ plan: { state: "queued", revision: 5 }, run: { state: "queued", revision: 0 } });
    expect(hashFile(opencodeDbPath)).toBe(openCodeBefore); // queueing never applies staged bytes
    expect(executeRestore(globalProjectId, plan.id, {
      executionToken: execution.executionToken,
      expectedRevision: execution.plan.revision,
      idempotencyKey: "execution-queue",
    }).run.id).toBe(queued.run.id);
    expect(() => executeRestore(globalProjectId, plan.id, {
      executionToken: execution.executionToken,
      expectedRevision: execution.plan.revision,
      idempotencyKey: "execution-replay-other",
    })).toThrow(expect.objectContaining({ code: "RESTORE_REVISION_CONFLICT" }));

    const owner = "o".repeat(43);
    const fence = "f".repeat(43);
    const claimed = claimPendingRestoreExecution(globalProjectId, owner, fence)!;
    expect(claimed).toMatchObject({ id: queued.run.id, state: "executor_claimed", revision: 1 });
    expect(() => transitionRestoreExecution(globalProjectId, claimed.id, owner, fence, claimed.revision + 1, "quiescing"))
      .toThrow(expect.objectContaining({ code: "RESTORE_REVISION_CONFLICT" }));
    const quiescing = transitionRestoreExecution(globalProjectId, claimed.id, owner, fence, claimed.revision, "quiescing");
    const snapshotting = transitionRestoreExecution(globalProjectId, quiescing.id, owner, fence, quiescing.revision, "snapshotting");
    expect(getRestoreExecutionRun(globalProjectId, snapshotting.id)).toMatchObject({ state: "snapshotting", revision: 3 });
    expect(() => getDb(dbPath).prepare("UPDATE backup_restore_authorizations SET id = ? WHERE project_id = ? AND plan_id = ?")
      .run(randomUUID(), globalProjectId, plan.id)).toThrow("restore authorization may only be consumed once");
  });

  it("rejects an expired authorization without consuming it or staging a restore", async () => {
    const created = await snapshot();
    const plan = previewRestore(globalProjectId, { backupId: created.backupId, dryRun: true, idempotencyKey: "preview-expired-token" });
    const authorization = authorizeRestore(globalProjectId, plan.id, plan.revision);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.parse(authorization.expiresAt) + 1));
      expect(() => confirmRestore(globalProjectId, plan.id, {
        confirmationToken: authorization.confirmationToken,
        expectedRevision: authorization.plan.revision,
        idempotencyKey: "confirm-expired-token",
      })).toThrow(expect.objectContaining({ code: "RESTORE_AUTHORIZATION_EXPIRED" }));
    } finally {
      vi.useRealTimers();
    }
    expect(getRestorePlan(globalProjectId, plan.id)).toMatchObject({ state: "authorized", revision: 1 });
    expect(existsSync(join(tempDir, "restore-staging", plan.id))).toBe(false);
  });

  it("persists an unstartable fixed executor as a terminal CAS failure", async () => {
    const created = await snapshot();
    const plan = previewRestore(globalProjectId, { backupId: created.backupId, dryRun: true, idempotencyKey: "start-failure-preview" });
    const confirmation = authorizeRestore(globalProjectId, plan.id, plan.revision);
    const ready = confirmRestore(globalProjectId, plan.id, {
      confirmationToken: confirmation.confirmationToken,
      expectedRevision: confirmation.plan.revision,
      idempotencyKey: "start-failure-confirm",
    });
    const authorization = authorizeRestoreExecution(globalProjectId, ready.id, ready.revision);
    const queued = executeRestore(globalProjectId, plan.id, {
      executionToken: authorization.executionToken,
      expectedRevision: authorization.plan.revision,
      idempotencyKey: "start-failure-execute",
    }).run;

    expect(listQueuedRestoreExecutions(globalProjectId)).toEqual([expect.objectContaining({ id: queued.id })]);
    expect(failRestoreExecutionStart(globalProjectId, queued.id, queued.revision))
      .toMatchObject({ state: "executor_start_failed", errorCode: "SUPERVISOR_FAILED", completedAt: expect.any(String) });
    expect(claimPendingRestoreExecution(globalProjectId, "o".repeat(43), "f".repeat(43))).toBeNull();
    expect(() => getDb(dbPath).prepare(
      "UPDATE backup_restore_execution_runs SET state = 'completed', phase = 'completed', revision = revision + 1, completed_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), queued.id)).toThrow("restore execution run transition is invalid");
  });

  it("makes authorization consumption immutable and blocks deleting any planned backup", async () => {
    const created = await snapshot();
    const plan = previewRestore(globalProjectId, { backupId: created.backupId, dryRun: true, idempotencyKey: "preview-expiry" });
    const authorization = authorizeRestore(globalProjectId, plan.id, plan.revision);
    expect(() => getDb(dbPath).prepare("UPDATE backup_restore_authorizations SET expires_at = ? WHERE project_id = ? AND plan_id = ?")
      .run("1970-01-01T00:00:00.000Z", globalProjectId, plan.id)).toThrow("restore authorization may only be consumed once");
    expect(() => deleteBackup(globalProjectId, created.backupId)).toThrow(expect.objectContaining({ code: "BACKUP_REFERENCED" }));
  });

  it("keeps the source bundle byte-identical through every restore-plan transition", async () => {
    const created = await snapshot();
    const bundle = join(backupsDir, created.backupId);
    const before = ["manifest.json", "ingenium.db", "opencode.db"].map((name) => hashFile(join(bundle, name)));
    const plan = previewRestore(globalProjectId, { backupId: created.backupId, dryRun: true, idempotencyKey: "preview-source" });
    const authorization = authorizeRestore(globalProjectId, plan.id, plan.revision);
    confirmRestore(globalProjectId, plan.id, {
      confirmationToken: authorization.confirmationToken,
      expectedRevision: authorization.plan.revision,
      idempotencyKey: "confirm-source",
    });
    expect(["manifest.json", "ingenium.db", "opencode.db"].map((name) => hashFile(join(bundle, name)))).toEqual(before);
  });

  it("hands off independent stage buffers and detects later same-UID stage tampering on status", async () => {
    const created = await snapshot();
    const plan = previewRestore(globalProjectId, { backupId: created.backupId, dryRun: true, idempotencyKey: "preview-stage" });
    const authorization = authorizeRestore(globalProjectId, plan.id, plan.revision);
    const ready = confirmRestore(globalProjectId, plan.id, {
      confirmationToken: authorization.confirmationToken,
      expectedRevision: authorization.plan.revision,
      idempotencyKey: "confirm-stage",
    });
    const stage = join(tempDir, "restore-staging", plan.id);
    const stagedIngenium = join(stage, "ingenium.db");
    const before = hashFile(stagedIngenium);
    expect(lstatSync(stage).mode & 0o777).toBe(0o500);
    expect(lstatSync(stagedIngenium).mode & 0o777).toBe(0o444);
    writeFileSync(join(backupsDir, created.backupId, "ingenium.db"), "changed source after staging");
    expect(hashFile(stagedIngenium)).toBe(before);
    const handoff = getReadyRestoreStage(globalProjectId, plan.id);
    try {
      expect(handoff.ingenium.size).toBeGreaterThan(0);
      expect(handoff.ingenium.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(handoff.ingenium).not.toHaveProperty("fd");
      expect(handoff.ingenium).not.toHaveProperty("path");
      const expectedIngenium = Buffer.from(handoff.ingenium.bytes);
      chmodSync(stagedIngenium, 0o600);
      writeFileSync(stagedIngenium, "changed stage after handoff");
      chmodSync(stagedIngenium, 0o444);
      expect(handoff.ingenium.bytes).toEqual(expectedIngenium);
    } finally {
      handoff.release();
      handoff.release();
    }
    expect(handoff.ingenium.bytes.every((byte) => byte === 0)).toBe(true);
    expect(handoff.opencode.bytes.every((byte) => byte === 0)).toBe(true);
    expect(getRestorePlan(globalProjectId, plan.id)).toMatchObject({ id: ready.id, state: "failed", revision: 4 });
  });

  it("fails a bounded handoff before allocating buffers above its configured total limit", async () => {
    const created = await snapshot();
    const plan = previewRestore(globalProjectId, { backupId: created.backupId, dryRun: true, idempotencyKey: "preview-handoff-max" });
    const authorization = authorizeRestore(globalProjectId, plan.id, plan.revision);
    confirmRestore(globalProjectId, plan.id, {
      confirmationToken: authorization.confirmationToken,
      expectedRevision: authorization.plan.revision,
      idempotencyKey: "confirm-handoff-max",
    });
    process.env.INGENIUM_RESTORE_HANDOFF_MAX_BYTES = "1";
    try {
      expect(() => getReadyRestoreStage(globalProjectId, plan.id)).toThrow(expect.objectContaining({ code: "BACKUP_INVALID" }));
    } finally {
      delete process.env.INGENIUM_RESTORE_HANDOFF_MAX_BYTES;
    }
    expect(getRestorePlan(globalProjectId, plan.id)).toMatchObject({ state: "failed", revision: 4 });
  });

  it("fails closed when a same-UID writer races staged-buffer validation", async () => {
    const created = await snapshot();
    const plan = previewRestore(globalProjectId, { backupId: created.backupId, dryRun: true, idempotencyKey: "preview-handoff-race" });
    const authorization = authorizeRestore(globalProjectId, plan.id, plan.revision);
    confirmRestore(globalProjectId, plan.id, {
      confirmationToken: authorization.confirmationToken,
      expectedRevision: authorization.plan.revision,
      idempotencyKey: "confirm-handoff-race",
    });
    const stagedIngenium = join(tempDir, "restore-staging", plan.id, "ingenium.db");
    const writer = spawn(process.execPath, ["-e", [
      "const fs = require('node:fs');",
      "const path = process.argv[1];",
      "const mutate = () => { try { fs.chmodSync(path, 0o600); fs.writeFileSync(path, Buffer.alloc(65536, 7)); fs.chmodSync(path, 0o444); } catch {} };",
      "process.stdout.write('ready\\n'); mutate(); setInterval(mutate, 1);",
    ].join(" "), stagedIngenium], { stdio: ["ignore", "pipe", "ignore"] });
    try {
      await new Promise<void>((resolve, reject) => {
        writer.once("error", reject);
        writer.stdout!.once("data", () => resolve());
      });
      expect(() => getReadyRestoreStage(globalProjectId, plan.id)).toThrow(expect.objectContaining({ code: "BACKUP_INVALID" }));
    } finally {
      writer.kill("SIGTERM");
      await new Promise<void>((resolve) => writer.once("exit", () => resolve()));
    }
    expect(getRestorePlan(globalProjectId, plan.id)).toMatchObject({ state: "failed", revision: 4 });
  });

  it("fails closed once for same-UID staged-file tampering across status, replay, and handoff", async () => {
    const created = await snapshot();
    const plan = previewRestore(globalProjectId, { backupId: created.backupId, dryRun: true, idempotencyKey: "preview-stage-tamper" });
    const authorization = authorizeRestore(globalProjectId, plan.id, plan.revision);
    confirmRestore(globalProjectId, plan.id, {
      confirmationToken: authorization.confirmationToken,
      expectedRevision: authorization.plan.revision,
      idempotencyKey: "confirm-stage-tamper",
    });
    const stagedIngenium = join(tempDir, "restore-staging", plan.id, "ingenium.db");
    chmodSync(stagedIngenium, 0o600);
    writeFileSync(stagedIngenium, "same-uid tamper");
    chmodSync(stagedIngenium, 0o444);

    expect(() => getReadyRestoreStage(globalProjectId, plan.id)).toThrow(expect.objectContaining({ code: "BACKUP_INVALID" }));
    expect(getRestorePlan(globalProjectId, plan.id)).toMatchObject({ state: "failed", revision: 4 });
    expect(confirmRestore(globalProjectId, plan.id, {
      confirmationToken: authorization.confirmationToken,
      expectedRevision: authorization.plan.revision,
      idempotencyKey: "confirm-stage-tamper",
    })).toMatchObject({ state: "failed", revision: 4 });
    expect(listRestoreAudit(globalProjectId, plan.id).filter((event) => event.eventType === "stage_integrity_failed"))
      .toHaveLength(1);
  });

  it("uses a CAS failure transition when concurrent status validation observes staged tampering", async () => {
    const created = await snapshot();
    const plan = previewRestore(globalProjectId, { backupId: created.backupId, dryRun: true, idempotencyKey: "preview-stage-race" });
    const authorization = authorizeRestore(globalProjectId, plan.id, plan.revision);
    confirmRestore(globalProjectId, plan.id, {
      confirmationToken: authorization.confirmationToken,
      expectedRevision: authorization.plan.revision,
      idempotencyKey: "confirm-stage-race",
    });
    const stagedOpenCode = join(tempDir, "restore-staging", plan.id, "opencode.db");
    chmodSync(stagedOpenCode, 0o600);
    writeFileSync(stagedOpenCode, "same-uid race tamper");
    chmodSync(stagedOpenCode, 0o444);

    const statuses = await Promise.all([
      Promise.resolve().then(() => getRestorePlan(globalProjectId, plan.id)),
      Promise.resolve().then(() => getRestorePlan(globalProjectId, plan.id)),
    ]);
    expect(statuses).toEqual([
      expect.objectContaining({ state: "failed", revision: 4 }),
      expect.objectContaining({ state: "failed", revision: 4 }),
    ]);
    expect(listRestoreAudit(globalProjectId, plan.id).filter((event) => event.eventType === "stage_integrity_failed"))
      .toHaveLength(1);
  });

  it("returns a bounded verified buffer with no retained descriptor or proc-fd backing", async () => {
    const created = await snapshot();
    const source = join(backupsDir, created.backupId, "ingenium.db");
    const expected = readFileSync(source);
    const download = readVerifiedBackupComponent(globalProjectId, created.backupId);
    try {
      expect(download.size).toBe(expected.length);
      expect(download.filename).toBe("ingenium.db");
      expect(download).not.toHaveProperty("fd");
      expect(download.bytes).toEqual(expected);
      expect(readdirSync(join(tempDir, "restore-staging")).filter((entry) => entry.startsWith(".download-"))).toEqual([]);
      writeFileSync(source, "replacement after validation");
      expect(download.bytes).toEqual(expected);
      wipeBackupDownloadBuffer(download.bytes);
      expect(download.bytes.every((byte) => byte === 0)).toBe(true);
    } finally {
      wipeBackupDownloadBuffer(download.bytes);
    }
  });

  it("rejects download buffers above the configured bound before allocation", async () => {
    const created = await snapshot();
    process.env.INGENIUM_BACKUP_DOWNLOAD_MAX_BYTES = "1";
    try {
      expect(() => readVerifiedBackupComponent(globalProjectId, created.backupId))
        .toThrow(expect.objectContaining({ code: "BACKUP_INVALID" }));
    } finally {
      delete process.env.INGENIUM_BACKUP_DOWNLOAD_MAX_BYTES;
    }
  });

  it("rehydrates a signed-capsule ledger and closes an interrupted run as rolled back", async () => {
    const created = await snapshot();
    const plan = previewRestore(globalProjectId, { backupId: created.backupId, dryRun: true, idempotencyKey: "recover-preview" });
    const confirmation = authorizeRestore(globalProjectId, plan.id, plan.revision);
    const ready = confirmRestore(globalProjectId, plan.id, {
      confirmationToken: confirmation.confirmationToken,
      expectedRevision: confirmation.plan.revision,
      idempotencyKey: "recover-confirm",
    });
    const execution = authorizeRestoreExecution(globalProjectId, ready.id, ready.revision);
    const queued = executeRestore(globalProjectId, plan.id, {
      executionToken: execution.executionToken,
      expectedRevision: execution.plan.revision,
      idempotencyKey: "recover-execute",
    });
    const owner = "o".repeat(43);
    const fence = "f".repeat(43);
    const claimed = claimPendingRestoreExecution(globalProjectId, owner, fence)!;
    const quiescing = transitionRestoreExecution(globalProjectId, claimed.id, owner, fence, claimed.revision, "quiescing");
    const capsule = captureRestoreExecutionCapsule(globalProjectId, quiescing.id);

    resetDbForTest();
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    copyFileSync(join(backupsDir, created.backupId, "ingenium.db"), dbPath);

    const recovered = recoverRestoreExecutionCapsule(capsule, "rolled_back", "SWAP_FAILED");
    expect(recovered).toMatchObject({ id: queued.run.id, state: "rolled_back", errorCode: "SWAP_FAILED" });
    expect(getRestoreExecutionRun(globalProjectId, queued.run.id)).toMatchObject({ state: "rolled_back" });
    expect(getDb(dbPath).prepare(
      "SELECT to_state FROM backup_restore_execution_events WHERE project_id = ? AND plan_id = ? ORDER BY revision ASC",
    ).all(globalProjectId, plan.id)).toEqual([
      { to_state: "execution_authorized" },
      { to_state: "queued" },
      { to_state: "executor_claimed" },
      { to_state: "rolling_back" },
      { to_state: "rolled_back" },
    ]);
  });

  it("uses the configured artifact UID rather than the validator process UID", async () => {
    const created = await snapshot();
    const expectedUid = process.env.INGENIUM_TRUSTED_ARTIFACT_UID!;
    process.env.INGENIUM_TRUSTED_ARTIFACT_UID = String(Number(expectedUid) + 1);
    try {
      expect(validateRestorePreflight(globalProjectId, created.backupId)).toMatchObject({ valid: false });
    } finally {
      process.env.INGENIUM_TRUSTED_ARTIFACT_UID = expectedUid;
    }
  });

  it("terminalizes a claimed run when privileged setup fails before journaling", async () => {
    const created = await snapshot();
    const plan = previewRestore(globalProjectId, { backupId: created.backupId, dryRun: true, idempotencyKey: "setup-failure-preview" });
    const confirmation = authorizeRestore(globalProjectId, plan.id, plan.revision);
    const ready = confirmRestore(globalProjectId, plan.id, {
      confirmationToken: confirmation.confirmationToken,
      expectedRevision: confirmation.plan.revision,
      idempotencyKey: "setup-failure-confirm",
    });
    const execution = authorizeRestoreExecution(globalProjectId, ready.id, ready.revision);
    const queued = executeRestore(globalProjectId, plan.id, {
      executionToken: execution.executionToken,
      expectedRevision: execution.plan.revision,
      idempotencyKey: "setup-failure-execute",
    });
    expect(() => getDb(dbPath).prepare(
      "UPDATE backup_restore_execution_runs SET state = 'rolling_back', phase = 'rolling_back', revision = revision + 1 WHERE project_id = ? AND id = ? AND revision = ?",
    ).run(globalProjectId, queued.run.id, queued.run.revision)).toThrow(/transition is invalid/);
    const owner = "s".repeat(43);
    const fence = "t".repeat(43);
    const claimed = claimPendingRestoreExecution(globalProjectId, owner, fence, queued.run.id)!;
    expect(failRestoreExecutionSetup(globalProjectId, claimed.id, owner, fence, claimed.revision)).toMatchObject({
      state: "executor_setup_failed", errorCode: "EXECUTOR_SETUP_FAILED", completedAt: expect.any(String),
    });
  });
});
