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
  runtimeWorkspacePreferenceKey,
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
  runtimeId: null,
};
const scope = { userId: "22222222-2222-4222-8222-222222222222", projectName: workspace.projectName };

function storeRuntimeBinding(
  bindingScope = scope,
  workspaceId = workspace.id,
  bindingRuntimeId = runtimeId,
): void {
  localStorage.setItem(runtimeWorkspacePreferenceKey(bindingScope), JSON.stringify({
    ...bindingScope,
    workspaceId,
    runtimeId: bindingRuntimeId,
  }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

beforeEach(() => localStorage.clear());

afterEach(() => {
  cleanup();
  apiRequest.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderRuntime(audience: "web" | "cli" | "vscode" = "web") {
  return renderHook(() => {
    const workspaceController = useRuntimeWorkspace(scope);
    return { workspace: workspaceController, launch: useRuntimeLaunch(audience, workspaceController) };
  });
}

function RuntimeChatHarness() {
  const controller = useRuntimeWorkspace(scope);
  if (controller.status === "ready") return <div data-testid="chat-ready">Chat ready</div>;
  return <RuntimeWorkspacePicker controller={controller} product="Ingenium Chat" />;
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
      .mockResolvedValueOnce({ data: { status: "ready", runtimeId } })
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
    expect(result.current.workspace.confirmedProjectName).toBe(workspace.projectName);
    expect(JSON.parse(localStorage.getItem(runtimeWorkspacePreferenceKey(scope))!)).toEqual({
      ...scope,
      workspaceId: workspace.id,
      runtimeId,
    });
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
      .mockResolvedValueOnce({ data: { status: "ready", runtimeId } })
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

  it("revalidates a scoped ready workspace and restores its iframe launch after refresh", async () => {
    storeRuntimeBinding();
    apiRequest
      .mockResolvedValueOnce({ data: { mode: "isolated", status: "ready", reason: null } })
      .mockResolvedValueOnce({ data: [{ ...workspace, status: "ready", runtimeId }] })
      .mockResolvedValueOnce({ data: { launchUrl: `${runtimeOrigin("web")}/__ingenium/exchange`, status: "ready" } });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce({ ok: true, status: 204 }));

    const { result } = renderRuntime();
    await waitFor(() => expect(result.current.launch.status).toBe("ready"));

    expect(result.current.workspace.selectedWorkspaceId).toBe(workspace.id);
    expect(result.current.workspace.confirmedWorkspaceId).toBe(workspace.id);
    expect(result.current.workspace.confirmedRuntimeId).toBe(runtimeId);
    expect(result.current.launch.url).toBe(`${runtimeOrigin("web")}/`);
    expect(apiRequest).toHaveBeenCalledTimes(3);
    expect(apiRequest).not.toHaveBeenCalledWith(expect.stringContaining("/start"), expect.anything());
  });

  it.each([
    ["missing", []],
    ["stopped", [{ ...workspace, status: "stopped", runtimeId: null }]],
    ["failed", [{ ...workspace, status: "stopped", runtimeId: null }]],
    ["revoked-or-security-epoch", [{ ...workspace, status: "unavailable", runtimeId: null }]],
    ["foreign-owner", [{ ...workspace, id: "workspace-two", status: "ready", runtimeId }]],
    ["replaced-runtime", [{ ...workspace, status: "ready", runtimeId: "44444444-4444-4444-8444-444444444444" }]],
    ["wrong-project", [{ ...workspace, projectName: "Other Project", status: "ready", runtimeId }]],
  ])("clears a %s remembered workspace and fails closed to the picker", async (_case, listed) => {
    const preferenceKey = runtimeWorkspacePreferenceKey(scope);
    storeRuntimeBinding();
    apiRequest
      .mockResolvedValueOnce({ data: { mode: "isolated", status: "ready", reason: null } })
      .mockResolvedValueOnce({ data: listed });

    const { result } = renderRuntime();
    await waitFor(() => expect(result.current.workspace.status).toBe(listed.length === 0 ? "empty" : "selecting"));

    expect(result.current.workspace.confirmedWorkspaceId).toBeNull();
    expect(result.current.launch.url).toBeNull();
    expect(localStorage.getItem(preferenceKey)).toBeNull();
    if (listed.length > 0) expect(result.current.workspace.error).toMatch(/remembered workspace/i);
  });

  it.each([
    ["account", { userId: "33333333-3333-4333-8333-333333333333", projectName: workspace.projectName }],
    ["project", { userId: scope.userId, projectName: "Other Project" }],
  ])("clears a remembered workspace after an %s switch", async (_switch, otherScope) => {
    storeRuntimeBinding();
    const otherPreferenceKey = runtimeWorkspacePreferenceKey(otherScope);
    localStorage.setItem(otherPreferenceKey, localStorage.getItem(runtimeWorkspacePreferenceKey(scope))!);
    apiRequest
      .mockResolvedValueOnce({ data: { mode: "isolated", status: "ready", reason: null } })
      .mockResolvedValueOnce({ data: [{ ...workspace, projectName: otherScope.projectName, status: "ready", runtimeId }] });

    const { result } = renderHook(() => useRuntimeWorkspace(otherScope));
    await waitFor(() => expect(result.current.status).toBe("selecting"));

    expect(result.current.selectedWorkspaceId).toBeNull();
    expect(result.current.confirmedRuntimeId).toBeNull();
    expect(localStorage.getItem(otherPreferenceKey)).toBeNull();
  });

  it.each(["click", "keyboard"] as const)("confirms a ready runtime through %s submit without starting it", async (submission) => {
    apiRequest
      .mockResolvedValueOnce({ data: { mode: "isolated", status: "ready", reason: null } })
      .mockResolvedValueOnce({ data: [{ ...workspace, status: "ready", runtimeId }] });

    render(<RuntimeChatHarness />);
    const radio = await screen.findByRole("radio", { name: /Example Project/ });
    fireEvent.click(radio);
    const open = screen.getByRole("button", { name: "Open workspace" });
    expect((open as HTMLButtonElement).disabled).toBe(false);

    if (submission === "click") fireEvent.click(open);
    else (open.closest("form") as HTMLFormElement).requestSubmit();

    await screen.findByTestId("chat-ready");
    expect(apiRequest).toHaveBeenCalledTimes(2);
    expect(apiRequest.mock.calls.filter(([path]) => String(path).endsWith("/start"))).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(runtimeWorkspacePreferenceKey(scope))!)).toEqual({
      ...scope,
      workspaceId: workspace.id,
      runtimeId,
    });
  });

  it.each([
    ["missing runtime identity", { ...workspace, status: "ready" as const, runtimeId: null }, /not ready/i],
    ["different project", { ...workspace, projectName: "Other Project", status: "ready" as const, runtimeId }, /does not belong/i],
  ])("does not bind or start a ready workspace with %s", async (_case, listedWorkspace, message) => {
    apiRequest
      .mockResolvedValueOnce({ data: { mode: "isolated", status: "ready", reason: null } })
      .mockResolvedValueOnce({ data: [listedWorkspace] });

    const { result } = renderHook(() => useRuntimeWorkspace(scope));
    await waitFor(() => expect(result.current.status).toBe("selecting"));
    act(() => result.current.selectWorkspace(listedWorkspace.id));
    await act(async () => { await result.current.start(); });

    expect(result.current.error).toMatch(message);
    expect(result.current.confirmedRuntimeId).toBeNull();
    expect(apiRequest.mock.calls.filter(([path]) => String(path).endsWith("/start"))).toHaveLength(0);
    expect(localStorage.getItem(runtimeWorkspacePreferenceKey(scope))).toBeNull();
  });

  it("persists a selected ready binding and restores it after remount without a start", async () => {
    apiRequest
      .mockResolvedValueOnce({ data: { mode: "isolated", status: "ready", reason: null } })
      .mockResolvedValueOnce({ data: [{ ...workspace, status: "ready", runtimeId }] });

    const first = renderHook(() => useRuntimeWorkspace(scope));
    await waitFor(() => expect(first.result.current.status).toBe("selecting"));
    act(() => first.result.current.selectWorkspace(workspace.id));
    await act(async () => { await first.result.current.start(); });
    expect(first.result.current.confirmedRuntimeId).toBe(runtimeId);
    first.unmount();

    apiRequest
      .mockResolvedValueOnce({ data: { mode: "isolated", status: "ready", reason: null } })
      .mockResolvedValueOnce({ data: [{ ...workspace, status: "ready", runtimeId }] });
    const second = renderHook(() => useRuntimeWorkspace(scope));
    await waitFor(() => expect(second.result.current.status).toBe("ready"));

    expect(second.result.current.confirmedWorkspaceId).toBe(workspace.id);
    expect(second.result.current.confirmedRuntimeId).toBe(runtimeId);
    expect(apiRequest.mock.calls.filter(([path]) => String(path).endsWith("/start"))).toHaveLength(0);
  });

  it("writes storage only after server confirmation and suppresses duplicate start requests", async () => {
    const started = deferred<{ data: { status: "ready"; runtimeId: string } }>();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    apiRequest
      .mockResolvedValueOnce({ data: { mode: "isolated", status: "no_runtime", reason: "explicit_start_required" } })
      .mockResolvedValueOnce({ data: [workspace] })
      .mockImplementationOnce(() => started.promise);

    const { result } = renderHook(() => useRuntimeWorkspace(scope));
    await waitFor(() => expect(result.current.status).toBe("selecting"));
    act(() => result.current.selectWorkspace(workspace.id));
    let firstStart!: Promise<void>;
    act(() => {
      firstStart = result.current.start();
      void result.current.start();
    });

    expect(setItem).not.toHaveBeenCalled();
    expect(apiRequest.mock.calls.filter(([path]) => String(path).endsWith("/start"))).toHaveLength(1);
    started.resolve({ data: { status: "ready", runtimeId } });
    await act(async () => { await firstStart; });

    expect(setItem).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("ready");
  });

  it("does not persist a completed start after its account-project scope unmounts", async () => {
    const started = deferred<{ data: { status: "ready"; runtimeId: string } }>();
    apiRequest
      .mockResolvedValueOnce({ data: { mode: "isolated", status: "no_runtime", reason: "explicit_start_required" } })
      .mockResolvedValueOnce({ data: [workspace] })
      .mockImplementationOnce(() => started.promise);

    const view = renderHook(() => useRuntimeWorkspace(scope));
    await waitFor(() => expect(view.result.current.status).toBe("selecting"));
    act(() => view.result.current.selectWorkspace(workspace.id));
    let start!: Promise<void>;
    act(() => { start = view.result.current.start(); });
    view.unmount();
    started.resolve({ data: { status: "ready", runtimeId } });
    await act(async () => { await start; });

    expect(localStorage.getItem(runtimeWorkspacePreferenceKey(scope))).toBeNull();
  });

  it("reports one failed stopped-runtime start without persisting a binding", async () => {
    apiRequest
      .mockResolvedValueOnce({ data: { mode: "isolated", status: "no_runtime", reason: "explicit_start_required" } })
      .mockResolvedValueOnce({ data: [workspace] })
      .mockRejectedValueOnce(new Error("manager failed"));

    const { result } = renderHook(() => useRuntimeWorkspace(scope));
    await waitFor(() => expect(result.current.status).toBe("selecting"));
    act(() => result.current.selectWorkspace(workspace.id));
    await act(async () => { await result.current.start(); });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("The workspace could not be started.");
    expect(apiRequest.mock.calls.filter(([path]) => String(path).endsWith("/start"))).toHaveLength(1);
    expect(localStorage.getItem(runtimeWorkspacePreferenceKey(scope))).toBeNull();
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
      confirmedRuntimeId: null,
      confirmedProjectName: null,
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
