import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock("../src/lib/api", () => ({ request }));

import {
  normalizeOpenCodePermissionRequests,
  normalizeOpenCodeProviderCatalog,
  normalizeOpenCodeQuestions,
  createOpenCodeClient,
} from "../src/lib/opencode";

const runtimeId = "11111111-1111-4111-8111-111111111111";

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

    await expect(createOpenCodeClient(runtimeId).providers.list("/workspace")).resolves.toEqual({
      providers: [{
        id: "openai",
        label: "OpenAI",
        models: [{ id: "gpt-5", label: "GPT-5" }],
        defaultModel: "gpt-5",
        connected: true,
      }],
    });
    expect(request).toHaveBeenCalledWith(`/opencode/providers?directory=%2Fworkspace&runtime_id=${runtimeId}`, undefined);
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

  it("normalizes v2 permission resources into the stable prompt shape", () => {
    expect(normalizeOpenCodePermissionRequests({
      data: [{
        id: "per_1",
        sessionID: "ses_1",
        action: "read",
        resources: ["src/**", "tests/**"],
      }],
    })).toEqual([{
      id: "per_1",
      permission: "read",
      pattern: "src/**\ntests/**",
      action: "read",
      sessionID: "ses_1",
    }]);
  });

  it("normalizes v2 question requests and preserves legacy text questions", () => {
    expect(normalizeOpenCodeQuestions([{
      id: "que_1",
      sessionID: "ses_1",
      questions: [
        {
          header: "Scope",
          question: "Which files?",
          options: [{ label: "Source", description: "Application code" }],
        },
        { question: "Continue?", options: [], multiple: true },
      ],
    }, { id: "legacy-1", text: "Continue?" }])).toEqual([
      {
        id: "que_1:0",
        requestId: "que_1",
        question: "Which files?",
        header: "Scope",
        options: [{ label: "Source", description: "Application code" }],
      },
      {
        id: "que_1:1",
        requestId: "que_1",
        question: "Continue?",
        multiple: true,
      },
      { id: "legacy-1", requestId: "legacy-1", question: "Continue?" },
    ]);
  });

  it("drops malformed permission and question entries", () => {
    expect(normalizeOpenCodePermissionRequests([{ id: "per_bad", action: "read" }])).toEqual([]);
    expect(normalizeOpenCodeQuestions([{ id: "que_bad", questions: [{ options: [] }] }])).toEqual([]);
  });

  it("keeps legacy questionID events addressable", () => {
    expect(normalizeOpenCodeQuestions([{ questionID: "legacy-request", text: "Continue?" }])).toEqual([{
      id: "legacy-request",
      requestId: "legacy-request",
      question: "Continue?",
    }]);
  });
});
