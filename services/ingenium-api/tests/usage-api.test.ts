import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projects, resetDbForTest, usage } from "ingenium-core";

const mockSyncUsageFromOpenCode = vi.fn();
vi.mock("../lib/usage-sync.js", () => ({
  getOpenCodeUsageSourceInstance: () => "http://opencode.test:4098",
  syncUsageFromOpenCode: (...args: unknown[]) => mockSyncUsageFromOpenCode(...args),
}));

import { usageRouter } from "../lib/routes/usage.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

const directory = mkdtempSync(join(tmpdir(), "ingenium-usage-api-"));
const databasePath = join(directory, "data.db");
const primaryProjectName = "usage-api-primary";
const secondaryProjectName = "usage-api-secondary";
let primaryProjectId = "";
let secondaryProjectId = "";
let server: Server;
let baseUrl = "";

function url(path: string, project = primaryProjectName): string {
  return `${baseUrl}/api/v1/usage${path}${path.includes("?") ? "&" : "?"}project=${project}`;
}

function seed(projectId: string, partId: string, occurredAt: string, overrides: Record<string, unknown> = {}) {
  return usage.upsertUsageEvent({
    projectId,
    sourceInstance: "http://opencode.test:4098",
    sourcePartId: partId,
    sourceSessionId: "ses-api",
    sourceMessageId: `msg-${partId}`,
    sourceProjectId: "oc-api-project",
    providerId: "=raw-provider",
    modelId: "raw-model",
    agentId: "agent-primary",
    status: "success",
    occurredAt,
    totalTokens: 20,
    inputTokens: 12,
    outputTokens: 8,
    reasoningTokens: 3,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    costAmount: null,
    costStatus: "unavailable",
    ...overrides,
  });
}

beforeAll(async () => {
  process.env.INGENIUM_CORE_DB_PATH = databasePath;
  resetDbForTest();
  primaryProjectId = projects.createProject(primaryProjectName).id;
  secondaryProjectId = projects.createProject(secondaryProjectName).id;
  seed(primaryProjectId, "part-api-1", "2026-02-01T00:00:00.000Z");
  seed(primaryProjectId, "part-api-2", "2026-02-02T00:00:00.000Z", {
    providerId: "Provider Second",
    modelId: "raw-model-v2",
    agentId: null,
    reasoningTokens: null,
    costAmount: 0.5,
    costStatus: "known",
    cacheReadTokens: 6,
  });
  seed(secondaryProjectId, "part-api-3", "2026-02-01T00:00:00.000Z", { costAmount: 99, costStatus: "known" });

  const app = express();
  app.use(express.json());
  app.use("/api/v1/usage", usageRouter);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});

