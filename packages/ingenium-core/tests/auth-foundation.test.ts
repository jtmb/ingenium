import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { getAuthenticationFoundationMigrationStatus, getDb, resetDbForTest } from "../lib/db.js";
import { claimBootstrap, BootstrapAlreadyClaimedError, getBootstrapStatus } from "../lib/tools/bootstrap.js";
import { createSession, derivePassword, hashSecurityToken, resolveSession, revokeSession } from "../lib/tools/authentication.js";
import { appendSecurityAuditEvent } from "../lib/tools/security-audit.js";
import { createScopedApiToken, createServicePrincipal, resolveScopedApiToken, revokeScopedApiToken } from "../lib/tools/security-tokens.js";
import { issueInvitation, listInvitations, revokeInvitation } from "../lib/tools/invitations.js";
import { addOrganizationMember, addProjectMember, BOOTSTRAP_ORGANIZATION_ID, createOrganization, resolveProjectAccess } from "../lib/tools/organizations.js";
import { createProject } from "../lib/tools/projects.js";
import { createUser } from "../lib/tools/identity.js";

let tempDir = "";
const originalPath = process.env.INGENIUM_CORE_DB_PATH;

function createLegacyDatabaseThrough(migration: number): Database.Database {
  const database = new Database(process.env.INGENIUM_CORE_DB_PATH!);
  database.function("sha256", { deterministic: true }, (value: string) => createHash("sha256").update(value).digest("hex"));
  const migrations = join(import.meta.dirname, "../data/migrations");
  for (const file of readdirSync(migrations)
    .filter((name) => !name.endsWith("_upgrade.sql") && Number.parseInt(name.slice(0, 3), 10) <= migration)
    .sort()) {
    database.exec(readFileSync(join(migrations, file), "utf8"));
  }
  return database;
}

beforeEach(() => {
  resetDbForTest();
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-auth-foundation-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
});

