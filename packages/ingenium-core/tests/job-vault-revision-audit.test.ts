import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import { createJob, finishJobRun, listJobVaultAudit, startJobRun, updateJob } from "../lib/tools/jobs.js";
import { VaultJobSecretsUnavailableError, createItem, initVault, resolveJobVaultSecrets, sealVault, unsealVault } from "../lib/tools/vault.js";

const passphrase = "vault revision audit passphrase";
let directory = "";

function setup() {
  directory = mkdtempSync(join(tmpdir(), "ingenium-job-vault-revision-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  const project = createProject("job-vault-revision");
  const secondProject = createProject("job-vault-revision-second");
  initVault(project.id, passphrase);
  expect(unsealVault(project.id, passphrase).ok).toBe(true);
  return { db: getDb(), project, secondProject };
}

afterEach(() => {
  sealVault();
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  delete process.env.INGENIUM_CORE_DB_PATH;
});

describe("VAULT-102 revisioned job vault authorization", () => {
  it("adds a default-zero revision, enforces direct SQL monotonicity, and reports a typed CAS conflict", () => {
    const { db, project } = setup();
    const job = createJob(project.id, "revisioned", undefined, "agent", "prompt");
    expect(job.revision).toBe(0);
    expect(db.prepare("PRAGMA table_info('jobs')").all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "revision", dflt_value: "0" }),
    ]));
    expect(() => db.prepare("UPDATE jobs SET name = ? WHERE id = ?").run("unsafe", job.id)).toThrow(/revision must advance/);

    const updated = updateJob(project.id, job.id, { enabled: false }, 0);
    expect(updated.status).toBe("updated");
    if (updated.status !== "updated") throw new Error("expected updated job");
    expect(updated.job.revision).toBe(1);
    expect(updateJob(project.id, job.id, { name: "stale writer" }, 0)).toEqual({
      status: "revision_conflict",
      currentRevision: 1,
    });
  });

  it("projects statuses sealed-independently and joins immutable authorization/runtime audit by exact run ownership", () => {
    const { db, project, secondProject } = setup();
    const itemId = createItem(project.id, "runner", "api_key", "revision-audit-canary");
    const job = createJob(project.id, "audit job", undefined, "agent", "prompt", undefined, undefined, 30, [itemId]);
    const run = startJobRun(project.id, job.id, "manual");
    if ("reason" in run) throw new Error(run.reason);

    const resolved = resolveJobVaultSecrets(project.id, job.id, run.id)!;
    resolved.release();
    finishJobRun(project.id, run.id, "success", 0);

    const deniedRun = startJobRun(project.id, job.id, "manual");
    if ("reason" in deniedRun) throw new Error(deniedRun.reason);
    sealVault();
    expect(() => resolveJobVaultSecrets(project.id, job.id, deniedRun.id)).toThrow(VaultJobSecretsUnavailableError);

    const firstPage = listJobVaultAudit(project.id, job.id, { limit: 1 });
    expect(firstPage?.nextCursor).toEqual(expect.any(String));
    const page = listJobVaultAudit(project.id, job.id, { limit: 100 });
    expect(page?.data).toHaveLength(3);
    expect(page?.data.map((entry) => entry.action)).toEqual(expect.arrayContaining(["authorized", "secret_read", "access_denied"]));
    expect(page?.data.every((entry) => Object.keys(entry).sort().join(",") === "action,actor_category,id,item_id,job_id,run_id,timestamp,version")).toBe(true);
    expect(JSON.stringify(page)).not.toContain("revision-audit-canary");
    expect(listJobVaultAudit(secondProject.id, job.id)).toBeUndefined();

    const runtime = db.prepare("SELECT run_id FROM job_vault_runtime_audit WHERE project_id = ? AND job_id = ?").all(project.id, job.id);
    expect(runtime).toEqual(expect.arrayContaining([{ run_id: run.id }, { run_id: deniedRun.id }]));
    expect(() => db.prepare(
      `INSERT INTO job_vault_runtime_audit
       (id, project_id, job_id, item_id, action, run_id, authorized_item_version, created_at)
       VALUES (?, ?, ?, ?, 'secret_read', ?, 1, ?)`,
    ).run("00000000-0000-4000-8000-000000000001", project.id, job.id, itemId, "00000000-0000-4000-8000-000000000002", new Date().toISOString())).toThrow(/scope mismatch/);
  });
});
