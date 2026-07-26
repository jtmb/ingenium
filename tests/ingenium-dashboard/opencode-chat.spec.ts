import { test, expect, type Page } from "@playwright/test";

/* ──────────────────────────────────────────────────────────────────────── */
/*  Mock data — shapes match the OpenCode API contract                       */
/* ──────────────────────────────────────────────────────────────────────── */

const SESSION_ID = "chat-e2e-test-session";
const SESSION_TITLE = "Test Conversation";
const NOW = Date.now();

const MOCK_SESSION = {
  id: SESSION_ID,
  slug: SESSION_TITLE,
  projectID: "playwright-test",
  directory: "/workspace",
  path: "",
  title: SESSION_TITLE,
  version: "1",
  time: { created: NOW, updated: NOW },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

const NO_PROVIDERS_CONFIG = {
  configured: false,
  primary: null,
  backup: null,
  providers: [],
  agents: [{ name: "ingenium-chat", label: "Ingenium Chat" }],
  defaultSelection: null,
};

const WITH_PROVIDERS_CONFIG = {
  configured: true,
  primary: {
    providerId: "deepseek",
    modelId: "deepseek-v4-pro",
    label: "DeepSeek: deepseek-v4-pro",
    isCustom: false,
  },
  backup: null,
  providers: [
    {
      providerId: "deepseek",
      label: "DeepSeek",
      models: [
        { id: "deepseek-v4-pro", label: "deepseek-v4-pro" },
        { id: "deepseek-v4-flash", label: "deepseek-v4-flash" },
      ],
      defaultModel: "deepseek-v4-pro",
      source: "managed" as const,
    },
    {
      providerId: "openai",
      label: "OpenAI",
      models: [
        { id: "gpt-4o", label: "GPT-4o" },
        { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
      ],
      defaultModel: "gpt-4o",
      source: "managed" as const,
    },
  ],
  agents: [{ name: "ingenium-chat", label: "Ingenium Chat" }],
  defaultSelection: { providerId: "deepseek", modelId: "deepseek-v4-pro" },
};

const MOCK_PROMPT_RESPONSE = {
  info: {
    id: "msg-assistant-1",
    sessionID: SESSION_ID,
    role: "assistant",
    time: { created: NOW, completed: NOW + 500 },
    finish: "stop",
  },
  parts: [
    {
      id: "part-assistant-1",
      sessionID: SESSION_ID,
      messageID: "msg-assistant-1",
      type: "text",
      text: "Hello! How can I help you today?",
    },
  ],
};

const OVERFLOW_MESSAGES = Array.from({ length: 160 }, (_, index) => ({
  info: {
    id: `overflow-message-${index}`,
    sessionID: SESSION_ID,
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    time: { created: NOW + index, completed: NOW + index },
  },
  parts: [{
    id: `overflow-part-${index}`,
    sessionID: SESSION_ID,
    messageID: `overflow-message-${index}`,
    type: "text",
    text: `Overflow regression message ${index}: ${"bounded local scrolling ".repeat(18)}`,
  }],
}));

/* ──────────────────────────────────────────────────────────────────────── */
/*  Route-matching helpers                                                  */
/* ──────────────────────────────────────────────────────────────────────── */

/** True when the request's pathname starts with the given prefix. */
function pathStarts(prefix: string) {
  return (url: URL) => url.pathname.startsWith(prefix);
}

/** True when the request's pathname exactly equals the given path. */
function pathExact(target: string) {
  return (url: URL) => url.pathname === target;
}

/** True when the request's method matches. */
function method(m: string) {
  return (route: { request: () => { method: () => string } }) =>
    route.request().method() === m;
}

/** JSON 200 response helper. */
function json200(data: unknown) {
  return (route: { fulfill: (opts: { status: number; contentType: string; body: string }) => void }) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data }),
    });
}

/** JSON 201 response helper. */
function json201(data: unknown) {
  return (route: { fulfill: (opts: { status: number; contentType: string; body: string }) => void }) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ data }),
    });
}

