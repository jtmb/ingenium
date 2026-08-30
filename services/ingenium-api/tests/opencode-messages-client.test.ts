import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { authMiddleware } from "../lib/middleware/auth.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { createOpenCodeMessagesClient } from "../lib/opencode-messages-client.js";
import { opencodeRouter } from "../lib/routes/opencode.js";

const API_TOKEN = "a".repeat(32);
const ORIGINAL_OPENCODE_DB_PATH = process.env.INGENIUM_OPENCODE_DB_PATH;
let server: Server;
let origin = "";
let observedAuthorization: string | undefined;

beforeAll(async () => {
  const app = express();
  app.use(authMiddleware);
  app.use((req, _res, next) => {
    observedAuthorization = req.headers.authorization;
    next();
  });
  app.use("/api/v1/opencode", opencodeRouter);
  app.use(errorHandler);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

beforeEach(() => {
  process.env.INGENIUM_API_TOKEN = API_TOKEN;
  delete process.env.INGENIUM_API_TOKEN_FILE;
  process.env.INGENIUM_OPENCODE_DB_PATH = "/tmp/ingenium-opencode-messages-client-missing.db";
  observedAuthorization = undefined;
});

afterEach(() => {
  delete process.env.INGENIUM_API_TOKEN;
  delete process.env.INGENIUM_API_TOKEN_FILE;
  if (ORIGINAL_OPENCODE_DB_PATH === undefined) delete process.env.INGENIUM_OPENCODE_DB_PATH;
  else process.env.INGENIUM_OPENCODE_DB_PATH = ORIGINAL_OPENCODE_DB_PATH;
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("authenticated OpenCode messages client", () => {
  it("uses the server-owned bearer header and returns normalized messages", async () => {
    const result = await createOpenCodeMessagesClient(origin)({
      since: 0,
      limit: 10,
      projectName: "messages-auth-project",
    });

    expect(result).toEqual({
      messages: [],
    });
    expect(observedAuthorization).toBe(`Bearer ${API_TOKEN}`);
    expect(JSON.stringify(result)).not.toContain(API_TOKEN);
  });

  it("keeps the messages route bearer-protected for unauthenticated callers", async () => {
    const response = await fetch(`${origin}/api/v1/opencode/messages?since=0&limit=10&project=messages-auth-project`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: "UNAUTHORIZED" }),
    }));
    expect(observedAuthorization).toBeUndefined();
  });

  it("classifies an unauthenticated messages response without exposing the bearer", async () => {
    const app = express();
    app.get("/api/v1/opencode/messages", (_req, res) => res.status(401).json({ error: "ignored" }));
    const unauthorizedServer = createServer(app);
    let unauthorizedOrigin = "";
    await new Promise<void>((resolve) => {
      unauthorizedServer.listen(0, "127.0.0.1", () => {
        unauthorizedOrigin = `http://127.0.0.1:${(unauthorizedServer.address() as AddressInfo).port}`;
        resolve();
      });
    });

    try {
      const result = await createOpenCodeMessagesClient(unauthorizedOrigin)({
        since: 0,
        limit: 10,
        projectName: "messages-auth-project",
      });

      expect(result).toEqual({ messages: [], failure: "authentication" });
      expect(JSON.stringify(result)).not.toContain(API_TOKEN);
    } finally {
      await new Promise<void>((resolve) => unauthorizedServer.close(() => resolve()));
    }
  });

  it("classifies a native timeout signal as a timeout", async () => {
    const fetchMock = vi.fn((_: unknown, init?: RequestInit) => {
      const signal = init?.signal;
      if (!signal) return Promise.reject(new Error("request signal missing"));
      return new Promise<Response>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createOpenCodeMessagesClient(origin, 1)({
      since: 0,
      limit: 10,
      projectName: "messages-timeout-project",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ messages: [], failure: "timeout" });
  });
});
