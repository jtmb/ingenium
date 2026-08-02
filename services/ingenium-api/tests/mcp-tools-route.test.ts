import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projects, resetDbForTest } from "ingenium-core";
import { mcpToolsRouter } from "../lib/routes/mcp-tools.js";

let directory = "";
let server: Server | undefined;
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;

async function startRouter(): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use("/mcp-tools", mcpToolsRouter);
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
    await expect(categorized.json()).resolves.toMatchObject({ project: "mcp-tools-route-a", project_id: projectA.id });
  });
});
