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

    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    // Wait for provider selector
    await expect(page.locator('[data-testid="chat-header-provider"]')).toBeEnabled({ timeout: 20000 });

    // Send a message
    const composer = page.locator('[data-testid="chat-composer"]');
    await expect(composer).toBeEnabled({ timeout: 15000 });
    await composer.fill("Test rich fixture");
    await composer.press("Enter");

    // Reasoning should appear (streaming)
    await expect(page.locator('[data-testid="chat-reasoning"]')).toBeVisible({ timeout: 15000 });

    // Reasoning content should contain the fixture text
    await expect(page.locator('[data-testid="chat-reasoning-content"]')).toContainText("think about this");

    // Tool call card should render
    await expect(page.locator('[data-testid="chat-tool-call"]')).toBeVisible({ timeout: 10000 });

    // Tool name should show
    await expect(page.locator('[data-testid="chat-tool-name"]')).toContainText("Shell");

    // Streaming should complete — send button visible (stop button hidden)
    await expect(page.locator('[data-testid="chat-send-btn"]')).toBeVisible({ timeout: 30000 });
  });
});
