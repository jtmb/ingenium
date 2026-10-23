import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  listConversations: vi.fn(),
  listSources: vi.fn(),
  getConversation: vi.fn(),
  listMessages: vi.fn(),
  searchMessages: vi.fn(),
  batchMessages: vi.fn(),
  listCheckpoints: vi.fn(),
  restoreCheckpoint: vi.fn(),
  listMemories: vi.fn(),
  updateMemory: vi.fn(),
  forgetMemory: vi.fn(),
  operationStatus: vi.fn(),
  runtimeProjectName: "context-project" as string | null,
  runtimeWorkspaceId: "context-workspace" as string | null,
  runtimeStatus: "ready" as "ready" | "selecting",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams("project=context-project"),
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => "context-project",
}));

vi.mock("../src/lib/RuntimeContext", () => ({
  useRuntime: () => ({
    workspace: {
      mode: "isolated",
      status: mocks.runtimeStatus,
      workspaces: [{ id: "context-workspace", organizationName: "Context Org", projectName: "context-project", status: "ready", runtimeId: "runtime-id" }],
      selectedWorkspaceId: null,
      confirmedProjectName: mocks.runtimeProjectName,
      confirmedWorkspaceId: mocks.runtimeWorkspaceId,
      confirmedRuntimeId: mocks.runtimeWorkspaceId ? "runtime-id" : null,
      error: null,
      selectWorkspace: vi.fn(),
      start: vi.fn(),
      retry: vi.fn(),
    },
  }),
}));

vi.mock("../src/lib/api", () => ({
  api: {
    settings: { get: vi.fn(async () => ({ data: { value: undefined } })), set: vi.fn() },
    context: {
      sources: {
        list: mocks.listSources,
      },
      conversations: {
        list: mocks.listConversations,
        get: mocks.getConversation,
      },
      messages: {
        list: mocks.listMessages,
        search: mocks.searchMessages,
        batch: mocks.batchMessages,
      },
      checkpoints: {
        list: mocks.listCheckpoints,
        restore: mocks.restoreCheckpoint,
      },
    },
    memory: {
      list: mocks.listMemories,
      update: mocks.updateMemory,
      forget: mocks.forgetMemory,
      operationStatus: mocks.operationStatus,
    },
  },
}));

import ContextWorkspace from "../src/app/context/components/ContextWorkspace";

const conversation = {
  id: "conversation-one",
  project_id: "project-id",
  title: "Formatting preferences",
  tags: '["preference"]',
  priority: 7,
  metadata: "{}",
  created_at: "2026-07-27T12:00:00.000Z",
  revision: 2,
  message_count: 2,
  checkpoint_count: 1,
  latest_message_id: "message-two",
};

const messageSummaries = [
  {
    id: "message-one",
    project_id: "project-id",
    conversation_id: "conversation-one",
    sequence: 0,
    role: "user",
    content_hash: "a".repeat(64),
    tags: "[]",
    priority: 5,
    metadata: "{}",
    created_at: "2026-07-27T12:00:00.000Z",
  },
  {
    id: "message-two",
    project_id: "project-id",
    conversation_id: "conversation-one",
    sequence: 1,
    role: "assistant",
    content_hash: "b".repeat(64),
    tags: "[]",
    priority: 5,
    metadata: "{}",
    created_at: "2026-07-27T12:01:00.000Z",
  },
];

const messages = [
  { ...messageSummaries[0], content: "Please use concise formatting." },
  { ...messageSummaries[1], content: "I will use concise formatting." },
];

const checkpoint = {
  id: "checkpoint-one",
  project_id: "project-id",
  conversation_id: "conversation-one",
  sequence: 0,
  through_message_id: "message-two",
  message_count: 2,
  state_hash: "c".repeat(64),
  metadata: "{}",
  created_at: "2026-07-27T12:02:00.000Z",
};

