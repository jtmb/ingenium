import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import {
  createJob,
  getVaultSecretRunRecovery,
  markVaultJobRunCleaned,
  prepareVaultJobRun,
  recordVaultJobRunProcessIdentity,
  startJobRun,
  updateJob,
} from "../lib/tools/jobs.js";
import { createItem, initVault, sealVault, unsealVault } from "../lib/tools/vault.js";

const passphrase = "vault job run migration passphrase";
let directory = "";

function setup() {
  directory = mkdtempSync(join(tmpdir(), "ingenium-vault-job-runs-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  const project = createProject("vault-job-runs");
  initVault(project.id, passphrase);
  expect(unsealVault(project.id, passphrase).ok).toBe(true);
  const itemId = createItem(project.id, "run-secret", "api_key", "migration-canary");
  const job = createJob(project.id, "run job", undefined, "agent", "prompt", undefined, undefined, 30, [itemId]);
  const run = startJobRun(project.id, job.id, "manual");
  if ("reason" in run) throw new Error(run.reason);
  return { db: getDb(process.env.INGENIUM_CORE_DB_PATH), project, job, itemId, run };
}

function migrationFilesThrough(version: number): string[] {
  const migrations = resolve(import.meta.dirname ?? __dirname, "../data/migrations");
  return readdirSync(migrations)
    .filter((file) => /^\d{3}_.*\.sql$/.test(file) && Number(file.slice(0, 3)) <= version)
    .sort();
}

afterEach(() => {
  sealVault();
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  delete process.env.INGENIUM_CORE_DB_PATH;
});

describe("VAULT-101 durable vault job runs", () => {
  it("installs on fresh and upgrade databases without secret-bearing columns", () => {
    const { db } = setup();
    for (const table of ["job_vault_runs", "job_vault_run_items"]) {
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)).toBeTruthy();
    }
    const columns = (db.prepare("PRAGMA table_info('job_vault_runs')").all() as Array<{ name: string }>).map((column) => column.name);
    expect(columns).toEqual(expect.arrayContaining([
      "run_id", "project_id", "job_id", "state", "deadline_at", "process_nonce_hash", "revision",
    ]));
    expect(columns.filter((column) => ["secret", "path", "config", "process_nonce"].includes(column))).toEqual([]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    resetDbForTest();
    rmSync(directory, { recursive: true, force: true });
    directory = mkdtempSync(join(tmpdir(), "ingenium-vault-job-runs-upgrade-"));
    const path = join(directory, "data.db");
    const legacy = new Database(path);
    const migrations = resolve(import.meta.dirname ?? __dirname, "../data/migrations");
    for (const file of migrationFilesThrough(80)) legacy.exec(readFileSync(join(migrations, file), "utf8"));
    legacy.close();
    process.env.INGENIUM_CORE_DB_PATH = path;
    const upgraded = getDb(path);
    expect(upgraded.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'job_vault_runs'").get()).toBeTruthy();
    expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("captures immutable item snapshots, uses identity CAS, and never rereads mutable references", () => {
    const { db, project, job, itemId, run } = setup();
    const nonceHash = "a".repeat(64);
    const prepared = prepareVaultJobRun(project.id, {
      runId: run.id,
      jobId: job.id,
      deadlineAt: Date.now() + 60_000,
      processNonceHash: nonceHash,
      itemSnapshots: [{ itemId, authorizedItemVersion: 1 }],
    });
    expect(prepared).toMatchObject({ state: "prepared", processNonceHash: nonceHash, itemSnapshots: [{ itemId, authorizedItemVersion: 1 }] });
    expect(() => db.prepare("UPDATE job_vault_runs SET process_nonce_hash = ? WHERE run_id = ?").run("b".repeat(64), run.id))
      .toThrow(/immutable|revision/);
    expect(() => db.prepare("UPDATE job_vault_runs SET state = 'spawned' WHERE run_id = ?").run(run.id))
      .toThrow(/revision/);
    const spawned = recordVaultJobRunProcessIdentity(project.id, run.id, {
      processId: 123,
      processGroupId: 123,
      processStartTime: "start",
      processExecutable: "/usr/bin/opencode",
    });
    expect(spawned).toMatchObject({ state: "spawned", revision: 1 });
    expect(() => db.prepare("UPDATE job_vault_runs SET process_id = 456, revision = revision + 1 WHERE run_id = ?").run(run.id))
      .toThrow(/process identity is immutable/);
    expect(() => db.prepare("DELETE FROM job_vault_run_items WHERE run_id = ?").run(run.id))
      .toThrow(/immutable/);

    const revoked = updateJob(project.id, job.id, { vault_item_ids: [] }, job.revision);
    expect(revoked.status).toBe("updated");
    if (revoked.status !== "updated") throw new Error("expected revoked job");
    expect(revoked.job.vault_references).toEqual([]);
    expect(getVaultSecretRunRecovery(run.id)?.itemSnapshots).toEqual([{ itemId, authorizedItemVersion: 1 }]);
    expect(markVaultJobRunCleaned(project.id, run.id)?.state).toBe("cleaned");
  });
});
