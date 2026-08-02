import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  chatConfig: vi.fn(),
  session: {
    activeId: "session-1" as string | null,
    sessions: [{ id: "session-1", title: "Private session title", time: { created: 1, updated: 1 } }],
    isLoading: false,
  },
  chat: {
    isLoading: false,
    isStreaming: false,
  },
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

vi.mock("../src/app/tasks/components/TaskCaptureModal", () => ({
  default: (props: {
    isOpen: boolean;
    source: Record<string, unknown>;
    onClose: () => void;
    onCaptured: (result: { task: { title: string } }) => void;
  }) => props.isOpen ? (
    <section role="dialog" aria-label="Create Task">
      <output data-testid="chat-task-capture-source">{JSON.stringify(props.source)}</output>
      <button
        type="button"
        onClick={() => {
          props.onCaptured({ task: { title: "Task from conversation" } });
          props.onClose();
        }}
      >
        Capture task
      </button>
      <button type="button" onClick={props.onClose}>Cancel</button>
    </section>
  ) : null,
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useGlobalProject: () => ({ project: "global-default", loading: false, error: null }),
  useProject: () => "selected-project",
}));

vi.mock("../src/lib/opencode", () => ({
  opencode: {
    mcp: { status: vi.fn().mockResolvedValue({}), connect: vi.fn(), disconnect: vi.fn() },
  },
}));

vi.mock("../src/lib/use-opencode-sessions", () => ({
  useOpenCodeSessions: () => ({
    sessions: mocks.session.sessions,
    activeId: mocks.session.activeId,
    create: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    select: vi.fn(),
    fork: vi.fn(),
    share: vi.fn(),
    isLoading: mocks.session.isLoading,
    error: null,
    autoCreated: false,
  }),
}));

vi.mock("../src/lib/use-opencode-chat", () => ({
  useOpenCodeChat: () => ({
    messages: [],
    isStreaming: mocks.chat.isStreaming,
    isLoading: mocks.chat.isLoading,
    error: null,
    streamActivity: "idle",
    permissions: [],
    questions: [],
    replyPermission: vi.fn(),
    send: vi.fn(),
    stop: vi.fn(),
    retry: vi.fn(),
    revert: vi.fn(),
  }),
}));

import ChatShell from "../src/app/chat/components/ChatShell";

const chatConfig = {
  configured: true,
  primary: { providerId: "provider", modelId: "model", label: "Provider", isCustom: false },
  backup: null,
  agents: [{ name: "ingenium-chat", label: "Ingenium Chat" }],
  providers: [{
    providerId: "provider",
    label: "Provider",
    models: [{ id: "model", label: "Model" }],
    defaultModel: "model",
    source: "managed" as const,
  }],
  defaultSelection: { providerId: "provider", modelId: "model" },
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

describe("Chat task capture", () => {
  let restoreMatchMedia: (() => void) | undefined;

  beforeEach(() => {
    restoreMatchMedia = setupMatchMedia();
    mocks.session.activeId = "session-1";
    mocks.session.sessions = [{ id: "session-1", title: "Private session title", time: { created: 1, updated: 1 } }];
    mocks.session.isLoading = false;
    mocks.chat.isLoading = false;
    mocks.chat.isStreaming = false;
    mocks.chatConfig.mockResolvedValue({ data: chatConfig });
  });

  afterEach(() => {
    cleanup();
    restoreMatchMedia?.();
    restoreMatchMedia = undefined;
    vi.clearAllMocks();
  });

  it("disables the action without a validated active session or while sessions load", () => {
    mocks.session.activeId = "stale-session";
    render(<ChatShell />);
    expect((screen.getByRole("button", { name: "Create task from conversation" }) as HTMLButtonElement).disabled).toBe(true);

    cleanup();
    mocks.session.activeId = "session-1";
    mocks.session.isLoading = true;
    render(<ChatShell />);
    expect((screen.getByRole("button", { name: "Create task from conversation" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens the shared modal with only the chat source identity", async () => {
    render(<ChatShell />);
    const action = screen.getByRole("button", { name: "Create task from conversation" });
    await waitFor(() => expect(action).toHaveProperty("disabled", false));
    fireEvent.click(action);

    expect(JSON.parse((await screen.findByTestId("chat-task-capture-source")).textContent!)).toEqual({
      source_type: "chat",
      session_id: "session-1",
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(JSON.stringify({ source_type: "chat", session_id: "session-1" })).not.toMatch(
      /sessionTitle|projectID|messages|parts|reasoning|tools|system|context/i,
    );
  });

  it("announces successful capture accessibly with a tasks link", async () => {
    render(<ChatShell />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create task from conversation" })).toHaveProperty("disabled", false));
    fireEvent.click(screen.getByRole("button", { name: "Create task from conversation" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Capture task" }));

    const notice = await screen.findByTestId("chat-task-capture-status");
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.getAttribute("aria-live")).toBe("polite");
    expect(notice.className).toContain("bg-[var(--color-success-bg)]");
    expect(notice.className).toContain("text-[var(--color-success-text)]");
    expect(screen.getByRole("link", { name: "Task from conversation" }).getAttribute("href")).toBe("/tasks");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
