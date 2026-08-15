import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/api", () => ({
  request: apiRequest,
  ApiError: class ApiError extends Error {
    constructor(readonly status: number) { super("API request failed"); }
  },
}));

import RuntimeWorkspacePicker from "../src/app/components/RuntimeWorkspacePicker";
import OpenCodeToolbar from "../src/app/components/OpenCodeToolbar";
import {
  RUNTIME_START_MAX_ATTEMPTS,
  useRuntimeLaunch,
  useRuntimeWorkspace,
  type RuntimeWorkspaceController,
} from "../src/lib/use-runtime-launch";

const runtimeId = "11111111-1111-4111-8111-111111111111";
function runtimeOrigin(audience: "web" | "cli" | "vscode"): string {
  return `https://${audience}--${runtimeId}.runtime.example.test`;
}
const workspace = {
  id: "workspace-one",
  organizationName: "Example Organization",
  projectName: "Example Project",
  status: "stopped" as const,
};

beforeEach(() => localStorage.clear());

afterEach(() => {
  cleanup();
  apiRequest.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderRuntime(audience: "web" | "cli" | "vscode" = "web") {
  return renderHook(() => {
    const workspaceController = useRuntimeWorkspace();
    return { workspace: workspaceController, launch: useRuntimeLaunch(audience, workspaceController) };
  });
}

describe("RUNTIME-100 dashboard runtime selection", () => {
  it("uses fixed aliases in compatibility mode without dynamic launch or manager calls", async () => {
    apiRequest
      .mockResolvedValueOnce({ data: { mode: "compatibility", status: "ready", reason: null } })
      .mockResolvedValueOnce({ data: { status: "ready" } });
    vi.stubGlobal("fetch", vi.fn());

    const { result } = renderRuntime("web");
    await waitFor(() => expect(result.current.launch.status).toBe("ready"));

    expect(result.current.launch.url).toBe("http://opencode.localhost:3000/");
    expect(apiRequest).toHaveBeenCalledTimes(2);
    expect(apiRequest).toHaveBeenCalledWith("/runtimes/browser/status");
    expect(apiRequest).toHaveBeenCalledWith("/runtimes/browser/health?audience=web");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["web", "cli", "vscode"] as const)("requires an explicit authorized workspace before launching %s", async (audience) => {
    const origin = runtimeOrigin(audience);
    const launchResponse = { data: { launchUrl: `${origin}/__ingenium/exchange`, status: "ready" } };
    apiRequest
      .mockResolvedValueOnce({ data: { mode: "isolated", status: "no_runtime", reason: "explicit_start_required" } })
      .mockResolvedValueOnce({ data: [workspace] })
      .mockResolvedValueOnce({ data: { status: "ready" } })
      .mockResolvedValueOnce(launchResponse);
    const exchange = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce({ ok: true, status: 204 });
    vi.stubGlobal("fetch", exchange);

    const { result } = renderRuntime(audience);
    await waitFor(() => expect(result.current.workspace.status).toBe("selecting"));
    expect(result.current.workspace.selectedWorkspaceId).toBeNull();
    expect(result.current.launch.url).toBeNull();
    expect(apiRequest).toHaveBeenCalledTimes(2);

    act(() => result.current.workspace.selectWorkspace(workspace.id));
    await act(async () => { await result.current.workspace.start(); });
    await waitFor(() => expect(result.current.launch.status).toBe("ready"));

    expect(result.current.launch.url).toBe(`${origin}/`);
    expect(apiRequest.mock.calls[2]).toEqual([
      "/runtimes/browser/workspaces/workspace-one/start",
      { method: "POST", body: "{}" },
    ]);
    const launchBody = JSON.parse(apiRequest.mock.calls[3]![1].body as string) as Record<string, string>;
    expect(Object.keys(launchBody).sort()).toEqual(["audience", "exchangeProof", "workspaceId"]);
    expect(launchBody.audience).toBe(audience);
    expect(launchBody.workspaceId).toBe(workspace.id);
    expect(JSON.stringify(launchResponse)).not.toMatch(/backend|sessionToken|ticket|token/i);
    expect(exchange).toHaveBeenCalledWith(`${origin}/__ingenium/exchange`, expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ proof: launchBody.exchangeProof }),
    }));
    expect(exchange).toHaveBeenCalledWith(`${origin}/__ingenium/health`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
  });

  it("does not mount a compatibility iframe when its audience health is unavailable", async () => {
    apiRequest
      .mockResolvedValueOnce({ data: { mode: "compatibility", status: "ready", reason: null } })
      .mockResolvedValueOnce({ data: { status: "unavailable" } });

    const { result } = renderRuntime("cli");
    await waitFor(() => expect(result.current.launch.status).toBe("unavailable"));

    expect(result.current.launch.url).toBeNull();
    expect(result.current.launch.error).toContain("service status");
    expect(JSON.stringify(result.current)).not.toMatch(/backend|container|storagePath|sessionToken/i);
  });

  it("rejects an exchanged isolated launch when backend health fails", async () => {
    const origin = runtimeOrigin("web");
    apiRequest
      .mockResolvedValueOnce({ data: { mode: "isolated", status: "no_runtime", reason: "explicit_start_required" } })
      .mockResolvedValueOnce({ data: [workspace] })
      .mockResolvedValueOnce({ data: { status: "ready" } })
      .mockResolvedValueOnce({ data: { launchUrl: `${origin}/__ingenium/exchange`, status: "ready" } });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce({ ok: false, status: 503 }));

    const { result } = renderRuntime();
    await waitFor(() => expect(result.current.workspace.status).toBe("selecting"));
    act(() => result.current.workspace.selectWorkspace(workspace.id));
    await act(async () => { await result.current.workspace.start(); });
    await waitFor(() => expect(result.current.launch.status).toBe("unavailable"));

    expect(result.current.launch.url).toBeNull();
    expect(result.current.launch.error).toContain("did not become ready");
  });

  it("reports an unavailable toolbar state without claiming isolated connectivity", () => {
    render(<OpenCodeToolbar mode="web" onModeChange={vi.fn()} status="error" />);

    expect(screen.getByLabelText("OpenCode runtime unavailable")).toBeTruthy();
    expect(document.body.textContent).not.toContain("isolated runtime connected");
  });

  it("uses last-used only as a preference and never starts it as a read side effect", async () => {
    localStorage.setItem("ingenium-runtime-workspace-preference", workspace.id);
    apiRequest
      .mockResolvedValueOnce({ data: { mode: "isolated", status: "ready", reason: null } })
      .mockResolvedValueOnce({ data: [{ ...workspace, status: "ready" }] });

    const { result } = renderRuntime();
    await waitFor(() => expect(result.current.workspace.status).toBe("selecting"));

    expect(result.current.workspace.selectedWorkspaceId).toBe(workspace.id);
    expect(result.current.workspace.confirmedWorkspaceId).toBeNull();
    expect(result.current.launch.url).toBeNull();
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("bounds starting-state polling and offers retry", async () => {
    vi.useFakeTimers();
    apiRequest
      .mockResolvedValueOnce({ data: { mode: "isolated", status: "starting", reason: "runtime_starting" } })
      .mockResolvedValueOnce({ data: [{ ...workspace, status: "starting" }] })
      .mockResolvedValueOnce({ data: { status: "starting" } });
    for (let attempt = 0; attempt < RUNTIME_START_MAX_ATTEMPTS; attempt += 1) {
      apiRequest.mockResolvedValueOnce({ data: [{ ...workspace, status: "starting" }] });
    }

    const { result } = renderRuntime();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.workspace.status).toBe("selecting");
    act(() => result.current.workspace.selectWorkspace(workspace.id));
    let starting!: Promise<void>;
    act(() => { starting = result.current.workspace.start(); });
    await act(async () => { await vi.runAllTimersAsync(); await starting; });

    expect(result.current.workspace.status).toBe("error");
    expect(result.current.workspace.error).toContain("still starting");
    expect(apiRequest).toHaveBeenCalledTimes(3 + RUNTIME_START_MAX_ATTEMPTS);
  });

  it("renders an accessible mobile-safe picker without sensitive runtime details", () => {
    const selectWorkspace = vi.fn();
    const start = vi.fn();
    const controller = {
      mode: "isolated",
      status: "selecting",
      workspaces: [workspace, { ...workspace, id: "workspace-two", projectName: "Second Project" }],
      selectedWorkspaceId: null,
      confirmedWorkspaceId: null,
      error: null,
      selectWorkspace,
      start,
      retry: vi.fn(),
    } as RuntimeWorkspaceController;

    render(<RuntimeWorkspacePicker controller={controller} product="OpenCode Web" />);

    expect(screen.getByRole("group", { name: "Choose a workspace for OpenCode Web" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect((screen.getByRole("button", { name: "Open workspace" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Example Project/ }));
    expect(selectWorkspace).toHaveBeenCalledWith("workspace-one");
    expect(document.body.innerHTML).toContain("flex-col-reverse");
    expect(document.body.innerHTML).not.toMatch(/backend|storagePath|ownerUserId|projectId|\/srv\//i);
  });
});
