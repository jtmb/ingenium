import { afterEach, describe, expect, it, vi } from "vitest";
import { api, normalizeUsageAttentionItem, usageQueryParams } from "../src/lib/api";
import { installDashboardFetchMock } from "./dashboard-fetch-fixture";

const timestamp = "2026-04-02T10:00:00.000Z";
const thresholds = {
  requestCount: 2,
  totalTokens: 30,
  reportedCostAmount: 0.42,
  cacheReadTokens: 0,
  cacheWriteTokens: 1,
  revision: 4,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const attention = {
  id: "attention-1",
  metric: "request_count",
  status: "active",
  evaluationState: "above",
  severity: "critical",
  observed: 3,
  threshold: 2,
  availability: "known",
  freshness: "fresh",
  thresholdRevision: 4,
  openedAt: timestamp,
  acknowledgedAt: null,
  resolvedAt: null,
  reopenedAt: null,
  reopenCount: 0,
  lastEvaluatedAt: timestamp,
  revision: 2,
  updatedAt: timestamp,
};

const evaluation = {
  range: { from: "2026-04-01T00:00:00.000Z", to: "2026-04-03T00:00:00.000Z" },
  generatedAt: timestamp,
  thresholds,
  metrics: {
    requestCount: { observed: 3, threshold: 2, availability: "known", state: "above" },
    totalTokens: { observed: 30, threshold: 20, availability: "known", state: "above" },
    reportedCostAmount: { observed: 0.42, threshold: 1, availability: "partial", state: "unknown" },
    cacheReadTokens: { observed: null, threshold: 1, availability: "unavailable", state: "unknown" },
    cacheWriteTokens: { observed: 1, threshold: 1, availability: "known", state: "equal" },
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("usage API client query serialization", () => {
  it("preserves raw provider, model, agent, and status filters in repeated query parameters", () => {
    const params = usageQueryParams("external project", {
      from: "2026-04-01T00:00:00.000Z",
      to: "2026-04-02T00:00:00.000Z",
      providerIds: ["=raw/provider", "Provider Exact"],
      modelIds: ["model:alpha"],
      agentIds: ["agent/exact"],
      statuses: ["partial", "error"],
    }, { limit: 100 });

    expect(params.get("project")).toBe("external project");
    expect(params.getAll("provider")).toEqual(["=raw/provider", "Provider Exact"]);
    expect(params.getAll("model")).toEqual(["model:alpha"]);
    expect(params.getAll("agent")).toEqual(["agent/exact"]);
    expect(params.getAll("status")).toEqual(["partial", "error"]);
    expect(params.get("limit")).toBe("100");
  });

  it("uses encoded, bounded advisory requests with a bodyless evaluation and CAS acknowledgement", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const path = new URL(input, "http://fixture.test").pathname;
      const body = path.endsWith("/thresholds/evaluate") ? { data: evaluation }
        : path.endsWith("/attention/evaluate") ? { data: { evaluatedAt: timestamp, items: [{ ...attention, payload: "must-not-survive" }] } }
          : path.endsWith("/acknowledge") ? { data: attention }
            : path.endsWith("/attention") ? { data: [{ ...attention, source: "must-not-survive", prompt: "must-not-survive" }], pagination: { nextCursor: null, hasMore: false, total: 1 } }
              : { data: { ...thresholds, currency: "must-not-survive", enforcement: true } };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    installDashboardFetchMock(fetchMock);

    await api.usage.thresholds.get("fixture project");
    await api.usage.thresholds.replace({ ...thresholds, expectedRevision: 4 }, "fixture project");
    const selected = await api.usage.thresholds.evaluate({ from: evaluation.range.from, to: evaluation.range.to }, "fixture project");
    const page = await api.usage.attention.list({ includeResolved: true, limit: 50, cursor: "page-one" }, "fixture project");
    await api.usage.attention.evaluate("fixture project");
    await api.usage.attention.acknowledge(attention.id, attention.revision, "fixture project");

    expect(selected.data.metrics.reportedCostAmount.state).toBe("unknown");
    expect(JSON.stringify(page)).not.toContain("must-not-survive");
    expect(JSON.stringify(page)).not.toContain("source");
    const calls = fetchMock.mock.calls;
    expect(calls[0]?.[0]).toBe("/api/v1/usage/thresholds?project=fixture+project");
    expect(calls[1]?.[1]).toMatchObject({ method: "PUT", body: JSON.stringify({
      expected_revision: 4,
      request_count: 2,
      total_tokens: 30,
      reported_cost_amount: 0.42,
      cache_read_tokens: 0,
      cache_write_tokens: 1,
    }) });
    expect(calls[3]?.[0]).toContain("include_resolved=true&limit=50&cursor=page-one");
    expect(calls[4]?.[1]).toMatchObject({ method: "POST" });
    expect(calls[4]?.[1]?.body).toBeUndefined();
    expect(calls[5]?.[0]).toContain(`/attention/${attention.id}/acknowledge?project=fixture+project`);
    expect(calls[5]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({ expected_revision: 2 }) });
  });

  it("rejects malformed advisory values, cursors, limits, enums, and timestamps before state", async () => {
    expect(() => api.usage.attention.list({ limit: 101 }, "fixture-project")).toThrow("limit");
    expect(() => api.usage.attention.list({ cursor: "x".repeat(513) }, "fixture-project")).toThrow("cursor");
    expect(() => usageQueryParams("fixture-project", { from: "2026-02-31T00:00:00.000Z", to: evaluation.range.to })).toThrow("timestamp");
    expect(() => normalizeUsageAttentionItem({ ...attention, severity: "urgent" })).toThrow("severity");
    expect(() => normalizeUsageAttentionItem({ ...attention, observed: Number.POSITIVE_INFINITY })).toThrow("observed");
    expect(() => normalizeUsageAttentionItem({ ...attention, openedAt: "2026-02-31T00:00:00.000Z" })).toThrow("timestamp");
  });
});
