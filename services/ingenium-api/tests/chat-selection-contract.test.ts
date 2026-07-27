import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const mocks = vi.hoisted(() => ({
  getGlobalProject: vi.fn(),
  getProject: vi.fn(),
  isValidProjectName: vi.fn(),
  setSetting: vi.fn(),
  getChatProviderCatalog: vi.fn(),
  getStoredOrDefaultChatSelection: vi.fn(),
  isAllowedChatSelection: vi.fn(),
  getBuiltinChatProvider: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("ingenium-core", () => ({
  projects: {
    getGlobalProject: mocks.getGlobalProject,
    getProject: mocks.getProject,
    isValidProjectName: mocks.isValidProjectName,
  },
  settings: { setSetting: mocks.setSetting, getSetting: vi.fn() },
  logger: { warn: mocks.warn, error: vi.fn(), debug: vi.fn(), info: vi.fn() },
  resolveCoreDbPath: () => "/tmp/ingenium-chat-selection-contract.db",
}));

vi.mock("../lib/chat-provider-catalog.js", () => ({
  CHAT_SELECTION_SETTING: "chat_selection",
  getBuiltinChatProvider: mocks.getBuiltinChatProvider,
  getChatProviderCatalog: mocks.getChatProviderCatalog,
  getStoredOrDefaultChatSelection: mocks.getStoredOrDefaultChatSelection,
  isAllowedChatSelection: mocks.isAllowedChatSelection,
  isValidChatSelectionIdentifier: (value: unknown) => typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value),
}));

vi.mock("../lib/opencode-client.js", () => ({
  opencodeClient: {},
  isOpenCodeError: (value: unknown) => typeof value === "object" && value !== null && "error" in value,
}));

let server: Server | null = null;
let baseUrl = "";

const catalog = {
  providers: [{
    providerId: "global-provider",
    label: "Global Provider",
    models: [{ id: "global-model", label: "Global Model" }],
    defaultModel: "global-model",
    source: "managed" as const,
  }],
  builtinUnavailable: false,
};

beforeAll(async () => {
  const { opencodeRouter } = await import("../lib/routes/opencode.js");
  const app = express();
  app.use(express.json());
  app.use("/api/v1/opencode", opencodeRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/v1/opencode`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

beforeEach(() => {
  mocks.getGlobalProject.mockReturnValue({ id: "global-project" });
  mocks.getProject.mockImplementation((name: string) => ({ id: `${name}-id` }));
  mocks.isValidProjectName.mockReturnValue(true);
  mocks.getChatProviderCatalog.mockResolvedValue(catalog);
  mocks.isAllowedChatSelection.mockReturnValue(true);
  mocks.setSetting.mockReturnValue("");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PUT /opencode/chat-selection", () => {
  it("validates the exact pair against the global catalog before persisting only to the global project", async () => {
    const response = await fetch(`${baseUrl}/chat-selection`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "global-provider", modelId: "global-model" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { providerId: "global-provider", modelId: "global-model" },
    });
    expect(mocks.getChatProviderCatalog).toHaveBeenCalledWith("global-project");
    expect(mocks.isAllowedChatSelection).toHaveBeenCalledWith(catalog.providers, {
      providerId: "global-provider",
      modelId: "global-model",
    });
    expect(mocks.setSetting).toHaveBeenCalledWith(
      "global-project",
      "chat_selection",
      JSON.stringify({ providerId: "global-provider", modelId: "global-model" }),
    );
  });

  it("rejects an unavailable pair without changing the persisted selection", async () => {
    mocks.isAllowedChatSelection.mockReturnValue(false);
    const response = await fetch(`${baseUrl}/chat-selection`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "global-provider", modelId: "unavailable-model" }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CHAT_SELECTION_UNAVAILABLE",
        message: "The selected Chat provider or model is not currently available.",
      },
    });
    expect(mocks.setSetting).not.toHaveBeenCalled();
  });

  it("rejects a browser project override before catalog lookup or persistence", async () => {
    const response = await fetch(`${baseUrl}/chat-selection?project=browser-project`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "global-provider", modelId: "global-model" }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CHAT_SELECTION_PROJECT_CONFLICT",
        message: "Chat model selection is owned by the active global project.",
      },
    });
    expect(mocks.getChatProviderCatalog).not.toHaveBeenCalled();
    expect(mocks.setSetting).not.toHaveBeenCalled();
  });
});

describe("GET /opencode/chat-config", () => {
  it("returns a sanitized 503 when catalog discovery throws", async () => {
    mocks.getChatProviderCatalog.mockRejectedValue(new Error("private provider endpoint failed"));

    const response = await fetch(`${baseUrl}/chat-config?project=chat-project`);
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: {
        code: "LLM_CATALOG_UNAVAILABLE",
        message: "The Chat model catalog is temporarily unavailable. Try again later.",
      },
    });
    expect(JSON.stringify(payload)).not.toContain("private provider endpoint failed");
  });

  it("returns the same fixed 503 for AUTH_NOT_CONFIGURED catalog discovery", async () => {
    mocks.getChatProviderCatalog.mockRejectedValue({
      error: {
        code: "AUTH_NOT_CONFIGURED",
        message: "private provider configuration detail",
      },
    });

    const response = await fetch(`${baseUrl}/chat-config?project=chat-project`);
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: {
        code: "LLM_CATALOG_UNAVAILABLE",
        message: "The Chat model catalog is temporarily unavailable. Try again later.",
      },
    });
    expect(JSON.stringify(payload)).not.toContain("AUTH_NOT_CONFIGURED");
    expect(JSON.stringify(payload)).not.toContain("private provider configuration detail");
  });
});
