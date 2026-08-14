import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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
  const migrations = join(import.meta.dirname, "../data/migrations");
  for (const file of readdirSync(migrations).filter((name) => Number.parseInt(name.slice(0, 3), 10) <= migration).sort()) {
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
    db.exec("DROP TRIGGER security_audit_events_immutable_update; DROP TRIGGER security_audit_events_immutable_delete; DROP TRIGGER security_audit_events_project_organization_insert; DROP INDEX idx_security_audit_scope; ALTER TABLE security_audit_events RENAME TO security_audit_events_expected; CREATE TABLE security_audit_events (id TEXT PRIMARY KEY, actor_type TEXT, actor_id TEXT, action TEXT, organization_id TEXT, project_id TEXT, outcome TEXT, metadata_json TEXT, created_at TEXT); CREATE INDEX idx_security_audit_scope ON security_audit_events(organization_id, project_id, created_at DESC, id DESC); CREATE TRIGGER security_audit_events_immutable_update BEFORE UPDATE ON security_audit_events BEGIN SELECT RAISE(ABORT, 'security audit events are immutable'); END; CREATE TRIGGER security_audit_events_immutable_delete BEFORE DELETE ON security_audit_events BEGIN SELECT RAISE(ABORT, 'security audit events are immutable'); END; CREATE TRIGGER security_audit_events_project_organization_insert BEFORE INSERT ON security_audit_events WHEN NEW.organization_id IS NOT NULL AND NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND organization_id = NEW.organization_id) BEGIN SELECT RAISE(ABORT, 'security audit project must belong to organization'); END; DROP TABLE security_audit_events_expected;");
    resetDbForTest();
    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).toThrow(/Migration 095 is in a PARTIAL state.*security_audit_events definition/);
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
