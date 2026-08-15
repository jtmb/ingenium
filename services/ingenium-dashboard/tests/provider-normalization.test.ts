import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  normalizeChatConfigResponse,
  normalizeManagedProviderConfigResponse,
} from "../src/lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dashboard provider response normalization", () => {
  it("normalizes legacy managed provider fields and missing synthesis collections", () => {
    expect(normalizeManagedProviderConfigResponse({
      data: {
        providers: [{
          id: "local",
          label: "Local model",
          models: { "model-1": true },
          defaultModel: "model-1",
          role: "primary",
        }],
      },
    })).toEqual({
      providers: [{
        id: "local",
        name: "Local model",
        npm: "@ai-sdk/openai-compatible",
        baseURL: "",
        models: ["model-1"],
        defaultModel: "model-1",
        roles: ["available", "primary"],
        enabled: true,
        allowPrivateNetwork: false,
        apiKeySet: false,
        ownerKind: "installation",
        ownerUserId: null,
        organizationId: undefined,
        effectiveCapabilities: [],
      }],
      synthesis: {
        primary: { providerId: "", modelId: "" },
        secondary: { providerId: "", modelId: "" },
      },
    });
  });

  it("turns malformed provider and model collections into explicit empty arrays", () => {
    expect(normalizeManagedProviderConfigResponse({
      providers: undefined,
      synthesis: { primary: undefined, secondary: undefined },
    })).toMatchObject({ providers: [], synthesis: {
      primary: { providerId: "", modelId: "" },
      secondary: { providerId: "", modelId: "" },
    } });
    expect(normalizeChatConfigResponse({
      providers: undefined,
      agents: undefined,
    })).toEqual({
      project: null,
      configured: false,
      primary: null,
      backup: null,
      agents: [],
      providers: [],
      defaultSelection: null,
    });
  });

  it("preserves only a valid server-attested global project", () => {
    expect(normalizeChatConfigResponse({ project: "server-shared" }).project).toBe("server-shared");
    expect(normalizeChatConfigResponse({}).project).toBeNull();
    expect(normalizeChatConfigResponse({ project: " server-shared " }).project).toBeNull();
    expect(normalizeChatConfigResponse({ project: "../other-project" }).project).toBeNull();
    expect(normalizeChatConfigResponse({ project: 42 }).project).toBeNull();
  });

  it("requests Chat config without a browser-selected project query", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { project: "server-shared" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.settings.chatConfig()).resolves.toMatchObject({
      data: { project: "server-shared" },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/opencode/chat-config");
  });

  it("normalizes current chat provider models before ChatShell searches them", () => {
    const result = normalizeChatConfigResponse({
      configured: true,
      providers: [{
        providerId: "openai",
        label: "OpenAI",
        models: [{ id: "gpt-5", label: "GPT-5" }],
        defaultModel: "gpt-5",
        source: "builtin",
      }],
      agents: [{ name: "ingenium-chat", label: "Ingenium Chat" }],
    });

    expect(result.providers[0]?.models).toEqual([{ id: "gpt-5", label: "GPT-5" }]);
    expect(result.agents).toEqual([{ name: "ingenium-chat", label: "Ingenium Chat" }]);
  });
});
