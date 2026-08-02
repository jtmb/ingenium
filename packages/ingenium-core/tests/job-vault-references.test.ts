import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import {
  JOB_VAULT_REFERENCE_MAX,
  JobVaultReferenceError,
  createJob,
  deleteJob,
  getJob,
  listJobs,
  updateJob,
} from "../lib/tools/jobs.js";
import { createItem, deleteItem, initVault, sealVault, unsealVault, updateItem } from "../lib/tools/vault.js";

const passphrase = "job vault reference test passphrase";
const originalPath = process.env.INGENIUM_CORE_DB_PATH;
let directory = "";

function setup() {
  directory = mkdtempSync(join(tmpdir(), "ingenium-job-vault-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
  const first = createProject("job-vault-first");
  const second = createProject("job-vault-second");
  initVault(first.id, passphrase);
  expect(unsealVault(first.id, passphrase).ok).toBe(true);
  return { db, first, second };
}

function item(projectId: string, name: string, value = `secret-${name}`): string {
  return createItem(projectId, name, "api_key", value);
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
  if (originalPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalPath;
});

describe("VAULT-100 migration", () => {
  it("installs on fresh and upgrade databases with restrictive, metadata-only schema", () => {
    const { db } = setup();
    for (const table of ["job_vault_references", "job_vault_reference_audit"]) {
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)).toBeTruthy();
    }
    const auditColumns = (db.prepare("PRAGMA table_info('job_vault_reference_audit')").all() as Array<{ name: string }>)
      .map((column) => column.name);
    expect(auditColumns).toEqual([
      "id", "project_id", "job_id", "item_id", "authorized_item_version", "action", "actor", "created_at",
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    resetDbForTest();
    rmSync(directory, { recursive: true, force: true });
    directory = mkdtempSync(join(tmpdir(), "ingenium-job-vault-upgrade-"));
    const path = join(directory, "data.db");
    const legacy = new Database(path);
    const migrations = resolve(import.meta.dirname ?? __dirname, "../data/migrations");
    for (const file of migrationFilesThrough(79)) legacy.exec(readFileSync(join(migrations, file), "utf8"));
    legacy.close();

    process.env.INGENIUM_CORE_DB_PATH = path;
    const upgraded = getDb(path);
    expect(upgraded.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'job_vault_references'").get()).toBeTruthy();
    expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("enforces active same-project items and the direct-SQL authorization cap", () => {
    const { db, first, second } = setup();
    const job = createJob(first.id, "Direct SQL", undefined, "agent", "prompt");
    const foreign = item(second.id, "foreign");
    const insert = db.prepare(
      `INSERT INTO job_vault_references
       (project_id, job_id, item_id, authorized_at, authorized_item_version, status)
       VALUES (?, ?, ?, ?, 1, 'authorized')`,
    );
    expect(() => insert.run(first.id, job.id, foreign, new Date().toISOString())).toThrow(/active in the same project/);

    const itemIds = Array.from({ length: JOB_VAULT_REFERENCE_MAX + 1 }, (_, index) => item(first.id, `direct-${index}`));
    for (const itemId of itemIds.slice(0, JOB_VAULT_REFERENCE_MAX)) {
      expect(() => insert.run(first.id, job.id, itemId, new Date().toISOString())).not.toThrow();
    }
    expect(() => insert.run(first.id, job.id, itemIds[JOB_VAULT_REFERENCE_MAX]!, new Date().toISOString()))
      .toThrow(/limit exceeded/);
  });
});

describe("VAULT-100 core job authorization", () => {
  it("defaults to no references and rejects duplicate or over-limit IDs", () => {
    const { first } = setup();
    const vaultItem = item(first.id, "dedupe");
    expect(createJob(first.id, "No references", undefined, "agent", "prompt").vault_references).toEqual([]);
    expect(() => createJob(first.id, "Duplicate", undefined, "agent", "prompt", undefined, undefined, undefined, [vaultItem, vaultItem]))
      .toThrow(expect.objectContaining({ code: "INVALID_VAULT_ITEM_IDS" }));
    expect(() => createJob(
      first.id,
      "Over limit",
      undefined,
      "agent",
      "prompt",
      undefined,
      undefined,
      undefined,
      Array.from({ length: JOB_VAULT_REFERENCE_MAX + 1 }, () => vaultItem),
    )).toThrow(expect.objectContaining({ code: "INVALID_VAULT_ITEM_IDS" }));
  });

  it("uses one not-found error for missing, deleted, and foreign items", () => {
    const { first, second } = setup();
    const deleted = item(first.id, "deleted");
    const foreign = item(second.id, "foreign");
    deleteItem(first.id, deleted);
    for (const itemIds of [["00000000-0000-4000-8000-000000000001"], [deleted], [foreign]]) {
      expect(() => createJob(first.id, "Unavailable", undefined, "agent", "prompt", undefined, undefined, undefined, itemIds))
        .toThrow(expect.objectContaining({ code: "VAULT_ITEM_NOT_FOUND" } satisfies Partial<JobVaultReferenceError>));
    }
  });

  it("replaces exactly, preserves omitted references, revokes explicitly, and audits only transitions", () => {
    const { db, first } = setup();
    const firstItem = item(first.id, "first");
    const secondItem = item(first.id, "second");
    const job = createJob(first.id, "Replace", undefined, "agent", "prompt", undefined, undefined, undefined, [firstItem, secondItem]);
    expect(job.vault_references.map((reference) => reference.item_id).sort()).toEqual([firstItem, secondItem].sort());
    expect(db.prepare("SELECT action FROM job_vault_reference_audit WHERE job_id = ? ORDER BY rowid").all(job.id))
      .toEqual([{ action: "authorized" }, { action: "authorized" }]);

    const preserved = updateJob(first.id, job.id, { name: "Renamed" })!;
    expect(preserved.vault_references).toHaveLength(2);
    expect(db.prepare("SELECT count(*) AS count FROM job_vault_reference_audit WHERE job_id = ?").get(job.id))
      .toEqual({ count: 2 });

    expect(updateJob(first.id, job.id, { vault_item_ids: [] })!.vault_references).toEqual([]);
    expect(db.prepare("SELECT action FROM job_vault_reference_audit WHERE job_id = ? ORDER BY rowid").all(job.id))
      .toEqual([
        { action: "authorized" }, { action: "authorized" }, { action: "revoked" }, { action: "revoked" },
      ]);

    const reauthorized = updateJob(first.id, job.id, { vault_item_ids: [secondItem] })!;
    expect(reauthorized.vault_references).toHaveLength(1);
    expect(reauthorized.vault_references[0]).toMatchObject({ item_id: secondItem, availability: "available", item_version: 1 });
    const audit = db.prepare("SELECT id FROM job_vault_reference_audit WHERE job_id = ? ORDER BY rowid").all(job.id) as Array<{ id: string }>;
    expect(audit).toHaveLength(5);
    expect(() => db.prepare("UPDATE job_vault_reference_audit SET action = 'revoked' WHERE id = ?").run(audit[0]!.id)).toThrow(/immutable/);
    expect(() => db.prepare("DELETE FROM job_vault_reference_audit WHERE id = ?").run(audit[0]!.id)).toThrow(/immutable/);
  });

  it("works while sealed, retains item-version provenance, and preserves evidence after soft deletes", () => {
    const { db, first } = setup();
    const vaultItem = item(first.id, "versioned", "canary-vault-secret");
    const job = createJob(first.id, "Sealed", undefined, "agent", "prompt", undefined, undefined, undefined, [vaultItem]);
    expect(job.vault_references[0]).toMatchObject({ item_id: vaultItem, item_version: 1, availability: "available" });

    updateItem(first.id, vaultItem, "rotated-canary-vault-secret");
    expect(getJob(first.id, job.id)!.vault_references[0]).toMatchObject({ item_version: 1, availability: "available" });

    sealVault();
    expect(createJob(first.id, "Still sealed", undefined, "agent", "prompt", undefined, undefined, undefined, [vaultItem]).vault_references)
      .toEqual([expect.objectContaining({ item_id: vaultItem, item_version: 2, availability: "available" })]);
    expect(listJobs(first.id).find((candidate) => candidate.id === job.id)?.vault_references[0]?.item_id).toBe(vaultItem);

    expect(unsealVault(first.id, passphrase).ok).toBe(true);
    deleteItem(first.id, vaultItem);
    expect(getJob(first.id, job.id)!.vault_references[0]).toMatchObject({ item_id: vaultItem, availability: "unavailable", item_version: 1 });
    expect(() => db.prepare("DELETE FROM vault_items WHERE project_id = ? AND id = ?").run(first.id, vaultItem)).toThrow(/FOREIGN KEY/);
    expect(deleteJob(first.id, job.id)).toEqual({ status: "deleted" });
    expect(db.prepare("SELECT count(*) AS count FROM job_vault_references WHERE job_id = ?").get(job.id)).toEqual({ count: 1 });
    expect(db.prepare("SELECT count(*) AS count FROM job_vault_reference_audit WHERE job_id = ?").get(job.id)).toEqual({ count: 1 });
    const persisted = JSON.stringify({
      jobs: db.prepare("SELECT * FROM jobs WHERE id = ?").all(job.id),
      references: db.prepare("SELECT * FROM job_vault_references WHERE job_id = ?").all(job.id),
      audits: db.prepare("SELECT * FROM job_vault_reference_audit WHERE job_id = ?").all(job.id),
      deliveries: db.prepare("SELECT * FROM job_event_deliveries WHERE job_id = ?").all(job.id),
      logs: db.prepare(
        "SELECT log.* FROM job_run_logs log JOIN job_runs run ON run.id = log.run_id WHERE run.job_id = ?",
      ).all(job.id),
    });
    expect(persisted).not.toContain("canary-vault-secret");
  });
});
