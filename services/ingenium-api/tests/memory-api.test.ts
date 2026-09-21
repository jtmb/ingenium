import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  getDb,
  identity,
  mcpCredentials,
  organizations,
  projects,
  resetDbForTest,
  runtimes,
} from "ingenium-core";
import { authorizationMiddleware, policyForRequest } from "../lib/authorization-policy.js";
import type { AttestedCoordinationIdentity, RequestPrincipal } from "../lib/middleware/auth.js";
import { memoryRouter } from "../lib/routes/memory.js";
import { mcpToolsRouter } from "../lib/routes/mcp-tools.js";
import * as memoryTools from "../../ingenium-server/lib/tools/memory.js";
import { ExplicitMemoryContextReader } from "../../../packages/ingenium-extension/explicit-memory.js";

vi.mock("../../ingenium-server/config/index.js", () => ({
  config: { get apiUrl() { return `${baseUrl}/api/v1`; }, apiTimeout: 5_000 },
  apiRequestHeaders: (headers: Record<string, string>) => ({ ...headers, "x-test-principal": "service" }),
}));

const directory = mkdtempSync(join(tmpdir(), "ingenium-memory-api-"));
const databasePath = join(directory, "data.db");
const projectName = "memory-api";
const secondProjectName = "memory-api-second";
let server: Server;
let baseUrl = "";
let ownerId = "";
let otherId = "";
let servicePrincipal: Extract<RequestPrincipal, { type: "service" }>;
let forgedServicePrincipal: Extract<RequestPrincipal, { type: "service" }>;
let serviceAttestation: Readonly<AttestedCoordinationIdentity>;
let forgedAttestation: Readonly<AttestedCoordinationIdentity>;

function url(path: string, project = projectName): string {
  return `${baseUrl}/api/v1/memory${path}${path.includes("?") ? "&" : "?"}project=${project}`;
}

async function json(response: Response): Promise<any> {
  return response.json();
}

beforeAll(async () => {
  process.env.INGENIUM_CORE_DB_PATH = databasePath;
  process.env.INGENIUM_HOME = directory;
  resetDbForTest();
  const project = projects.createProject(projectName);
  getDb(databasePath).exec(readFileSync(new URL("../../../packages/ingenium-core/data/migrations/115_explicit_memory_fts_update_order.sql", import.meta.url), "utf8"));
  projects.createProject(secondProjectName);
  const owner = identity.createUser("memory-api-owner@example.test", "Memory API Owner");
  const other = identity.createUser("memory-api-other@example.test", "Memory API Other");
  ownerId = owner.id;
  otherId = other.id;
  organizations.addOrganizationMember(project.organization_id, owner.id, "admin");
  organizations.addOrganizationMember(project.organization_id, other.id, "admin");
  runtimes.authorizeWorkspace({
    id: "owner-workspace",
    organizationId: project.organization_id,
    projectId: project.id,
    ownerUserId: owner.id,
    storagePath: join(directory, "owner-workspace"),
  });
  runtimes.authorizeWorkspace({
    id: "other-workspace",
    organizationId: project.organization_id,
    projectId: project.id,
    ownerUserId: other.id,
    storagePath: join(directory, "other-workspace"),
  });
  const credential = mcpCredentials.createMcpCredential({
    kind: "service",
    audience: "mcp",
    name: "memory API delegation",
    scopes: ["memory:read", "memory:write", "projects:read"],
    organizationId: project.organization_id,
    projectId: project.id,
    workspaceId: "owner-workspace",
    launcherWorktree: join(directory, "owner-workspace"),
    expiresAt: new Date(Date.now() + 3_600_000),
    createdByUserId: owner.id,
  });
  servicePrincipal = {
    type: "service",
    id: credential.servicePrincipalId,
    scopes: credential.scopes,
    tokenId: credential.id,
    organizationId: credential.organizationId,
    projectId: credential.projectId,
    projectIds: credential.projectIds,
    audience: credential.audience,
    workspaceId: credential.workspaceId,
    launcherWorktree: credential.launcherWorktree,
    storageMappingHash: credential.storageMappingHash,
  };
  serviceAttestation = {
    credentialId: credential.id,
    workspaceId: credential.workspaceId,
    storageMappingHash: credential.storageMappingHash,
  };
  forgedServicePrincipal = { ...servicePrincipal, storageMappingHash: "f".repeat(64) };
  forgedAttestation = { ...serviceAttestation, storageMappingHash: "f".repeat(64) };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const principal = req.get("x-test-principal");
    if (principal === "owner") {
      req.principal = { type: "user", id: ownerId, scopes: ["user:*"], session: { id: "owner-session" } as never };
    } else if (principal === "other") {
      req.principal = { type: "user", id: otherId, scopes: ["user:*"], session: { id: "other-session" } as never };
    } else if (principal === "service") {
      req.principal = servicePrincipal;
      req.attestedCoordinationIdentity = serviceAttestation;
    } else if (principal === "forged-service") {
      req.principal = forgedServicePrincipal;
      req.attestedCoordinationIdentity = forgedAttestation;
    }
    next();
  });
  app.use(authorizationMiddleware);
  app.use("/api/v1/memory", memoryRouter);
  app.use("/api/v1/mcp-tools", mcpToolsRouter);
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.statusCode ?? 500).json({ error: { code: error.code ?? "INTERNAL_ERROR", message: error.message } });
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  delete process.env.INGENIUM_HOME;
  rmSync(directory, { recursive: true, force: true });
});

