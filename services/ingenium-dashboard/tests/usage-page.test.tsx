import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError, type UsageBreakdownRow, type UsageEventsPage, type UsageSummary } from "../src/lib/api";

const mocks = vi.hoisted(() => ({
  project: "usage-project",
  summary: vi.fn(),
  breakdown: vi.fn(),
  events: vi.fn(),
  thresholdsGet: vi.fn(),
  thresholdsReplace: vi.fn(),
  thresholdsEvaluate: vi.fn(),
  attentionList: vi.fn(),
  attentionEvaluate: vi.fn(),
  attentionAcknowledge: vi.fn(),
  exportUrl: vi.fn((_query, _project, options?: { cursor?: string }) => options?.cursor
    ? `/api/v1/usage/export?project=usage-project&cursor=${encodeURIComponent(options.cursor)}`
    : "/api/v1/usage/export?project=usage-project"),
  dashboardFetch: vi.fn(),
}));

vi.mock("../src/lib/ProjectContext", () => ({ useProject: () => mocks.project }));
vi.mock("../src/lib/api", () => ({
  ApiError: class ApiError extends Error { constructor(public status: number, message: string, public retryAfterSeconds: number | null) { super(message); } },
  api: { usage: {
    summary: mocks.summary,
    breakdown: mocks.breakdown,
    events: mocks.events,
    exportUrl: mocks.exportUrl,
    thresholds: { get: mocks.thresholdsGet, replace: mocks.thresholdsReplace, evaluate: mocks.thresholdsEvaluate },
    attention: { list: mocks.attentionList, evaluate: mocks.attentionEvaluate, acknowledge: mocks.attentionAcknowledge },
  } },
  dashboardFetch: mocks.dashboardFetch,
}));

import UsagePage from "../src/app/usage/page";

const unavailable = { value: null, availability: "unavailable" as const };
const known = (value: number) => ({ value, availability: "known" as const });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function summary(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    range: { from: "2026-04-01T00:00:00.000Z", to: "2026-04-03T00:00:00.000Z" },
    totals: {
      requests: 2,
      tokens: { total: known(30), input: known(20), output: known(10), reasoning: known(6) },
      cache: { read: unavailable, write: unavailable },
      cost: { value: 0.42, availability: "partial" },
    },
    daily: [{
      day: "2026-04-01",
      requests: 2,
      tokens: { total: known(30), input: known(20), output: known(10), reasoning: known(6) },
      cache: { read: unavailable, write: unavailable },
      cost: { value: 0.42, availability: "partial" },
    }],
    freshness: {
      latestEventAt: "2026-04-02T10:00:00.000Z",
      lastSyncCompletedAt: "2026-04-02T10:01:00.000Z",
      lastSuccessfulSyncAt: "2026-04-02T10:01:00.000Z",
    },
    ...overrides,
  };
}

const breakdown: UsageBreakdownRow[] = [{
  providerId: "Provider/Exact-ID",
  modelId: "Model/Exact-ID",
  agentId: "agent-alpha",
  requests: 2,
  tokens: { total: known(30), input: known(20), output: known(10), reasoning: known(6) },
  cache: { read: unavailable, write: unavailable },
  cost: { value: 0.42, availability: "partial" },
}];

const events: UsageEventsPage = {
  data: [{
    id: "evt-1",
    sourceInstance: "fixture",
    sourcePartId: "part-1",
    sourceSessionId: "session-1",
    sourceMessageId: "message-1",
    sourceProjectId: "source-project",
    providerId: "Provider/Exact-ID",
    modelId: "Model/Exact-ID",
    agentId: "agent-alpha",
    status: "success",
    occurredAt: "2026-04-02T10:00:00.000Z",
    tokens: { total: 30, input: 20, output: 10, reasoning: 6 },
    cache: { read: null, write: null },
    cost: { amount: null, availability: "partial" },
    createdAt: "2026-04-02T10:00:00.000Z",
    updatedAt: "2026-04-02T10:00:00.000Z",
  }],
  pagination: { nextCursor: null, hasMore: false, total: 1 },
};

const thresholds = {
  requestCount: null,
  totalTokens: null,
  reportedCostAmount: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  revision: 1,
  createdAt: "2026-04-02T10:00:00.000Z",
  updatedAt: "2026-04-02T10:00:00.000Z",
};

