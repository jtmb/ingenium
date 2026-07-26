import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  OPENCODE_HEALTH_MAX_ATTEMPTS,
  OPENCODE_HEALTH_POLL_MS,
  useOpenCodeHealth,
} from "@/lib/use-opencode-health";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function flushHealthRequest(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useOpenCodeHealth", () => {
  it("transitions from starting to ready after a healthy response", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { healthy: true } }),
    });

    const { result, unmount } = renderHook(() => useOpenCodeHealth());
    expect(result.current.status).toBe("starting");

    await flushHealthRequest();

    expect(result.current.status).toBe("ready");
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("bounds persistent reachability failures and stops polling", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"));
    const { result, unmount } = renderHook(() => useOpenCodeHealth());

    for (let attempt = 0; attempt < OPENCODE_HEALTH_MAX_ATTEMPTS; attempt += 1) {
      await flushHealthRequest();
      if (attempt < OPENCODE_HEALTH_MAX_ATTEMPTS - 1) {
        await act(async () => {
          vi.advanceTimersByTime(OPENCODE_HEALTH_POLL_MS);
          await Promise.resolve();
        });
      }
    }

    expect(result.current.status).toBe("unavailable");
    expect(result.current.error).toBe("Unable to reach OpenCode");
    expect(fetchMock).toHaveBeenCalledTimes(OPENCODE_HEALTH_MAX_ATTEMPTS);

    await act(async () => {
      vi.advanceTimersByTime(OPENCODE_HEALTH_POLL_MS * 2);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(OPENCODE_HEALTH_MAX_ATTEMPTS);
    unmount();
  });

  it("starts a fresh bounded attempt window when manually retried", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"));
    const { result, unmount } = renderHook(() => useOpenCodeHealth());

    for (let attempt = 0; attempt < OPENCODE_HEALTH_MAX_ATTEMPTS; attempt += 1) {
      await flushHealthRequest();
      if (attempt < OPENCODE_HEALTH_MAX_ATTEMPTS - 1) {
        await act(async () => {
          vi.advanceTimersByTime(OPENCODE_HEALTH_POLL_MS);
          await Promise.resolve();
        });
      }
    }
    expect(result.current.status).toBe("unavailable");

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { healthy: true } }),
    });
    act(() => result.current.retry());
    await flushHealthRequest();

    expect(result.current.status).toBe("ready");
    expect(result.current.attempts).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(OPENCODE_HEALTH_MAX_ATTEMPTS + 1);
    unmount();
  });
});
