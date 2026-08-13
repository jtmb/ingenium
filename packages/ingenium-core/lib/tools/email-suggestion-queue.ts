/**
 * Email suggestion queue — persistent job queue for smart-reply generation.
 *
 * Jobs are enqueued for genuinely new messages (not label changes). Workers
 * dequeue, generate suggestions via LLM,
 * and cache the results. Failed jobs are retried with exponential backoff.
 *
 * 🔴 All mutations use execTransaction() with checkpointAfterWrite() outside the txn.
 * 🔴 Defensive parent-existence check before enqueue — verify email_cache row exists.
 * 🔴 ON CONFLICT DO NOTHING for enqueue — avoids duplicate jobs.
 */

import { createHash } from "node:crypto";
import { getDb, execTransaction, checkpointAfterWrite, resolveCoreDbPath } from "../db.js";
import { logger } from "../logger.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function dbPath(): string {
  return resolveCoreDbPath();
}

const DEFAULT_LEASE_MS = 120_000;

function ownerHash(ownerToken: string): string {
  if (!ownerToken || ownerToken.length > 512) {
    throw new Error("Suggestion queue owner token must be between 1 and 512 characters");
  }
  return createHash("sha256").update(ownerToken).digest("hex");
}

function leaseSeconds(leaseMs: number): number {
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error("Suggestion queue lease duration must be positive");
  }
  return Math.ceil(leaseMs / 1000);
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
      `INSERT INTO email_suggestion_queue (organization_id, account_id, folder, uid, created_at, attempts, next_attempt_at)
       SELECT organization_id, ?, ?, ?, datetime('now'), 0, datetime('now') FROM mail_accounts WHERE id = ?
       ON CONFLICT(account_id, folder, uid) DO NOTHING`,
    ).run(accountId, folder, uid, accountId);

    return result.changes > 0;
  });
  checkpointAfterWrite();
  return result;
}

/**
 * Atomically claim the next ready or expired job for one worker.
 */
export function claimSuggestionJob(
  ownerToken: string,
  leaseMs = DEFAULT_LEASE_MS,
): {
  account_id: string;
  folder: string;
  uid: string;
  id: number;
} | undefined {
  const hash = ownerHash(ownerToken);
  const seconds = leaseSeconds(leaseMs);
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    const job = db.prepare(
      `SELECT id, account_id, folder, uid
       FROM email_suggestion_queue
       WHERE (lease_state = 'queued' AND next_attempt_at <= datetime('now'))
          OR (lease_state = 'claimed' AND lease_expires_at <= datetime('now'))
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    ).get() as { id: number; account_id: string; folder: string; uid: string } | undefined;
    if (!job) return undefined;

    const claimed = db.prepare(
      `UPDATE email_suggestion_queue
       SET lease_state = 'claimed',
           lease_owner = ?,
           lease_expires_at = datetime('now', '+' || ? || ' seconds')
       WHERE id = ?
         AND (
           (lease_state = 'queued' AND next_attempt_at <= datetime('now'))
           OR (lease_state = 'claimed' AND lease_expires_at <= datetime('now'))
         )`,
    ).run(hash, seconds, job.id);
    return claimed.changes === 1 ? job : undefined;
  });
  checkpointAfterWrite();
  return result;
}

/**
 * Delete a completed job row only when its claimant still owns the lease.
 */
export function markJobComplete(jobId: number, ownerToken: string): boolean {
  const hash = ownerHash(ownerToken);
  const result = execTransaction(() => {
    const db = getDb(dbPath());
    return db.prepare(
      `DELETE FROM email_suggestion_queue
       WHERE id = ? AND lease_state = 'claimed' AND lease_owner = ?`,
    ).run(jobId, hash).changes === 1;
  });
  checkpointAfterWrite();
  return result;
}

/**
 * Mark a job as failed: increment attempts, set next_attempt_at with
 * exponential backoff (30s, 60s, 120s, 300s, 600s), store last_error.
 *
 * Max 5 attempts; on the 5th failure, delete the job and log no provider detail.
 */
export function markJobFailed(jobId: number, ownerToken: string, _error: string): boolean {
  const hash = ownerHash(ownerToken);
  const result = execTransaction(() => {
    const db = getDb(dbPath());

    const row = db.prepare(
      `SELECT attempts FROM email_suggestion_queue
       WHERE id = ? AND lease_state = 'claimed' AND lease_owner = ?`,
    ).get(jobId, hash) as { attempts: number } | undefined;

    if (!row) {
      return false;
    }

    const attempts = row.attempts + 1;

    if (attempts >= 5) {
      const deleted = db.prepare(
        `DELETE FROM email_suggestion_queue
         WHERE id = ? AND lease_state = 'claimed' AND lease_owner = ?`,
      ).run(jobId, hash).changes === 1;
      if (deleted) {
        logger.warn("email-suggestion-queue", "Suggestion job reached its retry limit and was removed", { jobId });
      }
      return deleted;
    }

    const delays = [30, 60, 120, 300, 600];
    const delaySec = delays[attempts - 1] ?? 600;

    return db.prepare(
      `UPDATE email_suggestion_queue
       SET attempts = ?,
           next_attempt_at = datetime('now', '+' || ? || ' seconds'),
           last_error = 'Suggestion processing failed',
           lease_state = 'queued',
           lease_owner = NULL,
           lease_expires_at = NULL
       WHERE id = ? AND lease_state = 'claimed' AND lease_owner = ?`,
    ).run(attempts, delaySec, jobId, hash).changes === 1;
  });
  checkpointAfterWrite();
  return result;
}
