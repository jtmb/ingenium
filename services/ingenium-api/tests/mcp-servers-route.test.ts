import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, projects, resetDbForTest, vault } from "ingenium-core";
import {
  CHILD_MCP_RUNTIME_HANDOFF_HEADER,
  CHILD_MCP_RUNTIME_HANDOFF_PATH,
  childMcpRuntimeRouter,
  mcpServersRouter,
} from "../lib/routes/mcp-servers.js";
import { mcpToolsRouter } from "../lib/routes/mcp-tools.js";

let directory = "";
let server: Server | undefined;
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
const originalHome = process.env.INGENIUM_HOME;

function createVaultReference(projectId: string): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDb().prepare(
    `INSERT INTO vault_items
     (id, project_id, name, type, encrypted, wrapped_kek, created_at, updated_at)
     VALUES (?, ?, ?, 'api_key', ?, ?, ?, ?)`,
  ).run(id, projectId, `mcp-route-${id}`, Buffer.from([0]), Buffer.from([0]), now, now);
  return id;
}

function createVaultSecret(projectId: string, value: string): string {
  const result = vault.initializeVault(projectId, "child-mcp-runtime-passphrase", "child-mcp-runtime-passphrase");
  if (!result.ok) throw new Error("Test vault could not be initialized");
  const itemId = vault.createItem(projectId, "child-mcp-runtime-secret", "api_key", value);
  if (itemId === "Vault is sealed") throw new Error("Test vault unexpectedly sealed");
  return itemId;
}

