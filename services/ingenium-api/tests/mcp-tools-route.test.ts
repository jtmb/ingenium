import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap, mcpToolStates, projects, resetDbForTest } from "ingenium-core";
import { createFixtureMcpUsefulnessCollector } from "../lib/mcp-usefulness-collector.js";
import { authorizedCatalog, createMcpToolsRouter, mcpToolsRouter } from "../lib/routes/mcp-tools.js";

let directory = "";
let server: Server | undefined;
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;

async function startRouter(
  principal?: Express.Request["principal"],
  router = mcpToolsRouter,
): Promise<string> {
  const app = express();
  app.use(express.json());
  if (principal) {
    app.use((req, _res, next) => {
      req.principal = principal;
      req.authorizationPolicy = { action: "projects.read", resource: "projects", permission: "read", target: "project" };
      next();
    });
  }
  app.use("/mcp-tools", router);
  server = createServer(app);
  return await new Promise<string>((resolve) => {
    server!.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`));
  });
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
});

describe("MCP tool state API", () => {
  it("shows a bootstrap owner all non-private canonical tools through the selected project's organization", async () => {
    directory = mkdtempSync(join(tmpdir(), "ingenium-mcp-tools-owner-"));
    process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
    resetDbForTest();
    const owner = await bootstrap.claimBootstrap({
      email: "catalog-owner@example.test",
      displayName: "Catalog Owner",
      password: "correct horse battery staple",
    });
    const project = projects.createProject("mcp-owner-project", false, owner.organizationId);
    const catalog = authorizedCatalog({
      authorizationPolicy: {},
      principal: { type: "user", id: owner.userId, scopes: ["user:*"], session: { id: "browser-session" } },
    } as any, project.id);

    expect(catalog.size).toBe(231);
    expect(catalog.has("ingenium_coordination_handoff")).toBe(true);
    expect(catalog.has("ingenium_context_get")).toBe(false);
    expect(catalog.has("ingenium_context_message_retrieve")).toBe(false);
    expect(Array.from(catalog.values()).filter((tool) => tool.authorization?.target === "project")).toHaveLength(150);
    expect(Array.from(catalog.values()).filter((tool) => tool.authorization?.target === "installation")).toHaveLength(32);
    expect(Array.from(catalog.values()).filter((tool) => tool.authorization?.target === "organization")).toHaveLength(49);
    expect(Array.from(catalog.values()).some((tool) => tool.authorization?.target === "private")).toBe(false);

    const baseUrl = await startRouter({ type: "user", id: owner.userId, scopes: ["user:*"], session: { id: "browser-session" } });
    const response = await fetch(`${baseUrl}/mcp-tools?project=${project.name}&include_categories=true`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.total).toBe(231);
    expect(body.data).toHaveLength(27);
    expect(body.counts).toEqual({ visibleTools: 231, visibleCategories: 27 });
    expect(body.counts).not.toHaveProperty("canonicalTools");
    expect(body.counts).not.toHaveProperty("hiddenTools");
    expect(body.counts).not.toHaveProperty("canonicalCategories");
    expect(body.data.every((category: { total_count: number; tools: unknown[] }) => category.total_count === category.tools.length)).toBe(true);

    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    const reportRouter = createMcpToolsRouter({
      usefulnessCollector: createFixtureMcpUsefulnessCollector({
        launch: () => ({
          connect: async () => undefined,
          listTools: async () => ({ tools: [{ name: "health_check" }] }),
          callHealthCheck: async () => ({ content: [{ type: "text", text: "ok" }] }),
          close: async () => undefined,
        }),
      }),
    });
    const reportBaseUrl = await startRouter({ type: "user", id: owner.userId, scopes: ["user:*"], session: { id: "browser-session" } }, reportRouter);
    const reportResponse = await fetch(`${reportBaseUrl}/mcp-tools/report?project=${project.name}`);
    const report = await reportResponse.json();
    const authorizedNames = new Set(catalog.keys());
    const excludedNames = Array.from(mcpToolStates.getAllTools(project.id).keys()).filter((name) => !authorizedNames.has(name));
    expect(reportResponse.status).toBe(200);
    expect(report.total).toBe(231);
    expect(report.data.tools).toHaveLength(231);
    expect(report.data.catalog).toEqual({
      status: "conformant",
      issues: [],
      authorizedVisibleExpected: { toolCount: 231, categoryCount: 27 },
    });
    expect(report.data.tools.every((tool: { name: string }) => authorizedNames.has(tool.name))).toBe(true);
    expect(excludedNames.some((name) => JSON.stringify(report).includes(name))).toBe(false);
    expect(report).not.toHaveProperty("counts");
    expect(JSON.stringify(report.data.catalog)).not.toMatch(/canonical|hidden|private/i);
  });

  it("returns the resolved project ID and preserves isolation with idempotent category updates", async () => {
    directory = mkdtempSync(join(tmpdir(), "ingenium-mcp-tools-route-"));
    process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
    const projectA = projects.createProject("mcp-tools-route-a");
    const projectB = projects.createProject("mcp-tools-route-b");
    const baseUrl = await startRouter();
    const toolName = "ingenium_skill_list";

    const listed = await fetch(`${baseUrl}/mcp-tools?project=mcp-tools-route-a`);
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({ project: "mcp-tools-route-a", project_id: projectA.id });

    const disabled = await fetch(`${baseUrl}/mcp-tools/${toolName}?project=mcp-tools-route-a`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toMatchObject({
      project: "mcp-tools-route-a",
      project_id: projectA.id,
      data: { project_id: projectA.id, tool_name: toolName, enabled: false },
    });

    const stateA = await fetch(`${baseUrl}/mcp-tools/${toolName}/state?project=mcp-tools-route-a`);
    const stateB = await fetch(`${baseUrl}/mcp-tools/${toolName}/state?project=mcp-tools-route-b`);
    await expect(stateA.json()).resolves.toMatchObject({ project: "mcp-tools-route-a", project_id: projectA.id, data: { enabled: false } });
    await expect(stateB.json()).resolves.toMatchObject({ project: "mcp-tools-route-b", project_id: projectB.id, data: { enabled: true } });

    const category = await fetch(`${baseUrl}/mcp-tools/category/Skills?project=mcp-tools-route-a`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(category.status).toBe(200);
    const categoryBody = await category.json() as { project: string; project_id: string; data: { tools_changed: number } };
    expect(categoryBody.project).toBe("mcp-tools-route-a");
    expect(categoryBody.project_id).toBe(projectA.id);
    expect(categoryBody.data.tools_changed).toBeGreaterThan(0);

    const repeatedCategory = await fetch(`${baseUrl}/mcp-tools/category/Skills?project=mcp-tools-route-a`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    await expect(repeatedCategory.json()).resolves.toMatchObject({
      project: "mcp-tools-route-a",
      project_id: projectA.id,
      data: { category: "Skills", enabled: false, tools_changed: 0 },
    });

    const categorized = await fetch(`${baseUrl}/mcp-tools?project=mcp-tools-route-a&include_categories=true`);
    await expect(categorized.json()).resolves.toMatchObject({
      project: "mcp-tools-route-a",
      project_id: projectA.id,
      counts: {
        visibleTools: expect.any(Number),
        visibleCategories: expect.any(Number),
      },
    });
  });
});
