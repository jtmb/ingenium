import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const { projectState } = vi.hoisted(() => ({
  projectState: {
    project: "server-global" as string | null,
    loading: false,
    error: null as Error | null,
  },
}));

vi.mock("../src/lib/api", () => ({
  dashboardFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  getApiBase: () => "/api/v1",
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useGlobalProject: () => projectState,
}));

vi.mock("../src/app/mail/components/FolderSidebar", () => ({
  default: ({
    accounts,
    onSelectAccount,
    onSelectFolder,
    folders,
  }: {
    accounts: Array<{ id: string; email: string }>;
    onSelectAccount: (accountId: string) => void;
    onSelectFolder: (folder: string) => void;
    folders: Array<{ name?: string; path?: string }>;
  }) => (
    <aside data-testid="mail-sidebar">
      {accounts.map((account) => (
        <button key={account.id} type="button" onClick={() => onSelectAccount(account.id)}>
          {account.email}
        </button>
      ))}
      <button type="button" onClick={() => onSelectFolder("Archive")}>Archive folder</button>
      {folders.map((folder) => <span key={folder.path ?? folder.name}>{folder.name ?? folder.path}</span>)}
    </aside>
  ),
}));

vi.mock("../src/app/mail/components/EmailList", () => ({
  default: ({
    emails,
    onSelect,
  }: {
    emails: Array<{ uid: string; subject: string }>;
    onSelect: (uid: string) => void;
  }) => (
    <section>
      {emails.map((email) => (
        <button key={email.uid} type="button" onClick={() => onSelect(email.uid)}>
          {email.subject}
        </button>
      ))}
    </section>
  ),
}));

vi.mock("../src/app/mail/components/EmailReader", () => ({
  default: ({
    email,
    loading,
    downloading,
    downloadError,
  }: {
    email: { subject: string } | null;
    loading: boolean;
    downloading: boolean;
    downloadError: string | null;
  }) => (
    <section data-testid="mail-reader">
      {loading && <span>Loading body</span>}
      {downloading && <span>Downloading body</span>}
      {email && <span>{email.subject}</span>}
      {downloadError && <span>{downloadError}</span>}
    </section>
  ),
}));

vi.mock("../src/app/mail/components/AccountSetup", () => ({ default: () => null }));
vi.mock("../src/app/mail/components/SyncProgress", () => ({ default: () => null }));
vi.mock("../src/app/mail/components/EmailComposer", () => ({ default: () => null }));
vi.mock("../src/app/components/Overlay", () => ({ default: () => null }));
vi.mock("../src/app/tasks/components/TaskCaptureModal", () => ({ default: () => null }));

import MailPage from "../src/app/mail/page";

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const accounts = [
  { id: "account-a", email: "a@example.com" },
  { id: "account-b", email: "b@example.com" },
];

function accountListResponse() {
  return jsonResponse({ data: accounts });
}

function syncStatusResponse() {
  return jsonResponse({
    data: {
      overall: "done",
      account: "account-a",
      totalFolders: 1,
      syncingFolders: 0,
      totalCached: 1,
      totalBodies: 1,
      folders: [],
    },
  });
}

function urlValue(input: RequestInfo | URL, key: string): string | null {
  return new URL(String(input), "http://dashboard.test").searchParams.get(key);
}

function baseFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.includes("/emails/accounts?")) return Promise.resolve(accountListResponse());
  if (url.includes("/emails/folders?")) return Promise.resolve(jsonResponse({ data: [{ name: "INBOX", path: "INBOX" }] }));
  if (url.includes("/emails/sync-status?")) return Promise.resolve(syncStatusResponse());
  if (url.includes("/emails?") && !url.includes("/emails/accounts")) {
    return Promise.resolve(jsonResponse({ data: [{ uid: "1", subject: "List message" }], total: 1 }));
  }
  if (url.includes("/emails/")) {
    const uid = url.split("/emails/")[1]?.split("?")[0] ?? "unknown";
    return Promise.resolve(jsonResponse({ data: { uid, subject: `Body ${uid}` } }));
  }
  return Promise.resolve(jsonResponse({ data: {} }));
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  projectState.project = "server-global";
  projectState.loading = false;
  projectState.error = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Mail project lifecycle", () => {
  it("does not request accounts, folders, or messages before project resolution", async () => {
    projectState.project = null;
    projectState.loading = true;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(baseFetch);

    render(<MailPage />);
    await flushAsyncWork();

    expect(screen.getByText("Resolving mail project…")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the renamed canonical global project for every mail request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(baseFetch);

    render(<MailPage />);
    await waitFor(() => expect(screen.getByText("a@example.com")).toBeTruthy());

    const mailCalls = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes("/emails"));
    expect(mailCalls.length).toBeGreaterThan(0);
    expect(mailCalls.every((url) => url.includes("project=server-global"))).toBe(true);
    expect(mailCalls.some((url) => url.includes("project=global-default"))).toBe(false);
  });

  it("shows a retryable project error and does not render account setup on resolution failure", async () => {
    projectState.project = null;
    projectState.error = new Error("Global project lookup failed");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(baseFetch);

    render(<MailPage />);

    expect(await screen.findByTestId("mail-project-resolution-error")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry project resolution" })).toBeTruthy();
    expect(screen.queryByText("No email accounts configured")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows an account-list error with retry instead of treating the failure as zero accounts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      if (String(input).includes("/emails/accounts?")) {
        return Promise.resolve(jsonResponse({ error: { message: "Accounts unavailable" } }, 503));
      }
      return baseFetch(input);
    });

    render(<MailPage />);

    expect(await screen.findByTestId("mail-accounts-error")).toBeTruthy();
    expect(screen.getByText("Accounts unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry loading accounts" })).toBeTruthy();
    expect(screen.queryByText("No email accounts configured")).toBeNull();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/emails/accounts?")).length).toBe(1);
  });

  it("ignores a late old-account message response after switching accounts", async () => {
    const accountAList = deferred<Response>();
    const accountBList = deferred<Response>();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/emails/accounts?")) return Promise.resolve(accountListResponse());
      if (url.includes("/emails/folders?")) return Promise.resolve(jsonResponse({ data: [] }));
      if (url.includes("/emails/sync-status?")) return Promise.resolve(syncStatusResponse());
      if (url.includes("/emails?") && urlValue(input, "account") === "account-a") return accountAList.promise;
      if (url.includes("/emails?") && urlValue(input, "account") === "account-b") return accountBList.promise;
      return baseFetch(input);
    });

    render(<MailPage />);
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => (
      String(input).includes("/emails?") && urlValue(input, "account") === "account-a"
    ))).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: "b@example.com" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => (
      String(input).includes("/emails?") && urlValue(input, "account") === "account-b"
    ))).toBe(true));

    await act(async () => {
      accountAList.resolve(jsonResponse({ data: [{ uid: "old", subject: "Old account message" }], total: 1 }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText("Old account message")).toBeNull();

    await act(async () => {
      accountBList.resolve(jsonResponse({ data: [{ uid: "new", subject: "New account message" }], total: 1 }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByText("New account message")).toBeTruthy();
  });

  it("ignores a late old-folder response after switching folders", async () => {
    const oldFolders = deferred<Response>();
    const currentFolders = deferred<Response>();
    let folderRequestCount = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/emails/folders?")) {
        folderRequestCount += 1;
        return folderRequestCount === 1 ? oldFolders.promise : currentFolders.promise;
      }
      return baseFetch(input);
    });

    render(<MailPage />);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/emails/folders?")).length).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Archive folder" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/emails/folders?")).length).toBe(2));

    await act(async () => {
      oldFolders.resolve(jsonResponse({ data: [{ name: "Old folder", path: "old" }] }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText("Old folder")).toBeNull();

    await act(async () => {
      currentFolders.resolve(jsonResponse({ data: [{ name: "Current folder", path: "current" }] }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByText("Current folder")).toBeTruthy();
  });

  it("ignores a late 202 body poll after switching accounts", async () => {
    const pendingPoll = deferred<Response>();
    let bodyRequestCount = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/emails/1?")) {
        bodyRequestCount += 1;
        return bodyRequestCount === 1
          ? Promise.resolve(new Response(null, { status: 202 }))
          : pendingPoll.promise;
      }
      if (url.includes("/emails?") && urlValue(input, "account") === "account-b") {
        return Promise.resolve(jsonResponse({ data: [{ uid: "2", subject: "New account message" }], total: 1 }));
      }
      return baseFetch(input);
    });

    render(<MailPage />);
    await waitFor(() => expect(screen.getByText("List message")).toBeTruthy());
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "List message" }));
    await flushAsyncWork();
    expect(screen.getByText("Downloading body")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/emails/1?")).length).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "b@example.com" }));
    await act(async () => {
      pendingPoll.resolve(jsonResponse({ data: { uid: "1", subject: "Old polled body" } }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText("Old polled body")).toBeNull();
    expect(screen.queryByText("Downloading body")).toBeNull();
  });

  it("aborts requests and clears polling on unmount", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      if (String(input).includes("/emails/accounts?")) return pending.promise;
      return baseFetch(input);
    });

    const { unmount } = render(<MailPage />);
    await waitFor(() => expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("/emails/accounts?")),
    ).toBe(true));
    const accountCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/emails/accounts?"));
    const signal = (accountCall?.[1] as RequestInit | undefined)?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);

    unmount();
    await act(async () => {
      pending.resolve(accountListResponse());
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(signal?.aborted).toBe(true);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/emails/folders?")).length).toBe(0);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/emails/sync-status?")).length).toBe(0);
  });
});
