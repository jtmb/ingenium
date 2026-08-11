import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/imap.js", () => ({
  connectAccount: vi.fn(),
  disconnectAccount: vi.fn(),
}));
vi.mock("../lib/triage.js", () => ({ triageEmails: vi.fn() }));
vi.mock("../lib/responder.js", () => ({
  parseReplyRecipient: vi.fn(),
  suggestResponse: vi.fn(),
}));
vi.mock("../lib/smtp.js", () => ({ saveDraft: vi.fn() }));
vi.mock("../lib/accounts.js", () => ({
  getAccount: vi.fn(),
  getCredentials: vi.fn(),
}));

import { getAccount, getCredentials } from "../lib/accounts.js";
import { connectAccount, disconnectAccount } from "../lib/imap.js";
import { triageEmails } from "../lib/triage.js";
import { parseReplyRecipient, suggestResponse } from "../lib/responder.js";
import { saveDraft } from "../lib/smtp.js";
import { configureEmailRuntime, resetEmailRuntimeForTest } from "../lib/runtime.js";
import type { TriageResult } from "../lib/types.js";
import {
  configureWatcherProcessedUidCapacityForTest,
  getWatcherStatus,
  logWatcherObservation,
  startWatcher,
  stopWatcher,
  stopAllWatchers,
} from "../lib/watcher.js";
import { createMemoryEmailRuntime } from "./runtime-fixture.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function configureWatcherAccount(accountId?: string): void {
  vi.mocked(getAccount).mockImplementation((requestedId) => {
    if (accountId && requestedId !== accountId) return undefined;
    return {
      id: requestedId,
      email: `${requestedId}@example.test`,
      name: requestedId,
      provider: "custom",
      authType: "app_password",
      connected: true,
    };
  });
  vi.mocked(getCredentials).mockReturnValue({ password: "watcher-password" });
  vi.mocked(triageEmails).mockResolvedValue([]);
}

function createClient(mailboxOpen: () => Promise<void> = async () => {}) {
  return {
    mailboxOpen: vi.fn(mailboxOpen),
    on: vi.fn(),
    off: vi.fn(),
  };
}

function createEventClient() {
  const handlers = new Map<string, () => void | Promise<void>>();
  return {
    client: {
      mailboxOpen: vi.fn(),
      on: vi.fn((event: string, listener: () => void | Promise<void>) => handlers.set(event, listener)),
      off: vi.fn(),
    },
    emitExists: async () => {
      const handler = handlers.get("exists");
      if (!handler) throw new Error("Watcher did not register an exists listener");
      await handler();
    },
  };
}

function highPriorityTriage(emailUid: string): TriageResult {
  return {
    emailUid,
    category: "urgent",
    priority: "high",
    suggestedAction: "reply_now",
    matchedSkills: [],
    confidence: 0.9,
  };
}

afterEach(async () => {
  await stopAllWatchers();
  configureWatcherProcessedUidCapacityForTest();
  resetEmailRuntimeForTest();
  vi.clearAllMocks();
});