/** 204 No Content. */
function noContent(route: { fulfill: (opts: { status: number }) => void }) {
  route.fulfill({ status: 204 });
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Session routes (list + create at the base path)                         */
/* ──────────────────────────────────────────────────────────────────────── */

function mockSessionListCreate(page: Page) {
  return page.route(
    (url) => pathExact("/api/v1/opencode/sessions")(url),
    (route) => {
      if (route.request().method() === "GET") {
        json200([MOCK_SESSION])(route);
      } else {
        json201({ ...MOCK_SESSION, id: `new-${Date.now()}`, title: "New conversation" })(route);
      }
    },
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Chat-config route                                                       */
/* ──────────────────────────────────────────────────────────────────────── */

function mockChatConfig(page: Page, config: typeof NO_PROVIDERS_CONFIG) {
  return page.route(
    (url) => pathStarts("/api/v1/opencode/chat-config")(url),
    (route) => json200(config)(route),
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Generic sub-route handler for any /sessions/:id/* path                  */
/*  Returns safe default responses so fetches don't throw.                  */
/* ──────────────────────────────────────────────────────────────────────── */

function mockSessionSubRoutes(page: Page, messages: typeof OVERFLOW_MESSAGES = []) {
  // Prompt
  page.route(
    (url) => /\/api\/v1\/opencode\/sessions\/[^/]+\/prompt$/.test(url.pathname),
    (route) => json200(MOCK_PROMPT_RESPONSE)(route),
  );
  // Abort
  page.route(
    (url) => /\/api\/v1\/opencode\/sessions\/[^/]+\/abort$/.test(url.pathname),
    (route) => json200({})(route),
  );
  // Init
  page.route(
    (url) => /\/api\/v1\/opencode\/sessions\/[^/]+\/init$/.test(url.pathname),
    (route) => json200({})(route),
  );
  // Messages (list for a session)
  page.route(
    (url) => /\/api\/v1\/opencode\/sessions\/[^/]+\/messages$/.test(url.pathname),
    (route) => json200(messages)(route),
  );
  // Fork
  page.route(
    (url) => /\/api\/v1\/opencode\/sessions\/[^/]+\/fork$/.test(url.pathname),
    (route) => json200({ ...MOCK_SESSION, id: `forked-${Date.now()}` })(route),
  );
  // Share
  page.route(
    (url) => /\/api\/v1\/opencode\/sessions\/[^/]+\/share$/.test(url.pathname),
    (route) => json200({ ...MOCK_SESSION })(route),
  );
  // Compact
  page.route(
    (url) => /\/api\/v1\/opencode\/sessions\/[^/]+\/compact$/.test(url.pathname),
    (route) => json200({})(route),
  );
  // Revert
  page.route(
    (url) => /\/api\/v1\/opencode\/sessions\/[^/]+\/revert$/.test(url.pathname),
    (route) => json200({ ...MOCK_SESSION })(route),
  );
  // Unrevert
  page.route(
    (url) => /\/api\/v1\/opencode\/sessions\/[^/]+\/unrevert$/.test(url.pathname),
    (route) => json200({ ...MOCK_SESSION })(route),
  );
  // Children
  page.route(
    (url) => /\/api\/v1\/opencode\/sessions\/[^/]+\/children$/.test(url.pathname),
    (route) => json200([])(route),
  );
  // Diff
  page.route(
    (url) => /\/api\/v1\/opencode\/sessions\/[^/]+\/diff$/.test(url.pathname),
    (route) => json200({})(route),
  );
  // Command
  page.route(
    (url) => /\/api\/v1\/opencode\/sessions\/[^/]+\/command$/.test(url.pathname),
    (route) => json200({})(route),
  );
  // PATCH sessions/:id (rename)
  page.route(
    (url) => /\/api\/v1\/opencode\/sessions\/[^/]+$/.test(url.pathname),
    (route) => {
      if (route.request().method() === "PATCH") {
        return json200(MOCK_SESSION)(route);
      }
      if (route.request().method() === "DELETE") {
        return noContent(route);
      }
      // GET by id
      return json200(MOCK_SESSION)(route);
    },
  );
  // Individual message routes (delete message, get message)
  page.route(
    (url) => /\/api\/v1\/opencode\/sessions\/[^/]+\/messages\/[^/]+$/.test(url.pathname),
    (route) => {
      if (route.request().method() === "DELETE") {
        return noContent(route);
      }
      return json200(MOCK_PROMPT_RESPONSE)(route);
    },
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Agents endpoint                                                         */
/* ──────────────────────────────────────────────────────────────────────── */

function mockAgentsEndpoint(page: Page) {
  page.route(
    (url) => pathExact("/api/v1/opencode/agents")(url),
    (route) => json200([{ id: "ingenium-chat", name: "Ingenium Chat" }])(route),
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Convenience: apply all mocks for a given scenario                       */
/* ──────────────────────────────────────────────────────────────────────── */

async function applyMocks(
  page: Page,
  config: typeof NO_PROVIDERS_CONFIG,
  messages: typeof OVERFLOW_MESSAGES = [],
) {
  mockSessionListCreate(page);
  mockChatConfig(page, config);
  mockSessionSubRoutes(page, messages);
  mockAgentsEndpoint(page);
}

function mockHappyPath(page: Page) {
  return applyMocks(page, WITH_PROVIDERS_CONFIG);
}

function mockNoProviders(page: Page, messages: typeof OVERFLOW_MESSAGES = []) {
  return applyMocks(page, NO_PROVIDERS_CONFIG, messages);
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Tests                                                                   */
/* ──────────────────────────────────────────────────────────────────────── */

test.describe("Chat UI — /chat page", () => {
  test.describe.configure({ mode: "serial" });

  /* ────────────────────────────────────────────────────────────────────── */
  /*  1. No providers — disabled UI                                        */
  /* ────────────────────────────────────────────────────────────────────── */
  test("no providers — selectors disabled, banner visible, typing preserves text", async ({ page }) => {
    mockNoProviders(page);

    // Track chat-config request completion
    const configDone = page.waitForResponse(
      (r) => r.url().includes("/chat-config") && r.status() === 200,
    );

    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await configDone;

    // Wait for the composer (session auto-created via mock)
    const composer = page.locator('[data-testid="chat-composer"]');
    await expect(composer).toBeVisible({ timeout: 15000 });

    // Provider selector exists and is disabled
    const providerSelect = page.locator('[data-testid="chat-header-provider"]');
    await expect(providerSelect).toBeVisible({ timeout: 10000 });
    await expect(providerSelect).toBeDisabled({ timeout: 5000 });

    // Model selector exists and is disabled
    const modelSelect = page.locator('[data-testid="chat-header-model"]');
    await expect(modelSelect).toBeVisible({ timeout: 5000 });
    await expect(modelSelect).toBeDisabled({ timeout: 5000 });

    // Agent selector exists and is disabled
    const agentSelect = page.locator('[data-testid="chat-header-agent"]');
    await expect(agentSelect).toBeVisible({ timeout: 5000 });
    await expect(agentSelect).toBeDisabled({ timeout: 5000 });

    // Send button is disabled
    const sendBtn = page.locator('[data-testid="chat-send-btn"]');
    await expect(sendBtn).toBeVisible({ timeout: 5000 });
    await expect(sendBtn).toBeDisabled();

    // "No model is available" banner is visible
    await expect(page.getByText("No model is available")).toBeVisible({ timeout: 5000 });

    // Type text and press Enter — text should be preserved since no selectable model
    await composer.fill("Hello, is this thing on?");
    await expect(composer).toHaveValue("Hello, is this thing on?");
    await composer.press("Enter");
    await expect(composer).toHaveValue("Hello, is this thing on?");
  });

  /* ────────────────────────────────────────────────────────────────────── */
  /*  2. Provider selection and model switching                             */
  /* ────────────────────────────────────────────────────────────────────── */
  test("provider/model selectors allow switching between configured providers", async ({ page }) => {
    mockHappyPath(page);

    const configDone = page.waitForResponse(
      (r) => r.url().includes("/chat-config") && r.status() === 200,
    );

    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await configDone;

    // Wait for selectors to be enabled
    const providerSelect = page.locator('[data-testid="chat-header-provider"]');
    await expect(providerSelect).toBeVisible({ timeout: 15000 });
    await expect(providerSelect).toBeEnabled({ timeout: 10000 });

    const modelSelect = page.locator('[data-testid="chat-header-model"]');
    await expect(modelSelect).toBeVisible({ timeout: 5000 });
    await expect(modelSelect).toBeEnabled({ timeout: 5000 });

    const agentSelect = page.locator('[data-testid="chat-header-agent"]');
    await expect(agentSelect).toBeVisible({ timeout: 5000 });
    await expect(agentSelect).toBeEnabled({ timeout: 5000 });

    // Default selection is DeepSeek
    await expect(providerSelect).toHaveValue("deepseek");
    await expect(modelSelect).toHaveValue("deepseek-v4-pro");

    // Verify provider options
    const providerOptions = providerSelect.locator("option");
    await expect(providerOptions).toHaveCount(2);
    await expect(providerOptions.nth(0)).toHaveText("DeepSeek");
    await expect(providerOptions.nth(1)).toHaveText("OpenAI");

    // Verify model options for DeepSeek
    const modelOptions = modelSelect.locator("option");
    await expect(modelOptions).toHaveCount(2);
    await expect(modelOptions.nth(0)).toHaveText("deepseek-v4-pro");
    await expect(modelOptions.nth(1)).toHaveText("deepseek-v4-flash");

    // Switch provider to OpenAI — model list should update
    await providerSelect.selectOption("openai");
    await expect(modelSelect).toHaveValue("gpt-4o");

    const openaiModelOptions = modelSelect.locator("option");
    await expect(openaiModelOptions).toHaveCount(2);
    await expect(openaiModelOptions.nth(0)).toHaveText("GPT-4o");
    await expect(openaiModelOptions.nth(1)).toHaveText("GPT-5.6 Luna");

    // Switch model within the provider
    await modelSelect.selectOption("gpt-5.6-luna");
    await expect(modelSelect).toHaveValue("gpt-5.6-luna");

    // Switch back to DeepSeek
    await providerSelect.selectOption("deepseek");
    await expect(modelSelect).toHaveValue("deepseek-v4-pro");
  });

  /* ────────────────────────────────────────────────────────────────────── */
  /*  3. Session sidebar visibility and toggle                              */
  /* ────────────────────────────────────────────────────────────────────── */
  test("session sidebar is visible, New Chat button, collapse/expand toggle", async ({ page }) => {
    mockHappyPath(page);

    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    // Sidebar should be visible in the expanded state
    const sidebar = page.locator('[data-testid="session-sidebar"]');
    await expect(sidebar).toBeVisible({ timeout: 15000 });
    await expect(sidebar).toHaveAttribute("aria-label", "Chat sessions");

    // "New Chat" button exists in the sidebar header
    const newChatBtn = page.getByRole("button", { name: /New conversation/i });
    await expect(newChatBtn.first()).toBeVisible({ timeout: 5000 });

    // Collapse toggle is visible and labelled "Collapse sidebar"
    const toggle = page.locator('[data-testid="session-sidebar-toggle"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-label", "Collapse sidebar");
    await toggle.click();

    // Sidebar collapses — aria-label changes
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toHaveAttribute("aria-label", "Chat sidebar collapsed");

    // Toggle now says "Expand sidebar"
    const expandToggle = page.locator('[data-testid="session-sidebar-toggle"]');
    await expect(expandToggle).toHaveAttribute("aria-label", "Expand sidebar");
    await expandToggle.click();

    // Sidebar expands again
    await expect(sidebar).toHaveAttribute("aria-label", "Chat sessions");
  });

  test("mobile viewport shows hamburger and opens sidebar drawer", async ({ page }) => {
    mockHappyPath(page);
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    // Hamburger button is visible on mobile
    const hamburger = page.locator('[data-testid="chat-header-hamburger"]');
    await expect(hamburger).toBeVisible({ timeout: 15000 });

    // Click hamburger to open the drawer overlay
    await hamburger.click();

    // Drawer dialog appears (chat sessions drawer, not the nav drawer)
    const drawer = page.getByRole("dialog", { name: "Chat sessions" });
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Drawer contains a sidebar
    await expect(drawer.locator('[data-testid="session-sidebar"]')).toBeVisible({ timeout: 3000 });

    // Press Escape to close the drawer (the drawer listens for Escape keydown)
    await page.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible({ timeout: 3000 });
    await expect(drawer).not.toBeAttached({ timeout: 3000 });
    await expect(hamburger).toBeVisible();
  });

  test("long histories stay in the message scroller and keep the composer in the viewport", async ({ page }) => {
    mockNoProviders(page, OVERFLOW_MESSAGES);

    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/chat", { waitUntil: "domcontentloaded" });
      await expect(page.locator('[data-testid="chat-messages-container"]')).toBeVisible();
      await expect(page.locator('[data-testid="chat-composer"]')).toBeVisible();

      const geometry = await page.evaluate(() => {
        const messages = document.querySelector<HTMLElement>('[data-testid="chat-messages-container"]');
        const composer = document.querySelector<HTMLElement>('[data-testid="chat-composer"]');
        if (!messages || !composer) throw new Error("Chat layout fixtures did not render");

        const composerBox = composer.getBoundingClientRect();
        return {
          documentHeight: document.documentElement.scrollHeight,
          viewportHeight: window.innerHeight,
          messagesClientHeight: messages.clientHeight,
          messagesScrollHeight: messages.scrollHeight,
          messagesOverflowY: getComputedStyle(messages).overflowY,
          composerTop: composerBox.top,
          composerBottom: composerBox.bottom,
        };
      });

      expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewportHeight + 2);
      expect(geometry.messagesScrollHeight).toBeGreaterThan(geometry.messagesClientHeight);
      expect(geometry.messagesOverflowY).toMatch(/auto|scroll/);
      expect(geometry.composerTop).toBeGreaterThanOrEqual(0);
      expect(geometry.composerBottom).toBeLessThanOrEqual(geometry.viewportHeight);
    }
  });

  /* ────────────────────────────────────────────────────────────────────── */
  /*  4. Enter sends, Shift+Enter adds newline                              */
  /* ────────────────────────────────────────────────────────────────────── */
  test("Shift+Enter adds newlines, Enter sends and clears composer", async ({ page }) => {
    mockHappyPath(page);

    const configDone = page.waitForResponse(
      (r) => r.url().includes("/chat-config") && r.status() === 200,
    );

    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await configDone;

    const composer = page.locator('[data-testid="chat-composer"]');
    await expect(composer).toBeVisible({ timeout: 15000 });

    const sendBtn = page.locator('[data-testid="chat-send-btn"]');

    // Fill text first — send button enables only when hasText is true
    await composer.fill("First line");
    await expect(sendBtn).toBeEnabled({ timeout: 10000 });

    // Shift+Enter should add newlines without sending
    await composer.press("Shift+Enter");
    await composer.press("Shift+Enter");
    await composer.type("Third line");

    const afterShiftEnter = await composer.inputValue();
    expect(afterShiftEnter).toContain("First line");
    expect(afterShiftEnter).toContain("Third line");
    expect(afterShiftEnter.split("\n").length).toBeGreaterThanOrEqual(3);

    // Send button should still be enabled
    await expect(sendBtn).toBeEnabled();

    // Enter sends the message
    await composer.fill("Test message");
    await composer.press("Enter");

    // The composer must clear after a successful send; a timeout is a real
    // regression, not an optional warning.
    await expect(composer).toHaveValue("", { timeout: 8000 });
  });

  /* ────────────────────────────────────────────────────────────────────── */
  /*  5. Chat session persistence                                           */
  /* ────────────────────────────────────────────────────────────────────── */
  test("new chat creates a session, navigating away and back retains it", async ({ page }) => {
    mockHappyPath(page);

    const sessionLoaded = page.waitForResponse(
      (r) => r.url().includes("/sessions") && r.request().method() === "GET" && r.status() === 200,
    );

    await page.goto("/chat", { waitUntil: "domcontentloaded" });
    await sessionLoaded;

    // Sidebar is visible with our mock session
    const sidebar = page.locator('[data-testid="session-sidebar"]');
    await expect(sidebar).toBeVisible({ timeout: 15000 });
    await expect(sidebar.getByText(SESSION_TITLE)).toBeVisible({ timeout: 5000 });

    // Click "New Chat" button
    const newChatBtn = page.getByRole("button", { name: /New conversation/i });
    await expect(newChatBtn.first()).toBeVisible({ timeout: 5000 });
    await newChatBtn.first().click();

    // Composer is still visible after creating new chat
    const composer = page.locator('[data-testid="chat-composer"]');
    await expect(composer).toBeVisible({ timeout: 10000 });

    // Navigate away to home
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible({ timeout: 10000 });

    // Navigate back to chat
    await page.goto("/chat", { waitUntil: "domcontentloaded" });

    await expect(page.locator('[data-testid="chat-composer"]')).toBeVisible({ timeout: 15000 });

    // Sidebar retains the original session
    await expect(sidebar).toBeVisible({ timeout: 10000 });
    await expect(sidebar.getByText(SESSION_TITLE)).toBeVisible({ timeout: 5000 });
  });
});
