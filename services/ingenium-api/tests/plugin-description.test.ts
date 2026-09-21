import { afterEach, beforeEach, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, plugins, projects, resetDbForTest } from "ingenium-core";
import { pluginsRouter } from "../lib/routes/plugins.js";
import { policyForRequest } from "../lib/authorization-policy.js";
import type { RequestPrincipal } from "../lib/middleware/auth.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

let directory: string;
let server: Server;
let baseUrl: string;
let projectId: string;
let principal: RequestPrincipal | undefined;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "plugin-description-api-"));
  vi.stubEnv("INGENIUM_CORE_DB_PATH", join(directory, "data.db"));
  resetDbForTest();
  const project = projects.createProject("plugin-description");
  projectId = project.id;
  principal = { type: "service", id: "plugin-service", tokenId: "plugin-token", scopes: ["plugins:read", "plugins:write"], audience: "mcp",
    organizationId: project.organization_id, projectId, projectIds: [projectId] };
  getDb().prepare("INSERT INTO plugins (id, project_id, name, file_path, enabled, source_content, created_at, updated_at) VALUES ('fixture', ?, 'fixture', '/external/plugin.ts', 0, 'export {};', 'before', 'before')").run(projectId);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.principal = principal;
    req.authorizationPolicy = policyForRequest(req);
    next();
  });
  app.use("/api/v1/plugins", pluginsRouter);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});
afterEach(async () => {
  await closeHttpServer(server);
  vi.restoreAllMocks();
  resetDbForTest();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
async function update(body: unknown, project = "plugin-description", name = "fixture") {
  return fetch(`${baseUrl}/api/v1/plugins/${name}?project=${project}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

it("saves and reloads only local metadata with project write authorization", async () => {
  const before = plugins.getPlugin(projectId, "fixture")!;
  const response = await update({ description: "Local <script>text</script>" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { ...before, description: "Local <script>text</script>", updated_at: expect.any(String) } });
  const reload = await fetch(`${baseUrl}/api/v1/plugins?project=plugin-description`);
  expect(await reload.json()).toMatchObject({ data: [{ description: "Local <script>text</script>" }] });
  expect((await update({ description: "" })).status).toBe(200);
});

it("rejects invalid/mixed bodies, missing plugins, foreign projects and missing/read-only principals without mutation", async () => {
  const before = plugins.getPlugin(projectId, "fixture");
  for (const body of [{}, { description: null }, { description: 42 }, { description: "x".repeat(2001) }, { description: "bad\0text" },
    ...["file_path", "source_content", "enabled", "order", "project_id"].map((field) => ({ description: "notes", [field]: "changed" }))]) {
    expect((await update(body)).status).toBe(400);
  }
  expect((await update({ description: "notes" }, undefined, "missing")).status).toBe(404);
  projects.createProject("foreign-plugin-project");
  expect([403, 404]).toContain((await update({ description: "notes" }, "foreign-plugin-project")).status);
  principal = { ...principal!, scopes: ["plugins:read"] } as RequestPrincipal;
  expect((await update({ description: "notes" })).status).toBe(403);
  principal = undefined;
  expect((await update({ description: "notes" })).status).toBe(401);
  expect(plugins.getPlugin(projectId, "fixture")).toEqual(before);
});

it("does not expose internal errors or replay a failed update", async () => {
  const updateDescription = vi.spyOn(plugins, "updatePluginDescription").mockImplementation(() => { throw new Error("secret-canary SQL path"); });
  const response = await update({ description: "notes" });
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Plugin description update failed" } });
  expect(updateDescription).toHaveBeenCalledOnce();
});
