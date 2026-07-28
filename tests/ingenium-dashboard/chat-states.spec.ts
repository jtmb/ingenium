import { test, expect, type Page } from "@playwright/test";

const CHAT_CONFIG_ROUTE = "**/api/v1/opencode/chat-config**";
const CHAT_CONFIG_ERROR = "The Chat model catalog is temporarily unavailable. Try again later.";

const NO_PROVIDER_CHAT_CONFIG = {
  data: {
    configured: false,
    primary: null,
    backup: null,
    providers: [],
    agents: [{ name: "ingenium-chat", label: "Ingenium Chat" }],
    defaultSelection: null,
  },
};

async function mockChatConfig(
  page: Page,
  response: { status: number; body: unknown },
): Promise<void> {
  await page.route(CHAT_CONFIG_ROUTE, (route) => route.fulfill({
    status: response.status,
    contentType: "application/json",
    body: JSON.stringify(response.body),
  }));
}

/**
 * E2E tests for the Chat page's provider configuration states.
 *
 * The default fixture intentionally exposes a free provider for chat smoke.
 * These tests mock only the browser's chat-config request so they can exercise
 * no-provider, loading, and error states without changing the fixture server
 * or leaking state into chat-e2e-smoke.spec.ts.
 */
test.describe("Chat — Provider Configuration States", () => {
  test("selectors disabled, send disabled, typing+Enter does nothing", async ({ page }) => {
    /* ------------------------------------------------------------------ */
    /*  1. Navigate to /chat with NO providers configured                  */
    /* ------------------------------------------------------------------ */
    await mockChatConfig(page, { status: 200, body: NO_PROVIDER_CHAT_CONFIG });
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

    // Verify the no-model banner is visible
    const banner = page.getByText("No model is available. Go to", { exact: false });
    await expect(banner).toBeVisible({ timeout: 3000 });

    // The banner should have a link to Settings → Providers
    const settingsLink = page.getByRole("link", { name: "Settings → Providers" });
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

    // The fixture may already expose a session/message; assert that this
    // blocked prompt was not added rather than assuming an empty history.
    await expect(
      page.locator('[data-testid="chat-user-message"]').filter({ hasText: "Hello, is this thing on?" }),
    ).toHaveCount(0);

    // The input should still have the text because the message was not sent.
    await expect(composer).toHaveValue("Hello, is this thing on?");
  });

  test("selectors stay disabled while chat config is loading, then recover readiness", async ({ page }) => {
    let requestStarted!: () => void;
    const chatConfigRequestStarted = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    let releaseRequest!: () => void;
    const chatConfigResponseReleased = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });

    // Delay only chat-config, then continue to the real fixture-backed API so
    // the same free provider remains available to the smoke tests.
    await page.route(CHAT_CONFIG_ROUTE, async (route) => {
      requestStarted();
      await chatConfigResponseReleased;
      await route.continue();
    });
    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await chatConfigRequestStarted;

    const providerSelect = page.locator('[data-testid="chat-header-provider"]');
    const modelSelect = page.locator('[data-testid="chat-header-model"]');
    const agentSelect = page.locator('[data-testid="chat-header-agent"]');
    await expect(providerSelect).toBeVisible();
    await expect(providerSelect).toBeDisabled();
    await expect(modelSelect).toBeDisabled();
    await expect(agentSelect).toBeDisabled();
    await expect(page.getByText("No model is available.", { exact: false })).toHaveCount(0);
    await expect(page.getByText(/Failed to load chat config:/)).toHaveCount(0);

    releaseRequest();
    await expect(providerSelect).toBeEnabled({ timeout: 15000 });
    await expect(modelSelect).toBeEnabled({ timeout: 15000 });
    await expect(agentSelect).toBeEnabled({ timeout: 15000 });
    await expect(page.locator('[data-testid="chat-composer"]')).toBeEnabled({ timeout: 15000 });
  });

  test("selectors stay disabled and show the sanitized error when chat config fails", async ({ page }) => {
    await mockChatConfig(page, {
      status: 503,
      body: { error: { code: "LLM_CATALOG_UNAVAILABLE", message: CHAT_CONFIG_ERROR } },
    });
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    const composer = page.locator('[data-testid="chat-composer"]');
    await expect(composer).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(`Failed to load chat config: ${CHAT_CONFIG_ERROR}`)).toBeVisible();

    for (const selector of [
      '[data-testid="chat-header-provider"]',
      '[data-testid="chat-header-model"]',
      '[data-testid="chat-header-agent"]',
    ]) {
      await expect(page.locator(selector)).toBeDisabled();
      await expect(page.locator(selector)).toHaveClass(/opacity-40/);
    }

    await composer.fill("Config error must not send");
    await composer.press("Enter");
    await expect(
      page.locator('[data-testid="chat-user-message"]').filter({ hasText: "Config error must not send" }),
    ).toHaveCount(0);
    await expect(composer).toHaveValue("Config error must not send");
  });
});
