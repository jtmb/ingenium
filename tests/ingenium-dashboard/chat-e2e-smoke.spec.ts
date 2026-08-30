import { test, expect } from "./fixture";
import { getDefaultSuiteRuntime } from "./default-suite-runtime";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FIXTURE_OWNER_EMAIL,
  FIXTURE_OWNER_PASSWORD,
  FIXTURE_SESSION_COOKIE_NAME,
  resetTestRunChatFixture,
} from "../test-server-lifecycle";

const PIXEL_TOLERANCE = 1;

function expectWithinPixels(actual: number | undefined, expected: number, label: string): void {
  expect(actual, `${label} must be available`).toBeDefined();
  if (actual === undefined) return;
  expect(Math.abs(actual - expected), `${label} differs by more than ${PIXEL_TOLERANCE}px`).toBeLessThanOrEqual(
    PIXEL_TOLERANCE,
  );
}

test.describe("Chat — end-to-end smoke", () => {
  test("full send/receive cycle with fixture server", async ({ page }) => {
    // Full pipeline: browser → Next.js → API → fixture OpenCode → SSE → rendered response
    test.setTimeout(60000);

    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    // The fixture provider is promoted into the chat-config catalog.
    const providerSelect = page.locator('[data-testid="chat-header-provider"]');
    await expect(providerSelect).toBeEnabled({ timeout: 20000 });

    const modelSelect = page.locator('[data-testid="chat-header-model"]');
    await expect(modelSelect).toBeEnabled({ timeout: 15000 });

    const composer = page.locator('[data-testid="chat-composer"]');
    await expect(composer).toBeEnabled({ timeout: 15000 });

    await composer.fill("Hello from E2E test");
    await composer.press("Enter");

    await expect(composer).toHaveValue("", { timeout: 5000 });

    await expect(page.getByText("Hello from E2E test").first()).toBeVisible({ timeout: 5000 });

    // The fixture's SSE sequence must produce the assistant response.
    await expect(page.getByText("I've completed the analysis. The chat pipeline is working correctly.")).toBeVisible({ timeout: 30000 });

    await expect(page.locator('[data-testid="chat-stop-btn"]')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('[data-testid="chat-send-btn"]')).toBeVisible({ timeout: 5000 });
  });

  test("uses selected-project context only when explicitly requested", async ({ page }) => {
    test.setTimeout(60_000);
    const runtime = getDefaultSuiteRuntime();
    const sourceBody = "Blue comet reference body must stay out of chat.";
    const uploaded = await fetch(
      `${runtime.apiBase}/context/uploads?project=${encodeURIComponent(runtime.project)}`,
      {
        method: "POST",
        headers: { ...runtime.apiHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          title: "CHAT-100 fixture source",
          content: `## Fixture heading\n${sourceBody}`,
          mimeType: "text/markdown",
          sourceReference: "work-item:CHAT-100",
        }),
      },
    );
    expect(uploaded.status).toBe(201);
    const sourceSearchUrl = `${runtime.apiBase}/context/rag/search?project=${encodeURIComponent(runtime.project)}&q=blue%20comet`;
    const firstSearch = await fetch(sourceSearchUrl, { headers: runtime.apiHeaders });
    expect(firstSearch.status).toBe(200);
    const firstCitations = (await firstSearch.json()).data as Array<{
      citationId: string;
      sourceHash: string;
      chunkIndex: number;
      availability: string;
    }>;
    expect(firstCitations).toHaveLength(1);
    const citation = firstCitations[0]!;
    expect(citation).toMatchObject({
      citationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      chunkIndex: 0,
      availability: "available",
    });
    const repeatedSearch = await fetch(sourceSearchUrl, { headers: runtime.apiHeaders });
    expect((await repeatedSearch.json()).data.map((entry: { citationId: string }) => entry.citationId))
      .toEqual(firstCitations.map((entry) => entry.citationId));

    await page.goto(`/chat?project=${encodeURIComponent(runtime.project)}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="chat-header-provider"]')).toBeEnabled({ timeout: 20_000 });

    const composer = page.locator('[data-testid="chat-composer"]');
    const contextControl = page.locator('[data-testid="chat-use-project-context"]');
    await expect(composer).toBeEnabled({ timeout: 15_000 });
    await expect(contextControl).toHaveAttribute("aria-pressed", "false");
    await contextControl.click();
    await expect(contextControl).toHaveAttribute("aria-pressed", "true");
    await composer.fill("Which project context mentions blue comet?");

    const contextSearch = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/context/rag/search" && url.searchParams.get("project") === runtime.project;
    });
    await composer.press("Enter");
    expect((await contextSearch).status()).toBe(200);

    const grounding = page.locator('[data-testid="chat-project-context"]').last();
    await expect(grounding).toContainText("Project context: requested — 1 source used");
    await expect(grounding).toContainText("CHAT-100 fixture source");
    await expect(grounding).toContainText("Heading: Fixture heading");
    await expect(grounding).toContainText("Provenance: direct_upload");
    await expect(grounding).toContainText("Source: work-item:CHAT-100");
    await expect(grounding.locator('[data-testid="chat-context-citation-id"]')).toHaveText(citation.citationId);
    await expect(grounding).toContainText(`Source hash: ${citation.sourceHash}`);
    await expect(grounding).toContainText("Chunk index: 0 — Availability: available");
    await expect(page.getByText(sourceBody, { exact: true })).toHaveCount(0);
    await expect(contextControl).toHaveAttribute("aria-pressed", "false");
  });

  test("validates a persisted session before loading it and renders markdown on desktop and mobile", async ({ page }) => {
    test.setTimeout(60000);
    const staleSessionId = "ses_stale_persisted_session";
    const messageResponses: Array<{ sessionId: string; status: number }> = [];

    page.on("response", (response) => {
      const match = new URL(response.url()).pathname.match(
        /^\/api\/v1\/opencode\/sessions\/([^/]+)\/messages$/,
      );
      if (match) {
        messageResponses.push({ sessionId: match[1]!, status: response.status() });
      }
    });
    await page.addInitScript((sessionId) => {
      localStorage.setItem("opencode-chat-active-session", sessionId);
    }, staleSessionId);

    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="chat-header-provider"]')).toBeEnabled({ timeout: 20000 });
    const composer = page.locator('[data-testid="chat-composer"]');
    await expect(composer).toBeEnabled({ timeout: 15000 });

    await expect.poll(() => messageResponses.some(
      (response) => response.sessionId === "fixture-session-1" && response.status === 200,
    )).toBe(true);
    expect(messageResponses).toEqual([{ sessionId: "fixture-session-1", status: 200 }]);

    await composer.fill("Show the fixture markdown");
    await composer.press("Enter");
    const markdownCallout = page.locator('[data-testid="chat-assistant-message"] .chat-markdown .callout');
    await expect(markdownCallout).toContainText("This callout remains plain provider output.", { timeout: 30000 });
    await markdownCallout.scrollIntoViewIfNeeded();
    await expect(markdownCallout).toBeInViewport();

    await expect(page.locator('[data-testid="chat-stop-btn"]')).toBeHidden({ timeout: 10000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(markdownCallout).toBeVisible();
    await expect(markdownCallout).toBeInViewport();
  });

  test("authenticated chat survives a hard reload without duplicating its checkpoint", async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    if (!baseURL) throw new Error("Fixture dashboard URL is unavailable");

    const runtime = getDefaultSuiteRuntime();
    await resetTestRunChatFixture(runtime.context);
    const context = await browser.newContext();
    const page = await context.newPage();
    const timeline: Array<Record<string, unknown>> = [];
    const cookieLabels = new Map<string, string>();
    const pendingCaptures: Promise<void>[] = [];
    let sequence = 0;
    let reloadStarted = false;

    const endpoint = (urlValue: string) => new URL(urlValue).pathname
      .replace(/\/context\/conversations\/[^/]+/, "/context/conversations/[conversation]")
      .replace(/\/opencode\/sessions\/[^/]+/, "/opencode/sessions/[session]");
    const cookieLabel = (value: string | undefined) => {
      if (!value) return null;
      const existing = cookieLabels.get(value);
      if (existing) return existing;
      const label = `session-${cookieLabels.size + 1}`;
      cookieLabels.set(value, label);
      return label;
    };
    const requestCookieLabel = async (request: import("@playwright/test").Request) => {
      const cookieHeader = (await request.allHeaders()).cookie;
      const token = cookieHeader?.split(";").map((part) => part.trim())
        .find((part) => part.startsWith(`${FIXTURE_SESSION_COOKIE_NAME}=`))
        ?.slice(FIXTURE_SESSION_COOKIE_NAME.length + 1);
      return cookieLabel(token);
    };
    const browserCookieLabel = async () => cookieLabel(
      (await context.cookies()).find(({ name }) => name === FIXTURE_SESSION_COOKIE_NAME)?.value,
    );
    const record = (event: Record<string, unknown>) => {
      timeline.push({ sequence: ++sequence, phase: reloadStarted ? "reload" : "initial", ...event });
    };
    page.on("request", (request) => {
      if (!new URL(request.url()).pathname.startsWith("/api/v1/")) return;
      pendingCaptures.push((async () => record({
        event: "request",
        method: request.method(),
        endpoint: endpoint(request.url()),
        cookie: await requestCookieLabel(request).catch(() => "unavailable"),
      }))());
    });
    page.on("response", (response) => {
      if (!new URL(response.url()).pathname.startsWith("/api/v1/")) return;
      pendingCaptures.push((async () => record({
        event: "response",
        method: response.request().method(),
        endpoint: endpoint(response.url()),
        status: response.status(),
        retryAfter: await response.headerValue("retry-after"),
        rotatesCookie: (await response.headerValue("set-cookie"))?.startsWith(`${FIXTURE_SESSION_COOKIE_NAME}=`) ?? false,
        browserCookie: await browserCookieLabel(),
      }))());
    });

    try {
      await page.goto("/login", { waitUntil: "domcontentloaded" });
      await page.getByLabel("Email").fill(FIXTURE_OWNER_EMAIL);
      await page.getByLabel("Password").fill(FIXTURE_OWNER_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL((url) => url.pathname === "/");

      const firstLink = page.waitForResponse((response) =>
        response.request().method() === "POST"
          && new URL(response.url()).pathname === "/api/v1/context/chat-sessions/link");
      await page.goto("/chat?project=global-default", { waitUntil: "domcontentloaded" });
      await expect(page.locator('[data-testid="chat-header-provider"]')).toBeEnabled({ timeout: 20_000 });
      const composer = page.locator('[data-testid="chat-composer"]');
      await expect(composer).toBeEnabled({ timeout: 15_000 });
      const firstLinkResponse = await firstLink;
      expect(firstLinkResponse.status()).toBe(201);
      const linkedConversation = ((await firstLinkResponse.json()) as {
        data: { id: string; checkpoint_count: number };
      }).data;
      const activeSession = await page.evaluate(() => localStorage.getItem("opencode-chat-active-session"));
      const messageCount = await page.locator('[data-testid="chat-user-message"], [data-testid="chat-assistant-message"]').count();
      expect(activeSession).not.toBeNull();
      expect(messageCount).toBeGreaterThan(0);
      const otherPage = await context.newPage();
      await otherPage.goto("/login", { waitUntil: "domcontentloaded" });

      timeline.length = 0;
      sequence = 0;
      reloadStarted = true;
      const otherTabCsrfResponse = otherPage.waitForResponse((response) =>
        response.request().method() === "POST"
          && new URL(response.url()).pathname === "/api/v1/auth/session/csrf");
      const [, otherTabCsrfStatus] = await Promise.all([
        page.reload({ waitUntil: "domcontentloaded" }),
        otherPage.evaluate(async () => (await fetch("/api/v1/auth/session/csrf", {
          method: "POST",
          headers: { "x-ingenium-ui": "dashboard" },
        })).status),
      ]);
      const otherTabCsrf = await otherTabCsrfResponse;
      expect(otherTabCsrfStatus).toBe(200);
      expect(await otherTabCsrf.headerValue("set-cookie")).toBeNull();
      await expect(composer).toBeEnabled({ timeout: 20_000 });
      const reloadedCheckpoint = await page.evaluate(async ({ conversationId, project }) => {
        const response = await fetch(`/api/v1/context/conversations/${encodeURIComponent(conversationId)}?project=${encodeURIComponent(project)}`);
        return { status: response.status, body: await response.json() };
      }, { conversationId: linkedConversation.id, project: "global-default" }) as {
        status: number;
        body: { data: { checkpoint_count: number } };
      };
      expect(reloadedCheckpoint.status).toBe(200);

      expect(await page.evaluate(() => localStorage.getItem("opencode-chat-active-session"))).toBe(activeSession);
      expect(await page.locator('[data-testid="chat-user-message"], [data-testid="chat-assistant-message"]').count()).toBe(messageCount);
      expect(reloadedCheckpoint.body.data.checkpoint_count).toBe(linkedConversation.checkpoint_count);

      await Promise.all(pendingCaptures);
      const reloadResponses = timeline.filter(({ phase, event }) => phase === "reload" && event === "response");
      expect(reloadResponses.filter(({ endpoint: path }) => path === "/api/v1/auth/session/csrf")).toHaveLength(1);
      expect(reloadResponses.filter(({ rotatesCookie }) => rotatesCookie === true)).toEqual([]);
      expect(new Set(reloadResponses.map(({ browserCookie }) => browserCookie).filter(Boolean)).size).toBe(1);
      expect(reloadResponses.filter(({ endpoint: path, status }) =>
        path === "/api/v1/context/chat-sessions/link" && status === 201)).toHaveLength(1);
      expect(reloadResponses.filter(({ status }) => status === 401 || status === 429)).toEqual([]);
      expect(timeline.length).toBeLessThanOrEqual(30);
    } finally {
      await Promise.allSettled(pendingCaptures);
      const evidenceDirectory = process.env.INGENIUM_AUTH_RELOAD_EVIDENCE_DIR;
      if (evidenceDirectory) {
        const directory = resolve(evidenceDirectory);
        mkdirSync(directory, { recursive: true });
        writeFileSync(resolve(directory, "request-cookie-timeline.json"), `${JSON.stringify({
          capturedAt: new Date().toISOString(),
          contentFree: true,
          timeline,
        }, null, 2)}\n`, { mode: 0o600 });
      }
      await context.close();
    }
  });

  test("rich fixture: reasoning, tool call, and response stream correctly", async ({ page }) => {
    test.setTimeout(90000);

    const conversationCreated = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/v1/opencode/sessions"
        && response.request().method() === "POST",
    );
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    await expect(page.locator('[data-testid="chat-header-provider"]')).toBeEnabled({ timeout: 20000 });

    // This direct, dynamically-ported fixture request must pass the dashboard
    // proxy's mutation contract before the rich stream can begin.
    await page.getByRole("button", { name: /New conversation/i }).first().click();
    const createdResponse = await conversationCreated;
    expect(
      createdResponse.status(),
      `conversation creation request headers: ${JSON.stringify(await createdResponse.request().allHeaders())}`,
    ).toBe(201);

    const composer = page.locator('[data-testid="chat-composer"]');
    await expect(composer).toBeEnabled({ timeout: 15000 });
    await composer.fill("Test rich fixture");
    await composer.press("Enter");

    // Reasoning must appear incrementally while the rich fixture is still in
    // its thinking/tool phases (the response delta is emitted later). The
    // fixture deliberately keeps the real-shaped /event SSE connection open
    // after session.idle, matching deployed OpenCode rather than a response-
    // per-turn mock. This therefore fails if the dashboard's route path buffers
    // SSE until the connection closes.
    const reasoning = page.locator('[data-testid="chat-reasoning"]');
    const finalResponse = page.getByText(
      "I've completed the analysis. The chat pipeline is working correctly.",
    );
    await expect(reasoning).toBeVisible({ timeout: 15000 });

    await expect(page.locator('[data-testid="chat-reasoning-content"]')).toContainText("think about this");
    await expect(page.locator('[data-testid="chat-reasoning-content"]')).not.toHaveClass(
      /\b(?:border|rounded|bg-)/,
    );
    await expect(page.getByText("Generating…")).toHaveCount(0);
    await expect(finalResponse).toHaveCount(0);

    const toolTrace = page
      .locator('[data-testid="chat-tool-call"]')
      .filter({ hasText: "Shell" });
    await expect(toolTrace).toBeVisible({ timeout: 10000 });

    await expect(toolTrace.locator('[data-testid="chat-tool-name"]')).toContainText("Shell");
    await expect(toolTrace.locator('[data-testid="chat-tool-summary"]')).toContainText(
      "echo 'Hello from tool'",
    );

    // The OpenCode-style trace has no card chrome, controls, or status UI.
    await expect(toolTrace.locator("button")).toHaveCount(0);
    await expect(toolTrace.locator('[data-testid="chat-tool-status"]')).toHaveCount(0);
    await expect(toolTrace).not.toHaveClass(/\b(?:border|rounded|bg-)/);

    // Web Search remains the only compact activity trigger. It opens the
    // shared drawer and exposes concrete fixture results/visited sites, not
    // URLs derived from its query.
    const webSearchTrace = page
      .locator('[data-testid="chat-tool-call"]')
      .filter({ hasText: "Web Search" });
    await expect(webSearchTrace).toBeVisible({ timeout: 10000 });
    await webSearchTrace.locator('[data-testid="chat-tool-trigger"]').click();
    const activityDrawer = page.getByRole("dialog", { name: "Activity" });
    await expect(activityDrawer).toBeVisible();
    await expect(activityDrawer.locator('[data-label="Visited"]')).toBeVisible();
    await expect(activityDrawer.locator('[data-label="Results"]')).toBeVisible();
    await expect(
      activityDrawer.locator('[data-testid="chat-activity-site-link"]'),
    ).toHaveCount(2);
    await expect(
      activityDrawer.getByRole("link", { name: "https://visited.example.test/stream-lifecycle" }),
    ).toHaveAttribute("href", "https://visited.example.test/stream-lifecycle");
    await expect(
      activityDrawer.getByRole("link", { name: "https://results.example.test/chat-streaming" }),
    ).toHaveAttribute("target", "_blank");
    await expect(webSearchTrace.locator('[data-testid="chat-tool-details"]')).toHaveCount(0);

    await activityDrawer.getByRole("button", { name: "Close activity drawer" }).click();
    await expect(activityDrawer).toBeHidden();
    await expect(webSearchTrace.locator('[data-testid="chat-tool-trigger"]')).toBeFocused();

    // Completion metadata precedes session.idle in the fixture protocol.
    await expect(finalResponse).toBeVisible({ timeout: 10000 });
    const assistantOutput = page.locator('[data-testid="chat-assistant-message"]').last();
    await expect(assistantOutput).not.toHaveClass(/\b(?:border|rounded|bg-)/);
    const callout = assistantOutput.locator(".chat-markdown .callout");
    await expect(callout).toBeVisible();
    await expect(callout).not.toHaveCSS("border-left-width", "4px");
    await expect(callout).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

    // User prompts intentionally retain their distinct bubble treatment.
    const userBubble = page.locator('[data-testid="chat-user-message"]').last();
    await expect(userBubble).toHaveClass(/rounded-2xl/);
    await expect(userBubble).toHaveClass(/bg-\[var\(--color-surface-selected\)\]/);

    // Streaming completes at the terminal event, which restores the composer
    // and collapses the active reasoning disclosure.
    await expect(page.locator('[data-testid="chat-send-btn"]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid="chat-stop-btn"]')).toBeHidden({ timeout: 10000 });
    expect(await reasoning.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false);
  });

  test("activity drawer is live and fills the viewport on mobile", async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="chat-header-provider"]')).toBeEnabled({ timeout: 20000 });

    const composer = page.locator('[data-testid="chat-composer"]');
    await expect(composer).toBeEnabled({ timeout: 15000 });
    await composer.fill("Test activity drawer");
    await composer.press("Enter");

    const webSearchTrigger = page.locator('[data-testid="chat-tool-trigger"]');
    await expect(webSearchTrigger).toBeVisible({ timeout: 30000 });
    await webSearchTrigger.click();

    const desktopDrawer = page.getByRole("dialog", { name: "Activity" });
    await expect(desktopDrawer).toBeVisible();
    const desktopBox = await desktopDrawer.boundingBox();
    expectWithinPixels(desktopBox?.width, 400, "desktop activity drawer width");
    await expect(desktopDrawer.getByText("transparent chat streaming")).toBeVisible();
    await expect(
      desktopDrawer.getByText("I've completed the analysis. The chat pipeline is working correctly."),
    ).toBeVisible({ timeout: 15000 });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileDrawer = page.getByRole("dialog", { name: "Activity" });
    const mobileBox = await mobileDrawer.boundingBox();
    const mobileViewport = page.viewportSize();
    expect(mobileViewport).not.toBeNull();
    if (mobileViewport) {
      expectWithinPixels(mobileBox?.width, mobileViewport.width, "mobile activity drawer width");
      expectWithinPixels(mobileBox?.height, mobileViewport.height, "mobile activity drawer height");
    }

    await page.keyboard.press("Escape");
    await expect(mobileDrawer).toBeHidden();
  });
});
