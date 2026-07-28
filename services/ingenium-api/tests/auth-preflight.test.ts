import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { authMiddleware } from "../lib/middleware/auth.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { authPreflightRouter } from "../lib/routes/auth-preflight.js";

const token = "a".repeat(32);
let server: Server | undefined;
let baseUrl = "";
let originalToken: string | undefined;
let originalTokenFile: string | undefined;

beforeEach(async () => {
  originalToken = process.env.INGENIUM_API_TOKEN;
  originalTokenFile = process.env.INGENIUM_API_TOKEN_FILE;
  process.env.INGENIUM_API_TOKEN = token;
  delete process.env.INGENIUM_API_TOKEN_FILE;
  const app = express();
  app.use(authMiddleware);
  app.use("/api/v1/auth", authPreflightRouter);
  app.use(errorHandler);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalToken;
  if (originalTokenFile === undefined) delete process.env.INGENIUM_API_TOKEN_FILE;
  else process.env.INGENIUM_API_TOKEN_FILE = originalTokenFile;
});

describe("extension authentication preflight", () => {
  it("confirms only successful authentication", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/preflight`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { authenticated: true } });
  });

  it("does not disclose credentials when authentication fails", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/preflight`);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(JSON.stringify(body)).not.toContain(token);
    expect(body.error).toMatchObject({ code: "UNAUTHORIZED" });
  });
});
