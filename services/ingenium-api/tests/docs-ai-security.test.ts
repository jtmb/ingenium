import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const mocks = vi.hoisted(() => ({
  resolveLLMConfig: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  safeLlmFetch: vi.fn(),
}));

vi.mock("ingenium-core", () => ({
  synthesisLlm: { resolveLLMConfig: mocks.resolveLLMConfig },
  logger: { warn: mocks.warn, error: mocks.error },
  safeLlmFetch: mocks.safeLlmFetch,
}));

const nativeFetch = globalThis.fetch;
let server: Server | null = null;
let baseUrl: string;

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

beforeEach(() => {
  mocks.resolveLLMConfig.mockReturnValue({ model: "test-model", endpoint: "https://provider.invalid", allowPrivateNetwork: true });
  mocks.safeLlmFetch.mockImplementation((url: string, init: RequestInit) => fetch(url, init));
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

function postAi(): Promise<Response> {
  return nativeFetch(`${baseUrl}/api/v1/docs/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "summarize", content: "Test documentation" }),
  });
}

describe("POST /docs/ai error handling", () => {
  it("does not expose upstream response text", async () => {
    const upstreamBody = "provider diagnostics must remain private";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(upstreamBody, { status: 503 })));

    const response = await postAi();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: { code: "LLM_ERROR", message: "The AI service returned an error. Please try again later." },
    });
    expect(JSON.stringify(body)).not.toContain(upstreamBody);
    expect(mocks.warn).toHaveBeenCalledWith("docs-ai", "LLM upstream request failed with status 503");
  });

  it("releases upstream body on non-ok response (connection hygiene)", async () => {
    const upstreamResponse = new Response("upstream sensitive body", { status: 502 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstreamResponse));

    const response = await postAi();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: { code: "LLM_ERROR", message: "The AI service returned an error. Please try again later." },
    });
    // bodyUsed is true after cancel() — proves the stream was released
    expect(upstreamResponse.bodyUsed).toBe(true);
  });

  it("does not expose thrown error messages", async () => {
    const thrownMessage = "connection failed for provider endpoint";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(thrownMessage)));

    const response = await postAi();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Unable to generate documentation assistance. Please try again later." },
    });
    expect(JSON.stringify(body)).not.toContain(thrownMessage);
    expect(mocks.error).toHaveBeenCalledWith("docs-ai", "AI documentation request failed");
  });

  it("sanitizes endpoint validation failures as upstream errors", async () => {
    mocks.resolveLLMConfig.mockReturnValue({ model: "test-model", endpoint: "http://localhost:11434" });
    mocks.safeLlmFetch.mockRejectedValue(new Error("endpoint points to an internal/private network address"));

    const response = await postAi();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: { code: "LLM_ERROR", message: "The AI service returned an error. Please try again later." },
    });
    expect(JSON.stringify(body)).not.toContain("localhost");
  });
});
