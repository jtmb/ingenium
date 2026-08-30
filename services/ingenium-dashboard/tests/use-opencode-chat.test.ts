/**
 * Tests for the use-opencode-chat hook reducer and send integration.
 *
 * Tests the internal chatReducer via __test export (only available when
 * NODE_ENV === "test") and the useOpenCodeChat hook via renderHook.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import React from "react";
import {
  __test,
  useOpenCodeChat,
  type ChatMessage,
  type ChatAction,
  type ChatState,
} from "../src/lib/use-opencode-chat";
import type { OpenCodePart } from "../src/lib/opencode";

const { mockPrompt, mockMessages, mockContextLink, mockPersistTurn } = vi.hoisted(() => ({
  mockPrompt: vi.fn(),
  mockMessages: vi.fn(),
  mockContextLink: vi.fn(),
  mockPersistTurn: vi.fn(),
}));

const mockOpenCodeClient = {
  sessions: {
    messages: mockMessages,
    prompt: mockPrompt,
    abort: vi.fn(),
    revert: vi.fn(),
  },
  permissions: {
    list: vi.fn().mockResolvedValue([]),
  },
  questions: {
    list: vi.fn().mockResolvedValue([]),
  },
  events: { url: (sessionId: string) => `/api/v1/opencode/sessions/${sessionId}/events?runtime_id=11111111-1111-4111-8111-111111111111` },
};

// Mock opencode so the hook never makes real HTTP calls.
// This must be at module level (vitest hoists it before imports).
vi.mock("../src/lib/RuntimeContext", () => ({
  useOpenCodeClient: () => mockOpenCodeClient,
}));

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      context: {
        ...actual.api.context,
        chat: { link: mockContextLink, persistTurn: mockPersistTurn },
      },
    },
  };
});

function getReducer(): (
  state: ChatState,
  action: ChatAction,
) => ChatState {
  if (!__test) {
    throw new Error(
      "__test export not available — NODE_ENV must be 'test'",
    );
  }
  return __test.chatReducer;
}

function createInitialState(overrides?: Partial<ChatState>): ChatState {
  return {
    messages: [],
    isStreaming: false,
    isLoading: false,
    error: null,
    sessionStatus: null,
    sessionInfo: undefined,
    questions: [],
    streamActivity: "idle",
    partTypes: {},
    userMessageAliases: {},
    ...overrides,
  };
}

function createMessage(
  overrides: Partial<ChatMessage> & {
    id: string;
    role: "user" | "assistant" | "system";
  },
): ChatMessage {
  return {
    content: "",
    parts: [],
    timestamp: 1000,
    ...overrides,
  };
}

function textPart(overrides: {
  id: string;
  sessionID?: string;
  messageID?: string;
  text: string;
}): OpenCodePart {
  return {
    id: overrides.id,
    sessionID: overrides.sessionID ?? "sess-1",
    messageID: overrides.messageID ?? "msg-1",
    type: "text",
    text: overrides.text,
  } as OpenCodePart;
}

function reasoningPart(overrides: {
  id: string;
  sessionID?: string;
  messageID?: string;
  text: string;
}): OpenCodePart {
  return {
    id: overrides.id,
    sessionID: overrides.sessionID ?? "sess-1",
    messageID: overrides.messageID ?? "msg-1",
    type: "reasoning",
    text: overrides.text,
  } as OpenCodePart;
}

function applyPartUpdated(
  reducer: ReturnType<typeof getReducer>,
  state: ChatState,
  messageID: string,
  part: OpenCodePart,
): ChatState {
  return reducer(state, { type: "UPSERT_PART", messageID, part });
}

describe("chatReducer", () => {
  let reducer: ReturnType<typeof getReducer>;

  beforeEach(() => {
    reducer = getReducer();
  });

  describe("LOAD_MESSAGES", () => {
    it("replaces existing messages with the loaded set", () => {
      const existing = createMessage({
        id: "old-1",
        role: "user",
        content: "old",
      });
      const fresh = [
        createMessage({ id: "new-1", role: "user", content: "new" }),
      ];
      const state = createInitialState({
        messages: [existing],
        isLoading: true,
        error: "previous error",
      });

      const next = reducer(state, {
        type: "LOAD_MESSAGES",
        messages: fresh,
      });

      expect(next.messages).toEqual(fresh);
      expect(next.isLoading).toBe(false);
      expect(next.error).toBeNull();
    });

    it("clears loading and error even when messages are empty", () => {
      const state = createInitialState({
        isLoading: true,
        error: "something broke",
      });

      const next = reducer(state, {
        type: "LOAD_MESSAGES",
        messages: [],
      });

      expect(next.messages).toEqual([]);
      expect(next.isLoading).toBe(false);
      expect(next.error).toBeNull();
    });
  });

  describe("ADD_USER_MESSAGE", () => {
    it("appends a user message and clears error", () => {
      const existing = createMessage({
        id: "msg-1",
        role: "assistant",
        content: "hi",
      });
      const userMsg = createMessage({
        id: "user-1",
        role: "user",
        content: "hello",
      });
      const state = createInitialState({
        messages: [existing],
        error: "something broke",
      });

      const next = reducer(state, {
        type: "ADD_USER_MESSAGE",
        message: userMsg,
      });

      expect(next.messages).toHaveLength(2);
      expect(next.messages[1]).toBe(userMsg);
      expect(next.error).toBeNull();
    });
  });

  describe("ACCUMULATE_DELTA", () => {
    it("ignores unmapped deltas rather than fabricating a reasoning part", () => {
      const state = createInitialState();

      const next = reducer(state, {
        type: "ACCUMULATE_DELTA",
        messageID: "new-msg",
        partID: "part-1",
        delta: "Hello",
        partType: "reasoning",
      });

      expect(next).toBe(state);
      expect(next.messages).toHaveLength(0);
    });

    it("appends text delta to an existing text part", () => {
      const msg = createMessage({
        id: "msg-1",
        role: "assistant",
        content: "Hel",
        parts: [textPart({ id: "part-1", text: "Hel" })],
        isStreaming: true,
      });
      let state = createInitialState({ messages: [msg] });
      state = applyPartUpdated(reducer, state, "msg-1", textPart({ id: "part-1", text: "Hel" }));

      const next = reducer(state, {
        type: "ACCUMULATE_DELTA",
        messageID: "msg-1",
        partID: "part-1",
        delta: "lo",
        partType: "text",
      });

      expect(next.messages[0]!.parts).toHaveLength(1);
      expect(next.messages[0]!.content).toBe("Hello");
      expect(next.messages[0]!.isStreaming).toBe(true);

      // Check that the delta was concatenated onto the existing text
      const part = next.messages[0]!.parts[0] as OpenCodePart & {
        text: string;
      };
      expect(part.text).toBe("Hello");
    });

    it("appends text after the authoritative part update creates the part", () => {
      const msg = createMessage({
        id: "msg-1",
        role: "assistant",
        parts: [],
        isStreaming: true,
      });
      let state = createInitialState({ messages: [msg] });
      state = applyPartUpdated(reducer, state, "msg-1", textPart({ id: "part-new", text: "" }));

      const next = reducer(state, {
        type: "ACCUMULATE_DELTA",
        messageID: "msg-1",
        partID: "part-new",
        delta: "First text",
        partType: "text",
      });

      expect(next.messages[0]!.parts).toHaveLength(1);
      expect(next.messages[0]!.content).toBe("First text");
    });

    it("creates reasoning-type parts when partType is 'reasoning'", () => {
      const msg = createMessage({
        id: "msg-1",
        role: "assistant",
        parts: [],
        isStreaming: true,
      });
      let state = createInitialState({ messages: [msg] });
      state = applyPartUpdated(reducer, state, "msg-1", reasoningPart({ id: "reason-part", text: "" }));

      const next = reducer(state, {
        type: "ACCUMULATE_DELTA",
        messageID: "msg-1",
        partID: "reason-part",
        delta: "thinking...",
        partType: "reasoning",
      });

      expect(next.messages[0]!.parts).toHaveLength(1);
      expect(next.messages[0]!.reasoning).toBe("thinking...");
      // content should be empty because content only joins text-type parts
      expect(next.messages[0]!.content).toBe("");
    });

    it("accumulates reasoning deltas on an existing reasoning part", () => {
      const msg = createMessage({
        id: "msg-1",
        role: "assistant",
        parts: [reasoningPart({ id: "reason-part", text: "think" })],
        isStreaming: true,
      });
      let state = createInitialState({ messages: [msg] });
      state = applyPartUpdated(reducer, state, "msg-1", reasoningPart({ id: "reason-part", text: "think" }));

      const next = reducer(state, {
        type: "ACCUMULATE_DELTA",
        messageID: "msg-1",
        partID: "reason-part",
        delta: "ing deeper",
        partType: "reasoning",
      });

      expect(next.messages[0]!.reasoning).toBe("thinking deeper");
    });

    it("leaves content unchanged when accumulating reasoning deltas", () => {
      const msg = createMessage({
        id: "msg-1",
        role: "assistant",
        content: "User-facing text",
        parts: [
          textPart({ id: "text-part", text: "User-facing text" }),
          reasoningPart({ id: "reason-part", text: "hidden thoughts" }),
        ],
        isStreaming: true,
      });
      let state = createInitialState({ messages: [msg] });
      state = applyPartUpdated(reducer, state, "msg-1", reasoningPart({ id: "reason-part", text: "hidden thoughts" }));

      const next = reducer(state, {
        type: "ACCUMULATE_DELTA",
        messageID: "msg-1",
        partID: "reason-part",
        delta: " extended",
        partType: "reasoning",
      });

      expect(next.messages[0]!.content).toBe("User-facing text");
      expect(next.messages[0]!.reasoning).toBe(
        "hidden thoughts extended",
      );
    });
  });

  describe("UPSERT_MESSAGE", () => {
    it("updates an existing message by id (merges metadata, preserves parts)", () => {
      const original = createMessage({
        id: "msg-1",
        role: "assistant",
        content: "existing text",
        parts: [textPart({ id: "p1", text: "existing text" })],
        isStreaming: true,
      });
      const update = createMessage({
        id: "msg-1",
        role: "assistant",
        content: "",
        parts: [],
        isStreaming: false,
        model: { providerID: "openai", modelID: "gpt-4" },
      });
      const state = createInitialState({ messages: [original] });

      const next = reducer(state, {
        type: "UPSERT_MESSAGE",
        message: update,
      });

      expect(next.messages).toHaveLength(1);
      // Content and parts preserved from original
      expect(next.messages[0]!.content).toBe("existing text");
      expect(next.messages[0]!.parts.length).toBe(1);
      // Metadata merged from update
      expect(next.messages[0]!.isStreaming).toBe(true);
      expect(next.messages[0]!.model).toEqual({
        providerID: "openai",
        modelID: "gpt-4",
      });
    });

    it("appends a new message if id does not match any existing", () => {
      const existing = createMessage({
        id: "msg-1",
        role: "user",
        content: "hello",
      });
      const newMsg = createMessage({
        id: "msg-2",
        role: "assistant",
        content: "response",
      });
      const state = createInitialState({ messages: [existing] });

      const next = reducer(state, {
        type: "UPSERT_MESSAGE",
        message: newMsg,
      });

      expect(next.messages).toHaveLength(2);
      expect(next.messages[1]!.id).toBe("msg-2");
    });
  });

  it("keeps incremental reasoning open through reconciliation until terminal finalization", () => {
    let state = createInitialState({ isStreaming: true });

    state = applyPartUpdated(
      reducer,
      state,
      "assistant-1",
      reasoningPart({
        id: "reasoning-1",
        messageID: "assistant-1",
        text: "",
      }),
    );

    state = reducer(state, {
      type: "ACCUMULATE_DELTA",
      messageID: "assistant-1",
      partID: "reasoning-1",
      partType: "reasoning",
      delta: "Provider-emitted thinking",
    });
    expect(state.messages[0]!.reasoning).toBe("Provider-emitted thinking");
    expect(state.messages[0]!.isStreaming).toBe(true);

    // The prompt reconciliation can already report a completed snapshot.
    state = reducer(state, {
      type: "RECONCILE_MESSAGES",
      messages: [
        createMessage({
          id: "assistant-1",
          role: "assistant",
          content: "final snapshot",
          isStreaming: false,
        }),
      ],
    });
    expect(state.messages[0]!.reasoning).toBe("Provider-emitted thinking");
    expect(state.messages[0]!.isStreaming).toBe(true);

    // A completed message.updated record still is not the terminal SSE event.
    state = reducer(state, {
      type: "UPSERT_MESSAGE",
      message: createMessage({
        id: "assistant-1",
        role: "assistant",
        isStreaming: false,
      }),
    });
    expect(state.messages[0]!.isStreaming).toBe(true);

    state = reducer(state, { type: "FINALIZE_STREAMING" });
    expect(state.messages[0]!.isStreaming).toBe(false);
    expect(state.isStreaming).toBe(false);
  });

  describe("RECONCILE_MESSAGES", () => {
    it("preserves optimistic user messages not in the server response", () => {
      const optimistic = createMessage({
        id: "user-opt",
        role: "user",
        content: "optimistic",
      });
      const serverReply = createMessage({
        id: "assist-1",
        role: "assistant",
        content: "reply",
        isStreaming: false,
      });
      const state = createInitialState({ messages: [optimistic] });

      const next = reducer(state, {
        type: "RECONCILE_MESSAGES",
        messages: [serverReply],
      });

      expect(next.messages).toHaveLength(2);
      expect(next.messages[0]!.id).toBe("user-opt");
      expect(next.messages[1]!.id).toBe("assist-1");
    });

    it("rekeys only the correlated optimistic user when identical prompt text repeats", () => {
      const first = createMessage({ id: "optimistic-1", role: "user", content: "same prompt" });
      const second = createMessage({ id: "optimistic-2", role: "user", content: "same prompt" });

      const next = reducer(createInitialState({ messages: [first, second] }), {
        type: "CORRELATE_USER_MESSAGE",
        optimisticId: "optimistic-1",
        authoritativeId: "server-user-1",
      });

      expect(next.messages.map(({ id }) => id)).toEqual(["server-user-1", "optimistic-2"]);
    });

    it("keeps a proven ID alias for delayed user events and snapshots", () => {
      const optimistic = createMessage({ id: "optimistic", role: "user", content: "Question" });
      let state = reducer(createInitialState({ messages: [optimistic] }), {
        type: "CORRELATE_USER_MESSAGE",
        optimisticId: "optimistic",
        authoritativeId: "server-user",
      });

      state = reducer(state, {
        type: "UPSERT_MESSAGE",
        message: createMessage({ id: "optimistic", role: "user", content: "Question" }),
      });
      state = reducer(state, {
        type: "RECONCILE_MESSAGES",
        messages: [
          createMessage({ id: "optimistic", role: "user", content: "Question" }),
          createMessage({ id: "server-user", role: "user", content: "Question" }),
          createMessage({ id: "assistant", role: "assistant", content: "Answer" }),
        ],
      });

      expect(state.messages.map(({ id }) => id)).toEqual(["server-user", "assistant"]);
      expect(state.userMessageAliases).toEqual({ optimistic: "server-user" });
    });

    it("preserves locally streaming assistant messages during reconciliation", () => {
      // When SSE is still delivering deltas, the local assistant message
      // has isStreaming:true.  RECONCILE_MESSAGES must keep that flag so
      // the UI continues to show the live streaming experience instead of
      // snapping to the completed snapshot from a stale fetch.
      const streaming = createMessage({
        id: "msg-1",
        role: "assistant",
        content: "streaming...",
        isStreaming: true,
      });
      const refreshed = createMessage({
        id: "msg-1",
        role: "assistant",
        content: "streaming...",
        isStreaming: false,
      });
      const state = createInitialState({ messages: [streaming] });

      const next = reducer(state, {
        type: "RECONCILE_MESSAGES",
        messages: [refreshed],
      });

      expect(next.messages[0]!.isStreaming).toBe(true);
    });

    it("adds server messages that are not yet in local state", () => {
      const local = createMessage({
        id: "user-1",
        role: "user",
        content: "hello",
      });
      const server = createMessage({
        id: "assist-1",
        role: "assistant",
        content: "world",
        isStreaming: false,
      });
      const state = createInitialState({ messages: [local] });

      const next = reducer(state, {
        type: "RECONCILE_MESSAGES",
        messages: [server],
      });

      expect(next.messages).toHaveLength(2);
      expect(next.messages[1]!.id).toBe("assist-1");
    });

    it("clears loading state after reconciliation", () => {
      const state = createInitialState({ isLoading: true });

      const next = reducer(state, {
        type: "RECONCILE_MESSAGES",
        messages: [],
      });

      expect(next.isLoading).toBe(false);
    });
  });

  describe("SET_STREAMING", () => {
    it("toggles streaming to true", () => {
      const state = createInitialState({ isStreaming: false });

      const next = reducer(state, { type: "SET_STREAMING", value: true });

      expect(next.isStreaming).toBe(true);
    });

    it("toggles streaming to false", () => {
      const state = createInitialState({ isStreaming: true });

      const next = reducer(state, {
        type: "SET_STREAMING",
        value: false,
      });

      expect(next.isStreaming).toBe(false);
    });
  });

  describe("SET_ERROR", () => {
    it("sets error and clears streaming and loading", () => {
      const state = createInitialState({
        isStreaming: true,
        isLoading: true,
      });

      const next = reducer(state, {
        type: "SET_ERROR",
        error: "something went wrong",
      });

      expect(next.error).toBe("something went wrong");
      expect(next.isStreaming).toBe(false);
      expect(next.isLoading).toBe(false);
    });

    it("clears a previous error when set to null", () => {
      const state = createInitialState({ error: "old error" });

      const next = reducer(state, { type: "SET_ERROR", error: null });

      expect(next.error).toBeNull();
    });
  });

  describe("REMOVE_LAST_USER", () => {
    it("removes the last user message from the array", () => {
      const assistant = createMessage({
        id: "a1",
        role: "assistant",
        content: "previous",
      });
      const user1 = createMessage({ id: "u1", role: "user", content: "q1" });
      const user2 = createMessage({ id: "u2", role: "user", content: "q2" });
      const state = createInitialState({
        messages: [assistant, user1, user2],
      });

      const next = reducer(state, { type: "REMOVE_LAST_USER" });

      expect(next.messages).toHaveLength(2);
      expect(next.messages[1]!.id).toBe("u1");
    });

    it("does nothing when there are no user messages", () => {
      const state = createInitialState({
        messages: [
          createMessage({ id: "a1", role: "assistant", content: "hi" }),
        ],
      });

      const next = reducer(state, { type: "REMOVE_LAST_USER" });

      expect(next.messages).toHaveLength(1);
    });

    it("does nothing when messages array is empty", () => {
      const state = createInitialState();

      const next = reducer(state, { type: "REMOVE_LAST_USER" });

      expect(next.messages).toEqual([]);
    });
  });

  describe("REMOVE_QUESTIONS", () => {
    it("clears all questions", () => {
      const state = createInitialState({
        questions: [
          { id: "q1", question: "Continue?" },
          { id: "q2", question: "Allow tool?" },
        ],
      });

      const next = reducer(state, { type: "REMOVE_QUESTIONS" });

      expect(next.questions).toEqual([]);
    });

    it("is a no-op when questions is already empty", () => {
      const state = createInitialState();

      const next = reducer(state, { type: "REMOVE_QUESTIONS" });

      expect(next.questions).toEqual([]);
    });
  });

  describe("UPSERT_PART", () => {
    it("adds a new part to an existing message", () => {
      const msg = createMessage({
        id: "msg-1",
        role: "assistant",
        parts: [textPart({ id: "p1", text: "hello" })],
      });
      const state = createInitialState({ messages: [msg] });

      const next = reducer(state, {
        type: "UPSERT_PART",
        messageID: "msg-1",
        part: textPart({ id: "p2", text: " world" }),
      });

      expect(next.messages[0]!.parts).toHaveLength(2);
    });

    it("updates an existing part in place by id", () => {
      const msg = createMessage({
        id: "msg-1",
        role: "assistant",
        parts: [textPart({ id: "p1", text: "hello" })],
      });
      const state = createInitialState({ messages: [msg] });

      const next = reducer(state, {
        type: "UPSERT_PART",
        messageID: "msg-1",
        part: textPart({ id: "p1", text: "bonjour" }),
      });

      expect(next.messages[0]!.parts).toHaveLength(1);
      const part = next.messages[0]!.parts[0] as OpenCodePart & {
        text: string;
      };
      expect(part.text).toBe("bonjour");
    });

    it("creates a placeholder message when messageID does not exist", () => {
      const state = createInitialState();

      const next = reducer(state, {
        type: "UPSERT_PART",
        messageID: "new-msg",
        part: textPart({ id: "p1", text: "content" }),
      });

      expect(next.messages).toHaveLength(1);
      expect(next.messages[0]!.id).toBe("new-msg");
      expect(next.messages[0]!.role).toBe("assistant");
      expect(next.messages[0]!.isStreaming).toBe(true);
    });

    it("keeps the provider's current tool state without inventing historical phases", () => {
      const state = createInitialState({
        messages: [
          createMessage({
            id: "assistant-1",
            role: "assistant",
            parts: [
              {
                id: "web-search-1",
                sessionID: "sess-1",
                messageID: "assistant-1",
                type: "tool",
                tool: "websearch",
                state: { status: "pending", input: { query: "streaming" } },
              },
            ] as OpenCodePart[],
          }),
        ],
      });

      const next = reducer(state, {
        type: "UPSERT_PART",
        messageID: "assistant-1",
        part: {
          id: "web-search-1",
          sessionID: "sess-1",
          messageID: "assistant-1",
          type: "tool",
          tool: "websearch",
          state: { status: "running", input: { query: "streaming" } },
        } as OpenCodePart,
      });

      expect(next.messages[0]!.parts).toHaveLength(1);
      expect((next.messages[0]!.parts[0] as OpenCodePart & { state?: { status: string } }).state?.status).toBe("running");
    });
  });

  describe("CLEAR", () => {
    it("resets all state to initial values", () => {
      const state = createInitialState({
        messages: [
          createMessage({ id: "m1", role: "user", content: "hello" }),
        ],
        isStreaming: true,
        isLoading: true,
        error: "error",
        sessionStatus: "busy",
        sessionInfo: { cost: 5 },
        questions: [{ id: "q1", question: "Continue?" }],
      });

      const next = reducer(state, { type: "CLEAR" });

      expect(next).toEqual({
        messages: [],
        isStreaming: false,
        isLoading: false,
        error: null,
        sessionStatus: null,
        sessionInfo: undefined,
        questions: [],
        streamActivity: "idle",
        partTypes: {},
        activeAssistantMessageId: undefined,
        userMessageAliases: {},
      });
    });
  });

  describe("SET_LOADING", () => {
    it("sets loading to true", () => {
      const state = createInitialState({ isLoading: false });

      const next = reducer(state, { type: "SET_LOADING", value: true });

      expect(next.isLoading).toBe(true);
    });

    it("sets loading to false", () => {
      const state = createInitialState({ isLoading: true });

      const next = reducer(state, { type: "SET_LOADING", value: false });

      expect(next.isLoading).toBe(false);
    });
  });

  describe("SET_STATUS", () => {
    it("sets status to idle", () => {
      const state = createInitialState({ sessionStatus: "busy" });

      const next = reducer(state, {
        type: "SET_STATUS",
        status: "idle",
      });

      expect(next.sessionStatus).toBe("idle");
    });

    it("sets status to busy", () => {
      const state = createInitialState({ sessionStatus: "idle" });

      const next = reducer(state, {
        type: "SET_STATUS",
        status: "busy",
      });

      expect(next.sessionStatus).toBe("busy");
    });

    it("sets status to null", () => {
      const state = createInitialState({ sessionStatus: "idle" });

      const next = reducer(state, { type: "SET_STATUS", status: null });

      expect(next.sessionStatus).toBeNull();
    });
  });

  describe("UPDATE_SESSION_INFO", () => {
    it("merges partial session info into existing info", () => {
      const state = createInitialState({
        sessionInfo: { cost: 10, tokens: { total: 100 } },
      });

      const next = reducer(state, {
        type: "UPDATE_SESSION_INFO",
        info: { shareUrl: "https://example.com/share/abc" },
      });

      expect(next.sessionInfo).toEqual({
        cost: 10,
        tokens: { total: 100 },
        shareUrl: "https://example.com/share/abc",
      });
    });

    it("creates sessionInfo when it was undefined", () => {
      const state = createInitialState();

      const next = reducer(state, {
        type: "UPDATE_SESSION_INFO",
        info: { cost: 5 },
      });

      expect(next.sessionInfo).toEqual({ cost: 5 });
    });
  });

  describe("ADD_QUESTION", () => {
    it("adds a question not already present", () => {
      const state = createInitialState();

      const next = reducer(state, {
        type: "ADD_QUESTION",
        question: { id: "q1", question: "Continue?" },
      });

      expect(next.questions).toHaveLength(1);
      expect(next.questions[0]!.id).toBe("q1");
    });

    it("replaces an existing question with the same id", () => {
      const state = createInitialState({
        questions: [{ id: "q1", question: "Old question?" }],
      });

      const next = reducer(state, {
        type: "ADD_QUESTION",
        question: { id: "q1", question: "New question?" },
      });

      expect(next.questions).toHaveLength(1);
      expect(next.questions[0]!.question).toBe("New question?");
    });
  });

  describe("ADD_QUESTIONS", () => {
    it("merges unique questions without duplicates", () => {
      const state = createInitialState({
        questions: [{ id: "q1", question: "Existing?" }],
      });

      const next = reducer(state, {
        type: "ADD_QUESTIONS",
        questions: [
          { id: "q2", question: "New?" },
          { id: "q3", question: "Another?" },
        ],
      });

      expect(next.questions).toHaveLength(3);
    });

    it("skips questions with ids already in the list", () => {
      const state = createInitialState({
        questions: [{ id: "q1", question: "Existing?" }],
      });

      const next = reducer(state, {
        type: "ADD_QUESTIONS",
        questions: [
          { id: "q1", question: "Existing?" },
          { id: "q2", question: "New?" },
        ],
      });

      expect(next.questions).toHaveLength(2);
    });
  });

  describe("unknown action type", () => {
    it("returns the current state unchanged", () => {
      const state = createInitialState({ isStreaming: true });

      // Cast to any to simulate an unknown action type
      const next = reducer(state, {
        type: "UNKNOWN_ACTION" as unknown as ChatAction["type"],
      } as ChatAction);

      expect(next).toEqual(state);
    });
  });
});

describe("useOpenCodeChat hook — send() integration", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset call counts and implementations for each test.
    // These mocks are defined at module scope via vi.hoisted, so they
    // persist across tests unless explicitly reset.
    mockMessages.mockReset();
    mockMessages.mockResolvedValue([]);
    mockPrompt.mockReset();
    mockContextLink.mockReset();
    mockPersistTurn.mockReset();

    // Spy on fetch so SSE connections fail silently (AbortError)
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new DOMException("Aborted", "AbortError"),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    cleanup();
  });

  it("preserves the user message in state when prompt fails", async () => {
    mockPrompt.mockRejectedValue(new Error("API failure"));

    const { result } = renderHook(() => useOpenCodeChat("session-1"));

    // Wait for initial message load to complete
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.send([{ type: "text", text: "Hello" }]);
    });

    // The user message must still be present despite the error
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]!.role).toBe("user");
    expect(result.current.messages[0]!.content).toBe("Hello");

    // Error state must be set
    expect(result.current.error).toBe("API failure");

    // Streaming must be false after error
    expect(result.current.isStreaming).toBe(false);
  });

  it("correlates an optimistic user to the server parent ID without duplicating the completed turn", async () => {
    const completed = [
      { info: { id: "server-user", sessionID: "session-1", role: "user", time: { created: 1 } }, parts: [{ id: "user-part", sessionID: "session-1", messageID: "server-user", type: "text", text: "Question" }] },
      { info: { id: "server-assistant", sessionID: "session-1", role: "assistant", parentID: "server-user", time: { created: 2, completed: 3 }, finish: "stop" }, parts: [{ id: "assistant-part", sessionID: "session-1", messageID: "server-assistant", type: "text", text: "Answer" }] },
    ];
    mockMessages.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue(completed);
    mockPrompt.mockResolvedValue({ accepted: true });
    mockContextLink.mockResolvedValue({ data: { id: "11111111-1111-4111-8111-111111111112", revision: 0 } });
    mockPersistTurn.mockResolvedValue({ data: { revision: 1 } });
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    fetchSpy.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start: (controller) => { streamController = controller; },
    })));
    const { result } = renderHook(() => useOpenCodeChat("session-1", {
      project: "selected-project",
      runtimeId: "11111111-1111-4111-8111-111111111111",
      title: "Conversation",
    }));
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => { await result.current.send([{ type: "text", text: "Question" }]); });

    expect(mockPrompt.mock.calls[0]?.[1].messageID).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    await act(async () => {
      streamController.enqueue(encoder.encode([
        { type: "message.updated", properties: { info: completed[0]!.info } },
        { type: "message.part.updated", properties: { part: completed[0]!.parts[0] } },
        { type: "message.updated", properties: { info: completed[1]!.info } },
        { type: "message.part.updated", properties: { part: completed[1]!.parts[0] } },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")));
    });
    await vi.waitFor(() => expect(result.current.messages.map(({ id, role }) => ({ id, role }))).toEqual([
        { id: "server-user", role: "user" },
        { id: "server-assistant", role: "assistant" },
      ]));
    await act(async () => {
      streamController.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "session.idle", properties: { sessionID: "session-1" } })}\n\n`));
    });
    await vi.waitFor(() => expect(mockPersistTurn).toHaveBeenCalledTimes(1));
    expect(mockPersistTurn.mock.calls[0]?.[1]).toMatchObject({
      userMessageId: "server-user",
      assistantMessageId: "server-assistant",
    });
  });

  it.each([
    "response-first",
    "user-event-first",
    "assistant-event-first",
    "duplicate-events",
    "prompt-error-first",
    "idle-before-assistant",
  ])("reconciles one authoritative turn and checkpoint when ordering is %s", async (ordering) => {
    const completed = [
      { info: { id: "server-user", sessionID: "session-1", role: "user", time: { created: 1 } }, parts: [{ id: "user-part", sessionID: "session-1", messageID: "server-user", type: "text", text: "Question" }] },
      { info: { id: "server-assistant", sessionID: "session-1", role: "assistant", parentID: "server-user", time: { created: 2, completed: 3 }, finish: "stop" }, parts: [{ id: "assistant-part", sessionID: "session-1", messageID: "server-assistant", type: "text", text: "Answer" }] },
    ];
    let historyReady = ordering === "response-first";
    mockMessages.mockResolvedValueOnce([]).mockImplementation(async () => historyReady ? completed : []);
    if (ordering === "prompt-error-first") mockPrompt.mockRejectedValue(new Error("Prompt acknowledgement lost"));
    else mockPrompt.mockResolvedValue({ accepted: true });
    mockContextLink.mockResolvedValue({ data: { id: "11111111-1111-4111-8111-111111111112", revision: 0 } });
    mockPersistTurn.mockResolvedValue({ data: { revision: 1 } });
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    fetchSpy.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start: (controller) => { streamController = controller; },
    })));
    const persistence = {
      project: "selected-project",
      runtimeId: "11111111-1111-4111-8111-111111111111",
      title: "Conversation",
    };
    const { result } = renderHook(() => useOpenCodeChat("session-1", persistence));
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => { await result.current.send([{ type: "text", text: "Question" }]); });

    const userEvents = [
      { type: "message.updated", properties: { info: completed[0]!.info } },
      { type: "message.part.updated", properties: { part: completed[0]!.parts[0] } },
    ];
    const assistantEvents = [
      { type: "message.updated", properties: { info: completed[1]!.info } },
      { type: "message.part.updated", properties: { part: completed[1]!.parts[0] } },
    ];
    const emit = async (events: unknown[]) => {
      await act(async () => {
        streamController.enqueue(encoder.encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")));
      });
    };
    const idle = { type: "session.idle", properties: { sessionID: "session-1" } };

    if (ordering === "user-event-first" || ordering === "prompt-error-first") {
      await emit([...userEvents, ...assistantEvents]);
    } else if (ordering === "assistant-event-first") {
      await emit([...assistantEvents, ...userEvents]);
    } else if (ordering === "duplicate-events") {
      await emit([...assistantEvents, ...assistantEvents, ...userEvents, ...userEvents]);
    } else if (ordering === "idle-before-assistant") {
      historyReady = true;
      await emit([idle]);
      await emit([...assistantEvents, ...userEvents]);
    }
    if (ordering !== "idle-before-assistant") {
      historyReady = true;
      await emit([idle]);
    }

    await vi.waitFor(() => expect(result.current.messages.map(({ id, role }) => ({ id, role }))).toEqual([
      { id: "server-user", role: "user" },
      { id: "server-assistant", role: "assistant" },
    ]));
    await vi.waitFor(() => expect(mockPersistTurn).toHaveBeenCalledTimes(1));
    expect(mockPersistTurn.mock.calls[0]?.[1]).toMatchObject({
      userMessageId: "server-user",
      assistantMessageId: "server-assistant",
      userContent: "Question",
      assistantContent: "Answer",
    });
  });

  it("keeps repeated identical prompts as distinct request-correlated turns", async () => {
    let turn = 0;
    let history: unknown[] = [];
    mockMessages.mockImplementation(async () => history);
    mockPrompt.mockImplementation(async (_sessionId, body) => {
      turn += 1;
      const userId = body.messageID as string;
      history = [
        ...history,
        { info: { id: userId, sessionID: "session-1", role: "user", time: { created: turn * 2 - 1 } }, parts: [{ type: "text", text: "Repeat" }] },
        { info: { id: `server-assistant-${turn}`, sessionID: "session-1", role: "assistant", parentID: userId, time: { created: turn * 2, completed: turn * 2 }, finish: "stop" }, parts: [{ type: "text", text: `Answer ${turn}` }] },
      ];
      return { accepted: true };
    });
    const { result } = renderHook(() => useOpenCodeChat("session-1"));
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => { await result.current.send([{ type: "text", text: "Repeat" }]); });
    await act(async () => { await result.current.send([{ type: "text", text: "Repeat" }]); });

    expect(mockPrompt.mock.calls[0]?.[1].messageID).not.toBe(mockPrompt.mock.calls[1]?.[1].messageID);
    expect(result.current.messages.filter(({ role }) => role === "user").map(({ id }) => id))
      .toEqual(mockPrompt.mock.calls.map(([, body]) => body.messageID));
    expect(result.current.messages.filter(({ role }) => role === "assistant").map(({ id }) => id))
      .toEqual(["server-assistant-1", "server-assistant-2"]);
  });

  it("persists one checkpoint when a completed assistant turn reaches session idle", async () => {
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start: (controller) => { streamController = controller; } });
    fetchSpy.mockResolvedValue(new Response(stream));
    const completed = [
      { info: { id: "user-source", sessionID: "session-1", role: "user", time: { created: 1 } }, parts: [{ id: "user-part", sessionID: "session-1", messageID: "user-source", type: "text", text: "Question" }] },
      { info: { id: "assistant-source", sessionID: "session-1", role: "assistant", time: { created: 2, completed: 3 }, finish: "stop" }, parts: [{ id: "assistant-part", sessionID: "session-1", messageID: "assistant-source", type: "text", text: "Answer" }] },
    ];
    mockMessages.mockResolvedValueOnce([]).mockResolvedValue(completed);
    mockPrompt.mockResolvedValue({ info: {}, parts: [] });
    mockContextLink.mockResolvedValue({ data: { id: "11111111-1111-4111-8111-111111111112", revision: 0 } });
    mockPersistTurn.mockResolvedValue({ data: { revision: 2 } });
    const persistence = { project: "selected-project", runtimeId: "11111111-1111-4111-8111-111111111111", title: "Conversation" };
    const { result } = renderHook(() => useOpenCodeChat("session-1", persistence));
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => { await result.current.send([{ type: "text", text: "Question" }]); });

    await act(async () => {
      streamController.enqueue(encoder.encode(`id: idle-one\ndata: ${JSON.stringify({ type: "session.idle", properties: { sessionID: "session-1" } })}\n\n`));
    });
    await vi.waitFor(() => expect(mockPersistTurn).toHaveBeenCalledTimes(1));
    expect(mockPersistTurn).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111112",
      expect.objectContaining({
        runtimeId: persistence.runtimeId,
        sessionId: "session-1",
        userMessageId: "user-source",
        assistantMessageId: "assistant-source",
        userContent: "Question",
        assistantContent: "Answer",
        expectedRevision: 0,
      }),
      "selected-project",
    );

    await act(async () => {
      streamController.enqueue(encoder.encode(`id: idle-two\ndata: ${JSON.stringify({ type: "session.idle", properties: { sessionID: "session-1" } })}\n\n`));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(mockMessages).toHaveBeenCalledTimes(4));
    expect(mockPersistTurn).toHaveBeenCalledTimes(1);
  });

  it("queues distinct completed turns while an earlier checkpoint is pending", async () => {
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start: (controller) => { streamController = controller; } });
    fetchSpy.mockResolvedValue(new Response(stream));
    const turnA = [
      { info: { id: "user-a", sessionID: "session-1", role: "user", time: { created: 1 } }, parts: [{ type: "text", text: "Question A" }] },
      { info: { id: "assistant-a", sessionID: "session-1", role: "assistant", time: { created: 2, completed: 3 }, finish: "stop" }, parts: [{ type: "text", text: "Answer A" }] },
    ];
    const turnB = [
      ...turnA,
      { info: { id: "user-b", sessionID: "session-1", role: "user", time: { created: 4 } }, parts: [{ type: "text", text: "Question B" }] },
      { info: { id: "assistant-b", sessionID: "session-1", role: "assistant", time: { created: 5, completed: 6 }, finish: "stop" }, parts: [{ type: "text", text: "Answer B" }] },
    ];
    let history = turnA;
    mockMessages.mockResolvedValueOnce([]).mockImplementation(async () => history);
    mockPrompt.mockResolvedValue({ info: {}, parts: [] });
    mockContextLink.mockResolvedValue({ data: { id: "11111111-1111-4111-8111-111111111112", revision: 0 } });
    let resolveTurnA!: (value: { data: { revision: number } }) => void;
    mockPersistTurn
      .mockImplementationOnce(() => new Promise((resolve) => { resolveTurnA = resolve; }))
      .mockResolvedValueOnce({ data: { revision: 2 } });
    const persistence = { project: "selected-project", runtimeId: "11111111-1111-4111-8111-111111111111", title: "Conversation" };
    const { result } = renderHook(() => useOpenCodeChat("session-1", persistence));
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => { await result.current.send([{ type: "text", text: "Question A" }]); });

    await act(async () => {
      streamController.enqueue(encoder.encode(`id: idle-a\ndata: ${JSON.stringify({ type: "session.idle", properties: { sessionID: "session-1" } })}\n\n`));
    });
    await vi.waitFor(() => expect(mockPersistTurn).toHaveBeenCalled());
    expect(mockPersistTurn.mock.calls.map(([, turn]) => turn.assistantMessageId)).toEqual(["assistant-a"]);

    history = turnB;
    await act(async () => {
      streamController.enqueue(encoder.encode(`id: idle-b\ndata: ${JSON.stringify({ type: "session.idle", properties: { sessionID: "session-1" } })}\n\n`));
    });
    await vi.waitFor(() => expect(mockMessages).toHaveBeenCalledTimes(4));
    expect(mockPersistTurn).toHaveBeenCalledTimes(1);

    await act(async () => { resolveTurnA({ data: { revision: 1 } }); });
    await vi.waitFor(() => expect(mockPersistTurn).toHaveBeenCalledTimes(2));
    expect(mockPersistTurn.mock.calls.map(([, turn]) => turn.assistantMessageId)).toEqual(["assistant-a", "assistant-b"]);
    expect(mockPersistTurn.mock.calls[1]?.[1]).toMatchObject({
      userMessageId: "user-b",
      assistantMessageId: "assistant-b",
      expectedRevision: 1,
    });
  });

  it("does not checkpoint assistant text from a failed finish state", async () => {
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start: (controller) => { streamController = controller; } });
    fetchSpy.mockResolvedValue(new Response(stream));
    mockMessages.mockResolvedValueOnce([]).mockResolvedValue([
      { info: { id: "user-source", sessionID: "session-1", role: "user", time: { created: 1 } }, parts: [{ type: "text", text: "Question" }] },
      { info: { id: "assistant-source", sessionID: "session-1", role: "assistant", time: { created: 2, completed: 3 }, finish: "error" }, parts: [{ type: "text", text: "Failed answer" }] },
    ]);
    mockPrompt.mockResolvedValue({ info: {}, parts: [] });
    mockContextLink.mockResolvedValue({ data: { id: "11111111-1111-4111-8111-111111111112", revision: 0 } });
    const { result } = renderHook(() => useOpenCodeChat("session-1", {
      project: "selected-project",
      runtimeId: "11111111-1111-4111-8111-111111111111",
      title: "Conversation",
    }));
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => { await result.current.send([{ type: "text", text: "Question" }]); });
    await act(async () => {
      streamController.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "session.idle", properties: { sessionID: "session-1" } })}\n\n`));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(mockMessages).toHaveBeenCalledTimes(3));
    expect(mockPersistTurn).not.toHaveBeenCalled();
  });

  it("does not checkpoint an incomplete assistant response", async () => {
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start: (controller) => { streamController = controller; } });
    fetchSpy.mockResolvedValue(new Response(stream));
    mockMessages.mockResolvedValueOnce([]).mockResolvedValue([
      { info: { id: "user-source", sessionID: "session-1", role: "user", time: { created: 1 } }, parts: [{ type: "text", text: "Question" }] },
      { info: { id: "assistant-source", sessionID: "session-1", role: "assistant", time: { created: 2 } }, parts: [{ type: "text", text: "Partial" }] },
    ]);
    mockPrompt.mockResolvedValue({ info: {}, parts: [] });
    mockContextLink.mockResolvedValue({ data: { id: "11111111-1111-4111-8111-111111111112", revision: 0 } });
    const { result } = renderHook(() => useOpenCodeChat("session-1", {
      project: "selected-project",
      runtimeId: "11111111-1111-4111-8111-111111111111",
      title: "Conversation",
    }));
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => { await result.current.send([{ type: "text", text: "Question" }]); });
    await act(async () => {
      streamController.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "session.idle", properties: { sessionID: "session-1" } })}\n\n`));
      await Promise.resolve();
    });
    expect(mockPersistTurn).not.toHaveBeenCalled();
  });

  it("keeps the SSE turn active when send reconciliation fails", async () => {
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    let streamSignal!: AbortSignal;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    fetchSpy.mockImplementation((_input, init) => {
      streamSignal = (init as RequestInit).signal as AbortSignal;
      return Promise.resolve(new Response(stream));
    });
    mockMessages
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("History temporarily unavailable"));
    mockPrompt.mockResolvedValue({ info: {}, parts: [] });

    const { result } = renderHook(() => useOpenCodeChat("session-1"));
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    let sent = false;
    await act(async () => {
      sent = await result.current.send([{ type: "text", text: "Continue" }]);
    });

    expect(sent).toBe(true);
    expect(result.current.isStreaming).toBe(true);
    expect(streamSignal.aborted).toBe(false);
    expect(result.current.error).toBe(
      "History temporarily unavailable. Live updates continue.",
    );

    await act(async () => {
      streamController.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            id: "part-before-delta-after-reconciliation-error",
            type: "message.part.updated",
            properties: {
              part: {
                id: "text-1",
                sessionID: "session-1",
                messageID: "assistant-1",
                type: "text",
              },
            },
          })}\n\n` +
            `data: ${JSON.stringify({
              id: "delta-after-reconciliation-error",
              type: "message.part.delta",
              properties: {
                sessionID: "session-1",
                messageID: "assistant-1",
                partID: "text-1",
                field: "text",
                delta: "SSE still delivers.",
              },
            })}\n\n`,
        ),
      );
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(result.current.messages.at(-1)?.content).toBe(
        "SSE still delivers.",
      );
    });
    expect(result.current.isStreaming).toBe(true);
    expect(streamSignal.aborted).toBe(false);
  });

  it("maps a live field:text delta to reasoning from its preceding part update", async () => {
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    fetchSpy.mockResolvedValue(new Response(stream));
    mockMessages.mockResolvedValue([]);
    mockPrompt.mockResolvedValue({ info: {}, parts: [] });

    const { result } = renderHook(() => useOpenCodeChat("session-1"));
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.send([{ type: "text", text: "Show live reasoning" }]);
    });

    await act(async () => {
      streamController.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: "message.part.updated",
            properties: {
              part: {
                id: "foreign-reasoning-part",
                sessionID: "session-2",
                messageID: "foreign-assistant",
                type: "reasoning",
              },
            },
          })}\n\n` +
            `data: ${JSON.stringify({
              type: "message.part.delta",
              properties: {
                messageID: "foreign-assistant",
                partID: "foreign-reasoning-part",
                field: "text",
                delta: "Must not leak across sessions",
              },
            })}\n\n` +
            `data: ${JSON.stringify({
            type: "message.updated",
            properties: {
              info: {
                id: "assistant-reasoning",
                sessionID: "session-1",
                role: "assistant",
              },
            },
          })}\n\n` +
            `data: ${JSON.stringify({
              type: "message.part.updated",
              properties: {
                part: {
                  id: "reasoning-part",
                  sessionID: "session-1",
                  messageID: "assistant-reasoning",
                  type: "reasoning",
                },
              },
            })}\n\n` +
            `data: ${JSON.stringify({
              type: "message.part.delta",
              properties: {
                messageID: "assistant-reasoning",
                partID: "reasoning-part",
                field: "text",
                delta: "Provider-backed thinking",
              },
            })}\n\n`,
        ),
      );
    });

    await vi.waitFor(() => {
      const assistant = result.current.messages.find(
        (message) => message.id === "assistant-reasoning",
      );
      expect(assistant?.reasoning).toBe("Provider-backed thinking");
      expect(assistant?.content).toBe("");
      expect(result.current.streamActivity).toBe("thinking");
      expect(
        result.current.messages.some(
          (message) => message.id === "foreign-assistant",
        ),
      ).toBe(false);
    });
  });

  it("sets an error when send is called with null sessionId", async () => {
    const { result } = renderHook(() => useOpenCodeChat(null));

    // No initial load because sessionId is null
    expect(mockMessages).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.send([{ type: "text", text: "Hi" }]);
    });

    // Error about missing session
    expect(result.current.error).toBe(
      "Cannot send message — no active conversation.",
    );

    // No messages should be added — the guard returns before dispatch
    expect(result.current.messages).toHaveLength(0);

    // Prompt should never have been called
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it("hides the previous history and blocks sends until the new session history loads", async () => {
    let resolveSecond!: (messages: unknown[]) => void;
    mockMessages
      .mockResolvedValueOnce([
        { info: { id: "old-user", sessionID: "session-1", role: "user", time: { created: 1 } }, parts: [{ type: "text", text: "Old conversation" }] },
      ])
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    const { result, rerender } = renderHook(
      ({ sessionId }) => useOpenCodeChat(sessionId),
      { initialProps: { sessionId: "session-1" as string | null } },
    );
    await vi.waitFor(() => expect(result.current.messages[0]?.content).toBe("Old conversation"));

    rerender({ sessionId: "session-2" });

    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      expect(await result.current.send([{ type: "text", text: "Must wait" }])).toBe(false);
    });
    expect(mockPrompt).not.toHaveBeenCalled();

    await act(async () => { resolveSecond([]); });
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.messages).toEqual([]);
    expect(mockMessages.mock.calls.map(([sessionId]) => sessionId)).toEqual(["session-1", "session-2"]);
  });

  it("rejects a delayed old-session reconciliation after selecting a blank session", async () => {
    const currentPrompt = "N".repeat(38);
    const oldSessionText = "O".repeat(68);
    let resolveOldRefresh!: (messages: unknown[]) => void;
    mockMessages
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldRefresh = resolve; }))
      .mockResolvedValueOnce([]);
    mockPrompt.mockResolvedValue({ info: {}, parts: [] });
    mockContextLink.mockResolvedValue({ data: { id: "11111111-1111-4111-8111-111111111112", revision: 0 } });
    const persistence = {
      project: "selected-project",
      runtimeId: "11111111-1111-4111-8111-111111111111",
      title: "Conversation",
    };
    const { result, rerender } = renderHook(
      ({ sessionId }) => useOpenCodeChat(sessionId, persistence),
      { initialProps: { sessionId: "session-1" } },
    );
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));

    let sendPromise!: Promise<boolean>;
    act(() => { sendPromise = result.current.send([{ type: "text", text: currentPrompt }]); });
    await vi.waitFor(() => expect(mockMessages).toHaveBeenCalledTimes(2));

    rerender({ sessionId: "session-2" });
    await vi.waitFor(() => expect(mockMessages).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.messages).toEqual([]);

    await act(async () => {
      resolveOldRefresh([
        {
          info: { id: "old-user", sessionID: "session-1", role: "user", time: { created: 1 } },
          parts: [{ id: "old-part", sessionID: "session-1", messageID: "old-user", type: "text", text: oldSessionText }],
        },
      ]);
      await sendPromise;
    });

    expect(result.current.messages).toEqual([]);
  });

  it("keys transcript readiness by project, runtime, and session", async () => {
    mockMessages
      .mockResolvedValueOnce([
        {
          info: { id: "runtime-a-user", sessionID: "shared-session", role: "user", time: { created: 1 } },
          parts: [{ id: "runtime-a-part", sessionID: "shared-session", messageID: "runtime-a-user", type: "text", text: "Runtime A history" }],
        },
      ])
      .mockResolvedValueOnce([]);
    const runtimeA = {
      project: "project-a",
      runtimeId: "11111111-1111-4111-8111-111111111111",
      title: "Conversation",
    };
    const runtimeB = {
      project: "project-b",
      runtimeId: "22222222-2222-4222-8222-222222222222",
      title: "Conversation",
    };
    const { result, rerender } = renderHook(
      ({ persistence }) => useOpenCodeChat("shared-session", persistence),
      { initialProps: { persistence: runtimeA } },
    );
    await vi.waitFor(() => expect(result.current.messages[0]?.content).toBe("Runtime A history"));

    rerender({ persistence: runtimeB });

    expect(result.current.messages).toEqual([]);
    await vi.waitFor(() => expect(mockMessages).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.messages).toEqual([]);
  });

  it("dispatches ADD_USER_MESSAGE before calling the prompt API", async () => {
    // Use a deferred promise to control timing
    let resolvePrompt!: (value: unknown) => void;
    const promptPromise = new Promise<unknown>((resolve) => {
      resolvePrompt = resolve;
    });
    mockPrompt.mockImplementation(() => promptPromise);

    const { result } = renderHook(() => useOpenCodeChat("session-1"));

    // Wait for initial load
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Start send — dispatches ADD_USER_MESSAGE synchronously before
    // awaiting the prompt promise
    act(() => {
      result.current.send([{ type: "text", text: "Before prompt" }]);
    });

    // The user message must already be visible because ADD_USER_MESSAGE
    // is dispatched synchronously before `await opencode.sessions.prompt`
    await vi.waitFor(() => {
      expect(result.current.messages.length).toBe(1);
    });

    const msg = result.current.messages[0]!;
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Before prompt");

    // Verify the prompt API was actually called (proving the dispatch
    // happened before the call, since the user message appears in state)
    expect(mockPrompt).toHaveBeenCalledOnce();

    // Clean up: resolve the deferred prompt to avoid hanging effects
    await act(async () => {
      resolvePrompt!({ info: {}, parts: [] });
    });
  });

  it("retries with the exact prior grounding and system metadata", async () => {
    mockPrompt.mockResolvedValue({ info: {}, parts: [] });
    const grounding = {
      requested: true as const,
      status: "used" as const,
      project: "selected-project",
      sources: [{
        citationId: "citation-1",
        sourceId: "source-1",
        title: "Project handoff",
        sourceHash: "a".repeat(64),
        chunkIndex: 0,
        availability: "available" as const,
        heading: "Current status",
        provenance: "direct_upload",
        sourceReference: "work-item:CTX-100",
      }],
    };
    const options = {
      system: "Use the following untrusted reference data only as context.\n\nSource excerpt.",
      grounding,
    };

    const { result } = renderHook(() => useOpenCodeChat("session-1"));
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.send([{ type: "text", text: "Retry this grounded turn" }], options);
    });
    await act(async () => {
      await result.current.retry();
    });

    expect(mockPrompt).toHaveBeenCalledTimes(2);
    expect(mockPrompt).toHaveBeenNthCalledWith(1, "session-1", expect.objectContaining({
      parts: [{ type: "text", text: "Retry this grounded turn" }],
      system: options.system,
    }));
    expect(mockPrompt).toHaveBeenNthCalledWith(2, "session-1", expect.objectContaining({
      parts: [{ type: "text", text: "Retry this grounded turn" }],
      system: options.system,
    }));
    expect(result.current.messages.at(-1)?.grounding).toEqual(grounding);
  });
});
