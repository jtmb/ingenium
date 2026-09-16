import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  authentication,
  getDb,
  identity,
  mcpCredentials,
  organizations,
  projects,
  resetDbForTest,
  runtimes,
} from "ingenium-core";
import { authorizationMiddleware } from "../lib/authorization-policy.js";
import { authMiddleware } from "../lib/middleware/auth.js";
import { csrfMiddleware } from "../lib/middleware/csrf.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { authPreflightRouter } from "../lib/routes/auth-preflight.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

const installationToken = "i".repeat(32);
const workspaceId = "coordination-lease-workspace";
const worktree = "/srv/coordination-lease/worktree";
const origin = "http://localhost:3000";
const limits = {
  cpuMillis: 1_000,
  memoryBytes: 1_073_741_824,
  pidsLimit: 256,
  diskBytes: 2_147_483_648,
  processLimit: 128,
};

let directory = "";
let server: Server;
let baseUrl = "";
let runtime: runtimes.RuntimeInstance;
let owner: ReturnType<typeof identity.createUser>;
let organizationId = "";
let project: ReturnType<typeof projects.createProject>;
const originalDb = process.env.INGENIUM_CORE_DB_PATH;
const originalToken = process.env.INGENIUM_API_TOKEN;

function installationHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${installationToken}`,
    "content-type": "application/json",
    "x-ingenium-internal-service": "1",
  };
}

function credentialHeaders(token: string, audience: mcpCredentials.McpCredentialAudience): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "x-ingenium-audience": audience,
    "x-ingenium-workspace": workspaceId,
    "x-ingenium-launcher-worktree": worktree,
  };
}

async function issueLease(): Promise<{
  runtimeId: string;
  expiresAt: string;
  coordinationCredential: { id: string; token: string };
  repositorySyncCredential: { id: string; token: string };
}> {
  const response = await fetch(`${baseUrl}/api/v1/auth/coordination-lease`, {
    method: "POST",
    headers: installationHeaders(),
    body: JSON.stringify({ runtimeId: runtime.id }),
  });
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return (await response.json()).data;
}

beforeEach(async () => {
  resetDbForTest();
  directory = mkdtempSync(join(tmpdir(), "ingenium-coordination-lease-api-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  process.env.INGENIUM_API_TOKEN = installationToken;
  owner = identity.createUser("coordination-lease-owner@example.test", "Coordination Lease Owner");
  organizationId = organizations.createOrganization("Coordination Lease", "coordination-lease");
  const timestamp = new Date().toISOString();
  getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "INSERT INTO organization_memberships (organization_id, user_id, role, status, created_at, updated_at) VALUES (?, ?, 'owner', 'active', ?, ?)",
  ).run(organizationId, owner.id, timestamp, timestamp);
  project = projects.createProject("coordination-lease", false, organizationId);
  const workspace = runtimes.authorizeWorkspace({
    id: workspaceId,
    organizationId,
    projectId: project.id,
    ownerUserId: owner.id,
    storagePath: worktree,
  });
  const absoluteExpiresAt = new Date(Date.now() + 10 * 60_000);
  const capability = mcpCredentials.createMcpCredential({
    kind: "runtime",
    audience: "runtime",
    name: "coordination lease runtime",
    scopes: ["child-mcp:runtime", "coordination:read", "coordination:write", "memory:read", "projects:read", "runtime:activity"],
    organizationId,
    projectId: project.id,
    workspaceId,
    launcherWorktree: worktree,
    expiresAt: absoluteExpiresAt,
    createdByUserId: owner.id,
  });
  runtime = runtimes.createRuntimeInstance(workspace.id, limits);
  runtimes.bindRuntimeCapability(runtime.id, capability.id);
  runtime = runtimes.transitionRuntime({
    id: runtime.id,
    expectedRevision: runtime.revision,
    toState: "PROVISIONING",
    actorType: "manager",
    actorId: "test",
    absoluteExpiresAt,
    idleExpiresAt: absoluteExpiresAt,
  });
  runtime = runtimes.transitionRuntime({
    id: runtime.id,
    expectedRevision: runtime.revision,
    toState: "STARTING",
    actorType: "manager",
    actorId: "test",
  });
  runtime = runtimes.transitionRuntime({
    id: runtime.id,
    expectedRevision: runtime.revision,
    toState: "READY",
    actorType: "system",
    actorId: "test",
  });

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use(csrfMiddleware);
  app.use(authorizationMiddleware);
  app.use("/api/v1/auth", authPreflightRouter);
  app.use(errorHandler);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});

afterEach(async () => {
  await closeHttpServer(server);
  resetDbForTest();
  rmSync(directory, { recursive: true, force: true });
  if (originalDb === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDb;
  if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalToken;
});

describe("internal coordination lease credentials", () => {
  it("returns the fixed two-credential contract without persisting plaintext", async () => {
    const before = (getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "SELECT count(*) AS count FROM mcp_credentials",
    ).get() as { count: number }).count;

    const issued = await issueLease();

    expect(Object.keys(issued).sort()).toEqual([
      "coordinationCredential", "expiresAt", "repositorySyncCredential", "runtimeId",
    ]);
    expect(issued.runtimeId).toBe(runtime.id);
    expect(issued.coordinationCredential).toEqual({ id: expect.any(String), token: expect.stringMatching(/^ing_/) });
    expect(issued.repositorySyncCredential).toEqual({ id: expect.any(String), token: expect.stringMatching(/^ing_/) });
    expect(issued.coordinationCredential.id).not.toBe(issued.repositorySyncCredential.id);
    const rows = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "SELECT id, audience, scopes_json, organization_id, project_id, workspace_id, launcher_worktree, token_hash FROM mcp_credentials WHERE id IN (?, ?) ORDER BY audience",
    ).all(issued.coordinationCredential.id, issued.repositorySyncCredential.id) as Array<Record<string, string>>;
    expect(rows).toEqual([
      expect.objectContaining({
        id: issued.coordinationCredential.id,
        audience: "mcp",
        scopes_json: JSON.stringify(["coordination:read", "coordination:write", "memory:read", "memory:write", "projects:read", "repository:sync"]),
        organization_id: organizationId,
        project_id: project.id,
        workspace_id: workspaceId,
        launcher_worktree: worktree,
      }),
      expect.objectContaining({
        id: issued.repositorySyncCredential.id,
        audience: "repository-sync",
        scopes_json: JSON.stringify(["projects:read", "repository:sync"]),
        organization_id: organizationId,
        project_id: project.id,
        workspace_id: workspaceId,
        launcher_worktree: worktree,
      }),
    ]);
    expect((getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "SELECT count(*) AS count FROM mcp_credentials",
    ).get() as { count: number }).count).toBe(before + 2);
    expect(JSON.stringify(rows)).not.toContain(issued.coordinationCredential.token);
    expect(JSON.stringify(rows)).not.toContain(issued.repositorySyncCredential.token);
  });

  it.each([
    { runtimeId: "not-a-runtime" },
    { runtimeId: "33333333-3333-4333-8333-333333333333", ownerId: "arbitrary-owner" },
    { runtimeId: "33333333-3333-4333-8333-333333333333", scopes: ["*"] },
    { runtimeId: "33333333-3333-4333-8333-333333333333", ttlMs: 60_000 },
  ])("rejects malformed or arbitrary issue input", async (body) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/coordination-lease`, {
      method: "POST",
      headers: installationHeaders(),
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("requires only the marker-bound installation bearer and preserves browser management semantics", async () => {
    const missingMarker = await fetch(`${baseUrl}/api/v1/auth/coordination-lease`, {
      method: "POST",
      headers: { authorization: `Bearer ${installationToken}`, "content-type": "application/json" },
      body: JSON.stringify({ runtimeId: runtime.id }),
    });
    expect(missingMarker.status).toBe(401);

    const session = authentication.createSession(owner.id, new Date(), "credential owner", true);
    const browserHeaders = {
      cookie: `${authentication.SESSION_COOKIE_NAME}=${session.token}`,
      origin,
      "content-type": "application/json",
      "x-csrf-token": session.csrfToken,
    };
    const internalRoute = await fetch(`${baseUrl}/api/v1/auth/coordination-lease`, {
      method: "POST",
      headers: browserHeaders,
      body: JSON.stringify({ runtimeId: runtime.id }),
    });
    expect(internalRoute.status).toBe(404);

    const humanIssue = await fetch(`${baseUrl}/api/v1/auth/mcp-credentials`, {
      method: "POST",
      headers: browserHeaders,
      body: JSON.stringify({
        kind: "service",
        audience: "mcp",
        name: "human managed",
        scopes: ["projects:read"],
        organizationId,
        projectId: project.id,
        workspaceId,
        launcherWorktree: worktree,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    });
    expect(humanIssue.status).toBe(201);
    const humanCredential = (await humanIssue.json()).data as { id: string };
    expect((await fetch(`${baseUrl}/api/v1/auth/mcp-credentials/${humanCredential.id}`, {
      method: "DELETE",
      headers: browserHeaders,
    })).status).toBe(204);
  });

  it("allows exact credential self-revocation while hiding foreign IDs and preserving the sibling", async () => {
    const issued = await issueLease();
    const coordinationHeaders = credentialHeaders(issued.coordinationCredential.token, "mcp");
    const repositoryHeaders = credentialHeaders(issued.repositorySyncCredential.token, "repository-sync");
    expect((await fetch(`${baseUrl}/api/v1/auth/preflight`, { headers: coordinationHeaders })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/v1/auth/preflight`, { headers: repositoryHeaders })).status).toBe(200);

    for (const id of [issued.repositorySyncCredential.id, "malformed"]) {
      const response = await fetch(`${baseUrl}/api/v1/auth/mcp-credentials/${id}`, {
        method: "DELETE",
        headers: coordinationHeaders,
      });
      expect(response.status).toBe(404);
      expect((await response.json()).error).toMatchObject({ code: "NOT_FOUND", message: "Resource not found" });
    }

    expect((await fetch(`${baseUrl}/api/v1/auth/mcp-credentials/${issued.coordinationCredential.id}`, {
      method: "DELETE",
      headers: coordinationHeaders,
    })).status).toBe(204);
    expect((await fetch(`${baseUrl}/api/v1/auth/preflight`, { headers: coordinationHeaders })).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/v1/auth/preflight`, { headers: repositoryHeaders })).status).toBe(200);
  });

  it("does not let the installation bearer list, rotate, or revoke arbitrary credential IDs", async () => {
    const issued = await issueLease();
    const headers = installationHeaders();
    expect((await fetch(`${baseUrl}/api/v1/auth/mcp-credentials`, { headers })).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/v1/auth/mcp-credentials/${issued.coordinationCredential.id}/rotate`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    })).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/v1/auth/mcp-credentials/${issued.coordinationCredential.id}`, {
      method: "DELETE",
      headers,
    })).status).toBe(401);
  });
});