describe("email watcher observation boundary", () => {
  it("records observations through the configured API-owned runtime", async () => {
    const recordObservation = vi.fn(async () => {});
    const runtime = createMemoryEmailRuntime();
    runtime.recordObservation = recordObservation;
    configureEmailRuntime(runtime);

    await logWatcherObservation("project-id", {
      observation_type: "pattern",
      content: "A test email was triaged",
      importance: 5,
    });

    expect(recordObservation).toHaveBeenCalledWith("project-id", {
      observation_type: "pattern",
      content: "A test email was triaged",
      importance: 5,
    });
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

describe("email watcher startup coordination", () => {
  it("shares one startup promise and performs one connect, listener, and initial scan", async () => {
    configureWatcherAccount("shared");
    const connecting = deferred<ReturnType<typeof createClient>>();
    const client = createClient();
    vi.mocked(connectAccount).mockReturnValue(connecting.promise as never);

    const first = startWatcher("global-project", "shared");
    const second = startWatcher("global-project", "shared");

    expect(first).toBe(second);
    expect(connectAccount).toHaveBeenCalledOnce();
    connecting.resolve(client);
    await Promise.all([first, second]);

    expect(client.mailboxOpen).toHaveBeenCalledOnce();
    expect(client.on).toHaveBeenCalledOnce();
    expect(triageEmails).toHaveBeenCalledOnce();
    expect(getWatcherStatus("shared")).toEqual({ running: true });
  });

  it("clears a failed shared startup and lets a later start retry with a fresh client", async () => {
    configureWatcherAccount("retry");
    const failedClient = createClient(async () => {
      throw new Error("mailbox open failed");
    });
    const workingClient = createClient();
    vi.mocked(connectAccount)
      .mockResolvedValueOnce(failedClient as never)
      .mockResolvedValueOnce(workingClient as never);

    const first = startWatcher("global-project", "retry");
    const second = startWatcher("global-project", "retry");
    expect(first).toBe(second);
    await expect(first).rejects.toThrow("mailbox open failed");

    expect(connectAccount).toHaveBeenCalledOnce();
    expect(disconnectAccount).toHaveBeenCalledOnce();
    expect(disconnectAccount).toHaveBeenCalledWith("retry");
    expect(getWatcherStatus("retry")).toEqual({ running: false });

    await startWatcher("global-project", "retry");

    expect(connectAccount).toHaveBeenCalledTimes(2);
    expect(workingClient.mailboxOpen).toHaveBeenCalledOnce();
    expect(workingClient.on).toHaveBeenCalledOnce();
    expect(triageEmails).toHaveBeenCalledTimes(1);
    expect(getWatcherStatus("retry")).toEqual({ running: true });
  });

  it("cancels a startup during mailbox selection and closes the partial client", async () => {
    configureWatcherAccount("stopped");
    const opening = deferred<void>();
    const client = createClient(() => opening.promise);
    vi.mocked(connectAccount).mockResolvedValue(client as never);

    const started = startWatcher("global-project", "stopped");
    await vi.waitFor(() => expect(client.mailboxOpen).toHaveBeenCalledOnce());
    const stopped = stopWatcher("stopped");
    opening.resolve();

    await Promise.all([started, stopped]);

    expect(client.on).not.toHaveBeenCalled();
    expect(disconnectAccount).toHaveBeenCalledOnce();
    expect(disconnectAccount).toHaveBeenCalledWith("stopped");
    expect(getWatcherStatus("stopped")).toEqual({ running: false });
  });

  it("starts different accounts independently", async () => {
    configureWatcherAccount();
    const firstConnection = deferred<ReturnType<typeof createClient>>();
    const secondConnection = deferred<ReturnType<typeof createClient>>();
    const firstClient = createClient();
    const secondClient = createClient();
    vi.mocked(connectAccount).mockImplementation((account) => (
      account.id === "first" ? firstConnection.promise : secondConnection.promise
    ) as never);

    const first = startWatcher("global-project", "first");
    const second = startWatcher("global-project", "second");

    expect(connectAccount).toHaveBeenCalledTimes(2);
    firstConnection.resolve(firstClient);
    secondConnection.resolve(secondClient);
    await Promise.all([first, second]);

    expect(firstClient.on).toHaveBeenCalledOnce();
    expect(secondClient.on).toHaveBeenCalledOnce();
    expect(triageEmails).toHaveBeenCalledTimes(2);
    expect(getWatcherStatus("first")).toEqual({ running: true });
    expect(getWatcherStatus("second")).toEqual({ running: true });
  });
});

describe("email watcher scan coalescing", () => {
  it("coalesces exists events with the initial scan and drafts a repeated unread UID once", async () => {
    let resolveTriage: ((value: Array<{
      emailUid: string;
      category: string;
      priority: "high";
      suggestedAction: "reply_now";
      matchedSkills: string[];
      confidence: number;
    }>) => void) | undefined;
    const triagePromise = new Promise<Array<{
      emailUid: string;
      category: string;
      priority: "high";
      suggestedAction: "reply_now";
      matchedSkills: string[];
      confidence: number;
    }>>((resolve) => {
      resolveTriage = resolve;
    });
    const handlers = new Map<string, () => void | Promise<void>>();
    const client = {
      mailboxOpen: vi.fn(),
      on: vi.fn((event: string, listener: () => void | Promise<void>) => handlers.set(event, listener)),
    };
    const recordObservation = vi.fn(async () => {});
    const runtime = createMemoryEmailRuntime();
    runtime.recordObservation = recordObservation;
    configureEmailRuntime(runtime);
    vi.mocked(getAccount).mockReturnValue({
      id: "coalesced",
      email: "coalesced@example.test",
      name: "Coalesced",
      provider: "custom",
      authType: "app_password",
      connected: true,
    });
    vi.mocked(getCredentials).mockReturnValue({ password: "watcher-password" });
    vi.mocked(connectAccount).mockResolvedValue(client as never);
    vi.mocked(triageEmails).mockReturnValue(triagePromise);
    vi.mocked(suggestResponse).mockResolvedValue({
      emailUid: "same-unread",
      originalSender: "sender@example.test",
      subject: "Re: status",
      body: "Draft body",
      matchedSkill: "email-skill",
      confidence: 0.9,
    });
    vi.mocked(parseReplyRecipient).mockResolvedValue({ address: "sender@example.test" });

    const started = startWatcher("global-project", "coalesced");
    await vi.waitFor(() => expect(handlers.get("exists")).toBeTypeOf("function"));
    const exists = handlers.get("exists")!;
    const redundant = exists();
    resolveTriage!([{
      emailUid: "same-unread",
      category: "meeting",
      priority: "high",
      suggestedAction: "reply_now",
      matchedSkills: ["email-skill"],
      confidence: 0.9,
    }]);

    await started;
    await redundant;

    expect(triageEmails).toHaveBeenCalledOnce();
    expect(suggestResponse).toHaveBeenCalledWith("global-project", "coalesced", "same-unread", "INBOX");
    expect(saveDraft).toHaveBeenCalledOnce();
    expect(saveDraft).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      to: [{ address: "sender@example.test" }],
    }));
    expect(recordObservation).toHaveBeenCalledTimes(2);

    await exists();

    expect(suggestResponse).toHaveBeenCalledOnce();
    expect(saveDraft).toHaveBeenCalledOnce();
    expect(recordObservation).toHaveBeenCalledTimes(2);
  });
});

describe("email watcher processed UID cache", () => {
  it("caps UID history and refreshes duplicate recency before suppressing side effects", async () => {
    configureWatcherProcessedUidCapacityForTest(2);
    configureWatcherAccount("bounded");
    const watcher = createEventClient();
    vi.mocked(connectAccount).mockResolvedValue(watcher.client as never);
    vi.mocked(triageEmails)
      .mockResolvedValueOnce([
        highPriorityTriage("a"),
        highPriorityTriage("b"),
        highPriorityTriage("c"),
      ])
      .mockResolvedValueOnce([highPriorityTriage("b")])
      .mockResolvedValueOnce([highPriorityTriage("d")])
      .mockResolvedValueOnce([highPriorityTriage("c")]);
    vi.mocked(suggestResponse).mockResolvedValue(null);

    await startWatcher("global-project", "bounded");
    await watcher.emitExists();
    await watcher.emitExists();
    await watcher.emitExists();

    expect(vi.mocked(suggestResponse).mock.calls.map(([, , emailUid]) => emailUid)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "c",
    ]);
  });

  it("keeps duplicate state per account and resets it when a watcher restarts", async () => {
    configureWatcherProcessedUidCapacityForTest(2);
    configureWatcherAccount();
    const first = createEventClient();
    const second = createEventClient();
    const restartedFirst = createEventClient();
    let firstConnections = 0;
    vi.mocked(connectAccount).mockImplementation((account) => {
      if (account.id === "second") return Promise.resolve(second.client) as never;
      const client = firstConnections++ === 0 ? first.client : restartedFirst.client;
      return Promise.resolve(client) as never;
    });
    vi.mocked(triageEmails).mockResolvedValue([highPriorityTriage("shared-uid")]);
    vi.mocked(suggestResponse).mockResolvedValue(null);

    await startWatcher("global-project", "first");
    await startWatcher("global-project", "second");
    expect(suggestResponse).toHaveBeenCalledTimes(2);

    await first.emitExists();
    expect(suggestResponse).toHaveBeenCalledTimes(2);

    await stopWatcher("first");
    await startWatcher("global-project", "first");
    expect(suggestResponse).toHaveBeenCalledTimes(3);
  });
});
