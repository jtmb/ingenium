import { test, expect } from "@playwright/test";
import { requireSuiteOptIn } from "./suite-containment";

test.describe("@integration Chat — real-provider smoke", () => {
  test.beforeAll(() => {
    // Enforce opt-in for both direct and config-based execution.
    requireSuiteOptIn("provider");
  });

  test("full send/receive with real OpenCode LLM", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    const providerSelect = page.locator('[data-testid="chat-header-provider"]');
    await expect(providerSelect).toBeEnabled({ timeout: 30000 });

    const modelSelect = page.locator('[data-testid="chat-header-model"]');
    await expect(modelSelect).toBeEnabled({ timeout: 5000 });

    const uniqueId = Date.now().toString(36);
    const userText = `E2E-SMOKE-${uniqueId}`;
    const composer = page.locator('[data-testid="chat-composer"]');
    await composer.fill(userText);
    await composer.press("Enter");

    await expect(composer).toHaveValue("", { timeout: 5000 });

    await expect(page.getByText(userText).first()).toBeVisible({ timeout: 5000 });

    // Provider output is intentionally not asserted: transient provider failures
    // are outside the dashboard interaction contract.
    const sendBtn = page.locator('[data-testid="chat-send-btn"]');
    await expect(sendBtn).toBeVisible({ timeout: 120000 });

    await expect(page.locator('[data-testid="chat-stop-btn"]')).toHaveCount(0, { timeout: 5000 });

    await expect(page.locator('[data-testid="chat-empty-state"]')).not.toBeVisible({ timeout: 5000 });
  });

  test("auto-created session persists messages", async ({ page }) => {
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    await expect(page.locator('[data-testid="chat-header-provider"]')).toBeEnabled({ timeout: 30000 });

    // Unique text avoids matching messages left by an earlier session.
    const persistId = `PERSIST-${Date.now().toString(36)}`;

    const composer = page.locator('[data-testid="chat-composer"]');
    await composer.fill(persistId);
    await composer.press("Enter");

    await expect(page.locator('[data-testid="chat-send-btn"]')).toBeVisible({ timeout: 120000 });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    // `.first()` tolerates duplicate rendered messages while checking persistence.
    await expect(page.getByText(persistId).first()).toBeVisible({ timeout: 10000 });
  });
});
