import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { authentication, getDb, identity, organizations, projects, resetDbForTest, runtimes } from "ingenium-core";
import {
  compatibilityRuntimeReady,
  compatibilityRuntimeTarget,
  runtimesRouter,
} from "../lib/routes/runtimes.js";
import { reconcileRuntimes } from "../lib/runtime-reconciler.js";

let api: Server;
let manager: Server;
let apiBase = "";
let managerBase = "";
let directory = "";
let managerFailure = false;
let managerRuntimeState = "running";
let managerRequests: string[] = [];
let browserSession: ReturnType<typeof authentication.createSession> | null = null;
const token = "a".repeat(43);

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  }));
}

function createWorkspace(id: string) {
  const user = identity.createUser(`${id}@example.test`, id);
  const organizationId = organizations.createOrganization(id, id);
  const timestamp = new Date().toISOString();
  getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "INSERT INTO organization_memberships (organization_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, 'owner', 'active', ?, ?)",
  ).run(organizationId, user.id, timestamp, timestamp);
  const project = projects.createProject(id, false, organizationId);
  runtimes.authorizeWorkspace({
    id,
    organizationId,
    projectId: project.id,
    ownerUserId: user.id,
    storagePath: `/srv/approved/${id}`,
  });
  return { user, project, organizationId };
}

function authorizeAdditionalWorkspace(scope: ReturnType<typeof createWorkspace>, id: string) {
  return runtimes.authorizeWorkspace({
    id,
    organizationId: scope.organizationId,
    projectId: scope.project.id,
    ownerUserId: scope.user.id,
    storagePath: `/srv/approved/${id}`,
  });
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-runtimes-route-"));
  const tokenFile = join(directory, "manager-token");
  writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
  chmodSync(tokenFile, 0o600);
  process.env.INGENIUM_RUNTIME_MANAGER_TOKEN_FILE = tokenFile;

  manager = createServer((request, response) => {
    managerRequests.push(`${request.method} ${request.url}`);
    response.setHeader("Content-Type", "application/json");
    if (request.headers.authorization !== `Bearer ${token}` || managerFailure) {
      response.writeHead(503).end(JSON.stringify({ error: { code: "UNAVAILABLE" } }));
      return;
    }
    const match = /^\/v1\/runtimes\/([0-9a-f-]+)(?:\/stop)?$/.exec(request.url ?? "");
    const runtimeId = match?.[1] ?? "11111111-1111-4111-8111-111111111111";
    response.writeHead(request.url === "/v1/runtimes" ? 202 : 200).end(JSON.stringify({ data: {
      backendId: "a".repeat(64),
      backendName: `ingenium-runtime-${runtimeId.replaceAll("-", "")}`,
      state: request.url?.endsWith("/stop") ? "exited" : managerRuntimeState,
      health: "starting",
    } }));
  });
  managerBase = await listen(manager);
  process.env.INGENIUM_RUNTIME_MANAGER_URL = `${managerBase}/`;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (browserSession) req.principal = { type: "user", id: browserSession.session.user_id, scopes: ["user:*"], session: browserSession.session };
    next();
  });
  app.use("/api/v1/runtimes", runtimesRouter);
  api = createServer(app);
  apiBase = await listen(api);
});

beforeEach(() => {
  managerFailure = false;
  managerRuntimeState = "running";
  managerRequests = [];
  browserSession = null;
  process.env.INGENIUM_DEPLOYMENT_MODE = "control-plane";
  process.env.INGENIUM_RUNTIME_ROOT_DOMAIN = "runtime.example.test";
  process.env.INGENIUM_CORE_DB_PATH = join(directory, `data-${crypto.randomUUID()}`);
  resetDbForTest();
});

afterEach(() => {
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  delete process.env.INGENIUM_RUNTIME_ROOT_DOMAIN;
  delete process.env.INGENIUM_DEPLOYMENT_MODE;
  delete process.env.INGENIUM_RUNTIME_MAX_ACTIVE_PER_USER;
});

afterAll(async () => {
  await Promise.all([
    new Promise<void>((resolve) => api.close(() => resolve())),
    new Promise<void>((resolve) => manager.close(() => resolve())),
  ]);
  delete process.env.INGENIUM_RUNTIME_MANAGER_URL;
  delete process.env.INGENIUM_RUNTIME_MANAGER_TOKEN_FILE;
  rmSync(directory, { recursive: true, force: true });
});

