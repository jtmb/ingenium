import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { randomUUID } from "node:crypto";
// Internal helpers
function dbPath() {
    return process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db";
}
// ── Job CRUD ────────────────────────────────────────────────────────────────
/**
 * Create a new job with an agent prompt template and optional schedule/trigger.
 * Enabled by default. Timeout defaults to 30 minutes.
 */
export function createJob(projectId, name, description, agent, promptTemplate, scheduleCron, triggerEvent, timeoutMinutes) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        const now = new Date().toISOString();
        const id = randomUUID();
        db.prepare(`INSERT INTO jobs (id, project_id, name, description, agent, prompt_template,
        schedule_cron, trigger_event, enabled, timeout_minutes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`).run(id, projectId, name, description ?? null, agent, promptTemplate, scheduleCron ?? null, triggerEvent ?? null, timeoutMinutes ?? 30, now, now);
        return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
    });
    checkpointAfterWrite();
    return result;
}
/**
 * Update a job's fields. Dynamically builds the SET clause from the provided `fields` object,
 * mapping camelCase field names to snake_case column names.
 * SQLite has no native boolean type — `enabled` is stored as 0/1 integer.
 */
export function updateJob(_projectId, jobId, fields) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        const now = new Date().toISOString();
        const existing = db.prepare("SELECT id FROM jobs WHERE id = ?").get(jobId);
        if (!existing)
            return undefined;
        const setClauses = ["updated_at = ?"];
        const params = [now];
        const mappable = {
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
                params.push(fields[field] ?? null);
            }
        }
        if ("enabled" in fields) {
            setClauses.push("enabled = ?");
            params.push(fields.enabled ? 1 : 0);
        }
        params.push(jobId);
        const sql = `UPDATE jobs SET ${setClauses.join(", ")} WHERE id = ?`;
        const info = db.prepare(sql).run(...params);
        if (info.changes === 0)
            return undefined;
        return db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    });
    checkpointAfterWrite();
    return result;
}
/** Delete a job by ID. Returns false if the job doesn't exist. */
export function deleteJob(_projectId, jobId) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        const existing = db.prepare("SELECT id FROM jobs WHERE id = ?").get(jobId);
        if (!existing)
            return false;
        db.prepare("DELETE FROM jobs WHERE id = ?").run(jobId);
        return true;
    });
    checkpointAfterWrite();
    return result;
}
/** List all jobs for a project, ordered by creation date descending. */
export function listJobs(projectId) {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC").all(projectId);
}
/** Get a single job by ID. Returns undefined if not found. */
export function getJob(_projectId, jobId) {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
}
// ── Job Run lifecycle ────────────────────────────────────────────────────────
/**
 * Start a new job run. Performs concurrency guard: only one run per job can be
 * in 'running' or 'queued' status at a time. Returns either the created JobRun
 * or a `{ status: "queued", reason }` object if the job can't start.
 *
 * Reasons for rejection: job not found, job disabled, or an existing run in progress.
 */
export function startJobRun(projectId, jobId, trigger) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        const job = db.prepare("SELECT id, enabled FROM jobs WHERE id = ? AND project_id = ?")
            .get(jobId, projectId);
        if (!job) {
            return { status: "queued", reason: "Job not found" };
        }
        if (!job.enabled) {
            return { status: "queued", reason: "Job is disabled" };
        }
        // Concurrency guard: prevent overlapping runs. A new run cannot start if
        // another run is still 'running' or 'queued' for the same job.
        const running = db.prepare("SELECT id FROM job_runs WHERE job_id = ? AND status IN ('running', 'queued')").get(jobId);
        if (running) {
            return { status: "queued", reason: "Job already has a running or queued run" };
        }
        const now = new Date().toISOString();
        const runId = randomUUID();
        db.prepare(`INSERT INTO job_runs (id, job_id, status, trigger, started_at, created_at)
       VALUES (?, ?, 'running', ?, ?, ?)`).run(runId, jobId, trigger, now, now);
        return db.prepare("SELECT * FROM job_runs WHERE id = ?").get(runId);
    });
    checkpointAfterWrite();
    return result;
}
/**
 * Mark a job run as finished with a terminal status and optional exit code.
 * Returns undefined if the run ID doesn't exist.
 */
