import { afterEach, describe, expect, it, vi } from "vitest";
import { configureEmailRuntime, resetEmailRuntimeForTest } from "../lib/runtime.js";
import { createMemoryEmailRuntime } from "./runtime-fixture.js";

afterEach(() => {
  resetEmailRuntimeForTest();
});

describe("generateSmartReplies", () => {
  it("uses the injected API-owned LLM transport and content response", async () => {
    const runtime = createMemoryEmailRuntime();
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify([
        { tone: "concise", subject: "Re: Update", body: "Thanks." },
        { tone: "warm", subject: "Re: Update", body: "Thank you." },
        { tone: "formal", subject: "Re: Update", body: "Acknowledged." },
      ]) } }],
    }), { status: 200 }));
    runtime.llm.fetch = fetch;
    configureEmailRuntime(runtime);

    const { generateSmartReplies } = await import("../lib/suggest-llm.js");
    await expect(generateSmartReplies(
      { from: "sender@example.test", subject: "Update", bodySnippet: "Please review." },
      [],
      { model: "test-model", endpoint: "https://llm.example.test/v1" },
    )).resolves.toHaveLength(3);

    expect(fetch).toHaveBeenCalledWith(
      "https://llm.example.test/v1/chat/completions",
      expect.objectContaining({
        body: expect.stringContaining('"max_tokens":8192'),
      }),
      { allowPrivateNetwork: false, timeoutMs: 60_000 },
    );
  });

  it("shares the OpenAI-compatible transport contract across replies, summaries, and draft review", async () => {
    const runtime = createMemoryEmailRuntime();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify([
        { tone: "concise", subject: "Re: Update", body: "Thanks." },
        { tone: "warm", subject: "Re: Update", body: "Thank you." },
        { tone: "formal", subject: "Re: Update", body: "Acknowledged." },
      ]) } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "Summary." } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "Improved draft." } }] }), { status: 200 }));
    runtime.llm.fetch = fetch;
    configureEmailRuntime(runtime);
    const { generateEmailSummary, generateSmartReplies, reviewDraft } = await import("../lib/suggest-llm.js");
    const controller = new AbortController();
    const config = {
      model: "test-model",
      endpoint: "https://llm.example.test/v1/",
      apiKey: "test-key",
      allowPrivateNetwork: true,
    };

    await expect(generateSmartReplies(
      { from: "sender@example.test", subject: "Update", bodySnippet: "Please review." },
      [],
      config,
      controller.signal,
    )).resolves.toHaveLength(3);
    await expect(generateEmailSummary("Body", "Subject", config)).resolves.toBe("Summary.");
    await expect(reviewDraft("Draft", "Subject", config)).resolves.toBe("Improved draft.");

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(Array(3).fill("https://llm.example.test/v1/chat/completions"));
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(String(init.body)).temperature)).toEqual([0.7, 0.3, 0.4]);
    for (const [, init, policy] of fetch.mock.calls) {
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-key");
      expect(JSON.parse(String(init.body)).max_tokens).toBe(8192);
      expect(policy).toEqual({ allowPrivateNetwork: true, timeoutMs: 60_000 });
    }
    expect(fetch.mock.calls[0]![1].signal).toBe(controller.signal);
  });

  it("keeps each exported empty-content sentinel", async () => {
    const runtime = createMemoryEmailRuntime();
    runtime.llm.fetch = vi.fn(async () => Response.json({ choices: [{ message: { content: "" } }] }));
    configureEmailRuntime(runtime);
    const { generateEmailSummary, generateSmartReplies, reviewDraft } = await import("../lib/suggest-llm.js");
    const config = { model: "test-model", endpoint: "https://llm.example.test" };

    await expect(generateSmartReplies(
      { from: "sender@example.test", subject: "Update", bodySnippet: "Please review." },
      [],
      config,
    )).resolves.toEqual([]);
    await expect(generateEmailSummary("Body", "Subject", config)).resolves.toBe("");
    await expect(reviewDraft("Draft", undefined, config)).resolves.toBe("");
  });
});
