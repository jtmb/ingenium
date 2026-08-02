import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  chatConfig: vi.fn(),
  saveChatSelection: vi.fn(),
  mcpStatus: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  globalProject: "global-default",
}));

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      settings: {
        ...actual.api.settings,
        chatConfig: mocks.chatConfig,
        saveChatSelection: mocks.saveChatSelection,
      },
    },
  };
});

vi.mock("../src/lib/opencode", () => ({
  opencode: {
    mcp: { status: mocks.mcpStatus, connect: mocks.connect, disconnect: mocks.disconnect },
  },
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useGlobalProject: () => ({ project: mocks.globalProject, loading: false, error: null }),
  useProject: () => "selected-project",
}));

vi.mock("../src/lib/use-opencode-sessions", () => ({
  useOpenCodeSessions: () => ({
    sessions: [{ id: "sess-1", title: "Test", time: { created: 1, updated: 1 } }],
    activeId: "sess-1",
    create: vi.fn(), rename: vi.fn(), remove: vi.fn(), select: vi.fn(), fork: vi.fn(), share: vi.fn(),
    isLoading: false, error: null, autoCreated: false,
  }),
}));

vi.mock("../src/lib/use-opencode-chat", () => ({
  useOpenCodeChat: () => ({
    messages: [], isStreaming: false, isLoading: false, error: null, streamActivity: "idle",
    permissions: [], questions: [], replyPermission: vi.fn(), send: vi.fn(), stop: vi.fn(), retry: vi.fn(), revert: vi.fn(),
  }),
}));

import ChatShell from "../src/app/chat/components/ChatShell";

const config = {
  project: "global-default",
  configured: true,
  primary: { providerId: "provider", modelId: "model", label: "Provider", isCustom: false },
  backup: null,
  agents: [{ name: "ingenium-chat", label: "Ingenium Chat" }],
  providers: [{ providerId: "provider", label: "Provider", models: [{ id: "model", label: "Model" }], defaultModel: "model", source: "managed" as const }],
  defaultSelection: { providerId: "provider", modelId: "model" },
};

const multiProviderConfig = {
  ...config,
  providers: [
    config.providers[0],
    {
      providerId: "provider-b",
      label: "Provider B",
      models: [{ id: "model-b", label: "Model B" }],
      defaultModel: "model-b",
      source: "managed" as const,
    },
  ],
};

