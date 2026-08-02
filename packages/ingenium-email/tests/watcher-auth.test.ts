import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../lib/imap.js", () => ({
  connectAccount: vi.fn(),
  disconnectAccount: vi.fn(),
}));
vi.mock("../lib/triage.js", () => ({ triageEmails: vi.fn() }));
vi.mock("../lib/responder.js", () => ({ suggestResponse: vi.fn() }));
vi.mock("../lib/smtp.js", () => ({ saveDraft: vi.fn() }));
vi.mock("../lib/accounts.js", () => ({
  getAccount: vi.fn(),
  getCredentials: vi.fn(),
}));

import { getAccount, getCredentials } from "../lib/accounts.js";
import { connectAccount, disconnectAccount } from "../lib/imap.js";
import { triageEmails } from "../lib/triage.js";
import {
  getWatcherStatus,
  logWatcherObservation,
  startWatcher,
  stopAllWatchers,
} from "../lib/watcher.js";

const originalToken = process.env.INGENIUM_API_TOKEN;
const originalTokenFile = process.env.INGENIUM_API_TOKEN_FILE;
const canonicalToken = "f".repeat(32);
let tokenDirectory = "";

function createTokenFile(contents = `${canonicalToken}\n`, mode = 0o600): string {
  const tokenFile = join(tokenDirectory, "api-token");
  writeFileSync(tokenFile, contents, { mode });
  chmodSync(tokenFile, mode);
  return tokenFile;
}

function expectAuthorization(fetchMock: ReturnType<typeof vi.fn>, expected: string | null): void {
  const request = fetchMock.mock.calls[0];
  expect(request?.[0]).toContain("/observations?project=project-id");
  expect(new Headers(request?.[1]?.headers).get("Authorization")).toBe(expected);
}

async function logTestObservation(log = logWatcherObservation): Promise<void> {
  await log("project-id", {
    observation_type: "pattern",
    content: "A test email was triaged",
    importance: 5,
  });
}

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function clearApiTokenEnvironment(): void {
  delete process.env.INGENIUM_API_TOKEN;
  delete process.env.INGENIUM_API_TOKEN_FILE;
}

function setCanonicalTokenFile(contents = `${canonicalToken}\n`, mode = 0o600): string {
  const tokenFile = createTokenFile(contents, mode);
  process.env.INGENIUM_API_TOKEN_FILE = tokenFile;
  return tokenFile;
}

function configureTestTokenDirectory(): void {
  tokenDirectory = mkdtempSync(join(tmpdir(), "ingenium-email-token-"));
}

function restoreApiTokenEnvironment(): void {
  if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalToken;
  if (originalTokenFile === undefined) delete process.env.INGENIUM_API_TOKEN_FILE;
  else process.env.INGENIUM_API_TOKEN_FILE = originalTokenFile;
}

function removeTestTokenDirectory(): void {
  if (tokenDirectory) rmSync(tokenDirectory, { recursive: true, force: true });
  tokenDirectory = "";
}

function setUpFileOnlyAuthentication(): string {
  clearApiTokenEnvironment();
  configureTestTokenDirectory();
  return setCanonicalTokenFile();
}

function expectNoAuthorizationForFile(contents: string, mode = 0o600): Promise<void> {
  clearApiTokenEnvironment();
  configureTestTokenDirectory();
  setCanonicalTokenFile(contents, mode);
  const fetchMock = stubFetch();

  return logTestObservation().then(() => {
    expectAuthorization(fetchMock, null);
  });
}

afterEach(async () => {
  await stopAllWatchers();
  restoreApiTokenEnvironment();
  removeTestTokenDirectory();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("email watcher API authentication", () => {
  it("attaches the configured bearer token to observation requests", async () => {
    clearApiTokenEnvironment();
    process.env.INGENIUM_API_TOKEN = "e".repeat(32);
    const fetchMock = stubFetch();

    await logTestObservation();

    expectAuthorization(fetchMock, `Bearer ${"e".repeat(32)}`);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Content-Type")).toBe("application/json");
  });

  it("loads the protected canonical token file when the environment token is cleared", async () => {
    setUpFileOnlyAuthentication();
    const fetchMock = stubFetch();

    await logTestObservation();

    expectAuthorization(fetchMock, `Bearer ${canonicalToken}`);
  });

  it("rejects group-readable canonical token files", async () => {
    await expectNoAuthorizationForFile(`${canonicalToken}\n`, 0o640);
  });

  it("rejects canonical token files not owned by the current process user on non-Windows hosts", async () => {
    if (process.platform === "win32" || typeof process.getuid !== "function") return;

    setUpFileOnlyAuthentication();
    const currentUid = process.getuid();
    const getuidSpy = vi.spyOn(process, "getuid").mockReturnValue(currentUid + 1);
    const fetchMock = stubFetch();
    try {
      await logTestObservation();
      expectAuthorization(fetchMock, null);
    } finally {
      getuidSpy.mockRestore();
    }
  });

  it.each([
    ["a malformed token", "not-a-valid-api-token\n"],
    ["additional whitespace", `${canonicalToken}\n\n`],
  ])("rejects canonical token files containing %s", async (_description, contents) => {
    await expectNoAuthorizationForFile(contents);
  });

  it("rejects canonical token-file symlinks", async () => {
    clearApiTokenEnvironment();
    configureTestTokenDirectory();
    const targetFile = join(tokenDirectory, "token-target");
    const tokenFile = join(tokenDirectory, "api-token");
    writeFileSync(targetFile, `${canonicalToken}\n`, { mode: 0o600 });
    chmodSync(targetFile, 0o600);
    symlinkSync(targetFile, tokenFile);
    process.env.INGENIUM_API_TOKEN_FILE = tokenFile;
    const fetchMock = stubFetch();

    await logTestObservation();

    expectAuthorization(fetchMock, null);
  });

  it("matches file-only authentication in the rebuilt watcher distribution", async () => {
    setUpFileOnlyAuthentication();
    const fetchMock = stubFetch();

    await logTestObservation();
    const { logWatcherObservation: logBuiltWatcherObservation } = await import("../dist/lib/watcher.js");
    await logTestObservation(logBuiltWatcherObservation);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const request of fetchMock.mock.calls) {
      expect(new Headers(request[1]?.headers).get("Authorization")).toBe(`Bearer ${canonicalToken}`);
    }
  });
});

describe("email watcher shutdown", () => {
  it("stops every watcher in the authoritative watcher map", async () => {
    const client = { mailboxOpen: vi.fn(), on: vi.fn() };
    vi.mocked(getAccount).mockImplementation((accountId) => ({
      id: accountId,
      email: `${accountId}@example.test`,
      name: accountId,
      provider: "custom",
      authType: "app_password",
      connected: true,
    }));
    vi.mocked(getCredentials).mockReturnValue({ password: "watcher-password" });
    vi.mocked(connectAccount).mockResolvedValue(client as never);
    vi.mocked(triageEmails).mockResolvedValue([]);

    await startWatcher("global-project", "first");
    await startWatcher("global-project", "second");
    await stopAllWatchers();

    expect(disconnectAccount).toHaveBeenCalledTimes(2);
    expect(disconnectAccount).toHaveBeenCalledWith("first");
    expect(disconnectAccount).toHaveBeenCalledWith("second");
    expect(getWatcherStatus("first")).toEqual({ running: false });
    expect(getWatcherStatus("second")).toEqual({ running: false });
  });
});
