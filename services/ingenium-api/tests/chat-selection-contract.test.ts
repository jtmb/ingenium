import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

const mocks = vi.hoisted(() => ({
  getGlobalProject: vi.fn(),
  getProject: vi.fn(),
  isValidProjectName: vi.fn(),
  setSetting: vi.fn(),
  getChatProviderCatalog: vi.fn(),
  getAllowedLegacyChatSelection: vi.fn(),
  getStoredOrDefaultChatSelection: vi.fn(),
  isAllowedChatSelection: vi.fn(),
  getBuiltinChatProvider: vi.fn(),
  warn: vi.fn(),
  createSession: vi.fn(),
  selectSessionModel: vi.fn(),
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
  CHAT_DEFAULTS_SETTING: "chat_defaults",
  getNewChatDefaults: mocks.getStoredOrDefaultChatSelection,
  getBuiltinChatProvider: mocks.getBuiltinChatProvider,
  getChatProviderCatalog: mocks.getChatProviderCatalog,
  getAllowedLegacyChatSelection: mocks.getAllowedLegacyChatSelection,
  getStoredOrDefaultChatSelection: mocks.getStoredOrDefaultChatSelection,
  isAllowedChatSelection: mocks.isAllowedChatSelection,
  isValidChatSelectionIdentifier: (value: unknown) => typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value),
}));

vi.mock("../lib/opencode-client.js", () => ({
  buildAuthHeader: () => "Basic fixture-only",
  opencodeClient: { createSession: mocks.createSession, selectSessionModel: mocks.selectSessionModel },
  isOpenCodeError: (value: unknown) => typeof value === "object" && value !== null && "error" in value,
}));

let server: Server | null = null;
let baseUrl = "";

const catalog = {
  providers: [{
    providerId: "global-provider",
    label: "Global Provider",
    models: [{ id: "global-model", label: "Global Model", variants: { high: { reasoningEffort: "high" } } }],
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
  baseUrl = `${await listenOnLoopback(server)}/api/v1/opencode`;
});

afterAll(async () => {
  if (server) await closeHttpServer(server);
});

beforeEach(() => {
  mocks.getGlobalProject.mockReturnValue({ id: "global-project", name: "server-global" });
  mocks.getProject.mockImplementation((name: string) => ({ id: `${name}-id` }));
  mocks.isValidProjectName.mockReturnValue(true);
  mocks.getChatProviderCatalog.mockResolvedValue(catalog);
  mocks.getAllowedLegacyChatSelection.mockReturnValue(null);
  mocks.isAllowedChatSelection.mockReturnValue(true);
  mocks.setSetting.mockReturnValue("");
  mocks.getStoredOrDefaultChatSelection.mockReturnValue(null);
  mocks.createSession.mockResolvedValue({ id: "new-session", title: "New conversation" });
  mocks.selectSessionModel.mockResolvedValue({ id: "new-session", title: "New conversation", model: { id: "global-model", providerID: "global-provider", variant: "high" } });
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
      data: { project: "server-global", providerId: "global-provider", modelId: "global-model" },
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

  it("rejects an encoded project-injection attempt before catalog lookup or persistence", async () => {
    const response = await fetch(`${baseUrl}/chat-selection?${new URLSearchParams({ project: "shared&project=foreign" })}`, {
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
  it.each(["shared#archived", "shared&project=foreign"])(
    "ignores the caller project %s and attests the server global project",
    async (project) => {
      const response = await fetch(`${baseUrl}/chat-config?${new URLSearchParams({ project })}`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: { project: "server-global" },
      });
      expect(mocks.getChatProviderCatalog).toHaveBeenCalledWith("global-project");
      expect(mocks.getProject).not.toHaveBeenCalled();
    },
  );

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

describe("Settings Chat defaults", () => {
  const put = (body: unknown, query = "") => fetch(baseUrl + "/chat-defaults" + query, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  it("saves supported effort separately from legacy chat and synthesis selections", async () => {
    const selection = { providerId: "global-provider", modelId: "global-model", variant: "high" };
    expect((await put(selection)).status).toBe(200);
    expect(mocks.setSetting).toHaveBeenCalledExactlyOnceWith("global-project", "chat_defaults", JSON.stringify(selection));
  });
  it.each(["max", "", null, { reasoningEffort: "high" }])("rejects unsupported or malformed effort %j without writes", async variant => {
    expect((await put({ providerId: "global-provider", modelId: "global-model", variant })).status).toBe(422);
    expect(mocks.setSetting).not.toHaveBeenCalled();
  });
  it("rejects caller project ownership and unavailable catalogs without writes", async () => {
    const selection = { providerId: "global-provider", modelId: "global-model" };
    expect((await put(selection, "?project=foreign")).status).toBe(422);
    mocks.getChatProviderCatalog.mockResolvedValue({ providers: [], unavailable: "network" });
    expect((await put(selection)).status).toBe(503);
    expect(mocks.setSetting).not.toHaveBeenCalled();
  });
});

describe("new conversation saved defaults", () => {
  const create = (body: unknown) => fetch(baseUrl + "/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  it("applies the persisted model and effort before returning the new session", async () => {
    mocks.getStoredOrDefaultChatSelection.mockReturnValue({ providerId: "global-provider", modelId: "global-model", variant: "high" });
    const response = await create({ title: "New conversation", chatDefaults: true });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ data: { id: "new-session", model: { id: "global-model", providerID: "global-provider", variant: "high" } } });
    expect(mocks.selectSessionModel).toHaveBeenCalledExactlyOnceWith("new-session", { id: "global-model", providerID: "global-provider", variant: "high" }, undefined);
    expect(mocks.createSession.mock.invocationCallOrder[0]).toBeLessThan(mocks.selectSessionModel.mock.invocationCallOrder[0]);
  });
  it("does not create a session when the catalog is unavailable", async () => {
    mocks.getChatProviderCatalog.mockResolvedValue({ providers: [], unavailable: "network" });
    expect((await create({ chatDefaults: true })).status).toBe(503);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
  it("preserves the created identity and never blindly repeats creation if applying defaults fails", async () => {
    mocks.getStoredOrDefaultChatSelection.mockReturnValue({ providerId: "global-provider", modelId: "global-model", variant: "high" });
    mocks.selectSessionModel.mockResolvedValue({ error: { code: "NETWORK_ERROR", message: "private upstream detail" } });
    const response = await create({ chatDefaults: true });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatchObject({ code: "CHAT_DEFAULTS_APPLY_FAILED", sessionId: "new-session" });
    expect(JSON.stringify(body)).not.toContain("private upstream detail");
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
  });
  it("leaves ordinary upstream session creation unchanged when defaults are not requested", async () => {
    expect((await create({ title: "Upstream session" })).status).toBe(201);
    expect(mocks.getChatProviderCatalog).not.toHaveBeenCalled();
    expect(mocks.selectSessionModel).not.toHaveBeenCalled();
  });
});
