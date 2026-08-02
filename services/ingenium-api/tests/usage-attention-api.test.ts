import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projects, resetDbForTest, usage } from "ingenium-core";
import { authMiddleware } from "../lib/middleware/auth.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { usageRouter } from "../lib/routes/usage.js";

const API_TOKEN = "a".repeat(32);
const PRIMARY = "usage-attention-api-primary";
const SECONDARY = "usage-attention-api-secondary";

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

function noRawUsageFields(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(noRawUsageFields);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    expect([
      "provider", "providerId", "model", "modelId", "source", "sourceId", "payload", "text", "message",
      "action", "enforce", "blocked", "rangeFrom", "rangeTo",
    ]).not.toContain(key);
    noRawUsageFields(entry);
  }
}

beforeEach(async () => {
  originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
  originalApiToken = process.env.INGENIUM_API_TOKEN;
  originalApiTokenFile = process.env.INGENIUM_API_TOKEN_FILE;
  directory = mkdtempSync(join(tmpdir(), "ingenium-usage-attention-api-"));
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

describe("USAGE-101 attention API", () => {
  it("requires bearer auth, evaluates the fixed all-history contract, and redacts source/provider data", async () => {
    const unauthorized = await request("/attention", "GET", undefined, { authorization: null });
    expect(unauthorized.response.status).toBe(401);

    usage.replaceUsageAdvisoryThresholds(primaryId, {
      expectedRevision: 1,
      requestCount: 0,
      totalTokens: null,
      reportedCostAmount: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    });
    const evaluated = await request("/attention/evaluate", "POST");
    expect(evaluated.response.status).toBe(200);
    expect(evaluated.body.data.items).toEqual([expect.objectContaining({
      condition: "usage.advisory:v1:all-history:request_count",
      status: "active",
      evaluationState: "equal",
      messageCode: "USAGE_ADVISORY_EQUAL",
      range: { from: null, to: null },
    })]);
    noRawUsageFields(evaluated.body);

    const listed = await request("/attention?limit=1", "GET");
    expect(listed.response.status).toBe(200);
    expect(listed.body.pagination).toEqual({ nextCursor: null, hasMore: false, total: 1 });
    noRawUsageFields(listed.body);
  });

  it("accepts acknowledgement only with expected_revision and provides replay-safe CAS", async () => {
    usage.replaceUsageAdvisoryThresholds(primaryId, {
      expectedRevision: 1,
      requestCount: 0,
      totalTokens: null,
      reportedCostAmount: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    });
    const evaluated = await request("/attention/evaluate", "POST");
    const item = evaluated.body.data.items[0];
    const acknowledged = await request(`/attention/${item.id}/acknowledge`, "POST", { expected_revision: item.revision });
    expect(acknowledged.response.status).toBe(200);
    expect(acknowledged.body.data.acknowledgedAt).not.toBeNull();
    const replay = await request(`/attention/${item.id}/acknowledge`, "POST", { expected_revision: item.revision });
    expect(replay.response.status).toBe(200);
    expect(replay.body).toEqual(acknowledged.body);
    const invalid = await request(`/attention/${item.id}/acknowledge`, "POST", { expected_revision: item.revision, suppress: true });
    expect(invalid.response.status).toBe(422);
    const conflict = await request(`/attention/${item.id}/acknowledge`, "POST", { expected_revision: item.revision + 2 });
    expect(conflict.response.status).toBe(409);
    expect(conflict.body.error).toMatchObject({ code: "USAGE_ATTENTION_REVISION_CONFLICT", currentRevision: item.revision + 1 });
  });

  it("uses keyset pagination, hides resolved items by default, and scopes foreign or archived projects as absent", async () => {
    const configured = await request("/thresholds", "PUT", thresholdBody(1, { request_count: 0 }));
    expect(configured.response.status).toBe(200);
    const created = await request("/attention/evaluate", "POST");
    const item = created.body.data.items[0];
    expect((await request("/attention?limit=101")).response.status).toBe(422);
    expect((await request("/attention?cursor=invalid")).response.status).toBe(422);
    expect((await request(`/attention/${item.id}/acknowledge`, "POST", { expected_revision: item.revision }, { project: SECONDARY })).response.status).toBe(404);

    const thresholdRevision = configured.body.data.revision;
    const below = await request("/thresholds", "PUT", thresholdBody(thresholdRevision, { request_count: 1 }));
    expect(below.response.status).toBe(200);
    expect((await request("/attention/evaluate", "POST")).response.status).toBe(200);
    expect((await request("/attention")).body).toMatchObject({ data: [], pagination: { total: 0 } });
    expect((await request("/attention?include_resolved=true")).body).toMatchObject({ data: [expect.objectContaining({ status: "resolved" })] });

    projects.archiveProject(SECONDARY);
    const archived = await request("/attention", "GET", undefined, { project: SECONDARY });
    expect(archived.response.status).toBe(404);
    expect(secondaryId).not.toBe(primaryId);
  });

  it("rejects arbitrary evaluate bodies and ranges without altering request execution", async () => {
    const before = usage.listUsageEvents(primaryId, {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-02T00:00:00.000Z",
    });
    expect((await request("/attention/evaluate?from=2026-01-01T00%3A00%3A00Z", "POST")).response.status).toBe(422);
    expect((await request("/attention/evaluate", "POST", {})).response.status).toBe(422);
    expect(usage.listUsageEvents(primaryId, {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-02T00:00:00.000Z",
    })).toEqual(before);
  });
});
