import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { Job, JobRun, JobRunLog } from "../schema.js";
import { randomUUID } from "node:crypto";

// ============================================================================
// Internal helpers
// ============================================================================

function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db";
}

// ============================================================================
// Job CRUD
// ============================================================================

export function createJob(
  projectId: string,
  name: string,
  description: string | undefined,
  agent: string,
  promptTemplate: string,
  scheduleCron?: string,
  triggerEvent?: string,
  timeoutMinutes?: number,
): Job {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO jobs (id, project_id, name, description, agent, prompt_template,
        schedule_cron, trigger_event, enabled, timeout_minutes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ).run(
      id, projectId, name, description ?? null, agent, promptTemplate,
      scheduleCron ?? null, triggerEvent ?? null,
      timeoutMinutes ?? 30, now, now,
    );
    return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Job;
  });
  checkpointAfterWrite();
  return result;
}

export function updateJob(
  _projectId: string,
  jobId: string,
  fields: Partial<Pick<Job, "name" | "description" | "agent" | "prompt_template" | "schedule_cron" | "trigger_event" | "enabled" | "timeout_minutes">>,
): Job | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();

    // Check job exists
    const existing = db.prepare("SELECT id FROM jobs WHERE id = ?").get(jobId) as { id: string } | undefined;
    if (!existing) return undefined;

    const setClauses: string[] = ["updated_at = ?"];
    const params: unknown[] = [now];

    const mappable: Record<string, string> = {
      name: "name",
      description: "description",
      agent: "agent",
      prompt_template: "prompt_template",
      schedule_cron: "schedule_cron",
      trigger_event: "trigger_event",
      timeout_minutes: "timeout_minutes",
    };

    for (const [field, col] of Object.entries(mappable)) {
      if (field in fields) {
        setClauses.push(`${col} = ?`);
        params.push((fields as Record<string, unknown>)[field] ?? null);
      }
    }

    // Handle enabled as a number (SQLite boolean)
    if ("enabled" in fields) {
      setClauses.push("enabled = ?");
      params.push(fields.enabled ? 1 : 0);
    }

    params.push(jobId);

    const sql = `UPDATE jobs SET ${setClauses.join(", ")} WHERE id = ?`;
    const info = db.prepare(sql).run(...params);

    if (info.changes === 0) return undefined;

    return db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Job;
  });
  checkpointAfterWrite();
  return result;
}

export function deleteJob(_projectId: string, jobId: string): boolean {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const existing = db.prepare("SELECT id FROM jobs WHERE id = ?").get(jobId) as { id: string } | undefined;
    if (!existing) return false;
    db.prepare("DELETE FROM jobs WHERE id = ?").run(jobId);
    return true;
  });
  checkpointAfterWrite();
  return result;
}

export function listJobs(projectId: string): Job[] {
  const db = getDb(dbPath());
  return db.prepare(
    "SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC",
  ).all(projectId) as Job[];
}

export function getJob(_projectId: string, jobId: string): Job | undefined {
  const db = getDb(dbPath());
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Job | undefined;
}

// ============================================================================
// Job Run lifecycle
// ============================================================================

export function startJobRun(projectId: string, jobId: string, trigger: "manual" | "cron" | "event"): JobRun | { status: "queued"; reason: string } {
  const result = execTransaction(() => {
    const db = getDb(dbPath());

    // Check job exists
    const job = db.prepare("SELECT id, enabled FROM jobs WHERE id = ? AND project_id = ?")
      .get(jobId, projectId) as { id: string; enabled: number } | undefined;
    if (!job) {
      return { status: "queued" as const, reason: "Job not found" };
    }
    if (!job.enabled) {
      return { status: "queued" as const, reason: "Job is disabled" };
    }

    // Check if there's already a running run for this job
    const running = db.prepare(
      "SELECT id FROM job_runs WHERE job_id = ? AND status IN ('running', 'queued')",
    ).get(jobId) as { id: string } | undefined;
    if (running) {
      return { status: "queued" as const, reason: "Job already has a running or queued run" };
    }

    const now = new Date().toISOString();
    const runId = randomUUID();

    db.prepare(
      `INSERT INTO job_runs (id, job_id, status, trigger, started_at, created_at)
       VALUES (?, ?, 'running', ?, ?, ?)`,
    ).run(runId, jobId, trigger, now, now);

    return db.prepare("SELECT * FROM job_runs WHERE id = ?").get(runId) as JobRun;
  });
  checkpointAfterWrite();
  return result;
}

