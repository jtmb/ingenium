import { expect, test, type Page } from "@playwright/test";

const metric = (value: number | null, availability: "known" | "partial" | "unavailable" = value === null ? "unavailable" : "known") => ({ value, availability });

const summaryFixture = {
  range: { from: "2026-04-01T00:00:00.000Z", to: "2026-04-03T00:00:00.000Z" },
  totals: {
    requests: 2,
    tokens: { total: metric(30), input: metric(20), output: metric(10), reasoning: metric(6) },
    cache: { read: metric(null), write: metric(null) },
    cost: metric(0.42, "partial"),
  },
  daily: [{
    day: "2026-04-01",
    requests: 2,
    tokens: { total: metric(30), input: metric(20), output: metric(10), reasoning: metric(6) },
    cache: { read: metric(null), write: metric(null) },
    cost: metric(0.42, "partial"),
  }],
  freshness: {
    latestEventAt: "2026-04-02T10:00:00.000Z",
    lastSyncCompletedAt: "2026-04-02T10:01:00.000Z",
    lastSuccessfulSyncAt: "2026-04-02T10:01:00.000Z",
  },
};

const breakdownFixture = [{
  providerId: "Provider/Exact-ID",
  modelId: "Model/Exact-ID",
  agentId: "agent-alpha",
  requests: 2,
  tokens: { total: metric(30), input: metric(20), output: metric(10), reasoning: metric(6) },
  cache: { read: metric(null), write: metric(null) },
  cost: metric(0.42, "partial"),
}];

const eventsFixture = {
  data: [{
    id: "usage-event-1",
    sourceInstance: "fixture",
    sourcePartId: "part-1",
    sourceSessionId: "session-1",
    sourceMessageId: "message-1",
    sourceProjectId: "fixture-project",
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

async function mockUsageData(page: Page, requests: URL[] = [], options: { truncatedExport?: boolean } = {}): Promise<void> {
  await page.route("**/api/v1/usage/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (url.pathname.endsWith("/summary")) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: summaryFixture }) });
      return;
    }
    if (url.pathname.endsWith("/breakdown")) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: breakdownFixture }) });
      return;
    }
    if (url.pathname.endsWith("/events")) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(eventsFixture) });
      return;
    }
    if (url.pathname.endsWith("/export")) {
      const continuation = url.searchParams.get("cursor");
      const truncated = options.truncatedExport && continuation === null;
      await route.fulfill({
        contentType: "text/csv; charset=utf-8",
        headers: {
          "Content-Disposition": "attachment; filename=ingenium-usage.csv",
          "X-Export-Truncated": String(truncated),
          ...(truncated ? { "X-Export-Next-Cursor": "fixture-next-cursor" } : {}),
        },
        body: `id,occurred_at\n${continuation ? "usage-event-2" : "usage-event-1"},2026-04-02T10:00:00.000Z\n`,
      });
      return;
    }
    await route.fallback();
  });
}