const evaluation = {
  range: { from: "2026-04-01T00:00:00.000Z", to: "2026-04-03T00:00:00.000Z" },
  generatedAt: "2026-04-02T10:00:00.000Z",
  thresholds,
  metrics: {
    requestCount: { observed: 2, threshold: null, availability: "known" as const, state: "disabled" as const },
    totalTokens: { observed: 30, threshold: null, availability: "known" as const, state: "disabled" as const },
    reportedCostAmount: { observed: 0.42, threshold: null, availability: "partial" as const, state: "disabled" as const },
    cacheReadTokens: { observed: null, threshold: null, availability: "unavailable" as const, state: "disabled" as const },
    cacheWriteTokens: { observed: null, threshold: null, availability: "unavailable" as const, state: "disabled" as const },
  },
};

beforeEach(() => {
  mocks.project = "usage-project";
  mocks.summary.mockReset().mockResolvedValue({ data: summary() });
  mocks.breakdown.mockReset().mockResolvedValue({ data: breakdown });
  mocks.events.mockReset().mockResolvedValue(events);
  mocks.thresholdsGet.mockReset().mockResolvedValue({ data: thresholds });
  mocks.thresholdsReplace.mockReset().mockResolvedValue({ data: { ...thresholds, revision: 2 } });
  mocks.thresholdsEvaluate.mockReset().mockResolvedValue({ data: evaluation });
  mocks.attentionList.mockReset().mockResolvedValue({ data: [], pagination: { nextCursor: null, hasMore: false, total: 0 } });
  mocks.attentionEvaluate.mockReset().mockResolvedValue({ evaluatedAt: "2026-04-02T10:00:00.000Z" });
  mocks.attentionAcknowledge.mockReset();
  mocks.exportUrl.mockClear();
  mocks.dashboardFetch.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UsagePage", () => {
  it("renders known reasoning and reported agent attribution while keeping omitted cache unavailable", async () => {
    render(<UsagePage />);

    expect(await screen.findByRole("heading", { name: "Usage analytics" })).toBeTruthy();
    expect(screen.getByTestId("usage-metric-requests").textContent).toContain("2");
    expect(screen.getByTestId("usage-metric-cost").textContent).toContain("Partial");
    expect(screen.getByTestId("usage-metric-cache-read").textContent).toContain("Unavailable");
    expect(screen.getByTestId("usage-metric-cache-write").textContent).toContain("Unavailable");
    expect(screen.getByTestId("usage-metric-reasoning").textContent).toContain("6");
    expect(screen.getByTestId("usage-metric-reasoning").textContent).toContain("Known");
    expect(screen.getByRole("option", { name: "Provider/Exact-ID" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Model/Exact-ID" })).toBeTruthy();
    expect((screen.getByLabelText("Agent") as HTMLSelectElement).disabled).toBe(false);
    expect(screen.getByRole("option", { name: "agent-alpha" })).toBeTruthy();
    expect(screen.getByTestId("usage-daily-table").textContent).toContain("0.42 (Partial)");
    expect(screen.getByTestId("usage-breakdown-table").textContent).toContain("0.42 (Partial)");
    expect(screen.getByTestId("usage-events-table").textContent).toContain("Unavailable (Partial)");
  });

  it("passes raw provider, model, agent, and status filters to the API when filters are applied", async () => {
    render(<UsagePage />);
    await screen.findByRole("heading", { name: "Usage analytics" });

    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "Provider/Exact-ID" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "Model/Exact-ID" } });
    fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "agent-alpha" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "partial" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => expect(mocks.summary).toHaveBeenLastCalledWith(expect.objectContaining({
      providerIds: ["Provider/Exact-ID"],
      modelIds: ["Model/Exact-ID"],
      agentIds: ["agent-alpha"],
      statuses: ["partial"],
    }), "usage-project"));
  });

  it("keeps known-zero cache reads distinct from reported writes and unavailable counters", async () => {
    mocks.summary.mockResolvedValueOnce({ data: summary({
      totals: {
        ...summary().totals,
        cache: { read: known(0), write: known(7) },
      },
    }) });

    render(<UsagePage />);

    expect((await screen.findByTestId("usage-metric-cache-read")).textContent).toContain("0");
    expect(screen.getByTestId("usage-metric-cache-read").textContent).toContain("Known");
    expect(screen.getByTestId("usage-metric-cache-write").textContent).toContain("7");
    expect(screen.getByTestId("usage-metric-cache-write").textContent).toContain("Known");
  });

  it("keeps agent filtering unavailable when the API provides no attribution", async () => {
    mocks.breakdown.mockResolvedValueOnce({ data: [{ ...breakdown[0], agentId: null }] });
    mocks.events.mockResolvedValueOnce({ data: [{ ...events.data[0], agentId: null }], pagination: events.pagination });
    render(<UsagePage />);

    await screen.findByRole("heading", { name: "Usage analytics" });
    expect((screen.getByLabelText("Agent") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText(/Agent attribution was not reported/i)).toBeTruthy();
  });

  it("sends exact inclusive-from and exclusive-to UTC bounds to every usage endpoint", async () => {
    render(<UsagePage />);
    await screen.findByRole("heading", { name: "Usage analytics" });

    fireEvent.change(screen.getByLabelText("From (UTC, inclusive)"), { target: { value: "2026-04-03T08:45" } });
    fireEvent.change(screen.getByLabelText("To (UTC, exclusive)"), { target: { value: "2026-04-04T08:45" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    const exactBounds = {
      from: "2026-04-03T08:45:00.000Z",
      to: "2026-04-04T08:45:00.000Z",
    };
    await waitFor(() => {
      expect(mocks.summary).toHaveBeenLastCalledWith(expect.objectContaining(exactBounds), "usage-project");
      expect(mocks.breakdown).toHaveBeenLastCalledWith(expect.objectContaining(exactBounds), "usage-project");
      expect(mocks.events).toHaveBeenLastCalledWith(expect.objectContaining(exactBounds), "usage-project", { limit: 100 });
    });
    expect(screen.getByTestId("usage-range-label").textContent).toContain("exclusive");
  });

  it("renders actionable empty, error, and stale telemetry states", async () => {
    mocks.summary.mockResolvedValueOnce({ data: summary({
      totals: { ...summary().totals, requests: 0 },
      freshness: { latestEventAt: null, lastSyncCompletedAt: "2020-01-01T00:00:00.000Z", lastSuccessfulSyncAt: "2020-01-01T00:00:00.000Z" },
    }) });
    mocks.breakdown.mockResolvedValueOnce({ data: [] });
    mocks.events.mockResolvedValueOnce({ data: [], pagination: { nextCursor: null, hasMore: false, total: 0 } });
    render(<UsagePage />);

    expect((await screen.findByTestId("usage-empty-state")).textContent).toContain("No usage events in this UTC range");
    expect(screen.getByTestId("usage-freshness-state").textContent).toContain("Stale telemetry");
    cleanup();

    mocks.summary.mockRejectedValueOnce(new Error("Usage data is temporarily unavailable."));
    render(<UsagePage />);
    expect((await screen.findByTestId("usage-error-state")).textContent).toContain("Usage data is temporarily unavailable.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("keeps a 429 banner until the newest retry succeeds", async () => {
    const retry = deferred<{ data: UsageSummary }>();
    mocks.summary
      .mockRejectedValueOnce(new Error("Too many requests. Please wait before retrying."))
      .mockImplementationOnce(() => retry.promise);
    render(<UsagePage />);

    const errorState = await screen.findByTestId("usage-error-state");
    expect(errorState.textContent).toContain("Too many requests");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByTestId("usage-error-state").textContent).toContain("Too many requests");

    retry.resolve({ data: summary() });
    await waitFor(() => expect(screen.queryByTestId("usage-error-state")).toBeNull());
    expect(screen.getByTestId("usage-metric-requests").textContent).toContain("2");
  });

  it("keeps an advisory error until its reload succeeds", async () => {
    const reload = deferred<{ data: typeof thresholds }>();
    mocks.thresholdsGet
      .mockRejectedValueOnce(new ApiError(429, "Advisory threshold rate limit", 1))
      .mockImplementationOnce(() => reload.promise);
    render(<UsagePage />);

    expect(await screen.findByText("Advisory threshold rate limit")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(screen.getByText("Advisory threshold rate limit")).toBeTruthy();

    reload.resolve({ data: thresholds });
    await waitFor(() => expect(screen.queryByText("Advisory threshold rate limit")).toBeNull());
  });

  it("ignores an older failed refresh after a newer refresh succeeds", async () => {
    const stale = deferred<{ data: UsageSummary }>();
    mocks.summary
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce({ data: summary({ totals: { ...summary().totals, requests: 7 } }) });
    const { rerender } = render(<UsagePage />);

    await waitFor(() => expect(mocks.summary).toHaveBeenCalledTimes(1));
    mocks.project = "usage-project-new";
    rerender(<UsagePage />);
    await waitFor(() => expect(screen.getByTestId("usage-metric-requests").textContent).toContain("7"));

    stale.reject(new Error("stale rate limit"));
    await waitFor(() => expect(screen.queryByRole("alert", { name: /unable to load usage analytics/i })).toBeNull());
    expect(screen.queryByText("stale rate limit")).toBeNull();
    expect(screen.getByTestId("usage-metric-requests").textContent).toContain("7");
  });

  it("downloads CSV through the authenticated dashboard fetch path", async () => {
    const createObjectUrl = vi.fn(() => "blob:usage-export");
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl });
    mocks.dashboardFetch.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["id,occurred_at\nevt-1,2026-04-02\n"], { type: "text/csv" }),
      headers: new Headers({ "X-Export-Truncated": "false" }),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<UsagePage />);
    await screen.findByRole("heading", { name: "Usage analytics" });
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    expect((await screen.findByRole("status")).textContent).toContain("CSV downloaded.");
    expect(mocks.dashboardFetch).toHaveBeenCalledWith("/api/v1/usage/export?project=usage-project");
    expect(createObjectUrl).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:usage-export");
    click.mockRestore();
  });

  it("offers the API cursor continuation when an export is truncated", async () => {
    const createObjectUrl = vi.fn(() => "blob:usage-export");
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl });
    mocks.dashboardFetch
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(["id\npage-one\n"], { type: "text/csv" }),
        headers: new Headers({ "X-Export-Truncated": "true", "X-Export-Next-Cursor": "next-page-cursor" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(["id\npage-two\n"], { type: "text/csv" }),
        headers: new Headers({ "X-Export-Truncated": "false" }),
      });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<UsagePage />);
    await screen.findByRole("heading", { name: "Usage analytics" });
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    expect((await screen.findByRole("status")).textContent).toContain("More rows are available");
    fireEvent.click(screen.getByRole("button", { name: "Download next CSV page" }));

    await waitFor(() => expect(mocks.dashboardFetch).toHaveBeenLastCalledWith(
      "/api/v1/usage/export?project=usage-project&cursor=next-page-cursor",
    ));
    expect(mocks.exportUrl).toHaveBeenLastCalledWith(expect.anything(), "usage-project", { cursor: "next-page-cursor" });
    expect(screen.queryByRole("button", { name: "Download next CSV page" })).toBeNull();
    click.mockRestore();
  });

  it("saves a full advisory replacement and refreshes only the selected-range evaluation", async () => {
    render(<UsagePage />);
    await screen.findByRole("heading", { name: "Usage analytics" });
    await screen.findByRole("heading", { name: "Usage advisories" });

    fireEvent.change(screen.getByLabelText("Requests"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Reported cost amount"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save thresholds" }));

    await waitFor(() => expect(mocks.thresholdsReplace).toHaveBeenCalledWith({
      expectedRevision: 1,
      requestCount: 7,
      totalTokens: null,
      reportedCostAmount: 0.5,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    }, "usage-project"));
    expect(mocks.thresholdsEvaluate).toHaveBeenLastCalledWith(expect.objectContaining({
      from: expect.any(String),
      to: expect.any(String),
    }), "usage-project");
    expect(mocks.attentionList).toHaveBeenCalledTimes(1);
  });

  it("acknowledges all-history attention with CAS and retains event rows while paging", async () => {
    const activeAttention = {
      id: "attention-1",
      metric: "request_count" as const,
      status: "active" as const,
      evaluationState: "above" as const,
      severity: "critical" as const,
      observed: 3,
      threshold: 2,
      availability: "known" as const,
      freshness: "fresh" as const,
      thresholdRevision: 1,
      openedAt: "2026-04-02T10:00:00.000Z",
      acknowledgedAt: null,
      resolvedAt: null,
      reopenedAt: null,
      reopenCount: 0,
      lastEvaluatedAt: "2026-04-02T10:00:00.000Z",
      revision: 3,
      updatedAt: "2026-04-02T10:00:00.000Z",
    };
    mocks.attentionList.mockResolvedValue({ data: [activeAttention], pagination: { nextCursor: null, hasMore: false, total: 1 } });
    mocks.attentionAcknowledge.mockResolvedValue({ data: { ...activeAttention, acknowledgedAt: "2026-04-02T10:02:00.000Z", revision: 4 } });
    mocks.events.mockResolvedValueOnce({
      data: events.data,
      pagination: { nextCursor: "events-page-two", hasMore: true, total: 2 },
    }).mockResolvedValueOnce({
      data: [{ ...events.data[0], id: "evt-2", modelId: "Model/Page-two" }],
      pagination: { nextCursor: null, hasMore: false, total: 2 },
    });

    render(<UsagePage />);
    await screen.findByText("Above threshold — advisory/no enforcement");
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(mocks.attentionAcknowledge).toHaveBeenCalledWith("attention-1", 3, "usage-project"));
    expect(screen.queryByRole("button", { name: "Resolve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: "Load more events" }));
    await waitFor(() => expect(mocks.events).toHaveBeenLastCalledWith(expect.anything(), "usage-project", { limit: 100, cursor: "events-page-two" }));
    expect(screen.getByTestId("usage-events-table").textContent).toContain("Model/Page-two");
  });
});
