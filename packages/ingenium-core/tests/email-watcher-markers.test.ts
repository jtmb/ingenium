import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { EMAIL_WATCHER_MARKER_CAP, clearAccount, remember } from "../lib/tools/email-watcher-markers.js";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";

const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
let tempDir = "";

function databasePath(): string {
  return process.env.INGENIUM_CORE_DB_PATH!;
}

function createMailAccount(accountId: string, organizationId: string): void {
  getDb(databasePath()).prepare(
    `INSERT INTO mail_accounts
       (id, organization_id, owner_kind, email, name, provider, auth_type, config_json,
        created_by_actor_type, created_at, updated_at)
     VALUES (?, ?, 'organization', ?, ?, 'custom', 'app_password', '{}',
       'compatibility', datetime('now'), datetime('now'))
     ON CONFLICT(id) DO NOTHING`,
  ).run(accountId, organizationId, `${accountId}@example.test`, accountId);
}

function createMarkerProject(name: string, accountIds: string[] = []): string {
  const project = createProject(name);
  for (const accountId of accountIds) createMailAccount(accountId, project.organization_id);
  return project.id;
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
    const projectId = createMarkerProject("watcher-restart", ["account"]);

    expect(remember(projectId, "account", "INBOX", "same-uid")).toEqual({
      status: "newly_recorded",
      alreadyProcessed: false,
      newlyRecorded: true,
    });

    resetDbForTest();

    expect(remember(projectId, "account", "INBOX", "same-uid")).toEqual({
      status: "already_processed",
      alreadyProcessed: true,
      newlyRecorded: false,
    });
  });

  it("gives concurrent claim attempts exactly one newly recorded marker", async () => {
    const projectId = createMarkerProject("watcher-concurrent", ["account"]);

    const claims = await Promise.all(Array.from({ length: 8 }, () => Promise.resolve().then(() => (
      remember(projectId, "account", "INBOX", "shared-uid")
    ))));

    expect(claims.filter((claim) => claim.newlyRecorded)).toHaveLength(1);
    expect(claims.filter((claim) => claim.alreadyProcessed)).toHaveLength(7);
  });

  it("isolates marker claims by project, account, and folder", () => {
    const firstProject = createMarkerProject("watcher-first", ["account-a", "account-b"]);
    const secondProject = createMarkerProject("watcher-second", ["account-c"]);

    expect(remember(firstProject, "account-a", "INBOX", "shared").newlyRecorded).toBe(true);
    expect(remember(firstProject, "account-a", "INBOX", "shared").alreadyProcessed).toBe(true);
    expect(remember(secondProject, "account-c", "INBOX", "shared").newlyRecorded).toBe(true);
    expect(remember(firstProject, "account-b", "INBOX", "shared").newlyRecorded).toBe(true);
    expect(remember(firstProject, "account-a", "Archive", "shared").newlyRecorded).toBe(true);

    expect(clearAccount(firstProject, "account-a")).toBe(2);
    expect(remember(firstProject, "account-a", "INBOX", "shared").newlyRecorded).toBe(true);
    expect(remember(secondProject, "account-c", "INBOX", "shared").alreadyProcessed).toBe(true);
    expect(remember(firstProject, "account-b", "INBOX", "shared").alreadyProcessed).toBe(true);
  });

  it("keeps exactly the newest 4096 markers with deterministic oldest pruning", () => {
    const projectId = createMarkerProject("watcher-cap", ["account"]);

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
    const projectId = createMarkerProject("watcher-schema", ["schema-account"]);
    const db = getDb(databasePath());
    const organizationId = (db.prepare("SELECT organization_id FROM projects WHERE id = ?").get(projectId) as { organization_id: string }).organization_id;

    expect(() => db.prepare(
      `INSERT INTO email_watcher_markers
         (project_id, organization_id, account_id, folder, uid, created_at, updated_at)
       VALUES (?, ?, 'schema-account', '', 'uid', '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:00.000Z')`,
    ).run(projectId, organizationId)).toThrow(/CHECK constraint failed/);

    db.exec("DROP INDEX idx_email_watcher_markers_scope_newest;");
    resetDbForTest();

    expect(() => getDb(databasePath())).toThrow("Migration 092 is in a PARTIAL state");
  });

  it("applies migration 092 to a legacy database without the marker table", () => {
    const legacy = new Database(databasePath());
    const migrations = resolve(import.meta.dirname ?? __dirname, "../data/migrations");
    for (const file of readdirSync(migrations)
      .filter((name) => /^\d{3}_.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 91)
      .sort()) {
      legacy.exec(readFileSync(join(migrations, file), "utf8"));
    }
    const projectId = randomUUID();
    const now = new Date().toISOString();
    legacy.prepare(
      "INSERT INTO projects (id, name, path, is_global, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
    ).run(projectId, "watcher-legacy", "/watcher-legacy", now, now);
    legacy.close();

    const migrated = getDb(databasePath());
    expect(migrated.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'email_watcher_markers'",
    ).get()).toEqual({ count: 1 });
    const organizationId = (migrated.prepare("SELECT organization_id FROM projects WHERE id = ?").get(projectId) as { organization_id: string }).organization_id;
    createMailAccount("legacy-account", organizationId);
    expect(remember(projectId, "legacy-account", "INBOX", "legacy-uid").newlyRecorded).toBe(true);
  });

  it("returns a typed skip without writing when the scoped mail account is absent", () => {
    const projectId = createMarkerProject("watcher-absent");

    expect(remember(projectId, "missing-account", "INBOX", "uid")).toEqual({
      status: "account_absent",
      alreadyProcessed: false,
      newlyRecorded: false,
    });
    expect(getDb(databasePath()).prepare(
      "SELECT count(*) AS count FROM email_watcher_markers WHERE project_id = ?",
    ).get(projectId)).toEqual({ count: 0 });
  });
});