function setupMatchMedia(): () => void {
  const original = Object.getOwnPropertyDescriptor(window, "matchMedia");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
  return () => {
    if (original) Object.defineProperty(window, "matchMedia", original);
    else delete (window as Window & { matchMedia?: Window["matchMedia"] }).matchMedia;
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function openDrawer() {
  fireEvent.click(screen.getByRole("button", { name: "MCP servers" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "MCP Servers" })).toBeTruthy());
}

describe("ChatShell MCP refresh and action errors", () => {
  let restoreMatchMedia: (() => void) | undefined;

  beforeEach(() => {
    restoreMatchMedia = setupMatchMedia();
    localStorage.clear();
    mocks.globalProject = "global-default";
    mocks.chatConfig.mockResolvedValue({ data: config });
    mocks.saveChatSelection.mockResolvedValue({ data: { providerId: "provider", modelId: "model" } });
    mocks.connect.mockResolvedValue({});
    mocks.disconnect.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    restoreMatchMedia?.();
    restoreMatchMedia = undefined;
    vi.clearAllMocks();
  });

  it("renders upstream status:connected as Connected", async () => {
    mocks.mcpStatus.mockResolvedValue({ alpha: { status: "connected" } });
    render(<ChatShell />);

    await openDrawer();
    expect(await screen.findByText("Connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
    expect(mocks.saveChatSelection).not.toHaveBeenCalled();
  });

  it("refreshes status each time the drawer is reopened and offers a normal Refresh action", async () => {
    mocks.mcpStatus.mockResolvedValue({ alpha: { status: "connected" } });
    render(<ChatShell />);

    await openDrawer();
    await waitFor(() => expect(mocks.mcpStatus).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Close MCP drawer" }));
    fireEvent.click(screen.getByRole("button", { name: "MCP servers" }));
    await waitFor(() => expect(mocks.mcpStatus).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(mocks.mcpStatus).toHaveBeenCalledTimes(3));
    expect(screen.getByTestId("mcp-last-refresh").textContent).toContain("Last refreshed:");
  });

  it("loads Chat configuration and shows tools use the authoritative global project", async () => {
    mocks.mcpStatus.mockRejectedValue(new Error("unavailable"));
    mocks.globalProject = "browser-selected-project";
    mocks.chatConfig.mockResolvedValue({ data: { ...config, project: "server-shared" } });
    render(<ChatShell />);

    expect((await screen.findByTestId("chat-global-project")).textContent).toContain(
      "Chat tools run through global project:server-shared",
    );
    await openDrawer();
    expect(screen.getByRole("link", { name: "MCP Servers" }).getAttribute("href"))
      .toBe("/mcp-servers?project=server-shared");
    await waitFor(() => expect(mocks.chatConfig).toHaveBeenCalledWith());
  });

  it("does not substitute the browser global project when server attestation is absent", async () => {
    mocks.globalProject = "browser-selected-project";
    mocks.mcpStatus.mockRejectedValue(new Error("unavailable"));
    mocks.chatConfig.mockResolvedValue({ data: { ...config, project: null } });
    render(<ChatShell />);

    await openDrawer();
    expect(screen.queryByTestId("chat-global-project")).toBeNull();
    expect(screen.queryByRole("link", { name: "MCP Servers" })).toBeNull();
  });

  it("persists the exact catalog-selected provider and model through the server endpoint", async () => {
    mocks.mcpStatus.mockResolvedValue({});
    mocks.chatConfig.mockResolvedValue({ data: multiProviderConfig });
    render(<ChatShell />);

    const providerSelect = await screen.findByTestId("chat-header-provider");
    await waitFor(() => expect(providerSelect).toHaveProperty("value", "provider"));
    fireEvent.change(providerSelect, { target: { value: "provider-b" } });

    await waitFor(() => expect(screen.getByTestId("chat-header-model")).toHaveProperty("value", "model-b"));
    await waitFor(() => expect(mocks.saveChatSelection).toHaveBeenCalledWith({
      providerId: "provider-b",
      modelId: "model-b",
    }));
  });

  it("shows a refresh failure rather than silently clearing MCP state", async () => {
    mocks.mcpStatus.mockRejectedValue(new Error("private upstream diagnostic"));
    render(<ChatShell />);

    await openDrawer();
    expect((await screen.findByRole("alert")).textContent).toContain("MCP status is unavailable. Verify OpenCode is running, then retry.");
    expect(screen.queryByText("private upstream diagnostic")).toBeNull();
  });

  it("refreshes to the returned state after connecting", async () => {
    mocks.mcpStatus
      .mockResolvedValueOnce({ alpha: { status: "disabled" } })
      .mockResolvedValueOnce({ alpha: { status: "connected" } });
    render(<ChatShell />);

    await openDrawer();
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(mocks.connect).toHaveBeenCalledWith("alpha"));
    await waitFor(() => expect(screen.getByText("Connected")).toBeTruthy());
  });

  it("shows the actionable packaged-launcher diagnostic for a failed Ingenium connection", async () => {
    mocks.mcpStatus.mockResolvedValue({ ingenium: { status: "failed" } });
    render(<ChatShell />);

    await openDrawer();
    expect(await screen.findByText("Ingenium MCP could not connect. Build the extension launcher, then verify the protected API token and project identity.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
  });

  it("reports a connect failure and still refreshes the remote state", async () => {
    mocks.mcpStatus.mockResolvedValue({ alpha: { status: "disabled" } });
    mocks.connect.mockRejectedValue(new Error("upstream secret"));
    render(<ChatShell />);

    await openDrawer();
    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Unable to connect to alpha. Try again.");
    expect(mocks.mcpStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("reports a disconnect failure and still refreshes the remote state", async () => {
    mocks.mcpStatus.mockResolvedValue({ alpha: { status: "connected" } });
    mocks.disconnect.mockRejectedValue(new Error("upstream secret"));
    render(<ChatShell />);

    await openDrawer();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Unable to disconnect from alpha. Try again.");
    expect(mocks.mcpStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps provider recovery available for a stale default model and atomically selects the new provider default", async () => {
    mocks.mcpStatus.mockResolvedValue({});
    mocks.chatConfig.mockResolvedValue({
      data: {
        ...multiProviderConfig,
        defaultSelection: { providerId: "provider", modelId: "missing-model" },
      },
    });
    render(<ChatShell />);

    const providerSelect = await screen.findByTestId("chat-header-provider") as HTMLSelectElement;
    const modelSelect = screen.getByTestId("chat-header-model") as HTMLSelectElement;
    await waitFor(() => expect(modelSelect.value).toBe("model"));
    expect(providerSelect.disabled).toBe(false);

    fireEvent.change(providerSelect, { target: { value: "provider-b" } });

    await waitFor(() => {
      expect(providerSelect.value).toBe("provider-b");
      expect(modelSelect.value).toBe("model-b");
    });
    expect(mocks.saveChatSelection).toHaveBeenLastCalledWith({
      providerId: "provider-b",
      modelId: "model-b",
    });
  });

  it("recovers from a null default selection with an enabled provider selector and valid model", async () => {
    mocks.mcpStatus.mockResolvedValue({});
    mocks.chatConfig.mockResolvedValue({
      data: {
        ...multiProviderConfig,
        configured: false,
        primary: null,
        defaultSelection: null,
      },
    });
    render(<ChatShell />);

    const providerSelect = await screen.findByTestId("chat-header-provider") as HTMLSelectElement;
    const modelSelect = screen.getByTestId("chat-header-model") as HTMLSelectElement;
    await waitFor(() => {
      expect(providerSelect.disabled).toBe(false);
      expect(modelSelect.value).toBe("model");
    });

    fireEvent.change(providerSelect, { target: { value: "provider-b" } });

    await waitFor(() => {
      expect(providerSelect.value).toBe("provider-b");
      expect(modelSelect.value).toBe("model-b");
    });
    expect(mocks.saveChatSelection).toHaveBeenLastCalledWith({
      providerId: "provider-b",
      modelId: "model-b",
    });
  });

  it("serializes rapid selection persistence so the latest pair is saved last", async () => {
    mocks.mcpStatus.mockResolvedValue({});
    mocks.chatConfig.mockResolvedValue({ data: multiProviderConfig });
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mocks.saveChatSelection
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    render(<ChatShell />);

    const providerSelect = await screen.findByTestId("chat-header-provider");
    await waitFor(() => expect(providerSelect).toHaveProperty("value", "provider"));
    fireEvent.change(providerSelect, { target: { value: "provider-b" } });
    await waitFor(() => expect(mocks.saveChatSelection).toHaveBeenCalledWith({
      providerId: "provider-b",
      modelId: "model-b",
    }));

    fireEvent.change(providerSelect, { target: { value: "provider" } });
    await waitFor(() => expect(providerSelect).toHaveProperty("value", "provider"));
    expect(mocks.saveChatSelection).toHaveBeenCalledTimes(1);

    first.resolve({});
    await waitFor(() => expect(mocks.saveChatSelection).toHaveBeenCalledWith({
      providerId: "provider",
      modelId: "model",
    }));
    second.resolve({});
    expect(mocks.saveChatSelection).toHaveBeenLastCalledWith({
      providerId: "provider",
      modelId: "model",
    });
  });
});
