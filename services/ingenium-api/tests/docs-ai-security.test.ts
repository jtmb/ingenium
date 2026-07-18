import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const mocks = vi.hoisted(() => ({
  executeSynthesisBroker: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("ingenium-core", () => ({
  projects: {
    getProject: (name: string) => name === "docs-ai-test" ? { id: "docs-project" } : undefined,
    isValidProjectName: (name: unknown): name is string => typeof name === "string" && name.length > 0 && name.length <= 64 && name === name.trim() && name !== "." && name !== ".." && !/[\\/\u0000-\u001f\u007f]/.test(name),
  },
  logger: { warn: mocks.warn, error: mocks.error },
}));

vi.mock("../lib/opencode-client.js", () => ({ executeSynthesisBroker: mocks.executeSynthesisBroker }));

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
  mocks.executeSynthesisBroker.mockResolvedValue({ ok: false, content: "", error: "upstream unavailable" });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

function postAi(): Promise<Response> {
  return nativeFetch(`${baseUrl}/api/v1/docs/ai?project=docs-ai-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "summarize", content: "Test documentation" }),
  });
}

describe("POST /docs/ai error handling", () => {
  it("does not expose upstream response text", async () => {
    const upstreamBody = "provider diagnostics must remain private";
    mocks.executeSynthesisBroker.mockResolvedValue({ ok: false, content: "", error: upstreamBody });

    const response = await postAi();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: { code: "LLM_ERROR", message: "The AI service returned an error. Please try again later." },
    });
    expect(JSON.stringify(body)).not.toContain(upstreamBody);
    expect(mocks.warn).toHaveBeenCalledWith("docs-ai", "Broker request failed", { projectId: "docs-project" });
  });

  it("releases upstream body on non-ok response (connection hygiene)", async () => {
    mocks.executeSynthesisBroker.mockResolvedValue({ ok: false, content: "", error: "upstream sensitive body" });

    const response = await postAi();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: { code: "LLM_ERROR", message: "The AI service returned an error. Please try again later." },
    });
    expect(JSON.stringify(body)).not.toContain("upstream sensitive body");
  });

  it("does not expose thrown error messages", async () => {
    const thrownMessage = "connection failed for provider endpoint";
    mocks.executeSynthesisBroker.mockRejectedValue(new Error(thrownMessage));

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
    mocks.executeSynthesisBroker.mockResolvedValue({ ok: false, content: "", error: "endpoint points to an internal/private network address" });

    const response = await postAi();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: { code: "LLM_ERROR", message: "The AI service returned an error. Please try again later." },
    });
    expect(JSON.stringify(body)).not.toContain("localhost");
  });
});
