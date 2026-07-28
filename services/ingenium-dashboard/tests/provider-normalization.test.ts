import { describe, expect, it } from "vitest";
import {
  normalizeChatConfigResponse,
  normalizeManagedProviderConfigResponse,
} from "../src/lib/api";

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
      configured: false,
      primary: null,
      backup: null,
      agents: [],
      providers: [],
      defaultSelection: null,
    });
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
