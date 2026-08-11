import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import {
  applyEmailCacheDelta,
  getAccountCursor,
  getCachedEmail,
  getCachedEmailBody,
  getCachedSuggestions,
  getCachedSummary,
  setAccountCursor,
  upsertEmailBody,
  upsertEmailCache,
  upsertEmailSuggestions,
  upsertEmailSummary,
} from "../lib/tools/email-cache.js";
import { enqueueSuggestionJob } from "../lib/tools/email-suggestion-queue.js";

const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
let tempDir = "";

function databasePath(): string {
  return process.env.INGENIUM_CORE_DB_PATH!;
}

function cacheMessage(folder: string, uid: string): void {
  upsertEmailCache("delta-account", folder, [{
    uid,
    subject: uid,
    from_addr: "sender@example.test",
    flags: "[]",
  }]);
}

function queueCount(folder: string, uid: string): number {
  return (getDb(databasePath()).prepare(
    "SELECT count(*) AS count FROM email_suggestion_queue WHERE account_id = ? AND folder = ? AND uid = ?",
  ).get("delta-account", folder, uid) as { count: number }).count;
}

beforeEach(() => {
  resetDbForTest();
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-email-delta-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
});

afterEach(() => {
  resetDbForTest();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
});

describe("email cache deltas", () => {
  it("deletes a remote message and children, advances its cursor, and survives a reopen", () => {
    cacheMessage("INBOX", "remote-delete");
    cacheMessage("Archive", "unrelated");
    upsertEmailBody("delta-account", "INBOX", "remote-delete", "<p>body</p>", "body", null);
    expect(enqueueSuggestionJob("delta-account", "INBOX", "remote-delete")).toBe(true);
    upsertEmailSuggestions("delta-account", "INBOX", "remote-delete", [{ tone: "brief", subject: "Re", body: "reply" }], null);
    upsertEmailSummary("delta-account", "INBOX", "remote-delete", "summary", null);
    setAccountCursor("delta-account", "before-delete", "gmail");

    applyEmailCacheDelta("delta-account", {
      upserts: [{ folder: "Archive", entry: { uid: "upserted", flags: "[]" } }],
      deletes: [{ folder: "INBOX", uid: "remote-delete" }],
      historyId: "after-delete",
      provider: "gmail",
    });

    expect(getCachedEmail("delta-account", "INBOX", "remote-delete")).toBeUndefined();
    expect(getCachedEmailBody("delta-account", "INBOX", "remote-delete")).toBeUndefined();
    expect(getCachedSuggestions("delta-account", "INBOX", "remote-delete")).toBeUndefined();
    expect(getCachedSummary("delta-account", "INBOX", "remote-delete")).toBeUndefined();
    expect(queueCount("INBOX", "remote-delete")).toBe(0);
    expect(getCachedEmail("delta-account", "Archive", "unrelated")).toBeDefined();
    expect(getCachedEmail("delta-account", "Archive", "upserted")).toBeDefined();
    expect(getAccountCursor("delta-account")).toEqual({ historyId: "after-delete", provider: "gmail" });

    resetDbForTest();

    expect(getCachedEmail("delta-account", "INBOX", "remote-delete")).toBeUndefined();
    expect(getCachedEmail("delta-account", "Archive", "unrelated")).toBeDefined();
    expect(getAccountCursor("delta-account")).toEqual({ historyId: "after-delete", provider: "gmail" });
  });

  it("uses Gmail's folderless deletion identity without deleting unrelated messages", () => {
    cacheMessage("INBOX", "globally-deleted");
    cacheMessage("Archive", "globally-deleted");
    cacheMessage("Archive", "still-here");

    applyEmailCacheDelta("delta-account", {
      upserts: [],
      deletes: [{ uid: "globally-deleted" }],
      historyId: "global-delete-cursor",
      provider: "gmail",
    });

    expect(getCachedEmail("delta-account", "INBOX", "globally-deleted")).toBeUndefined();
    expect(getCachedEmail("delta-account", "Archive", "globally-deleted")).toBeUndefined();
    expect(getCachedEmail("delta-account", "Archive", "still-here")).toBeDefined();
  });

  it("rolls back cache changes and keeps the prior cursor when a delta write fails", () => {
    cacheMessage("INBOX", "must-remain");
    setAccountCursor("delta-account", "before-failure", "gmail");
    getDb(databasePath()).exec(
      `CREATE TRIGGER fail_email_delta_upsert
       BEFORE INSERT ON email_cache
       WHEN NEW.uid = 'write-failure'
       BEGIN SELECT RAISE(ABORT, 'forced delta failure'); END`,
    );

    expect(() => applyEmailCacheDelta("delta-account", {
      upserts: [{ folder: "INBOX", entry: { uid: "write-failure", flags: "[]" } }],
      deletes: [{ folder: "INBOX", uid: "must-remain" }],
      historyId: "must-not-advance",
      provider: "gmail",
    })).toThrow("forced delta failure");

    expect(getCachedEmail("delta-account", "INBOX", "must-remain")).toBeDefined();
    expect(getCachedEmail("delta-account", "INBOX", "write-failure")).toBeUndefined();
    expect(getAccountCursor("delta-account")).toEqual({ historyId: "before-failure", provider: "gmail" });
  });
});

describe("migration 088", () => {
  it("adds lease columns to a legacy queue while preserving queued rows", () => {
    const db = getDb(databasePath());
    db.exec(`
      DROP TABLE email_suggestion_queue;
      CREATE TABLE email_suggestion_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL,
        folder TEXT NOT NULL,
        uid TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_error TEXT,
        UNIQUE(account_id, folder, uid)
      );
      INSERT INTO email_suggestion_queue (account_id, folder, uid, attempts)
      VALUES ('legacy-account', 'Drafts', 'queued-before-088', 2);
    `);

    resetDbForTest();

    const migrated = getDb(databasePath()).prepare(
      "SELECT attempts, lease_state, lease_owner, lease_expires_at FROM email_suggestion_queue WHERE uid = ?",
    ).get("queued-before-088") as {
      attempts: number;
      lease_state: string;
      lease_owner: string | null;
      lease_expires_at: string | null;
    };
    expect(migrated).toEqual({
      attempts: 2,
      lease_state: "queued",
      lease_owner: null,
      lease_expires_at: null,
    });
  });

  it("fails closed when only part of the lease schema exists", () => {
    const db = getDb(databasePath());
    db.exec(`
      DROP TABLE email_suggestion_queue;
      CREATE TABLE email_suggestion_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL,
        folder TEXT NOT NULL,
        uid TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_error TEXT,
        lease_state TEXT NOT NULL DEFAULT 'queued',
        UNIQUE(account_id, folder, uid)
      );
    `);

    resetDbForTest();

    expect(() => getDb(databasePath())).toThrow("Migration 088 is in a PARTIAL state");
  });
});