test.describe("Usage dashboard", () => {
  test("uses the fixture API and renders its actionable empty state", async ({ page }) => {
    const summaryResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/usage/summary" && response.status() === 200);
    await page.goto("/usage", { waitUntil: "domcontentloaded" });
    await summaryResponse;

    await expect(page.getByRole("heading", { name: "Usage analytics" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Usage", exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("usage-empty-state")).toContainText("No usage events in this UTC range");
    await expect(page.getByLabel("Agent")).toBeDisabled();
  });

  test("preserves raw cross-provider identifiers, unavailable cache, filters, and CSV export", async ({ page }) => {
    const requests: URL[] = [];
    await mockUsageData(page, requests);
    await page.goto("/usage", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("usage-metric-cost")).toContainText("Partial");
    await expect(page.getByTestId("usage-metric-cache-read")).toContainText("Unavailable");
    await expect(page.getByTestId("usage-metric-reasoning")).toContainText("6");
    await expect(page.getByTestId("usage-breakdown-table")).toContainText("Provider/Exact-ID");
    await expect(page.getByTestId("usage-events-table")).toContainText("Model/Exact-ID");
    await expect(page.getByTestId("usage-events-table")).toContainText("agent-alpha");
    await expect(page.getByTestId("usage-events-table")).toContainText("Unavailable (Partial)");
    await expect(page.getByTestId("usage-request-trend")).toHaveAttribute("role", "img");
    await expect(page.getByTestId("usage-daily-table")).toBeVisible();

    const filters = page.getByTestId("usage-filters");
    await filters.getByLabel("Provider").selectOption("Provider/Exact-ID");
    await filters.getByLabel("Model").selectOption("Model/Exact-ID");
    await filters.getByLabel("Agent").selectOption("agent-alpha");
    await filters.getByLabel("Status").selectOption("partial");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect.poll(() => requests.some((url) =>
      url.pathname.endsWith("/summary")
       && url.searchParams.get("provider") === "Provider/Exact-ID"
       && url.searchParams.get("model") === "Model/Exact-ID"
       && url.searchParams.get("agent") === "agent-alpha"
       && url.searchParams.get("status") === "partial",
    )).toBe(true);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const completedDownload = await download;
    expect(completedDownload.suggestedFilename()).toBe("ingenium-usage.csv");
    await expect(page.getByRole("status")).toContainText("CSV downloaded.");
  });

  test("sends exact UTC boundaries and marks the To control as exclusive", async ({ page }) => {
    const requests: URL[] = [];
    await mockUsageData(page, requests);
    await page.goto("/usage", { waitUntil: "domcontentloaded" });

    const filters = page.getByTestId("usage-filters");
    await filters.getByLabel("From (UTC, inclusive)").fill("2026-04-03T08:45");
    await filters.getByLabel("To (UTC, exclusive)").fill("2026-04-04T08:45");
    await page.getByRole("button", { name: "Apply filters" }).click();

    await expect.poll(() => requests.some((url) =>
      url.pathname.endsWith("/summary")
      && url.searchParams.get("from") === "2026-04-03T08:45:00.000Z"
      && url.searchParams.get("to") === "2026-04-04T08:45:00.000Z",
    )).toBe(true);
    await expect(page.getByTestId("usage-range-label")).toContainText("exclusive");
  });

  test("continues a truncated CSV export using the API cursor", async ({ page }) => {
    const requests: URL[] = [];
    await mockUsageData(page, requests, { truncatedExport: true });
    await page.goto("/usage", { waitUntil: "domcontentloaded" });

    const firstDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    await firstDownload;
    await expect(page.getByRole("status")).toContainText("More rows are available");

    const continuationDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download next CSV page" }).click();
    await continuationDownload;
    await expect.poll(() => requests.some((url) =>
      url.pathname.endsWith("/export") && url.searchParams.get("cursor") === "fixture-next-cursor",
    )).toBe(true);
    await expect(page.getByRole("button", { name: "Download next CSV page" })).toHaveCount(0);
  });

  test("keeps the loading state visible while the summary request is pending", async ({ page }) => {
    let releaseSummary: (() => void) | undefined;
    const summaryGate = new Promise<void>((resolve) => { releaseSummary = resolve; });
    await page.route("**/api/v1/usage/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/summary")) {
        await summaryGate;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: summaryFixture }) });
        return;
      }
      if (path.endsWith("/breakdown")) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: breakdownFixture }) });
        return;
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(eventsFixture) });
    });

    const navigation = page.goto("/usage", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("usage-loading-state").first()).toBeVisible();
    releaseSummary?.();
    await navigation;
    await expect(page.getByTestId("usage-breakdown-table")).toBeVisible();
  });

  test("shows an actionable API error without exposing implementation details", async ({ page }) => {
    await page.route("**/api/v1/usage/**", (route) => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Usage data is temporarily unavailable." } }),
    }));
    await page.goto("/usage", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("usage-error-state")).toContainText("Usage data is temporarily unavailable.");
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("keeps analytical controls and accessible data alternatives usable on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockUsageData(page);
    await page.goto("/usage", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Usage analytics" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Requests by UTC day" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Usage metrics by UTC day" })).toBeVisible();
    await expect(page.getByLabel("From (UTC, inclusive)")).toBeVisible();
    await expect(page.getByLabel("To (UTC, exclusive)")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
