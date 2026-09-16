import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureEmailRuntime, resetEmailRuntimeForTest } from "../lib/runtime.js";
import { createMemoryEmailRuntime } from "./runtime-fixture.js";

const { getCredentials, gmailProvider } = vi.hoisted(() => ({
  getCredentials: vi.fn(() => undefined),
  gmailProvider: {
    changesSince: vi.fn(),
    getBody: vi.fn(),
    listFolders: vi.fn(),
    listMessages: vi.fn(),
  },
}));

const accounts: Array<{ id: string; email: string; authType: "oauth2" | "app_password" }> = [];
const getAccount = vi.fn((accountId: string) =>
  accounts.find((account) => account.id === accountId),
);

vi.mock("../lib/accounts.js", () => ({
  listAccounts: vi.fn(() => accounts),
  getAccount,
  getCredentials,
  getGlobalProjectId: vi.fn(() => "global-project"),
}));
vi.mock("../lib/providers/gmail.js", () => ({ GmailProvider: gmailProvider }));

describe("sync engine reconciliation", () => {
  beforeEach(() => {
    resetEmailRuntimeForTest();
    configureEmailRuntime(createMemoryEmailRuntime());
    getCredentials.mockReturnValue(undefined);
    gmailProvider.changesSince.mockReset();
    gmailProvider.getBody.mockReset();
    gmailProvider.listFolders.mockReset();
    gmailProvider.listMessages.mockReset();
  });

  afterEach(async () => {
    const { stopEngine } = await import("../lib/sync-engine.js");
    await stopEngine();
    accounts.splice(0);
    getAccount.mockClear();
    getCredentials.mockClear();
    resetEmailRuntimeForTest();
  });

  it("launches a worker for an account added after the engine starts", async () => {
    const { startEngine } = await import("../lib/sync-engine.js");

    startEngine();
    await Promise.resolve();
    expect(getAccount).not.toHaveBeenCalled();

    accounts.push({ id: "oauth-account", email: "user@example.com", authType: "oauth2" });
    startEngine();
    await Promise.resolve();
    await Promise.resolve();

    expect(getAccount).toHaveBeenCalledWith("oauth-account");
  });

  it("keeps an app-password account visible with a recoverable credential error", async () => {
    const { startEngine, getEngineStatus } = await import("../lib/sync-engine.js");
    accounts.push({ id: "manual-account", email: "manual@example.com", authType: "app_password" });

    startEngine();
    await Promise.resolve();
    await Promise.resolve();

    expect(getEngineStatus().accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        accountId: "manual-account",
        folders: [expect.objectContaining({
          folder: "INBOX",
          state: "error",
          lastError: expect.stringMatching(/credential update/i),
        })],
      }),
    ]));
  });

  it("hands Gmail deletions and the history cursor to the injected atomic cache adapter", async () => {
    resetEmailRuntimeForTest();
    const runtime = createMemoryEmailRuntime();
    const applyEmailCacheDelta = vi.fn(() => ({ upserts: 0, deletes: 1 }));
    runtime.cache.applyEmailCacheDelta = applyEmailCacheDelta;
    configureEmailRuntime(runtime);
    accounts.push({ id: "delta-account", email: "delta@example.test", authType: "oauth2" });
    getCredentials.mockReturnValue({
      tokens: { accessToken: "test-token", refreshToken: "", expiryDate: 0, scope: "mail.test" },
    });
    gmailProvider.listFolders.mockResolvedValue([{ path: "INBOX" }]);
    gmailProvider.changesSince.mockResolvedValue({
      upserts: [],
      deletes: [{ id: "remote-delete" }],
      newCursor: "cursor-after-delete",
    });

    const { startEngine } = await import("../lib/sync-engine.js");
    startEngine();

    await vi.waitFor(() => expect(applyEmailCacheDelta).toHaveBeenCalledOnce());

    expect(applyEmailCacheDelta).toHaveBeenCalledWith("delta-account", {
      upserts: [],
      deletes: [{ uid: "remote-delete" }],
      historyId: "cursor-after-delete",
      provider: "gmail",
    });
  });

  it("commits a full-resync cursor only after its folder cache write completes", async () => {
    resetEmailRuntimeForTest();
    const runtime = createMemoryEmailRuntime();
    const setAccountCursor = vi.fn();
    runtime.cache.setAccountCursor = setAccountCursor;
    configureEmailRuntime(runtime);
    accounts.push({ id: "full-resync-account", email: "full-resync@example.test", authType: "oauth2" });
    getCredentials.mockReturnValue({
      tokens: { accessToken: "test-token", refreshToken: "", expiryDate: 0, scope: "mail.test" },
    });
    gmailProvider.listFolders.mockResolvedValue([{ path: "INBOX" }]);
    gmailProvider.changesSince.mockResolvedValue({
      upserts: [],
      deletes: [],
      newCursor: "cursor-after-full-resync",
      fullResyncRequired: true,
    });
    let resolveMessages: ((messages: []) => void) | undefined;
    gmailProvider.listMessages.mockReturnValue(new Promise<[]>(resolve => {
      resolveMessages = resolve;
    }));

    const { startEngine } = await import("../lib/sync-engine.js");
    startEngine();

    await vi.waitFor(() => expect(gmailProvider.listMessages).toHaveBeenCalledOnce());
    expect(setAccountCursor).not.toHaveBeenCalled();

    resolveMessages!([]);

    await vi.waitFor(() => expect(setAccountCursor).toHaveBeenCalledWith(
      "full-resync-account",
      "cursor-after-full-resync",
      "gmail",
    ));
  });
});
