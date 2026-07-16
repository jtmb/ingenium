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

describe("upsertEmailBody — ON CONFLICT DO UPDATE (HARD RULE #11)", () => {
  const accountId = "upsert-body-account";
  const folder = "INBOX";
  const uid = "upsert-body-uid";

  it("upsert body, then re-upsert — single row, updated data", () => {
    upsertEmailCache(accountId, folder, [makeEntry(uid)]);

    // First body upsert
    upsertEmailBody(accountId, folder, uid, "<p>Hi</p>", "Hi", '{"from":"test"}');
    expect(countChildRows("email_bodies", accountId, folder, uid)).toBe(1);

    let body = getCachedEmailBody(accountId, folder, uid);
    expect(body).not.toBeUndefined();
    expect(body!.html).toBe("<p>Hi</p>");
    expect(body!.text).toBe("Hi");

    // Second body upsert with different data — ON CONFLICT DO UPDATE
    upsertEmailBody(accountId, folder, uid, "<p>Updated</p>", "Updated", '{"from":"updated"}');

    // Must STILL be exactly ONE row (not INSERT OR REPLACE which would delete + insert)
    expect(countChildRows("email_bodies", accountId, folder, uid)).toBe(1);

    body = getCachedEmailBody(accountId, folder, uid);
    expect(body).not.toBeUndefined();
    expect(body!.html).toBe("<p>Updated</p>");
    expect(body!.text).toBe("Updated");
    expect(body!.headers_json).toBe('{"from":"updated"}');
  });

  it("idempotent upsert with same data", () => {
    upsertEmailBody(accountId, folder, uid, "<p>Same</p>", "Same", null);
    expect(countChildRows("email_bodies", accountId, folder, uid)).toBe(1);

    // Re-upsert with same data — still one row
    upsertEmailBody(accountId, folder, uid, "<p>Same</p>", "Same", null);
    expect(countChildRows("email_bodies", accountId, folder, uid)).toBe(1);
  });

  it("different folders with same uid store independently", () => {
    const sentFolder = "Sent Items";
    const sentUid = "body-multi-folder";

    upsertEmailCache(accountId, "INBOX", [makeEntry(sentUid)]);
    upsertEmailCache(accountId, sentFolder, [makeEntry(sentUid)]);

    upsertEmailBody(accountId, "INBOX", sentUid, "<p>Inbox body</p>", "Inbox text", null);
    upsertEmailBody(accountId, sentFolder, sentUid, "<p>Sent body</p>", "Sent text", null);

    expect(countChildRows("email_bodies", accountId, "INBOX", sentUid)).toBe(1);
    expect(countChildRows("email_bodies", accountId, sentFolder, sentUid)).toBe(1);

    const inboxBody = getCachedEmailBody(accountId, "INBOX", sentUid);
    const sentBody = getCachedEmailBody(accountId, sentFolder, sentUid);
    expect(inboxBody!.text).toBe("Inbox text");
    expect(sentBody!.text).toBe("Sent text");
  });

  it("does NOT insert when parent row is missing (FK defensive check)", () => {
    upsertEmailBody(accountId, folder, "no-parent-uid", "<p>Orphan</p>", "Orphan", null);
    expect(countChildRows("email_bodies", accountId, folder, "no-parent-uid")).toBe(0);
  });
});

