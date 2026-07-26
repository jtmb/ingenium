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
/**
 * Insert a suggestion job if not already queued and not already cached.
 * Returns true if the job was inserted, false if skipped (duplicate or already cached).
 *
 * 🔴 Defensive parent-existence check: verifies the email_cache row exists
 *    before enqueuing so we don't queue jobs for emails that no longer exist.
 */
export declare function enqueueSuggestionJob(accountId: string, folder: string, uid: string): boolean;
/**
 * Get the next ready job (next_attempt_at <= now, ordered by created_at ASC).
 * Returns undefined if no jobs are ready.
 *
 * Read-only — no transaction needed.
 */
export declare function dequeueSuggestionJob(): {
    account_id: string;
    folder: string;
    uid: string;
    id: number;
} | undefined;
/**
 * Delete a completed job row from the queue.
 */
export declare function markJobComplete(jobId: number): void;
/**
 * Mark a job as failed: increment attempts, set next_attempt_at with
 * exponential backoff (30s, 60s, 120s, 300s, 600s), store last_error.
 *
 * Max 5 attempts; on the 5th failure, delete the job and log a warning.
 */
export declare function markJobFailed(jobId: number, error: string): void;
/**
 * Return the count of pending jobs (next_attempt_at <= now).
 */
export declare function countPendingJobs(): number;
//# sourceMappingURL=email-suggestion-queue.d.ts.map