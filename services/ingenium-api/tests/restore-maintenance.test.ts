import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { closeDbForMaintenance, getDb, resetDbForTest } from "../../../packages/ingenium-core/lib/db.js";
import { createProject } from "../../../packages/ingenium-core/lib/tools/projects.js";
import {
  authorizeRestore,
  authorizeRestoreExecution,
  confirmRestore,
  createSnapshot,
  executeRestore,
  getRestoreExecutionRun,
  previewRestore,
} from "../../../packages/ingenium-core/lib/tools/backups.js";

type ChildResult = { code: number | null; stdout: string; stderr: string };

let fixtureRoot: string;
let coreDbPath: string;
let openCodeDbPath: string;
let globalProjectId: string;
let runId: string;
let supervisor: Server;
let health: Server;
let healthPort: number;
const processStates = new Map<string, "RUNNING" | "STOPPED">();
const fixtureScript = resolve(__dirname, "fixtures/restore-maintenance-fixture.sh");
const maintenanceScript = resolve(__dirname, "../dist/scripts/restore-maintenance.js");

function runFixture(environment: NodeJS.ProcessEnv): Promise<ChildResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn("/bin/sh", [fixtureScript], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => resolveResult({ code, stdout, stderr }));
  });
}

async function queuePreparedRestore(idempotencyPrefix: string): Promise<string> {
  const source = await createSnapshot(globalProjectId, "manual", coreDbPath, openCodeDbPath);
  const plan = previewRestore(globalProjectId, { backupId: source.backupId, dryRun: true, idempotencyKey: `${idempotencyPrefix}-preview` });
  const authorization = authorizeRestore(globalProjectId, plan.id, plan.revision);
  const ready = confirmRestore(globalProjectId, plan.id, {
    confirmationToken: authorization.confirmationToken,
    expectedRevision: authorization.plan.revision,
    idempotencyKey: `${idempotencyPrefix}-confirm`,
  });
  const execution = authorizeRestoreExecution(globalProjectId, ready.id, ready.revision);
  const run = executeRestore(globalProjectId, ready.id, {
    executionToken: execution.executionToken,
    expectedRevision: execution.plan.revision,
    idempotencyKey: `${idempotencyPrefix}-execute`,
  }).run;
  closeDbForMaintenance();
  return run.id;
}

function supervisorResponse(state: "RUNNING" | "STOPPED"): string {
  return `<methodResponse><params><param><value><struct><member><name>statename</name><value><string>${state}</string></value></member></struct></value></param></params></methodResponse>`;
}

