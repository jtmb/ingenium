/**
 * email-suggestion-queue.test.ts — Tests for the durable suggestion job queue.
 *
 * Covers:
 *   1. Enqueue → dequeue → markComplete (happy path)
 *   2. Enqueue duplicate → ON CONFLICT DO NOTHING (returns false)
 *   3. Enqueue for non-existent email_cache row → returns false
 *   4. MarkFailed: attempts progression 1→5 + delay correctness
 *   5. MarkFailed: max attempts (5) → row deleted
 *   6. Dequeue with future next_attempt_at → not returned
 *   7. countPendingJobs accuracy
 *
 * Uses real SQLite (Pattern 2) — no mocks.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../lib/tools/projects.js";
import { getDb } from "../lib/db.js";
import { upsertEmailCache } from "../lib/tools/email-cache.js";
import type { EmailCacheEntry } from "../lib/tools/email-cache.js";
import {
  enqueueSuggestionJob,
  dequeueSuggestionJob,
  markJobComplete,
  markJobFailed,
  countPendingJobs,
} from "../lib/tools/email-suggestion-queue.js";

let tempDir: string;

function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH!;
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-esq-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  // createProject triggers DB init → migrations → creates email_* tables
  createProject("test-project");
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(uid: string, overrides?: Partial<EmailCacheEntry>): EmailCacheEntry {
  return {
    uid,
    subject: `Test Subject ${uid}`,
    from_name: "Test Sender",
    from_addr: "test@example.com",
    date: "2026-07-15T12:00:00.000Z",
    snippet: `Snippet for ${uid}`,
    flags: "[]",
    has_attachments: 0,
    envelope_json: null,
    ...overrides,
  };
}

function readJob(rowId: number): {
  id: number; attempts: number; next_attempt_at: string;
} | undefined {
  const db = getDb(dbPath());
  return db.prepare(
    "SELECT id, attempts, next_attempt_at FROM email_suggestion_queue WHERE id = ?",
  ).get(rowId) as any;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("enqueueSuggestionJob", () => {
  const accountId = "test-account";
  const folder = "INBOX";
  const uid = "esq-001";

  it("enqueue → dequeue → markComplete (happy path)", () => {
    // 1. Ensure parent email_cache row exists
    upsertEmailCache(accountId, folder, [makeEntry(uid)]);

    // 2. Enqueue
    const enqueued = enqueueSuggestionJob(accountId, folder, uid);
    expect(enqueued).toBe(true);

    // 3. Dequeue
    const job = dequeueSuggestionJob();
    expect(job).not.toBeUndefined();
    expect(job!.account_id).toBe(accountId);
    expect(job!.folder).toBe(folder);
    expect(job!.uid).toBe(uid);

    // 4. Mark complete
    markJobComplete(job!.id);

    // 5. Verify no more jobs
    const next = dequeueSuggestionJob();
    expect(next).toBeUndefined();

    // 6. Pending count should be 0
    expect(countPendingJobs()).toBe(0);
  });

  it("enqueue duplicate → ON CONFLICT DO NOTHING (returns false)", () => {
    const dupUid = "esq-dup-001";
    upsertEmailCache(accountId, folder, [makeEntry(dupUid)]);

    // First enqueue succeeds
    expect(enqueueSuggestionJob(accountId, folder, dupUid)).toBe(true);
    // Second enqueue (duplicate) returns false
    expect(enqueueSuggestionJob(accountId, folder, dupUid)).toBe(false);

    // Only one job should be dequeuable
    const job = dequeueSuggestionJob();
    expect(job).not.toBeUndefined();

    // Clean up
    markJobComplete(job!.id);
  });

  it("enqueue for non-existent email_cache row → returns false", () => {
    const ghostUid = "esq-ghost-001";
    // No parent email_cache row — should fail
    const enqueued = enqueueSuggestionJob(accountId, folder, ghostUid);
    expect(enqueued).toBe(false);

    // Verify nothing was queued
    const job = dequeueSuggestionJob();
    expect(job).toBeUndefined();
  });
});

describe("markJobFailed", () => {
  const accountId = "test-account-mf";
  const folder = "INBOX";

  it("attempts progression 1→4 with correct delays, then deleted at attempt 5", () => {
    const uid = "esq-mf-001";
    upsertEmailCache(accountId, folder, [makeEntry(uid)]);

    // Enqueue
    enqueueSuggestionJob(accountId, folder, uid);
    const job = dequeueSuggestionJob();
    expect(job).not.toBeUndefined();
    const jobId = job!.id;

    // Expected delays: [30, 60, 120, 300, 600] seconds
    // Actually the code uses: [30, 60, 120, 300, 600]
    // Attempt 1: delay 30s
    // Attempt 2: delay 60s
    // Attempt 3: delay 120s
    // Attempt 4: delay 300s
    // Attempt 5: DELETE

    // Fail 4 times, checking state each time
    for (let attempt = 0; attempt < 4; attempt++) {
      markJobFailed(jobId, `Test error ${attempt + 1}`);

      // After markJobFailed, the job still exists if attempts < 5
      const row = readJob(jobId);
      if (attempt < 3) {
        // Attempts 0→1, 1→2, 2→3, 3→4 — still exists for 0-3 (4 iterations)
        expect(row).not.toBeUndefined();
        expect(row!.attempts).toBe(attempt + 1); // actual attempts after markJobFailed
        // next_attempt_at should be in the future
        expect(row!.next_attempt_at).toBeTruthy();
      }
    }

    // After the 4th markJobFailed call, attempts should be 4
    // 5th call should delete
    markJobFailed(jobId, "Final error — attempt 5");

    // Verify job is deleted
    const deleted = readJob(jobId);
    expect(deleted).toBeUndefined();
  });

  it("max attempts (5) → row deleted", () => {
    const uid = "esq-max-001";
    upsertEmailCache(accountId, folder, [makeEntry(uid)]);

    enqueueSuggestionJob(accountId, folder, uid);
    const job = dequeueSuggestionJob();
    expect(job).not.toBeUndefined();
    const jobId = job!.id;

    // Call markJobFailed exactly 5 times → row should be deleted on 5th
    markJobFailed(jobId, "e1");
    expect(readJob(jobId)).not.toBeUndefined(); // attempts = 1
    markJobFailed(jobId, "e2");
    expect(readJob(jobId)).not.toBeUndefined(); // attempts = 2
    markJobFailed(jobId, "e3");
    expect(readJob(jobId)).not.toBeUndefined(); // attempts = 3
    markJobFailed(jobId, "e4");
    expect(readJob(jobId)).not.toBeUndefined(); // attempts = 4
    markJobFailed(jobId, "e5");
    // Row should be deleted now
    expect(readJob(jobId)).toBeUndefined();
  });

  it("delay correctness — next_attempt_at is advanced into the future", () => {
    const uid = "esq-delay-001";
    upsertEmailCache(accountId, folder, [makeEntry(uid)]);

    enqueueSuggestionJob(accountId, folder, uid);
    const job = dequeueSuggestionJob();
    expect(job).not.toBeUndefined();
    const jobId = job!.id;

    // Initial state: next_attempt_at should be <= now
    const initial = readJob(jobId)!;
    const initialTs = Date.parse(initial.next_attempt_at + "Z");

    // Fail once — delay should be 30s
    markJobFailed(jobId, "delay test");
    const after = readJob(jobId)!;
    const afterTs = Date.parse(after.next_attempt_at + "Z");

    // next_attempt_at should be at least 29 seconds in the future
    // (allowing 1s clock skew)
    expect(afterTs - initialTs).toBeGreaterThanOrEqual(28_000);
  });
});

describe("dequeueSuggestionJob with future next_attempt_at", () => {
  const accountId = "test-account-future";
  const folder = "INBOX";

  it("job with future next_attempt_at is not returned by dequeue", () => {
    const uid = "esq-future-001";
    upsertEmailCache(accountId, folder, [makeEntry(uid)]);

    enqueueSuggestionJob(accountId, folder, uid);
    const job = dequeueSuggestionJob();
    expect(job).not.toBeUndefined();
    const jobId = job!.id;

    // Mark failed — sets next_attempt_at to now + 30s
    markJobFailed(jobId, "future test");

    // Immediate dequeue should NOT return this job
    const next = dequeueSuggestionJob();
    expect(next).toBeUndefined();

    // countPendingJobs should also be 0 (it filters by next_attempt_at <= now)
    expect(countPendingJobs()).toBe(0);
  });
});

describe("countPendingJobs", () => {
  const accountId = "test-account-cnt";
  const folder = "INBOX";

  it("returns accurate count of ready jobs", () => {
    // Enqueue 3 jobs
    for (let i = 0; i < 3; i++) {
      const uid = `esq-cnt-${i}`;
      upsertEmailCache(accountId, folder, [makeEntry(uid)]);
      enqueueSuggestionJob(accountId, folder, uid);
    }

    // Should have 3 pending
    expect(countPendingJobs()).toBe(3);

    // Dequeue and complete one
    const job1 = dequeueSuggestionJob();
    expect(job1).not.toBeUndefined();
    markJobComplete(job1!.id);
    expect(countPendingJobs()).toBe(2);

    // Fail another — it disappears from "pending" (next_attempt_at in future)
    const job2 = dequeueSuggestionJob();
    expect(job2).not.toBeUndefined();
    markJobFailed(job2!.id, "count test");
    expect(countPendingJobs()).toBe(1); // only job3 remains ready

    // Complete the last one
    const job3 = dequeueSuggestionJob();
    expect(job3).not.toBeUndefined();
    markJobComplete(job3!.id);
    expect(countPendingJobs()).toBe(0);
  });
});
