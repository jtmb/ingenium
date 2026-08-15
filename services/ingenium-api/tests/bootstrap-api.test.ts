import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDbForTest } from "ingenium-core";
import { authMiddleware } from "../lib/middleware/auth.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { bootstrapRouter } from "../lib/routes/bootstrap.js";
import { compatibilityAuthHeaders } from "./http-fixtures.js";

const token = "b".repeat(32);
let server: Server;
let baseUrl = "";
let tempDir = "";
const originalToken = process.env.INGENIUM_API_TOKEN;
const originalTokenFile = process.env.INGENIUM_API_TOKEN_FILE;
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;

beforeEach(async () => {
  resetDbForTest();
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-bootstrap-api-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
  process.env.INGENIUM_API_TOKEN = token;
  delete process.env.INGENIUM_API_TOKEN_FILE;
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use("/api/v1/bootstrap", bootstrapRouter);
  app.use(errorHandler);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  resetDbForTest();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalToken;
  if (originalTokenFile === undefined) delete process.env.INGENIUM_API_TOKEN_FILE;
  else process.env.INGENIUM_API_TOKEN_FILE = originalTokenFile;
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
});

describe("bootstrap operator API", () => {
  it("requires the protected compatibility capability and claims exactly once", async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/v1/bootstrap/status`);
    expect(unauthenticated.status).toBe(401);

    const status = await fetch(`${baseUrl}/api/v1/bootstrap/status`, { headers: compatibilityAuthHeaders(token) });
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ data: { state: "pending", revision: 0 } });

    const body = JSON.stringify({ email: "owner@example.test", displayName: "Owner", password: "correct horse battery staple" });
    const [first, second] = await Promise.all([
      fetch(`${baseUrl}/api/v1/bootstrap/claim`, { method: "POST", headers: compatibilityAuthHeaders(token, { "Content-Type": "application/json" }), body }),
      fetch(`${baseUrl}/api/v1/bootstrap/claim`, { method: "POST", headers: compatibilityAuthHeaders(token, { "Content-Type": "application/json" }), body }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const conflict = first.status === 409 ? first : second;
    expect(await conflict.text()).not.toContain("correct horse");
  });

  it("returns validation errors without reflecting passwords", async () => {
    const response = await fetch(`${baseUrl}/api/v1/bootstrap/claim`, {
      method: "POST",
      headers: compatibilityAuthHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ email: "bad", displayName: "", password: "raw-secret" }),
    });
    const text = await response.text();
    expect(response.status).toBe(422);
    expect(text).not.toContain("raw-secret");
    expect(JSON.parse(text).error.code).toBe("VALIDATION_ERROR");
  });
});
