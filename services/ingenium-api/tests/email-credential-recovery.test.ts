import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const {
  addAccount,
  connectAccount,
  createAccountWithCredentials,
  createTransport,
  clearEmailCache,
  clearWatcherMarkers,
  getAccount,
  getCredentials,
  getEmailRuntime,
  getEngineStatus,
  getOAuthUrl,
  listAccounts,
  normalizeEmailAccountEndpoints,
  removeAccount,
  startEngine,
  stopAccountWorker,
  stopWatcher,
  storeAccount,
  storeCredentials,
} = vi.hoisted(() => ({
  addAccount: vi.fn(),
  connectAccount: vi.fn(),
  createAccountWithCredentials: vi.fn(),
  createTransport: vi.fn(),
  clearEmailCache: vi.fn(),
  clearWatcherMarkers: vi.fn(),
  getAccount: vi.fn(),
  getCredentials: vi.fn(),
  getEmailRuntime: vi.fn(),
  getEngineStatus: vi.fn(() => ({ running: true, heartbeatAt: "2026-08-14T00:00:00.000Z", accounts: [] })),
  getOAuthUrl: vi.fn(),
  listAccounts: vi.fn(() => []),
  normalizeEmailAccountEndpoints: vi.fn((provider: string, endpoints: Record<string, unknown>) => {
    if (provider !== "custom" && Object.values(endpoints).some((value) => value !== undefined)) {
      throw new Error("fixed provider endpoint override");
    }
    return endpoints;
  }),
  removeAccount: vi.fn(),
  storeAccount: vi.fn(),
  storeCredentials: vi.fn(),
  stopAccountWorker: vi.fn(),
  stopWatcher: vi.fn(async () => {}),
  startEngine: vi.fn(),
}));

getEmailRuntime.mockReturnValue({
  watcherMarkers: { clearAccount: clearWatcherMarkers },
});

vi.mock("ingenium-core", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
  emailCache: { clearCache: clearEmailCache, getCachedEmails: vi.fn(() => ({ data: [], total: 0 })) },
  synthesisLlm: {},
  settings: {},
  projects: { getCanonicalGlobalProject: vi.fn(() => ({ organization_id: "test-organization" })) },
  authorization: {
    requireOwnedResourcePermission: vi.fn((principal, resource) => ({
      allowed: principal.type === "compatibility"
        || (resource.ownerKind === "user" && resource.ownerUserId === principal.id)
        || (resource.ownerKind === "organization" && principal.id === "organization-admin"),
    })),
    requireOrganizationPermission: vi.fn((principal) => ({
      allowed: principal.type === "compatibility" || principal.id === "organization-admin",
    })),
  },
}));

vi.mock("ingenium-email", () => ({
  getGlobalProjectId: vi.fn(() => "global-project"),
  addAccount,
  connectAccount,
  createAccountWithCredentials,
  createTransport,
  getAccount,
  getCredentials,
  getEmailRuntime,
  getEngineStatus,
  getOAuthUrl,
  listAccounts,
  normalizeEmailAccountEndpoints,
  removeAccount,
  storeAccount,
  storeCredentials,
  stopAccountWorker,
  stopWatcher,
  startEngine,
  sanitizeProviderError: vi.fn(() => ({
    code: "PROVIDER_ERROR",
    message: "The email operation could not be completed. Try again later.",
    retryable: true,
  })),
}));

import { emailsRouter } from "../lib/routes/emails.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.get("x-test-user");
    req.principal = userId
      ? {
        type: "user",
        id: userId,
        scopes: ["user:*"],
        organizationId: "test-organization",
        session: { id: `session-${userId}` } as never,
      }
      : { type: "compatibility", id: "legacy-server-bearer", scopes: ["legacy:*"] };
    next();
  });
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
  getEngineStatus.mockReturnValue({ running: true, heartbeatAt: "2026-08-14T00:00:00.000Z", accounts: [] });
  listAccounts.mockReturnValue([]);
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
    expect(storeCredentials).toHaveBeenCalledWith("manual-1", {
      imapPass: "new-secret",
      smtpPass: "new-secret",
    }, undefined);
    expect(stopAccountWorker).toHaveBeenCalledWith("manual-1");
    expect(startEngine).toHaveBeenCalledWith();
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