export function finishJobRun(runId: string, status: "success" | "failed" | "timeout" | "cancelled", exitCode: number | null): JobRun | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();

    const existing = db.prepare("SELECT id FROM job_runs WHERE id = ?").get(runId) as { id: string } | undefined;
    if (!existing) return undefined;

    db.prepare(
      "UPDATE job_runs SET status = ?, finished_at = ?, exit_code = ? WHERE id = ?",
    ).run(status, now, exitCode, runId);

    return db.prepare("SELECT * FROM job_runs WHERE id = ?").get(runId) as JobRun | undefined;
  });
  checkpointAfterWrite();
  return result;
}

export function cancelJobRun(runId: string): JobRun | undefined {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();

    const existing = db.prepare("SELECT id, status FROM job_runs WHERE id = ?").get(runId) as
      { id: string; status: string } | undefined;
    if (!existing) return undefined;

    // Only cancel if running or queued
    if (!["running", "queued"].includes(existing.status)) {
      return db.prepare("SELECT * FROM job_runs WHERE id = ?").get(runId) as JobRun;
    }

    db.prepare(
      "UPDATE job_runs SET status = 'cancelled', finished_at = ? WHERE id = ?",
    ).run(now, runId);

    return db.prepare("SELECT * FROM job_runs WHERE id = ?").get(runId) as JobRun;
  });
  checkpointAfterWrite();
  return result;
}

export function listJobRuns(jobId: string, limit = 50): JobRun[] {
  const db = getDb(dbPath());
  return db.prepare(
    "SELECT * FROM job_runs WHERE job_id = ? ORDER BY created_at DESC LIMIT ?",
  ).all(jobId, limit) as JobRun[];
}

export function getJobRun(runId: string): JobRun | undefined {
  const db = getDb(dbPath());
  return db.prepare("SELECT * FROM job_runs WHERE id = ?").get(runId) as JobRun | undefined;
}

// ============================================================================
// Run logs
// ============================================================================

export function appendRunLog(runId: string, stream: "stdout" | "stderr", line: string): JobRunLog {
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const now = new Date().toISOString();

    // Get next seq for this run
    const maxSeq = db.prepare(
      "SELECT COALESCE(MAX(seq), 0) as max_seq FROM job_run_logs WHERE run_id = ?",
    ).get(runId) as { max_seq: number };
    const seq = maxSeq.max_seq + 1;

    db.prepare(
      "INSERT INTO job_run_logs (run_id, seq, stream, line, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(runId, seq, stream, line, now);

    return db.prepare(
      "SELECT * FROM job_run_logs WHERE run_id = ? AND seq = ?",
    ).get(runId, seq) as JobRunLog;
  });
  checkpointAfterWrite();
  return result;
}

export function getRunLogs(runId: string, afterSeq?: number): JobRunLog[] {
  const db = getDb(dbPath());
  if (afterSeq !== undefined) {
    return db.prepare(
      "SELECT * FROM job_run_logs WHERE run_id = ? AND seq > ? ORDER BY seq ASC",
    ).all(runId, afterSeq) as JobRunLog[];
  }
  return db.prepare(
    "SELECT * FROM job_run_logs WHERE run_id = ? ORDER BY seq ASC",
  ).all(runId) as JobRunLog[];
}