afterAll(async () => {
  await closeHttpServer(server);
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe("usage API", () => {
  it("returns project-scoped UTC summary, provider/model breakdown, and metadata-only paginated events", async () => {
    const summary = await fetch(url("/summary?from=2026-02-01T00%3A00%3A00.000Z&to=2026-02-03T00%3A00%3A00.000Z"));
    expect(summary.status).toBe(200);
    const summaryBody = await summary.json();
    expect(summaryBody.data).toMatchObject({
      range: { from: "2026-02-01T00:00:00.000Z", to: "2026-02-03T00:00:00.000Z" },
      totals: {
        requests: 2,
        cost: { value: 0.5, availability: "partial" },
        tokens: { reasoning: { value: 3, availability: "partial" } },
        cache: { read: { value: 6, availability: "partial" } },
      },
    });
    expect(summaryBody.data.daily.map((row: { day: string }) => row.day)).toEqual(["2026-02-01", "2026-02-02"]);

    const breakdown = await fetch(url("/breakdown?from=2026-02-01T00%3A00%3A00.000Z&to=2026-02-03T00%3A00%3A00.000Z"));
    expect(breakdown.status).toBe(200);
    await expect(breakdown.json()).resolves.toMatchObject({ data: [
      { providerId: "=raw-provider", modelId: "raw-model", agentId: "agent-primary", requests: 1 },
      { providerId: "Provider Second", modelId: "raw-model-v2", agentId: null, requests: 1 },
    ] });

    const agentFiltered = await fetch(url("/summary?from=2026-02-01T00%3A00%3A00.000Z&to=2026-02-03T00%3A00%3A00.000Z&agent=agent-primary"));
    await expect(agentFiltered.json()).resolves.toMatchObject({
      data: { totals: { requests: 1, tokens: { reasoning: { value: 3, availability: "known" } } } },
    });

    const events = await fetch(url("/events?from=2026-02-01T00%3A00%3A00.000Z&to=2026-02-03T00%3A00%3A00.000Z&limit=1"));
    expect(events.status).toBe(200);
    const eventsBody = await events.json();
    expect(eventsBody.pagination).toMatchObject({ total: 2, hasMore: true });
    expect(eventsBody.data[0]).not.toHaveProperty("text");
    expect(eventsBody.data[0]).not.toHaveProperty("reasoning");
    expect(eventsBody.data[0]).not.toHaveProperty("toolPayload");
    expect(eventsBody.data[0]).toMatchObject({ agentId: null, tokens: { reasoning: null } });
  });

  it("exports bounded, spreadsheet-safe CSV without selecting message payloads", async () => {
    const response = await fetch(url("/export?from=2026-02-01T00%3A00%3A00.000Z&to=2026-02-03T00%3A00%3A00.000Z&limit=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("x-export-truncated")).toBe("true");
    expect(response.headers.get("x-export-next-cursor")).toBeTruthy();
    const csv = await response.text();
    expect(csv).toContain("source_part_id");
    expect(csv).toContain("agent_id");
    expect(csv).toContain("reasoning_tokens");
    expect(csv).toContain("'=raw-provider");
    expect(csv).not.toContain("prompt");
    expect(csv).not.toContain("tool_payload");

    const nextCursor = response.headers.get("x-export-next-cursor");
    const continuation = await fetch(url(
      `/export?from=2026-02-01T00%3A00%3A00.000Z&to=2026-02-03T00%3A00%3A00.000Z&limit=1&cursor=${encodeURIComponent(nextCursor!)}`,
    ));
    expect(continuation.status).toBe(200);
    expect(continuation.headers.get("x-export-truncated")).toBe("false");
    expect(continuation.headers.get("x-export-next-cursor")).toBeNull();
    const continuationCsv = await continuation.text();
    expect(csv).toContain("part-api-1");
    expect(continuationCsv).toContain("part-api-2");
    expect(continuationCsv).not.toContain("part-api-1");
  });

  it("uses exact inclusive-from and exclusive-to UTC boundaries", async () => {
    seed(primaryProjectId, "part-at-from", "2026-02-03T00:00:00.000Z", {
      agentId: "agent-boundary",
      reasoningTokens: 0,
    });
    seed(primaryProjectId, "part-at-to", "2026-02-04T00:00:00.000Z", {
      agentId: "agent-boundary",
      reasoningTokens: 99,
    });
    const response = await fetch(url(
      "/summary?from=2026-02-03T00%3A00%3A00.000Z&to=2026-02-04T00%3A00%3A00.000Z&agent=agent-boundary",
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        totals: { requests: 1, tokens: { reasoning: { value: 0, availability: "known" } } },
        daily: [{ day: "2026-02-03", requests: 1 }],
      },
    });
  });

  it("filters live API events by repeated status parameters", async () => {
    seed(primaryProjectId, "part-status-error", "2026-02-05T01:00:00.000Z", { status: "error" });
    seed(primaryProjectId, "part-status-partial", "2026-02-05T02:00:00.000Z", { status: "partial" });
    seed(primaryProjectId, "part-status-success", "2026-02-05T03:00:00.000Z", { status: "success" });

    const response = await fetch(url(
      "/events?from=2026-02-05T00%3A00%3A00.000Z&to=2026-02-06T00%3A00%3A00.000Z&status=error&status=partial",
    ));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pagination).toMatchObject({ total: 2, hasMore: false, nextCursor: null });
    expect(body.data.map((event: { sourcePartId: string; status: string }) => [event.sourcePartId, event.status]))
      .toEqual([
        ["part-status-partial", "partial"],
        ["part-status-error", "error"],
      ]);
  });

  it("rejects invalid filters and non-owned projects with safe error envelopes", async () => {
    const invalidRange = await fetch(url("/summary?from=2025-01-01T00%3A00%3A00.000Z&to=2026-02-03T00%3A00%3A00.000Z"));
    expect(invalidRange.status).toBe(422);
    await expect(invalidRange.json()).resolves.toMatchObject({ error: { code: "INVALID_USAGE_QUERY" } });

    const missingProject = await fetch(`${baseUrl}/api/v1/usage/summary?from=2026-02-01T00%3A00%3A00.000Z&to=2026-02-03T00%3A00%3A00.000Z`);
    expect(missingProject.status).toBe(400);
    const unknownProject = await fetch(url("/summary?from=2026-02-01T00%3A00%3A00.000Z&to=2026-02-03T00%3A00%3A00.000Z", "missing-project"));
    expect(unknownProject.status).toBe(404);
  });

  it("supports explicit mappings and manual sync without global-project fallback", async () => {
    mockSyncUsageFromOpenCode.mockResolvedValueOnce({
      sourceInstance: "http://opencode.test:4098",
      projects: [{ projectId: primaryProjectId, sessionsSelected: 1, sessionsProcessed: 1, eventsUpserted: 1, errorCode: null }],
      sessionsScanned: 1,
      sessionsQuarantined: 0,
      sessionsSkipped: 0,
      unavailable: false,
      errorCode: null,
      alreadyRunning: false,
    });
    const mapping = await fetch(url("/mappings"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opencodeProjectId: "oc-api-project" }),
    });
    expect(mapping.status).toBe(201);
    await expect(mapping.json()).resolves.toMatchObject({ data: { opencodeProjectId: "oc-api-project", status: "mapped" } });

    const manualSync = await fetch(url("/sync"), { method: "POST" });
    expect(manualSync.status).toBe(200);
    await expect(manualSync.json()).resolves.toMatchObject({ data: { sessionsProcessed: 1, eventsUpserted: 1 } });

    const mappings = await fetch(url("/mappings"));
    await expect(mappings.json()).resolves.toMatchObject({ data: [{ opencodeProjectId: "oc-api-project", status: "mapped" }] });
  });

  it("returns a safe 500 envelope when aggregation fails unexpectedly", async () => {
    const spy = vi.spyOn(usage, "getUsageSummary").mockImplementationOnce(() => {
      throw new Error("do not expose database internals");
    });
    const response = await fetch(url("/summary?from=2026-02-01T00%3A00%3A00.000Z&to=2026-02-03T00%3A00%3A00.000Z"));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: "USAGE_UNAVAILABLE", message: "Usage data is temporarily unavailable." },
    });
    spy.mockRestore();
  });
});
