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
import { createMcpCredential, resolveMcpCredential } from "../lib/tools/mcp-credentials.js";
import {
  authorizeWorkspace,
  bindRuntimeCapability,
  claimRuntimeLease,
  createRuntimeInstance,
  consumeRuntimeLaunchTicket,
  getRuntimeForWorkspace,
  markExpiredRuntimeOrphans,
  issueRuntimeLaunchTicket,
  recordRuntimeActivity,
  recordRuntimeHealth,
  revokeRuntimeCapability,
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
    expect(resolveMcpCredential(foreignCredential.token, "runtime")?.projectId).toBe(second.project.id);
    expect(resolveMcpCredential(foreignCredential.token, "mcp")).toBeUndefined();
    revokeRuntimeCapability(foreignRuntime.id);
    expect(resolveMcpCredential(foreignCredential.token, "runtime")).toBeUndefined();
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
    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "PROVISIONING", actorType: "manager", actorId: "manager", maxActiveRuntimes: 1 });
    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "STARTING", actorType: "manager", actorId: "manager", backendContainerId: "a".repeat(64) });
    runtime = recordRuntimeHealth(runtime.id, runtime.revision, "a".repeat(64), new Date("2026-08-13T00:00:00.750Z"));
    expect(runtime.lastAuthenticatedActivityAt).toBeNull();
    runtime = transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "READY", actorType: "system", actorId: "runtime-reconciler" });
    runtime = recordRuntimeActivity({ id: runtime.id, expectedRevision: runtime.revision, kind: "connection_opened", actorId: first.user.id });
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
});
