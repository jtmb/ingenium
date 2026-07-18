import { test, expect } from "@playwright/test";

/**
 * E2E tests for the Chat page when NO providers are configured.
 *
 * Verifies disabled selectors, "No providers available" placeholder,
 * disabled send button, and that typing/pressing Enter does nothing.
 */
test.describe("Chat — No Providers Configured", () => {
  test("selectors disabled, send disabled, typing+Enter does nothing", async ({ page }) => {
    /* ------------------------------------------------------------------ */
    /*  1. Navigate to /chat with NO providers configured                  */
    /* ------------------------------------------------------------------ */
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    // Wait for the Chat page to render — look for the composer input
    const composer = page.locator('[data-testid="chat-composer"]');
    await expect(composer).toBeVisible({ timeout: 8000 });

    /* ------------------------------------------------------------------ */
    /*  2. Verify selectors present but disabled (opacity-40)              */
    /* ------------------------------------------------------------------ */
    const providerSelect = page.locator('[data-testid="chat-header-provider"]');
    await expect(providerSelect).toBeVisible({ timeout: 5000 });

    // The select should be disabled with opacity-40 class
    await expect(providerSelect).toBeDisabled();
    await expect(providerSelect).toHaveClass(/opacity-40/);

    // Model select should also be disabled
    const modelSelect = page.locator('[data-testid="chat-header-model"]');
    await expect(modelSelect).toBeVisible({ timeout: 3000 });
    await expect(modelSelect).toBeDisabled();
    await expect(modelSelect).toHaveClass(/opacity-40/);

    // Agent select should also be disabled
    const agentSelect = page.locator('[data-testid="chat-header-agent"]');
    await expect(agentSelect).toBeVisible({ timeout: 3000 });
    await expect(agentSelect).toBeDisabled();
    await expect(agentSelect).toHaveClass(/opacity-40/);

    /* ------------------------------------------------------------------ */
    /*  3. Verify "No providers available" placeholder text                */
    /* ------------------------------------------------------------------ */
    // The only option in the provider select should be "No providers available"
    const providerOptions = providerSelect.locator("option");
    await expect(providerOptions).toHaveCount(1);
    await expect(providerOptions.first()).toHaveText("No providers available");

    // Verify the "No LLM configured" banner is visible
    const banner = page.getByText("No LLM configured");
    await expect(banner).toBeVisible({ timeout: 3000 });

    // The banner should have a link to Settings → Providers
    const settingsLink = banner.locator("a");
    await expect(settingsLink).toBeVisible();
    await expect(settingsLink).toHaveAttribute("href", "/chat?settings=providers");

    /* ------------------------------------------------------------------ */
    /*  4. Verify send button is disabled                                  */
    /* ------------------------------------------------------------------ */
    const sendBtn = page.locator('[data-testid="chat-send-btn"]');
    await expect(sendBtn).toBeVisible({ timeout: 3000 });

    // The send button should be disabled when no selectable model
    await expect(sendBtn).toBeDisabled();
    // It should have the cursor-not-allowed class
    await expect(sendBtn).toHaveClass(/cursor-not-allowed/);

    /* ------------------------------------------------------------------ */
    /*  5. Type text and press Enter — nothing should happen               */
    /* ------------------------------------------------------------------ */
    // Type in the composer
    await composer.fill("Hello, is this thing on?");
    await expect(composer).toHaveValue("Hello, is this thing on?");

    // Press Enter — the send handler checks `if (!hasSelectableModel) return;`
    await composer.press("Enter");

    // The empty state should still be showing (no messages sent)
    const emptyState = page.locator('[data-testid="chat-empty-state"]');
    await expect(emptyState).toBeVisible({ timeout: 3000 });

    // The heading "How can I help you today?" should be visible
    await expect(page.getByText("How can I help you today?")).toBeVisible();

    // The input should still have the text (message was not sent)
    await expect(composer).toHaveValue("Hello, is this thing on?");
  });
});