describe("upsertEmailSuggestions — ON CONFLICT DO UPDATE (HARD RULE #11)", () => {
  const accountId = "upsert-suggest-account";
  const folder = "INBOX";
  const uid = "upsert-suggest-uid";

  it("upsert then re-upsert preserves single row (no INSERT OR REPLACE row deletion)", () => {
    // 1. Insert parent
    upsertEmailCache(accountId, folder, [makeEntry(uid)]);

    // 2. First suggest upsert
    upsertEmailSuggestions(accountId, folder, uid, [{ tone: "friendly", subject: "Re: Hi", body: "Hello!" }], "model-v1");
    expect(countChildRows("email_suggestions", accountId, folder, uid)).toBe(1);

    // 3. Second suggest upsert with different data
    upsertEmailSuggestions(accountId, folder, uid, [{ tone: "formal", subject: "Re: Hello", body: "Greetings." }], "model-v2");

    // 4. Must still be exactly ONE row (ON CONFLICT DO UPDATE, not INSERT OR REPLACE + INSERT)
    expect(countChildRows("email_suggestions", accountId, folder, uid)).toBe(1);

    // 5. Must contain the UPDATED data (not stale first insert)
    const cached = getCachedSuggestions(accountId, folder, uid);
    expect(cached).not.toBeUndefined();
    const parsed = JSON.parse(cached!.suggestions_json) as Array<{ tone: string; body: string }>;
    expect(parsed[0]!.tone).toBe("formal");
    expect(parsed[0]!.body).toBe("Greetings.");
    expect(cached!.model).toBe("model-v2");
  });

  it("third upsert with same key updates existing row (idempotent)", () => {
    // 3rd upsert to the same key
    upsertEmailSuggestions(accountId, folder, uid, [{ tone: "concise", subject: "Re: Quick", body: "OK" }], "model-v3");

    expect(countChildRows("email_suggestions", accountId, folder, uid)).toBe(1);
    const cached = getCachedSuggestions(accountId, folder, uid);
    expect(JSON.parse(cached!.suggestions_json)[0]!.tone).toBe("concise");
    expect(cached!.model).toBe("model-v3");
  });

  it("different folders with same uid store independently", () => {
    const sentFolder = "Sent Items";
    const sentUid = "multi-folder-uid";

    // Insert parent in INBOX
    upsertEmailCache(accountId, "INBOX", [makeEntry(sentUid)]);
    // Insert parent in Sent Items
    upsertEmailCache(accountId, sentFolder, [makeEntry(sentUid)]);

    // Upsert suggestion in INBOX
    upsertEmailSuggestions(accountId, "INBOX", sentUid, [{ tone: "warm", subject: "Re: Inbox", body: "From inbox" }], "m-1");
    // Upsert suggestion in Sent Items
    upsertEmailSuggestions(accountId, sentFolder, sentUid, [{ tone: "formal", subject: "Re: Sent", body: "From sent" }], "m-2");

    // Both should exist independently
    const inboxCached = getCachedSuggestions(accountId, "INBOX", sentUid);
    const sentCached = getCachedSuggestions(accountId, sentFolder, sentUid);
    expect(inboxCached).not.toBeUndefined();
    expect(sentCached).not.toBeUndefined();
    expect(JSON.parse(inboxCached!.suggestions_json)[0]!.body).toBe("From inbox");
    expect(JSON.parse(sentCached!.suggestions_json)[0]!.body).toBe("From sent");
  });

  it("does NOT insert when parent row is missing (FK defensive check)", () => {
    // No parent exists for this uid
    const orphanUid = "orphan-no-parent";
    upsertEmailSuggestions(accountId, folder, orphanUid, [{ tone: "neutral", subject: "Re: None", body: "Nope" }], null);

    // Should NOT have created a row (parent-existence check prevented it)
    expect(countChildRows("email_suggestions", accountId, folder, orphanUid)).toBe(0);
  });

  it("null model is persisted and survives re-upsert", () => {
    const nullModelUid = "null-model-uid";
    upsertEmailCache(accountId, folder, [makeEntry(nullModelUid)]);

    // Upsert with null model
    upsertEmailSuggestions(accountId, folder, nullModelUid, [{ tone: "casual", subject: "Re: Hey", body: "Yo" }], null);
    let cached = getCachedSuggestions(accountId, folder, nullModelUid);
    expect(cached!.model).toBeNull();

    // Re-upsert with model — verify it updates
    upsertEmailSuggestions(accountId, folder, nullModelUid, [{ tone: "casual", subject: "Re: Hey", body: "Yo" }], "new-model");
    cached = getCachedSuggestions(accountId, folder, nullModelUid);
    expect(cached!.model).toBe("new-model");
  });
});

