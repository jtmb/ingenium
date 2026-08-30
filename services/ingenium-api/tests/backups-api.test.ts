import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { getDb, resetDbForTest } from "../../../packages/ingenium-core/lib/db.js";
import { createProject } from "../../../packages/ingenium-core/lib/tools/projects.js";
import { backupsRouter } from "../lib/routes/backups.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

const tempDir = mkdtempSync(join(tmpdir(), "ingenium-restore-api-"));
const coreDbPath = join(tempDir, "data");
const backupsDir = join(tempDir, "backups");
const opencodeDbPath = join(tempDir, "opencode.db");
const signingKeyPath = join(tempDir, "backup-signing-key");

process.env.INGENIUM_CORE_DB_PATH = coreDbPath;
process.env.INGENIUM_BACKUPS_DIR = backupsDir;
process.env.OPENCODE_DB_PATH = opencodeDbPath;
process.env.INGENIUM_BACKUP_SIGNING_KEY_FILE = signingKeyPath;
process.env.INGENIUM_TRUSTED_ARTIFACT_UID = String(process.getuid?.() ?? 0);
process.env.INGENIUM_TRUSTED_ARTIFACT_GID = String(process.getgid?.() ?? 0);

let server: Server;
let baseUrl: string;

function url(path: string, project = "external-project"): string {
  return `${baseUrl}/api/v1/backups${path}?project=${project}`;
}

async function createBackup(): Promise<any> {
  const response = await fetch(url(""), { method: "POST", headers: { "Content-Type": "application/json" } });
  expect(response.status).toBe(201);
  return (await response.json()).data;
}

beforeAll(async () => {
  writeFileSync(signingKeyPath, Buffer.alloc(32, 3), { mode: 0o600 });
  chmodSync(signingKeyPath, 0o600);
  getDb(coreDbPath);
  const opencode = new Database(opencodeDbPath);
  opencode.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY)");
  opencode.close();
  createProject("global-default", true);
  createProject("external-project");

  const app = express();
  app.use(express.json());
  app.use("/api/v1/backups", backupsRouter);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});

