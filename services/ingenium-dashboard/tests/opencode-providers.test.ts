import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock("../src/lib/api", () => ({ request }));

import {
  normalizeOpenCodeProviderCatalog,
  opencode,
} from "../src/lib/opencode";

describe("OpenCode provider catalog client", () => {
  beforeEach(() => {
    request.mockReset();
  });

  it("normalizes the production GET /opencode/providers response shape", async () => {
    request.mockResolvedValue({
      data: {
        providers: [{
          id: "openai",
          label: "OpenAI",
          models: [{ id: "gpt-5", label: "GPT-5" }],
          defaultModel: "gpt-5",
          connected: true,
        }],
      },
    });

    await expect(opencode.providers.list("/workspace")).resolves.toEqual({
      providers: [{
        id: "openai",
        label: "OpenAI",
        models: [{ id: "gpt-5", label: "GPT-5" }],
        defaultModel: "gpt-5",
        connected: true,
      }],
    });
    expect(request).toHaveBeenCalledWith("/opencode/providers?directory=%2Fworkspace", undefined);
  });

  it("accepts a nested production envelope without leaving an optional collection undefined", () => {
    expect(normalizeOpenCodeProviderCatalog({
      data: {
        providers: [{
          id: "openai",
          label: "OpenAI",
          models: [{ id: "gpt-5", label: "GPT-5" }],
          defaultModel: "gpt-5",
          connected: true,
        }],
      },
    }).providers).toHaveLength(1);
  });

  it("normalizes the legacy all/default/connected response without exposing it to callers", () => {
    expect(normalizeOpenCodeProviderCatalog({
      all: [{
        id: "anthropic",
        name: "Anthropic",
        models: {
          "claude-sonnet": { id: "claude-sonnet", name: "Claude Sonnet" },
        },
      }],
      default: { anthropic: "claude-sonnet" },
      connected: ["anthropic"],
    })).toEqual({
      providers: [{
        id: "anthropic",
        label: "Anthropic",
        models: [{ id: "claude-sonnet", label: "Claude Sonnet" }],
        defaultModel: "claude-sonnet",
        connected: true,
      }],
    });
  });

  it("returns an empty catalog for malformed or unavailable payloads", () => {
    expect(normalizeOpenCodeProviderCatalog(undefined)).toEqual({ providers: [] });
    expect(normalizeOpenCodeProviderCatalog({ providers: undefined })).toEqual({ providers: [] });
    expect(normalizeOpenCodeProviderCatalog({ data: null })).toEqual({ providers: [] });
  });
});