const savedMemory = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationId: "organization-id",
  projectId: "project-id",
  workspaceId: "context-workspace",
  ownerUserId: "user-id",
  visibility: "private",
  content: "Use concise status summaries.",
  contentHash: "d".repeat(64),
  tags: ["preference"],
  version: 2,
  state: "active",
  originType: "explicit",
  originId: null,
  createdAt: "2026-09-05T00:00:00.000Z",
  updatedAt: "2026-09-05T00:01:00.000Z",
  forgottenAt: null,
};

function setDefaultResponses() {
  mocks.listSources.mockResolvedValue({ data: [], total: 0, limit: 20, offset: 0 });
  mocks.listConversations.mockResolvedValue({ data: { data: [conversation], nextCursor: null } });
  mocks.getConversation.mockResolvedValue({ data: conversation });
  mocks.listMessages.mockResolvedValue({ data: { data: messageSummaries, nextCursor: null } });
  mocks.listCheckpoints.mockResolvedValue({ data: { data: [checkpoint], nextCursor: null } });
  mocks.batchMessages.mockResolvedValue({ data: { messages, missingIds: [] } });
  mocks.searchMessages.mockResolvedValue({ data: [messageSummaries[0]] });
  mocks.restoreCheckpoint.mockResolvedValue({
    data: {
      conversation: { ...conversation, id: "conversation-restored", title: "Restored Formatting preferences" },
      checkpoint,
      revision: 2,
      idempotent: false,
    },
  });
  mocks.listMemories.mockResolvedValue({
    data: {
      items: [{ memory: savedMemory, estimatedTokens: 6, contentKind: "untrusted_memory_data", instructionAuthority: false }],
      total: 1,
      nextOffset: null,
      budget: { maxItems: 16, maxTokens: 2_048, usedItems: 1, usedTokens: 6, truncated: false },
    },
  });
  mocks.updateMemory.mockResolvedValue({
    data: {
      memory: { ...savedMemory, content: "Use short status summaries.", version: 3 },
      receipt: { version: 3, receiptId: "receipt-update" },
      idempotent: false,
    },
  });
  mocks.forgetMemory.mockResolvedValue({
    data: { memory: null, receipt: { version: 3, receiptId: "receipt-forget" }, idempotent: false },
  });
  mocks.operationStatus.mockResolvedValue({ data: { status: "unknown", operationId: "memory-pending" } });
}

function expectAccessibleDetailRegion() {
  const region = screen.getByRole("region", { name: "Context conversation detail" });
  expect(region.getAttribute("aria-labelledby")).toBe("context-detail-title");
  expect(region.querySelector("#context-detail-title")).toBeTruthy();
}

