import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coordination, projects, resetDbForTest, usage } from "ingenium-core";
import { usageRouter } from "../lib/routes/usage.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

let directory: string;
let server: Server;
let baseUrl: string;
let principal: any;
const input = { worktree: "/home/brajam/repos/ingenium", sessionId: "ses-usage", messageId: "msg-usage",
  role: "assistant", completedAt: "2026-09-10T10:00:00.000Z", providerId: "openai", modelId: "model",
  agentId: "engineer", inputTokens: 10, outputTokens: 0, reasoningTokens: 2, cacheReadTokens: 0 };

beforeEach(async () => {
  resetDbForTest();
  directory = mkdtempSync(join(tmpdir(), "ingenium-external-usage-api-"));
  vi.stubEnv("INGENIUM_CORE_DB_PATH", join(directory, "test.db"));
  const project = projects.createProject("ingenium-usage-api");
  principal = { type: "service", id: "usage-service", tokenId: "usage-token", scopes: ["usage:write"], audience: "mcp",
    organizationId: project.organization_id, projectId: project.id, projectIds: [project.id], workspaceId: "workspace-usage",
    launcherWorktree: input.worktree, storageMappingHash: "a".repeat(64) };
  coordination.registerCoordinationSession(project.id, {
    worktreeId: coordination.coordinationWorktreeId(principal.workspaceId, principal.storageMappingHash),
    sessionId: input.sessionId, incarnation: 1, ownershipToken: "A".repeat(32), ttlMs: 60_000, idempotencyKey: "register-usage",
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.principal = principal; next(); });
  app.use("/api/v1/usage", usageRouter);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});
afterEach(async () => {
  await closeHttpServer(server);
  resetDbForTest();
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
async function post(event: unknown, project = "ingenium-usage-api", headers = {}) {
  const response = await fetch(`${baseUrl}/api/v1/usage/external?project=${project}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(event),
  });
  return { status: response.status, body: await response.json() };
}
describe("external usage API", () => {
  it("ingests once, retains zero/unknown semantics, and exposes the existing usage read model", async () => {
    const first = await post(input);
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ created: true, event: { providerId: "openai", modelId: "model", agentId: "engineer",
      tokens: { input: 10, output: 0, reasoning: 2, total: null }, cache: { read: 0, write: null },
      cost: { amount: null, availability: "unavailable" } } });
    resetDbForTest();
    expect(await post(input)).toEqual({ status: 200, body: { data: { ...first.body.data, created: false } } });
    const query = "project=ingenium-usage-api&from=2026-09-10T00:00:00.000Z&to=2026-09-11T00:00:00.000Z";
    const summary = await (await fetch(`${baseUrl}/api/v1/usage/summary?${query}`)).json();
    expect(summary.data).toMatchObject({ totals: { requests: 1, cost: { value: null, availability: "unavailable" } },
      freshness: { latestEventAt: input.completedAt } });
    const breakdown = await (await fetch(`${baseUrl}/api/v1/usage/breakdown?${query}`)).json();
    expect(breakdown.data).toMatchObject([{ providerId: "openai", modelId: "model", agentId: "engineer", requests: 1 }]);
    const events = await (await fetch(`${baseUrl}/api/v1/usage/events?${query}`)).json();
    expect(events.data).toEqual([first.body.data.event]);
    expect((await post({ ...input, costAmount: 0 })).status).toBe(409);
  });
  it("rejects foreign/absent/browsing credentials and strict non-assistant or content-bearing input", async () => {
    expect((await post({ ...input, sessionId: "foreign" })).status).toBe(403);
    expect((await post({ ...input, worktree: "/foreign" })).status).toBe(403);
    projects.createProject("foreign");
    expect((await post(input, "foreign")).status).toBe(403);
    expect((await post(input, undefined, { "x-ingenium-ui": "true" })).status).toBe(403);
    for (const override of [{ role: "user" }, { role: "tool" }, { completedAt: undefined }, { text: "secret-canary" }, { costAmount: -1 }]) {
      const result = await post({ ...input, ...override });
      expect(result.status).toBe(422);
      expect(JSON.stringify(result.body)).not.toContain("secret-canary");
    }
    principal = undefined;
    expect((await post(input)).status).toBe(403);
  });
  it("redacts unexpected server failures without replaying the mutation", async () => {
    const ingest = vi.spyOn(usage, "ingestExternalUsage").mockImplementation(() => { throw new Error("Bearer secret-canary"); });
    const result = await post(input);
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("secret-canary");
    expect(ingest).toHaveBeenCalledOnce();
  });
});
