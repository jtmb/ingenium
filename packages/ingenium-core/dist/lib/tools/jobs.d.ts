import { Job, JobRun, JobRunLog } from "../schema.js";
/**
 * Create a new job with an agent prompt template and optional schedule/trigger.
 * Enabled by default. Timeout defaults to 30 minutes.
 */
export declare function createJob(projectId: string, name: string, description: string | undefined, agent: string, promptTemplate: string, scheduleCron?: string, triggerEvent?: string, timeoutMinutes?: number): Job;
/**
 * Update a job's fields. Dynamically builds the SET clause from the provided `fields` object,
 * mapping camelCase field names to snake_case column names.
 * SQLite has no native boolean type — `enabled` is stored as 0/1 integer.
 */
export declare function updateJob(_projectId: string, jobId: string, fields: Partial<Pick<Job, "name" | "description" | "agent" | "prompt_template" | "schedule_cron" | "trigger_event" | "enabled" | "timeout_minutes">>): Job | undefined;
/** Delete a job by ID. Returns false if the job doesn't exist. */
export declare function deleteJob(_projectId: string, jobId: string): boolean;
/** List all jobs for a project, ordered by creation date descending. */
export declare function listJobs(projectId: string): Job[];
/** Get a single job by ID. Returns undefined if not found. */
export declare function getJob(_projectId: string, jobId: string): Job | undefined;
/**
 * Start a new job run. Performs concurrency guard: only one run per job can be
 * in 'running' or 'queued' status at a time. Returns either the created JobRun
 * or a `{ status: "queued", reason }` object if the job can't start.
 *
 * Reasons for rejection: job not found, job disabled, or an existing run in progress.
 */
export declare function startJobRun(projectId: string, jobId: string, trigger: "manual" | "cron" | "event"): JobRun | {
    status: "queued";
    reason: string;
};
/**
 * Mark a job run as finished with a terminal status and optional exit code.
 * Returns undefined if the run ID doesn't exist.
 */
export declare function finishJobRun(runId: string, status: "success" | "failed" | "timeout" | "cancelled", exitCode: number | null): JobRun | undefined;
/**
 * Cancel a job run. Only succeeds if the run is currently 'running' or 'queued'.
 * If already in a terminal state, returns the run unchanged (idempotent).
 */
export declare function cancelJobRun(runId: string): JobRun | undefined;
/** List job runs for a given job, most recent first. Default limit 50. */
export declare function listJobRuns(jobId: string, limit?: number): JobRun[];
/** Get a single job run by ID. */
export declare function getJobRun(runId: string): JobRun | undefined;
/**
 * Append a line of output to a job run's log stream.
 * Uses a monotonic sequence number (seq) per run for ordered retrieval and streaming —
 * the client polls with `afterSeq` to get new lines incrementally.
 */
export declare function appendRunLog(runId: string, stream: "stdout" | "stderr", line: string): JobRunLog;
/**
 * Get log lines for a job run in sequence order.
 * If `afterSeq` is provided, returns only lines with seq > afterSeq (incremental polling).
 * This allows the client to tail logs without re-fetching already-seen lines.
 */
export declare function getRunLogs(runId: string, afterSeq?: number): JobRunLog[];
//# sourceMappingURL=jobs.d.ts.map