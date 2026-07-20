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
} from "../src/lib/use-opencode-chat";
import type { OpenCodePart } from "../src/lib/opencode";

/* ------------------------------------------------------------------ */
/*  Hoisted mock references — shared across reducer & hook tests      */
/* ------------------------------------------------------------------ */

const { mockPrompt, mockMessages } = vi.hoisted(() => ({
  mockPrompt: vi.fn(),
  mockMessages: vi.fn(),
}));

// Mock opencode so the hook never makes real HTTP calls.
// This must be at module level (vitest hoists it before imports).
vi.mock("../src/lib/opencode", () => ({
  opencode: {
    sessions: {
      messages: mockMessages,
      prompt: mockPrompt,
    },
    permissions: {
      list: vi.fn().mockResolvedValue([]),
    },
    questions: {
      list: vi.fn().mockResolvedValue([]),
    },
  },
}));

/* ------------------------------------------------------------------ */
/*  Reducer accessor                                                   */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Types (mirrored from the hook module for test use)                 */
/* ------------------------------------------------------------------ */

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  isLoading: boolean;
  error: string | null;
  sessionStatus: "idle" | "busy" | null;
  sessionInfo?: {
    cost?: number;
    tokens?: {
      total?: number;
      input?: number;
      output?: number;
      reasoning?: number;
      cache?: { write?: number; read?: number };
    };
    summary?: { diffs?: unknown[] };
    shareUrl?: string;
  };
  questions: Array<{ id: string; question: string }>;
}

type ChatAction =
  | { type: "LOAD_MESSAGES"; messages: ChatMessage[] }
  | { type: "RECONCILE_MESSAGES"; messages: ChatMessage[] }
  | { type: "ADD_USER_MESSAGE"; message: ChatMessage }
  | {
      type: "ACCUMULATE_DELTA";
      messageID: string;
      partID: string;
      delta: string;
      partType?: string;
    }
  | { type: "UPSERT_PART"; messageID: string; part: OpenCodePart }
  | { type: "UPSERT_MESSAGE"; message: ChatMessage }
  | { type: "SET_STREAMING"; value: boolean }
  | { type: "SET_LOADING"; value: boolean }
  | { type: "SET_STATUS"; status: "idle" | "busy" | null }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "UPDATE_SESSION_INFO"; info: ChatState["sessionInfo"] }
  | {
      type: "ADD_QUESTION";
      question: { id: string; question: string };
    }
  | {
      type: "ADD_QUESTIONS";
      questions: Array<{ id: string; question: string }>;
    }
  | { type: "REMOVE_QUESTIONS" }
  | { type: "REMOVE_LAST_USER" }
  | { type: "CLEAR" };

/* ------------------------------------------------------------------ */
/*  Fixture helpers                                                    */
/* ------------------------------------------------------------------ */

function createInitialState(overrides?: Partial<ChatState>): ChatState {
  return {
    messages: [],
    isStreaming: false,
    isLoading: false,
    error: null,
    sessionStatus: null,
    sessionInfo: undefined,
    questions: [],
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

/* ================================================================== */
/*  Reducer unit tests                                                 */
/* ================================================================== */

describe("chatReducer", () => {
  let reducer: ReturnType<typeof getReducer>;

  beforeEach(() => {
    reducer = getReducer();
  });

  // ── LOAD_MESSAGES ────────────────────────────────────────────────

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

  // ── ADD_USER_MESSAGE ─────────────────────────────────────────────

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

  // ── ACCUMULATE_DELTA ─────────────────────────────────────────────

  describe("ACCUMULATE_DELTA", () => {
    it("creates a placeholder assistant when messageID does not exist", () => {
      const state = createInitialState();

      const next = reducer(state, {
        type: "ACCUMULATE_DELTA",
        messageID: "new-msg",
        partID: "part-1",
        delta: "Hello",
        partType: "text",
      });

      expect(next.messages).toHaveLength(1);
      const msg = next.messages[0]!;
      expect(msg.id).toBe("new-msg");
      expect(msg.role).toBe("assistant");
      expect(msg.isStreaming).toBe(true);
      expect(msg.parts).toHaveLength(1);
      expect(msg.content).toBe("Hello");
    });

    it("appends text delta to an existing text part", () => {
      const msg = createMessage({
        id: "msg-1",
        role: "assistant",
        content: "Hel",
        parts: [textPart({ id: "part-1", text: "Hel" })],
        isStreaming: true,
      });
      const state = createInitialState({ messages: [msg] });

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

    it("appends text when there's no existing part with that ID (creates new)", () => {
      const msg = createMessage({
        id: "msg-1",
        role: "assistant",
        parts: [],
        isStreaming: true,
      });
      const state = createInitialState({ messages: [msg] });

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
      const state = createInitialState({ messages: [msg] });

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
      const state = createInitialState({ messages: [msg] });

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
      const state = createInitialState({ messages: [msg] });

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

  // ── UPSERT_MESSAGE ───────────────────────────────────────────────

  describe("UPSERT_MESSAGE", () => {
    it("updates an existing message by id", () => {
      const original = createMessage({
        id: "msg-1",
        role: "assistant",
        content: "old",
      });
      const updated = createMessage({
        id: "msg-1",
        role: "assistant",
        content: "new",
        isStreaming: false,
      });
      const state = createInitialState({ messages: [original] });

      const next = reducer(state, {
        type: "UPSERT_MESSAGE",
        message: updated,
      });

      expect(next.messages).toHaveLength(1);
      expect(next.messages[0]!.content).toBe("new");
      expect(next.messages[0]!.isStreaming).toBe(false);
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

  // ── RECONCILE_MESSAGES ───────────────────────────────────────────

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

    it("updates isStreaming on existing messages from refreshed data", () => {
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

      expect(next.messages[0]!.isStreaming).toBe(false);
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

  // ── SET_STREAMING ────────────────────────────────────────────────

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

  // ── SET_ERROR ────────────────────────────────────────────────────

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

  // ── REMOVE_LAST_USER ─────────────────────────────────────────────

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

  // ── REMOVE_QUESTIONS ─────────────────────────────────────────────

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

  // ── UPSERT_PART ──────────────────────────────────────────────────

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
  });

  // ── CLEAR ────────────────────────────────────────────────────────

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
      });
    });
  });

  // ── SET_LOADING ──────────────────────────────────────────────────

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

  // ── SET_STATUS ──────────────────────────────────────────────────

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

  // ── UPDATE_SESSION_INFO ─────────────────────────────────────────

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

  // ── ADD_QUESTION / ADD_QUESTIONS ─────────────────────────────────

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

  // ── Default case ─────────────────────────────────────────────────

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

/* ================================================================== */
/*  Hook integration tests                                             */
/* ================================================================== */

describe("useOpenCodeChat hook — send() integration", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset call counts and implementations for each test.
    // These mocks are defined at module scope via vi.hoisted, so they
    // persist across tests unless explicitly reset.
    mockMessages.mockReset();
    mockMessages.mockResolvedValue([]);
    mockPrompt.mockReset();

    // Spy on fetch so SSE connections fail silently (AbortError)
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new DOMException("Aborted", "AbortError"),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    cleanup();
  });

  // ── Test 13: send preserves user message on error ───────────────

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

  // ── Test 14: send dispatches error on null sessionId ────────────

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

  // ── Test 15: ADD_USER_MESSAGE dispatched before prompt call ─────

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
});