export function finishJobRun(runId, status, exitCode) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        const now = new Date().toISOString();
        const existing = db.prepare("SELECT id FROM job_runs WHERE id = ?").get(runId);
        if (!existing)
            return undefined;
        db.prepare("UPDATE job_runs SET status = ?, finished_at = ?, exit_code = ? WHERE id = ?").run(status, now, exitCode, runId);
        return db.prepare("SELECT * FROM job_runs WHERE id = ?").get(runId);
    });
    checkpointAfterWrite();
    return result;
}
/**
 * Cancel a job run. Only succeeds if the run is currently 'running' or 'queued'.
 * If already in a terminal state, returns the run unchanged (idempotent).
 */
export function cancelJobRun(runId) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        const now = new Date().toISOString();
        const existing = db.prepare("SELECT id, status FROM job_runs WHERE id = ?").get(runId);
        if (!existing)
            return undefined;
        if (!["running", "queued"].includes(existing.status)) {
            return db.prepare("SELECT * FROM job_runs WHERE id = ?").get(runId);
        }
        db.prepare("UPDATE job_runs SET status = 'cancelled', finished_at = ? WHERE id = ?").run(now, runId);
        return db.prepare("SELECT * FROM job_runs WHERE id = ?").get(runId);
    });
    checkpointAfterWrite();
    return result;
}
/** List job runs for a given job, most recent first. Default limit 50. */
export function listJobRuns(jobId, limit = 50) {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM job_runs WHERE job_id = ? ORDER BY created_at DESC LIMIT ?").all(jobId, limit);
}
/** Get a single job run by ID. */
export function getJobRun(runId) {
    const db = getDb(dbPath());
    return db.prepare("SELECT * FROM job_runs WHERE id = ?").get(runId);
}
// ── Run logs ─────────────────────────────────────────────────────────────────
/**
 * Append a line of output to a job run's log stream.
 * Uses a monotonic sequence number (seq) per run for ordered retrieval and streaming —
 * the client polls with `afterSeq` to get new lines incrementally.
 */
export function appendRunLog(runId, stream, line) {
    const result = execTransaction(() => {
        const db = getDb(dbPath());
        const now = new Date().toISOString();
        // Increment sequence number per run — provides ordering and supports
        // incremental polling (the client passes `afterSeq` to get only new lines).
        const maxSeq = db.prepare("SELECT COALESCE(MAX(seq), 0) as max_seq FROM job_run_logs WHERE run_id = ?").get(runId);
        const seq = maxSeq.max_seq + 1;
        db.prepare("INSERT INTO job_run_logs (run_id, seq, stream, line, created_at) VALUES (?, ?, ?, ?, ?)").run(runId, seq, stream, line, now);
        return db.prepare("SELECT * FROM job_run_logs WHERE run_id = ? AND seq = ?").get(runId, seq);
    });
    checkpointAfterWrite();
    return result;
}
/**
 * Get log lines for a job run in sequence order.
 * If `afterSeq` is provided, returns only lines with seq > afterSeq (incremental polling).
 * This allows the client to tail logs without re-fetching already-seen lines.
 */
export function getRunLogs(runId, afterSeq) {
    const db = getDb(dbPath());
    if (afterSeq !== undefined) {
        return db.prepare("SELECT * FROM job_run_logs WHERE run_id = ? AND seq > ? ORDER BY seq ASC").all(runId, afterSeq);
    }
    return db.prepare("SELECT * FROM job_run_logs WHERE run_id = ? ORDER BY seq ASC").all(runId);
}
