import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { errorHandler } from "../lib/middleware/errors.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

const mocks = vi.hoisted(() => ({
  executeSynthesisBroker: vi.fn(),
  getChatProviderCatalog: vi.fn(),
  getStoredOrDefaultChatSelection: vi.fn(),
  isAllowedChatSelection: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  globalProject: { id: "docs-global" } as { id: string } | undefined,
  globalResolutionError: false,
}));

vi.mock("ingenium-core", () => ({
  projects: {
    getGlobalProject: () => {
      if (mocks.globalResolutionError) throw new Error("duplicate global projects");
      return mocks.globalProject;
    },
  },
  logger: { warn: mocks.warn, error: mocks.error },
}));

vi.mock("../lib/opencode-client.js", () => ({
  DOCS_AI_BROKER_TIMEOUT_MS: 60_000,
  executeSynthesisBroker: mocks.executeSynthesisBroker,
}));
vi.mock("../lib/chat-provider-catalog.js", () => ({
  getChatProviderCatalog: mocks.getChatProviderCatalog,
  getStoredOrDefaultChatSelection: mocks.getStoredOrDefaultChatSelection,
  isAllowedChatSelection: mocks.isAllowedChatSelection,
}));

const nativeFetch = globalThis.fetch;
let server: Server | null = null;
let baseUrl: string;

const catalog = {
  providers: [{
    providerId: "chat-provider",
    label: "Chat Provider",
    models: [{ id: "chat-model", label: "Chat Model" }],
    defaultModel: "chat-model",
    source: "managed" as const,
  }],
  builtinUnavailable: false,
};

beforeAll(async () => {
  const { router } = await import("../lib/routes/docs-ai.js");
  const app = express();
  // Match the deployed API body parser so this route's own document bound,
  // rather than Express's default 100 KiB parser limit, is exercised.
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/v1/docs", router);
  app.use(errorHandler);
  server = createServer(app);

  baseUrl = await listenOnLoopback(server);
});

afterAll(async () => {
  if (server) await closeHttpServer(server);
});

