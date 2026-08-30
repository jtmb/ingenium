import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams("project=context-project"),
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => "context-project",
}));

vi.mock("../src/lib/api", () => ({
  api: {
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
}

function expectAccessibleDetailRegion() {
  const region = screen.getByRole("region", { name: "Context conversation detail" });
  expect(region.getAttribute("aria-labelledby")).toBe("context-detail-title");
  expect(region.querySelector("#context-detail-title")).toBeTruthy();
}

beforeEach(() => {
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
