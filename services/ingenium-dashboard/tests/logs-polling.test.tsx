import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const { listLogs } = vi.hoisted(() => ({
  listLogs: vi.fn(),
}));

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      logs: { ...actual.api.logs, list: listLogs },
    },
  };
});

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => "test-project",
}));

import LogsPage from "../src/app/logs/page";
import { ApiError, request, type LogEntry } from "../src/lib/api";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const EMPTY_RESPONSE = { data: { entries: [], sources: [], total: 0 } };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function logEntry(message: string, timestamp: string, level = "info"): LogEntry {
  return { timestamp, source: "api", level, message, data: null };
}

function logsResponse(entries: LogEntry[] = []) {
  return { data: { entries, sources: ["api"], total: entries.length } };
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advanceTimers(milliseconds: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
}

beforeEach(() => {
  vi.useFakeTimers();
  listLogs.mockReset();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LogsPage polling", () => {
  it("runs one serialized polling loop and never overlaps requests", async () => {
    const pending: Array<Deferred<typeof EMPTY_RESPONSE>> = [];
    let activeRequests = 0;
    let maxActiveRequests = 0;
    listLogs.mockImplementation(() => {
      const next = deferred<typeof EMPTY_RESPONSE>();
      pending.push(next);
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      next.promise.then(
        () => { activeRequests -= 1; },
        () => { activeRequests -= 1; },
      );
      return next.promise;
    });

    render(<LogsPage />);
    expect(listLogs).toHaveBeenCalledTimes(1);

    await advanceTimers(8_000);

    expect(listLogs).toHaveBeenCalledTimes(1);
    expect(maxActiveRequests).toBe(1);

    pending[0]!.resolve(EMPTY_RESPONSE);
    await flushAsyncWork();
    await advanceTimers(2_000);

    expect(listLogs).toHaveBeenCalledTimes(2);
    expect(maxActiveRequests).toBe(1);
    expect(listLogs.mock.calls[1]?.[1]).toBeUndefined();
  });

  it("does not poll while hidden and resumes with one request when visible", async () => {
    setDocumentHidden(true);
    listLogs.mockResolvedValue(EMPTY_RESPONSE);

    render(<LogsPage />);
    await advanceTimers(8_000);
    expect(listLogs).not.toHaveBeenCalled();

    setDocumentHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await advanceTimers(0);

    expect(listLogs).toHaveBeenCalledTimes(1);
  });

  it("stops polling when explicitly paused", async () => {
    listLogs.mockResolvedValue(EMPTY_RESPONSE);

    render(<LogsPage />);
    await flushAsyncWork();
    fireEvent.click(screen.getByRole("button", { name: /LIVE/ }));
    await advanceTimers(8_000);

    expect(listLogs).toHaveBeenCalledTimes(1);
  });

  it("aborts an in-flight request and clears its timer on unmount", async () => {
    const pendingRequest = deferred<typeof EMPTY_RESPONSE>();
    listLogs.mockReturnValue(pendingRequest.promise);

    const { unmount } = render(<LogsPage />);
    const signal = listLogs.mock.calls[0]?.[3] as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);

    unmount();
    await advanceTimers(8_000);

    expect(signal.aborted).toBe(true);
    expect(listLogs).toHaveBeenCalledTimes(1);
  });

  it("keeps stale rows and waits for a valid Retry-After after a 429", async () => {
    const stale = logEntry("stale row", "2026-08-07T11:00:00.000Z");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    listLogs
      .mockResolvedValueOnce(logsResponse([stale]))
      .mockRejectedValueOnce(new ApiError(429, "Too many requests.", 3))
      .mockResolvedValue(EMPTY_RESPONSE);

    render(<LogsPage />);
    await flushAsyncWork();
    expect(screen.getByText(stale.message)).toBeTruthy();

    await advanceTimers(2_000);
    expect(listLogs).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert").textContent).toContain("Retrying in 3s.");
    expect(consoleError).not.toHaveBeenCalled();

    await advanceTimers(2_999);
    expect(listLogs).toHaveBeenCalledTimes(2);
    await advanceTimers(1);
    expect(listLogs).toHaveBeenCalledTimes(3);
    await flushAsyncWork();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(stale.message)).toBeTruthy();
  });

  it.each([
    ["invalid", null],
    ["excessive", 60],
  ] as const)("stops visibly without a tight retry for a %s Retry-After", async (retryAfterStatus, seconds) => {
    listLogs
      .mockResolvedValueOnce(logsResponse([logEntry("stale row", "2026-08-07T11:00:00.000Z")]))
      .mockRejectedValueOnce(new ApiError(429, "Too many requests.", seconds, null, null, retryAfterStatus));

    render(<LogsPage />);
    await flushAsyncWork();
    await advanceTimers(2_000);
    expect(listLogs).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert").textContent).toContain(`${retryAfterStatus} Retry-After`);

    await advanceTimers(60_000);
    expect(listLogs).toHaveBeenCalledTimes(2);
  });

  it("preserves the cursor, deduplication, filters, and 500-entry cap", async () => {
    const first = logEntry("first row", "2026-08-07T11:00:00.000Z");
    const second = logEntry("second row", "2026-08-07T11:00:01.000Z");
    const debug = logEntry("debug row", "2026-08-07T11:00:02.000Z", "debug");
    listLogs
      .mockResolvedValueOnce(logsResponse([first]))
      .mockResolvedValueOnce(logsResponse([first, second, debug]));

    render(<LogsPage />);
    await flushAsyncWork();
    await advanceTimers(2_000);
    await flushAsyncWork();

    expect(listLogs.mock.calls[1]?.[1]).toBe(first.timestamp);
    expect(screen.getByText(first.message)).toBeTruthy();
    expect(screen.getByText(second.message)).toBeTruthy();
    expect(screen.queryByText(debug.message)).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "DEBUG" }));
    fireEvent.change(screen.getByPlaceholderText("Search messages..."), { target: { value: "debug" } });
    expect(screen.getByText(debug.message)).toBeTruthy();
    expect(screen.queryByText(first.message)).toBeNull();

    const manyEntries = Array.from({ length: 501 }, (_, index) =>
      logEntry(`row-${index}`, `2026-08-07T12:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`),
    );
    listLogs.mockResolvedValueOnce(logsResponse(manyEntries));
    fireEvent.change(screen.getByPlaceholderText("Search messages..."), { target: { value: "" } });
    await advanceTimers(2_000);

    expect(screen.getAllByRole("row")).toHaveLength(501);
    expect(screen.queryByText("row-0")).toBeNull();
    expect(screen.getByText("row-500")).toBeTruthy();
  });

  it("classifies invalid and excessive Retry-After headers at the API boundary", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "limited" } }), {
        status: 429,
        headers: { "Retry-After": "later" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "limited" } }), {
        status: 429,
        headers: { "Retry-After": "120" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("/logs")).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: null,
      retryAfterStatus: "invalid",
    });
    await expect(request("/logs")).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 60,
      retryAfterStatus: "excessive",
    });
  });

  it("forwards the abort signal through the logs API client", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(EMPTY_RESPONSE), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const actual = await vi.importActual<typeof import("../src/lib/api")>("../src/lib/api");
    const controller = new AbortController();

    await actual.api.logs.list("test-project", undefined, 200, controller.signal);

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal });
  });
});