async function startRouter(): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use(CHILD_MCP_RUNTIME_HANDOFF_PATH, childMcpRuntimeRouter);
  app.use("/mcp-servers", mcpServersRouter);
  app.use("/mcp-tools", mcpToolsRouter);
  server = createServer(app);
  return await new Promise<string>((resolve) => {
    server!.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`));
  });
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  if (directory) vault.sealVault();
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalHome === undefined) delete process.env.INGENIUM_HOME;
  else process.env.INGENIUM_HOME = originalHome;
});

describe("canonical child MCP server API", () => {
  it("stores only executable, arguments, and vault references while redacting invalid payload diagnostics", async () => {
    directory = mkdtempSync(join(tmpdir(), "ingenium-mcp-servers-route-"));
    process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
    process.env.INGENIUM_HOME = join(directory, "home");
    const project = projects.createProject("mcp-route-project");
    const vaultItemId = createVaultReference(project.id);
    const baseUrl = await startRouter();

    const created = await fetch(`${baseUrl}/mcp-servers?project=mcp-route-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "calendar",
        executable: "npx",
        args: ["--yes", "@example/calendar"],
        environment: { CALENDAR_TOKEN: { vault_item_id: vaultItemId } },
      }),
    });
    const createdBody = await created.json();
    expect(created.status).toBe(201);
    expect(createdBody.data).toMatchObject({
      name: "calendar",
      args: ["--yes", "@example/calendar"],
      environment: { CALENDAR_TOKEN: { vault_item_id: vaultItemId } },
    });
    expect(JSON.stringify(createdBody)).not.toContain("plain-text-secret");

    const sealedRuntime = await fetch(`${baseUrl}/mcp-servers/runtime?project=mcp-route-project`);
    expect(sealedRuntime.status).toBe(200);
    const sealedRuntimeBody = await sealedRuntime.json();
    expect(sealedRuntimeBody).toMatchObject({
      data: {
        definitions: [{
          name: "calendar",
          environment: {
            CALENDAR_TOKEN: { vault_item_id: vaultItemId, status: "unavailable" },
          },
        }],
        unavailable: [{ name: "calendar", diagnostic: "unavailable" }],
      },
    });
    expect(JSON.stringify(sealedRuntimeBody)).not.toContain("plain-text-secret");

    const secretCanary = "plain-text-secret";
    const invalid = await fetch(`${baseUrl}/mcp-servers?project=mcp-route-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "bad", executable: "npx --yes", env: { TOKEN: secretCanary } }),
    });
    const invalidBody = await invalid.json();
    expect(invalid.status).toBe(422);
    expect(invalidBody).toEqual({
      error: { code: "INVALID_CHILD_MCP_SERVER", message: "Child MCP server definition is invalid." },
    });
    expect(JSON.stringify(invalidBody)).not.toContain(secretCanary);

    const globalScopeFromExternalProject = await fetch(`${baseUrl}/mcp-servers?project=mcp-route-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "globalcalendar", executable: "npx", scope: "global" }),
    });
    expect(globalScopeFromExternalProject.status).toBe(403);
    await expect(globalScopeFromExternalProject.json()).resolves.toEqual({
      error: {
        code: "GLOBAL_SCOPE_REQUIRED",
        message: "Global child MCP definitions require canonical global ownership.",
      },
    });
  });

  it("keeps unsealed child-MCP plaintext out of public runtime projections and dashboard-mediated handoffs", async () => {
    directory = mkdtempSync(join(tmpdir(), "ingenium-mcp-runtime-secret-route-"));
    process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
    process.env.INGENIUM_HOME = join(directory, "home");
    const project = projects.createProject("mcp-runtime-secret-project");
    const secretCanary = "child-mcp-secret-canary";
    const vaultItemId = createVaultSecret(project.id, secretCanary);
    const baseUrl = await startRouter();

    const created = await fetch(`${baseUrl}/mcp-servers?project=mcp-runtime-secret-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "calendar",
        executable: "npx",
        environment: { CALENDAR_TOKEN: { vault_item_id: vaultItemId } },
      }),
    });
    expect(created.status).toBe(201);

    const publicRuntime = await fetch(`${baseUrl}/mcp-servers/runtime?project=mcp-runtime-secret-project`);
    const publicRuntimeBody = await publicRuntime.json();
    expect(publicRuntime.status).toBe(200);
    expect(publicRuntimeBody).toMatchObject({
      data: {
        definitions: [{
          name: "calendar",
          environment: {
            CALENDAR_TOKEN: { vault_item_id: vaultItemId, status: "resolved" },
          },
        }],
        unavailable: [],
      },
    });
    expect(JSON.stringify(publicRuntimeBody)).not.toContain(secretCanary);

    const dashboardMediated = await fetch(
      `${baseUrl}${CHILD_MCP_RUNTIME_HANDOFF_PATH}?project=mcp-runtime-secret-project`,
      {
        headers: {
          [CHILD_MCP_RUNTIME_HANDOFF_HEADER]: "1",
          "x-ingenium-ui": "dashboard",
        },
      },
    );
    const dashboardMediatedBody = await dashboardMediated.json();
    expect(dashboardMediated.status).toBe(404);
    expect(JSON.stringify(dashboardMediatedBody)).not.toContain(secretCanary);

    const trustedRuntime = await fetch(
      `${baseUrl}${CHILD_MCP_RUNTIME_HANDOFF_PATH}?project=mcp-runtime-secret-project`,
      { headers: { [CHILD_MCP_RUNTIME_HANDOFF_HEADER]: "1" } },
    );
    expect(trustedRuntime.status).toBe(200);
    await expect(trustedRuntime.json()).resolves.toMatchObject({
      data: {
        definitions: [{
          name: "calendar",
          environment: { CALENDAR_TOKEN: secretCanary },
        }],
      },
    });
  });

  it("projects discovered metadata into the scoped catalog and rejects duplicate namespaces deterministically", async () => {
    directory = mkdtempSync(join(tmpdir(), "ingenium-mcp-discovery-route-"));
    process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
    process.env.INGENIUM_HOME = join(directory, "home");
    projects.createProject("mcp-discovery-project");
    const baseUrl = await startRouter();

    const create = await fetch(`${baseUrl}/mcp-servers?project=mcp-discovery-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "calendar", executable: "npx" }),
    });
    expect(create.status).toBe(201);

    const discovered = await fetch(`${baseUrl}/mcp-servers/calendar/discovery?project=mcp-discovery-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "ready",
        tools: [{ name: "list_events", description: "List calendar events", input_schema: { type: "object" } }],
      }),
    });
    expect(discovered.status).toBe(200);

    const visibleTools = await (await fetch(`${baseUrl}/mcp-servers/tools?project=mcp-discovery-project`)).json();
    expect(visibleTools.data).toMatchObject([{ canonical_name: "ingenium_calendar_list_events", category: "Child MCP / calendar" }]);

    const categorized = await (await fetch(`${baseUrl}/mcp-tools?project=mcp-discovery-project&include_categories=true`)).json();
    const childCategory = categorized.data.find((category: { category: string }) => category.category === "Child MCP / calendar");
    expect(childCategory.tools).toContainEqual({ tool_name: "ingenium_calendar_list_events", enabled: true });

    const toggled = await fetch(`${baseUrl}/mcp-tools/ingenium_calendar_list_events?project=mcp-discovery-project`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(toggled.status).toBe(200);
    await expect(toggled.json()).resolves.toMatchObject({ data: { tool_name: "ingenium_calendar_list_events", enabled: false } });

    const unknownCategory = await fetch(`${baseUrl}/mcp-tools/category/Unknown%20Category?project=mcp-discovery-project`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(unknownCategory.status).toBe(404);
    await expect(unknownCategory.json()).resolves.toEqual({
      error: { code: "CATEGORY_NOT_FOUND", message: "Category 'Unknown Category' does not exist in the tool catalog" },
    });

    const duplicatePrefix = await fetch(`${baseUrl}/mcp-servers/calendar/discovery?project=mcp-discovery-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ready", tools: [{ name: "calendar_list", description: "No", input_schema: {} }] }),
    });
    expect(duplicatePrefix.status).toBe(422);
    await expect(duplicatePrefix.json()).resolves.toEqual({
      error: { code: "INVALID_CHILD_MCP_SERVER", message: "Child MCP server definition is invalid." },
    });

    const secretDiagnostic = "token=child-mcp-secret-canary";
    const unsafeDiagnostic = await fetch(`${baseUrl}/mcp-servers/calendar/discovery?project=mcp-discovery-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "failed", diagnostic: secretDiagnostic }),
    });
    const unsafeDiagnosticBody = await unsafeDiagnostic.json();
    expect(unsafeDiagnostic.status).toBe(422);
    expect(unsafeDiagnosticBody).toEqual({
      error: { code: "INVALID_CHILD_MCP_SERVER", message: "Child MCP server definition is invalid." },
    });
    expect(JSON.stringify(unsafeDiagnosticBody)).not.toContain(secretDiagnostic);

    const status = await fetch(`${baseUrl}/mcp-servers/status?project=mcp-discovery-project`);
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      data: [{
        name: "calendar",
        enabled: true,
        discovery_status: "ready",
        discovery_diagnostic: null,
      }],
    });

    const runtime = await fetch(`${baseUrl}/mcp-servers/runtime?project=mcp-discovery-project`);
    expect(runtime.status).toBe(200);
    expect(runtime.headers.get("cache-control")).toBe("no-store");
    await expect(runtime.json()).resolves.toMatchObject({
      data: {
        definitions: [{
          name: "calendar",
          executable: "npx",
          args: [],
          scope: "project",
          owned: true,
          revision: expect.any(String),
          environment: {},
        }],
        unavailable: [],
      },
    });

    const disconnected = await fetch(`${baseUrl}/mcp-servers/calendar/disconnect?project=mcp-discovery-project`, {
      method: "POST",
    });
    expect(disconnected.status).toBe(200);
    await expect(disconnected.json()).resolves.toMatchObject({
      data: { restartRequired: false, server: { name: "calendar", enabled: false } },
    });
    const disabledRefresh = await fetch(`${baseUrl}/mcp-servers/calendar/refresh?project=mcp-discovery-project`, {
      method: "POST",
    });
    expect(disabledRefresh.status).toBe(409);
    await expect(disabledRefresh.json()).resolves.toEqual({
      error: {
        code: "MCP_SERVER_DISABLED",
        message: "Enable the child MCP server before requesting discovery refresh.",
      },
    });

    const connected = await fetch(`${baseUrl}/mcp-servers/calendar/connect?project=mcp-discovery-project`, {
      method: "POST",
    });
    expect(connected.status).toBe(200);
    await expect(connected.json()).resolves.toMatchObject({
      data: { restartRequired: false, server: { name: "calendar", enabled: true, discovery_status: "pending" } },
    });
    const refreshed = await fetch(`${baseUrl}/mcp-servers/calendar/refresh?project=mcp-discovery-project`, {
      method: "POST",
    });
    expect(refreshed.status).toBe(200);
    await expect(refreshed.json()).resolves.toMatchObject({
      data: { restartRequired: false, server: { name: "calendar", enabled: true, discovery_status: "pending" } },
    });

    const missingProject = await fetch(`${baseUrl}/mcp-servers/calendar/connect`, { method: "POST" });
    expect(missingProject.status).toBe(400);
    projects.createProject("mcp-unrelated-project");
    const foreignProject = await fetch(`${baseUrl}/mcp-servers/calendar/disconnect?project=mcp-unrelated-project`, {
      method: "POST",
    });
    expect(foreignProject.status).toBe(404);

    const missing = await fetch(`${baseUrl}/mcp-servers/missing/discovery?project=mcp-discovery-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "failed", diagnostic: "timeout" }),
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      error: { code: "MCP_SERVER_NOT_FOUND", message: "Child MCP server is not registered." },
    });
  });

  it("publishes the canonical Thread bridge upload discovery and rejects the retired thread namespace", async () => {
    directory = mkdtempSync(join(tmpdir(), "ingenium-threadbridge-route-"));
    process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
    process.env.INGENIUM_HOME = join(directory, "home");
    projects.createProject("threadbridge-project");
    const baseUrl = await startRouter();

    const created = await fetch(`${baseUrl}/mcp-servers?project=threadbridge-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "threadbridge", executable: "node" }),
    });
    expect(created.status).toBe(201);

    const discovered = await fetch(`${baseUrl}/mcp-servers/threadbridge/discovery?project=threadbridge-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "ready",
        tools: [{
          name: "thread_upload_file",
          description: "Upload one generated JSONL file to Thread.",
          input_schema: {
            type: "object",
            required: ["session", "file_path"],
            properties: { session: { type: "string" }, file_path: { type: "string" } },
          },
        }],
      }),
    });
    expect(discovered.status).toBe(200);
    const visible = await (await fetch(`${baseUrl}/mcp-servers/tools?project=threadbridge-project`)).json();
    expect(visible.data).toContainEqual(expect.objectContaining({
      canonical_name: "ingenium_threadbridge_thread_upload_file",
      category: "Child MCP / threadbridge",
    }));

    const retired = await fetch(`${baseUrl}/mcp-servers?project=threadbridge-project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "thread", executable: "node" }),
    });
    expect(retired.status).toBe(422);
    await expect(retired.json()).resolves.toEqual({
      error: { code: "INVALID_CHILD_MCP_SERVER", message: "Child MCP server definition is invalid." },
    });
  });

  it("keeps built-in and category tool state isolated per project", async () => {
    directory = mkdtempSync(join(tmpdir(), "ingenium-mcp-tool-state-isolation-"));
    process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
    process.env.INGENIUM_HOME = join(directory, "home");
    projects.createProject("mcp-tool-state-a");
    projects.createProject("mcp-tool-state-b");
    const baseUrl = await startRouter();
    const tool = "ingenium_skill_list";

    const disabled = await fetch(`${baseUrl}/mcp-tools/${tool}?project=mcp-tool-state-a`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(disabled.status).toBe(200);

    const stateA = await (await fetch(`${baseUrl}/mcp-tools/${tool}/state?project=mcp-tool-state-a`)).json();
    const stateB = await (await fetch(`${baseUrl}/mcp-tools/${tool}/state?project=mcp-tool-state-b`)).json();
    expect(stateA.data).toMatchObject({ tool_name: tool, enabled: false });
    expect(stateB.data).toMatchObject({ tool_name: tool, enabled: true });

    const categoryDisabled = await fetch(`${baseUrl}/mcp-tools/category/Skills?project=mcp-tool-state-a`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(categoryDisabled.status).toBe(200);
    const categoryA = await (await fetch(`${baseUrl}/mcp-tools?project=mcp-tool-state-a&include_categories=true`)).json();
    const categoryB = await (await fetch(`${baseUrl}/mcp-tools?project=mcp-tool-state-b&include_categories=true`)).json();
    expect(categoryA.data.find((group: { category: string }) => group.category === "Skills")).toMatchObject({ enabled_count: 0 });
    const skillsB = categoryB.data.find((group: { category: string }) => group.category === "Skills");
    expect(skillsB).toMatchObject({ enabled_count: expect.any(Number) });
    expect(skillsB.enabled_count).toBeGreaterThan(0);
  });
});
