import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const mocks = vi.hoisted(() => ({
  executeSynthesisBroker: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("ingenium-core", () => ({
  projects: { getProject: (name: string) => name === "rag-security-test" ? { id: "rag-project" } : undefined },
  rag: {
    hybridSearch: () => [{
      source_id: "source-1",
      source_name: "Security Test Source",
      content: "A context document that is sufficient to invoke the broker.",
      heading: null,
      combined_score: 1,
    }],
  },
  logger: { warn: mocks.warn, error: mocks.error },
  getDb: vi.fn(),
  execTransaction: vi.fn(),
  checkpointAfterWrite: vi.fn(),
  ragChunker: { chunkText: vi.fn() },
}));

vi.mock("../lib/opencode-client.js", () => ({ executeSynthesisBroker: mocks.executeSynthesisBroker }));

const nativeFetch = globalThis.fetch;
let server: Server | null = null;
let baseUrl: string;

beforeAll(async () => {
  const { ragRouter } = await import("../lib/routes/rag.js");
  const app = express();
  app.use(express.json());
  app.use("/api/v1/rag", ragRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterEach(() => vi.clearAllMocks());

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

function ask(): Promise<Response> {
  return nativeFetch(`${baseUrl}/api/v1/rag/ask?project=rag-security-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "What does the context say?" }),
  });
}

describe("POST /rag/ask broker failures", () => {
  it("returns a generic error and structured diagnostics without upstream text", async () => {
    const upstreamMessage = "provider rejected credential=secret-value";
    mocks.executeSynthesisBroker.mockResolvedValue({ ok: false, content: "", error: upstreamMessage });

    const response = await ask();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: { code: "LLM_FAILED", message: "Unable to generate an answer right now. Please try again." },
    });
    expect(JSON.stringify(body)).not.toContain(upstreamMessage);
    expect(mocks.warn).toHaveBeenCalledWith("rag-routes", "Broker execution failed", {
      projectId: "rag-project",
      outcome: "failed",
    });
  });

  it("does not log or return thrown upstream text", async () => {
    const upstreamMessage = "provider endpoint https://private.example failed";
    mocks.executeSynthesisBroker.mockRejectedValue(new Error(upstreamMessage));

    const response = await ask();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain(upstreamMessage);
    expect(mocks.error).toHaveBeenCalledWith("rag-routes", "Ask failed", {
      projectId: "rag-project",
      outcome: "exception",
    });
  });
});
