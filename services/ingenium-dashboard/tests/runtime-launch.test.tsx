import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/api", () => ({
  request: apiRequest,
  ApiError: class ApiError extends Error {
    constructor(readonly status: number) { super("API request failed"); }
  },
}));

import { useRuntimeLaunch } from "../src/lib/use-runtime-launch";

const runtimeId = "11111111-1111-4111-8111-111111111111";
const origin = `https://web--${runtimeId}.runtime.example.test`;

afterEach(() => {
  cleanup();
  apiRequest.mockReset();
  vi.unstubAllGlobals();
});

describe("AUTH-109 dashboard runtime launch", () => {
  it("uses a browser-generated proof while the API returns only the launch URL and opaque status", async () => {
    const launchResponse = { data: { launchUrl: `${origin}/__ingenium/exchange`, status: "ready" } };
    apiRequest
      .mockResolvedValueOnce({ data: { status: "ready" } })
      .mockResolvedValueOnce(launchResponse);
    const exchange = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", exchange);

    const { result } = renderHook(() => useRuntimeLaunch("web"));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.url).toBe(`${origin}/`);
    const launchBody = JSON.parse(apiRequest.mock.calls[1]![1].body as string) as { audience: string; exchangeProof: string };
    expect(Object.keys(launchBody).sort()).toEqual(["audience", "exchangeProof"]);
    expect(launchBody.exchangeProof).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(launchResponse)).not.toMatch(/backend|sessionToken|ticket|token/i);
    expect(exchange).toHaveBeenCalledWith(`${origin}/__ingenium/exchange`, expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ proof: launchBody.exchangeProof }),
    }));
  });

  it("shows an unavailable state instead of falling back to fixed backend ports", async () => {
    apiRequest.mockResolvedValueOnce({ data: { status: "unavailable" } });
    vi.stubGlobal("fetch", vi.fn());
    const { result } = renderHook(() => useRuntimeLaunch("vscode"));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.url).toBeNull();
    expect(result.current.error).toContain("No ready isolated workspace");
  });
});
