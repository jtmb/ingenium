import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import StatusPage from "../src/app/status/page";
import HealthStrip from "../src/app/components/HealthStrip";
import type { HealthData } from "../src/lib/api";

const fetchMock = vi.fn();

vi.mock("../src/app/status/ServiceOverlay", () => ({
  default: () => null,
}));

interface StatusResponseOptions {
  overall?: "healthy" | "degraded";
  emailState?: "idle" | "degraded" | "unhealthy" | "stopped";
  emailRequired?: boolean;
  emailDetail?: string;
}

function statusResponse({
  overall = "healthy",
  emailState = "idle",
  emailRequired = false,
  emailDetail = "Add an email account to begin syncing",
}: StatusResponseOptions = {}) {
  return {
    ok: true,
    json: async () => ({
      data: {
        services: [{ name: "API", state: "running", required: true, uptime: 1, restartCount: 0, port: 4097, description: "API" }],
        applications: [
          {
            name: "email-client",
            state: emailState,
            description: "Mail sync engine",
            detail: emailDetail,
            required: emailRequired,
          },
        ],
        overall,
      },
    }),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("StatusPage aggregate health", () => {
  it("reconciles a stale healthy aggregate when a required application is degraded", async () => {
    fetchMock.mockResolvedValue(statusResponse({
      overall: "healthy",
      emailState: "degraded",
      emailRequired: true,
      emailDetail: "Heartbeat stale (121s)",
    }));

    render(<StatusPage />);

    expect(await screen.findByText("1 component(s) degraded")).toBeTruthy();
    expect(screen.getByText("Degraded")).toBeTruthy();
    expect(screen.getByText("Heartbeat stale (121s)")).toBeTruthy();
    expect(screen.queryByText("Unknown")).toBeNull();
    expect(screen.queryByText("All healthy")).toBeNull();
  });

  it("renders a required unhealthy application and reconciles a stale healthy aggregate", async () => {
    fetchMock.mockResolvedValue(statusResponse({
      emailState: "unhealthy",
      emailRequired: true,
      emailDetail: "Health check failed",
    }));

    render(<StatusPage />);

    expect(await screen.findByText("1 component(s) degraded")).toBeTruthy();
    expect(screen.getByText("Unhealthy")).toBeTruthy();
    expect(screen.getByText("Health check failed")).toBeTruthy();
    expect(screen.queryByText("Unknown")).toBeNull();
    expect(screen.queryByText("All healthy")).toBeNull();
  });

  it("renders a required stopped application and reconciles a stale healthy aggregate", async () => {
    fetchMock.mockResolvedValue(statusResponse({
      emailState: "stopped",
      emailRequired: true,
      emailDetail: "Engine not running",
    }));

    render(<StatusPage />);

    expect(await screen.findByText("1 component(s) degraded")).toBeTruthy();
    expect(screen.getByText("Stopped")).toBeTruthy();
    expect(screen.getByText("Engine not running")).toBeTruthy();
    expect(screen.queryByText("Unknown")).toBeNull();
    expect(screen.queryByText("All healthy")).toBeNull();
  });

  it("keeps an unconfigured optional email client out of degraded health", async () => {
    fetchMock.mockResolvedValue(statusResponse());

    render(<StatusPage />);

    expect(await screen.findByText("All healthy")).toBeTruthy();
    expect(screen.getByText("Idle")).toBeTruthy();
  });

  it("distinguishes initial loading from an unreachable status API", async () => {
    let rejectResponse!: (error: Error) => void;
    fetchMock.mockReturnValue(new Promise((_, reject) => { rejectResponse = reject; }));

    render(<StatusPage />);
    expect(screen.getByText("Loading service status...")).toBeTruthy();

    await act(async () => rejectResponse(new Error("Status endpoint unavailable")));

    expect(await screen.findByText("Cannot reach status API")).toBeTruthy();
    expect(screen.getByText("Status endpoint unavailable")).toBeTruthy();
  });

  it("uses semantic controls for service and application detail cards", async () => {
    fetchMock.mockResolvedValue(statusResponse());

    render(<StatusPage />);

    expect(await screen.findByRole("button", { name: "View API service details" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "View email-client application details" })).toBeTruthy();
  });

  it("serializes polling and aborts an active request on unmount", async () => {
    vi.useFakeTimers();
    let resolveResponse!: (response: ReturnType<typeof statusResponse>) => void;
    fetchMock.mockReturnValue(new Promise((resolve) => { resolveResponse = resolve; }));

    const { unmount } = render(<StatusPage />);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const signal = request.signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);

    resolveResponse(statusResponse());
  });
});

describe("HealthStrip optional services", () => {
  it("keeps an idle zero-account email service out of degradation", () => {
    const health: HealthData = {
      api: { status: "ok", uptime: 1 },
      dashboard: { status: "ok" },
      opencode: { status: "ok" },
      docker: { status: "healthy" },
      services: [{ name: "Email Client", status: "idle", required: false }],
    };

    render(<HealthStrip data={health} />);

    expect(screen.getByText("All systems operational")).toBeTruthy();
    expect(screen.queryByText(/service.*degraded/)).toBeNull();
  });
});