describe("DELETE /emails/accounts/:id", () => {
  it("cleans durable watcher markers through the API runtime before deleting the account", async () => {
    getAccount.mockReturnValue({ id: "deleted-account", email: "deleted@example.test" });

    const response = await fetch(`${baseUrl}/api/v1/emails/accounts/deleted-account`, {
      method: "DELETE",
    });

    expect(response.status).toBe(204);
    expect(stopAccountWorker).toHaveBeenCalledWith("deleted-account");
    expect(stopWatcher).toHaveBeenCalledWith("global-project", "deleted-account");
    expect(clearWatcherMarkers).toHaveBeenCalledWith("global-project", "deleted-account");
    expect(removeAccount).toHaveBeenCalledWith("deleted-account", undefined);
    expect(clearEmailCache).toHaveBeenCalledWith("deleted-account", undefined);
  });
});

describe("PATCH /emails/accounts/:id", () => {
  it("persists edited manual connection metadata", async () => {
    const account = {
      id: "manual-metadata",
      email: "manual@example.com",
      name: "Manual",
      provider: "custom",
      authType: "app_password",
      imapHost: "imap.old.example.com",
      imapPort: 993,
      smtpHost: "smtp.old.example.com",
      smtpPort: 465,
    };
    getAccount.mockReturnValue(account);

    const response = await fetch(`${baseUrl}/api/v1/emails/accounts/manual-metadata`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imapHost: "imap.new.example.com",
        imapPort: 143,
        smtpHost: "smtp.new.example.com",
        smtpPort: 587,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        ...account,
        imapHost: "imap.new.example.com",
        imapPort: 143,
        smtpHost: "smtp.new.example.com",
        smtpPort: 587,
      },
    });
    expect(storeAccount).toHaveBeenCalledWith(account);
  });

  it("rejects invalid connection metadata without persisting it", async () => {
    getAccount.mockReturnValue({ id: "manual-invalid", email: "manual@example.com", provider: "custom", authType: "app_password" });

    const response = await fetch(`${baseUrl}/api/v1/emails/accounts/manual-invalid`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imapPort: 0 }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: { code: "VALIDATION_ERROR", message: "Account metadata is invalid" },
    });
    expect(storeAccount).not.toHaveBeenCalled();
  });

  it("rejects a fixed-provider redirect before credential, transport, or persistence side effects", async () => {
    const account = {
      id: "fixed-redirect",
      email: "fixed@example.com",
      name: "Fixed",
      provider: "gmail",
      authType: "app_password",
      connected: true,
    };
    getAccount.mockReturnValue(account);
    const before = { ...account };

    const response = await fetch(`${baseUrl}/api/v1/emails/accounts/fixed-redirect`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imapHost: "imap.attacker.example",
        imapPort: 993,
        smtpHost: "smtp.attacker.example",
        smtpPort: 587,
      }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: { code: "VALIDATION_ERROR", message: "Endpoint overrides are only supported for custom providers" },
    });
    expect(normalizeEmailAccountEndpoints).toHaveBeenCalledWith("gmail", {
      imapHost: "imap.attacker.example",
      imapPort: 993,
      smtpHost: "smtp.attacker.example",
      smtpPort: 587,
    });
    expect(account).toEqual(before);
    expect(storeAccount).not.toHaveBeenCalled();
    expect(getCredentials).not.toHaveBeenCalled();
    expect(connectAccount).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
    expect(startEngine).not.toHaveBeenCalled();
  });

  it("rejects fixed-provider canonical endpoint overrides", async () => {
    getAccount.mockReturnValue({
      id: "fixed-canonical",
      email: "canonical@example.com",
      name: "Canonical",
      provider: "gmail",
      authType: "oauth2",
      connected: false,
    });

    const response = await fetch(`${baseUrl}/api/v1/emails/accounts/fixed-canonical`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imapHost: "imap.gmail.com", imapPort: 993 }),
    });

    expect(response.status).toBe(422);
    expect(storeAccount).not.toHaveBeenCalled();
  });

  it("rejects a provider-switch payload rather than applying its endpoint fields", async () => {
    getAccount.mockReturnValue({
      id: "fixed-switch",
      email: "switch@example.com",
      name: "Switch",
      provider: "gmail",
      authType: "app_password",
      connected: false,
    });

    const response = await fetch(`${baseUrl}/api/v1/emails/accounts/fixed-switch`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "custom", imapHost: "imap.attacker.example" }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: { code: "VALIDATION_ERROR", message: "provider cannot be changed after account creation" },
    });
    expect(storeAccount).not.toHaveBeenCalled();
  });

  it("rejects fixed-provider endpoint overrides on account creation before encryption or persistence", async () => {
    const response = await fetch(`${baseUrl}/api/v1/emails/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "create-fixed@example.com",
        provider: "gmail",
        authType: "app_password",
        appPassword: "secret",
        imapHost: "imap.gmail.com",
        smtpHost: "smtp.gmail.com",
      }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: { code: "VALIDATION_ERROR", message: "Endpoint overrides are only supported for custom providers" },
    });
    expect(createAccountWithCredentials).not.toHaveBeenCalled();
    expect(addAccount).not.toHaveBeenCalled();
    expect(connectAccount).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
    expect(startEngine).not.toHaveBeenCalled();
  });
});

describe("mail tenancy API", () => {
  it("returns only the authorized private account's engine status", async () => {
    const ownerAccount = {
      id: "owner-account",
      email: "owner@example.test",
      organizationId: "test-organization",
      ownerKind: "user",
      ownerUserId: "mail-owner",
    };
    const foreignAccount = {
      id: "foreign-account",
      email: "foreign@example.test",
      organizationId: "test-organization",
      ownerKind: "user",
      ownerUserId: "mail-foreign",
    };
    getAccount.mockImplementation((id: string) => id === ownerAccount.id ? ownerAccount : id === foreignAccount.id ? foreignAccount : undefined);
    getEngineStatus.mockReturnValue({
      running: true,
      heartbeatAt: "2026-08-14T00:00:00.000Z",
      accounts: [
        { accountId: ownerAccount.id, email: ownerAccount.email, folders: [] },
        { accountId: foreignAccount.id, email: foreignAccount.email, folders: [] },
      ],
    });

    const own = await fetch(`${baseUrl}/api/v1/emails/sync-status?account=${ownerAccount.id}`, {
      headers: { "x-test-user": "mail-owner" },
    });
    expect(own.status).toBe(200);
    expect((await own.json()).data.engine).toEqual({
      accounts: [{ accountId: ownerAccount.id, email: ownerAccount.email, folders: [] }],
    });

    const foreign = await fetch(`${baseUrl}/api/v1/emails/sync-status?account=${foreignAccount.id}`, {
      headers: { "x-test-user": "mail-owner" },
    });
    expect(foreign.status).toBe(404);
  });

  it("defaults ordinary account creation to private ownership and requires organization write access for shared ownership", async () => {
    addAccount.mockImplementation((account, owner) => ({ id: `account-${owner.ownerKind}`, connected: false, ...account, ...owner }));

    const privateResponse = await fetch(`${baseUrl}/api/v1/emails/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user": "mail-owner" },
      body: JSON.stringify({ email: "private@example.test", provider: "custom", authType: "app_password" }),
    });
    expect(privateResponse.status).toBe(201);
    expect(addAccount).toHaveBeenLastCalledWith(expect.any(Object), {
      organizationId: "test-organization",
      ownerKind: "user",
      ownerUserId: "mail-owner",
    });

    const denied = await fetch(`${baseUrl}/api/v1/emails/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user": "mail-owner" },
      body: JSON.stringify({ email: "shared@example.test", provider: "custom", authType: "app_password", owner_kind: "organization" }),
    });
    expect(denied.status).toBe(403);

    const allowed = await fetch(`${baseUrl}/api/v1/emails/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user": "organization-admin" },
      body: JSON.stringify({ email: "shared@example.test", provider: "custom", authType: "app_password", owner_kind: "organization" }),
    });
    expect(allowed.status).toBe(201);
    expect(addAccount).toHaveBeenLastCalledWith(expect.any(Object), {
      organizationId: "test-organization",
      ownerKind: "organization",
      ownerUserId: undefined,
    });
  });

  it("binds OAuth attempts to the same private-default and organization-write ownership rules", async () => {
    getOAuthUrl.mockResolvedValue({ url: "https://oauth.example.test/authorize" });

    const privateResponse = await fetch(`${baseUrl}/api/v1/emails/accounts/oauth/url?provider=gmail`, {
      headers: { "x-test-user": "mail-owner" },
    });
    expect(privateResponse.status).toBe(200);
    expect(getOAuthUrl).toHaveBeenLastCalledWith("gmail", expect.objectContaining({
      organizationId: "test-organization",
      ownerKind: "user",
      ownerUserId: "mail-owner",
      actorId: "mail-owner",
    }));

    const denied = await fetch(`${baseUrl}/api/v1/emails/accounts/oauth/url?provider=gmail&owner_kind=organization`, {
      headers: { "x-test-user": "mail-owner" },
    });
    expect(denied.status).toBe(403);

    const allowed = await fetch(`${baseUrl}/api/v1/emails/accounts/oauth/url?provider=gmail&owner_kind=organization`, {
      headers: { "x-test-user": "organization-admin" },
    });
    expect(allowed.status).toBe(200);
    expect(getOAuthUrl).toHaveBeenLastCalledWith("gmail", expect.objectContaining({
      organizationId: "test-organization",
      ownerKind: "organization",
      ownerUserId: undefined,
      actorId: "organization-admin",
    }));
  });
});
