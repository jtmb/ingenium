import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../lib/tools/projects.js";
import {
  createJob,
  listJobs,
  getJob,
  updateJob,
  deleteJob,
  startJobRun,
  finishJobRun,
  cancelJobRun,
  listJobRuns,
  getJobRun,
  appendRunLog,
  getRunLogs,
} from "../lib/tools/jobs.js";

let tempDir: string;
let projectId: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-jobs-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  const project = createProject("test-project");
  projectId = project.id;
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("jobs — CRUD", () => {
  it("creates a job with all fields", () => {
    const job = createJob(
      projectId,
      "My Job",
      "A test job",
      "ingenium-orchestrator",
      "Run the tests please",
      "0 * * * *",
      "context.conversation.archived",
      60,
    );

    expect(job.name).toBe("My Job");
    expect(job.description).toBe("A test job");
    expect(job.agent).toBe("ingenium-orchestrator");
    expect(job.prompt_template).toBe("Run the tests please");
    expect(job.schedule_cron).toBe("0 * * * *");
    expect(job.trigger_event).toBe("context.conversation.archived");
    expect(job.timeout_minutes).toBe(60);
    expect(job.enabled).toBe(1);
    expect(job.id).toBeDefined();
    expect(job.project_id).toBe(projectId);
  });

  it("creates a job with defaults", () => {
    const job = createJob(
      projectId,
      "Simple Job",
      undefined,
      "ingenium-software-engineer",
      "echo hello",
    );

    expect(job.name).toBe("Simple Job");
    expect(job.description).toBeNull();
    expect(job.schedule_cron).toBeNull();
    expect(job.trigger_event).toBeNull();
    expect(job.timeout_minutes).toBe(30); // default
    expect(job.enabled).toBe(1);
  });

  it("accepts only cataloged trigger events for new jobs", () => {
    expect(createJob(
      projectId,
      "Catalog trigger",
      undefined,
      "ingenium-qa",
      "test",
      undefined,
      "context.checkpoint.restored_as_new",
    ).trigger_event).toBe("context.checkpoint.restored_as_new");
    expect(() => createJob(
      projectId,
      "Unknown trigger",
      undefined,
      "ingenium-qa",
      "test",
      undefined,
      "push",
    )).toThrow(expect.objectContaining({ code: "UNKNOWN_TRIGGER_EVENT" }));
  });

  it("lists jobs for a project", () => {
    const list = listJobs(projectId);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0].project_id).toBe(projectId);
  });

  it("gets a job by id", () => {
    const job = createJob(projectId, "Get Me", undefined, "ingenium-qa", "test");
    const found = getJob(projectId, job.id);
    expect(found).not.toBeUndefined();
    expect(found!.name).toBe("Get Me");
  });

  it("returns undefined for nonexistent job", () => {
    const found = getJob(projectId, "nonexistent-id");
    expect(found).toBeUndefined();
  });

  it("updates a job with partial fields", () => {
    const job = createJob(projectId, "Update Me", undefined, "ingenium-qa", "test");
    const result = updateJob(projectId, job.id, {
      name: "Updated Name",
      enabled: false,
      timeout_minutes: 15,
    }, job.revision);

    expect(result.status).toBe("updated");
    if (result.status !== "updated") throw new Error("expected job update");
    expect(result.job.name).toBe("Updated Name");
    expect(result.job.enabled).toBe(0); // SQLite uses 0/1 for booleans
    expect(result.job.timeout_minutes).toBe(15);
    expect(result.job.agent).toBe("ingenium-qa"); // unchanged
    expect(result.job.revision).toBe(1);
  });

  it("updating nonexistent job returns undefined", () => {
    expect(updateJob(projectId, "nonexistent", { name: "nope" }, 0)).toEqual({ status: "not_found" });
  });

  it("deletes a job", () => {
    const job = createJob(projectId, "Delete Me", undefined, "ingenium-qa", "test");
    const deleted = deleteJob(projectId, job.id, job.revision);
    expect(deleted).toEqual({ status: "deleted" });

    const found = getJob(projectId, job.id);
    expect(found).toBeUndefined();
  });

  it("deleting nonexistent job returns false", () => {
    const deleted = deleteJob(projectId, "nonexistent", 0);
    expect(deleted).toEqual({ status: "not_found" });
  });
});

