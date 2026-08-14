import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { authentication, getDb, identity, organizations, projects, resetDbForTest, runtimes } from "ingenium-core";
import { runtimesRouter } from "../lib/routes/runtimes.js";
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
  return { user, project };
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
  process.env.INGENIUM_RUNTIME_ROOT_DOMAIN = "runtime.example.test";
  process.env.INGENIUM_CORE_DB_PATH = join(directory, `data-${crypto.randomUUID()}`);
  resetDbForTest();
});

afterEach(() => {
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  delete process.env.INGENIUM_RUNTIME_ROOT_DOMAIN;
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

  it("provisions one runtime per authorized workspace", async () => {
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
    expect(duplicate.status).toBe(409);
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
    browserSession = authentication.createSession(scope.user.id);
    const provisioned = await fetch(`${apiBase}/api/v1/runtimes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "runtime-route-browser" }),
    });
    expect(provisioned.status).toBe(202);
    let runtime = runtimes.getRuntimeForWorkspace("runtime-route-browser")!;
    runtime = runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "READY", actorType: "system", actorId: "test" });

    const status = await fetch(`${apiBase}/api/v1/runtimes/browser/status`);
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toEqual({ data: { status: "ready" } });

    const launched = await fetch(`${apiBase}/api/v1/runtimes/browser/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://dashboard.example.test" },
      body: JSON.stringify({ audience: "web", exchangeProof: "p".repeat(43) }),
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
    const replay = await fetch(`${apiBase}/api/v1/runtimes/gateway/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exchangeProof: "p".repeat(43), audience: "web", origin: launchOrigin, host: new URL(launchOrigin).host, launcherOrigin: "https://dashboard.example.test" }),
    });
    expect(replay.status).toBe(401);
  });
});
