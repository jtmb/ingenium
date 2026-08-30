import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { getAuthenticationFoundationMigrationStatus, getDb, resetDbForTest } from "../lib/db.js";
import { createUser } from "../lib/tools/identity.js";
import { createOrganization } from "../lib/tools/organizations.js";
import { createProject } from "../lib/tools/projects.js";
import { createServicePrincipal } from "../lib/tools/security-tokens.js";
import { createSession } from "../lib/tools/authentication.js";
import { coordinationWorktreeId, registerCoordinationSession } from "../lib/tools/coordination.js";
import { createMcpCredential, resolveMcpCredential } from "../lib/tools/mcp-credentials.js";
import {
  authorizeWorkspace,
  bindRuntimeCapability,
  claimRuntimeLease,
  createRuntimeInstance,
  consumeRuntimeBrowserLaunchTicket,
  consumeRuntimeLaunchTicket,
  getRuntimeForWorkspace,
  markExpiredRuntimeOrphans,
  issueRuntimeLaunchTicket,
  issueRuntimeBrowserLaunchTicket,
  recordRuntimeActivity,
  recordRuntimeCapabilityActivity,
  recordRuntimeHealth,
  resolveRuntimeBrowserSession,
  revokeAuthorizedWorkspace,
  revokeRuntimeCapability,
  revokeRuntimeBrowserSessionsForUser,
  RuntimeConflictError,
  transitionRuntime,
} from "../lib/tools/runtimes.js";

let directory = "";

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-runtime-isolation-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data");
  resetDbForTest();
});

