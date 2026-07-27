import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

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

vi.mock("../lib/opencode-client.js", () => ({ executeSynthesisBroker: mocks.executeSynthesisBroker }));
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
  app.use(express.json());
  app.use("/api/v1/docs", router);
  server = createServer(app);

  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const address = server!.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
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

  it.each([
    ["missing action", { action: undefined }],
    ["invalid action", { action: "run_tools" }],
    ["empty content", { content: "" }],
    ["oversized content", { content: "x".repeat(16_001) }],
    ["oversized title", { title: "t".repeat(513) }],
    ["non-string selection text", { selectedText: { text: "not allowed" } }],
  ])("rejects %s before global, catalog, or broker access", async (_label, body) => {
    const response = await postAi(body);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_AI_REQUEST",
        message: "Provide a supported action and non-empty documentation content within the allowed size.",
      },
    });
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
});

describe("POST /docs/ai sanitized broker failures", () => {
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

  it("returns a generic internal contract for unexpected non-broker failures", async () => {
    mocks.getStoredOrDefaultChatSelection.mockImplementation(() => {
      throw new Error("internal database location must not leak");
    });

    const response = await postAi();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Unable to generate documentation assistance. Please try again later." },
    });
    expect(JSON.stringify(body)).not.toContain("internal database location must not leak");
  });
});
