-- Migration 021: Jenkins-like agent job scheduler/runner.
-- Adds jobs, job_runs, and job_run_logs tables.

-- ============================================================
-- 1. Jobs table
-- ============================================================

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    description TEXT,
    agent TEXT NOT NULL,
    prompt_template TEXT NOT NULL,
    schedule_cron TEXT,
    trigger_event TEXT,
    enabled INTEGER DEFAULT 1,
    timeout_minutes INTEGER DEFAULT 30,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- ============================================================
-- 2. Job runs table
-- ============================================================

CREATE TABLE IF NOT EXISTS job_runs (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'success', 'failed', 'timeout', 'cancelled')),
    trigger TEXT NOT NULL CHECK(trigger IN ('manual', 'cron', 'event')),
    started_at TEXT,
    finished_at TEXT,
    exit_code INTEGER,
    created_at TEXT NOT NULL
);

-- ============================================================
-- 3. Job run logs table
-- ============================================================

CREATE TABLE IF NOT EXISTS job_run_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    stream TEXT NOT NULL CHECK(stream IN ('stdout', 'stderr')),
    line TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_job_run_logs_run_seq ON job_run_logs(run_id, seq);

-- ============================================================
-- 4. Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_job_runs_job_status ON job_runs(job_id, status);
CREATE INDEX IF NOT EXISTS idx_job_runs_created ON job_runs(created_at);