beforeAll(async () => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "ingenium-restore-fixture-"));
  coreDbPath = join(fixtureRoot, "data");
  openCodeDbPath = join(fixtureRoot, "opencode.db");
  const backupsDir = join(fixtureRoot, "backups");
  const stagingDir = join(fixtureRoot, "restore-staging");
  const maintenanceDir = join(fixtureRoot, "maintenance");
  const signingKeyPath = join(fixtureRoot, "backup-signing-key");
  const journalKeyPath = join(fixtureRoot, "restore-journal-key");
  const tokenPath = join(fixtureRoot, "api-token");
  mkdirSync(maintenanceDir, { mode: 0o700 });
  chmodSync(maintenanceDir, 0o700);
  writeFileSync(signingKeyPath, Buffer.alloc(32, 19), { mode: 0o600 });
  writeFileSync(journalKeyPath, Buffer.alloc(32, 23), { mode: 0o600 });
  writeFileSync(tokenPath, "t".repeat(43), { mode: 0o600 });
  process.env.INGENIUM_CORE_DB_PATH = coreDbPath;
  process.env.INGENIUM_BACKUPS_DIR = backupsDir;
  process.env.INGENIUM_RESTORE_STAGING_DIR = stagingDir;
  process.env.INGENIUM_BACKUP_SIGNING_KEY_FILE = signingKeyPath;
  process.env.OPENCODE_DB_PATH = openCodeDbPath;
  process.env.INGENIUM_TRUSTED_ARTIFACT_UID = String(process.getuid?.() ?? 0);
  process.env.INGENIUM_TRUSTED_ARTIFACT_GID = String(process.getgid?.() ?? 0);

  getDb(coreDbPath);
  globalProjectId = createProject("global-default", true).id;
  createProject("source-only");
  const openCode = new Database(openCodeDbPath);
  openCode.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY); INSERT INTO sessions VALUES ('source');");
  openCode.close();
  const source = await createSnapshot(globalProjectId, "manual", coreDbPath, openCodeDbPath);
  createProject("live-only");
  const liveOpenCode = new Database(openCodeDbPath);
  liveOpenCode.exec("DELETE FROM sessions; INSERT INTO sessions VALUES ('live');");
  liveOpenCode.close();

  const plan = previewRestore(globalProjectId, { backupId: source.backupId, dryRun: true, idempotencyKey: "fixture-preview" });
  const authorization = authorizeRestore(globalProjectId, plan.id, plan.revision);
  const ready = confirmRestore(globalProjectId, plan.id, {
    confirmationToken: authorization.confirmationToken,
    expectedRevision: authorization.plan.revision,
    idempotencyKey: "fixture-confirm",
  });
  const execution = authorizeRestoreExecution(globalProjectId, ready.id, ready.revision);
  runId = executeRestore(globalProjectId, ready.id, {
    executionToken: execution.executionToken,
    expectedRevision: execution.plan.revision,
    idempotencyKey: "fixture-execute",
  }).run.id;
  closeDbForMaintenance();

  for (const name of ["ttyd-opencode", "vscode", "opencode-web", "ingenium-api"]) processStates.set(name, "RUNNING");
  supervisor = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; });
    request.on("end", () => {
      const program = body.match(/<string>([^<]+)<\/string>/)?.[1];
      if (program && body.includes("stopProcess")) processStates.set(program, "STOPPED");
      if (program && body.includes("startProcess")) processStates.set(program, "RUNNING");
      response.writeHead(200, { "Content-Type": "text/xml" });
      response.end(supervisorResponse(program ? processStates.get(program) ?? "STOPPED" : "STOPPED"));
    });
  });
  await new Promise<void>((resolveServer) => supervisor.listen(9001, "127.0.0.1", resolveServer));

  health = createServer((request, response) => {
    if (request.url === "/api/v1/health" && request.headers.authorization === `Bearer ${"t".repeat(43)}`) {
      response.writeHead(200).end("{}")
      return;
    }
    response.writeHead(401).end();
  });
  await new Promise<void>((resolveServer) => health.listen(0, "127.0.0.1", () => {
    healthPort = (health.address() as AddressInfo).port;
    resolveServer();
  }));
});

