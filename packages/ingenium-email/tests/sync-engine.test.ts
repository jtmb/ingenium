import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureEmailRuntime, resetEmailRuntimeForTest } from "../lib/runtime.js";
import { createMemoryEmailRuntime } from "./runtime-fixture.js";

const { getCredentials, gmailProvider, imap } = vi.hoisted(() => ({
  getCredentials: vi.fn(() => undefined),
  imap: { connectAccount: vi.fn(), disconnectAccount: vi.fn().mockResolvedValue(undefined), listEmails: vi.fn(), listFolders: vi.fn() },
  gmailProvider: {
    changesSince: vi.fn(),
    getBody: vi.fn(),
    listFolders: vi.fn(),
    listMessages: vi.fn(),
  },
}));

const accounts: Array<{ id: string; email: string; authType: "oauth2" | "app_password"; provider: "gmail" | "custom" }> = [];
const getAccount = vi.fn((accountId: string) =>
  accounts.find((account) => account.id === accountId),
);

vi.mock("../lib/accounts.js", () => ({
  listAccounts: vi.fn(() => accounts),
  getAccount,
  getCredentials,
  getGlobalProjectId: vi.fn(() => "global-project"),
  setAccountConnected: vi.fn(),
}));
vi.mock("../lib/providers/gmail.js", () => ({ GmailProvider: gmailProvider }));
vi.mock("../lib/imap.js", () => imap);

describe("sync engine reconciliation", () => {
  beforeEach(() => {
    resetEmailRuntimeForTest();
    configureEmailRuntime(createMemoryEmailRuntime());
    getCredentials.mockReturnValue(undefined);
    gmailProvider.changesSince.mockReset();
    gmailProvider.getBody.mockReset();
    gmailProvider.listFolders.mockReset();
    gmailProvider.listMessages.mockReset();
    imap.connectAccount.mockReset(); imap.listEmails.mockReset(); imap.listFolders.mockReset(); imap.disconnectAccount.mockClear();
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

    accounts.push({ id: "oauth-account", email: "user@example.com", authType: "oauth2", provider: "gmail" });
    startEngine();
    await Promise.resolve();
    await Promise.resolve();

    expect(getAccount).toHaveBeenCalledWith("oauth-account");
  });

  it("keeps an app-password account visible with a recoverable credential error", async () => {
    const { startEngine, getEngineStatus } = await import("../lib/sync-engine.js");
    accounts.push({ id: "manual-account", email: "manual@example.com", authType: "app_password", provider: "custom" });

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

  it("syncs an app-password IMAP account, preserves folder identity and invalidates changed UIDVALIDITY", async () => {
    const runtime = createMemoryEmailRuntime(); resetEmailRuntimeForTest();
    runtime.cache.getSyncState = () => ({ last_synced_at: null, uidvalidity: 41 });
    const clearFolderCache = vi.fn(() => ({ listings: 1, bodies: 1 }));
    runtime.cache.clearFolderCache = clearFolderCache;
    const headers = vi.fn(() => 1); runtime.cache.upsertEmailCache = headers;
    const bodies = vi.fn(); runtime.cache.upsertEmailBody = bodies;
    const completed = new Set<string>();
    runtime.cache.getUidsMissingBodies = (_id, folder) => completed.has(folder) ? [] : ["7"];
    bodies.mockImplementation((_id: string, folder: string) => { completed.add(folder); });
    const state = vi.fn(); runtime.cache.updateSyncState = state;
    configureEmailRuntime(runtime);
    accounts.push({ id: "imap-account", email: "release@example.test", authType: "app_password", provider: "custom" });
    getCredentials.mockReturnValue({ password: "local-test-password" });
    let selected = "";
    imap.connectAccount.mockResolvedValue({
      mailbox: { uidValidity: 42n },
      getMailboxLock: async (folder: string) => { selected = folder; return { release() {} }; },
      fetchOne: async () => ({ source: Buffer.from(["From: QA <qa@example.test>", "Subject: " + selected, "", "Body in " + selected].join(String.fromCharCode(13, 10))) }),
    });
    imap.listFolders.mockResolvedValue([{ path: "INBOX" }, { path: "Archive" }]);
    imap.listEmails.mockImplementation(async (_id, folder) => ({ total: 1, messages: [{ uid: "7", folder, subject: folder, from: [{ address: "qa@example.test" }], to: [], cc: [], date: "2026-01-01T00:00:00Z", body: { text: folder }, attachments: [], flags: [] }] }));
    const { startEngine, stopEngine } = await import("../lib/sync-engine.js"); startEngine();
    await vi.waitFor(() => expect(bodies).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(gmailProvider.listMessages).not.toHaveBeenCalled(); expect(gmailProvider.changesSince).not.toHaveBeenCalled();
    expect(clearFolderCache).toHaveBeenCalledWith("imap-account", "INBOX");
    expect(state).toHaveBeenCalledWith("imap-account", "Archive", "7", 42);
    expect(bodies).toHaveBeenCalledWith("imap-account", "INBOX", "7", null, "Body in INBOX", expect.any(String));
    expect(bodies).toHaveBeenCalledWith("imap-account", "Archive", "7", null, "Body in Archive", expect.any(String));
    const connection = imap.connectAccount.mock.calls[0][0]; expect(connection.id).not.toBe("imap-account");
    await stopEngine(); expect(imap.disconnectAccount).toHaveBeenCalledWith(connection.id);
  });

  it("hands Gmail deletions and the history cursor to the injected atomic cache adapter", async () => {
    resetEmailRuntimeForTest();
    const runtime = createMemoryEmailRuntime();
    const applyEmailCacheDelta = vi.fn(() => ({ upserts: 0, deletes: 1 }));
    runtime.cache.applyEmailCacheDelta = applyEmailCacheDelta;
    configureEmailRuntime(runtime);
    accounts.push({ id: "delta-account", email: "delta@example.test", authType: "oauth2", provider: "gmail" });
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
    accounts.push({ id: "full-resync-account", email: "full-resync@example.test", authType: "oauth2", provider: "gmail" });
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