describe("explicit saved memory API", () => {
  it("authorizes the browser memory gate while retaining owner and project isolation", async () => {
    const headers = { "x-test-principal": "owner" };
    const catalog = await fetch(`${baseUrl}/api/v1/mcp-tools?project=${projectName}&include_categories=true`, { headers });
    expect(catalog.status).toBe(200);
    const tools = (await catalog.json()).data.flatMap((category: any) => category.tools)
      .filter((tool: any) => tool.enabled).map((tool: any) => tool.tool_name);
    expect(tools).toEqual(expect.arrayContaining(["ingenium_memory_list", "ingenium_memory_save", "ingenium_memory_operation_status"]));
    const probe = "?workspaceId=owner-workspace&visibility=private&limit=1&tokenBudget=1";
    expect((await fetch(url(probe), { headers })).status).toBe(200);
    expect((await fetch(url(probe))).status).toBe(401);
    expect((await fetch(url(probe), { headers: { "x-test-principal": "other" } })).status).toBe(404);
    expect((await fetch(url(probe, secondProjectName), { headers })).status).toBe(404);
  });

  it("round-trips a remember directive through MCP, HTTP, SQLite and fresh session readers", async () => {
    const workspaceId = "owner-workspace";
    const content = "  Prefer TypeScript examples.\nKeep answers concise.  ";
    const decode = (result: { content: [{ text: string }] }) => JSON.parse(result.content[0].text);
    const saved = decode(await memoryTools.memorySave(projectName, workspaceId, "mcp-save", content));
    expect(saved.receipt.status).toBe("committed");
    expect(saved.memory).toMatchObject({ content, tags: ["preference"], source: "user-directive" });
    const memoryId = saved.memory.id;
    expect(decode(await memoryTools.memoryRead(projectName, workspaceId, memoryId)).memory.content).toBe(content);
    expect(decode(await memoryTools.memoryList(projectName, workspaceId)).items.map((item: any) => item.memory.id)).toContain(memoryId);
    expect(decode(await memoryTools.memorySearch(projectName, workspaceId, "TypeScript")).items[0].memory.content).toBe(content);
    const binding = { project: projectName, projectId: saved.memory.projectId, workspaceId };
    const invoke = async () => decode(await memoryTools.memoryList(projectName, workspaceId));
    expect(await new ExplicitMemoryContextReader(binding, invoke).read()).toContain(JSON.stringify(content));
    resetDbForTest();
    expect(await new ExplicitMemoryContextReader(binding, invoke).read()).toContain(JSON.stringify(content));
    await expect(memoryTools.memoryRead(secondProjectName, workspaceId, memoryId)).rejects.toMatchObject({ status: 404 });

    const secret = `sk-${"synthetic".repeat(4)}`;
    await expect(memoryTools.memorySave(projectName, workspaceId, "mcp-secret", secret)).rejects.toMatchObject({ status: 422 });
    await expect(memoryTools.memoryUpdate(projectName, workspaceId, memoryId, "mcp-secret-update", 1, secret)).rejects.toMatchObject({ status: 422 });
    expect(decode(await memoryTools.memoryOperationStatus(projectName, workspaceId, "mcp-secret")).status).toBe("unknown");
    const updatedContent = "\nPrefer Python examples.  ";
    const updated = decode(await memoryTools.memoryUpdate(projectName, workspaceId, memoryId, "mcp-update", 1, updatedContent));
    expect(updated.memory).toMatchObject({ content: updatedContent, version: 2, tags: ["preference"], source: "user-directive" });
    expect(decode(await memoryTools.memoryRead(projectName, workspaceId, memoryId)).memory.content).toBe(updatedContent);
    expect(decode(await memoryTools.memorySearch(projectName, workspaceId, "TypeScript")).items).toEqual([]);
    expect(decode(await memoryTools.memorySearch(projectName, workspaceId, "Prefer Python")).items[0].memory.content).toBe(updatedContent);
    const forgotten = decode(await memoryTools.memoryForget(projectName, workspaceId, memoryId, "mcp-forget", 2));
    expect(forgotten.receipt).toMatchObject({ status: "committed", operation: "forget" });
    expect(decode(await memoryTools.memoryList(projectName, workspaceId)).items).toEqual([]);
    expect(decode(await memoryTools.memorySearch(projectName, workspaceId, "Python")).items).toEqual([]);
    await expect(new ExplicitMemoryContextReader(binding, invoke).read()).resolves.toBeUndefined();
  });

  it("registers private policy and rejects user-controlled ownership", async () => {
    const source = readFileSync(new URL("../scripts/api-server.ts", import.meta.url), "utf8");
    expect(source).toContain('import { memoryRouter } from "../lib/routes/memory.js";');
    expect(source).toContain('app.use("/api/v1/memory", memoryRouter);');
    expect(policyForRequest({ method: "POST", path: "/api/v1/memory" } as any))
      .toMatchObject({ target: "private", resource: "memory", permission: "write" });
    expect(policyForRequest({ method: "GET", path: "/api/v1/memory/search" } as any))
      .toMatchObject({ target: "private", resource: "memory", permission: "read" });
    expect(policyForRequest({ method: "DELETE", path: "/api/v1/memory/one" } as any))
      .toMatchObject({ target: "private", resource: "memory", permission: "write" });

    const spoofed = await fetch(url("/"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-principal": "owner" },
      body: JSON.stringify({
        operationId: "spoofed-owner",
        workspaceId: "owner-workspace",
        ownerUserId: otherId,
        content: "This binding must be rejected.",
      }),
    });
    expect(spoofed.status).toBe(422);
  });

  it("supports receipts, delegated private access, conflicts, explicit project sharing, and forget suppression", async () => {
    const memoryId = "22222222-2222-4222-8222-222222222222";
    const payload = {
      operationId: "api-save-one",
      memoryId,
      workspaceId: "owner-workspace",
      content: "The synthetic amber compass points north.",
      tags: ["synthetic"],
    };
    const saved = await fetch(url("/"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-principal": "owner" },
      body: JSON.stringify(payload),
    });
    expect(saved.status).toBe(201);
    expect(saved.headers.get("location")).toContain(`/api/v1/memory/${memoryId}?`);
    const savedBody = await json(saved);
    expect(savedBody.data).toMatchObject({
      idempotent: false,
      memory: { id: memoryId, ownerUserId: ownerId, workspaceId: "owner-workspace", version: 1 },
      receipt: { operationId: "api-save-one", status: "committed", version: 1 },
    });

    const replay = await fetch(url("/"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-principal": "owner" },
      body: JSON.stringify(payload),
    });
    expect(replay.status).toBe(200);
    expect((await json(replay)).data).toMatchObject({
      idempotent: true,
      receipt: { receiptId: savedBody.data.receipt.receiptId },
    });
    const changedReplay = await fetch(url("/"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-principal": "owner" },
      body: JSON.stringify({ ...payload, content: "changed-secret-payload" }),
    });
    expect(changedReplay.status).toBe(409);
    expect(JSON.stringify(await json(changedReplay))).not.toContain("changed-secret-payload");

    const denied = await fetch(url(`/${memoryId}?workspaceId=other-workspace`), {
      headers: { "x-test-principal": "other" },
    });
    expect(denied.status).toBe(404);
    expect(JSON.stringify(await json(denied))).not.toContain("amber compass");
    const delegated = await fetch(url(`/${memoryId}?workspaceId=owner-workspace`), {
      headers: { "x-test-principal": "service" },
    });
    expect(delegated.status).toBe(200);
    expect((await json(delegated)).data).toMatchObject({
      memory: { id: memoryId, ownerUserId: ownerId },
      contentKind: "untrusted_memory_data",
      instructionAuthority: false,
    });
    const forged = await fetch(url(`/${memoryId}?workspaceId=owner-workspace`), {
      headers: { "x-test-principal": "forged-service" },
    });
    expect(forged.status).toBe(404);

    const updated = await fetch(url(`/${memoryId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-test-principal": "owner" },
      body: JSON.stringify({
        operationId: "api-update-one",
        workspaceId: "owner-workspace",
        expectedVersion: 1,
        content: "The synthetic amber compass points east.",
      }),
    });
    expect(updated.status).toBe(200);
    expect((await json(updated)).data).toMatchObject({ memory: { version: 2 }, receipt: { version: 2 } });
    const stale = await fetch(url(`/${memoryId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-test-principal": "owner" },
      body: JSON.stringify({
        operationId: "api-update-stale",
        workspaceId: "owner-workspace",
        expectedVersion: 1,
        content: "Stale overwrite is blocked.",
      }),
    });
    expect(stale.status).toBe(409);
    expect((await json(stale)).error).toMatchObject({ code: "VERSION_CONFLICT", currentVersion: 2 });

    const sharedId = "33333333-3333-4333-8333-333333333333";
    const shared = await fetch(url("/"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-principal": "owner" },
      body: JSON.stringify({
        operationId: "api-save-shared",
        memoryId: sharedId,
        workspaceId: "owner-workspace",
        visibility: "project",
        content: "Project-visible synthetic fact.",
      }),
    });
    expect(shared.status).toBe(201);
    const privateDefault = await fetch(url(`/${sharedId}?workspaceId=other-workspace`), {
      headers: { "x-test-principal": "other" },
    });
    expect(privateDefault.status).toBe(404);
    const explicitSharedRead = await fetch(url(`/${sharedId}?workspaceId=other-workspace&visibility=project`), {
      headers: { "x-test-principal": "other" },
    });
    expect(explicitSharedRead.status).toBe(200);
    const serviceSharedRead = await fetch(url(`/${sharedId}?workspaceId=owner-workspace&visibility=project`), {
      headers: { "x-test-principal": "service" },
    });
    expect(serviceSharedRead.status).toBe(404);
    const serviceSharedUpdate = await fetch(url(`/${sharedId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-test-principal": "service" },
      body: JSON.stringify({
        operationId: "api-update-shared-denied",
        workspaceId: "owner-workspace",
        expectedVersion: 1,
        visibility: "project",
        content: "A service without share scope cannot change this.",
      }),
    });
    expect(serviceSharedUpdate.status).toBe(404);
    const ownerSharedUpdate = await fetch(url(`/${sharedId}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-test-principal": "owner" },
      body: JSON.stringify({
        operationId: "api-update-shared",
        workspaceId: "owner-workspace",
        expectedVersion: 1,
        visibility: "project",
        content: "Project-visible synthetic fact, revised.",
      }),
    });
    expect(ownerSharedUpdate.status).toBe(200);

    const forgotten = await fetch(url(`/${memoryId}`), {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-test-principal": "service" },
      body: JSON.stringify({ operationId: "api-forget-one", workspaceId: "owner-workspace", expectedVersion: 2 }),
    });
    expect(forgotten.status).toBe(200);
    expect((await json(forgotten)).data).toMatchObject({
      memory: null,
      receipt: { operation: "forget", status: "committed", version: 3 },
    });
    const suppressed = await fetch(url(`/${memoryId}?workspaceId=owner-workspace`), {
      headers: { "x-test-principal": "owner" },
    });
    expect(suppressed.status).toBe(404);
    expect(JSON.stringify(await json(suppressed))).not.toContain("amber compass");
    const search = await fetch(url(`/search?workspaceId=owner-workspace&q=amber%20compass`), {
      headers: { "x-test-principal": "owner" },
    });
    expect((await json(search)).data.items).toEqual([]);

    const known = await fetch(url("/operations/api-forget-one?workspaceId=owner-workspace"), {
      headers: { "x-test-principal": "owner" },
    });
    expect((await json(known)).data).toMatchObject({ status: "committed", receipt: { operationId: "api-forget-one" } });
    const unknown = await fetch(url("/operations/api-unknown?workspaceId=owner-workspace"), {
      headers: { "x-test-principal": "owner" },
    });
    expect(await json(unknown)).toMatchObject({ data: { status: "unknown", operationId: "api-unknown" } });

    const wrongProject = await fetch(url(`/${sharedId}?workspaceId=owner-workspace&visibility=project`, secondProjectName), {
      headers: { "x-test-principal": "owner" },
    });
    expect(wrongProject.status).toBe(404);

    getDb(process.env.INGENIUM_CORE_DB_PATH).exec("DROP TABLE explicit_memories_fts");
    const unavailable = await fetch(url("/search?workspaceId=owner-workspace&q=synthetic"), {
      headers: { "x-test-principal": "owner" },
    });
    expect(unavailable.status).toBe(500);
    expect(await json(unavailable)).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Unable to process saved memory" },
    });
  });
});