beforeEach(() => {
  mocks.runtimeProjectName = "context-project";
  mocks.runtimeWorkspaceId = "context-workspace";
  mocks.runtimeStatus = "ready";
  setDefaultResponses();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ContextWorkspace", () => {
  it("loads conversation index, explicitly retrieves message content, and uses the active project", async () => {
    render(<ContextWorkspace />);

    expect(await screen.findByRole("heading", { name: "Formatting preferences" })).toBeTruthy();
    expectAccessibleDetailRegion();
    expect(screen.getByText("Please use concise formatting.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Checkpoint history" })).toBeTruthy();
    expect(mocks.listConversations).toHaveBeenCalledWith("context-project", { limit: 30, cursor: undefined });
    expect(mocks.listSources).toHaveBeenCalledWith("context-project", { limit: 20, offset: 0 });
    expect(mocks.batchMessages).toHaveBeenCalledWith(
      "conversation-one",
      ["message-one", "message-two"],
      "context-project",
    );
  });

  it("searches a selected conversation then explicitly retrieves matching content", async () => {
    render(<ContextWorkspace />);
    await screen.findByRole("heading", { name: "Formatting preferences" });

    fireEvent.change(screen.getByLabelText("Search messages in this conversation"), {
      target: { value: "concise" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByRole("heading", { name: "Search results" })).toBeTruthy();
    expect(mocks.searchMessages).toHaveBeenCalledWith("conversation-one", "concise", "context-project", 50);
    expect(mocks.batchMessages).toHaveBeenLastCalledWith("conversation-one", ["message-one"], "context-project");
    expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy();
  });

  it("restores a checkpoint as a new conversation without altering the source", async () => {
    render(<ContextWorkspace />);
    await screen.findByRole("heading", { name: "Formatting preferences" });

    fireEvent.click(screen.getByRole("button", { name: "Restore as new conversation" }));

    await waitFor(() => expect(mocks.restoreCheckpoint).toHaveBeenCalledTimes(1));
    expect(mocks.restoreCheckpoint).toHaveBeenCalledWith(
      "conversation-one",
      "checkpoint-one",
      expect.objectContaining({
        expectedRevision: 2,
        title: "Restored Formatting preferences",
        metadata: { restoredBy: "dashboard" },
        idempotencyKey: expect.stringMatching(/^context-/),
      }),
      "context-project",
    );
    expect(mocks.replace).toHaveBeenCalledWith(
      "/context?project=context-project&conversation=conversation-restored",
      { scroll: false },
    );
  });

  it("loads, updates, and forgets private saved memory with explicit confirmation", async () => {
    render(<ContextWorkspace />);

    expect(await screen.findByText("Use concise status summaries.")).toBeTruthy();
    expect(mocks.listMemories).toHaveBeenCalledWith("context-project", "context-workspace");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Memory content"), { target: { value: "Use short status summaries." } });
    fireEvent.click(screen.getByRole("button", { name: "Update memory" }));

    await waitFor(() => expect(mocks.updateMemory).toHaveBeenCalledWith(
      "context-project",
      savedMemory.id,
      expect.objectContaining({
        workspaceId: "context-workspace",
        expectedVersion: 2,
        content: "Use short status summaries.",
        operationId: expect.stringMatching(/^memory-/),
      }),
    ));
    expect(await screen.findByText("Memory updated to version 3. Receipt receipt-update.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Forget memory" }));
    expect(mocks.forgetMemory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm forget" }));
    await waitFor(() => expect(mocks.forgetMemory).toHaveBeenCalledWith(
      "context-project",
      savedMemory.id,
      expect.objectContaining({ workspaceId: "context-workspace", expectedVersion: 3 }),
    ));
    expect(await screen.findByText("Memory forgotten and excluded from future retrieval. Receipt receipt-forget.")).toBeTruthy();
  });

  it("restores focus to the next memory action, then the Saved memory heading after committed forgets", async () => {
    const nextMemory = {
      ...savedMemory,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      content: "Keep release notes concise.",
    };
    mocks.listMemories.mockResolvedValueOnce({
      data: {
        items: [savedMemory, nextMemory].map((memory) => ({ memory, estimatedTokens: 6, contentKind: "untrusted_memory_data", instructionAuthority: false })),
        total: 2,
        nextOffset: null,
        budget: { maxItems: 16, maxTokens: 2_048, usedItems: 2, usedTokens: 12, truncated: false },
      },
    });
    render(<ContextWorkspace />);

    const forgetButtons = await screen.findAllByRole("button", { name: "Forget memory" });
    fireEvent.click(forgetButtons[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Confirm forget" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Forget memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm forget" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Saved memory" })).toHaveFocus());
  });

  it("shows workspace selection without hiding immutable context when no workspace is confirmed", async () => {
    mocks.runtimeProjectName = null;
    mocks.runtimeWorkspaceId = null;
    mocks.runtimeStatus = "selecting";

    render(<ContextWorkspace />);

    expect(await screen.findByRole("group", { name: "Choose a workspace for saved memory" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Formatting preferences" })).toBeTruthy();
    expect(screen.getByText("Select an authorized workspace to manage saved memory.")).toBeTruthy();
    expect(mocks.listMemories).not.toHaveBeenCalled();
  });

  it("disables memory when the confirmed workspace belongs to a foreign project", async () => {
    mocks.runtimeProjectName = "foreign-project";

    render(<ContextWorkspace />);

    expect(await screen.findByRole("heading", { name: "Formatting preferences" })).toBeTruthy();
    expect(screen.getByText("Select an authorized workspace to manage saved memory.")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Saved memory" })).getByRole("button", { name: "Refresh" })).toBeDisabled();
    expect(mocks.listMemories).not.toHaveBeenCalled();
  });

  it("reconciles a queued update and only replays the retained operation after an unknown status", async () => {
    mocks.updateMemory
      .mockResolvedValueOnce({ data: { status: "pending", operationId: "memory-pending", nextAction: "memory_operation_status" } })
      .mockResolvedValueOnce({ data: { memory: { ...savedMemory, content: "Queued correction", version: 3 }, receipt: { version: 3, receiptId: "receipt-replay" }, idempotent: true } });
    render(<ContextWorkspace />);
    expect(await screen.findByText("Use concise status summaries.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Memory content"), { target: { value: "Queued correction" } });
    fireEvent.click(screen.getByRole("button", { name: "Update memory" }));

    const firstInput = await waitFor(() => {
      expect(mocks.updateMemory).toHaveBeenCalledTimes(1);
      return mocks.updateMemory.mock.calls[0]![2];
    });
    fireEvent.click(await screen.findByRole("button", { name: "Check status" }));
    expect(await screen.findByText(/Update outcome is still unknown/)).toBeTruthy();
    expect(mocks.operationStatus).toHaveBeenCalledWith("context-project", "context-workspace", firstInput.operationId);

    fireEvent.click(screen.getByRole("button", { name: "Retry identical update" }));
    await waitFor(() => expect(mocks.updateMemory).toHaveBeenCalledTimes(2));
    expect(mocks.updateMemory.mock.calls[1]).toEqual(["context-project", savedMemory.id, firstInput]);
    expect(await screen.findByText("Memory updated to version 3. Receipt receipt-replay.")).toBeTruthy();
  });

  it("shows a safe refresh action when a memory version conflicts", async () => {
    mocks.updateMemory.mockRejectedValueOnce({ status: 409 });
    render(<ContextWorkspace />);

    expect(await screen.findByText("Use concise status summaries.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Memory content"), { target: { value: "Conflicting update" } });
    fireEvent.click(screen.getByRole("button", { name: "Update memory" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Memory changed before it could be updated. Refresh saved memory and try again.",
    );
  });

  it("renders an accessible empty index state", async () => {
    mocks.listConversations.mockResolvedValueOnce({ data: { data: [], nextCursor: null } });

    render(<ContextWorkspace />);

    expect((await screen.findByTestId("context-empty")).textContent).toContain("No conversations yet");
    expectAccessibleDetailRegion();
  });

  it("renders a retryable accessible index error state", async () => {
    mocks.listConversations.mockRejectedValueOnce(new Error("Context API is unavailable"));

    render(<ContextWorkspace />);

    expect((await screen.findByRole("alert")).textContent).toContain("Context API is unavailable");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expectAccessibleDetailRegion();
  });

  it("keeps the detail region labelled while conversation detail is loading", async () => {
    let resolveConversation: ((value: { data: typeof conversation }) => void) | undefined;
    mocks.getConversation.mockReturnValueOnce(new Promise((resolve) => {
      resolveConversation = resolve;
    }));

    render(<ContextWorkspace />);

    expect(await screen.findByText("Loading conversation detail…")).toBeTruthy();
    expectAccessibleDetailRegion();

    resolveConversation?.({ data: conversation });
  });

  it("keeps the detail region labelled when detail loading fails", async () => {
    mocks.getConversation.mockRejectedValueOnce(new Error("Detail API is unavailable"));

    render(<ContextWorkspace />);

    expect((await screen.findByRole("alert")).textContent).toContain("Detail API is unavailable");
    expectAccessibleDetailRegion();
  });
});