afterAll(async () => {
  if (supervisor) await new Promise<void>((resolveServer) => supervisor.close(() => resolveServer()));
  if (health) await new Promise<void>((resolveServer) => health.close(() => resolveServer()));
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  delete process.env.INGENIUM_BACKUPS_DIR;
  delete process.env.INGENIUM_RESTORE_STAGING_DIR;
  delete process.env.INGENIUM_BACKUP_SIGNING_KEY_FILE;
  delete process.env.OPENCODE_DB_PATH;
  delete process.env.INGENIUM_TRUSTED_ARTIFACT_UID;
  delete process.env.INGENIUM_TRUSTED_ARTIFACT_GID;
  const stagingRoot = join(fixtureRoot, "restore-staging");
  if (existsSync(stagingRoot)) {
    for (const entry of readdirSync(stagingRoot)) chmodSync(join(stagingRoot, entry), 0o700);
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("RESTORE-101 disposable maintenance fixture", () => {
  it("refuses persistent container volume paths", async () => {
    const result = await runFixture({ INGENIUM_RESTORE_FIXTURE_ROOT: "/app/.ingenium" });
    expect(result).toMatchObject({ code: 64, stderr: expect.stringContaining("disposable") });
  });

  it("rejects a same-UID forged active journal before touching either database", async () => {
    writeFileSync(join(fixtureRoot, "maintenance", "journal.json"), JSON.stringify({
      version: 1,
      runId,
      phase: "completed",
      capsule: {},
      targets: {},
      hmac: "0".repeat(64),
    }), { mode: 0o600 });
    const result = await runFixture({
      INGENIUM_RESTORE_FIXTURE_ROOT: fixtureRoot,
      RESTORE_FIXTURE_MODE: "recover",
      INGENIUM_API_PORT: String(healthPort),
      INGENIUM_TRUSTED_ARTIFACT_UID: String(process.getuid?.() ?? 0),
      INGENIUM_TRUSTED_ARTIFACT_GID: String(process.getgid?.() ?? 0),
      RESTORE_MAINTENANCE_NODE: process.execPath,
      RESTORE_MAINTENANCE_SCRIPT: maintenanceScript,
    });
    expect(result).toMatchObject({ code: 1, stderr: expect.stringContaining("JOURNAL_INVALID") });
    rmSync(join(fixtureRoot, "maintenance", "journal.json"));
  });

  it("applies only the prepared paired fixture and restarts every stopped user", async () => {
    const {
      INGENIUM_CORE_DB_PATH: _coreDbPath,
      OPENCODE_DB_PATH: _openCodeDbPath,
      INGENIUM_RESTORE_MAINTENANCE_DIR: _maintenanceDir,
      ...cleanEnvironment
    } = process.env;
    const result = await runFixture({
      ...cleanEnvironment,
      INGENIUM_RESTORE_FIXTURE_ROOT: fixtureRoot,
      INGENIUM_API_PORT: String(healthPort),
      INGENIUM_API_TOKEN_FILE: join(fixtureRoot, "api-token"),
      INGENIUM_TRUSTED_ARTIFACT_UID: String(process.getuid?.() ?? 0),
      INGENIUM_TRUSTED_ARTIFACT_GID: String(process.getgid?.() ?? 0),
      RESTORE_MAINTENANCE_NODE: process.execPath,
      RESTORE_MAINTENANCE_SCRIPT: maintenanceScript,
    });

    expect(result, result.stderr).toMatchObject({ code: 0, stderr: "" });
    expect(getDb(coreDbPath).prepare("SELECT name FROM projects WHERE name = 'live-only'").get()).toBeUndefined();
    expect(getRestoreExecutionRun(globalProjectId, runId)).toMatchObject({ state: "completed" });
    const restoredOpenCode = new Database(openCodeDbPath, { readonly: true });
    try {
      expect(restoredOpenCode.prepare("SELECT id FROM sessions").all()).toEqual([{ id: "source" }]);
    } finally {
      restoredOpenCode.close();
    }
    expect([...processStates.values()]).toEqual(["RUNNING", "RUNNING", "RUNNING", "RUNNING"]);
    expect(existsSync(`${coreDbPath}-wal`)).toBe(true);
    expect(existsSync(`${coreDbPath}-shm`)).toBe(true);
    expect(existsSync(`${openCodeDbPath}-wal`)).toBe(true);
    expect(existsSync(`${openCodeDbPath}-shm`)).toBe(true);
    expect(existsSync(join(fixtureRoot, "maintenance", "journal.json"))).toBe(false);
    expect(existsSync(join(fixtureRoot, "maintenance", "lock"))).toBe(false);
    expect(readdirSync(join(fixtureRoot, "maintenance", "archive"))).toHaveLength(1);
  });

  it("fails closed for injected unreadable proc fd directories and descriptors", async () => {
    for (const fault of ["fd-dir", "fd"] as const) {
      const faultRunId = await queuePreparedRestore(`proc-${fault}`);
      expect(getRestoreExecutionRun(globalProjectId, faultRunId)).toMatchObject({ state: "queued" });
      const result = await runFixture({
        INGENIUM_RESTORE_FIXTURE_ROOT: fixtureRoot,
        INGENIUM_API_PORT: String(healthPort),
        INGENIUM_TRUSTED_ARTIFACT_UID: String(process.getuid?.() ?? 0),
        INGENIUM_TRUSTED_ARTIFACT_GID: String(process.getgid?.() ?? 0),
        RESTORE_FIXTURE_PROC_FAULT: fault,
        RESTORE_MAINTENANCE_NODE: process.execPath,
        RESTORE_MAINTENANCE_SCRIPT: maintenanceScript,
      });
      expect(result).toMatchObject({ code: 1, stderr: expect.stringContaining("HOLDER_REFUSED") });
      expect(getRestoreExecutionRun(globalProjectId, faultRunId)).toMatchObject({ state: "rolled_back" });
      expect(existsSync(join(fixtureRoot, "maintenance", "journal.json"))).toBe(false);
    }
  });

  it("denies a delayed hardlink open after target locking", async () => {
    const alias = join(fixtureRoot, "delayed-open-alias");
    const faultRunId = await queuePreparedRestore("delayed-hardlink");
    linkSync(coreDbPath, alias);
    const child = spawn(process.execPath, ["-e", [
      "const fs = require('node:fs');",
      "const [ready, target, result] = process.argv.slice(1);",
      "process.stdout.write('ready\\n');",
      "const timer = setInterval(() => { if (!fs.existsSync(ready)) return; try { fs.openSync(target, 'r'); fs.writeFileSync(result, 'OPENED'); } catch (error) { fs.writeFileSync(result, error.code); } clearInterval(timer); process.exit(0); }, 5);",
    ].join(" "), join(fixtureRoot, "target-lock.ready"), alias, join(fixtureRoot, "target-lock.result")], { stdio: ["ignore", "pipe", "ignore"] });
    try {
      await new Promise<void>((resolveReady, reject) => { child.once("error", reject); child.stdout!.once("data", () => resolveReady()); });
      const result = await runFixture({
        INGENIUM_RESTORE_FIXTURE_ROOT: fixtureRoot,
        INGENIUM_API_PORT: String(healthPort),
        INGENIUM_TRUSTED_ARTIFACT_UID: String(process.getuid?.() ?? 0),
        INGENIUM_TRUSTED_ARTIFACT_GID: String(process.getgid?.() ?? 0),
        RESTORE_FIXTURE_TARGET_LOCK_PROBE: "1",
        RESTORE_MAINTENANCE_NODE: process.execPath,
        RESTORE_MAINTENANCE_SCRIPT: maintenanceScript,
      });
      expect(result, result.stderr).toMatchObject({ code: 0, stderr: "" });
      expect(getRestoreExecutionRun(globalProjectId, faultRunId)).toMatchObject({ state: "completed" });
    } finally {
      if (child.exitCode === null) await new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
      if (existsSync(alias)) unlinkSync(alias);
    }
  });

  it("rejects an already-open hardlink alias by inode", async () => {
    const alias = join(fixtureRoot, "already-open-alias");
    const faultRunId = await queuePreparedRestore("open-hardlink");
    linkSync(coreDbPath, alias);
    const child = spawn(process.execPath, ["-e", [
      "const fs = require('node:fs');",
      "const fd = fs.openSync(process.argv[1], 'r');",
      "process.stdout.write(String(fd) + '\\n');",
      "setInterval(() => fd, 1000);",
    ].join(" "), alias], { stdio: ["ignore", "pipe", "ignore"] });
    try {
      const fd = await new Promise<string>((resolveFd, reject) => {
        child.once("error", reject);
        child.stdout!.once("data", (data: Buffer) => resolveFd(data.toString().trim()));
      });
      const procRoot = join(fixtureRoot, "proc-open-alias");
      mkdirSync(join(procRoot, "1", "fd"), { recursive: true });
      symlinkSync(`/proc/${child.pid}/fd/${fd}`, join(procRoot, "1", "fd", "0"));
      const result = await runFixture({
        INGENIUM_RESTORE_FIXTURE_ROOT: fixtureRoot,
        INGENIUM_API_PORT: String(healthPort),
        INGENIUM_TRUSTED_ARTIFACT_UID: String(process.getuid?.() ?? 0),
        INGENIUM_TRUSTED_ARTIFACT_GID: String(process.getgid?.() ?? 0),
        RESTORE_FIXTURE_PROC_ROOT: procRoot,
        RESTORE_MAINTENANCE_NODE: process.execPath,
        RESTORE_MAINTENANCE_SCRIPT: maintenanceScript,
      });
      expect(result).toMatchObject({ code: 1, stderr: expect.stringContaining("HOLDER_REFUSED") });
      expect(getRestoreExecutionRun(globalProjectId, faultRunId)).toMatchObject({ state: "rolled_back" });
    } finally {
      child.kill("SIGTERM");
      if (child.exitCode === null) await new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
      if (existsSync(alias)) unlinkSync(alias);
    }
  });
});
