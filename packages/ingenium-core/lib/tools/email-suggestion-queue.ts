/**
 * Email suggestion queue — persistent job queue for smart-reply generation.
 *
 * Jobs are enqueued by the sync engine's delta poll handler for genuinely NEW
 * messages (not label changes). Workers dequeue, generate suggestions via LLM,
 * and cache the results. Failed jobs are retried with exponential backoff.
 *
 * 🔴 All mutations use execTransaction() with checkpointAfterWrite() outside the txn.
 * 🔴 Defensive parent-existence check before enqueue — verify email_cache row exists.
 * 🔴 ON CONFLICT DO NOTHING for enqueue — avoids duplicate jobs.
 */

import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { logger } from "../logger.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db";
}

// ── Exports ────────────────────────────────────────────────────────────────

/**
 * Insert a suggestion job if not already queued and not already cached.
 * Returns true if the job was inserted, false if skipped (duplicate or already cached).
 *
 * 🔴 Defensive parent-existence check: verifies the email_cache row exists
 *    before enqueuing so we don't queue jobs for emails that no longer exist.
 */
export function enqueueSuggestionJob(
  accountId: string,
  folder: string,
  uid: string,
): boolean {
  const result = execTransaction(() => {
    const db = getDb(dbPath());

    // Defensive: check parent row exists
    const parent = db.prepare(
      "SELECT 1 FROM email_cache WHERE account_id = ? AND folder = ? AND uid = ?",
    ).get(accountId, folder, uid);
    if (!parent) {
      return false;
    }

    // Skip if suggestions already cached — no need to enqueue
    const existing = db.prepare(
      "SELECT 1 FROM email_suggestions WHERE account_id = ? AND folder = ? AND uid = ?",
    ).get(accountId, folder, uid);
    if (existing) {
      return false;
    }

    // Upsert with ON CONFLICT DO NOTHING — skip if already queued
    const result = db.prepare(
      `INSERT INTO email_suggestion_queue (account_id, folder, uid, created_at, attempts, next_attempt_at)
       VALUES (?, ?, ?, datetime('now'), 0, datetime('now'))
       ON CONFLICT(account_id, folder, uid) DO NOTHING`,
    ).run(accountId, folder, uid);

    return result.changes > 0;
  });
  checkpointAfterWrite();
  return result;
}

/**
 * Get the next ready job (next_attempt_at <= now, ordered by created_at ASC).
 * Returns undefined if no jobs are ready.
 *
 * Read-only — no transaction needed.
 */
export function dequeueSuggestionJob(): {
  account_id: string;
  folder: string;
  uid: string;
  id: number;
} | undefined {
  const db = getDb(dbPath());
  const row = db.prepare(
    `SELECT id, account_id, folder, uid
     FROM email_suggestion_queue
     WHERE next_attempt_at <= datetime('now')
     ORDER BY created_at ASC
     LIMIT 1`,
  ).get() as { id: number; account_id: string; folder: string; uid: string } | undefined;
  return row ?? undefined;
}

/**
 * Delete a completed job row from the queue.
 */
export function markJobComplete(jobId: number): void {
  execTransaction(() => {
    const db = getDb(dbPath());
    db.prepare("DELETE FROM email_suggestion_queue WHERE id = ?").run(jobId);
  });
  checkpointAfterWrite();
}

/**
 * Mark a job as failed: increment attempts, set next_attempt_at with
 * exponential backoff (30s, 60s, 120s, 300s, 600s), store last_error.
 *
 * Max 5 attempts; on the 5th failure, delete the job and log a warning.
 */
export function markJobFailed(jobId: number, error: string): void {
  execTransaction(() => {
    const db = getDb(dbPath());

    // Read current attempts
    const row = db.prepare(
      "SELECT attempts FROM email_suggestion_queue WHERE id = ?",
    ).get(jobId) as { attempts: number } | undefined;

    if (!row) {
      // Job already gone — nothing to do
      return;
    }

    const attempts = row.attempts + 1;

    if (attempts >= 5) {
      // Max attempts reached — delete the job
      db.prepare("DELETE FROM email_suggestion_queue WHERE id = ?").run(jobId);
      logger.warn("email-suggestion-queue",
        `Job ${jobId} failed 5 times — deleted from queue. Last error: ${error}`,
      );
      return;
    }

    // Exponential backoff: 30s, 60s, 120s, 300s, 600s
    const delays = [30, 60, 120, 300, 600];
    const delaySec = delays[attempts - 1] ?? 600;

    db.prepare(
      `UPDATE email_suggestion_queue
       SET attempts = ?,
           next_attempt_at = datetime('now', '+' || ? || ' seconds'),
           last_error = ?
       WHERE id = ?`,
    ).run(attempts, delaySec, error, jobId);
  });
  checkpointAfterWrite();
}

/**
 * Return the count of pending jobs (next_attempt_at <= now).
 */
export function countPendingJobs(): number {
  const db = getDb(dbPath());
  const row = db.prepare(
    "SELECT COUNT(*) as count FROM email_suggestion_queue WHERE next_attempt_at <= datetime('now')",
  ).get() as { count: number };
  return row.count;
}
