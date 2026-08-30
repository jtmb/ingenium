import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import {
  UsageError,
  getOpenCodeProjectMapping,
  getUsageBreakdown,
  getUsageExportPage,
  getUsageSummary,
  listUsageEvents,
  mapOpenCodeProject,
  quarantineOpenCodeProject,
  saveUsageSyncState,
  upsertUsageEvent,
} from "../lib/tools/usage.js";

let directory = "";
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;

function setup() {
  directory = mkdtempSync(join(tmpdir(), "ingenium-usage-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  const first = createProject("usage-first");
  const second = createProject("usage-second");
  return { first, second, db: getDb(process.env.INGENIUM_CORE_DB_PATH) };
}

function event(projectId: string, partId: string, occurredAt: string, overrides: Record<string, unknown> = {}) {
  return {
    projectId,
    sourceInstance: "http://opencode.test:4098",
    sourcePartId: partId,
    sourceSessionId: "ses_usage",
    sourceMessageId: `msg_${partId}`,
    sourceProjectId: "oc-project-1",
    providerId: "Provider/Raw-ID",
    modelId: "Model/Raw-ID",
    agentId: "agent-main",
    status: "success" as const,
    occurredAt,
    totalTokens: 12,
    inputTokens: 7,
    outputTokens: 5,
    reasoningTokens: 2,
    cacheReadTokens: 3,
    cacheWriteTokens: 1,
    costAmount: 0.12,
    costStatus: "known" as const,
    ...overrides,
  };
}

afterEach(() => {
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
});

describe("usage telemetry core", () => {
  it("creates metadata-only usage tables and quarantines unmapped OpenCode projects without a global fallback", () => {
    const { first, second, db } = setup();
    const columns = db.prepare("PRAGMA table_info('usage_events')").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "source_part_id", "provider_id", "model_id", "cost_status", "cache_read_tokens",
      "agent_id", "reasoning_tokens",
    ]));
    expect(columns.map((column) => column.name)).not.toEqual(expect.arrayContaining([
      "text", "reasoning", "tool_payload", "credentials", "payload",
    ]));

    const quarantined = quarantineOpenCodeProject(
      "http://opencode.test:4098",
      "oc-project-1",
      "ses_usage",
      "2026-01-01T00:00:00.000Z",
    );
    expect(quarantined).toMatchObject({ status: "quarantined", ingeniumProjectId: null });
    expect(getOpenCodeProjectMapping("http://opencode.test:4098", "oc-project-1")).toMatchObject({
      status: "quarantined",
      ingeniumProjectId: null,
    });

    expect(mapOpenCodeProject("http://opencode.test:4098", "oc-project-1", first.id)).toMatchObject({
      status: "mapped",
      ingeniumProjectId: first.id,
    });
    try {
      mapOpenCodeProject("http://opencode.test:4098", "oc-project-1", second.id);
      throw new Error("Expected mapping ownership conflict");
    } catch (error) {
      expect(error).toMatchObject({ code: "MAPPING_OWNED_BY_OTHER_PROJECT" });
    }

    saveUsageSyncState({
      sourceInstance: "http://opencode.test:4098",
      projectId: second.id,
      cursorUpdatedAt: null,
      cursorSessionId: null,
      cursorPartId: null,
      lastSyncStartedAt: "2026-01-01T00:00:00.000Z",
      lastSyncCompletedAt: "2026-01-01T00:00:01.000Z",
      lastSuccessfulSyncAt: "2026-01-01T00:00:01.000Z",
      lastErrorCode: null,
    });
    expect(getUsageSummary(second.id, {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-02T00:00:00.000Z",
    }).freshness).toEqual({
      latestEventAt: null,
      lastSyncCompletedAt: "2026-01-01T00:00:01.000Z",
      lastSuccessfulSyncAt: "2026-01-01T00:00:01.000Z",
    });
  });

  it("rejects invalid cost availability relationships through direct SQL", () => {
    const { first, db } = setup();
    const insert = db.prepare(
      `INSERT INTO usage_events (
        id, project_id, source_instance, source_part_id, source_session_id,
        source_message_id, source_project_id, provider_id, model_id, agent_id, status,
        occurred_at, total_tokens, input_tokens, output_tokens, reasoning_tokens,
        cache_read_tokens, cache_write_tokens, cost_amount, cost_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertDirect = (
      id: string,
      costStatus: "known" | "partial" | "unavailable",
      costAmount: number | null,
    ) => insert.run(
      id,
      first.id,
      "http://opencode.test:4098",
      `direct-${id}`,
      "ses-direct",
      `msg-${id}`,
      "oc-project-direct",
      null,
      null,
      null,
      "success",
      "2026-01-01T00:00:00.000Z",
      null,
      null,
      null,
      null,
      null,
      null,
      costAmount,
      costStatus,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );

    expect(() => insertDirect("known-missing", "known", null)).toThrow(/CHECK constraint failed/);
    expect(() => insertDirect("known-negative", "known", -0.01)).toThrow(/CHECK constraint failed/);
    expect(() => insertDirect("partial-valued", "partial", 0)).toThrow(/CHECK constraint failed/);
    expect(() => insertDirect("unavailable-valued", "unavailable", 0.01)).toThrow(/CHECK constraint failed/);

    expect(() => insertDirect("known-zero", "known", 0)).not.toThrow();
    expect(() => insertDirect("partial-empty", "partial", null)).not.toThrow();
    expect(() => insertDirect("unavailable-empty", "unavailable", null)).not.toThrow();
  });

  it("upserts by source instance and part while preserving unknown cost/cache semantics and UTC aggregates", () => {
    const { first, second } = setup();
    const firstEvent = upsertUsageEvent(event(first.id, "part-1", "2026-01-01T23:59:59.000Z"));
    upsertUsageEvent(event(first.id, "part-2", "2026-01-02T00:00:00.000Z", {
      totalTokens: null,
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      costAmount: null,
      costStatus: "partial",
    }));
    upsertUsageEvent(event(second.id, "part-3", "2026-01-01T12:00:00.000Z", { costAmount: 9 }));

    const replayed = upsertUsageEvent(event(first.id, "part-1", "2026-01-01T23:59:59.000Z", {
      costAmount: 0.2,
    }));
    expect(replayed.id).toBe(firstEvent.id);

    const summary = getUsageSummary(first.id, {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-03T00:00:00.000Z",
    });
    expect(summary.range).toEqual({ from: "2026-01-01T00:00:00.000Z", to: "2026-01-03T00:00:00.000Z" });
    expect(summary.totals.requests).toBe(2);
    expect(summary.totals.cost).toEqual({ value: 0.2, availability: "partial" });
    expect(summary.totals.cache.read).toEqual({ value: 3, availability: "partial" });
    expect(summary.totals.cache.write).toEqual({ value: 1, availability: "partial" });
    expect(summary.totals.tokens.reasoning).toEqual({ value: 2, availability: "partial" });
    expect(summary.daily.map((row) => [row.day, row.requests])).toEqual([
      ["2026-01-01", 1],
      ["2026-01-02", 1],
    ]);

    const breakdown = getUsageBreakdown(first.id, {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-03T00:00:00.000Z",
    });
    expect(breakdown).toMatchObject([{
      providerId: "Provider/Raw-ID",
      modelId: "Model/Raw-ID",
      agentId: "agent-main",
      requests: 2,
    }]);

    const pageOne = listUsageEvents(first.id, {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-03T00:00:00.000Z",
    }, { limit: 1 });
    expect(pageOne).toMatchObject({ total: 2, hasMore: true });
    expect(pageOne.data[0]?.projectId).toBe(first.id);
    const pageTwo = listUsageEvents(first.id, {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-03T00:00:00.000Z",
    }, { limit: 1, cursor: pageOne.nextCursor! });
    expect(pageTwo.data).toHaveLength(1);
    expect(() => listUsageEvents(first.id, {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-03T00:00:00.000Z",
    }, { cursor: "not-a-cursor" })).toThrow(UsageError);
  });

  it("preserves raw cross-provider identities, cache availability, agent filters, UTC boundaries, and export continuation", () => {
    const { first } = setup();
    const from = "2026-04-01T00:00:00.000Z";
    const to = "2026-04-02T00:00:00.000Z";
    upsertUsageEvent(event(first.id, "part-at-from", from, {
      providerId: "Provider/A",
      modelId: "model:alpha",
      agentId: "agent-alpha",
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costAmount: 0,
      costStatus: "known",
    }));
    upsertUsageEvent(event(first.id, "part-mid", "2026-04-01T12:00:00.000Z", {
      providerId: "Provider B",
      modelId: "model/beta",
      agentId: null,
      reasoningTokens: 6,
      cacheReadTokens: 2,
      cacheWriteTokens: null,
      costAmount: null,
      costStatus: "partial",
    }));
    upsertUsageEvent(event(first.id, "part-unknown", "2026-04-01T18:00:00.000Z", {
      providerId: "Provider B",
      modelId: "model/gamma",
      agentId: "agent-gamma",
      reasoningTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      costAmount: null,
      costStatus: "unavailable",
    }));
    upsertUsageEvent(event(first.id, "part-at-to", to, {
      providerId: "Provider/Outside",
      modelId: "model/outside",
      agentId: "agent-outside",
    }));

    const query = { from, to };
    const summary = getUsageSummary(first.id, query);
    expect(summary.totals.requests).toBe(3);
    expect(summary.totals.tokens.reasoning).toEqual({ value: 6, availability: "partial" });
    expect(summary.totals.cache.read).toEqual({ value: 2, availability: "partial" });
    expect(summary.totals.cache.write).toEqual({ value: 0, availability: "partial" });
    expect(summary.daily).toMatchObject([{
      day: "2026-04-01",
      requests: 3,
      tokens: { reasoning: { value: 6, availability: "partial" } },
    }]);

    expect(getUsageBreakdown(first.id, query)).toMatchObject([
      { providerId: "Provider B", modelId: "model/beta", agentId: null, requests: 1 },
      { providerId: "Provider B", modelId: "model/gamma", agentId: "agent-gamma", requests: 1 },
      { providerId: "Provider/A", modelId: "model:alpha", agentId: "agent-alpha", requests: 1 },
    ]);
    expect(getUsageSummary(first.id, { ...query, agentIds: ["agent-alpha"] }).totals).toMatchObject({
      requests: 1,
      tokens: { reasoning: { value: 0, availability: "known" } },
      cache: {
        read: { value: 0, availability: "known" },
        write: { value: 0, availability: "known" },
      },
    });
    expect(getUsageSummary(first.id, { ...query, agentIds: ["agent-gamma"] }).totals.cache).toEqual({
      read: { value: null, availability: "unavailable" },
      write: { value: null, availability: "unavailable" },
    });

    const firstPage = getUsageExportPage(first.id, query, { limit: 1 });
    const secondPage = getUsageExportPage(first.id, query, { limit: 1, cursor: firstPage.nextCursor! });
    const thirdPage = getUsageExportPage(first.id, query, { limit: 1, cursor: secondPage.nextCursor! });
    expect([firstPage, secondPage, thirdPage].flatMap((page) => page.data.map((row) => row.sourcePartId)))
      .toEqual(["part-at-from", "part-mid", "part-unknown"]);
    expect(thirdPage).toMatchObject({ hasMore: false, nextCursor: null, total: 3 });
  });
});
