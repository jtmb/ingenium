import { afterEach, describe, expect, it, vi } from "vitest";

const accounts: Array<{ id: string; email: string; authType: "oauth2" | "app_password" }> = [];
const getAccount = vi.fn((_projectId: string, accountId: string) =>
  accounts.find((account) => account.id === accountId),
);

vi.mock("ingenium-core", () => ({
  emailCache: {},
  emailSuggestionQueue: {},
  logger: { info: vi.fn(), warn: vi.fn() },
  settings: { getSetting: vi.fn() },
  synthesisLlm: {},
}));

vi.mock("../lib/accounts.js", () => ({
  listAccounts: vi.fn(() => accounts),
  getAccount,
  getCredentials: vi.fn(() => undefined),
  getGlobalProjectId: vi.fn(() => "global-project"),
}));

describe("sync engine reconciliation", () => {
  afterEach(async () => {
    const { stopEngine } = await import("../lib/sync-engine.js");
    await stopEngine();
    accounts.splice(0);
    getAccount.mockClear();
  });

  it("launches a worker for an account added after the engine starts", async () => {
    const { startEngine } = await import("../lib/sync-engine.js");

    startEngine("global-project");
    await Promise.resolve();
    expect(getAccount).not.toHaveBeenCalled();

    accounts.push({ id: "oauth-account", email: "user@example.com", authType: "oauth2" });
    startEngine("global-project");
    await Promise.resolve();
    await Promise.resolve();

    expect(getAccount).toHaveBeenCalledWith("global-project", "oauth-account");
  });

  it("keeps an app-password account visible with a recoverable credential error", async () => {
    const { startEngine, getEngineStatus } = await import("../lib/sync-engine.js");
    accounts.push({ id: "manual-account", email: "manual@example.com", authType: "app_password" });

    startEngine("global-project");
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
});
