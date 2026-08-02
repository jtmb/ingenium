import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, projects, resetDbForTest, usage } from "ingenium-core";
import { authMiddleware } from "../lib/middleware/auth.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { usageRouter } from "../lib/routes/usage.js";

const API_TOKEN = "a".repeat(32);
const PRIMARY = "usage-advisory-api-primary";
const SECONDARY = "usage-advisory-api-secondary";

let directory = "";
let server: Server | undefined;
let origin = "";
let primaryId = "";
let secondaryId = "";
let originalDbPath: string | undefined;
let originalApiToken: string | undefined;
let originalApiTokenFile: string | undefined;

function thresholdBody(expectedRevision: number, overrides: Record<string, unknown> = {}) {
  return {
    expected_revision: expectedRevision,
    request_count: null,
    total_tokens: null,
    reported_cost_amount: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    ...overrides,
  };
}

async function request(
  path: string,
  method = "GET",
  body?: unknown,
  options: { project?: string; authorization?: string | null } = {},
) {
  const project = options.project ?? PRIMARY;
  const authorization = options.authorization === undefined ? `Bearer ${API_TOKEN}` : options.authorization;
  const response = await fetch(
    `${origin}/api/v1/usage${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(project)}`,
    {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(authorization === null ? {} : { Authorization: authorization }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  return { response, body: await response.json() };
}

function seed(projectId: string, partId: string, occurredAt: string, overrides: Record<string, unknown> = {}) {
  return usage.upsertUsageEvent({
    projectId,
    sourceInstance: "http://opencode.test:4098",
    sourcePartId: partId,
    sourceSessionId: "ses-usage-advisory-api",
    sourceMessageId: `msg-${partId}`,
    sourceProjectId: "oc-usage-advisory-api",
    providerId: "provider-should-not-appear",
    modelId: "model-should-not-appear",
    agentId: "agent-should-not-appear",
    status: "success" as const,
    occurredAt,
    totalTokens: 10,
    inputTokens: 6,
    outputTokens: 4,
    reasoningTokens: 0,
    cacheReadTokens: 2,
    cacheWriteTokens: 1,
    costAmount: 0.5,
    costStatus: "known" as const,
    ...overrides,
  });
}

function expectNoEnforcementOrProviderFields(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(expectNoEnforcementOrProviderFields);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    expect([
      "block", "blocked", "blocking", "action", "enforce", "enforcement",
      "provider", "providerId", "currency", "price", "window", "route",
    ]).not.toContain(key);
    expectNoEnforcementOrProviderFields(entry);
  }
}

beforeEach(async () => {
  originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
  originalApiToken = process.env.INGENIUM_API_TOKEN;
  originalApiTokenFile = process.env.INGENIUM_API_TOKEN_FILE;
  directory = mkdtempSync(join(tmpdir(), "ingenium-usage-advisory-api-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  process.env.INGENIUM_API_TOKEN = API_TOKEN;
  delete process.env.INGENIUM_API_TOKEN_FILE;
  resetDbForTest();
  primaryId = projects.createProject(PRIMARY).id;
  secondaryId = projects.createProject(SECONDARY).id;

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use("/api/v1/usage", usageRouter);
  app.use(errorHandler);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      origin = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalApiToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalApiToken;
  if (originalApiTokenFile === undefined) delete process.env.INGENIUM_API_TOKEN_FILE;
  else process.env.INGENIUM_API_TOKEN_FILE = originalApiTokenFile;
});

describe("usage advisory threshold API", () => {
  it("requires bearer authentication and returns the bounded all-null default", async () => {
    const unauthorized = await request("/thresholds", "GET", undefined, { authorization: null });
    expect(unauthorized.response.status).toBe(401);
    expect(unauthorized.body).toMatchObject({ error: { code: "UNAUTHORIZED" } });

    const countBeforeRead = getDb().prepare("SELECT COUNT(*) AS count FROM usage_advisory_thresholds WHERE project_id = ?").get(primaryId);
    const configured = await request("/thresholds");
    expect(configured.response.status).toBe(200);
    expect(configured.body).toEqual({
      data: expect.objectContaining({
        requestCount: null,
        totalTokens: null,
        reportedCostAmount: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        revision: 1,
      }),
    });
    expectNoEnforcementOrProviderFields(configured.body);
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM usage_advisory_thresholds WHERE project_id = ?").get(primaryId)).toEqual(countBeforeRead);
  });

  it("uses a strict PUT replacement DTO, reports validation and CAS errors, and cannot cross projects", async () => {
    const invalid = await request("/thresholds", "PUT", { expected_revision: 1, blocking: true });
    expect(invalid.response.status).toBe(422);
    expect(invalid.body).toEqual({ error: { code: "INVALID_USAGE_THRESHOLD_INPUT", message: "Usage advisory thresholds are invalid." } });

    const updated = await request("/thresholds", "PUT", thresholdBody(1, {
      request_count: 2,
      total_tokens: 10,
      reported_cost_amount: 0.5,
      cache_read_tokens: 3,
      cache_write_tokens: 1,
    }));
    expect(updated.response.status).toBe(200);
    expect(updated.body).toMatchObject({ data: {
      requestCount: 2,
      totalTokens: 10,
      reportedCostAmount: 0.5,
      revision: 2,
    } });

    const conflict = await request("/thresholds", "PUT", thresholdBody(1));
    expect(conflict.response.status).toBe(409);
    expect(conflict.body).toEqual({ error: {
      code: "USAGE_THRESHOLD_REVISION_CONFLICT",
      message: "Usage advisory thresholds were changed by another request.",
      currentRevision: 2,
    } });

    const secondary = await request("/thresholds", "GET", undefined, { project: SECONDARY });
    expect(secondary.response.status).toBe(200);
    expect(secondary.body.data).toMatchObject({ requestCount: null, revision: 1 });
    expect(usage.getUsageAdvisoryThresholds(primaryId)).toMatchObject({ requestCount: 2, revision: 2 });
    expect(usage.getUsageAdvisoryThresholds(secondaryId)).toMatchObject({ requestCount: null, revision: 1 });
  });

  it("returns advisory-only evaluations without mutating telemetry, sync, or request execution", async () => {
    seed(primaryId, "advisory-api-event", "2026-05-01T12:00:00.000Z");
    const config = await request("/thresholds", "PUT", thresholdBody(1, {
      request_count: 1,
      total_tokens: 10,
      reported_cost_amount: 0.5,
      cache_read_tokens: 2,
      cache_write_tokens: 1,
    }));
    expect(config.response.status).toBe(200);
    const before = usage.getUsageSummary(primaryId, {
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-05-02T00:00:00.000Z",
    });

    const evaluated = await request("/thresholds/evaluate?from=2026-05-01T00%3A00%3A00Z&to=2026-05-02T00%3A00%3A00Z");
    expect(evaluated.response.status).toBe(200);
    expect(evaluated.body.data).toMatchObject({
      range: { from: "2026-05-01T00:00:00.000Z", to: "2026-05-02T00:00:00.000Z" },
      metrics: {
        requestCount: { observed: 1, threshold: 1, availability: "known", state: "equal" },
        totalTokens: { observed: 10, threshold: 10, availability: "known", state: "equal" },
        reportedCostAmount: { observed: 0.5, threshold: 0.5, availability: "known", state: "equal" },
      },
    });
    expectNoEnforcementOrProviderFields(evaluated.body);
    expect(usage.getUsageSummary(primaryId, {
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-05-02T00:00:00.000Z",
    })).toEqual(before);
  });

  it("keeps malformed, absent, archived, and inverted project/range requests safely typed", async () => {
    const missingProject = await fetch(`${origin}/api/v1/usage/thresholds`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    expect(missingProject.status).toBe(400);
    await expect(missingProject.json()).resolves.toMatchObject({ error: { code: "BAD_REQUEST" } });

    getDb().prepare("UPDATE projects SET archived_at = ? WHERE id = ?").run("2026-05-01T00:00:00.000Z", secondaryId);
    const archived = await request("/thresholds", "GET", undefined, { project: SECONDARY });
    expect(archived.response.status).toBe(404);
    expect(archived.body).toMatchObject({ error: { code: "NOT_FOUND" } });

    const inverted = await request("/thresholds/evaluate?from=2026-05-02T00%3A00%3A00.000Z&to=2026-05-01T00%3A00%3A00.000Z");
    expect(inverted.response.status).toBe(422);
    expect(inverted.body).toEqual({ error: {
      code: "INVALID_USAGE_QUERY",
      message: "Usage filters, range, or pagination are invalid.",
    } });
  });
});
