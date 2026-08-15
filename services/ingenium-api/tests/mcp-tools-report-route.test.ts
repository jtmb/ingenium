import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpToolStates, projects, resetDbForTest } from "ingenium-core";
import {
  createFixtureMcpUsefulnessCollector,
  type McpUsefulnessConnection,
} from "../lib/mcp-usefulness-collector.js";
import { authMiddleware } from "../lib/middleware/auth.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { createMcpToolsRouter } from "../lib/routes/mcp-tools.js";
import { compatibilityAuthHeaders } from "./http-fixtures.js";

const TOKEN = "a".repeat(32);
const projectAName = "mcp-report-route-a";
const projectBName = "mcp-report-route-b";
let directory = "";
let server: Server | undefined;
let baseUrl = "";
let originalDbPath: string | undefined;
let originalToken: string | undefined;
let originalTokenFile: string | undefined;
let projectAId = "";
let projectBId = "";

function fixtureConnection(overrides: Partial<McpUsefulnessConnection> = {}): McpUsefulnessConnection {
  return {
    connect: async () => undefined,
    listTools: async () => ({ tools: [{ name: "health_check", inputSchema: { ignored: true } }] }),
    callHealthCheck: async () => ({ content: [{ type: "text", text: "ignored" }] }),
    close: async () => undefined,
    ...overrides,
  };
}

async function start(launch: () => McpUsefulnessConnection = fixtureConnection): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use("/mcp-tools", createMcpToolsRouter({
    usefulnessCollector: createFixtureMcpUsefulnessCollector({
      clock: { now: () => new Date("2026-07-31T12:00:00.000Z") },
      launch,
    }),
  }));
  app.use(errorHandler);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/mcp-tools`;
      resolve();
    });
  });
}

function report(path: string, authorization = true): Promise<Response> {
  return fetch(`${baseUrl}/report?project=${projectAName}${path}`, {
    headers: authorization ? compatibilityAuthHeaders(TOKEN) : undefined,
  });
}

function tool(body: any, name: string): any {
  return body.data.tools.find((entry: { name: string }) => entry.name === name);
}

beforeEach(async () => {
  originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
  originalToken = process.env.INGENIUM_API_TOKEN;
  originalTokenFile = process.env.INGENIUM_API_TOKEN_FILE;
  directory = mkdtempSync(join(tmpdir(), "ingenium-mcp-report-route-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  process.env.INGENIUM_API_TOKEN = TOKEN;
  delete process.env.INGENIUM_API_TOKEN_FILE;
  resetDbForTest();
  projectAId = projects.createProject(projectAName).id;
  projectBId = projects.createProject(projectBName).id;
  await start();
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  resetDbForTest();
  rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalToken;
  if (originalTokenFile === undefined) delete process.env.INGENIUM_API_TOKEN_FILE;
  else process.env.INGENIUM_API_TOKEN_FILE = originalTokenFile;
});

describe("MCP usefulness report route", () => {
  it("inherits authentication and resolves /report before wildcard routes", async () => {
    const unauthorized = await report("", false);
    expect(unauthorized.status).toBe(401);

    const response = await report("");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["project", "project_id", "data", "total"]);
    expect(body).toMatchObject({ project: projectAName, project_id: projectAId, total: body.data.tools.length });
    expect(body.data).toMatchObject({ provenance: "fixture", catalog: { status: "unknown", issues: [] } });
    expect(body.data.tools.every((entry: Record<string, unknown>) => "category" in entry && "enabled" in entry)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(body), "utf8")).toBeLessThanOrEqual(64 * 1024);
  });

  it("uses each project's current effective toggle while preserving isolated report observations", async () => {
    mcpToolStates.setToolState(projectAId, "ingenium_health_check", false);
    const responseA = await report("");
    const responseB = await fetch(`${baseUrl}/report?project=${projectBName}`, {
      headers: compatibilityAuthHeaders(TOKEN),
    });
    const bodyA = await responseA.json();
    const bodyB = await responseB.json();

    expect(tool(bodyA, "ingenium_health_check")).toMatchObject({ enabled: false, visibility: { reason: "TOOL_DISABLED" } });
    expect(tool(bodyB, "ingenium_health_check")).toMatchObject({ enabled: true, visibility: { status: "reachable" } });
    expect(bodyB.project_id).toBe(projectBId);
  });

  it("filters deterministically and returns a valid empty report", async () => {
    const full = await report("");
    const fullBody = await full.json();
    const names = fullBody.data.tools.map((entry: { name: string }) => entry.name);
    expect(names).toEqual([...names].sort());

    const searched = await report("&q=health_check&boundary=mcp-stdio&visibility=reachable&invocation=success");
    const searchedBody = await searched.json();
    expect(searchedBody.data.tools).toHaveLength(1);
    expect(searchedBody.data.tools[0]).toMatchObject({ name: "ingenium_health_check", category: "Health", enabled: true });

    const extension = await report("&boundary=opencode-extension&enabled=true");
    const extensionBody = await extension.json();
    expect(extensionBody.data.tools.every((entry: { boundary: string; enabled: boolean }) => (
      entry.boundary === "opencode-extension" && entry.enabled
    ))).toBe(true);

    const empty = await report("&category=NoSuchCategory");
    const emptyBody = await empty.json();
    expect(emptyBody).toMatchObject({ project: projectAName, project_id: projectAId, total: 0, data: { tools: [] } });
  });

  it("rejects unknown, invalid, and oversized report queries with fixed statuses", async () => {
    for (const suffix of ["&unknown=value", "&enabled=maybe", "&q=%C3%A9", "&q=", "&category="]) {
      const response = await report(suffix);
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_MCP_REPORT_QUERY" } });
    }
    for (const suffix of [`&q=${"a".repeat(129)}`, `&category=${"a".repeat(129)}`]) {
      const response = await report(suffix);
      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "MCP_REPORT_QUERY_TOO_LARGE" } });
    }
  });

  it("returns fixed unavailable output when cleanup cannot be confirmed", async () => {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    await start(() => fixtureConnection({
      close: async () => { throw new Error("Bearer fixture-secret https://private.invalid/cleanup"); },
    }));

    const response = await report("");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: { code: "MCP_REPORT_UNAVAILABLE", message: "The MCP report is unavailable." } });
    expect(JSON.stringify(body)).not.toContain("fixture-secret");
    expect(JSON.stringify(body)).not.toContain("private.invalid");
  });
});
