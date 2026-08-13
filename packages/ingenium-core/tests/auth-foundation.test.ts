import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getAuthenticationFoundationMigrationStatus, getDb, resetDbForTest } from "../lib/db.js";
import { claimBootstrap, BootstrapAlreadyClaimedError, getBootstrapStatus } from "../lib/tools/bootstrap.js";
import { createSession, derivePassword, hashSecurityToken, resolveSession, revokeSession } from "../lib/tools/authentication.js";
import { appendSecurityAuditEvent } from "../lib/tools/security-audit.js";
import { createScopedApiToken, createServicePrincipal, resolveScopedApiToken, revokeScopedApiToken } from "../lib/tools/security-tokens.js";
import { addOrganizationMember, addProjectMember, BOOTSTRAP_ORGANIZATION_ID, createOrganization, resolveProjectAccess } from "../lib/tools/organizations.js";
import { createProject } from "../lib/tools/projects.js";
import { createUser } from "../lib/tools/identity.js";

let tempDir = "";
const originalPath = process.env.INGENIUM_CORE_DB_PATH;

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
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const project = createProject("preserved", true);
    const projectIds = db.prepare("SELECT id FROM projects ORDER BY id").all();
    expect(project.organization_id).toBe(BOOTSTRAP_ORGANIZATION_ID);
    expect(db.prepare("SELECT state FROM bootstrap_state WHERE singleton = 1").get()).toEqual({ state: "pending" });
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(getAuthenticationFoundationMigrationStatus()).toMatchObject({
      "093": { complete: true, missing: [] },
      "094": { complete: true, missing: [] },
      "095": { complete: true, missing: [] },
    });

    db.exec("DROP TRIGGER security_audit_events_immutable_delete; DROP TRIGGER security_audit_events_immutable_update; DROP TRIGGER scoped_api_tokens_identity_immutable; DROP INDEX idx_security_audit_scope; DROP INDEX idx_organization_invitations_scope; DROP INDEX idx_scoped_api_tokens_service; DROP INDEX idx_scoped_api_tokens_user; DROP TABLE security_audit_events; DROP TABLE organization_invitations; DROP TABLE scoped_api_tokens; DROP TABLE service_principals; DROP TABLE installation_admins; DROP TRIGGER auth_one_time_states_consume_once; DROP INDEX idx_auth_one_time_states_expiry; DROP INDEX idx_auth_sessions_user_active; DROP INDEX idx_auth_identities_user; DROP TABLE auth_recovery_codes; DROP TABLE auth_totp_factors; DROP TABLE auth_one_time_states; DROP TABLE auth_sessions; DROP TABLE password_credentials; DROP TABLE auth_identities; DROP TRIGGER projects_require_organization_insert; DROP TRIGGER projects_require_organization_update; DROP TRIGGER project_memberships_same_organization_insert; DROP TRIGGER project_memberships_same_organization_update; DROP TRIGGER organization_memberships_keep_owner_delete; DROP TRIGGER organization_memberships_keep_owner_update; DROP TRIGGER project_memberships_reject_org_departure; DROP TRIGGER project_memberships_reject_org_delete; DROP TRIGGER projects_reject_membership_reparent; DROP TRIGGER bootstrap_manifests_immutable_update; DROP TRIGGER bootstrap_manifests_immutable_delete; DROP INDEX idx_projects_organization; DROP TABLE project_memberships; DROP TABLE organization_memberships; DROP TABLE bootstrap_state; DROP TABLE bootstrap_manifests; DROP TABLE users; ALTER TABLE projects DROP COLUMN organization_id; DROP TABLE organizations;");
    resetDbForTest();
    const upgraded = getDb(process.env.INGENIUM_CORE_DB_PATH);
    expect(upgraded.prepare("SELECT id FROM projects ORDER BY id").all()).toEqual(projectIds);
    expect(upgraded.prepare("SELECT count(*) AS count FROM auth_sessions").get()).toEqual({ count: 0 });
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