beforeEach(() => {
  mocks.globalProject = { id: "docs-global" };
  mocks.globalResolutionError = false;
  mocks.getChatProviderCatalog.mockResolvedValue(catalog);
  mocks.getStoredOrDefaultChatSelection.mockReturnValue({ providerId: "chat-provider", modelId: "chat-model" });
  mocks.isAllowedChatSelection.mockReturnValue(true);
  mocks.executeSynthesisBroker.mockResolvedValue({ ok: true, content: "Generated documentation" });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function postAi(body: Record<string, unknown> = {}): Promise<Response> {
  return nativeFetch(`${baseUrl}/api/v1/docs/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "summarize", content: "Test documentation", ...body }),
  });
}

function postRawAi(body: string): Promise<Response> {
  return nativeFetch(`${baseUrl}/api/v1/docs/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("POST /docs/ai Chat selection and global-project contract", () => {
  it("ignores a browser selection override and uses the server-owned global Chat selection", async () => {
    mocks.getStoredOrDefaultChatSelection.mockReturnValue({ providerId: "server-provider", modelId: "server-model" });
    const response = await postAi({
      providerId: "chat-provider",
      modelId: "chat-model",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { result: "Generated documentation" } });
    expect(mocks.getChatProviderCatalog).toHaveBeenCalledWith("docs-global");
    expect(mocks.getStoredOrDefaultChatSelection).toHaveBeenCalledWith("docs-global", catalog.providers);
    expect(mocks.isAllowedChatSelection).toHaveBeenCalledWith(
      catalog.providers,
      { providerId: "server-provider", modelId: "server-model" },
    );
    expect(mocks.executeSynthesisBroker).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "docs-global",
      timeoutMs: 60_000,
      timeoutPolicy: "docs-ai",
      selection: { providerID: "server-provider", modelID: "server-model" },
    }));
  });

  it("uses a server-derived Chat default when no server-owned selection exists", async () => {
    const response = await postAi();

    expect(response.status).toBe(200);
    expect(mocks.getStoredOrDefaultChatSelection).toHaveBeenCalledWith("docs-global", catalog.providers);
    expect(mocks.executeSynthesisBroker).toHaveBeenCalledWith(expect.objectContaining({
      selection: { providerID: "chat-provider", modelID: "chat-model" },
    }));
  });

  it("invokes the server-derived Zen default when no managed synthesis selection exists", async () => {
    const zenCatalog = {
      providers: [{
        providerId: "opencode",
        label: "OpenCode Zen",
        models: [{ id: "opencode/zen-free", label: "Zen Free" }],
        defaultModel: "opencode/zen-free",
        source: "builtin" as const,
      }],
      unavailable: null,
    };
    mocks.getChatProviderCatalog.mockResolvedValue(zenCatalog);
    mocks.getStoredOrDefaultChatSelection.mockReturnValue({
      providerId: "opencode",
      modelId: "opencode/zen-free",
    });

    const response = await postAi({
      providerId: "browser-provider",
      modelId: "browser-model",
    });

    expect(response.status).toBe(200);
    expect(mocks.getStoredOrDefaultChatSelection).toHaveBeenCalledWith("docs-global", zenCatalog.providers);
    expect(mocks.executeSynthesisBroker).toHaveBeenCalledWith(expect.objectContaining({
      selection: { providerID: "opencode", modelID: "opencode/zen-free" },
      timeoutMs: 60_000,
      timeoutPolicy: "docs-ai",
    }));
  });

  it.each([
    ["missing action", { action: undefined }],
    ["invalid action", { action: "run_tools" }],
    ["empty content", { content: "" }],
    ["oversized title", { title: "t".repeat(513) }],
    ["non-string selection text", { selectedText: { text: "not allowed" } }],
  ])("rejects %s before global, catalog, or broker access", async (_label, body) => {
    const response = await postAi(body);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_AI_REQUEST",
        message: "Provide a supported action and non-empty content, a title for a blank outline, or selected text for rewrite.",
      },
    });
    expect(mocks.getChatProviderCatalog).not.toHaveBeenCalled();
    expect(mocks.getStoredOrDefaultChatSelection).not.toHaveBeenCalled();
    expect(mocks.executeSynthesisBroker).not.toHaveBeenCalled();
  });

  it("accepts a 70 KiB document and bounds Continue to its trailing prompt context", async () => {
    const leadingMarker = "DOCUMENT_START_MARKER";
    const trailingMarker = "DOCUMENT_END_MARKER";
    const content = `${leadingMarker}${"x".repeat((70 * 1024) - leadingMarker.length - trailingMarker.length)}${trailingMarker}`;

    const response = await postAi({ action: "continue", content });

    expect(response.status).toBe(200);
    const brokerRequest = mocks.executeSynthesisBroker.mock.calls[0]?.[0] as { user: string };
    expect(brokerRequest.user).toContain(trailingMarker);
    expect(brokerRequest.user).not.toContain(leadingMarker);
    expect(brokerRequest.user.length).toBeLessThan(5_000);
  });

  it("accepts a 70 KiB document for Summarize while keeping its prompt context bounded", async () => {
    const leadingMarker = "SUMMARY_DOCUMENT_START_MARKER";
    const trailingMarker = "SUMMARY_DOCUMENT_END_MARKER";
    const content = `${leadingMarker}${"x".repeat((70 * 1024) - leadingMarker.length - trailingMarker.length)}${trailingMarker}`;

    const response = await postAi({ action: "summarize", content });

    expect(response.status).toBe(200);
    const brokerRequest = mocks.executeSynthesisBroker.mock.calls[0]?.[0] as { user: string };
    expect(brokerRequest.user).toContain(leadingMarker);
    expect(brokerRequest.user).not.toContain(trailingMarker);
    expect(brokerRequest.user.length).toBeLessThan(5_000);
  });

  it("rejects content over the safe action limit without exposing document text", async () => {
    const privateMarker = "PRIVATE_DOCUMENT_CONTENT";
    const content = `${privateMarker}${"x".repeat((128 * 1024) - privateMarker.length + 1)}`;

    const response = await postAi({ action: "continue", content });
    const payload = await response.json();

    expect(response.status).toBe(413);
    expect(payload).toEqual({
      error: {
        code: "DOCS_AI_CONTENT_TOO_LARGE",
        message: "The continue action accepts documentation content up to 131,072 UTF-8 bytes.",
      },
    });
    expect(JSON.stringify(payload)).not.toContain(privateMarker);
    expect(mocks.getChatProviderCatalog).not.toHaveBeenCalled();
    expect(mocks.getStoredOrDefaultChatSelection).not.toHaveBeenCalled();
    expect(mocks.executeSynthesisBroker).not.toHaveBeenCalled();
  });

  it("fails clearly when the global project is missing", async () => {
    mocks.globalProject = undefined;

    const response = await postAi();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: expect.objectContaining({ code: "GLOBAL_PROJECT_UNAVAILABLE" }),
    });
    expect(mocks.getChatProviderCatalog).not.toHaveBeenCalled();
    expect(mocks.executeSynthesisBroker).not.toHaveBeenCalled();
  });

  it("fails clearly when global project resolution is ambiguous", async () => {
    mocks.globalResolutionError = true;

    const response = await postAi();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: expect.objectContaining({ code: "GLOBAL_PROJECT_UNAVAILABLE" }),
    });
    expect(mocks.executeSynthesisBroker).not.toHaveBeenCalled();
  });

  it("returns a stable unavailable-provider error when no global Chat default exists", async () => {
    mocks.getChatProviderCatalog.mockResolvedValue({ providers: [], builtinUnavailable: true });
    mocks.getStoredOrDefaultChatSelection.mockReturnValue(null);

    const response = await postAi();
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: {
        code: "LLM_UNAVAILABLE",
        message: "No Chat provider or model is currently available. Open Chat or Settings → Providers, then try again.",
      },
    });
    expect(payload.error.message).not.toMatch(/project query parameter/i);
    expect(mocks.executeSynthesisBroker).not.toHaveBeenCalled();
  });

  it("returns a distinct catalog failure without calling the broker", async () => {
    mocks.getChatProviderCatalog.mockResolvedValue({ providers: [], unavailable: "catalog" });

    const response = await postAi();
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: {
        code: "LLM_CATALOG_UNAVAILABLE",
        message: "The Chat model catalog is temporarily unavailable. Try again later.",
      },
    });
    expect(mocks.executeSynthesisBroker).not.toHaveBeenCalled();
  });

  it("sanitizes a thrown catalog lookup failure without calling the broker", async () => {
    mocks.getChatProviderCatalog.mockRejectedValue(new Error("private provider endpoint failed"));

    const response = await postAi();
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: {
        code: "LLM_CATALOG_UNAVAILABLE",
        message: "The Chat model catalog is temporarily unavailable. Try again later.",
      },
    });
    expect(JSON.stringify(payload)).not.toContain("private provider endpoint failed");
    expect(mocks.executeSynthesisBroker).not.toHaveBeenCalled();
  });

  it("does not call the broker when the resolved server selection fails catalog validation", async () => {
    mocks.getStoredOrDefaultChatSelection.mockReturnValue({ providerId: "stale-provider", modelId: "stale-model" });
    mocks.isAllowedChatSelection.mockReturnValue(false);

    const response = await postAi();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "LLM_UNAVAILABLE",
        message: "No Chat provider or model is currently available. Open Chat or Settings → Providers, then try again.",
      },
    });
    expect(mocks.executeSynthesisBroker).not.toHaveBeenCalled();
  });

  it("preserves selected text in the tool-denied broker prompt", async () => {
    const response = await postAi({
      action: "rewrite",
      selectedText: "Only this selection",
    });

    expect(response.status).toBe(200);
    expect(mocks.executeSynthesisBroker).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.stringContaining("Only this selection"),
    }));
  });

  it("uses the complete bounded Rewrite selection instead of truncating it to document context", async () => {
    const selectionTail = "REWRITE_SELECTION_END";
    const selectedText = `${"s".repeat(16_000 - selectionTail.length)}${selectionTail}`;
    const response = await postAi({ action: "rewrite", selectedText });

    expect(response.status).toBe(200);
    expect(mocks.executeSynthesisBroker).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.stringContaining(selectionTail),
    }));
  });

  it("allows an outline for blank content when a non-whitespace title is supplied", async () => {
    const response = await postAi({ action: "outline", content: "  \n", title: "Release notes" });

    expect(response.status).toBe(200);
    expect(mocks.executeSynthesisBroker).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.stringContaining("Page title: Release notes"),
    }));
  });

  it("rejects a blank outline without a usable title", async () => {
    const response = await postAi({ action: "outline", content: "\t", title: "  " });

    expect(response.status).toBe(400);
    expect(mocks.executeSynthesisBroker).not.toHaveBeenCalled();
  });

  it.each([
    "continue",
    "summarize",
    "fix_grammar",
    "tone_professional",
    "tone_casual",
    "tone_technical",
  ])("rejects whitespace-only content for %s", async (action) => {
    const response = await postAi({ action, content: " \n\t" });

    expect(response.status).toBe(400);
    expect(mocks.executeSynthesisBroker).not.toHaveBeenCalled();
  });

  it("requires non-whitespace selected text for rewrite", async () => {
    const response = await postAi({ action: "rewrite", content: "Full page", selectedText: " \n" });

    expect(response.status).toBe(400);
    expect(mocks.executeSynthesisBroker).not.toHaveBeenCalled();
  });

  it("allows Rewrite to use a non-whitespace selection even when the page content is blank", async () => {
    const response = await postAi({ action: "rewrite", content: " \n", selectedText: "Selected text" });

    expect(response.status).toBe(200);
    expect(mocks.executeSynthesisBroker).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.stringContaining("Selected text"),
    }));
  });

  it("maps malformed JSON to a sanitized 400 response before any AI dependency is used", async () => {
    const privateMarker = "PRIVATE_MALFORMED_DOCUMENT_CONTENT";
    const response = await postRawAi(`{"action":"summarize","content":"${privateMarker}"`);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: expect.objectContaining({
        code: "MALFORMED_JSON",
        message: "Malformed JSON request body",
      }),
    });
    expect(JSON.stringify(body)).not.toContain(privateMarker);
    expect(mocks.getChatProviderCatalog).not.toHaveBeenCalled();
    expect(mocks.executeSynthesisBroker).not.toHaveBeenCalled();
  });
});

