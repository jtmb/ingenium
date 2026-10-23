import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { authentication, getDb, identity, jobs, mcpCredentials, projects, resetDbForTest, runtimes } from "ingenium-core";
import { authorizationMiddleware } from "../lib/authorization-policy.js";
import { csrfMiddleware } from "../lib/middleware/csrf.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { runtimesRouter } from "../lib/routes/runtimes.js";
import { provisionLocalRuntime } from "../lib/runtime-provisioner.js";

const directory = mkdtempSync(join(tmpdir(), "ingenium-runtime-automation-"));
let server: Server;
let base: string;
let owner: ReturnType<typeof authentication.createSession>;
let other: ReturnType<typeof authentication.createSession>;
let stale: ReturnType<typeof authentication.createSession>;
let runtime: runtimes.RuntimeInstance;
let credential: ReturnType<typeof mcpCredentials.createMcpCredential>;
let workspaceId: string;
let projectId: string;
let ownerUserId: string;

const credentialRow = () => getDb().prepare(
  "SELECT id, token_hash, service_principal_id, expires_at, revoked_at FROM mcp_credentials WHERE id = ?",
).get(credential.id);

async function post(actor: "owner" | "other" | "stale" | "compatibility" | "none", workspace = workspaceId, body = "{}", csrf = true, suffix = "automation") {
  const session = actor === "owner" ? owner : actor === "other" ? other : actor === "stale" ? stale : null;
  return fetch(`${base}/api/v1/runtimes/browser/workspaces/${workspace}/${suffix}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-actor": actor,
      ...(session && csrf ? { Origin: "http://localhost:3000", "x-csrf-token": session.csrfToken } : {}),
    },
    body,
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const actor = req.get("x-test-actor");
    const session = actor === "owner" ? owner : actor === "other" ? other : actor === "stale" ? stale : null;
    if (session) req.principal = { type: "user", id: session.session.user_id, scopes: ["user:*"], session: session.session };
    if (actor === "compatibility") req.principal = { type: "compatibility", id: "installation", scopes: ["legacy:*"] };
    next();
  });
  app.use(csrfMiddleware);
  app.use(authorizationMiddleware);
  app.use("/api/v1/runtimes", runtimesRouter);
  app.use(errorHandler);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  vi.stubEnv("INGENIUM_HOME", directory);
  vi.stubEnv("INGENIUM_GLOBAL_CONFIG_PATH", join(directory, "opencode-global"));
  vi.stubEnv("INGENIUM_CORE_DB_PATH", join(directory, `data-${crypto.randomUUID()}.db`));
  vi.stubEnv("INGENIUM_DEPLOYMENT_MODE", "compatibility");
  vi.stubEnv("INGENIUM_RUNTIME_MANAGER_URL", "");
  const keyPath = join(directory, `key-${crypto.randomUUID()}`);
  writeFileSync(keyPath, Buffer.alloc(32, 7).toString("base64url"), { mode: 0o600 });
  vi.stubEnv("INGENIUM_AUTH_ENCRYPTION_KEY_FILE", keyPath);
  resetDbForTest();
  const user = identity.createUser(`owner-${crypto.randomUUID()}@example.test`, "Runtime owner");
  const foreign = identity.createUser(`other-${crypto.randomUUID()}@example.test`, "Other user");
  ownerUserId = user.id;
  const organizationId = (getDb().prepare("SELECT organization_id AS id FROM bootstrap_state WHERE singleton = 1")
    .get() as { id: string }).id;
  const now = new Date().toISOString();
  getDb().prepare("INSERT INTO organization_memberships (organization_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, 'owner', 'active', ?, ?)")
    .run(organizationId, user.id, now, now);
  projectId = projects.createProject("ingenium", false, organizationId).id;
  getDb().prepare("UPDATE bootstrap_state SET state = 'claimed', owner_user_id = ?, claimed_at = ?, updated_at = ? WHERE singleton = 1")
    .run(ownerUserId, now, now);
  workspaceId = "shared-memory-ingenium";
  const workspace = runtimes.authorizeWorkspace({ id: workspaceId, organizationId, projectId, ownerUserId, storagePath: "/home/brajam/repos/ingenium" });
  credential = mcpCredentials.createMcpCredential({
    kind: "runtime", audience: "runtime", name: "Owner runtime", scopes: ["child-mcp:runtime", "projects:read"],
    organizationId, projectId, workspaceId, launcherWorktree: workspace.storagePath,
    expiresAt: new Date(Date.now() + 600_000), createdByUserId: ownerUserId,
  });
  runtime = runtimes.createRuntimeInstance(workspaceId, {
    cpuMillis: 1_000, memoryBytes: 536_870_912, pidsLimit: 128, diskBytes: 536_870_912, processLimit: 64,
  });
  runtimes.bindRuntimeCapability(runtime.id, credential.id);
  runtime = runtimes.transitionRuntime({
    id: runtime.id, expectedRevision: runtime.revision, toState: "PROVISIONING", actorType: "system", actorId: "test",
    idleExpiresAt: new Date(Date.now() + 300_000), absoluteExpiresAt: new Date(Date.now() + 600_000),
  });
  runtime = runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "STARTING", actorType: "system", actorId: "test" });
  runtime = runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "READY", actorType: "system", actorId: "test" });
  owner = authentication.createSession(ownerUserId, new Date(), "owner", true);
  other = authentication.createSession(foreign.id, new Date(), "other", true);
  stale = authentication.createSession(ownerUserId);
});

afterEach(() => {
  resetDbForTest();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});

describe("explicit runtime automation owner authorization", () => {
  it("grants only the bound active runtime principal once without changing its credential", async () => {
    expect(runtimes.getReadyRuntimeForProject(projectId)).toBeUndefined();
    const before = credentialRow();
    const first = await post("owner");
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ data: { status: "ready", runtimeId: runtime.id } });
    expect(runtimes.getReadyRuntimeForProject(projectId)?.id).toBe(runtime.id);
    expect(credentialRow()).toEqual(before);
    const second = await post("owner");
    expect(second.status).toBe(200);
    expect(credentialRow()).toEqual(before);
    expect(getDb().prepare("SELECT count(*) AS count FROM automation_principal_grants WHERE project_id = ? AND status = 'active'").get(projectId))
      .toEqual({ count: 1 });
    runtime = runtimes.transitionRuntime({
      id: runtime.id, expectedRevision: runtime.revision, toState: "IDLE", actorType: "system", actorId: "test",
      idleExpiresAt: new Date(Date.now() - 1_000),
    });
    expect(runtimes.getReadyRuntimeForProject(projectId)).toBeUndefined();
    expect(credentialRow()).toEqual(before);
  });

  it("rejects unsupported callers, a foreign workspace and nonempty body without a grant", async () => {
    expect((await post("none")).status).toBe(401);
    expect((await post("compatibility")).status).toBe(403);
    expect((await post("other")).status).toBe(404);
    expect((await post("stale")).status).toBe(403);
    expect((await post("owner", workspaceId, "{}", false)).status).toBe(403);
    expect((await post("owner", `foreign-${crypto.randomUUID()}`)).status).toBe(404);
    expect((await post("owner", workspaceId, JSON.stringify({ servicePrincipalId: credential.servicePrincipalId }))).status).toBe(422);
    expect(runtimes.getReadyRuntimeForProject(projectId)).toBeUndefined();
  });

  it.each(["automation/", "AUTOMATION", "AUTOMATION/"])("requires step-up for handler-matching %s", async (suffix) => {
    const denied = await post("stale", workspaceId, "{}", true, suffix);
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe("STEP_UP_REQUIRED");
    expect(runtimes.getReadyRuntimeForProject(projectId)).toBeUndefined();
    expect(getDb().prepare("SELECT count(*) AS count FROM automation_principal_grants WHERE project_id = ? AND status = 'active'").get(projectId))
      .toEqual({ count: 0 });
    expect((await post("owner", workspaceId, "{}", true, suffix)).status).toBe(200);
  });

  it.each(["revoked binding", "stale epoch", "expired lifetime", "inactive principal", "revoked grant", "control plane"])(
    "refuses %s without changing credential or readiness", async (reason) => {
      if (reason === "revoked binding") runtimes.revokeRuntimeCapability(runtime.id);
      if (reason === "stale epoch") getDb().prepare(
        "UPDATE authorized_workspaces SET security_epoch = security_epoch + 1 WHERE id = ?",
      ).run(workspaceId);
      if (reason === "expired lifetime") runtime = runtimes.transitionRuntime({
        id: runtime.id, expectedRevision: runtime.revision, toState: "IDLE", actorType: "system", actorId: "test",
        idleExpiresAt: new Date(Date.now() - 1_000),
      });
      if (reason === "inactive principal") getDb().prepare("UPDATE service_principals SET status = 'revoked' WHERE id = ?")
        .run(credential.servicePrincipalId);
      if (reason === "revoked grant") getDb().prepare(`INSERT INTO automation_principal_grants
        (id, organization_id, project_id, service_principal_id, permission, status, granted_by_actor_type,
          granted_by_actor_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'execute', 'revoked', 'user', ?, ?, ?)`).run(
        crypto.randomUUID(), runtime.organizationId, projectId, credential.servicePrincipalId, ownerUserId,
        new Date().toISOString(), new Date().toISOString(),
      );
      if (reason === "control plane") vi.stubEnv("INGENIUM_DEPLOYMENT_MODE", "control-plane");
      const before = credentialRow();

      expect((await post("owner")).status).toBe(404);
      expect(runtimes.getReadyRuntimeForProject(projectId)).toBeUndefined();
      expect(credentialRow()).toEqual(before);
      expect(getDb().prepare("SELECT count(*) AS count FROM automation_principal_grants WHERE project_id = ? AND status = 'active'").get(projectId))
        .toEqual({ count: 0 });
    },
  );

  it("does not authorize an owned workspace for another project", async () => {
    const otherProject = projects.createProject(`other-${crypto.randomUUID()}`, false, runtime.organizationId);
    const otherWorkspace = runtimes.authorizeWorkspace({
      id: `other-${crypto.randomUUID()}`, organizationId: runtime.organizationId, projectId: otherProject.id,
      ownerUserId, storagePath: `/srv/other-${crypto.randomUUID()}`,
    });
    expect((await post("owner", otherWorkspace.id)).status).toBe(404);
    expect(runtimes.getReadyRuntimeForProject(projectId)).toBeUndefined();
  });

  it.each(["archived project", "suspended organization", "suspended owner"])(
    "stops selecting an already-granted runtime for a %s", async (reason) => {
      expect((await post("owner")).status).toBe(200);
      expect(runtimes.getReadyRuntimeForProject(projectId)?.id).toBe(runtime.id);
      const before = credentialRow();
      if (reason === "archived project") getDb().prepare("UPDATE projects SET archived_at = ? WHERE id = ?")
        .run(new Date().toISOString(), projectId);
      if (reason === "suspended organization") getDb().prepare("UPDATE organizations SET status = 'suspended' WHERE id = ?")
        .run(runtime.organizationId);
      if (reason === "suspended owner") {
        const timestamp = new Date().toISOString();
        getDb().prepare(`INSERT INTO organization_memberships
          (organization_id, user_id, role, status, created_at, updated_at)
          VALUES (?, ?, 'owner', 'active', ?, ?)`).run(runtime.organizationId, other.session.user_id, timestamp, timestamp);
        getDb().prepare(
          "UPDATE organization_memberships SET status = 'suspended' WHERE organization_id = ? AND user_id = ?",
        ).run(runtime.organizationId, ownerUserId);
      }
      expect(runtimes.getReadyRuntimeForProject(projectId)).toBeUndefined();
      expect(credentialRow()).toEqual(before);
    },
  );

  it("returns a bounded unavailable response if the grant store fails", async () => {
    getDb().exec("DROP TABLE automation_principal_grants");
    const response = await post("owner");
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: {
      code: "RUNTIME_UNAVAILABLE", message: "Runtime service is unavailable",
    } });
  });

  it("replays the existing bound credential after an unrelated owner job creates a Dispatcher grant", async () => {
    const first = provisionLocalRuntime(workspaceId);
    const receipt = getDb().prepare("SELECT mcp_credential_id AS id FROM runtime_capability_bindings WHERE runtime_id = ? AND revoked_at IS NULL")
      .get(runtime.id) as { id: string };
    expect(receipt.id).toBe(first.credential.id);
    const prior = getDb().prepare("SELECT id, token_hash, service_principal_id, expires_at FROM mcp_credentials WHERE id = ?")
      .get(receipt.id);
    jobs.createJob(projectId, "Synthetic job", undefined, "build", "synthetic fixture only");
    expect(runtimes.getReadyRuntimeForProject(projectId)).toBeUndefined();

    expect(provisionLocalRuntime(workspaceId).credential.id).toBe(receipt.id);
    expect(getDb().prepare("SELECT mcp_credential_id AS id FROM runtime_capability_bindings WHERE runtime_id = ? AND revoked_at IS NULL")
      .get(runtime.id)).toEqual(receipt);
    expect(getDb().prepare("SELECT id, token_hash, service_principal_id, expires_at FROM mcp_credentials WHERE id = ?")
      .get(receipt.id)).toEqual(prior);
    expect((await post("owner")).status).toBe(200);
    expect(runtimes.getReadyRuntimeForProject(projectId)?.id).toBe(runtime.id);
  });
});