afterEach(() => {
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

function tenancy(suffix: string) {
  getDb(process.env.INGENIUM_CORE_DB_PATH);
  const user = createUser(`runtime-${suffix}@example.test`, `Runtime ${suffix}`);
  const organizationId = createOrganization(`Runtime ${suffix}`, `runtime-${suffix}`);
  const now = new Date().toISOString();
  getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "INSERT INTO organization_memberships (organization_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, 'owner', 'active', ?, ?)",
  ).run(organizationId, user.id, now, now);
  const project = createProject(`runtime-${suffix}`, false, organizationId);
  return { user, organizationId, project };
}

const limits = {
  cpuMillis: 1_000,
  memoryBytes: 1_073_741_824,
  pidsLimit: 256,
  diskBytes: 2_147_483_648,
  processLimit: 128,
};

describe("AUTH-108 runtime isolation", () => {
  it("installs migration 101 exactly and refuses a partial schema", () => {
    const path = process.env.INGENIUM_CORE_DB_PATH!;
    const database = getDb(path);
    expect(getAuthenticationFoundationMigrationStatus()["101"]).toEqual({ any: true, complete: true, missing: [] });
    expect(getAuthenticationFoundationMigrationStatus()["102"]).toEqual({ any: true, complete: true, missing: [] });
    database.exec("DROP TRIGGER runtime_instances_scope_insert");
    resetDbForTest();

    expect(() => getDb(path)).toThrow(/Migration 101 is in a PARTIAL state.*runtime_instances_scope_insert trigger/);
    resetDbForTest();
    const raw = new Database(path);
    expect(raw.prepare("SELECT count(*) AS count FROM runtime_isolation_manifests").get()).toEqual({ count: 1 });
    raw.close();
  });

  it("backfills an AUTH-107 workspace and runtime capability without changing ownership", () => {
    const first = tenancy("backfill");
    const credential = createMcpCredential({
      servicePrincipalId: createServicePrincipal(first.organizationId, "runtime-backfill"),
      kind: "runtime",
      audience: "runtime",
      name: "runtime backfill",
      scopes: ["child-mcp:runtime"],
      organizationId: first.organizationId,
      projectId: first.project.id,
      workspaceId: "workspace-backfill",
      launcherWorktree: "/srv/workspaces/backfill",
      expiresAt: new Date(Date.now() + 60_000),
      createdByUserId: first.user.id,
    });
    const runtime = createRuntimeInstance("workspace-backfill", limits);
    bindRuntimeCapability(runtime.id, credential.id);
    resetDbForTest();

    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).not.toThrow();
    expect(getRuntimeForWorkspace("workspace-backfill")).toMatchObject({
      organizationId: first.organizationId,
      projectId: first.project.id,
      ownerUserId: first.user.id,
    });
    expect(getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("enforces one runtime per workspace and exact cross-project capability scope", () => {
    const first = tenancy("one");
    const second = tenancy("two");
    authorizeWorkspace({
      id: "workspace-one",
      organizationId: first.organizationId,
      projectId: first.project.id,
      ownerUserId: first.user.id,
      storagePath: "/srv/one/repository",
    });
    const runtime = createRuntimeInstance("workspace-one", limits);
    expect(() => createRuntimeInstance("workspace-one", limits)).toThrow();

    const foreignCredential = createMcpCredential({
      servicePrincipalId: createServicePrincipal(second.organizationId, "foreign-runtime"),
      kind: "runtime",
      audience: "runtime",
      name: "foreign runtime",
      scopes: ["child-mcp:runtime"],
      organizationId: second.organizationId,
      projectId: second.project.id,
      workspaceId: "workspace-two",
      launcherWorktree: "/srv/two/repository",
      expiresAt: new Date(Date.now() + 60_000),
      createdByUserId: second.user.id,
    });

    expect(() => bindRuntimeCapability(runtime.id, foreignCredential.id)).toThrow(/runtime capability scope is unavailable/);
    expect(resolveMcpCredential(foreignCredential.token, "runtime")).toBeUndefined();
    let foreignRuntime = createRuntimeInstance("workspace-two", limits);
    bindRuntimeCapability(foreignRuntime.id, foreignCredential.id);
    expect(resolveMcpCredential(foreignCredential.token, "runtime")).toBeUndefined();
    foreignRuntime = transitionRuntime({
      id: foreignRuntime.id,
      expectedRevision: foreignRuntime.revision,
      toState: "PROVISIONING",
      actorType: "manager",
      actorId: "manager",
    });
    expect(resolveMcpCredential(foreignCredential.token, "runtime")).toMatchObject({
      projectId: second.project.id,
      workspaceId: "workspace-two",
      storageMappingHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(resolveMcpCredential(foreignCredential.token, "mcp")).toBeUndefined();
    revokeRuntimeCapability(foreignRuntime.id);
    expect(resolveMcpCredential(foreignCredential.token, "runtime")).toBeUndefined();
  });

  it("retains a revoked workspace tombstone while authorizing its canonical storage replacement", () => {
    const scope = tenancy("supersession");
    const storagePath = "/srv/supersession/repository";
    const original = authorizeWorkspace({
      id: "acceptance-workspace",
      organizationId: scope.organizationId,
      projectId: scope.project.id,
      ownerUserId: scope.user.id,
      storagePath,
    });
    let runtime = createRuntimeInstance(original.id, limits);
    runtime = transitionRuntime({
      id: runtime.id,
      expectedRevision: runtime.revision,
      toState: "REVOKED",
      actorType: "manager",
      actorId: "manager",
    });
    const revoked = revokeAuthorizedWorkspace(original.id, new Date("2026-08-25T00:00:00.000Z"));
    const replacement = authorizeWorkspace({
      id: "shared-memory-workspace",
      organizationId: scope.organizationId,
      projectId: scope.project.id,
      ownerUserId: scope.user.id,
      storagePath,
    });

    expect(revoked).toMatchObject({ id: original.id, status: "revoked", securityEpoch: 1 });
    expect(replacement).toMatchObject({ id: "shared-memory-workspace", status: "authorized", storagePath });
    expect(revokeAuthorizedWorkspace(original.id, new Date("2026-08-26T00:00:00.000Z"))).toEqual(revoked);
    expect(getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    resetDbForTest();
    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).not.toThrow();
  });

  it("uses CAS leases, bounded lifecycle, activity-backed idle state, revoke, and orphan recovery", () => {
    const first = tenancy("lifecycle");
    authorizeWorkspace({
      id: "workspace-lifecycle",
      organizationId: first.organizationId,
      projectId: first.project.id,
      ownerUserId: first.user.id,
      storagePath: "/srv/lifecycle/repository",
    });
    let runtime = createRuntimeInstance("workspace-lifecycle", limits);
    runtime = claimRuntimeLease({
      id: runtime.id,
      expectedRevision: runtime.revision,
      ownerToken: "a".repeat(32),
      ttlMs: 1_000,
      actorId: "manager",
      now: new Date("2026-08-13T00:00:00.000Z"),
    });
    expect(() => claimRuntimeLease({
      id: runtime.id,
      expectedRevision: runtime.revision,
      ownerToken: "b".repeat(32),
      ttlMs: 1_000,
      actorId: "manager",
      now: new Date("2026-08-13T00:00:00.500Z"),
    })).toThrowError(RuntimeConflictError);
    runtime = transitionRuntime({
      id: runtime.id,
      expectedRevision: runtime.revision,
      toState: "PROVISIONING",
      actorType: "manager",
      actorId: "manager",
      maxActiveRuntimes: 1,
      absoluteExpiresAt: new Date("2026-08-13T00:10:00.000Z"),
    });
    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "STARTING", actorType: "manager", actorId: "manager", backendContainerId: "a".repeat(64) });
    runtime = recordRuntimeHealth(runtime.id, runtime.revision, "a".repeat(64), new Date("2026-08-13T00:00:00.750Z"));
    expect(runtime.lastAuthenticatedActivityAt).toBeNull();
    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "READY", actorType: "system", actorId: "runtime-reconciler" });
    runtime = recordRuntimeActivity({
      id: runtime.id,
      expectedRevision: runtime.revision,
      kind: "connection_opened",
      actorId: first.user.id,
      now: new Date("2026-08-13T00:09:00.000Z"),
      idleLeaseMs: 300_000,
    });
    expect(runtime.idleExpiresAt).toBe("2026-08-13T00:10:00.000Z");
    runtime = recordRuntimeActivity({ id: runtime.id, expectedRevision: runtime.revision, kind: "generation_started", actorId: first.user.id });
    expect(runtime).toMatchObject({ activeConnections: 1, activeGenerations: 1 });
    runtime = recordRuntimeActivity({ id: runtime.id, expectedRevision: runtime.revision, kind: "generation_finished", actorId: first.user.id });
    runtime = recordRuntimeActivity({ id: runtime.id, expectedRevision: runtime.revision, kind: "connection_closed", actorId: first.user.id });
    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "IDLE", actorType: "system", actorId: "runtime-reconciler" });
    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "REVOKED", actorType: "manager", actorId: "manager" });
    expect(runtime).toMatchObject({ state: "REVOKED", activeConnections: 0, activeGenerations: 0, securityEpoch: 1 });

    authorizeWorkspace({
      id: "workspace-orphan",
      organizationId: first.organizationId,
      projectId: first.project.id,
      ownerUserId: first.user.id,
      storagePath: "/srv/lifecycle/orphan",
    });
    let orphan = createRuntimeInstance("workspace-orphan", limits);
    orphan = claimRuntimeLease({ id: orphan.id, expectedRevision: orphan.revision, ownerToken: "c".repeat(32), ttlMs: 1_000, actorId: "manager", now: new Date("2026-08-13T00:00:00.000Z") });
    orphan = transitionRuntime({ id: orphan.id, expectedRevision: orphan.revision, toState: "PROVISIONING", actorType: "manager", actorId: "manager", maxActiveRuntimes: 1 });
    expect(markExpiredRuntimeOrphans(new Date("2026-08-13T00:00:02.000Z"))).toEqual([
      expect.objectContaining({ id: orphan.id, state: "FAILED", leaseExpiresAt: null }),
    ]);
  });

  it("renews only the capability-bound runtime with a live coordination peer and makes replays inert", () => {
    const scope = tenancy("capability-activity");
    const workspace = authorizeWorkspace({
      id: "workspace-capability-activity",
      organizationId: scope.organizationId,
      projectId: scope.project.id,
      ownerUserId: scope.user.id,
      storagePath: "/srv/capability/activity",
    });
    const credential = createMcpCredential({
      servicePrincipalId: createServicePrincipal(scope.organizationId, "runtime activity"),
      kind: "runtime",
      audience: "runtime",
      name: "runtime activity",
      scopes: ["child-mcp:runtime", "runtime:activity"],
      organizationId: scope.organizationId,
      projectId: scope.project.id,
      workspaceId: workspace.id,
      launcherWorktree: workspace.storagePath,
      expiresAt: new Date(Date.now() + 600_000),
      createdByUserId: scope.user.id,
    });
    const observedAt = new Date();
    let runtime = createRuntimeInstance(workspace.id, limits);
    bindRuntimeCapability(runtime.id, credential.id);
    runtime = transitionRuntime({
      id: runtime.id,
      expectedRevision: runtime.revision,
      toState: "PROVISIONING",
      actorType: "manager",
      actorId: "manager",
      idleExpiresAt: new Date(observedAt.getTime() + 1_000),
      absoluteExpiresAt: new Date(observedAt.getTime() + 600_000),
    });
    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "STARTING", actorType: "manager", actorId: "manager" });
    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "READY", actorType: "system", actorId: "reconciler" });
    const worktreeId = coordinationWorktreeId(workspace.id, workspace.storageMappingHash);
    registerCoordinationSession(scope.project.id, {
      worktreeId,
      sessionId: "session-capability-activity",
      incarnation: 1,
      ownershipToken: "o".repeat(32),
      ttlMs: 60_000,
      idempotencyKey: "register-capability-activity",
    });
    const input = {
      runtimeId: runtime.id,
      credentialId: credential.id,
      servicePrincipalId: credential.servicePrincipalId,
      organizationId: scope.organizationId,
      projectId: scope.project.id,
      workspaceId: workspace.id,
      storageMappingHash: workspace.storageMappingHash,
      observedAt,
      idleLeaseMs: 60_000,
    };

    const renewed = recordRuntimeCapabilityActivity({ ...input, now: observedAt });
    expect(renewed).toMatchObject({ renewed: true, runtime: { id: runtime.id, idleExpiresAt: new Date(observedAt.getTime() + 60_000).toISOString() } });
    const replayed = recordRuntimeCapabilityActivity({ ...input, now: new Date(observedAt.getTime() + 10_000) });
    expect(replayed).toMatchObject({ renewed: false, runtime: { revision: renewed.runtime.revision } });
    expect(() => recordRuntimeCapabilityActivity({ ...input, workspaceId: "foreign-workspace", now: observedAt }))
      .toThrowError(expect.objectContaining({ code: "SCOPE_UNAVAILABLE" }));

    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("UPDATE coordination_sessions SET expires_at = ? WHERE project_id = ? AND worktree_id = ?")
      .run(observedAt.toISOString(), scope.project.id, worktreeId);
    expect(() => recordRuntimeCapabilityActivity({
      ...input,
      observedAt: new Date(observedAt.getTime() + 20_000),
      now: new Date(observedAt.getTime() + 20_000),
    })).toThrowError(expect.objectContaining({ code: "ACTIVITY_UNAVAILABLE" }));
  });

  it("stores hash-only audience tickets and rejects expiry, replay, wrong runtime, and foreign owners", () => {
    const first = tenancy("tickets-one");
    const second = tenancy("tickets-two");
    authorizeWorkspace({ id: "workspace-tickets-one", organizationId: first.organizationId, projectId: first.project.id, ownerUserId: first.user.id, storagePath: "/srv/tickets/one" });
    authorizeWorkspace({ id: "workspace-tickets-two", organizationId: second.organizationId, projectId: second.project.id, ownerUserId: second.user.id, storagePath: "/srv/tickets/two" });
    let runtime = createRuntimeInstance("workspace-tickets-one", limits);
    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "PROVISIONING", actorType: "manager", actorId: "manager" });
    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "STARTING", actorType: "manager", actorId: "manager" });
    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "READY", actorType: "system", actorId: "reconciler" });
    const other = createRuntimeInstance("workspace-tickets-two", limits);
    const issuedAt = new Date("2026-08-13T00:00:00.000Z");
    const issued = issueRuntimeLaunchTicket({ runtimeId: runtime.id, ownerUserId: first.user.id, audience: "web", ttlMs: 60_000, now: issuedAt });
    const persisted = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "SELECT token_hash, nonce_hash FROM runtime_launch_tickets WHERE id = ?",
    ).get(issued.id) as { token_hash: string; nonce_hash: string };
    expect(JSON.stringify(persisted)).not.toContain(issued.token);
    expect(consumeRuntimeLaunchTicket({ token: issued.token, runtimeId: other.id, ownerUserId: first.user.id, audience: "web", now: issuedAt })).toBeUndefined();
    expect(consumeRuntimeLaunchTicket({ token: issued.token, runtimeId: runtime.id, ownerUserId: second.user.id, audience: "web", now: issuedAt })).toBeUndefined();
    expect(consumeRuntimeLaunchTicket({ token: issued.token, runtimeId: runtime.id, ownerUserId: first.user.id, audience: "cli", now: issuedAt })).toBeUndefined();
    expect(consumeRuntimeLaunchTicket({ token: issued.token, runtimeId: runtime.id, ownerUserId: first.user.id, audience: "web", now: new Date("2026-08-13T00:01:00.001Z") })).toBeUndefined();
    expect(consumeRuntimeLaunchTicket({ token: issued.token, runtimeId: runtime.id, ownerUserId: first.user.id, audience: "web", now: issuedAt })).toMatchObject({ runtimeId: runtime.id, audience: "web" });
    expect(consumeRuntimeLaunchTicket({ token: issued.token, runtimeId: runtime.id, ownerUserId: first.user.id, audience: "web", now: issuedAt })).toBeUndefined();
  });

  it("binds browser tickets and sessions to the exact audience, host, auth session, and revocation generation", () => {
    const first = tenancy("browser-tickets");
    authorizeWorkspace({ id: "workspace-browser", organizationId: first.organizationId, projectId: first.project.id, ownerUserId: first.user.id, storagePath: "/srv/browser/one" });
    let runtime = createRuntimeInstance("workspace-browser", limits);
    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "PROVISIONING", actorType: "manager", actorId: "manager" });
    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "STARTING", actorType: "manager", actorId: "manager" });
    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "READY", actorType: "system", actorId: "reconciler" });
    const now = new Date("2026-08-13T00:00:00.000Z");
    const authSession = createSession(first.user.id, now);
    const exchangeProof = "p".repeat(43);
    const issued = issueRuntimeBrowserLaunchTicket({
      runtimeId: runtime.id,
      ownerUserId: first.user.id,
      authSessionId: authSession.session.id,
      audience: "web",
      rootDomain: "runtime.example.test",
      scheme: "https",
      launcherOrigin: "https://dashboard.example.test",
      exchangeProof,
      now,
    });
    const persisted = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "SELECT token_hash, nonce_hash FROM runtime_browser_launch_tickets WHERE runtime_id = ?",
    ).get(runtime.id);
    expect(JSON.stringify(persisted)).not.toContain(exchangeProof);
    expect(consumeRuntimeBrowserLaunchTicket({ ...issued, exchangeProof, audience: "cli", now })).toBeUndefined();
    expect(consumeRuntimeBrowserLaunchTicket({ ...issued, exchangeProof, host: `web--${runtime.id}.other.example.test`, now })).toBeUndefined();
    expect(consumeRuntimeBrowserLaunchTicket({ ...issued, exchangeProof, origin: "https://evil.example.test", now })).toBeUndefined();
    expect(consumeRuntimeBrowserLaunchTicket({ ...issued, exchangeProof, launcherOrigin: "https://evil.example.test", now })).toBeUndefined();

    const expiringProof = "e".repeat(43);
    const expiring = issueRuntimeBrowserLaunchTicket({
      runtimeId: runtime.id,
      ownerUserId: first.user.id,
      authSessionId: authSession.session.id,
      audience: "cli",
      rootDomain: "runtime.example.test",
      scheme: "https",
      launcherOrigin: "https://dashboard.example.test",
      exchangeProof: expiringProof,
      now,
    });
    expect(consumeRuntimeBrowserLaunchTicket({ ...expiring, exchangeProof: expiringProof, now: new Date("2026-08-13T00:01:00.001Z") })).toBeUndefined();

    const exchanged = consumeRuntimeBrowserLaunchTicket({ exchangeProof, audience: issued.audience, origin: issued.origin, host: issued.host, launcherOrigin: issued.launcherOrigin, now });
    expect(exchanged?.session).toMatchObject({
      runtimeId: runtime.id,
      workspaceId: "workspace-browser",
      audience: "web",
      host: issued.host,
      launcherOrigin: "https://dashboard.example.test",
    });
    expect(consumeRuntimeBrowserLaunchTicket({ exchangeProof, audience: issued.audience, origin: issued.origin, host: issued.host, launcherOrigin: issued.launcherOrigin, now })).toBeUndefined();
    expect(resolveRuntimeBrowserSession({ token: exchanged!.token, audience: "cli", host: issued.host, origin: issued.origin, now })).toBeUndefined();
    expect(resolveRuntimeBrowserSession({ token: exchanged!.token, audience: "web", host: issued.host, origin: issued.origin, now })?.backendName).toBe(runtime.backendName);

    runtime = recordRuntimeActivity({ id: runtime.id, expectedRevision: runtime.revision, kind: "connection_opened", actorId: first.user.id, now });
    runtime = recordRuntimeActivity({ id: runtime.id, expectedRevision: runtime.revision, kind: "generation_started", actorId: first.user.id, now });
    revokeRuntimeBrowserSessionsForUser(first.user.id, now);
    expect(getRuntimeForWorkspace("workspace-browser")).toMatchObject({ activeConnections: 0, activeGenerations: 0 });
    expect(resolveRuntimeBrowserSession({ token: exchanged!.token, audience: "web", host: issued.host, origin: issued.origin, now })).toBeUndefined();
    runtime = getRuntimeForWorkspace("workspace-browser")!;

    const replacementProof = "r".repeat(43);
    const afterLogout = issueRuntimeBrowserLaunchTicket({
      runtimeId: runtime.id,
      ownerUserId: first.user.id,
      authSessionId: authSession.session.id,
      audience: "vscode",
      rootDomain: "runtime.example.test",
      scheme: "https",
      launcherOrigin: "https://dashboard.example.test",
      exchangeProof: replacementProof,
      now,
    });
    const replacement = consumeRuntimeBrowserLaunchTicket({ ...afterLogout, exchangeProof: replacementProof, now })!;
    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "REVOKED", actorType: "manager", actorId: "manager" });
    expect(resolveRuntimeBrowserSession({ token: replacement.token, audience: "vscode", host: afterLogout.host, origin: afterLogout.origin, now })).toBeUndefined();
  });

  it("reconciles activity counters when a runtime crashes", () => {
    const first = tenancy("crash-counters");
    authorizeWorkspace({ id: "workspace-crash", organizationId: first.organizationId, projectId: first.project.id, ownerUserId: first.user.id, storagePath: "/srv/crash/one" });
    let runtime = createRuntimeInstance("workspace-crash", limits);
    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "PROVISIONING", actorType: "manager", actorId: "manager" });
    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "STARTING", actorType: "manager", actorId: "manager" });
    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "READY", actorType: "system", actorId: "reconciler" });
    runtime = recordRuntimeActivity({ id: runtime.id, expectedRevision: runtime.revision, kind: "connection_opened", actorId: first.user.id });
    runtime = recordRuntimeActivity({ id: runtime.id, expectedRevision: runtime.revision, kind: "generation_started", actorId: first.user.id });

    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "FAILED", actorType: "system", actorId: "reconciler" });

    expect(runtime).toMatchObject({ state: "FAILED", activeConnections: 0, activeGenerations: 0 });
  });
});
