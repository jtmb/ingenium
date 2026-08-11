import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMAIL_WATCHER_MARKER_CAP, clearAccount, remember } from "../lib/tools/email-watcher-markers.js";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";

const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
let tempDir = "";

function databasePath(): string {
  return process.env.INGENIUM_CORE_DB_PATH!;
}

function createMarkerProject(name: string): string {
  return createProject(name).id;
}

beforeEach(() => {
  resetDbForTest();
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-watcher-markers-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
});

afterEach(() => {
  resetDbForTest();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
});

describe("email watcher markers", () => {
  it("persists one winner across a database reopen", () => {
    const projectId = createMarkerProject("watcher-restart");

    expect(remember(projectId, "account", "INBOX", "same-uid")).toEqual({
      alreadyProcessed: false,
      newlyRecorded: true,
    });

    resetDbForTest();

    expect(remember(projectId, "account", "INBOX", "same-uid")).toEqual({
      alreadyProcessed: true,
      newlyRecorded: false,
    });
  });

  it("gives concurrent claim attempts exactly one newly recorded marker", async () => {
    const projectId = createMarkerProject("watcher-concurrent");

    const claims = await Promise.all(Array.from({ length: 8 }, () => Promise.resolve().then(() => (
      remember(projectId, "account", "INBOX", "shared-uid")
    ))));

    expect(claims.filter((claim) => claim.newlyRecorded)).toHaveLength(1);
    expect(claims.filter((claim) => claim.alreadyProcessed)).toHaveLength(7);
  });

  it("isolates marker claims by project, account, and folder", () => {
    const firstProject = createMarkerProject("watcher-first");
    const secondProject = createMarkerProject("watcher-second");

    expect(remember(firstProject, "account-a", "INBOX", "shared").newlyRecorded).toBe(true);
    expect(remember(firstProject, "account-a", "INBOX", "shared").alreadyProcessed).toBe(true);
    expect(remember(secondProject, "account-a", "INBOX", "shared").newlyRecorded).toBe(true);
    expect(remember(firstProject, "account-b", "INBOX", "shared").newlyRecorded).toBe(true);
    expect(remember(firstProject, "account-a", "Archive", "shared").newlyRecorded).toBe(true);

    expect(clearAccount(firstProject, "account-a")).toBe(2);
    expect(remember(firstProject, "account-a", "INBOX", "shared").newlyRecorded).toBe(true);
    expect(remember(secondProject, "account-a", "INBOX", "shared").alreadyProcessed).toBe(true);
    expect(remember(firstProject, "account-b", "INBOX", "shared").alreadyProcessed).toBe(true);
  });

  it("keeps exactly the newest 4096 markers with deterministic oldest pruning", () => {
    const projectId = createMarkerProject("watcher-cap");

    for (let index = 0; index <= EMAIL_WATCHER_MARKER_CAP; index++) {
      expect(remember(projectId, "account", "INBOX", `uid-${String(index).padStart(4, "0")}`).newlyRecorded).toBe(true);
    }

    const db = getDb(databasePath());
    const rows = db.prepare(
      `SELECT uid FROM email_watcher_markers
       WHERE project_id = ? AND account_id = ? AND folder = ?
       ORDER BY updated_at ASC, id ASC`,
    ).all(projectId, "account", "INBOX") as Array<{ uid: string }>;

    expect(rows).toHaveLength(EMAIL_WATCHER_MARKER_CAP);
    expect(rows[0]?.uid).toBe("uid-0001");
    expect(rows.at(-1)?.uid).toBe(`uid-${String(EMAIL_WATCHER_MARKER_CAP).padStart(4, "0")}`);
    expect(remember(projectId, "account", "INBOX", "uid-0000").newlyRecorded).toBe(true);
    expect(remember(projectId, "account", "INBOX", "uid-0001").newlyRecorded).toBe(true);
  });

  it("guards invalid marker rows and fails closed for a partial migration", () => {
    const projectId = createMarkerProject("watcher-schema");
    const db = getDb(databasePath());

    expect(() => db.prepare(
      `INSERT INTO email_watcher_markers
         (project_id, account_id, folder, uid, created_at, updated_at)
       VALUES (?, '', 'INBOX', 'uid', '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:00.000Z')`,
    ).run(projectId)).toThrow(/CHECK constraint failed/);

    db.exec("DROP INDEX idx_email_watcher_markers_scope_newest;");
    resetDbForTest();

    expect(() => getDb(databasePath())).toThrow("Migration 092 is in a PARTIAL state");
  });

  it("applies migration 092 to a legacy database without the marker table", () => {
    const projectId = createMarkerProject("watcher-legacy");
    getDb(databasePath()).exec("DROP TABLE email_watcher_markers;");

    resetDbForTest();

    expect(getDb(databasePath()).prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'email_watcher_markers'",
    ).get()).toEqual({ count: 1 });
    expect(remember(projectId, "legacy-account", "INBOX", "legacy-uid").newlyRecorded).toBe(true);
  });
});