describe("jobs — run lifecycle (queued → running → success)", () => {
  let jobId: string;

  beforeAll(() => {
    const job = createJob(
      projectId,
      "Lifecycle Job",
      "Test lifecycle",
      "ingenium-qa",
      "echo hello world",
      undefined,
      undefined,
      5,
    );
    jobId = job.id;
  });

  it("starts a job run as running immediately", () => {
    const run = startJobRun(projectId, jobId, "manual");

    // Should not be a "reason" object (which means queued/rejected)
    expect("reason" in run).toBe(false);

    const runObj = run as ReturnType<typeof startJobRun> extends { status: "queued" } ? never : typeof run;
    expect(runObj.status).toBe("running");
    expect(runObj.job_id).toBe(jobId);
    expect(runObj.trigger).toBe("manual");
    expect(runObj.started_at).not.toBeNull();
    expect(runObj.finished_at).toBeNull();
    expect(runObj.exit_code).toBeNull();
  });

  it("prevents starting a second run while one is running", () => {
    const result = startJobRun(projectId, jobId, "manual");
    expect("reason" in result).toBe(true);
    if ("reason" in result) {
      expect(result.reason).toContain("already has a running");
    }
  });

  it("finishes a job run as success", () => {
    // Get the current running run
    const runs = listJobRuns(projectId, jobId);
    expect(runs.length).toBeGreaterThanOrEqual(1);
    const runningRun = runs.find(r => r.status === "running");
    expect(runningRun).not.toBeUndefined();

    const finished = finishJobRun(projectId, runningRun!.id, "success", 0);
    expect(finished).not.toBeUndefined();
    expect(finished!.status).toBe("success");
    expect(finished!.exit_code).toBe(0);
    expect(finished!.finished_at).not.toBeNull();
  });

  it("finishing nonexistent run returns undefined", () => {
    const finished = finishJobRun(projectId, "nonexistent", "success", 0);
    expect(finished).toBeUndefined();
  });

  it("can start a new run after previous one finished", () => {
    const run = startJobRun(projectId, jobId, "cron");
    expect("reason" in run).toBe(false);

    const runObj = run as JobRun;
    expect(runObj.status).toBe("running");

    // Clean up
    finishJobRun(projectId, runObj.id, "success", 0);
  });

  it("lists job runs for a job", () => {
    const runs = listJobRuns(projectId, jobId);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs[0].created_at >= runs[1].created_at).toBe(true); // newest first
  });
});

describe("jobs — cancel and timeout", () => {
  let jobId: string;

  beforeAll(() => {
    const job = createJob(
      projectId,
      "Cancel Job",
      "Test cancellation",
      "ingenium-qa",
      "sleep 3600",
    );
    jobId = job.id;
  });

  it("cancels a running job", () => {
    const run = startJobRun(projectId, jobId, "manual");
    expect("reason" in run).toBe(false);
    const runObj = run as JobRun;

    const cancelled = cancelJobRun(projectId, runObj.id);
    expect(cancelled).not.toBeUndefined();
    expect(cancelled!.status).toBe("cancelled");
    expect(cancelled!.finished_at).not.toBeNull();
  });

  it("cancel on nonexistent run returns undefined", () => {
    const cancelled = cancelJobRun(projectId, "nonexistent");
    expect(cancelled).toBeUndefined();
  });
});

describe("jobs — run logs (append + tail polling)", () => {
  let jobId: string;
  let runId: string;

  beforeAll(() => {
    const job = createJob(
      projectId,
      "Logging Job",
      "Test logs",
      "ingenium-qa",
      "echo test",
    );
    jobId = job.id;

    const run = startJobRun(projectId, job.id, "manual");
    expect("reason" in run).toBe(false);
    const runObj = run as JobRun;
    runId = runObj.id;
  });

  afterAll(() => {
    finishJobRun(projectId, runId, "success", 0);
  });

  it("appends stdout and stderr logs with auto-increment seq", () => {
    const log1 = appendRunLog(projectId, runId, "stdout", "first line");
    expect(log1.seq).toBe(1);
    expect(log1.stream).toBe("stdout");
    expect(log1.line).toBe("first line");

    const log2 = appendRunLog(projectId, runId, "stderr", "error line");
    expect(log2.seq).toBe(2);
    expect(log2.stream).toBe("stderr");

    const log3 = appendRunLog(projectId, runId, "stdout", "second line");
    expect(log3.seq).toBe(3);
  });

  it("gets all logs for a run", () => {
    const logs = getRunLogs(projectId, runId);
    expect(logs.length).toBe(3);
    expect(logs[0].seq).toBe(1);
    expect(logs[1].seq).toBe(2);
    expect(logs[2].seq).toBe(3);
  });

  it("tail-polls logs after a given seq", () => {
    appendRunLog(projectId, runId, "stdout", "fourth line");
    appendRunLog(projectId, runId, "stdout", "fifth line");

    // Poll after seq 2
    const newLogs = getRunLogs(projectId, runId, 2);
    expect(newLogs.length).toBe(3);
    expect(newLogs[0].seq).toBe(3);
    expect(newLogs[2].seq).toBe(5);
  });

  it("tail-poll with after beyond all seqs returns empty", () => {
    const newLogs = getRunLogs(projectId, runId, 999);
    expect(newLogs.length).toBe(0);
  });

  it("getRunLogs for nonexistent run returns empty", () => {
    const logs = getRunLogs(projectId, "nonexistent");
    expect(logs.length).toBe(0);
  });
});

// Type helper for tests
type JobRun = { id: string; status: string; job_id: string; trigger: string; started_at: string | null; finished_at: string | null; exit_code: number | null; created_at: string };
