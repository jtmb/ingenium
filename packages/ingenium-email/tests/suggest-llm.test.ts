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
});
