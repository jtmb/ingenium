import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  chatConfig: vi.fn(),
  mcpStatus: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
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
  useGlobalProject: () => ({ project: "global-default", loading: false, error: null }),
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
import { ApiError } from "../src/lib/api";

const validConfig = {
  configured: true,
  primary: { providerId: "provider", modelId: "model", label: "Provider", isCustom: false },
  backup: null,
  agents: [{ name: "ingenium-chat", label: "Ingenium Chat" }],
  providers: [{ providerId: "provider", label: "Provider", models: [{ id: "model", label: "Model" }], defaultModel: "model", source: "managed" as const }],
  defaultSelection: { providerId: "provider", modelId: "model" },
};

const emptyConfig = {
  configured: false,
  primary: null,
  backup: null,
  agents: [],
  providers: [],
  defaultSelection: null,
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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

describe("ChatShell chat-config readiness", () => {
  let restoreMatchMedia: (() => void) | undefined;

  beforeEach(() => {
    restoreMatchMedia = setupMatchMedia();
    mocks.mcpStatus.mockResolvedValue({});
    mocks.connect.mockResolvedValue({});
    mocks.disconnect.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    restoreMatchMedia?.();
    restoreMatchMedia = undefined;
    vi.clearAllMocks();
  });

  it("does not insert the no-model banner while a delayed valid catalog resolves", async () => {
    const request = deferred<{ data: typeof validConfig }>();
    mocks.chatConfig.mockReturnValue(request.promise);
    render(<ChatShell />);

    expect(screen.queryByText(/No model is available/)).toBeNull();

    const bannerInsertions: Node[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if (node.textContent?.includes("No model is available")) bannerInsertions.push(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    request.resolve({ data: validConfig });
    await waitFor(() => expect(screen.getByTestId("chat-header-model")).toHaveProperty("value", "model"));
    observer.disconnect();

    expect(bannerInsertions).toHaveLength(0);
    expect(screen.queryByText(/No model is available/)).toBeNull();
  });

  it("shows the no-model banner only after a successful empty catalog response", async () => {
    const request = deferred<{ data: typeof emptyConfig }>();
    mocks.chatConfig.mockReturnValue(request.promise);
    render(<ChatShell />);

    expect(screen.queryByText(/No model is available/)).toBeNull();
    request.resolve({ data: emptyConfig });
    expect(await screen.findByText(/No model is available/)).toBeTruthy();
  });

  it("keeps a config error distinct from the no-model banner", async () => {
    mocks.chatConfig.mockRejectedValue(new Error("catalog unavailable"));
    render(<ChatShell />);

    expect(await screen.findByText(/Failed to load chat config: catalog unavailable/)).toBeTruthy();
    expect(screen.queryByText(/No model is available/)).toBeNull();
  });

  it("does not show the no-model banner for a rate-limited config request", async () => {
    mocks.chatConfig.mockRejectedValue(new ApiError(429, "Too Many Requests", 5));
    render(<ChatShell />);

    expect(await screen.findByText(/retrying in 5s/)).toBeTruthy();
    expect(screen.queryByText(/No model is available/)).toBeNull();
  });
});