afterEach(() => {
  resetDbForTest();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  if (originalPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalPath;
});

describe("AUTH-100 migration and bootstrap foundation", () => {
  it("installs the exact post-104 audit schema on a fresh database", () => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const table = database.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'security_audit_events'",
    ).get() as { sql: string };

    expect(table.sql).toContain("104_project_history");
    expect(database.prepare("PRAGMA foreign_key_list('security_audit_events')").all()).toEqual([
      expect.objectContaining({ table: "organizations", from: "organization_id", on_delete: "RESTRICT" }),
    ]);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_security_audit_scope'").get()).toBeTruthy();
    expect(database.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'security_audit_events_%'").get()).toEqual({ count: 4 });
    expect(getAuthenticationFoundationMigrationStatus()["095"]).toEqual({ any: true, complete: true, missing: [] });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("creates a fresh complete schema and preserves existing project IDs on a 092-shaped upgrade", () => {
    const legacy = createLegacyDatabaseThrough(92);
    const projectId = randomUUID();
    const timestamp = new Date().toISOString();
    legacy.prepare("INSERT INTO projects (id, name, path, is_global, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
      .run(projectId, "preserved", "/preserved", timestamp, timestamp);
    legacy.close();

    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const projectIds = db.prepare("SELECT id FROM projects ORDER BY id").all();
    const project = db.prepare("SELECT organization_id FROM projects WHERE id = ?").get(projectId) as { organization_id: string };
    expect(project.organization_id).toBe(BOOTSTRAP_ORGANIZATION_ID);
    expect(db.prepare("SELECT state FROM bootstrap_state WHERE singleton = 1").get()).toEqual({ state: "pending" });
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(getAuthenticationFoundationMigrationStatus()).toMatchObject({
      "093": { complete: true, missing: [] },
      "094": { complete: true, missing: [] },
      "095": { complete: true, missing: [] },
    });

    expect(db.prepare("SELECT id FROM projects ORDER BY id").all()).toEqual(projectIds);
    expect(db.prepare("SELECT count(*) AS count FROM auth_sessions").get()).toEqual({ count: 0 });
  });

  it("fails closed without repairing a partial migration", () => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    db.exec("DROP INDEX idx_auth_sessions_user_active");
    resetDbForTest();
    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).toThrow("Migration 094 is in a PARTIAL state");
    const raw = new Database(process.env.INGENIUM_CORE_DB_PATH!);
    expect(raw.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'idx_auth_sessions_user_active'").get()).toEqual({ count: 0 });
    raw.close();
  });

  it("upgrades a 105-shaped database with cascading session CSRF grants", () => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    database.exec(`
      DROP TRIGGER users_delete_csrf_grants_on_security_change;
      DROP TRIGGER auth_sessions_delete_csrf_grants_on_revoke;
      DROP TABLE auth_session_csrf_grants;
    `);
    resetDbForTest();

    const upgraded = getDb(process.env.INGENIUM_CORE_DB_PATH);
    expect(upgraded.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'auth_session_csrf_grants'",
    ).get()).toEqual({ count: 1 });
    expect(upgraded.prepare("PRAGMA foreign_key_list('auth_session_csrf_grants')").all()).toContainEqual(
      expect.objectContaining({ table: "auth_sessions", from: "session_id", on_delete: "CASCADE" }),
    );
    expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("fails closed on a partial session CSRF grant migration", () => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    database.exec("DROP INDEX idx_auth_session_csrf_grants_expiry");
    resetDbForTest();

    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).toThrow("Migration 106 is in a PARTIAL state");
  });

  it("upgrades an exact AUTH-100 authentication schema and preserves valid one-time states", () => {
    const legacy = createLegacyDatabaseThrough(93);
    legacy.exec(readFileSync(join(import.meta.dirname, "auth100-authentication.sql"), "utf8"));
    const userId = randomUUID();
    const timestamp = new Date().toISOString();
    legacy.prepare("INSERT INTO users (id, email_normalized, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(userId, "upgrade@example.test", "Upgrade", timestamp, timestamp);
    legacy.prepare("INSERT INTO auth_one_time_states (id, purpose, user_id, state_hash, expires_at, created_at) VALUES (?, 'password_reset', ?, ?, ?, ?)")
      .run(randomUUID(), userId, "a".repeat(64), new Date(Date.now() + 60_000).toISOString(), timestamp);
    legacy.close();

    const upgraded = getDb(process.env.INGENIUM_CORE_DB_PATH);
    expect(upgraded.prepare("SELECT purpose FROM auth_one_time_states").all()).toEqual([{ purpose: "password_reset" }]);
    expect(() => upgraded.prepare("INSERT INTO auth_one_time_states (id, purpose, user_id, state_hash, expires_at, created_at) VALUES (?, 'mfa_challenge', ?, ?, ?, ?)")
      .run(randomUUID(), userId, "b".repeat(64), new Date(Date.now() + 60_000).toISOString(), new Date().toISOString())).not.toThrow();
    expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(getAuthenticationFoundationMigrationStatus()["094"]).toEqual({ any: true, complete: true, missing: [] });
  });

  it("fails closed when a complete-looking security table has an ambiguous definition", () => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    db.exec("DROP TRIGGER security_audit_events_immutable_update; DROP TRIGGER security_audit_events_immutable_delete; DROP TRIGGER security_audit_events_primary_key_collision; DROP TRIGGER security_audit_events_project_organization_insert; DROP INDEX idx_security_audit_scope; ALTER TABLE security_audit_events RENAME TO security_audit_events_expected; CREATE TABLE security_audit_events (id TEXT PRIMARY KEY, actor_type TEXT, actor_id TEXT, action TEXT, organization_id TEXT, project_id TEXT, outcome TEXT, metadata_json TEXT, created_at TEXT); CREATE INDEX idx_security_audit_scope ON security_audit_events(organization_id, project_id, created_at DESC, id DESC); CREATE TRIGGER security_audit_events_immutable_update BEFORE UPDATE ON security_audit_events BEGIN SELECT RAISE(ABORT, 'security audit events are immutable'); END; CREATE TRIGGER security_audit_events_immutable_delete BEFORE DELETE ON security_audit_events BEGIN SELECT RAISE(ABORT, 'security audit events are immutable'); END; CREATE TRIGGER security_audit_events_primary_key_collision BEFORE INSERT ON security_audit_events WHEN EXISTS (SELECT 1 FROM security_audit_events WHERE id = NEW.id) BEGIN SELECT RAISE(ABORT, 'security audit event id already exists'); END; CREATE TRIGGER security_audit_events_project_organization_insert BEFORE INSERT ON security_audit_events WHEN NEW.organization_id IS NOT NULL AND NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id) BEGIN SELECT RAISE(ABORT, 'security audit project must belong to organization'); END; DROP TABLE security_audit_events_expected;");
    resetDbForTest();
    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).toThrow(/Migration 095 is in a PARTIAL state.*security_audit_events.*definition/);
  });

  it("rejects a malformed exact pre-104 schema before rebuilding the audit table", () => {
    const legacy = createLegacyDatabaseThrough(103);
    const auditId = randomUUID();
    const timestamp = new Date().toISOString();
    legacy.prepare(
      "INSERT INTO security_audit_events (id, actor_type, action, outcome, metadata_json, created_at) VALUES (?, 'system', 'migration.preflight', 'failure', '{}', ?)",
    ).run(auditId, timestamp);
    legacy.exec("DROP INDEX idx_security_audit_scope; CREATE INDEX idx_security_audit_scope ON security_audit_events(project_id, created_at)");
    legacy.close();

    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).toThrow(/Migration 095 is in a PARTIAL state.*idx_security_audit_scope definition/);
    resetDbForTest();

    const unchanged = new Database(process.env.INGENIUM_CORE_DB_PATH!);
    const table = unchanged.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'security_audit_events'").get() as { sql: string };
    expect(table.sql).not.toContain("104_project_history");
    expect(unchanged.prepare("SELECT action FROM security_audit_events WHERE id = ?").get(auditId)).toEqual({ action: "migration.preflight" });
    expect(unchanged.prepare("PRAGMA foreign_key_list('security_audit_events')").all()).toContainEqual(
      expect.objectContaining({ table: "projects", from: "project_id", on_delete: "RESTRICT" }),
    );
    expect(unchanged.prepare("SELECT name FROM sqlite_master WHERE name = 'security_audit_events__project_fk'").get()).toBeUndefined();
    expect(unchanged.prepare("SELECT name FROM sqlite_master WHERE name = 'security_audit_events_primary_key_collision'").get()).toBeUndefined();
    expect(unchanged.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    unchanged.close();
  });

  it("upgrades the exact pre-104 audit schema, preserves rows, and reopens idempotently", () => {
    const legacy = createLegacyDatabaseThrough(103);
    const projectId = randomUUID();
    const auditId = randomUUID();
    const timestamp = new Date().toISOString();
    legacy.prepare(
      `INSERT INTO projects (id, name, path, organization_id, is_global, created_at, updated_at)
       VALUES (?, 'audit-upgrade', '/audit-upgrade', ?, 0, ?, ?)`,
    ).run(projectId, BOOTSTRAP_ORGANIZATION_ID, timestamp, timestamp);
    legacy.prepare(
      `INSERT INTO security_audit_events
       (id, actor_type, action, organization_id, project_id, outcome, metadata_json, created_at)
       VALUES (?, 'system', 'migration.104', ?, ?, 'success', '{}', ?)`,
    ).run(auditId, BOOTSTRAP_ORGANIZATION_ID, projectId, timestamp);
    expect(legacy.prepare("PRAGMA foreign_key_list('security_audit_events')").all()).toContainEqual(
      expect.objectContaining({ table: "projects", from: "project_id", on_delete: "RESTRICT" }),
    );
    legacy.close();

    const upgraded = getDb(process.env.INGENIUM_CORE_DB_PATH);
    expect(upgraded.prepare("SELECT * FROM security_audit_events WHERE id = ?").get(auditId)).toMatchObject({
      id: auditId,
      action: "migration.104",
      organization_id: BOOTSTRAP_ORGANIZATION_ID,
      project_id: projectId,
      metadata_json: "{}",
    });
    expect(upgraded.prepare("PRAGMA foreign_key_list('security_audit_events')").all()).toEqual([
      expect.objectContaining({ table: "organizations", from: "organization_id", on_delete: "RESTRICT" }),
    ]);
    expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(upgraded.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'security_audit_events_primary_key_collision'").get()).toBeTruthy();
    expect(getAuthenticationFoundationMigrationStatus()["095"]).toEqual({ any: true, complete: true, missing: [] });

    resetDbForTest();
    const reopened = getDb(process.env.INGENIUM_CORE_DB_PATH);
    expect(reopened.prepare("SELECT project_id FROM security_audit_events WHERE id = ?").get(auditId)).toEqual({ project_id: projectId });
    expect(reopened.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("upgrades the exact markerless legacy post-104 collision gap without changing audit rows", () => {
    const database = createLegacyDatabaseThrough(103);
    database.exec(readFileSync(
      join(import.meta.dirname, "../data/migrations/104_security_audit_project_history.sql"),
      "utf8",
    ).replace("  -- 104_project_history\n", ""));
    const auditId = randomUUID();
    const uniqueId = randomUUID();
    const timestamp = new Date().toISOString();
    database.prepare(
      `INSERT INTO security_audit_events
       (id, actor_type, action, outcome, metadata_json, created_at)
       VALUES (?, 'system', 'migration.104.compatibility', 'success', '{}', ?)`,
    ).run(auditId, timestamp);
    const before = database.prepare("SELECT * FROM security_audit_events WHERE id = ?").get(auditId);
    database.exec("DROP TRIGGER security_audit_events_primary_key_collision");
    database.close();
    resetDbForTest();

    const upgraded = getDb(process.env.INGENIUM_CORE_DB_PATH);
    expect(upgraded.prepare("SELECT * FROM security_audit_events WHERE id = ?").get(auditId)).toEqual(before);
    expect(upgraded.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'security_audit_events_primary_key_collision'",
    ).get()).toBeTruthy();
    for (const recursiveTriggers of ["OFF", "ON"] as const) {
      upgraded.pragma(`recursive_triggers = ${recursiveTriggers}`);
      expect(() => upgraded.prepare(
        `INSERT OR REPLACE INTO security_audit_events
         (id, actor_type, action, outcome, metadata_json, created_at)
         VALUES (?, 'system', 'migration.104.replaced', 'failure', '{}', ?)`,
      ).run(auditId, timestamp)).toThrow(/security audit event id already exists/);
    }
    expect(() => upgraded.prepare(
      `INSERT INTO security_audit_events
       (id, actor_type, action, outcome, metadata_json, created_at)
       VALUES (?, 'system', 'migration.104.unique', 'success', '{}', ?)`,
    ).run(uniqueId, timestamp)).not.toThrow();
    expect(upgraded.prepare("SELECT * FROM security_audit_events WHERE id = ?").get(auditId)).toEqual(before);
    expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    resetDbForTest();
    const reopened = getDb(process.env.INGENIUM_CORE_DB_PATH);
    expect(reopened.prepare("SELECT * FROM security_audit_events WHERE id = ?").get(auditId)).toEqual(before);
    expect(reopened.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = 'security_audit_events_primary_key_collision'",
    ).get()).toEqual({ count: 1 });
    expect(reopened.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it.each([
    {
      component: "missing prior index",
      mutate: "DROP INDEX idx_security_audit_scope",
      verify: (database: Database.Database) => expect(database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_security_audit_scope'",
      ).get()).toBeUndefined(),
    },
    {
      component: "malformed prior trigger",
      mutate: "DROP TRIGGER security_audit_events_immutable_delete; CREATE TRIGGER security_audit_events_immutable_delete BEFORE DELETE ON security_audit_events BEGIN SELECT RAISE(ABORT, 'wrong guard'); END",
      verify: (database: Database.Database) => expect((database.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'security_audit_events_immutable_delete'",
      ).get() as { sql: string }).sql).toContain("wrong guard"),
    },
    {
      component: "alternate audit trigger",
      mutate: "CREATE TRIGGER security_audit_events_collision_alternate BEFORE INSERT ON security_audit_events BEGIN SELECT RAISE(ABORT, 'alternate guard'); END",
      verify: (database: Database.Database) => expect(database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'security_audit_events_collision_alternate'",
      ).get()).toBeTruthy(),
    },
  ])("does not repair a legacy post-104 collision gap with a $component", ({ mutate, verify }) => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const auditId = randomUUID();
    database.prepare(
      `INSERT INTO security_audit_events
       (id, actor_type, action, outcome, metadata_json, created_at)
       VALUES (?, 'system', 'migration.104.near-match', 'failure', '{}', ?)`,
    ).run(auditId, new Date().toISOString());
    database.exec(`DROP TRIGGER security_audit_events_primary_key_collision; ${mutate}`);
    resetDbForTest();

    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).toThrow(/Migration 095 is in a PARTIAL state/);
    resetDbForTest();

    const unchanged = new Database(process.env.INGENIUM_CORE_DB_PATH!);
    expect(unchanged.prepare("SELECT action FROM security_audit_events WHERE id = ?").get(auditId)).toEqual({ action: "migration.104.near-match" });
    expect(unchanged.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'security_audit_events_primary_key_collision'",
    ).get()).toBeUndefined();
    verify(unchanged);
    expect(unchanged.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    unchanged.close();
  });

  it.each([
    {
      component: "index",
      mutate: "DROP INDEX idx_security_audit_scope; CREATE INDEX idx_security_audit_scope ON security_audit_events(project_id, created_at)",
      expected: /Migration 095 is in a PARTIAL state.*definition/,
    },
    {
      component: "trigger",
      mutate: "DROP TRIGGER security_audit_events_immutable_delete; CREATE TRIGGER security_audit_events_immutable_delete BEFORE DELETE ON security_audit_events BEGIN SELECT RAISE(ABORT, 'wrong guard'); END",
      expected: /Migration 095 is in a PARTIAL state.*definition/,
    },
    {
      component: "malformed primary-key collision trigger",
      mutate: "DROP TRIGGER security_audit_events_primary_key_collision; CREATE TRIGGER security_audit_events_primary_key_collision BEFORE INSERT ON security_audit_events WHEN NEW.id = '' BEGIN SELECT RAISE(ABORT, 'wrong guard'); END",
      expected: /Migration 095 is in a PARTIAL state.*security_audit_events_primary_key_collision definition/,
    },
  ])("rejects a malformed post-104 $component definition", ({ mutate, expected }) => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    database.exec(mutate);
    resetDbForTest();

    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).toThrow(expected);
  });

  it("rolls back an interrupted 104 table rebuild", () => {
    const legacy = createLegacyDatabaseThrough(103);
    const auditId = randomUUID();
    const timestamp = new Date().toISOString();
    legacy.prepare(
      "INSERT INTO security_audit_events (id, actor_type, action, outcome, metadata_json, created_at) VALUES (?, 'system', 'migration.interrupted', 'failure', '{}', ?)",
    ).run(auditId, timestamp);
    const migration = readFileSync(
      join(import.meta.dirname, "../data/migrations/104_security_audit_project_history.sql"),
      "utf8",
    ).replace("DROP TABLE security_audit_events__project_fk;", "SELECT missing_migration_104_step;\nDROP TABLE security_audit_events__project_fk;");

    expect(() => legacy.exec(migration)).toThrow();
    expect(legacy.inTransaction).toBe(true);
    legacy.exec("ROLLBACK");
    expect(legacy.prepare("SELECT action FROM security_audit_events WHERE id = ?").get(auditId)).toEqual({ action: "migration.interrupted" });
    expect(legacy.prepare("PRAGMA foreign_key_list('security_audit_events')").all()).toContainEqual(
      expect.objectContaining({ table: "projects", from: "project_id" }),
    );
    expect(legacy.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'security_audit_events_immutable_delete'").get()).toBeTruthy();
    expect(legacy.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    legacy.close();
  });

  it("claims bootstrap exactly once and persists only the password derivation", async () => {
    getDb(process.env.INGENIUM_CORE_DB_PATH);
    const claims = await Promise.allSettled([
      claimBootstrap({ email: "Owner@Example.test", displayName: "Owner", password: "correct horse battery staple" }),
      claimBootstrap({ email: "other@example.test", displayName: "Other", password: "another strong bootstrap passphrase" }),
    ]);
    expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === "rejected")).toHaveLength(1);
    expect((claims.find((claim) => claim.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(BootstrapAlreadyClaimedError);
    expect(getBootstrapStatus()).toEqual({ state: "claimed", revision: 1 });
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const credential = db.prepare("SELECT password_hash, salt, scrypt_n FROM password_credentials").get() as { password_hash: string; salt: string; scrypt_n: number };
    expect(credential.password_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(credential.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(credential.scrypt_n).toBeGreaterThanOrEqual(65_536);
    expect(JSON.stringify(credential)).not.toContain("correct horse");
  });

  it("upgrades AUTH-101 invitation guards and revokes a pending invitation once", () => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    db.exec(`DROP TRIGGER organization_invitations_consume_once;
      CREATE TRIGGER organization_invitations_consume_once
      BEFORE UPDATE ON organization_invitations
      WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.email_normalized IS NOT OLD.email_normalized
        OR NEW.role IS NOT OLD.role OR NEW.token_hash IS NOT OLD.token_hash OR NEW.expires_at IS NOT OLD.expires_at
        OR NEW.created_at IS NOT OLD.created_at OR OLD.accepted_at IS NOT NULL OR NEW.accepted_at IS NULL OR NEW.revoked_at IS NOT OLD.revoked_at
      BEGIN SELECT RAISE(ABORT, 'organization invitation may only be accepted once'); END;`);
    resetDbForTest();
    getDb(process.env.INGENIUM_CORE_DB_PATH);
    issueInvitation(BOOTSTRAP_ORGANIZATION_ID, "invitee@example.test", "member");
    const invitationId = listInvitations(BOOTSTRAP_ORGANIZATION_ID)[0]!.id;

    expect(revokeInvitation(BOOTSTRAP_ORGANIZATION_ID, invitationId)).toBe(true);
    expect(revokeInvitation(BOOTSTRAP_ORGANIZATION_ID, invitationId)).toBe(false);
    expect(listInvitations(BOOTSTRAP_ORGANIZATION_ID)[0]!.revokedAt).not.toBeNull();
  });
});

describe("AUTH-100 memberships, sessions, tokens, and audit", () => {
  it("enforces role access, cross-org membership, and last-active-owner invariants", () => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const owner = createUser("owner@example.test", "Owner");
    const member = createUser("member@example.test", "Member");
    addOrganizationMember(BOOTSTRAP_ORGANIZATION_ID, owner.id, "owner");
    addOrganizationMember(BOOTSTRAP_ORGANIZATION_ID, member.id, "member");
    const project = createProject("matrix");
    expect(resolveProjectAccess(member.id, project.id)).toEqual({ canRead: false, canWrite: false });
    addProjectMember(project.id, member.id, "editor");
    expect(resolveProjectAccess(member.id, project.id)).toEqual({ canRead: true, canWrite: true });
    db.prepare("UPDATE organization_memberships SET role = 'viewer' WHERE organization_id = ? AND user_id = ?")
      .run(BOOTSTRAP_ORGANIZATION_ID, member.id);
    expect(resolveProjectAccess(member.id, project.id)).toEqual({ canRead: true, canWrite: false });
    expect(() => db.prepare("UPDATE organization_memberships SET status = 'suspended' WHERE organization_id = ? AND user_id = ?")
      .run(BOOTSTRAP_ORGANIZATION_ID, member.id)).toThrow(/active project memberships/);
    expect(() => db.prepare("DELETE FROM organization_memberships WHERE organization_id = ? AND user_id = ?").run(BOOTSTRAP_ORGANIZATION_ID, owner.id)).toThrow(/retain an active owner/);

    const foreignOrganization = createOrganization("Foreign", "foreign");
    const foreignUser = createUser("foreign@example.test", "Foreign");
    addOrganizationMember(foreignOrganization, foreignUser.id, "owner");
    expect(() => addProjectMember(project.id, foreignUser.id, "viewer")).toThrow(/active organization membership/);
  });

  it("stores token hashes only and enforces session expiry and revocation", () => {
    getDb(process.env.INGENIUM_CORE_DB_PATH);
    const user = createUser("session@example.test", "Session User");
    const now = new Date("2026-08-13T12:00:00.000Z");
    const created = createSession(user.id, now);
    const persisted = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("SELECT token_hash FROM auth_sessions WHERE id = ?").get(created.session.id) as { token_hash: string };
    expect(persisted.token_hash).toBe(hashSecurityToken(created.token));
    expect(persisted.token_hash).not.toBe(created.token);
    expect(resolveSession(created.token, new Date(now.getTime() + 1_000))?.id).toBe(created.session.id);
    expect(resolveSession(created.token, new Date(now.getTime() + 31 * 60_000))).toBeUndefined();
    expect(revokeSession(user.id, created.session.id)).toBe(true);
    expect(resolveSession(created.token, new Date(now.getTime() + 1_000))).toBeUndefined();
    expect(() => hashSecurityToken("raw secret with spaces")).toThrow("Invalid security token");

    const principalId = createServicePrincipal(BOOTSTRAP_ORGANIZATION_ID, "fixture runner");
    const expiresAt = new Date(Date.now() + 60_000);
    const apiToken = createScopedApiToken({ servicePrincipalId: principalId }, ["projects:read"], expiresAt);
    const persistedApiToken = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("SELECT token_hash FROM scoped_api_tokens WHERE id = ?").get(apiToken.id) as { token_hash: string };
    expect(persistedApiToken.token_hash).toBe(hashSecurityToken(apiToken.token));
    expect(persistedApiToken.token_hash).not.toBe(apiToken.token);
    expect(resolveScopedApiToken(apiToken.token)?.scopes).toEqual(["projects:read"]);
    expect(resolveScopedApiToken(apiToken.token, new Date(expiresAt.getTime() + 1))).toBeUndefined();
    expect(revokeScopedApiToken(apiToken.id)).toBe(true);
    expect(resolveScopedApiToken(apiToken.token)).toBeUndefined();
  });

  it("uses asynchronous 64 MiB scrypt parameters and immutable redacted audit rows", async () => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const derived = await derivePassword("long enough password");
    expect(derived.hash).toMatch(/^[0-9a-f]{64}$/);
    const id = appendSecurityAuditEvent({ actorType: "compatibility", action: "bootstrap.status", outcome: "success" });
    expect(() => appendSecurityAuditEvent(Object.assign(
      { actorType: "system", action: "unsafe", outcome: "failure" } as const,
      { metadata: { detail: "raw-secret-under-neutral-key" } },
    ))).toThrow();
    expect(() => db.prepare(
      `INSERT INTO security_audit_events
       (id, actor_type, action, outcome, metadata_json, created_at)
       VALUES (?, 'system', 'unsafe.sql', 'failure', ?, ?)`,
    ).run(randomUUID(), JSON.stringify({ detail: "raw-secret-under-neutral-key" }), new Date().toISOString())).toThrow();
    expect(() => db.prepare("UPDATE security_audit_events SET action = 'changed' WHERE id = ?").run(id)).toThrow(/immutable/);
    expect(() => db.prepare("DELETE FROM security_audit_events WHERE id = ?").run(id)).toThrow(/immutable/);
    expect(JSON.stringify(db.prepare("SELECT * FROM security_audit_events WHERE id = ?").get(id))).not.toContain("password");
  });

  it.each(["OFF", "ON"] as const)("blocks INSERT OR REPLACE audit mutation with recursive_triggers %s", (recursiveTriggers) => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    database.pragma(`recursive_triggers = ${recursiveTriggers}`);
    const auditId = randomUUID();
    const uniqueId = randomUUID();
    const timestamp = new Date().toISOString();
    database.prepare(
      `INSERT INTO security_audit_events
       (id, actor_type, action, outcome, metadata_json, created_at)
       VALUES (?, 'system', 'audit.original', 'success', '{}', ?)`,
    ).run(auditId, timestamp);

    expect(() => database.prepare(
      `INSERT OR REPLACE INTO security_audit_events
       (id, actor_type, action, outcome, metadata_json, created_at)
       VALUES (?, 'system', 'audit.replaced', 'failure', '{}', ?)`,
    ).run(auditId, timestamp)).toThrow(/security audit event id already exists/);
    expect(database.prepare("SELECT action, outcome, metadata_json FROM security_audit_events WHERE id = ?").get(auditId)).toEqual({
      action: "audit.original",
      outcome: "success",
      metadata_json: "{}",
    });
    expect(() => database.prepare("UPDATE security_audit_events SET action = 'audit.updated' WHERE id = ?").run(auditId)).toThrow(/immutable/);
    expect(() => database.prepare("DELETE FROM security_audit_events WHERE id = ?").run(auditId)).toThrow(/immutable/);
    expect(() => database.prepare(
      `INSERT INTO security_audit_events
       (id, actor_type, action, outcome, metadata_json, created_at)
       VALUES (?, 'system', 'audit.unique', 'success', '{}', ?)`,
    ).run(uniqueId, timestamp)).not.toThrow();

    resetDbForTest();
    const reopened = getDb(process.env.INGENIUM_CORE_DB_PATH);
    expect(reopened.prepare("SELECT action, outcome, metadata_json FROM security_audit_events WHERE id = ?").get(auditId)).toEqual({
      action: "audit.original",
      outcome: "success",
      metadata_json: "{}",
    });
    expect(reopened.prepare("SELECT action FROM security_audit_events WHERE id = ?").get(uniqueId)).toEqual({ action: "audit.unique" });
    expect(reopened.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(getAuthenticationFoundationMigrationStatus()["095"]).toEqual({ any: true, complete: true, missing: [] });
  });

  it("requires an audit project to belong to the event organization", () => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const foreignOrganization = createOrganization("Audit Foreign", "audit-foreign");
    const foreignProject = createProject("audit-foreign-project");
    db.prepare("UPDATE projects SET organization_id = ? WHERE id = ?").run(foreignOrganization, foreignProject.id);

    expect(() => appendSecurityAuditEvent({
      actorType: "system",
      action: "project.read",
      organizationId: BOOTSTRAP_ORGANIZATION_ID,
      projectId: foreignProject.id,
      outcome: "denied",
    })).toThrow(/project must belong to organization/);
    expect(() => appendSecurityAuditEvent({
      actorType: "system",
      action: "project.read",
      organizationId: foreignOrganization,
      projectId: foreignProject.id,
      outcome: "success",
    })).not.toThrow();
  });
});