describe("POST /docs/ai sanitized broker failures", () => {
  it("maps a broker timeout to the stable Docs timeout contract without provider details", async () => {
    const privateProviderId = "provider-private.example/api-key=must-not-leak";
    mocks.getStoredOrDefaultChatSelection.mockReturnValue({
      providerId: privateProviderId,
      modelId: "private-model",
    });
    mocks.executeSynthesisBroker.mockResolvedValue({ ok: false, content: "", error: "timeout" });

    const response = await postAi();
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body).toEqual({
      error: {
        code: "LLM_BROKER_TIMEOUT",
        message: "The AI service timed out. Please try again later.",
      },
    });
    expect(JSON.stringify(body)).not.toContain(privateProviderId);
    expect(mocks.warn).toHaveBeenCalledWith("docs-ai", "Broker request timed out", { projectId: "docs-global" });
  });

  it("does not expose upstream response text", async () => {
    const upstreamBody = "provider diagnostics endpoint=https://private.example apiKey=must-not-leak";
    mocks.executeSynthesisBroker.mockResolvedValue({ ok: false, content: "", error: upstreamBody });

    const response = await postAi();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: { code: "LLM_BROKER_ERROR", message: "The AI service is unavailable. Please try again later." },
    });
    expect(JSON.stringify(body)).not.toContain(upstreamBody);
    expect(mocks.warn).toHaveBeenCalledWith("docs-ai", "Broker request failed", { projectId: "docs-global" });
  });

  it("maps thrown broker errors to the same sanitized broker contract", async () => {
    const thrownMessage = "connection failed for provider endpoint api-key=private";
    mocks.executeSynthesisBroker.mockRejectedValue(new Error(thrownMessage));

    const response = await postAi();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: { code: "LLM_BROKER_ERROR", message: "The AI service is unavailable. Please try again later." },
    });
    expect(JSON.stringify(body)).not.toContain(thrownMessage);
    expect(mocks.warn).toHaveBeenCalledWith("docs-ai", "Broker request threw unexpectedly", {
      projectId: "docs-global",
      error: "Error",
    });
  });

  it("rejects a browser project override before global, catalog, or broker access", async () => {
    const response = await postAi({ project: "browser-controlled-project" });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "DOCS_AI_PROJECT_CONFLICT",
        message: "Documentation AI always uses the server-selected global project.",
      },
    });
    expect(mocks.getChatProviderCatalog).not.toHaveBeenCalled();
    expect(mocks.getStoredOrDefaultChatSelection).not.toHaveBeenCalled();
    expect(mocks.executeSynthesisBroker).not.toHaveBeenCalled();
  });

  it("maps global Chat-selection resolution failures to a sanitized unavailable-catalog contract", async () => {
    mocks.getStoredOrDefaultChatSelection.mockImplementation(() => {
      throw new Error("internal database location must not leak");
    });

    const response = await postAi();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: { code: "LLM_CATALOG_UNAVAILABLE", message: "The Chat model catalog is temporarily unavailable. Try again later." },
    });
    expect(JSON.stringify(body)).not.toContain("internal database location must not leak");
    expect(mocks.warn).toHaveBeenCalledWith("docs-ai", "Unable to resolve the global Chat selection", { projectId: "docs-global" });
  });

  it("maps an empty successful broker result to the same sanitized broker contract", async () => {
    mocks.executeSynthesisBroker.mockResolvedValue({ ok: true, content: "   " });

    const response = await postAi();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: { code: "LLM_BROKER_ERROR", message: "The AI service is unavailable. Please try again later." },
    });
    expect(mocks.warn).toHaveBeenCalledWith("docs-ai", "Broker request returned no usable content", { projectId: "docs-global" });
  });
});
