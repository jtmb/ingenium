/**
 * email-cache.test.ts — Tests for upsertEmailCache ON CONFLICT DO UPDATE fix.
 *
 * Verifies that the INSERT OR REPLACE → ON CONFLICT DO UPDATE change in
 * upsertEmailCache prevents ON DELETE CASCADE from destroying cached
 * smart replies (email_suggestions), bodies (email_bodies), and summaries
 * (email_summaries) on every re-sync cycle.
 *
 * Uses real SQLite (Pattern 2 from deep-seek.md) — no mocks.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../lib/tools/projects.js";
import { getDb } from "../lib/db.js";
import {
  upsertEmailCache,
  getCachedEmail,
  upsertEmailBody,
  getCachedEmailBody,
  upsertEmailSuggestions,
  getCachedSuggestions,
  upsertEmailSummary,
  getCachedSummary,
  type EmailCacheEntry,
} from "../lib/tools/email-cache.js";

let tempDir: string;

function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH!;
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-emailcache-"));
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

function countChildRows(table: string, accountId: string, folder: string, uid: string): number {
  const db = getDb(dbPath());
  const row = db.prepare(
    `SELECT COUNT(*) as count FROM ${table} WHERE account_id = ? AND folder = ? AND uid = ?`,
  ).get(accountId, folder, uid) as { count: number };
  return row.count;
}

// ── Test helpers: direct SQL to manipulate child tables independently ──────

function insertTestSuggestion(
  accountId: string, folder: string, uid: string,
): void {
  const db = getDb(dbPath());
  db.prepare(
    "INSERT OR REPLACE INTO email_suggestions (account_id, folder, uid, suggestions_json) VALUES (?, ?, ?, ?)",
  ).run(accountId, folder, uid, '[]');
}

function insertTestBody(
  accountId: string, folder: string, uid: string,
): void {
  const db = getDb(dbPath());
  db.prepare(
    "INSERT OR REPLACE INTO email_bodies (account_id, folder, uid) VALUES (?, ?, ?)",
  ).run(accountId, folder, uid);
}

function insertTestSummary(
  accountId: string, folder: string, uid: string,
): void {
  const db = getDb(dbPath());
  db.prepare(
    "INSERT OR REPLACE INTO email_summaries (account_id, folder, uid, summary_text) VALUES (?, ?, ?, ?)",
  ).run(accountId, folder, uid, "Test summary");
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("upsertEmailCache — ON CONFLICT preserves child rows", () => {
  const accountId = "test-account";
  const folder = "INBOX";
  const uid = "abc-123-ghi";

  it("upsert parent → insert child suggestion → re-upsert → child still exists", () => {
    // 1. Upsert parent
    upsertEmailCache(accountId, folder, [makeEntry(uid)]);

    // 2. Insert child suggestion using public API (has parent-existence check)
    upsertEmailSuggestions(accountId, folder, uid, [{ tone: "friendly", subject: "Re: Test", body: "Hello" }], "test-model");

    // 3. Verify suggestion exists
    const cached1 = getCachedSuggestions(accountId, folder, uid);
    expect(cached1).not.toBeUndefined();

    // 4. Re-upsert same parent (the re-sync scenario)
    upsertEmailCache(accountId, folder, [makeEntry(uid, { subject: "Updated Subject" })]);

    // 5. Verify suggestion STILL exists (not cascade-deleted)
    const cached2 = getCachedSuggestions(accountId, folder, uid);
    expect(cached2).not.toBeUndefined();
    expect(cached2!.model).toBe("test-model");

    // 6. Also verify parent was actually updated
    const parent = getCachedEmail(accountId, folder, uid);
    expect(parent).not.toBeUndefined();
    expect(parent!.subject).toBe("Updated Subject");
  });

  it("upsert parent → insert child body → re-upsert → child body still exists", () => {
    const bodyUid = "body-uid-001";
    upsertEmailCache(accountId, folder, [makeEntry(bodyUid)]);

    // Verify parent exists first (required for FK)
    const parentBefore = getCachedEmail(accountId, folder, bodyUid);
    expect(parentBefore).not.toBeUndefined();

    // Insert child body directly
    insertTestBody(accountId, folder, bodyUid);
    expect(countChildRows("email_bodies", accountId, folder, bodyUid)).toBe(1);

    // Re-upsert parent
    upsertEmailCache(accountId, folder, [makeEntry(bodyUid, { subject: "Body Test Updated" })]);

    // Body should survive
    expect(countChildRows("email_bodies", accountId, folder, bodyUid)).toBe(1);

    // Also verify via public API
    const body = getCachedEmailBody(accountId, folder, bodyUid);
    expect(body).not.toBeUndefined();
  });

  it("upsert parent → insert child summary → re-upsert → child summary still exists", () => {
    const summaryUid = "summary-uid-002";
    upsertEmailCache(accountId, folder, [makeEntry(summaryUid)]);

    // Insert child summary via public API
    upsertEmailSummary(accountId, folder, summaryUid, "Test summary text", "test-model");

    const cached1 = getCachedSummary(accountId, folder, summaryUid);
    expect(cached1).not.toBeUndefined();

    // Re-upsert parent
    upsertEmailCache(accountId, folder, [makeEntry(summaryUid, { subject: "Summary Test Updated" })]);

    // Summary should survive
    const cached2 = getCachedSummary(accountId, folder, summaryUid);
    expect(cached2).not.toBeUndefined();
    expect(cached2!.summary_text).toBe("Test summary text");
  });

  it("labels_json survives parent re-upsert", () => {
    const labelUid = "label-uid-003";
    const labelsJson = JSON.stringify(["INBOX", "IMPORTANT", "CATEGORY_PERSONAL"]);

    // 1. Insert with labels_json
    upsertEmailCache(accountId, folder, [makeEntry(labelUid, { labels_json: labelsJson })]);

    // 2. Read back
    let cached = getCachedEmail(accountId, folder, labelUid);
    expect(cached).not.toBeUndefined();
    expect(cached!.labels_json).toBe(labelsJson);

    // 3. Re-upsert without labels_json (simulating a sync that doesn't carry labels)
    upsertEmailCache(accountId, folder, [makeEntry(labelUid)]);
    // labels_json should be updated to null since excluded.labels_json = null

    cached = getCachedEmail(accountId, folder, labelUid);
    expect(cached!.labels_json).toBeNull();

    // 4. Re-upsert with new labels
    const newLabels = JSON.stringify(["INBOX", "STARRED"]);
    upsertEmailCache(accountId, folder, [makeEntry(labelUid, { labels_json: newLabels })]);
    cached = getCachedEmail(accountId, folder, labelUid);
    expect(cached!.labels_json).toBe(newLabels);
  });

  it("deleting parent from DB directly DOES cascade to child (regression: cascade still works)", () => {
    const cascadeUid = "cascade-uid-004";
    upsertEmailCache(accountId, folder, [makeEntry(cascadeUid)]);

    // Insert child suggestion
    upsertEmailSuggestions(accountId, folder, cascadeUid, [{ tone: "formal", subject: "Cascade Test", body: "Test" }], "test-model");
    expect(countChildRows("email_suggestions", accountId, folder, cascadeUid)).toBe(1);

    // Direct DELETE from email_cache (this should STILL cascade)
    const db = getDb(dbPath());
    const deleteResult = db.prepare(
      "DELETE FROM email_cache WHERE account_id = ? AND folder = ? AND uid = ?",
    ).run(accountId, folder, cascadeUid);
    expect(deleteResult.changes).toBe(1);

    // Child should be cascade-deleted
    expect(countChildRows("email_suggestions", accountId, folder, cascadeUid)).toBe(0);
  });

  it("non-INBOX folder UIDs work correctly", () => {
    const sentFolder = "Sent Items";
    const sentUid = "sent-uid-007";
    upsertEmailCache(accountId, sentFolder, [makeEntry(sentUid)]);

    // Insert child body
    insertTestBody(accountId, sentFolder, sentUid);
    expect(countChildRows("email_bodies", accountId, sentFolder, sentUid)).toBe(1);

    // Re-upsert parent
    upsertEmailCache(accountId, sentFolder, [makeEntry(sentUid, { subject: "Sent update" })]);

    // Body should survive in non-INBOX folder
    expect(countChildRows("email_bodies", accountId, sentFolder, sentUid)).toBe(1);
  });

  it("exact string UID propagation (not integer coercion)", () => {
    const accountId2 = "string-uid-account";
    const folder2 = "All Mail";
    const stringUid = "18a9b3c4d5e6f7g8"; // Gmail-style string UID

    // Insert with string UID
    upsertEmailCache(accountId2, folder2, [makeEntry(stringUid)]);

    // Read back and verify exact string match
    const cached = getCachedEmail(accountId2, folder2, stringUid);
    expect(cached).not.toBeUndefined();
    expect(cached!.uid).toBe(stringUid);
    // Verify it's exactly the string, not a number
    expect(typeof cached!.uid).toBe("string");

    // Try to retrieve with a numeric-like UID to verify no coercion
    const numericLikeUid = "12345";
    upsertEmailCache(accountId2, folder2, [makeEntry(numericLikeUid)]);
    const cached2 = getCachedEmail(accountId2, folder2, numericLikeUid);
    expect(cached2).not.toBeUndefined();
    expect(cached2!.uid).toBe("12345");
    expect(typeof cached2!.uid).toBe("string");
  });
});

describe("upsertEmailCache — multiple re-upserts stress test", () => {
  const accountId = "stress-account";
  const folder = "INBOX";
  const uid = "stress-uid";

  it("survives 5 consecutive re-upserts without losing child data", () => {
    // Insert parent
    upsertEmailCache(accountId, folder, [makeEntry(uid)]);

    // Insert all three child types
    upsertEmailSuggestions(accountId, folder, uid, [{ tone: "friendly", subject: "Re: Stress", body: "Hi" }], "model-1");
    insertTestBody(accountId, folder, uid);
    insertTestSummary(accountId, folder, uid);

    // 5 re-upserts
    for (let i = 0; i < 5; i++) {
      upsertEmailCache(accountId, folder, [makeEntry(uid, { subject: `Stress Test #${i}` })]);
    }

    // All children should survive
    expect(countChildRows("email_suggestions", accountId, folder, uid)).toBe(1);
    expect(countChildRows("email_bodies", accountId, folder, uid)).toBe(1);
    expect(countChildRows("email_summaries", accountId, folder, uid)).toBe(1);

    // Parent should reflect last update
    const parent = getCachedEmail(accountId, folder, uid);
    expect(parent).not.toBeUndefined();
    expect(parent!.subject).toBe("Stress Test #4");
  });
});
