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

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function healthyResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { healthy: true } }),
  };
}

function gatewayErrorResponse(status: number, message: string) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { message } }),
  };
}

describe("Phase 2C — OpenCode health gateway states", () => {
  it("treats a transient 503 as starting, then reaches ready on the next poll", async () => {
    fetchMock
      .mockResolvedValueOnce(gatewayErrorResponse(503, "OpenCode is still starting"))
      .mockResolvedValueOnce(healthyResponse());

    const { result, unmount } = renderHook(() => useOpenCodeHealth());
    await flushAsyncWork();

    expect(result.current.status).toBe("starting");
    expect(result.current.attempts).toBe(1);
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/opencode/health?project=global-default",
      expect.objectContaining({
        credentials: "same-origin",
        headers: { "x-ingenium-ui": "dashboard" },
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(OPENCODE_HEALTH_POLL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.error).toBeNull();
    expect(result.current.attempts).toBe(0);
    unmount();
  });

  it("bounds an unreachable gateway and stops retrying after the fixed attempt window", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"));

    const { result, unmount } = renderHook(() => useOpenCodeHealth());
    for (let attempt = 0; attempt < OPENCODE_HEALTH_MAX_ATTEMPTS; attempt += 1) {
      await flushAsyncWork();
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

  it("surfaces a 401 as auth-required and stops polling until manually retried", async () => {
    fetchMock.mockResolvedValue(gatewayErrorResponse(401, "Dashboard authentication required"));

    const { result, unmount } = renderHook(() => useOpenCodeHealth());
    await flushAsyncWork();

    expect(result.current.status).toBe("auth-required");
    expect(result.current.error).toBe("Dashboard authentication is required to check OpenCode health");
    expect(result.current.authScope).toBe("dashboard");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(OPENCODE_HEALTH_POLL_MS * 2);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("restarts a bounded attempt window after authentication is repaired", async () => {
    fetchMock.mockResolvedValue(gatewayErrorResponse(401, "Dashboard authentication required"));
    const { result, unmount } = renderHook(() => useOpenCodeHealth());

    await flushAsyncWork();
    expect(result.current.status).toBe("auth-required");

    fetchMock.mockResolvedValueOnce(healthyResponse());
    act(() => result.current.retry());
    await flushAsyncWork();

    expect(result.current.status).toBe("ready");
    expect(result.current.attempts).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unmount();
  });
});