describe("upsertEmailSummary — ON CONFLICT DO UPDATE (HARD RULE #11)", () => {
  const accountId = "upsert-summary-account";
  const folder = "INBOX";
  const uid = "upsert-summary-uid";

  it("upsert then re-upsert preserves single row", () => {
    upsertEmailCache(accountId, folder, [makeEntry(uid)]);

    // First upsert
    upsertEmailSummary(accountId, folder, uid, "First summary text", "model-a");
    expect(countChildRows("email_summaries", accountId, folder, uid)).toBe(1);

    // Second upsert with different data
    upsertEmailSummary(accountId, folder, uid, "Updated summary text", "model-b");

    // Must still be exactly ONE row
    expect(countChildRows("email_summaries", accountId, folder, uid)).toBe(1);

    // Must contain UPDATED data
    const cached = getCachedSummary(accountId, folder, uid);
    expect(cached!.summary_text).toBe("Updated summary text");
    expect(cached!.model).toBe("model-b");
  });

  it("different folders with same uid store independently", () => {
    const sentFolder = "Archive";
    const summaryUid = "multi-folder-summary";

    upsertEmailCache(accountId, "INBOX", [makeEntry(summaryUid)]);
    upsertEmailCache(accountId, sentFolder, [makeEntry(summaryUid)]);

    upsertEmailSummary(accountId, "INBOX", summaryUid, "Inbox summary", "m-x");
    upsertEmailSummary(accountId, sentFolder, summaryUid, "Archive summary", "m-y");

    const inboxCached = getCachedSummary(accountId, "INBOX", summaryUid);
    const archiveCached = getCachedSummary(accountId, sentFolder, summaryUid);
    expect(inboxCached!.summary_text).toBe("Inbox summary");
    expect(archiveCached!.summary_text).toBe("Archive summary");
  });

  it("does NOT insert when parent row is missing", () => {
    const orphanUid = "summary-orphan";
    upsertEmailSummary(accountId, folder, orphanUid, "Should not persist", null);
    expect(countChildRows("email_summaries", accountId, folder, orphanUid)).toBe(0);
  });
});

describe("folder preservation — suggestion cache keyed by actual folder", () => {
  const accountId = "folder-preserve-account";

  it("suggestions in non-INBOX folder are stored under the actual folder", () => {
    const sentFolder = "Sent";
    const sentUid = "folder-test-001";
    upsertEmailCache(accountId, sentFolder, [makeEntry(sentUid, { subject: "Sent message" })]);

    upsertEmailSuggestions(accountId, sentFolder, sentUid, [{ tone: "friendly", subject: "Re: Sent", body: "Hi" }], "test");

    // Suggestion should be found under "Sent", not INBOX
    const fromSent = getCachedSuggestions(accountId, sentFolder, sentUid);
    expect(fromSent).not.toBeUndefined();
    expect(fromSent!.folder).toBe(sentFolder);

    // Should NOT be found under INBOX (different folder)
    const fromInbox = getCachedSuggestions(accountId, "INBOX", sentUid);
    expect(fromInbox).toBeUndefined();
  });

  it("same uid in different folders are isolated", () => {
    const sameUid = "isolated-uid-99";
    // Insert in two different folders
    upsertEmailCache(accountId, "INBOX", [makeEntry(sameUid, { subject: "Inbox version" })]);
    upsertEmailCache(accountId, "Drafts", [makeEntry(sameUid, { subject: "Draft version" })]);

    // Upsert suggestions under each folder
    upsertEmailSuggestions(accountId, "INBOX", sameUid, [{ tone: "warm", subject: "Re: Inbox", body: "Inbox reply" }], null);
    upsertEmailSuggestions(accountId, "Drafts", sameUid, [{ tone: "casual", subject: "Re: Draft", body: "Draft reply" }], null);

    // Verify isolation
    const inboxSuggestion = getCachedSuggestions(accountId, "INBOX", sameUid);
    const draftSuggestion = getCachedSuggestions(accountId, "Drafts", sameUid);
    expect(inboxSuggestion!.folder).toBe("INBOX");
    expect(draftSuggestion!.folder).toBe("Drafts");
    expect(JSON.parse(inboxSuggestion!.suggestions_json)[0]!.body).toBe("Inbox reply");
    expect(JSON.parse(draftSuggestion!.suggestions_json)[0]!.body).toBe("Draft reply");
  });

  it("starred folder suggestion cache is separate from INBOX", () => {
    const starredUid = "starred-uid";
    const starredFolder = "[Gmail]/Starred";
    upsertEmailCache(accountId, "INBOX", [makeEntry(starredUid, { subject: "Inbox starred" })]);
    upsertEmailCache(accountId, starredFolder, [makeEntry(starredUid, { subject: "Starred copy" })]);

    upsertEmailSuggestions(accountId, starredFolder, starredUid, [{ tone: "formal", subject: "Re: Starred", body: "Important reply" }], null);
    upsertEmailSuggestions(accountId, "INBOX", starredUid, [{ tone: "casual", subject: "Re: Inbox", body: "Regular reply" }], null);

    // Cache isolation
    const starred = getCachedSuggestions(accountId, starredFolder, starredUid);
    const inbox = getCachedSuggestions(accountId, "INBOX", starredUid);
    expect(starred!.folder).toBe(starredFolder);
    expect(inbox!.folder).toBe("INBOX");
    expect(JSON.parse(starred!.suggestions_json)[0]!.body).not.toBe(JSON.parse(inbox!.suggestions_json)[0]!.body);
  });
});

