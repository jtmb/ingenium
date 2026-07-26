import { test, expect } from "@playwright/test";

test.describe("Chat — end-to-end smoke", () => {
  test("full send/receive cycle with fixture server", async ({ page }) => {
    // Full pipeline: browser → Next.js → API → fixture OpenCode → SSE → rendered response
    test.setTimeout(60000);

    // Navigate to /chat
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    // Wait for chat config to load and provider selector to be enabled.
    // The fixture server at GET /provider returns a free "Fixture Model"
    // under the "opencode" provider, which the API's chat-config promotes
    // to the builtin provider list.
    const providerSelect = page.locator('[data-testid="chat-header-provider"]');
    await expect(providerSelect).toBeEnabled({ timeout: 20000 });

    // Wait for the model selector to have options too.
    const modelSelect = page.locator('[data-testid="chat-header-model"]');
    await expect(modelSelect).toBeEnabled({ timeout: 15000 });

    // The composer must not be disabled — session auto-creation and
    // chat-config loading are complete.
    const composer = page.locator('[data-testid="chat-composer"]');
    await expect(composer).toBeEnabled({ timeout: 15000 });

    // Type and send a message
    await composer.fill("Hello from E2E test");
    await composer.press("Enter");

    // Composer should clear (message was accepted)
    await expect(composer).toHaveValue("", { timeout: 5000 });

    // User message bubble should appear
    await expect(page.getByText("Hello from E2E test").first()).toBeVisible({ timeout: 5000 });

    // Assistant response should appear (streaming from fixture SSE).
    // The fixture sends three SSE events: message.updated, message.part.delta, session.idle.
    await expect(page.getByText("I've completed the analysis. The chat pipeline is working correctly.")).toBeVisible({ timeout: 30000 });

    // Streaming should have stopped — the stop button must disappear.
    // The send button is visible (disabled is fine — composer is empty).
    await expect(page.locator('[data-testid="chat-stop-btn"]')).toBeHidden({ timeout: 10000 });
    await expect(page.locator('[data-testid="chat-send-btn"]')).toBeVisible({ timeout: 5000 });
  });

  test("session survives refresh", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    // After previous test created a session, the config should reload
    // and the provider selector must be available.
    await expect(page.locator('[data-testid="chat-header-provider"]')).toBeEnabled({ timeout: 15000 });
  });

  test("rich fixture: reasoning, tool call, and response stream correctly", async ({ page }) => {
    test.setTimeout(90000);

    const conversationCreated = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/v1/opencode/sessions"
        && response.request().method() === "POST",
    );
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    // Wait for provider selector
    await expect(page.locator('[data-testid="chat-header-provider"]')).toBeEnabled({ timeout: 20000 });

    // This direct, dynamically-ported fixture request must pass the dashboard
    // proxy's mutation contract before the rich stream can begin.
    await page.getByRole("button", { name: /New conversation/i }).first().click();
    const createdResponse = await conversationCreated;
    expect(
      createdResponse.status(),
      `conversation creation request headers: ${JSON.stringify(await createdResponse.request().allHeaders())}`,
    ).toBe(201);

    // Send a message
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

    // Reasoning content should contain the fixture text
    await expect(page.locator('[data-testid="chat-reasoning-content"]')).toContainText("think about this");
    await expect(page.locator('[data-testid="chat-reasoning-content"]')).not.toHaveClass(
      /\b(?:border|rounded|bg-)/,
    );
    await expect(page.getByText("Generating…")).toHaveCount(0);
    await expect(finalResponse).toHaveCount(0);

    // Tool call should render as a non-interactive inline trace.
    const toolTrace = page
      .locator('[data-testid="chat-tool-call"]')
      .filter({ hasText: "Shell" });
    await expect(toolTrace).toBeVisible({ timeout: 10000 });

    // Tool name should show
    await expect(toolTrace.locator('[data-testid="chat-tool-name"]')).toContainText("Shell");
    await expect(toolTrace.locator('[data-testid="chat-tool-summary"]')).toContainText(
      "echo 'Hello from tool'",
    );

    // The OpenCode-style trace has no card chrome, controls, or status UI.
    await expect(toolTrace.locator("button")).toHaveCount(0);
    await expect(toolTrace.locator('[data-testid="chat-tool-status"]')).toHaveCount(0);
    await expect(toolTrace).not.toHaveClass(/\b(?:border|rounded|bg-)/);

    // Web Search remains the only tool disclosure and exposes concrete fixture
    // results/visited sites, not URLs derived from its query.
    const webSearchTrace = page
      .locator('[data-testid="chat-tool-call"]')
      .filter({ hasText: "Web Search" });
    await expect(webSearchTrace).toBeVisible({ timeout: 10000 });
    await webSearchTrace.locator('[data-testid="chat-tool-trigger"]').click();
    await expect(webSearchTrace.locator('[data-label="Visited"]')).toBeVisible();
    await expect(webSearchTrace.locator('[data-label="Results"]')).toBeVisible();
    await expect(
      webSearchTrace.locator('[data-testid="chat-web-search-link"]'),
    ).toHaveCount(2);
    await expect(
      webSearchTrace.getByRole("link", { name: "https://visited.example.test/stream-lifecycle" }),
    ).toHaveAttribute("href", "https://visited.example.test/stream-lifecycle");
    await expect(
      webSearchTrace.getByRole("link", { name: "https://results.example.test/chat-streaming" }),
    ).toHaveAttribute("target", "_blank");

    // The fixture emits completed message metadata before session.idle.
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
});