afterAll(async () => {
  if (server) await closeHttpServer(server);
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  delete process.env.INGENIUM_BACKUPS_DIR;
  delete process.env.OPENCODE_DB_PATH;
  delete process.env.INGENIUM_BACKUP_SIGNING_KEY_FILE;
  delete process.env.INGENIUM_TRUSTED_ARTIFACT_UID;
  delete process.env.INGENIUM_TRUSTED_ARTIFACT_GID;
  const stagingRoot = join(tempDir, "restore-staging");
  if (existsSync(stagingRoot)) {
    for (const entry of readdirSync(stagingRoot)) chmodSync(join(stagingRoot, entry), 0o700);
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("RESTORE-100 backup API", () => {
  it("uses the active global project consistently and exposes only content-free v2 backup metadata", async () => {
    const backup = await createBackup();
    expect(backup).toMatchObject({ id: expect.any(String), filename: backup.id, status: "completed" });
    const foreign = await fetch(url(""));
    const unknown = await fetch(url("", "does-not-exist"));
    expect(foreign.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(JSON.stringify(await foreign.json())).not.toContain(tempDir);
    expect(JSON.stringify(backup)).not.toMatch(/signature|components|manifest/i);
  });

  it("requires the exact preview contract and makes the plan durable/idempotent", async () => {
    const backup = await createBackup();
    const invalid = await fetch(url("/restore/preview"), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backupId: backup.id }),
    });
    expect(invalid.status).toBe(422);
    const first = await fetch(url("/restore/preview"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backupId: backup.id, dryRun: true, idempotencyKey: "api-preview" }),
    });
    expect(first.status).toBe(201);
    const plan = (await first.json()).data;
    expect(plan).toMatchObject({ backupId: backup.id, state: "previewed", revision: 0, dryRun: true, blockers: [] });
    expect(JSON.stringify(plan)).not.toMatch(/token|signature|components|path/i);
    const replay = await fetch(url("/restore/preview"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backupId: backup.id, dryRun: true, idempotencyKey: "api-preview" }),
    });
    expect((await replay.json()).data.id).toBe(plan.id);
    const distinct = await fetch(url("/restore/preview"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backupId: backup.id, dryRun: true, idempotencyKey: "api-preview-distinct" }),
    });
    expect((await distinct.json()).data.id).not.toBe(plan.id);
    const fetched = await fetch(url(`/restore/${plan.id}`));
    expect((await fetched.json()).data).toMatchObject({ id: plan.id, state: "previewed" });
  });

  it("requires a distinct execution authorization, queues a fixed executor, and never exposes runtime internals", async () => {
    const backup = await createBackup();
    const preview = await fetch(url("/restore/preview"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backupId: backup.id, dryRun: true, idempotencyKey: "api-confirm-preview" }),
    });
    const plan = (await preview.json()).data;
    const legacy = await fetch(url("/restore"), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ backupId: backup.id, confirm: true }),
    });
    expect(legacy.status).toBe(410);
    expect((await legacy.json()).error.code).toBe("RESTORE_MIGRATION_REQUIRED");

    const authorized = await fetch(url(`/restore/${plan.id}/authorize`), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: 0 }),
    });
    expect(authorized.status).toBe(200);
    const authorization = (await authorized.json()).data;
    expect(authorization.plan).toMatchObject({ state: "authorized", revision: 1 });
    expect(authorization.confirmationToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);

    const status = await fetch(url(`/restore/${plan.id}`));
    expect(JSON.stringify(await status.json())).not.toContain(authorization.confirmationToken);
    const confirmed = await fetch(url(`/restore/${plan.id}/confirm`), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmationToken: authorization.confirmationToken,
        expectedRevision: authorization.plan.revision,
        idempotencyKey: "api-confirm",
      }),
    });
    expect(confirmed.status).toBe(200);
    expect((await confirmed.json()).data).toMatchObject({ state: "ready_for_executor", revision: 3 });
    const executionAuthorization = await fetch(url(`/restore/${plan.id}/execution/authorize`), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: 3 }),
    });
    expect(executionAuthorization.status).toBe(200);
    const execution = (await executionAuthorization.json()).data;
    expect(execution).toMatchObject({ plan: { state: "execution_authorized", revision: 4 }, executionToken: expect.stringMatching(/^[A-Za-z0-9_-]{32,}$/) });
    expect(JSON.stringify(execution.plan)).not.toContain(execution.executionToken);
    const executor = await fetch(url(`/restore/${plan.id}/execute`), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ executionToken: execution.executionToken, expectedRevision: execution.plan.revision, idempotencyKey: "api-execute" }),
    });
    // No Supervisor is listening in this API-only test. The route must not
    // acknowledge work that no static maintenance process can consume.
    expect(executor.status).toBe(503);
    expect((await executor.json()).error).toMatchObject({ code: "SUPERVISOR_FAILED" });
    const audit = await fetch(`${baseUrl}/api/v1/backups/restore/${plan.id}/audit?project=external-project&limit=100`);
    expect((await audit.json()).data.map((event: { toState: string }) => event.toState).reverse())
      .toEqual(["previewed", "authorized", "confirmed", "ready_for_executor", "execution_authorized", "queued", "executor_start_failed"]);
  });

  it("fails content-free status and confirm replay after same-UID staged-file tampering", async () => {
    const backup = await createBackup();
    const preview = await fetch(url("/restore/preview"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backupId: backup.id, dryRun: true, idempotencyKey: "api-stage-tamper-preview" }),
    });
    const plan = (await preview.json()).data;
    const authorized = await fetch(url(`/restore/${plan.id}/authorize`), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: plan.revision }),
    });
    const authorization = (await authorized.json()).data;
    const confirmBody = {
      confirmationToken: authorization.confirmationToken,
      expectedRevision: authorization.plan.revision,
      idempotencyKey: "api-stage-tamper-confirm",
    };
    expect((await fetch(url(`/restore/${plan.id}/confirm`), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(confirmBody),
    })).status).toBe(200);

    const stagedIngenium = join(tempDir, "restore-staging", plan.id, "ingenium.db");
    chmodSync(stagedIngenium, 0o600);
    writeFileSync(stagedIngenium, "same-uid tamper");
    chmodSync(stagedIngenium, 0o444);

    const status = await fetch(url(`/restore/${plan.id}`));
    const statusBody = await status.json();
    expect(status.status).toBe(200);
    expect(statusBody.data).toMatchObject({ state: "failed", revision: 4 });
    expect(JSON.stringify(statusBody)).not.toMatch(/path|stage_hash|components|token/i);
    const replay = await fetch(url(`/restore/${plan.id}/confirm`), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(confirmBody),
    });
    expect((await replay.json()).data).toMatchObject({ state: "failed", revision: 4 });
    const audit = await fetch(`${baseUrl}/api/v1/backups/restore/${plan.id}/audit?project=external-project&limit=100`);
    expect((await audit.json()).data.filter((event: { eventType: string }) => event.eventType === "stage_integrity_failed"))
      .toHaveLength(1);
  });

  it("downloads only a verified in-memory buffer with fixed metadata and wipes it after response", async () => {
    const backup = await createBackup();
    const fill = vi.spyOn(Buffer.prototype, "fill");
    try {
      const response = await fetch(url(`/${backup.id}/download`));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/vnd.sqlite3");
      expect(response.headers.get("content-disposition")).toBe('attachment; filename="ingenium.db"');
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
      await vi.waitFor(() => expect(fill).toHaveBeenCalledWith(0));
    } finally {
      fill.mockRestore();
    }
  });

  it("rejects source-bundle deletion after any durable restore plan", async () => {
    const backup = await createBackup();
    const preview = await fetch(url("/restore/preview"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backupId: backup.id, dryRun: true, idempotencyKey: "api-delete-preview" }),
    });
    expect(preview.status).toBe(201);
    const deleted = await fetch(url(`/${backup.id}`), { method: "DELETE" });
    expect(deleted.status).toBe(409);
    expect((await deleted.json()).error.code).toBe("BACKUP_REFERENCED");
  });
});
