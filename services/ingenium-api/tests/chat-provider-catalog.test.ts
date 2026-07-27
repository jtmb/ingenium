import { afterEach, describe, expect, it, vi } from "vitest";
import { settings } from "ingenium-core";
import {
  getBuiltinChatProvider,
  getChatProviderCatalog,
  getPersistedChatSelection,
  getStoredOrDefaultChatSelection,
  isAllowedChatSelection,
  isValidChatSelectionIdentifier,
} from "../lib/chat-provider-catalog.js";
import { opencodeClient } from "../lib/opencode-client.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Chat provider catalog runtime guards", () => {
  it("projects only safe active zero-cost builtin models from an untyped upstream response", () => {
    const provider = getBuiltinChatProvider({
      all: [{
        id: "opencode",
        name: "OpenCode Zen",
        models: {
          allowed: {
            id: "opencode/free-model",
            name: "Free model",
            status: "active",
            cost: { input: 0, output: 0 },
          },
          paid: {
            id: "paid-model",
            status: "active",
            cost: { input: 1, output: 0 },
          },
          malformed: { id: 42, status: "active", cost: null },
        },
      }],
      default: { opencode: "opencode/free-model" },
    });

    expect(provider).toEqual({
      providerId: "opencode",
      label: "OpenCode Zen",
      models: [{ id: "opencode/free-model", label: "Free model" }],
      defaultModel: "opencode/free-model",
      source: "builtin",
    });
  });

  it("rejects malformed upstream records and unsafe identifiers", () => {
    expect(getBuiltinChatProvider({ all: [{ id: "opencode", models: [] }] })).toBeNull();
    expect(getBuiltinChatProvider({ all: [{ id: "opencode", models: { bad: { id: "bad model", status: "active", cost: { input: 0, output: 0 } } } }] })).toBeNull();
    expect(isValidChatSelectionIdentifier("provider/model:1.0")).toBe(true);
    expect(isValidChatSelectionIdentifier("provider with spaces")).toBe(false);
    expect(isValidChatSelectionIdentifier("x".repeat(129))).toBe(false);
    expect(isValidChatSelectionIdentifier("sk-provider-scalar-canary-ABCDEFGHI")).toBe(false);
    expect(isValidChatSelectionIdentifier("model-secret-scalar-canary")).toBe(false);
  });

  it("does not allow an identifier pair that was not projected by the catalog", () => {
    const providers = [{
      providerId: "provider",
      label: "Provider",
      models: [{ id: "model", label: "Model" }],
      defaultModel: "model",
      source: "managed" as const,
    }];

    expect(isAllowedChatSelection(providers, { providerId: "provider", modelId: "model" })).toBe(true);
    expect(isAllowedChatSelection(providers, { providerId: "provider", modelId: "missing" })).toBe(false);
    expect(isAllowedChatSelection(providers, { providerId: "provider with spaces", modelId: "model" })).toBe(false);
  });

  it("adds exact allowlisted legacy llm-config pairs to an otherwise empty catalog", async () => {
    vi.spyOn(settings, "getSetting").mockImplementation((_projectId, key) => ({
      llm_provider_configs: undefined,
      synthesis_provider: "openai",
      synthesis_model: "gpt-4.1",
      synthesis_backup_provider: "openai",
      synthesis_backup_model: "gpt-4.1-mini",
    })[key]);
    vi.spyOn(opencodeClient, "listProviders").mockResolvedValue({ all: [] });

    await expect(getChatProviderCatalog("project-id")).resolves.toEqual({
      providers: [{
        providerId: "openai",
        label: "OpenAI",
        models: [
          { id: "gpt-4.1", label: "gpt-4.1" },
          { id: "gpt-4.1-mini", label: "gpt-4.1-mini" },
        ],
        defaultModel: "gpt-4.1",
        source: "managed",
      }],
      unavailable: null,
    });
  });

  it("rejects incomplete, unallowlisted, or invalid legacy llm-config pairs", async () => {
    vi.spyOn(settings, "getSetting").mockImplementation((_projectId, key) => ({
      llm_provider_configs: undefined,
      synthesis_provider: "untrusted-provider",
      synthesis_model: "valid-model",
      synthesis_backup_provider: "openai",
      synthesis_backup_model: "invalid model id",
    })[key]);
    vi.spyOn(opencodeClient, "listProviders").mockResolvedValue({ all: [] });

    await expect(getChatProviderCatalog("project-id")).resolves.toEqual({
      providers: [],
      unavailable: null,
    });
  });

  it("turns AUTH_NOT_CONFIGURED provider discovery into a catalog failure, never an empty catalog", async () => {
    vi.spyOn(settings, "getSetting").mockReturnValue(undefined);
    vi.spyOn(opencodeClient, "listProviders").mockResolvedValue({
      error: {
        code: "AUTH_NOT_CONFIGURED",
        message: "private provider configuration detail",
      },
    });

    await expect(getChatProviderCatalog("project-id")).resolves.toEqual({
      providers: [],
      unavailable: "catalog",
    });
  });

  it("uses the catalog default when no persisted Chat selection exists", () => {
    const providers = [{
      providerId: "opencode",
      label: "OpenCode Zen",
      models: [{ id: "free-model", label: "Free model" }],
      defaultModel: "free-model",
      source: "builtin" as const,
    }];
    vi.spyOn(settings, "getSetting").mockReturnValue(undefined);

    expect(getPersistedChatSelection("project-id")).toBeNull();
    expect(getStoredOrDefaultChatSelection("project-id", providers)).toEqual({
      providerId: "opencode",
      modelId: "free-model",
    });
  });

  it("rejects a stale persisted pair and falls back to the current catalog default", () => {
    const providers = [{
      providerId: "opencode",
      label: "OpenCode Zen",
      models: [{ id: "free-model", label: "Free model" }],
      defaultModel: "free-model",
      source: "builtin" as const,
    }];
    vi.spyOn(settings, "getSetting").mockImplementation((_projectId, key) =>
      key === "chat_selection"
        ? JSON.stringify({ providerId: "removed-provider", modelId: "removed-model" })
        : undefined,
    );

    expect(getPersistedChatSelection("project-id")).toEqual({
      providerId: "removed-provider",
      modelId: "removed-model",
    });
    expect(getStoredOrDefaultChatSelection("project-id", providers)).toEqual({
      providerId: "opencode",
      modelId: "free-model",
    });
  });
});