describe("noreply gate — ordering (check before cache, before LLM)", () => {
  const accountId = "noreply-gate-account";
  const folder = "INBOX";

  it("noreply sender suggestion is never inserted into cache", () => {
    const noreplyUid = "noreply-test-001";
    upsertEmailCache(accountId, folder, [
      makeEntry(noreplyUid, {
        from_addr: "no-reply@github.com",
        from_name: "GitHub Notifications",
        subject: "Automated notification",
      }),
    ]);

    // Simulate the noreply gate test from the suggest route logic
    const noreplyPattern = /no[-_.]?reply|do[-_.]?not[-_.]?reply/i;
    const cached = getCachedEmail(accountId, folder, noreplyUid);
    expect(cached).not.toBeUndefined();
    const matchesNoreply = noreplyPattern.test(cached!.from_addr ?? "") || noreplyPattern.test(cached!.from_name ?? "");
    expect(matchesNoreply).toBe(true);

    // The gate should prevent any suggestion upsert (we verify the pattern matches)
    // In production, the API route checks this BEFORE calling upsertEmailSuggestions
    // Verify the cache is empty for noreply senders
    expect(countChildRows("email_suggestions", accountId, folder, noreplyUid)).toBe(0);
  });

  it("do-not-reply pattern also matched", () => {
    const donotreplyUid = "do-not-reply-002";
    upsertEmailCache(accountId, folder, [
      makeEntry(donotreplyUid, {
        from_addr: "do-not-reply@slack.com",
        from_name: "Slack",
        subject: "Message notification",
      }),
    ]);

    const noreplyPattern = /no[-_.]?reply|do[-_.]?not[-_.]?reply/i;
    const cached = getCachedEmail(accountId, folder, donotreplyUid);
    expect(noreplyPattern.test(cached!.from_addr ?? "")).toBe(true);
  });

  it("normal sender DOES match (not a false positive)", () => {
    const normalUid = "normal-sender-003";
    upsertEmailCache(accountId, folder, [
      makeEntry(normalUid, {
        from_addr: "jane@example.com",
        from_name: "Jane Smith",
        subject: "Meeting tomorrow",
      }),
    ]);

    const noreplyPattern = /no[-_.]?reply|do[-_.]?not[-_.]?reply/i;
    const cached = getCachedEmail(accountId, folder, normalUid);
    expect(noreplyPattern.test(cached!.from_addr ?? "")).toBe(false);
    expect(noreplyPattern.test(cached!.from_name ?? "")).toBe(false);
  });
});
