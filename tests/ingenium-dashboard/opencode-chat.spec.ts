import { test, expect } from "@playwright/test";

const DASHBOARD_URL = "http://localhost:3000";

/**
 * E2E tests for the OpenCode Chat UI — the tri-mode (Chat/Web/CLI) interface
 * on /opencode with Chat as the default mode.
 *
 * Tests cover:
 *   1. Default Chat mode and empty state
 *   2. Empty state rendering
 *   3. Mode switching (Chat → Web → CLI → Chat)
 *   4. Session sidebar collapse/expand
 *   5. Composer textarea and send button enable/disable
 *   6. Provider and model selectors in chat header
 *   7. Enter to send, Shift+Enter for newline
 *   8. Mobile viewport shows hamburger button
 */
test.describe("OpenCode Chat UI", () => {
  test.describe.configure({ mode: "serial" });

  // Precondition: verify services are reachable
  test.beforeAll(async ({ request }) => {
    try {
      const apiHealth = await request.get("http://localhost:4097/api/v1/health");
      if (!apiHealth.ok()) {
        test.skip(true, "API not reachable — skipping tests");
      }
    } catch {
      test.skip(true, "Services not running — skipping tests");
    }
  });

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  1. Default Chat mode                                                    */
  /* ──────────────────────────────────────────────────────────────────────── */
  test("navigates to /opencode and shows Chat mode as default", async ({ page }) => {
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    // Re-navigate to pick up cleared localStorage
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

    // Chat mode button should be selected (depressed)
    const chatBtn = page.locator('[data-testid="chat-toolbar-mode-chat"]');
    await expect(chatBtn).toBeVisible({ timeout: 5000 });
    const isPressed = await chatBtn.getAttribute("aria-pressed");
    expect(isPressed).toBe("true");

    // Composer textarea should be visible
    const composer = page.locator('[data-testid="chat-composer"]');
    await expect(composer).toBeVisible({ timeout: 5000 });
  });

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  2. Empty state                                                          */
  /* ──────────────────────────────────────────────────────────────────────── */
  test("shows empty state with welcome message", async ({ page }) => {
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

    // Empty state container should be visible
    const emptyState = page.locator('[data-testid="chat-empty-state"]');
    await expect(emptyState).toBeVisible({ timeout: 5000 });

    // "How can I help you today?" should be present
    await expect(emptyState.getByText("How can I help you today?")).toBeVisible();

    // Subtitle should also be visible
    await expect(emptyState.getByText(/Ask me anything/)).toBeVisible();
  });

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  3. Mode switching — Chat → Web → CLI → Chat                             */
  /* ──────────────────────────────────────────────────────────────────────── */
  test("can switch between Chat, Web, and CLI modes", async ({ page }) => {
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

    // Start in Chat mode — composer visible, no iframes
    await expect(page.locator('[data-testid="chat-composer"]')).toBeVisible({ timeout: 5000 });

    // Switch to Web mode
    const webBtn = page.locator('[data-testid="chat-toolbar-mode-web"]');
    await expect(webBtn).toBeVisible();
    await webBtn.click();

    // Web iframe should appear
    const webIframe = page.locator('iframe[title="OpenCode Web"]');
    await expect(webIframe).toBeAttached({ timeout: 10000 });

    // Chat composer should no longer be in the DOM
    await expect(page.locator('[data-testid="chat-composer"]')).toHaveCount(0);

    // Switch to CLI mode
    const cliBtn = page.locator('[data-testid="chat-toolbar-mode-cli"]');
    await expect(cliBtn).toBeVisible();
    await cliBtn.click();

    // CLI iframe should be attached
    const cliIframe = page.locator('iframe[title="OpenCode Terminal"]');
    await expect(cliIframe).toBeAttached({ timeout: 10000 });

    // Web iframe should still be attached (lazy-mount never removes)
    await expect(webIframe).toBeAttached();

    // Switch back to Chat mode
    const chatBtn = page.locator('[data-testid="chat-toolbar-mode-chat"]');
    await expect(chatBtn).toBeVisible();
    await chatBtn.click();

    // Composer should be visible again
    await expect(page.locator('[data-testid="chat-composer"]')).toBeVisible({ timeout: 5000 });

    // aria-pressed should be true for chat, false for others
    expect(await chatBtn.getAttribute("aria-pressed")).toBe("true");
    expect(await webBtn.getAttribute("aria-pressed")).toBe("false");
    expect(await cliBtn.getAttribute("aria-pressed")).toBe("false");
  });

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  4. Session sidebar collapse/expand                                      */
  /* ──────────────────────────────────────────────────────────────────────── */
  test("session sidebar collapses and expands", async ({ page }) => {
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

    // Initially expanded — sidebar should be visible
    const sidebar = page.locator('[data-testid="session-sidebar"]');
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    // The expanded sidebar has aria-label "Chat sessions"
    const initialLabel = await sidebar.getAttribute("aria-label");
    expect(initialLabel).toBe("Chat sessions");

    // Click collapse toggle
    const toggle = page.locator('[data-testid="session-sidebar-toggle"]');
    await expect(toggle).toBeVisible();
    await toggle.click();

    // Should now be collapsed — aria-label changes
    await expect(sidebar).toBeVisible();
    const collapsedLabel = await sidebar.getAttribute("aria-label");
    expect(collapsedLabel).toBe("Chat sidebar collapsed");

    // Expand again
    const expandToggle = page.locator('[data-testid="session-sidebar-toggle"]');
    await expect(expandToggle).toBeVisible();
    await expandToggle.click();

    // Should be expanded again
    await expect(sidebar).toBeVisible();
    const reExpandedLabel = await sidebar.getAttribute("aria-label");
    expect(reExpandedLabel).toBe("Chat sessions");
  });

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  5. Composer textarea and send button enable/disable                      */
  /* ──────────────────────────────────────────────────────────────────────── */
  test("composer textarea and send button enable/disable with text", async ({ page }) => {
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

    const composer = page.locator('[data-testid="chat-composer"]');
    const sendBtn = page.locator('[data-testid="chat-send-btn"]');

    await expect(composer).toBeVisible({ timeout: 5000 });

    // Initially, send button should be disabled (no text)
    await expect(sendBtn).toBeVisible();
    await expect(sendBtn).toBeDisabled();

    // Type text in composer
    await composer.fill("Hello, what can you do?");
    await expect(sendBtn).toBeEnabled();

    // Clear text
    await composer.fill("");
    await expect(sendBtn).toBeDisabled();

    // Type again
    await composer.fill("Another question");
    await expect(sendBtn).toBeEnabled();
  });

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  6. Provider and model selectors in header                                */
  /* ──────────────────────────────────────────────────────────────────────── */
  test("shows provider and model selectors in chat header", async ({ page }) => {
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

    // Provider selector
    const providerSelect = page.locator('[data-testid="chat-header-provider"]');
    await expect(providerSelect).toBeVisible({ timeout: 5000 });
    const providerValue = await providerSelect.inputValue();
    expect(providerValue).toBeTruthy();

    // Model selector
    const modelSelect = page.locator('[data-testid="chat-header-model"]');
    await expect(modelSelect).toBeVisible();
    const modelValue = await modelSelect.inputValue();
    expect(modelValue).toBeTruthy();

    // Default values should be DeepSeek and deepseek-v4-pro
    expect(providerValue).toBe("deepseek");
    expect(modelValue).toBe("deepseek-v4-pro");

    // Changing provider should update available models
    await providerSelect.selectOption("openai");
    const updatedModelValue = await modelSelect.inputValue();
    expect(updatedModelValue).toBe("gpt-4o"); // First model for openai
  });

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  7. Enter sends, Shift+Enter adds newline                                 */
  /* ──────────────────────────────────────────────────────────────────────── */
  test("Enter sends message, Shift+Enter inserts newline", async ({ page }) => {
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

    const composer = page.locator('[data-testid="chat-composer"]');
    const sendBtn = page.locator('[data-testid="chat-send-btn"]');

    await expect(composer).toBeVisible({ timeout: 5000 });

    // Shift+Enter should add a newline, not send
    await composer.fill("Line one");
    await composer.press("Shift+Enter");
    await composer.press("Shift+Enter");
    await composer.press("Shift+Enter");
    // Type some more
    await composer.type("Line two");

    const textAfterShiftEnter = await composer.inputValue();
    expect(textAfterShiftEnter).toContain("Line one");
    expect(textAfterShiftEnter).toContain("Line two");
    // Send button should still be enabled (not sent)
    await expect(sendBtn).toBeEnabled();

    // Now send the message via keyboard
    // Clear and type a simple message
    await composer.fill("Test message");
    await composer.press("Enter");

    // After sending, the composer should clear
    const textAfterSend = await composer.inputValue();
    expect(textAfterSend).toBe("");

    // The user message should appear in the chat area
    // (the simulated response runs after 800ms, but the user message is immediate)
    await expect(page.getByText("Test message")).toBeVisible({ timeout: 3000 });

    // Wait for the simulated assistant response
    await expect(page.locator("text=simulated response")).toBeVisible({ timeout: 10000 });
  });

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  8. Mobile viewport shows hamburger                                      */
  /* ──────────────────────────────────────────────────────────────────────── */
  test("mobile viewport shows hamburger and opens sidebar drawer", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

    // On mobile, the hamburger button should be visible
    const hamburger = page.locator('[data-testid="chat-header-hamburger"]');
    await expect(hamburger).toBeVisible({ timeout: 5000 });

    // The sidebar should NOT be visible in drawer form initially
    // (it's only visible on desktop in the normal layout)
    // On mobile, the sidebar is hidden and activated via the drawer overlay

    // Click hamburger to open sidebar drawer
    await hamburger.click();

    // Now the drawer sidebar should be visible (rendered in a fixed overlay)
    // Look for the drawer sidebar by its aria-label
    const drawerSidebar = page.locator('aside[aria-label="Chat sessions"]');
    // There should be at least one visible sidebar (the drawer overlay one)
    await expect(drawerSidebar.first()).toBeVisible({ timeout: 3000 });

    // Click the backdrop to close the drawer
    // The backdrop has aria-hidden="true" and is the first child of the drawer overlay
    const backdrop = page.locator("div.fixed.inset-0.bg-black\\/50");
    if (await backdrop.isVisible({ timeout: 1000 }).catch(() => false)) {
      await backdrop.click({ force: true });
      // Drawer should be dismissed
      await expect(hamburger).toBeVisible({ timeout: 3000 });
    }
  });

  /* ──────────────────────────────────────────────────────────────────────── */
  /*  9. Chat session creation via sidebar                                     */
  /* ──────────────────────────────────────────────────────────────────────── */
  test("new chat button creates a new session", async ({ page }) => {
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("opencode-mode"));
    await page.goto(`${DASHBOARD_URL}/opencode`, { waitUntil: "domcontentloaded" });

    // Send a message first
    const composer = page.locator('[data-testid="chat-composer"]');
    await composer.fill("First conversation");
    await composer.press("Enter");

    // Wait for the simulated response
    await expect(page.getByText("First conversation")).toBeVisible({ timeout: 3000 });

    // Click "New Chat" button in the sidebar header
    const newChatBtn = page.getByRole("button", { name: /New conversation/i });
    await expect(newChatBtn.first()).toBeVisible({ timeout: 5000 });
    await newChatBtn.first().click();

    // Should now have a fresh empty state
    const emptyState = page.locator('[data-testid="chat-empty-state"]');
    await expect(emptyState).toBeVisible({ timeout: 5000 });

    // The first message should not be visible anymore (new session context)
    await expect(page.getByText("First conversation")).toHaveCount(0);
  });
});
