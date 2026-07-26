import { test, expect } from "@playwright/test";
import { requireSuiteOptIn } from "./suite-containment";

test.describe("@integration Chat — real-provider smoke", () => {
  test.beforeAll(() => {
    // Keep direct file execution fail-fast as well as config-based execution.
    requireSuiteOptIn("provider");
  });

  test("full send/receive with real OpenCode LLM", async ({ page }) => {
    // 1. Navigate to /chat
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    // 2. Wait for auto-created session and config to load
    //    Provider selector should be enabled (not opaque-40)
    const providerSelect = page.locator('[data-testid="chat-header-provider"]');
    await expect(providerSelect).toBeEnabled({ timeout: 30000 });

    // 3. Verify a model is available
    const modelSelect = page.locator('[data-testid="chat-header-model"]');
    await expect(modelSelect).toBeEnabled({ timeout: 5000 });

    // 4. Send a unique, simple prompt
    const uniqueId = Date.now().toString(36);
    const userText = `E2E-SMOKE-${uniqueId}`;
    const composer = page.locator('[data-testid="chat-composer"]');
    await composer.fill(userText);
    await composer.press("Enter");

    // 5. Composer should clear (message accepted)
    await expect(composer).toHaveValue("", { timeout: 5000 });

    // 6. User bubble should appear
    await expect(page.getByText(userText).first()).toBeVisible({ timeout: 5000 });

    // 7. Wait for streaming to complete — send button visible means done
    //    We don't assert LLM output content because transient LLM failures
    //    (rate limits, empty responses) are not Chat code failures.
    const sendBtn = page.locator('[data-testid="chat-send-btn"]');
    await expect(sendBtn).toBeVisible({ timeout: 120000 });

    // 8. Stop button should be gone — streaming fully stopped
    await expect(page.locator('[data-testid="chat-stop-btn"]')).toHaveCount(0, { timeout: 5000 });

    // 9. Empty state should be gone — messages were rendered into the chat area
    //    (Both user and assistant messages exist once streaming completes)
    await expect(page.locator('[data-testid="chat-empty-state"]')).not.toBeVisible({ timeout: 5000 });
  });

  test("auto-created session persists messages", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    // Wait for config to load
    await expect(page.locator('[data-testid="chat-header-provider"]')).toBeEnabled({ timeout: 30000 });

    // Use a unique prompt so it never conflicts with stale messages from prior runs
    const persistId = `PERSIST-${Date.now().toString(36)}`;

    const composer = page.locator('[data-testid="chat-composer"]');
    await composer.fill(persistId);
    await composer.press("Enter");

    // Wait for streaming to complete — send button visible means done
    await expect(page.locator('[data-testid="chat-send-btn"]')).toBeVisible({ timeout: 120000 });

    // Navigate away and back
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    // Messages should survive navigation — use .first() to avoid strict mode
    // if the same text somehow appears in multiple messages
    await expect(page.getByText(persistId).first()).toBeVisible({ timeout: 10000 });
  });
});
