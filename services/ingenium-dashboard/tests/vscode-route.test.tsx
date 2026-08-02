import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import VSCodePage from "../src/app/vscode/page";
import VSCodeFrame, { VSCODE_STATUS_POLL_MS } from "../src/app/components/VSCodeFrame";
import {
  getVSCodeAvailability,
  getVSCodeUrl,
  VSCODE_GATEWAY_URL,
} from "@/lib/runtime-urls";

const workspaceControl = vi.hoisted(() => vi.fn());

vi.mock("../src/app/components/WorkspaceControl", () => ({
  default: ({ pageId }: { pageId: string }) => {
    workspaceControl(pageId);
    return <span data-testid="workspace-control" data-page-id={pageId} />;
  },
}));

function setLocation(url: string): void {
  const parsed = new URL(url);
  Object.defineProperty(window, "location", {
    value: {
      href: parsed.href,
      origin: parsed.origin,
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      host: parsed.host,
      port: parsed.port,
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
    },
    writable: true,
    configurable: true,
  });
}

function statusResponse(services: Array<{ name: string; state: string }>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { services } }),
  };
}

describe("VS Code route and fixed-origin frame", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    setLocation("http://localhost:3000/vscode");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    workspaceControl.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("permits only the two canonical HTTP dashboard origins", () => {
    expect(VSCODE_GATEWAY_URL).toBe("http://vscode.localhost:3000/");
    expect(getVSCodeAvailability()).toBe("available");
    expect(getVSCodeUrl()).toBe(VSCODE_GATEWAY_URL);

    setLocation("http://127.0.0.1:3000/vscode");
    expect(getVSCodeAvailability()).toBe("available");

    for (const url of [
      "http://localhost:3001/vscode",
      "https://localhost:3000/vscode",
      "http://[::1]:3000/vscode",
      "http://192.168.1.20:3000/vscode",
      "https://dashboard.example.test/vscode",
    ]) {
      setLocation(url);
      expect(getVSCodeAvailability()).toBe("unavailable");
      expect(getVSCodeUrl()).toBeNull();
    }
  });

  it("renders the immersive route with its standalone control and exact trusted iframe", async () => {
    fetchMock.mockResolvedValue(statusResponse([{ name: "VS Code", state: "running" }]));

    render(<VSCodePage />);

    const frame = await screen.findByTitle("VS Code");
    expect(frame.getAttribute("src")).toBe(VSCODE_GATEWAY_URL);
    expect(frame.getAttribute("allow")).toBe("clipboard-write");
    expect(frame.getAttribute("loading")).toBe("eager");
    expect(frame.getAttribute("sandbox")).toBeNull();
    expect(screen.getByRole("link", { name: "Open directly" }).getAttribute("href")).toBe(VSCODE_GATEWAY_URL);
    expect(screen.getByTestId("workspace-control").getAttribute("data-page-id")).toBe("vscode");
    expect(workspaceControl).toHaveBeenCalledWith("vscode");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/services/status",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("fails closed for an unsupported dashboard origin before checking services", async () => {
    setLocation("http://192.168.1.20:3000/vscode");
    render(<VSCodeFrame />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("VS Code is unavailable on this connection");
    expect(alert.textContent).toContain("local-only, administrator-grade workspace");
    expect(alert.textContent).toContain("remote, LAN, shared, or untrusted users");
    expect(document.activeElement).toBe(alert);
    expect(screen.queryByTitle("VS Code")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [[], "VS Code process is missing"],
    [[{ name: "VS Code", state: "stopped" }], "VS Code is stopped"],
    [[{ name: "VS Code", state: "error" }], "VS Code reported an error"],
  ] as const)("renders explicit local process state: %s", async (services, title) => {
    fetchMock.mockResolvedValue(statusResponse([...services]));
    render(<VSCodeFrame />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(title);
    expect(screen.getByRole("link", { name: "Open VS Code in a new tab" }).getAttribute("href")).toBe(VSCODE_GATEWAY_URL);
    expect(screen.getByRole("button", { name: "Retry VS Code" })).toBeTruthy();
    expect(screen.queryByTitle("VS Code")).toBeNull();
  });

  it("bounds local starting-state polling before offering retry", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(statusResponse([{ name: "VS Code", state: "starting" }]));
    render(<VSCodeFrame />);

    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(VSCODE_STATUS_POLL_MS * 2); });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("status").textContent).toContain("bounded local status checks");
    expect(screen.getByRole("button", { name: "Retry VS Code" })).toBeTruthy();
  });

  it("replaces a stalled iframe with a retryable local error", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(statusResponse([{ name: "VS Code", state: "running" }]))
      .mockResolvedValueOnce(statusResponse([{ name: "VS Code", state: "running" }]));
    render(<VSCodeFrame />);

    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTitle("VS Code")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(15_000); });

    expect(screen.getByRole("alert").textContent).toContain("VS Code could not be loaded");
    fireEvent.click(screen.getByRole("button", { name: "Retry VS Code" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTitle("VS Code")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
