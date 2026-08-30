import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { BOOTSTRAP_ORGANIZATION_ID } from "../lib/tools/organizations.js";
import { upsertEmailCache } from "../lib/tools/email-cache.js";
import {
  claimSuggestionJob,
  enqueueSuggestionJob,
  markJobComplete,
  markJobFailed,
} from "../lib/tools/email-suggestion-queue.js";

const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
let tempDir = "";

function databasePath(): string {
  return process.env.INGENIUM_CORE_DB_PATH!;
}

function seedMessage(uid: string): void {
  upsertEmailCache("queue-account", "INBOX", [{ uid, flags: "[]" }]);
}

function makeReady(jobId: number): void {
  getDb(databasePath()).prepare(
    "UPDATE email_suggestion_queue SET next_attempt_at = datetime('now', '-1 second') WHERE id = ?",
  ).run(jobId);
}

function readJob(jobId: number): Record<string, unknown> | undefined {
  return getDb(databasePath()).prepare(
    "SELECT id, attempts, lease_state, lease_owner, lease_expires_at FROM email_suggestion_queue WHERE id = ?",
  ).get(jobId) as Record<string, unknown> | undefined;
}

beforeEach(() => {
  resetDbForTest();
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-email-queue-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
  const now = new Date().toISOString();
  getDb(databasePath()).prepare(
    `INSERT INTO mail_accounts
     (id, organization_id, owner_kind, email, name, provider, auth_type, config_json,
      created_by_actor_type, created_at, updated_at)
     VALUES ('queue-account', ?, 'organization', 'queue@example.test', 'Queue', 'gmail', 'oauth2', '{}', 'system', ?, ?)`,
  ).run(BOOTSTRAP_ORGANIZATION_ID, now, now);
});

afterEach(() => {
  resetDbForTest();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
});

describe("email suggestion queue leases", () => {
  it("atomically gives one claimant the job and requires that owner to complete it", () => {
    seedMessage("one-winner");
    expect(enqueueSuggestionJob("queue-account", "INBOX", "one-winner")).toBe(true);

    const first = claimSuggestionJob("worker-a");
    const second = claimSuggestionJob("worker-b");

    expect(first).toMatchObject({ account_id: "queue-account", folder: "INBOX", uid: "one-winner" });
    expect(second).toBeUndefined();
    expect(readJob(first!.id)?.lease_owner).not.toBe("worker-a");
    expect(markJobComplete(first!.id, "worker-b")).toBe(false);
    expect(markJobComplete(first!.id, "worker-a")).toBe(true);
    expect(readJob(first!.id)).toBeUndefined();
  });

  it("releases failed work for a later claimant and preserves retry state", () => {
    seedMessage("retry-owner");
    enqueueSuggestionJob("queue-account", "INBOX", "retry-owner");
    const first = claimSuggestionJob("worker-a")!;

    expect(markJobFailed(first.id, "worker-b", "not owner")).toBe(false);
    expect(markJobFailed(first.id, "worker-a", "safe failure")).toBe(true);
    expect(readJob(first.id)).toMatchObject({ attempts: 1, lease_state: "queued", lease_owner: null, lease_expires_at: null });

    makeReady(first.id);
    const retry = claimSuggestionJob("worker-b");
    expect(retry).toMatchObject({ id: first.id, uid: "retry-owner" });
  });

  it("reclaims an expired lease after reopening the database", () => {
    seedMessage("restart-lease");
    enqueueSuggestionJob("queue-account", "INBOX", "restart-lease");
    const claimed = claimSuggestionJob("before-restart")!;
    getDb(databasePath()).prepare(
      "UPDATE email_suggestion_queue SET lease_expires_at = datetime('now', '-1 second') WHERE id = ?",
    ).run(claimed.id);

    resetDbForTest();

    const recovered = claimSuggestionJob("after-restart");
    expect(recovered).toMatchObject({ id: claimed.id, uid: "restart-lease" });
    expect(markJobComplete(claimed.id, "before-restart")).toBe(false);
    expect(markJobComplete(claimed.id, "after-restart")).toBe(true);
  });

  it("removes a claimed job at the fifth owned failure", () => {
    seedMessage("retry-limit");
    enqueueSuggestionJob("queue-account", "INBOX", "retry-limit");
    const job = claimSuggestionJob("worker-a")!;
    getDb(databasePath()).prepare(
      "UPDATE email_suggestion_queue SET attempts = 4 WHERE id = ?",
    ).run(job.id);

    expect(markJobFailed(job.id, "worker-a", "fifth failure")).toBe(true);
    expect(readJob(job.id)).toBeUndefined();
  });

  it("does not enqueue an orphaned child job", () => {
    expect(enqueueSuggestionJob("queue-account", "INBOX", "missing-parent")).toBe(false);
    expect(claimSuggestionJob("worker-a")).toBeUndefined();
  });
});
