import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { getAuthenticationFoundationMigrationStatus, getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import { createJob, startJobRun } from "../lib/tools/jobs.js";
import { createTask } from "../lib/tools/tasks.js";

let directory = "";

afterEach(() => {
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  delete process.env.INGENIUM_CORE_DB_PATH;
});

describe("AUTH-106 automation tenancy", () => {
  it("installs complete guarded schema and preserves organization-scoped IDs", () => {
    directory = mkdtempSync(join(tmpdir(), "ingenium-automation-tenancy-"));
    process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
    const project = createProject("automation-tenancy");
    const job = createJob(project.id, "Tenant job", undefined, "agent", "private prompt");
    const task = createTask(project.id, "Tenant task");
    const run = startJobRun(project.id, job.id, "manual", { delegator: { type: "compatibility", id: "fixture" } });

    expect("reason" in run).toBe(false);
    expect(getAuthenticationFoundationMigrationStatus()["099"]).toMatchObject({ complete: true, missing: [] });
    expect(getDb().prepare("SELECT organization_id, service_principal_id FROM jobs WHERE id = ?").get(job.id))
      .toEqual({ organization_id: project.organization_id, service_principal_id: job.service_principal_id });
    expect(getDb().prepare("SELECT organization_id FROM tasks WHERE id = ?").get(task.id))
      .toEqual({ organization_id: project.organization_id });
    expect(() => getDb().prepare(
      "INSERT INTO job_run_logs (run_id, organization_id, seq, stream, line, created_at) VALUES (?, ?, 1, 'stdout', 'line', ?)",
    ).run(run.id, "00000000-0000-4000-8000-000000000001", new Date().toISOString())).toThrow(/job run log scope mismatch/);
    expect(() => getDb().prepare(
      "INSERT INTO task_comments (id, task_id, organization_id, author, body, created_at) VALUES (?, ?, ?, 'actor', 'body', ?)",
    ).run("00000000-0000-4000-8000-000000000002", task.id, "00000000-0000-4000-8000-000000000001", new Date().toISOString()))
      .toThrow(/task comment scope mismatch/);
    expect(() => getDb().prepare(
      `INSERT INTO pipeline_events
       (project_id, organization_id, source_run_id, event_type, event_source, title, created_at)
       VALUES (?, ?, ?, 'job_started', 'job-runner', 'invalid', ?)`,
    ).run(project.id, project.organization_id, run.id, new Date().toISOString())).toThrow(/pipeline event automation scope mismatch/);
    expect(() => getDb().prepare(
      `INSERT INTO jobs
       (id, project_id, organization_id, owner_kind, visibility, service_principal_id,
        name, agent, prompt_template, enabled, timeout_minutes, created_at, updated_at)
       VALUES (?, ?, ?, 'user', 'organization', ?, 'invalid owner', 'agent', 'prompt', 1, 30, ?, ?)`,
    ).run("00000000-0000-4000-8000-000000000003", project.id, project.organization_id,
      job.service_principal_id, new Date().toISOString(), new Date().toISOString())).toThrow(/invalid job automation scope/);
    expect(() => getDb().prepare(
      `INSERT INTO tasks
       (id, project_id, organization_id, owner_kind, visibility, title, created_at, updated_at)
       VALUES (?, ?, ?, 'user', 'organization', 'invalid owner', ?, ?)`,
    ).run("00000000-0000-4000-8000-000000000004", project.id, project.organization_id,
      new Date().toISOString(), new Date().toISOString())).toThrow(/invalid task automation scope/);
    expect(getDb().prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("rejects partial migration 099 instead of repairing it implicitly", () => {
    directory = mkdtempSync(join(tmpdir(), "ingenium-automation-partial-"));
    const dbPath = join(directory, "data.db");
    process.env.INGENIUM_CORE_DB_PATH = dbPath;
    createProject("automation-partial");
    resetDbForTest();
    const raw = new Database(dbPath);
    raw.exec("DROP TRIGGER automation_tenancy_manifests_immutable_update");
    raw.close();
    expect(() => getDb(dbPath)).toThrow(/Migration 099 is in a PARTIAL state/);
  });

  it("preserves populated pre-099 job, run, log, task, and child identities", () => {
    directory = mkdtempSync(join(tmpdir(), "ingenium-automation-upgrade-"));
    const dbPath = join(directory, "data.db");
    process.env.INGENIUM_CORE_DB_PATH = dbPath;
    const raw = new Database(dbPath);
    const migrations = resolve(import.meta.dirname ?? __dirname, "../data/migrations");
    const files = readdirSync(migrations)
      .filter((file) => /^\d{3}_.*\.sql$/.test(file) && Number(file.slice(0, 3)) <= 98 && !file.includes("_upgrade"))
      .sort();
    for (const file of files) raw.exec(readFileSync(join(migrations, file), "utf8"));

    const now = new Date().toISOString();
    const projectId = "00000000-0000-4000-8000-000000000106";
    const jobId = "00000000-0000-4000-8000-000000000107";
    const runId = "00000000-0000-4000-8000-000000000108";
    const taskId = "00000000-0000-4000-8000-000000000109";
    const commentId = "00000000-0000-4000-8000-000000000110";
    raw.prepare("INSERT INTO projects (id, name, path, is_global, created_at, updated_at, organization_id) VALUES (?, 'automation-upgrade', '/automation-upgrade', 0, ?, ?, ?)")
      .run(projectId, now, now, "00000000-0000-4000-8000-000000000093");
    raw.prepare("INSERT INTO jobs (id, project_id, name, agent, prompt_template, enabled, timeout_minutes, revision, created_at, updated_at) VALUES (?, ?, 'legacy job', 'agent', 'prompt', 1, 30, 0, ?, ?)")
      .run(jobId, projectId, now, now);
    raw.prepare("INSERT INTO job_runs (id, job_id, project_id, status, trigger, started_at, created_at) VALUES (?, ?, ?, 'success', 'manual', ?, ?)")
      .run(runId, jobId, projectId, now, now);
    raw.prepare("INSERT INTO job_run_logs (run_id, seq, stream, line, created_at) VALUES (?, 1, 'stdout', 'legacy line', ?)")
      .run(runId, now);
    raw.prepare("INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES (?, ?, 'legacy task', ?, ?)")
      .run(taskId, projectId, now, now);
    raw.prepare("INSERT INTO task_comments (id, task_id, author, body, created_at) VALUES (?, ?, 'legacy', 'legacy body', ?)")
      .run(commentId, taskId, now);
    raw.close();

    const upgraded = getDb(dbPath);
    expect(upgraded.prepare("SELECT id, organization_id FROM jobs WHERE id = ?").get(jobId)).toEqual({
      id: jobId,
      organization_id: "00000000-0000-4000-8000-000000000093",
    });
    expect(upgraded.prepare("SELECT id, job_id, organization_id FROM job_runs WHERE id = ?").get(runId)).toEqual({
      id: runId,
      job_id: jobId,
      organization_id: "00000000-0000-4000-8000-000000000093",
    });
    expect(upgraded.prepare("SELECT run_id, seq, organization_id FROM job_run_logs WHERE run_id = ?").get(runId)).toEqual({
      run_id: runId,
      seq: 1,
      organization_id: "00000000-0000-4000-8000-000000000093",
    });
    expect(upgraded.prepare("SELECT id, organization_id FROM tasks WHERE id = ?").get(taskId)).toEqual({
      id: taskId,
      organization_id: "00000000-0000-4000-8000-000000000093",
    });
    expect(upgraded.prepare("SELECT id, task_id, organization_id FROM task_comments WHERE id = ?").get(commentId)).toEqual({
      id: commentId,
      task_id: taskId,
      organization_id: "00000000-0000-4000-8000-000000000093",
    });
    expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
