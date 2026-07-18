import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const { getAccount, storeCredentials, stopAccountWorker, startEngine } = vi.hoisted(() => ({
  getAccount: vi.fn(),
  storeCredentials: vi.fn(),
  stopAccountWorker: vi.fn(),
  startEngine: vi.fn(),
}));

vi.mock("ingenium-core", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
  emailCache: {},
  synthesisLlm: {},
  settings: {},
}));

vi.mock("ingenium-email", () => ({
  getGlobalProjectId: vi.fn(() => "global-project"),
  getAccount,
  storeCredentials,
  stopAccountWorker,
  startEngine,
}));

import { emailsRouter } from "../lib/routes/emails.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/emails", emailsRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /emails/accounts/:id/credentials", () => {
  it("replaces a manual account credential in place without returning it", async () => {
    getAccount.mockReturnValue({ id: "manual-1", email: "manual@example.com", authType: "app_password" });

    const response = await fetch(`${baseUrl}/api/v1/emails/accounts/manual-1/credentials`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appPassword: "new-secret" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ data: { success: true, accountId: "manual-1" } });
    expect(JSON.stringify(body)).not.toContain("new-secret");
    expect(storeCredentials).toHaveBeenCalledWith("global-project", "manual-1", {
      imapPass: "new-secret",
      smtpPass: "new-secret",
    });
    expect(stopAccountWorker).toHaveBeenCalledWith("manual-1");
    expect(startEngine).toHaveBeenCalledWith("global-project");
  });

  it("returns 404 when account does not exist", async () => {
    getAccount.mockReturnValue(undefined);

    const response = await fetch(`${baseUrl}/api/v1/emails/accounts/non-existent/credentials`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appPassword: "irrelevant" }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({
      error: { code: "NOT_FOUND", message: "Email account 'non-existent' not found" },
    });
    expect(storeCredentials).not.toHaveBeenCalled();
    expect(stopAccountWorker).not.toHaveBeenCalled();
    expect(startEngine).not.toHaveBeenCalled();
  });

  it("returns 422 when account is OAuth type", async () => {
    getAccount.mockReturnValue({
      id: "oauth-1",
      email: "oauth@example.com",
      authType: "gmail",
    });

    const response = await fetch(`${baseUrl}/api/v1/emails/accounts/oauth-1/credentials`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appPassword: "some-secret" }),
    });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "OAuth accounts must be reconnected through the OAuth flow",
      },
    });
    expect(storeCredentials).not.toHaveBeenCalled();
    expect(stopAccountWorker).not.toHaveBeenCalled();
    expect(startEngine).not.toHaveBeenCalled();
  });

  it("returns 422 when appPassword is missing", async () => {
    getAccount.mockReturnValue({
      id: "manual-2",
      email: "manual2@example.com",
      authType: "app_password",
    });

    const response = await fetch(`${baseUrl}/api/v1/emails/accounts/manual-2/credentials`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toEqual({
      error: { code: "VALIDATION_ERROR", message: "appPassword is required" },
    });
    expect(storeCredentials).not.toHaveBeenCalled();
  });

  it("returns 422 when appPassword is only whitespace", async () => {
    getAccount.mockReturnValue({
      id: "manual-3",
      email: "manual3@example.com",
      authType: "app_password",
    });

    const response = await fetch(`${baseUrl}/api/v1/emails/accounts/manual-3/credentials`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appPassword: "   " }),
    });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toEqual({
      error: { code: "VALIDATION_ERROR", message: "appPassword is required" },
    });
    expect(storeCredentials).not.toHaveBeenCalled();
  });

  it("returns 409 on storage/encryption failure without leaking secrets", async () => {
    getAccount.mockReturnValue({
      id: "manual-4",
      email: "manual4@example.com",
      authType: "app_password",
    });
    storeCredentials.mockImplementationOnce(() => {
      throw new Error("Encryption key not available");
    });

    const response = await fetch(`${baseUrl}/api/v1/emails/accounts/manual-4/credentials`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appPassword: "sensitive-secret" }),
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("CREDENTIAL_UPDATE_FAILED");
    // The message must be generic — no internal detail or secret leakage
    expect(body.error.message).not.toContain("Encryption");
    expect(body.error.message).not.toContain("sensitive-secret");
    expect(body.error.message).not.toContain("key");
    const bodyJson = JSON.stringify(body);
    expect(bodyJson).not.toContain("sensitive-secret");
    expect(bodyJson).not.toContain("Encryption");
    expect(stopAccountWorker).not.toHaveBeenCalled();
    expect(startEngine).not.toHaveBeenCalled();
  });
});