describe("AUTH-108 runtime routes", () => {
  it("rejects malformed provisioning input", async () => {
    const response = await fetch(`${apiBase}/api/v1/runtimes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(422);
  });

  it("idempotently provisions one runtime per authorized workspace", async () => {
    createWorkspace("runtime-route-ok");
    const first = await fetch(`${apiBase}/api/v1/runtimes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "runtime-route-ok" }),
    });
    expect(first.status).toBe(202);
    await expect(first.json()).resolves.toMatchObject({ data: { state: "STARTING", backendContainerId: "a".repeat(64) } });

    const duplicate = await fetch(`${apiBase}/api/v1/runtimes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "runtime-route-ok" }),
    });
    expect(duplicate.status).toBe(202);
    expect(managerRequests.filter((request) => request === "POST /v1/runtimes")).toHaveLength(1);
  });

  it("fails closed and revokes the capability when the manager is unavailable", async () => {
    createWorkspace("runtime-route-failure");
    managerFailure = true;
    const response = await fetch(`${apiBase}/api/v1/runtimes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "runtime-route-failure" }),
    });
    expect(response.status).toBe(503);
    expect(runtimes.getRuntimeForWorkspace("runtime-route-failure")?.state).toBe("FAILED");
    expect(getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "SELECT count(*) AS count FROM mcp_credentials WHERE kind = 'runtime' AND revoked_at IS NULL",
    ).get()).toEqual({ count: 0 });

    managerFailure = false;
    const retry = await fetch(`${apiBase}/api/v1/runtimes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "runtime-route-failure" }),
    });
    const retryBody = await retry.json();
    expect(retry.status, JSON.stringify({ retryBody, runtime: runtimes.getRuntimeForWorkspace("runtime-route-failure") })).toBe(202);
  });

  it("removes owned manager resources before revoking a runtime", async () => {
    createWorkspace("runtime-route-revoke");
    const provisioned = await fetch(`${apiBase}/api/v1/runtimes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "runtime-route-revoke" }),
    });
    expect(provisioned.status).toBe(202);
    const runtime = runtimes.getRuntimeForWorkspace("runtime-route-revoke")!;

    const revoked = await fetch(`${apiBase}/api/v1/runtimes/${runtime.id}/revoke`, { method: "POST" });
    expect(revoked.status).toBe(200);
    await expect(revoked.json()).resolves.toMatchObject({ data: { state: "REVOKED" } });
    expect(managerRequests).toContain(`DELETE /v1/runtimes/${runtime.id}`);
    expect(getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "SELECT count(*) AS count FROM mcp_credentials WHERE kind = 'runtime' AND revoked_at IS NULL",
    ).get()).toEqual({ count: 0 });
  });

  it("fails a runtime whose managed container exits", async () => {
    createWorkspace("runtime-route-exited");
    const provisioned = await fetch(`${apiBase}/api/v1/runtimes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "runtime-route-exited" }),
    });
    expect(provisioned.status).toBe(202);
    const runtime = runtimes.getRuntimeForWorkspace("runtime-route-exited")!;

    managerRuntimeState = "exited";
    await reconcileRuntimes();

    expect(runtimes.getRuntimeInstance(runtime.id)?.state).toBe("FAILED");
  });

  it("returns opaque browser status and atomically exchanges a browser launch ticket", async () => {
    const scope = createWorkspace("runtime-route-browser");
    const provisioned = await fetch(`${apiBase}/api/v1/runtimes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "runtime-route-browser" }),
    });
    expect(provisioned.status).toBe(202);
    browserSession = authentication.createSession(scope.user.id);
    let runtime = runtimes.getRuntimeForWorkspace("runtime-route-browser")!;
    runtime = runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "READY", actorType: "system", actorId: "test" });

    const status = await fetch(`${apiBase}/api/v1/runtimes/browser/status`);
    expect(status.status).toBe(200);
    const statusBody = await status.json();
    expect(statusBody).toEqual({ data: { mode: "isolated", status: "ready", reason: null } });
    expect(JSON.stringify(statusBody)).not.toMatch(/runtimeId|backend|storagePath|ownerUserId|projectId/);

    const launched = await fetch(`${apiBase}/api/v1/runtimes/browser/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://dashboard.example.test" },
      body: JSON.stringify({ audience: "web", exchangeProof: "p".repeat(43), workspaceId: "runtime-route-browser" }),
    });
    expect(launched.status).toBe(201);
    const descriptor = (await launched.json() as { data: { launchUrl: string; status: string } }).data;
    expect(descriptor).toEqual({ launchUrl: `https://web--${runtime.id}.runtime.example.test/__ingenium/exchange`, status: "ready" });
    expect(JSON.stringify(descriptor)).not.toMatch(/backend|sessionToken|ticket|token/i);
    const launchOrigin = new URL(descriptor.launchUrl).origin;

    const mismatch = await fetch(`${apiBase}/api/v1/runtimes/gateway/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exchangeProof: "p".repeat(43), audience: "cli", origin: launchOrigin, host: new URL(launchOrigin).host, launcherOrigin: "https://dashboard.example.test" }),
    });
    expect(mismatch.status).toBe(401);
    const exchanged = await fetch(`${apiBase}/api/v1/runtimes/gateway/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exchangeProof: "p".repeat(43), audience: "web", origin: launchOrigin, host: new URL(launchOrigin).host, launcherOrigin: "https://dashboard.example.test" }),
    });
    expect(exchanged.status).toBe(200);
    const exchangedBody = await exchanged.json() as { data: { sessionToken: string } };
    const activityScope = {
      sessionToken: exchangedBody.data.sessionToken,
      audience: "web",
      origin: launchOrigin,
      host: new URL(launchOrigin).host,
    };
    for (const kind of ["connection_opened", "generation_started"] as const) {
      const activity = await fetch(`${apiBase}/api/v1/runtimes/gateway/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...activityScope, kind }),
      });
      expect(activity.status).toBe(200);
    }
    const active = runtimes.getRuntimeInstance(runtime.id)!;
    expect(active).toMatchObject({ activeConnections: 1, activeGenerations: 1 });
    const validated = await fetch(`${apiBase}/api/v1/runtimes/gateway/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(activityScope),
    });
    expect(validated.status).toBe(200);
    expect(runtimes.getRuntimeInstance(runtime.id)).toMatchObject({
      revision: active.revision,
      activeConnections: 1,
      activeGenerations: 1,
    });
    for (const kind of ["generation_finished", "connection_closed"] as const) {
      const activity = await fetch(`${apiBase}/api/v1/runtimes/gateway/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...activityScope, kind }),
      });
      expect(activity.status).toBe(200);
    }
    expect(runtimes.getRuntimeInstance(runtime.id)).toMatchObject({ activeConnections: 0, activeGenerations: 0 });
    const replay = await fetch(`${apiBase}/api/v1/runtimes/gateway/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exchangeProof: "p".repeat(43), audience: "web", origin: launchOrigin, host: new URL(launchOrigin).host, launcherOrigin: "https://dashboard.example.test" }),
    });
    expect(replay.status).toBe(401);

    for (const [audience, proof] of [["cli", "q".repeat(43)], ["vscode", "r".repeat(43)]] as const) {
      const audienceLaunch = await fetch(`${apiBase}/api/v1/runtimes/browser/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://dashboard.example.test" },
        body: JSON.stringify({ audience, exchangeProof: proof, workspaceId: "runtime-route-browser" }),
      });
      const audienceBody = await audienceLaunch.json() as { data: { launchUrl: string } };
      expect(audienceLaunch.status).toBe(201);
      expect(audienceBody.data.launchUrl).toBe(
        `https://${audience}--${runtime.id}.runtime.example.test/__ingenium/exchange`,
      );
      expect(JSON.stringify(audienceBody)).not.toMatch(/backend|container|storagePath|sessionToken/i);
    }
  });

  it("uses the compatibility descriptor without calling the runtime manager", async () => {
    const scope = createWorkspace("runtime-route-compatibility");
    browserSession = authentication.createSession(scope.user.id);
    process.env.INGENIUM_DEPLOYMENT_MODE = "compatibility";

    const status = await fetch(`${apiBase}/api/v1/runtimes/browser/status`);

    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toEqual({ data: { mode: "compatibility", status: "ready", reason: null } });
    expect(managerRequests).toEqual([]);
  });

  it.each([
    ["web", "http://127.0.0.1:4098/"],
    ["cli", "http://127.0.0.1:4099/"],
    ["vscode", "http://127.0.0.1:4100/?folder=/workspace"],
  ] as const)("health-checks the exact compatibility %s backend without returning its target", async (audience, target) => {
    const requests: string[] = [];
    const probe = (async (input: string | URL | Request) => {
      requests.push(String(input));
      return new Response(null, { status: 302 });
    }) as typeof fetch;

    expect(compatibilityRuntimeTarget(audience)).toBe(target);
    expect(await compatibilityRuntimeReady(audience, probe)).toBe(true);
    expect(requests).toEqual([target]);
  });

  it("rejects compatibility health access in isolated mode without exposing a backend", async () => {
    const scope = createWorkspace("runtime-route-health");
    browserSession = authentication.createSession(scope.user.id);

    const response = await fetch(`${apiBase}/api/v1/runtimes/browser/health?audience=web`);
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).not.toMatch(/4098|backend|container|127\.0\.0\.1/i);
  });

  it("lists only currently authorized owned workspaces without paths or authority IDs", async () => {
    const own = createWorkspace("runtime-route-own");
    createWorkspace("runtime-route-foreign");
    browserSession = authentication.createSession(own.user.id);

    const response = await fetch(`${apiBase}/api/v1/runtimes/browser/workspaces`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: [{
      id: "runtime-route-own",
      organizationName: "runtime-route-own",
      projectName: "runtime-route-own",
      status: "stopped",
    }] });
    expect(JSON.stringify(body)).not.toMatch(/storage|ownerUserId|organizationId|projectId|backend|\/srv\//i);

    const installationList = await fetch(`${apiBase}/api/v1/runtimes/workspaces`);
    expect(installationList.status).toBe(404);
    const createAuthorization = await fetch(`${apiBase}/api/v1/runtimes/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "browser-created", storagePath: "/tmp/browser-controlled" }),
    });
    expect(createAuthorization.status).toBe(404);
  });

  it("removes workspaces when organization or project membership is no longer active", async () => {
    const scope = createWorkspace("runtime-route-membership");
    browserSession = authentication.createSession(scope.user.id);
    const remainingOwner = identity.createUser("remaining-owner@example.test", "Remaining owner");
    const timestamp = new Date().toISOString();
    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "INSERT INTO organization_memberships (organization_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, 'owner', 'active', ?, ?)",
    ).run(scope.organizationId, remainingOwner.id, timestamp, timestamp);
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    db.prepare("UPDATE organizations SET status = 'suspended' WHERE id = ?").run(scope.organizationId);

    const suspendedOrganization = await fetch(`${apiBase}/api/v1/runtimes/browser/workspaces`);

    await expect(suspendedOrganization.json()).resolves.toEqual({ data: [] });
    db.prepare("UPDATE organizations SET status = 'active' WHERE id = ?").run(scope.organizationId);
    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "UPDATE organization_memberships SET status = 'suspended' WHERE organization_id = ? AND user_id = ?",
    ).run(scope.organizationId, scope.user.id);

    const suspendedMembership = await fetch(`${apiBase}/api/v1/runtimes/browser/workspaces`);

    await expect(suspendedMembership.json()).resolves.toEqual({ data: [] });
    db.prepare("UPDATE organization_memberships SET status = 'active' WHERE organization_id = ? AND user_id = ?")
      .run(scope.organizationId, scope.user.id);
    db.prepare("UPDATE projects SET archived_at = ? WHERE id = ?").run(timestamp, scope.project.id);
    const archivedProject = await fetch(`${apiBase}/api/v1/runtimes/browser/workspaces`);

    await expect(archivedProject.json()).resolves.toEqual({ data: [] });
  });

  it("coalesces concurrent explicit Web, CLI, and VS Code starts into one managed runtime", async () => {
    const scope = createWorkspace("runtime-route-concurrent");
    browserSession = authentication.createSession(scope.user.id);

    const responses = await Promise.all(["web", "cli", "vscode"].map(() => fetch(
      `${apiBase}/api/v1/runtimes/browser/workspaces/runtime-route-concurrent/start`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    )));

    expect(responses.map((response) => response.status)).toEqual([202, 202, 202]);
    expect(managerRequests.filter((request) => request === "POST /v1/runtimes")).toHaveLength(1);
    expect(runtimes.listRuntimeInstances(scope.user.id)).toHaveLength(1);
    expect(getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "SELECT count(*) AS count FROM security_audit_events WHERE actor_id = ? AND action = 'runtime.workspace.start' AND outcome = 'success'",
    ).get(scope.user.id)).toEqual({ count: 3 });
  });

  it("denies another user's workspace without invoking the manager", async () => {
    const owner = createWorkspace("runtime-route-owner");
    const other = createWorkspace("runtime-route-other");
    browserSession = authentication.createSession(other.user.id);

    const response = await fetch(`${apiBase}/api/v1/runtimes/browser/workspaces/runtime-route-owner/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(404);
    expect(managerRequests).toEqual([]);
    expect(runtimes.getRuntimeForWorkspace(owner.project.name)).toBeUndefined();
    expect(getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "SELECT count(*) AS count FROM security_audit_events WHERE actor_id = ? AND action = 'runtime.workspace.start' AND outcome = 'denied'",
    ).get(other.user.id)).toEqual({ count: 1 });
  });

  it("enforces the active runtime quota on explicit starts", async () => {
    const scope = createWorkspace("runtime-route-quota-one");
    authorizeAdditionalWorkspace(scope, "runtime-route-quota-two");
    browserSession = authentication.createSession(scope.user.id);
    process.env.INGENIUM_RUNTIME_MAX_ACTIVE_PER_USER = "1";

    const first = await fetch(`${apiBase}/api/v1/runtimes/browser/workspaces/runtime-route-quota-one/start`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    const second = await fetch(`${apiBase}/api/v1/runtimes/browser/workspaces/runtime-route-quota-two/start`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toMatchObject({ error: { code: "QUOTA_EXCEEDED" } });
    expect(getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "SELECT count(*) AS count FROM security_audit_events WHERE actor_id = ? AND action = 'runtime.workspace.start' AND outcome = 'failure'",
    ).get(scope.user.id)).toEqual({ count: 1 });
  });
});
