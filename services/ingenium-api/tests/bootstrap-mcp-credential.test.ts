import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { authentication, authorization, bootstrap, getDb, logger, mcpCredentials, projects, resetDbForTest, runtimes } from "ingenium-core";
import { authMiddleware } from "../lib/middleware/auth.js";
import { authorizationMiddleware } from "../lib/authorization-policy.js";
import { clearAuthAttemptRateLimit } from "../lib/middleware/auth-rate-limit.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { authPreflightRouter } from "../lib/routes/auth-preflight.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";
import { LOCAL_RUNTIME_SCOPES } from "../lib/runtime-provisioner.js";
import { CHILD_MCP_RUNTIME_HANDOFF_PATH, childMcpRuntimeRouter, mcpServersRouter } from "../lib/routes/mcp-servers.js";
import { authorizedCatalog } from "../lib/routes/mcp-tools.js";

const installationToken = "b".repeat(64);
const scopes = ["coordination:read", "coordination:write", "projects:read", "repository:sync", "documentation:read", "rag:read", "memory:read", "memory:write"].sort();
let directory: string;
let server: Server;
let baseUrl: string;
let ownerId: string;

function issue(body: unknown = {}, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/v1/auth/bootstrap-mcp-credential`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", authorization: `Bearer ${installationToken}`, "x-ingenium-internal-service": "1", ...headers },
  });
}

beforeEach(async () => {
  resetDbForTest();
  clearAuthAttemptRateLimit();
  directory = mkdtempSync(join(tmpdir(), "ingenium-bootstrap-mcp-test-"));
  vi.stubEnv("INGENIUM_CORE_DB_PATH", join(directory, "data"));
  vi.stubEnv("INGENIUM_API_TOKEN", installationToken);
  vi.stubEnv("INGENIUM_API_TOKEN_FILE", "");
  const keyPath = join(directory, "key");
  writeFileSync(keyPath, Buffer.alloc(32, 7).toString("base64url"), { mode: 0o600 });
  vi.stubEnv("INGENIUM_AUTH_ENCRYPTION_KEY_FILE", keyPath);
  const owner = await bootstrap.claimBootstrap({ email: "bootstrap@example.test", displayName: "Owner", password: "correct horse battery staple" });
  ownerId = owner.userId;
  projects.createProject("ingenium", false, owner.organizationId);
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use(authorizationMiddleware);
  app.use("/api/v1/auth", authPreflightRouter);
  app.use(CHILD_MCP_RUNTIME_HANDOFF_PATH, childMcpRuntimeRouter);
  app.use("/api/v1/mcp-servers", mcpServersRouter);
  app.use(errorHandler);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});

afterEach(async () => {
  if (server) await closeHttpServer(server);
  resetDbForTest();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("compatibility MCP bootstrap", () => {
  it("recovers an existing failed local runtime without weakening capability binding", async () => {
    expect((await issue()).status).toBe(201);
    const runtime = runtimes.createRuntimeInstance("shared-memory-ingenium", {
      cpuMillis: 1000, memoryBytes: 1_073_741_824, pidsLimit: 256, diskBytes: 2_147_483_648, processLimit: 128,
    });
    const starting = runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision,
      toState: "PROVISIONING", actorType: "system", actorId: "test" });
    runtimes.transitionRuntime({ id: runtime.id, expectedRevision: starting.revision,
      toState: "FAILED", actorType: "system", actorId: "test" });
    const response = await fetch(`${baseUrl}/api/v1/auth/bootstrap-local-runtime`, {
      method: "POST", headers: { authorization: `Bearer ${installationToken}`, "x-ingenium-internal-service": "1", "content-type": "application/json" }, body: "{}",
    });
    expect(response.status).toBe(201);
    const { data } = await response.json();
    expect(data.runtime).toMatchObject({ id: runtime.id, state: "READY", backendContainerId: null });
    expect(mcpCredentials.resolveMcpCredential(data.credential.token, "runtime")?.id).toBe(data.credential.id);
  });

  it("provisions one READY local runtime and replays its bound capability without revocation", async () => {
    expect((await issue()).status).toBe(201);
    const local = () => fetch(`${baseUrl}/api/v1/auth/bootstrap-local-runtime`, {
      method: "POST", headers: { authorization: `Bearer ${installationToken}`, "x-ingenium-internal-service": "1", "content-type": "application/json" }, body: "{}",
    });
    const first = await local();
    expect(first.status).toBe(201);
    const { data } = await first.json();
    expect(data.runtime).toMatchObject({ state: "READY", backendContainerId: null, workspaceId: "shared-memory-ingenium" });
    expect(data.credential).toMatchObject({ kind: "runtime", audience: "runtime", scopes: LOCAL_RUNTIME_SCOPES,
      launcherWorktree: "/home/brajam/repos/ingenium" });
    expect(data.credential.scopes).toEqual([
      "child-mcp:execute", "child-mcp:runtime", "coordination:write", "documentation:read",
      "mcp-servers:write", "memory:write", "projects:read", "rag:read",
    ]);
    const catalog = authorizedCatalog({
      authorizationPolicy: {},
      principal: { ...data.credential, type: "service", id: data.credential.servicePrincipalId },
    } as Parameters<typeof authorizedCatalog>[0], data.credential.projectId);
    for (const name of ["coordination_status", "coordination_memory_read", "coordination_update", "coordination_claim",
      "coordination_release", "memory_read", "memory_list", "memory_search", "memory_save", "memory_update",
      "memory_forget", "memory_operation_status", "project_detail", "docs_search", "docs_get_page", "docs_search_semantic",
      "docs_rag_sources_list"]) expect(catalog.has(`ingenium_${name}`), name).toBe(true);
    for (const name of ["repository_sync", "docs_create_page", "docs_ingest"])
      expect(catalog.has(`ingenium_${name}`), name).toBe(false);
    expect(data.runtimeWorktree).toBe("/workspace");
    expect(mcpCredentials.resolveMcpCredential(data.credential.token, "runtime")?.id).toBe(data.credential.id);
    resetDbForTest();
    const replay = await local();
    expect(replay.status).toBe(201);
    const repeated = (await replay.json()).data;
    expect(repeated.runtime).toEqual(data.runtime);
    expect(repeated.credential.token).toBe(data.credential.token);
    expect(mcpCredentials.listMcpCredentials(ownerId)).toHaveLength(2);
    expect(getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("SELECT count(*) AS count FROM runtime_capability_bindings").get()).toEqual({ count: 1 });
    const headers = { authorization: `Bearer ${data.credential.token}`, "x-ingenium-audience": "runtime",
      "x-ingenium-workspace": data.credential.workspaceId, "x-ingenium-launcher-worktree": data.runtimeWorktree,
      "content-type": "application/json", "x-ingenium-child-mcp-runtime": "1" };
    expect((await fetch(`${baseUrl}${CHILD_MCP_RUNTIME_HANDOFF_PATH}?project=ingenium`, {
      headers: { ...headers, "x-ingenium-launcher-worktree": data.credential.launcherWorktree },
    })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/v1/mcp-servers/presets/playwright?project=ingenium`, {
      method: "POST", headers, body: "{}",
    })).status).toBe(201);
    expect((await fetch(`${baseUrl}${CHILD_MCP_RUNTIME_HANDOFF_PATH}?project=ingenium`, { headers })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/v1/mcp-servers/playwright/discovery?project=ingenium`, {
      method: "POST", headers, body: JSON.stringify({ status: "ready", tools: [{ name: "browser_snapshot", description: "Capture an accessibility snapshot of the current page", input_schema: { type: "object" } }] }),
    })).status).toBe(200);
    expect(authorization.requireProjectPermission({ type: "service-principal", id: data.credential.servicePrincipalId,
      projectId: data.credential.projectId, organizationId: data.credential.organizationId, scopes: data.credential.scopes,
    }, data.credential.projectId, "child-mcp", "execute").allowed).toBe(true);
  });

  it("rejects browser callers, overrides and configured runtime managers for local issuance", async () => {
    await issue();
    const local = (headers: Record<string, string> = {}, body = "{}") => fetch(`${baseUrl}/api/v1/auth/bootstrap-local-runtime`, {
      method: "POST", headers: { authorization: `Bearer ${installationToken}`, "x-ingenium-internal-service": "1", "content-type": "application/json", ...headers }, body,
    });
    expect((await local({ origin: "http://localhost:3000" })).status).toBe(403);
    expect((await local({ cookie: "session=browser" })).status).toBe(403);
    expect((await local({}, '{"workspaceId":"other"}')).status).toBe(422);
    vi.stubEnv("INGENIUM_RUNTIME_MANAGER_URL", "http://runtime-manager:4100");
    const diagnostic = vi.spyOn(logger, "warn");
    expect((await local()).status).toBe(503);
    expect(diagnostic).toHaveBeenCalledWith("local-runtime-bootstrap", "LOCAL_RUNTIME_BOOTSTRAP_UNAVAILABLE", {
      stage: "mode", code: "SCOPE_UNAVAILABLE",
    });
    expect(mcpCredentials.listMcpCredentials(ownerId)).toHaveLength(1);
  });

  it("issues only the canonical scope and replays the same encrypted receipt after reopening the database", async () => {
    const response = await issue();
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { data } = await response.json();
    expect(data).toMatchObject({ name: "Compatibility OpenCode", kind: "service", audience: "mcp", projectName: "ingenium", workspaceId: "shared-memory-ingenium", launcherWorktree: "/home/brajam/repos/ingenium", scopes });
    expect(Date.parse(data.expiresAt) - Date.now()).toBeGreaterThan(29.99 * 86_400_000);
    expect(Date.parse(data.expiresAt) - Date.parse(data.createdAt)).toBeLessThanOrEqual(30 * 86_400_000);
    const receipt = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("SELECT * FROM mcp_credential_receipts").get();
    expect(JSON.stringify(receipt)).not.toContain(data.token);
    resetDbForTest();
    const replay = await issue();
    expect(replay.status).toBe(201);
    expect((await replay.json()).data).toEqual(data);
    expect(mcpCredentials.listMcpCredentials(ownerId)).toHaveLength(1);
    expect(mcpCredentials.resolveMcpCredential(data.token, "mcp")?.id).toBe(data.id);
  });

  it("rejects browser users and scoped service credentials with 403", async () => {
    const { data } = await (await issue()).json();
    const service = await issue({}, { authorization: `Bearer ${data.token}`, "x-ingenium-internal-service": "", "x-ingenium-audience": "mcp", "x-ingenium-workspace": data.workspaceId, "x-ingenium-launcher-worktree": data.launcherWorktree });
    expect(service.status).toBe(403);
    const session = authentication.createSession(ownerId);
    const browser = await issue({}, { cookie: `${authentication.SESSION_COOKIE_NAME}=${session.token}` });
    expect(browser.status).toBe(403);
  });

  it("rejects overrides without reflecting supplied secrets or logging tokens", async () => {
    const logs = [vi.spyOn(logger, "error"), vi.spyOn(logger, "info"), vi.spyOn(logger, "warn")];
    const marker = "private-request-marker";
    const response = await issue({ scopes: ["*"], token: marker });
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain(marker);
    const { data } = await (await issue()).json();
    const emitted = JSON.stringify(logs.flatMap((spy) => spy.mock.calls));
    expect(emitted).not.toContain(data.token);
    expect(emitted).not.toContain(installationToken);
    expect(emitted).not.toContain(marker);
  });

  it("fails closed with a safe error when a receipt credential is revoked", async () => {
    const { data } = await (await issue()).json();
    mcpCredentials.revokeMcpCredential(data.id, ownerId);
    const response = await issue();
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain("MCP_BOOTSTRAP_UNAVAILABLE");
    expect(text).not.toContain(data.token);
    expect(mcpCredentials.listMcpCredentials(ownerId)).toHaveLength(1);
  });

  it("rate limits bootstrap issuance without creating extra credentials", async () => {
    for (let index = 0; index < 5; index++) expect((await issue()).status).toBe(201);
    const response = await issue();
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(mcpCredentials.listMcpCredentials(ownerId)).toHaveLength(1);
  });
});
