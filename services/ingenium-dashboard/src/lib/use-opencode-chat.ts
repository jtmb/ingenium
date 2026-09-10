"use client";

import { useReducer, useEffect, useCallback, useRef, useState } from "react";
import type { OpenCodePart, FilePart, ToolPart, OpenCodePromptParams } from "./opencode";
import { api, ApiError } from "./api";
import { useOpenCodeClient } from "./RuntimeContext";
import type { ChatGrounding } from "./chat-grounding";
import type {
  QuestionItem as ChatQuestionItem,
  QuestionOption,
} from "../app/chat/components/QuestionPrompt";

/** Options that control model/agent/variant/system for the next send. */
export interface SendOptions {
  model?: { providerID: string; modelID: string };
  agent?: string;
  variant?: string;
  system?: string;
  tools?: Record<string, boolean>;
  /** Local-only display/retry metadata; never forwarded to OpenCode. */
  grounding?: ChatGrounding;
}

export interface ChatPersistenceScope {
  project: string;
  runtimeId: string | null;
  title: string;
}

function chatScopeKey(
  sessionId: string | null,
  project: string | undefined,
  runtimeId: string | null | undefined,
): string | null {
  if (!sessionId) return null;
  return `${project ?? "unscoped"}\0${runtimeId === undefined ? "unbound" : runtimeId ?? "compatibility"}\0${sessionId}`;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;  // text only — no reasoning mixed in
  parts: OpenCodePart[];
  reasoning?: string;  // separate reasoning content from thinking parts
  model?: { providerID: string; modelID: string };  // from message.updated info
  /** Per-send project context metadata, retained only in the active UI state. */
  grounding?: ChatGrounding;
  timestamp: number;
  isStreaming?: boolean;
}

/** Raw message from the OpenCode API (GET /session/{id}/message). */
interface OpenCodeApiMessage {
  info: {
    id: string;
    sessionID: string;
    role: "user" | "assistant";
    time: { created: number; completed?: number };
    modelID?: string;
    providerID?: string;
    finish?: string;
    parentID?: string;
    mode?: string;
    agent?: string;
    cost?: number;
    tokens?: {
      total?: number;
      input?: number;
      output?: number;
      reasoning?: number;
      cache?: { write?: number; read?: number };
    };
    path?: { cwd: string; root: string };
    summary?: { diffs?: unknown[] };
  };
  parts: Array<{
    id: string;
    sessionID: string;
    messageID: string;
    type: string;
    text?: string;
    time?: { start?: number; end?: number };
    snapshot?: string;
    reason?: string;
    tokens?: unknown;
    cost?: number;
  }>;
}

/** Session metadata updated via session.updated SSE events. */
export interface SessionInfo {
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
}

/** Activity phase tracking for streaming UI feedback. */
export type StreamActivity =
  | "idle"
  | "connecting"   // SSE being established
  | "thinking"     // reasoning deltas arriving
  | "tool"         // tool parts executing
  | "responding"   // text deltas arriving
  | "reconnecting" // SSE reconnect in progress
  | "complete"     // session.idle received
  | "stopped"      // user clicked stop
  | "error";       // session.error received

/** Streamable part types whose text deltas belong in the conversation. */
type StreamTextPartType = "text" | "reasoning";

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  isLoading: boolean;
  error: string | null;
  sessionStatus: "idle" | "busy" | null;
  sessionInfo?: SessionInfo;
  questions: ChatQuestionItem[];
  streamActivity: StreamActivity;
  /** Authoritative type for each stream part, established by part.updated. */
  partTypes: Record<string, StreamTextPartType>;
  /** The assistant message currently owned by the active SSE turn. */
  activeAssistantMessageId?: string;
  /** Proven optimistic-to-authoritative user ID aliases for delayed events. */
  userMessageAliases: Record<string, string>;
}

/** A pending permission request from the OpenCode API. */
export interface PermissionRequest {
  id: string;
  permission: string;
  pattern: string;
  action: string;
}

/** Permission polling result stored alongside chat state. */
interface PermissionState {
  scopeKey: string | null;
  requests: PermissionRequest[];
  replied: Set<string>;
}

type ChatAction =
  | { type: "LOAD_MESSAGES"; messages: ChatMessage[] }
  | {
      type: "RECONCILE_MESSAGES";
      messages: ChatMessage[];
    }
  | { type: "CORRELATE_USER_MESSAGE"; optimisticId: string; authoritativeId: string }
  | { type: "ADD_USER_MESSAGE"; message: ChatMessage }
  | {
      type: "ACCUMULATE_DELTA";
      messageID: string;
      partID: string;
      delta: string;
      partType: StreamTextPartType;
    }
  | { type: "UPSERT_PART"; messageID: string; part: OpenCodePart }
  | { type: "UPSERT_MESSAGE"; message: ChatMessage }
  | { type: "SET_STREAMING"; value: boolean }
  | { type: "SET_LOADING"; value: boolean }
  | { type: "SET_STATUS"; status: "idle" | "busy" | null }
  | { type: "SET_STREAM_ACTIVITY"; activity: StreamActivity }
  | { type: "SET_TRANSIENT_ERROR"; error: string | null }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "UPDATE_SESSION_INFO"; info: SessionInfo }
  | { type: "ADD_QUESTION"; question: ChatQuestionItem }
  | { type: "ADD_QUESTIONS"; questions: ChatQuestionItem[] }
  | { type: "REMOVE_QUESTIONS" }
  | { type: "REMOVE_LAST_USER" }
  | { type: "FINALIZE_STREAMING" }
  | { type: "CLEAR" };

/** Build a stable key for accumulator lookups. */
function partKey(messageID: string, partID: string): string {
  return `${messageID}::${partID}`;
}

let lastMessageTimestamp = 0;
let messageCounter = 0;

function createMessageId(): string {
  const timestamp = Date.now();
  messageCounter = timestamp === lastMessageTimestamp ? messageCounter + 1 : 0;
  lastMessageTimestamp = timestamp;
  const encodedTime = (BigInt(timestamp) * 0x1000n + BigInt(messageCounter))
    .toString(16)
    .padStart(12, "0")
    .slice(-12);
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const random = crypto.getRandomValues(new Uint8Array(14));
  return `msg_${encodedTime}${Array.from(random, (value) => alphabet[value % alphabet.length]).join("")}`;
}

function streamTextPartType(part: OpenCodePart): StreamTextPartType | undefined {
  return part.type === "text" || part.type === "reasoning"
    ? part.type
    : undefined;
}

/** Index only types delivered by OpenCode part records, never delta fields. */
function collectPartTypes(messages: ChatMessage[]): Record<string, StreamTextPartType> {
  const partTypes: Record<string, StreamTextPartType> = {};
  for (const message of messages) {
    for (const part of message.parts) {
      const type = streamTextPartType(part);
      if (type && "id" in part && part.id) {
        partTypes[partKey(message.id, part.id)] = type;
      }
    }
  }
  return partTypes;
}

/** Join text parts into a single content string — excludes reasoning parts. */
function buildContent(parts: OpenCodePart[]): string {
  return parts
    .filter(
      (p): p is OpenCodePart & { text: string } =>
        p.type === "text" && typeof p.text === "string",
    )
    .map((p) => p.text)
    .join("\n\n");
}

/** Extract reasoning content from reasoning-type parts. */
function extractReasoning(parts: OpenCodePart[]): string | undefined {
  const texts = parts
    .filter(
      (p): p is OpenCodePart & { text: string } =>
        p.type === "reasoning" && typeof p.text === "string",
    )
    .map((p) => p.text);
  return texts.length > 0 ? texts.join("\n\n") : undefined;
}

function isSuccessfulAssistantFinish(finish: string | undefined): boolean {
  return finish === "stop";
}

function aliasedMessage(message: ChatMessage, aliases: Record<string, string>): ChatMessage {
  const id = aliases[message.id] ?? message.id;
  if (id === message.id) return message;
  return {
    ...message,
    id,
    parts: message.parts.map((part) => ({ ...part, messageID: id })),
  };
}

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "LOAD_MESSAGES":
      return {
        ...state,
        messages: action.messages,
        partTypes: collectPartTypes(action.messages),
        isLoading: false,
        error: null,
        activeAssistantMessageId: undefined,
      };

    case "RECONCILE_MESSAGES": {
      const incoming = action.messages.map((message) => aliasedMessage(message, state.userMessageAliases));
      const refreshedById = new Map(
        incoming.map((message) => [message.id, message]),
      );
      const reconciled = state.messages.map((message) => aliasedMessage(message, state.userMessageAliases)).map((message) => {
        const refreshed = refreshedById.get(message.id);
        // A completed fetch snapshot is not a terminal SSE signal. Preserve
        // event-backed parts for the active assistant turn until terminal.
        if (
          message.role === "assistant" &&
          (message.id === state.activeAssistantMessageId || message.isStreaming)
        ) {
          return message;
        }
        return refreshed
          ? { ...refreshed, ...(message.grounding ? { grounding: message.grounding } : {}) }
          : message;
      });
      const existingIds = new Set(reconciled.map((message) => message.id));

      for (const message of incoming) {
        if (existingIds.has(message.id)) {
          continue;
        }

        reconciled.push(message);
        existingIds.add(message.id);
      }

      return {
        ...state,
        messages: reconciled,
        partTypes: collectPartTypes(reconciled),
        isLoading: false,
      };
    }

    case "CORRELATE_USER_MESSAGE": {
      if (action.optimisticId === action.authoritativeId) return state;
      const userMessageAliases = {
        ...state.userMessageAliases,
        [action.optimisticId]: action.authoritativeId,
      };
      const optimisticIndex = state.messages.findIndex(({ id }) => id === action.optimisticId);
      if (optimisticIndex < 0) return { ...state, userMessageAliases };
      const optimistic = state.messages[optimisticIndex]!;
      const authoritative = state.messages.find(({ id }) => id === action.authoritativeId);
      const replacement = authoritative
        ? { ...authoritative, ...(optimistic.grounding ? { grounding: optimistic.grounding } : {}) }
        : {
            ...optimistic,
            id: action.authoritativeId,
            parts: optimistic.parts.map((part) => ({ ...part, messageID: action.authoritativeId })),
          };
      const messages = state.messages.filter(({ id }) =>
        id !== action.optimisticId && id !== action.authoritativeId);
      messages.splice(optimisticIndex, 0, replacement);
      return { ...state, messages, partTypes: collectPartTypes(messages), userMessageAliases };
    }

    case "ADD_USER_MESSAGE": {
      return {
        ...state,
        messages: [...state.messages, action.message],
        error: null,
      };
    }

    case "ACCUMULATE_DELTA": {
      const msgs = [...state.messages];
      const key = partKey(action.messageID, action.partID);
      const mappedType = state.partTypes[key];
      const target = msgs.find((m) => m.id === action.messageID);

      // v1.18.9 deltas use field: "text" for both answer and reasoning.
      // Only a preceding part.updated record is authoritative about which one
      // the part is, so an unmapped delta must never fabricate reasoning.
      if (!target || mappedType !== action.partType) {
        return state;
      }

      const existingIdx = target.parts.findIndex(
        (p) =>
          "id" in p &&
          p.id === action.partID &&
          p.type === mappedType,
      );

      if (existingIdx < 0) {
        return state;
      }

      const part = target.parts[existingIdx]!;
      const existingText =
        "text" in part && typeof part.text === "string" ? part.text : "";
      const newParts = [...target.parts];
      newParts[existingIdx] = {
        ...part,
        // part.updated commonly arrives before its first delta without text.
        text: existingText + action.delta,
      } as OpenCodePart;
      const newTarget = {
        ...target,
        parts: newParts,
        content: buildContent(newParts),
        reasoning: extractReasoning(newParts),
        isStreaming: true,
      };
      msgs[msgs.indexOf(target)] = newTarget;
      return {
        ...state,
        messages: msgs,
        isStreaming: true,
        activeAssistantMessageId: action.messageID,
      };
    }

    case "UPSERT_PART": {
      const messageID = state.userMessageAliases[action.messageID] ?? action.messageID;
      const incomingPart = messageID === action.messageID
        ? action.part
        : { ...action.part, messageID } as OpenCodePart;
      const msgs = [...state.messages];
      let target = msgs.find((m) => m.id === messageID);

      if (!target) {
        target = {
          id: messageID,
          role: "assistant" as const,
          content: "",
          parts: [],
          timestamp: Date.now(),
          isStreaming: true,
        };
        msgs.push(target);
      }

      const idx = target.parts.findIndex(
        (p) => "id" in p && p.id === incomingPart.id,
      );
      const newParts = [...target.parts];
      if (idx >= 0) {
        newParts[idx] = incomingPart;
      } else {
        newParts.push(incomingPart);
      }
      const partType = streamTextPartType(incomingPart);
      const partTypes = { ...state.partTypes };
      const key = partKey(messageID, incomingPart.id);
      if (partType) {
        partTypes[key] = partType;
      } else {
        delete partTypes[key];
      }

      msgs[msgs.indexOf(target)] = {
        ...target,
        parts: newParts,
        content: buildContent(newParts),
        reasoning: extractReasoning(newParts),
      };
      return {
        ...state,
        messages: msgs,
        partTypes,
        activeAssistantMessageId: messageID,
      };
    }

    case "UPSERT_MESSAGE": {
      const message = aliasedMessage(action.message, state.userMessageAliases);
      const msgs = [...state.messages];
      const idx = msgs.findIndex((m) => m.id === message.id);
      // message.updated can report completion before session.idle arrives.
      // The SSE lifecycle, not this intermediate snapshot, closes the turn.
      const isActiveAssistantMessage =
        message.role === "assistant" &&
        (state.isStreaming ||
          state.activeAssistantMessageId === message.id ||
          msgs[idx]?.isStreaming === true);
      if (idx >= 0) {
        // 🔴 Merge metadata WITHOUT replacing accumulated parts
        const existing = msgs[idx]!;
        msgs[idx] = {
          ...existing,
          model: message.model ?? existing.model,
          isStreaming: isActiveAssistantMessage
            ? true
            : message.isStreaming ?? existing.isStreaming,
          // Only update timestamp if the incoming one is more recent
          timestamp: Math.max(existing.timestamp, message.timestamp),
        };
      } else {
        msgs.push({
          ...message,
          isStreaming: isActiveAssistantMessage
            ? true
            : message.isStreaming,
        });
      }
      return {
        ...state,
        messages: msgs,
        activeAssistantMessageId: isActiveAssistantMessage
          ? message.id
          : state.activeAssistantMessageId,
      };
    }

    case "UPDATE_SESSION_INFO":
      return {
        ...state,
        sessionInfo: { ...state.sessionInfo, ...action.info },
      };

    case "SET_STREAMING":
      return { ...state, isStreaming: action.value };

    case "SET_LOADING":
      return { ...state, isLoading: action.value };

    case "SET_STATUS":
      return { ...state, sessionStatus: action.status };

    case "SET_STREAM_ACTIVITY":
      return { ...state, streamActivity: action.activity };

    case "SET_TRANSIENT_ERROR":
      // Reconnection is not terminal; preserve active reasoning while retrying.
      return { ...state, error: action.error };

    case "SET_ERROR":
      return { ...state, error: action.error, isStreaming: false, isLoading: false };

    case "FINALIZE_STREAMING": {
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === state.activeAssistantMessageId
            ? { ...m, isStreaming: false }
            : m,
        ),
        isStreaming: false,
        activeAssistantMessageId: undefined,
      };
    }

    case "ADD_QUESTION": {
      // Add or replace a single question (deduplicate by id)
      const existing = state.questions.findIndex(
        (q) => q.id === action.question.id,
      );
      if (existing >= 0) {
        const next = [...state.questions];
        next[existing] = action.question;
        return { ...state, questions: next };
      }
      return { ...state, questions: [...state.questions, action.question] };
    }

    case "ADD_QUESTIONS": {
      // Merge unique questions (source may be polling which returns full list)
      const merged = [...state.questions];
      for (const q of action.questions) {
        if (!merged.some((m) => m.id === q.id)) {
          merged.push(q);
        }
      }
      return { ...state, questions: merged };
    }

    case "REMOVE_QUESTIONS":
      return { ...state, questions: [] };

    case "REMOVE_LAST_USER": {
      const msgs = [...state.messages];
      // Remove the user message that triggered the failed send
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i]?.role === "user") {
          msgs.splice(i, 1);
          break;
        }
      }
      return { ...state, messages: msgs };
    }

    case "CLEAR":
      return {
        messages: [],
        isStreaming: false,
        isLoading: false,
        error: null,
        sessionStatus: null,
        sessionInfo: undefined,
        questions: [],
        streamActivity: "idle" as StreamActivity,
        partTypes: {},
        activeAssistantMessageId: undefined,
        userMessageAliases: {},
      };

    default:
      return state;
  }
}

interface SSEEnvelope {
  id?: string;
  type: string;
  properties: Record<string, unknown>;
}

function normalizePart(raw: OpenCodeApiMessage["parts"][number]): OpenCodePart {
  const base: Partial<OpenCodePart> = {
    id: raw.id,
    sessionID: raw.sessionID,
    messageID: raw.messageID,
    type: raw.type as OpenCodePart["type"],
    text: raw.text,
    ...(raw.time?.start ? { time: { start: raw.time.start, end: raw.time.end } } : {}),
    ...(raw.snapshot ? { snapshot: raw.snapshot } : {}),
    ...(raw.reason ? { reason: raw.reason } : {}),
    ...(raw.tokens !== undefined ? { tokens: raw.tokens } : {}),
    ...(raw.cost !== undefined ? { cost: raw.cost } : {}),
  };

  // 🔴 Preserve tool-specific fields
  if (raw.type === "tool") {
    const toolRaw = raw as unknown as Record<string, unknown>;
    return {
      ...base,
      tool: toolRaw.tool,
      callID: toolRaw.callID,
      state: toolRaw.state,
    } as ToolPart;
  }

  return base as OpenCodePart;
}

function normalizeMessage(raw: OpenCodeApiMessage): ChatMessage {
  // Convert OpenCode parts to our part format
  const parts: OpenCodePart[] = raw.parts.map(normalizePart);

  const model = raw.info.providerID && raw.info.modelID
    ? { providerID: raw.info.providerID, modelID: raw.info.modelID }
    : undefined;

  return {
    id: raw.info.id,
    role: raw.info.role,
    content: buildContent(parts),
    parts,
    reasoning: extractReasoning(parts),
    model,
    timestamp: raw.info.time.created,
    isStreaming:
      raw.info.role === "assistant" && raw.info.time.completed === undefined,
  };
}

function normalizeMessages(rawMessages: OpenCodeApiMessage[]): ChatMessage[] {
  return rawMessages.map(normalizeMessage);
}

interface SSEConnection {
  abortController: AbortController;
  close: () => void;
}

/**
 * Parse a raw SSE stream line-by-line, accumulating `data:` lines until
 * a blank line marks the end of an event. Handles fragmented chunks
 * where partial lines span multiple `reader.read()` calls.
 */
class SSEParser {
  private dataBuffer: string[] = [];
  private lastEventId: string | null = null;
  private lineBuffer = "";

  /** Process a chunk of text from the stream. Returns parsed events. */
  append(chunk: string): SSEEnvelope[] {
    const events: SSEEnvelope[] = [];
    // Append to any incomplete line from previous chunk
    const text = this.lineBuffer + chunk;
    const lines = text.split("\n");

    // Last element may be incomplete — save for next chunk
    this.lineBuffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

      if (line === "") {
        // Blank line = end of event
        if (this.dataBuffer.length > 0) {
          const data = this.dataBuffer.join("\n");
          this.dataBuffer = [];
          try {
            const parsed: SSEEnvelope = JSON.parse(data);
            events.push(parsed);
          } catch {
            // Malformed JSON — skip
          }
        }
        continue;
      }

      if (line.startsWith(":")) {
        // Comment — skip
        continue;
      }

      if (line.startsWith("id:")) {
        this.lastEventId = line.slice(3).trim();
        continue;
      }

      if (line.startsWith("data:")) {
        const value = line.slice(5);
        // Strip a single leading space per SSE spec
        this.dataBuffer.push(value.startsWith(" ") ? value.slice(1) : value);
        continue;
      }

      // Other fields (event:, retry:) — currently unused, skip
    }

    return events;
  }

  /** Return the last seen `id:` for Last-Event-ID reconnect. */
  getLastEventId(): string | null {
    return this.lastEventId;
  }

  /** Queue an event ID directly (from the envelope's own `id` field). */
  setLastEventId(id: string): void {
    this.lastEventId = id;
  }

  /** Reset line buffer for new connection. */
  reset(): void {
    this.lineBuffer = "";
    this.dataBuffer = [];
    // Preserve lastEventId for reconnection
  }
}

/** Let React paint each provider event when a transport coalesces SSE chunks. */
function yieldSSEEventRender(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && window.requestAnimationFrame) {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 16);
  });
}

/**
 * React hook managing chat state with SSE streaming via fetch + ReadableStream.
 *
 * - Loads historical messages on sessionId change
 * - Opens SSE stream for real-time events after sending a prompt
 * - Parses v1.18.9 contract events: message.part.delta, message.part.updated,
 *   message.updated, session.status, session.idle, session.diff, session.error
 * - Idempotent reducer using messageID + partID as stable keys
 * - Exponential backoff reconnection (1s, 2s, 4s, max 30s, 3 attempts)
 * - AbortController for cancellation on unmount
 */
export function useOpenCodeChat(sessionId: string | null, persistence?: ChatPersistenceScope) {
  const opencode = useOpenCodeClient();
  const persistenceProject = persistence?.project;
  const persistenceRuntimeId = persistence?.runtimeId;
  const persistenceTitle = persistence?.title;
  const scopeKey = chatScopeKey(sessionId, persistenceProject, persistenceRuntimeId);
  const [state, dispatch] = useReducer(chatReducer, {
    messages: [],
    isStreaming: false,
    isLoading: false,
    error: null,
    sessionStatus: null,
    questions: [],
    streamActivity: "idle" as StreamActivity,
    partTypes: {},
    userMessageAliases: {},
  });

  const sseAbortRef = useRef<AbortController | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const parserRef = useRef<SSEParser>(new SSEParser());
  const activeSessionRef = useRef<string | null>(null);
  const activeScopeRef = useRef<string | null>(null);
  const [loadedScopeKey, markLoadedScope] = useReducer(
    (_current: string | null, next: string | null) => next,
    null,
  );
  // Deltas expose only a field name, not a semantic part type. This map is
  // populated exclusively from OpenCode's preceding message.part.updated.
  const streamPartTypesRef = useRef<Map<string, StreamTextPartType>>(new Map());
  // Store last send parts for retry
  const lastSendPartsRef = useRef<Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string; filename?: string }> | null>(
    null,
  );
  // Store last send options for retry
  const lastSendOptionsRef = useRef<SendOptions | undefined>(undefined);
  const pendingUserTurnsRef = useRef(new Map<string, {
    scopeKey: string;
    messageID: string;
    authoritativeId?: string;
    terminal: boolean;
  }>());
  const correlatedUserIdsRef = useRef(new Set<string>());

  const questionPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const contextLinkRef = useRef<{
    key: string;
    promise: Promise<{ id: string; revision: number }>;
    current: { id: string; revision: number } | null;
  } | null>(null);
  const persistedTurnsRef = useRef(new Set<string>());
  const persistingTurnsRef = useRef(new Map<string, Promise<void>>());
  const persistenceQueuesRef = useRef(new Map<string, Promise<void>>());

  const [permissionState, setPermissionState] = useState<PermissionState>({
    scopeKey: null,
    requests: [],
    replied: new Set(),
  });
  const permissionPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const pendingUserTurns = pendingUserTurnsRef.current;
    const correlatedUserIds = correlatedUserIdsRef.current;
    // Track the active session for SSE filter
    activeSessionRef.current = sessionId;
    activeScopeRef.current = scopeKey;
    markLoadedScope(null);
    seenEventIdsRef.current.clear();
    parserRef.current = new SSEParser();
    streamPartTypesRef.current.clear();
    lastSendPartsRef.current = null;
    lastSendOptionsRef.current = undefined;
    pendingUserTurnsRef.current.clear();
    correlatedUserIdsRef.current.clear();
    dispatch({ type: "CLEAR" });

    if (!sessionId || !scopeKey) {
      return;
    }

    let cancelled = false;
    dispatch({ type: "SET_LOADING", value: true });

    (async () => {
      try {
        const rawMessages = (await opencode.sessions.messages(
          sessionId,
        )) as unknown as OpenCodeApiMessage[];
        if (!cancelled && activeScopeRef.current === scopeKey) {
          markLoadedScope(scopeKey);
          dispatch({
            type: "LOAD_MESSAGES",
            messages: normalizeMessages(rawMessages),
          });
        }
      } catch (err: unknown) {
        if (!cancelled && activeScopeRef.current === scopeKey) {
          markLoadedScope(scopeKey);
          dispatch({
            type: "SET_ERROR",
            error: err instanceof Error ? err.message : "Failed to load messages",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      pendingUserTurns.clear();
      correlatedUserIds.clear();
    };
  }, [opencode, scopeKey, sessionId]);

  const ensureContextLink = useCallback(async (refresh = false) => {
    if (!sessionId || !persistenceProject || persistenceRuntimeId === undefined) return null;
    const key = `${persistenceProject}\0${persistenceRuntimeId ?? "compatibility"}\0${sessionId}`;
    if (!refresh && contextLinkRef.current?.key === key) {
      return contextLinkRef.current.current ?? contextLinkRef.current.promise;
    }
    const promise = api.context.chat.link({
      runtimeId: persistenceRuntimeId,
      sessionId,
      title: persistenceTitle || "New conversation",
    }, persistenceProject).then(({ data }) => ({ id: data.id, revision: data.revision }));
    contextLinkRef.current = { key, promise, current: null };
    try {
      const linked = await promise;
      if (contextLinkRef.current?.key === key) contextLinkRef.current.current = linked;
      return linked;
    } catch (error) {
      if (contextLinkRef.current?.key === key) contextLinkRef.current = null;
      throw error;
    }
  }, [persistenceProject, persistenceRuntimeId, persistenceTitle, sessionId]);

  useEffect(() => {
    if (!sessionId || !persistenceProject || persistenceRuntimeId === undefined) return;
    const requestScope = scopeKey;
    void ensureContextLink().catch(() => {
      if (activeScopeRef.current !== requestScope) return;
      dispatch({ type: "SET_TRANSIENT_ERROR", error: "Context checkpointing is unavailable for this conversation." });
    });
  }, [ensureContextLink, persistenceProject, persistenceRuntimeId, scopeKey, sessionId]);

  const persistCompletedTurn = useCallback(async (sid: string): Promise<void> => {
    if (!persistenceProject || persistenceRuntimeId === undefined || sid !== sessionId) return Promise.resolve();
    try {
      const rawMessages = await opencode.sessions.messages(sid) as unknown as OpenCodeApiMessage[];
      let assistantIndex = -1;
      for (let index = rawMessages.length - 1; index >= 0; index -= 1) {
        const message = rawMessages[index]!;
        if (message.info.role === "assistant") {
          assistantIndex = index;
          break;
        }
      }
      if (assistantIndex < 1) return;
      const assistant = rawMessages[assistantIndex]!;
      if (!isSuccessfulAssistantFinish(assistant.info.finish)) return;
      let user: OpenCodeApiMessage | undefined;
      for (let index = assistantIndex - 1; index >= 0; index -= 1) {
        if (rawMessages[index]!.info.role === "user") {
          user = rawMessages[index];
          break;
        }
      }
      const content = (message: OpenCodeApiMessage) => message.parts
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text!)
        .join("\n\n")
        .trim();
      const userContent = user ? content(user) : "";
      const assistantContent = content(assistant);
      if (!user || !userContent || !assistantContent) return;
      const sessionKey = `${persistenceProject}\0${persistenceRuntimeId ?? "compatibility"}\0${sid}`;
      const turnKey = `${sessionKey}\0${assistant.info.id}`;
      if (persistedTurnsRef.current.has(turnKey)) return;
      const existing = persistingTurnsRef.current.get(turnKey);
      if (existing) return existing;

      const prior = persistenceQueuesRef.current.get(sessionKey) ?? Promise.resolve();
      const operation = prior.then(async () => {
        const persist = async (refresh: boolean) => {
          const linked = await ensureContextLink(refresh);
          if (!linked) return;
          const response = await api.context.chat.persistTurn(linked.id, {
            runtimeId: persistenceRuntimeId,
            sessionId: sid,
            userMessageId: user!.info.id,
            assistantMessageId: assistant.info.id,
            userContent,
            assistantContent,
            expectedRevision: linked.revision,
          }, persistenceProject);
          if (contextLinkRef.current?.current?.id === linked.id) {
            contextLinkRef.current.current.revision = response.data.revision;
          }
        };
        try {
          await persist(false);
        } catch (error) {
          await persist(error instanceof ApiError && error.code === "REVISION_CONFLICT");
        }
        persistedTurnsRef.current.add(turnKey);
      }).catch(() => {
        if (activeScopeRef.current !== scopeKey) return;
        dispatch({ type: "SET_TRANSIENT_ERROR", error: "The response completed, but its context checkpoint could not be saved." });
      });
      persistingTurnsRef.current.set(turnKey, operation);
      persistenceQueuesRef.current.set(sessionKey, operation);
      void operation.finally(() => {
        if (persistingTurnsRef.current.get(turnKey) === operation) persistingTurnsRef.current.delete(turnKey);
        if (persistenceQueuesRef.current.get(sessionKey) === operation) persistenceQueuesRef.current.delete(sessionKey);
      });
      return operation;
    } catch {
      if (activeScopeRef.current !== scopeKey) return;
      dispatch({ type: "SET_TRANSIENT_ERROR", error: "The response completed, but its context checkpoint could not be saved." });
    }
  }, [ensureContextLink, opencode, persistenceProject, persistenceRuntimeId, scopeKey, sessionId]);

  const correlatePendingUser = useCallback((authoritativeId: string, correlationScope: string): void => {
    const correlationKey = `${correlationScope}\0${authoritativeId}`;
    if (correlatedUserIdsRef.current.has(correlationKey)) return;
    const turns = [...pendingUserTurnsRef.current.values()];
    if (turns.some((turn) =>
      turn.scopeKey === correlationScope && turn.authoritativeId === authoritativeId)) return;
    const pending = pendingUserTurnsRef.current.get(authoritativeId)
      ?? turns.reverse().find((turn) => turn.scopeKey === correlationScope && !turn.authoritativeId);
    if (!pending || pending.scopeKey !== correlationScope) return;
    pending.authoritativeId = authoritativeId;
    dispatch({
      type: "CORRELATE_USER_MESSAGE",
      optimisticId: pending.messageID,
      authoritativeId,
    });
    if (pending.terminal) {
      correlatedUserIdsRef.current.add(correlationKey);
      pendingUserTurnsRef.current.delete(pending.messageID);
    }
  }, []);

  const correlateSnapshotUsers = useCallback((messages: OpenCodeApiMessage[], correlationScope: string): void => {
    for (const message of messages) {
      if (message.info.role === "assistant" && message.info.parentID) {
        correlatePendingUser(message.info.parentID, correlationScope);
      }
    }
  }, [correlatePendingUser]);

  const markPendingTurnsTerminal = useCallback((correlationScope: string): void => {
    for (const pending of pendingUserTurnsRef.current.values()) {
      if (pending.scopeKey !== correlationScope) continue;
      pending.terminal = true;
      if (pending.authoritativeId) {
        correlatedUserIdsRef.current.add(`${correlationScope}\0${pending.authoritativeId}`);
        pendingUserTurnsRef.current.delete(pending.messageID);
      }
    }
  }, []);

  const connectSSE = useCallback((sid: string) => {
    if (!scopeKey) return () => undefined;
    const connectionScope = scopeKey;
    // Abort any existing connection
    if (sseAbortRef.current) {
      sseAbortRef.current.abort();
      sseAbortRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    const abortController = new AbortController();
    sseAbortRef.current = abortController;

    const streamUrl = opencode.events.url(sid);
    // Reset parser for fresh connection (preserves lastEventId for reconnect)
    parserRef.current.reset();

    // If we have a last event ID from a prior connection, include it
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    const lastId = parserRef.current.getLastEventId();
    if (lastId) {
      headers["Last-Event-ID"] = lastId;
    }

    fetch(streamUrl, { headers, signal: abortController.signal })
      .then(async (response) => {
        if (activeScopeRef.current !== connectionScope) return;
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(
            `SSE connection failed: ${response.status} ${response.statusText}${text ? ` — ${text}` : ""}`,
          );
        }

        if (!response.body) {
          throw new Error("SSE response has no readable body");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = parserRef.current;
        reconnectAttemptRef.current = 0; // Reset on successful connection
        dispatch({ type: "SET_TRANSIENT_ERROR", error: null });

        async function readStream(): Promise<void> {
          let receivedTerminalEvent = false;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Aborting a prior stream does not guarantee that an already
            // buffered read cannot resolve. Keep session filtering strict.
            if (activeScopeRef.current !== connectionScope) return;

            const chunk = decoder.decode(value, { stream: true });
            const events = parser.append(chunk);

            for (const evt of events) {
              if (activeScopeRef.current !== connectionScope) return;

              // Idempotency: skip already-seen events
              if (evt.id && seenEventIdsRef.current.has(evt.id)) {
                continue;
              }
              if (evt.id) {
                seenEventIdsRef.current.add(evt.id);
                parser.setLastEventId(evt.id);
              }

              // Filter by sessionID if present on the event, but NOT on
              // server.connected / server.heartbeat which have no session
              const props = evt.properties as Record<string, unknown>;
              if (
                props.sessionID &&
                props.sessionID !== sid
              ) {
                continue;
              }

              if (evt.type === "session.idle" || evt.type === "session.error") {
                receivedTerminalEvent = true;
              }
              dispatchSSEEvent(evt, sid, connectionScope);

              // Fetch streams are allowed to coalesce several provider events
              // into one read. Yielding between events lets incremental
              // reasoning commit before a later completion event can finalize
              // the active turn.
              await yieldSSEEventRender();
            }
          }

          if (!receivedTerminalEvent && activeScopeRef.current === connectionScope) {
            markPendingTurnsTerminal(connectionScope);
            dispatch({ type: "FINALIZE_STREAMING" });
            dispatch({
              type: "SET_ERROR",
              error: "Stream ended unexpectedly. The response may be incomplete.",
            });
          }
        }

        await readStream();
      })
      .catch((err: unknown) => {
        if (activeScopeRef.current !== connectionScope) return;
        if (
          abortController.signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return; // Intentional close — no reconnect needed
        }

        // Attempt reconnection
        const attempts = reconnectAttemptRef.current + 1;
        reconnectAttemptRef.current = attempts;

        if (attempts <= 3) {
          const delay = Math.min(1000 * Math.pow(2, attempts - 1), 30000);
          dispatch({
            type: "SET_TRANSIENT_ERROR",
            error: `Connection lost. Reconnecting in ${delay / 1000}s...`,
          });
          dispatch({ type: "SET_STREAM_ACTIVITY", activity: "reconnecting" });
          reconnectTimerRef.current = setTimeout(() => {
            connectSSE(sid);
          }, delay);
        } else {
          markPendingTurnsTerminal(connectionScope);
          dispatch({ type: "FINALIZE_STREAMING" });
          dispatch({
            type: "SET_ERROR",
            error: "Connection lost after multiple retries. Please refresh.",
          });
        }
      });

    // Return cleanup function
    return () => {
      abortController.abort();
    };
  }, [markPendingTurnsTerminal, opencode, persistCompletedTurn, scopeKey]);

  function dispatchSSEEvent(evt: SSEEnvelope, sid: string, connectionScope: string): void {
    if (activeScopeRef.current !== connectionScope || activeSessionRef.current !== sid) return;

    const props = evt.properties as Record<string, unknown>;

    switch (evt.type) {
      case "session.status": {
        const status = props.status as
          | string
          | { type: string }
          | undefined;
        let st: "idle" | "busy" | null = null;
        if (typeof status === "object" && status !== null && "type" in status) {
          st =
            (status as { type: string }).type === "busy"
              ? "busy"
              : "idle";
        } else if (typeof status === "string") {
          st = status as "idle" | "busy";
        }
        dispatch({ type: "SET_STATUS", status: st });
        if (st === "busy") {
          dispatch({ type: "SET_STREAMING", value: true });
        }
        break;
      }

      case "session.idle": {
        markPendingTurnsTerminal(connectionScope);
        dispatch({ type: "SET_STATUS", status: "idle" });
        dispatch({ type: "SET_STREAM_ACTIVITY", activity: "complete" });
        dispatch({ type: "FINALIZE_STREAMING" });
        void persistCompletedTurn(sid);
        break;
      }

      case "session.error": {
        markPendingTurnsTerminal(connectionScope);
        const err = props.error as
          | { message?: string }
          | string
          | undefined;
        const msg =
          typeof err === "object" && err !== null
            ? err.message ?? "Unknown session error"
            : typeof err === "string"
              ? err
              : "Unknown session error";
        dispatch({ type: "FINALIZE_STREAMING" });
        dispatch({ type: "SET_ERROR", error: msg });
        dispatch({ type: "SET_STREAM_ACTIVITY", activity: "error" });
        break;
      }

      case "session.diff": {
        // diffs can be logged or displayed — no direct state change needed
        break;
      }

      case "message.part.delta": {
        const messageID = props.messageID as string;
        const partID = props.partID as string;
        const field = props.field as string;
        const delta = props.delta as string;
        const partType = streamPartTypesRef.current.get(partKey(messageID, partID));
        if (
          messageID &&
          partID &&
          field === "text" &&
          typeof delta === "string" &&
          partType
        ) {
          dispatch({
            type: "ACCUMULATE_DELTA",
            messageID,
            partID,
            delta,
            partType,
          });
          // field is always "text" in v1.18.9. The prior part.updated type,
          // not the delta field, determines whether this is live reasoning.
          dispatch({
            type: "SET_STREAM_ACTIVITY",
            activity: partType === "reasoning" ? "thinking" : "responding",
          });
        }
        break;
      }

      case "message.part.updated": {
        const part = props.part as Record<string, unknown>;
        if (!part || !part.id) break;
        const messageID = (part.messageID as string) ?? "";
        const sessionID = (part.sessionID as string) ?? sid;
        if (!messageID || sessionID !== sid) break;
        const partType = part.type as OpenCodePart["type"] | undefined;
        const mapKey = partKey(messageID, part.id as string);
        if (partType === "text" || partType === "reasoning") {
          streamPartTypesRef.current.set(mapKey, partType);
        } else {
          streamPartTypesRef.current.delete(mapKey);
        }
        const normalizedPart: OpenCodePart = {
          id: part.id as string,
          sessionID,
          messageID,
          type: (part.type as OpenCodePart["type"]) ?? "text",
          text: part.text as string | undefined,
          ...(part.time
            ? { time: part.time as { start?: number; end?: number } }
            : {}),
          ...(part.snapshot ? { snapshot: part.snapshot } : {}),
          ...(part.reason ? { reason: part.reason } : {}),
          ...(part.tokens !== undefined ? { tokens: part.tokens } : {}),
          ...(part.tool ? { tool: part.tool } : {}),
          ...(part.callID ? { callID: part.callID } : {}),
          ...(part.state ? { state: part.state } : {}),
        } as unknown as OpenCodePart;

        dispatch({
          type: "UPSERT_PART",
          messageID,
          part: normalizedPart,
        });

        // Track tool execution phase
        if (part.type === "tool") {
          dispatch({ type: "SET_STREAM_ACTIVITY", activity: "tool" });
        }

        // Detect question-type parts (type "ask" or with question/options properties)
        if (
          part.type === "ask" ||
          part.question !== undefined ||
          part.options !== undefined
        ) {
          const questionItem: ChatQuestionItem = {
            id: (part.id as string) || `q-${Date.now()}`,
            question:
              (part.question as string) || (part.text as string) || "",
            header: part.header as string | undefined,
            options: part.options
              ? (part.options as Array<{ label: string; description?: string }>)
              : undefined,
            multiple: part.multiple as boolean | undefined,
          };
          if (questionItem.question) {
            dispatch({ type: "ADD_QUESTION", question: questionItem });
          }
        }
        break;
      }

      case "message.updated": {
        const info = props.info as Record<string, unknown>;
        if (!info || !info.id) break;
        if (typeof info.sessionID === "string" && info.sessionID !== sid) break;
        const modelInfo =
          info.providerID && info.modelID
            ? { providerID: info.providerID as string, modelID: info.modelID as string }
            : undefined;
        const msg: ChatMessage = {
          id: info.id as string,
          role: (info.role as ChatMessage["role"]) ?? "assistant",
          content: "",
          parts: [],
          model: modelInfo,
          timestamp: info.time
            ? (info.time as { created: number }).created ?? Date.now()
            : Date.now(),
          isStreaming:
            info.completed !== true &&
            (info.time as { completed?: number } | undefined)?.completed === undefined,
        };
        if (msg.role === "assistant"
          && typeof info.parentID === "string") {
          correlatePendingUser(info.parentID, connectionScope);
        }
        dispatch({ type: "UPSERT_MESSAGE", message: msg });
        break;
      }

      case "session.question":
      case "message.question": {
        // Dedicated question SSE event — extract question data
        const qText =
          (props.question as string) ||
          (props.text as string) ||
          "";
        const qId =
          (props.id as string) ||
          (props.questionID as string) ||
          `q-${Date.now()}`;
        if (qText) {
          dispatch({
            type: "ADD_QUESTION",
            question: {
              id: qId,
              question: qText,
              options: (props.options as Array<{ label: string; description?: string }>) ?? undefined,
              multiple: props.multiple as boolean | undefined,
            },
          });
        }
        break;
      }

      case "session.updated": {
        const info = props.info as Record<string, unknown> | undefined;
        if (info) {
          dispatch({
            type: "UPDATE_SESSION_INFO",
            info: {
              cost: typeof info.cost === "number" ? info.cost : undefined,
              tokens: info.tokens as SessionInfo["tokens"],
              summary: info.summary as SessionInfo["summary"],
              shareUrl: typeof info.shareUrl === "string" ? info.shareUrl : undefined,
            },
          });
        }
        break;
      }

      default:
        // Unknown event types — silently ignored
        break;
    }
  }

  useEffect(() => {
    if (!state.isStreaming || !sessionId) {
      return undefined;
    }

    // send() opens the subscription before awaiting the prompt request so an
    // immediately-emitted provider delta cannot be missed. This effect owns
    // that connection's lifecycle and supplies the normal resume path.
    if (!sseAbortRef.current) connectSSE(sessionId);

    return () => {
      if (sseAbortRef.current) {
        sseAbortRef.current.abort();
        sseAbortRef.current = null;
      }
    };
  }, [state.isStreaming, sessionId, connectSSE]);

  useEffect(() => {
    return () => {
      if (sseAbortRef.current) {
        sseAbortRef.current.abort();
        sseAbortRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (permissionPollRef.current) {
        clearInterval(permissionPollRef.current);
        permissionPollRef.current = null;
      }
      if (questionPollRef.current) {
        clearInterval(questionPollRef.current);
        questionPollRef.current = null;
      }
    };
  }, []);

  const refreshPermissions = useCallback(async () => {
    if (!sessionId || !scopeKey) return;
    const requestScope = scopeKey;
    try {
      const all = (await opencode.permissions.list()) as unknown as Array<{
        id: string;
        permission: string;
        pattern: string;
        action: string;
      }>;
      if (activeScopeRef.current !== requestScope) return;
      // Permissions are scoped globally or by SSE stream — no sessionID field
      const relevant = all.map((p) => ({
        id: p.id,
        permission: p.permission,
        pattern: p.pattern,
        action: p.action,
      }));
      setPermissionState((prev) => ({
        scopeKey: requestScope,
        requests: relevant,
        replied: prev.scopeKey === requestScope ? prev.replied : new Set(),
      }));
    } catch {
      // Permission endpoint may not be available — silently ignore
    }
  }, [opencode, scopeKey, sessionId]);

  // Poll permissions when session is active and streaming
  useEffect(() => {
    if (sessionId && state.isStreaming) {
      // Initial fetch
      refreshPermissions();
      // Poll every 5s while streaming
      permissionPollRef.current = setInterval(refreshPermissions, 5000);
    } else if (sessionId) {
      // One fetch when session becomes idle (catch any pending requests)
      refreshPermissions();
      if (permissionPollRef.current) {
        clearInterval(permissionPollRef.current);
        permissionPollRef.current = null;
      }
    }
    return () => {
      if (permissionPollRef.current) {
        clearInterval(permissionPollRef.current);
        permissionPollRef.current = null;
      }
    };
  }, [sessionId, state.isStreaming, refreshPermissions]);

  /** Refresh pending questions via polling fallback.
   * Only adds text-only questions (from the API) — does NOT clear existing
   * questions that may have arrived via SSE with structured options. */
  const refreshQuestions = useCallback(async () => {
    if (!sessionId || !scopeKey) return;
    const requestScope = scopeKey;
    try {
      const raw = await opencode.questions.list();
      if (activeScopeRef.current !== requestScope) return;
      if (raw && raw.length > 0) {
        const items: ChatQuestionItem[] = raw.map(
          (q: { id: string; text?: string }) => ({
            id: q.id,
            question: q.text ?? "Continue?",
          }),
        );
        dispatch({ type: "ADD_QUESTIONS", questions: items });
      }
      // Don't clear on empty — SSE-delivered questions are authoritative
    } catch {
      // Questions endpoint may not be available — silently ignore
    }
  }, [opencode, scopeKey, sessionId]);

  // Poll questions when session is idle (agent may be waiting for answer)
  useEffect(() => {
    if (sessionId && !state.isStreaming) {
      // Initial fetch
      refreshQuestions();
      // Poll every 3s while idle
      questionPollRef.current = setInterval(refreshQuestions, 3000);
    }
    return () => {
      if (questionPollRef.current) {
        clearInterval(questionPollRef.current);
        questionPollRef.current = null;
      }
    };
  }, [sessionId, state.isStreaming, refreshQuestions]);

  /** Reply to a permission request. */
  const replyPermission = useCallback(
    async (requestId: string, response: "once" | "always" | "reject") => {
      if (!sessionId) return;
      const requestScope = scopeKey;
      try {
        await opencode.permissions.reply(sessionId, requestId, response);
        if (activeScopeRef.current !== requestScope) return;
        // Mark as replied
        setPermissionState((prev) => {
          const next = new Set(prev.scopeKey === requestScope ? prev.replied : []);
          next.add(requestId);
          return { ...prev, scopeKey: requestScope, replied: next };
        });
        // Refresh to remove the granted request
        await refreshPermissions();
      } catch (err: unknown) {
        if (activeScopeRef.current !== requestScope) return;
        dispatch({
          type: "SET_ERROR",
          error:
            err instanceof Error
              ? err.message
              : "Failed to reply to permission request",
        });
      }
    },
    [opencode, scopeKey, sessionId, refreshPermissions],
  );

  /** Active permissions (not yet replied). */
  const activePermissions = permissionState.scopeKey === scopeKey
    ? permissionState.requests.filter((p) => !permissionState.replied.has(p.id))
    : [];


  /** Send a message with optional model/agent/variant/system/tools overrides. */
  const send = useCallback(
    async (
      parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string; filename?: string }>,
      options?: SendOptions,
    ): Promise<boolean> => {
      if (!sessionId) {
        dispatch({
          type: "SET_ERROR",
          error: "Cannot send message — no active conversation.",
        });
        return false;
      }
      if (!scopeKey || loadedScopeKey !== scopeKey) return false;
      const sendScope = scopeKey;
      dispatch({ type: "SET_ERROR", error: null });

      // Store for retry
      lastSendPartsRef.current = parts;
      lastSendOptionsRef.current = options;

      // Build user message from parts
      const messageID = createMessageId();
      const content = parts
        .filter((p) => p.type === "text")
        .map((p) => (p as { type: "text"; text: string }).text)
        .join("\n\n");
      const userParts: OpenCodePart[] = parts.map((p, i) => {
        if (p.type === "file") {
          return {
            id: `user-part-${Date.now()}-${i}`,
            sessionID: sessionId,
            messageID,
            type: "file" as const,
            mime: p.mime,
            url: p.url,
            filename: p.filename,
          } as FilePart;
        }
        return {
          id: `user-part-${Date.now()}-${i}`,
          sessionID: sessionId,
          messageID,
          type: p.type,
          text: p.text,
        } as OpenCodePart;
      });

      const userMsg: ChatMessage = {
        id: messageID,
        role: "user",
        content,
        parts: userParts,
        timestamp: Date.now(),
        ...(options?.grounding ? { grounding: options.grounding } : {}),
      };
      pendingUserTurnsRef.current.set(messageID, {
        scopeKey: sendScope,
        messageID,
        terminal: false,
      });
      dispatch({ type: "ADD_USER_MESSAGE", message: userMsg });
      // Clear any pending questions — the user is sending a new prompt
      dispatch({ type: "REMOVE_QUESTIONS" });

      try {
        const promptBody: OpenCodePromptParams = {
          messageID,
          parts,
          model: options?.model,
          agent: options?.agent,
          system: options?.system,
          variant: options?.variant,
          tools: options?.tools,
        };
        dispatch({ type: "SET_STREAMING", value: true });
        dispatch({ type: "SET_STREAM_ACTIVITY", activity: "connecting" });
        // Subscribe before awaiting the prompt endpoint. Some providers begin
        // emitting reasoning as soon as the prompt is accepted; delaying this
        // until a render effect risks receiving only a terminal snapshot.
        connectSSE(sessionId);
        await opencode.sessions.prompt(sessionId, promptBody);
        if (activeScopeRef.current !== sendScope) return true;

        // The prompt endpoint can finish before the SSE subscription is
        // established. Reconcile its authoritative snapshot without treating
        // it as a stream terminal; only session.idle/session.error (or a
        // local stop) may close an event-backed active turn.
        try {
          const rawMessages = (await opencode.sessions.messages(
            sessionId,
          )) as unknown as OpenCodeApiMessage[];
          if (activeScopeRef.current !== sendScope) return true;
          correlateSnapshotUsers(rawMessages, sendScope);
          const normalized = normalizeMessages(rawMessages);
          dispatch({
            type: "RECONCILE_MESSAGES",
            messages: normalized,
          });
        } catch (err: unknown) {
          if (activeScopeRef.current !== sendScope) return true;
          // Reconciliation is a best-effort snapshot. An event-backed turn
          // remains authoritative until it reaches an SSE terminal state.
          const message = err instanceof Error ? err.message : "Failed to refresh messages";
          dispatch({
            type: "SET_TRANSIENT_ERROR",
            error: `${message}. Live updates continue.`,
          });
        }
        return true;
      } catch (err: unknown) {
        if (activeScopeRef.current !== sendScope) return false;
        dispatch({ type: "FINALIZE_STREAMING" });
        dispatch({ type: "SET_STREAM_ACTIVITY", activity: "error" });
        dispatch({
          type: "SET_ERROR",
          error: err instanceof Error ? err.message : "Failed to send message",
        });
        return false;
      }
    },
    [opencode, scopeKey, sessionId, loadedScopeKey, connectSSE, correlateSnapshotUsers],
  );

  /** Stop generation. */
  const stop = useCallback(async () => {
    if (!sessionId || !scopeKey) return;
    const requestScope = scopeKey;
    markPendingTurnsTerminal(requestScope);

    // Close SSE
    if (sseAbortRef.current) {
      sseAbortRef.current.abort();
      sseAbortRef.current = null;
    }
    dispatch({ type: "FINALIZE_STREAMING" });
    dispatch({ type: "SET_STREAM_ACTIVITY", activity: "stopped" });

    // Abort on server
    try {
      await opencode.sessions.abort(sessionId);
    } catch {
      // Best-effort
    }

    // Refetch finalized state
    try {
      const rawMessages = (await opencode.sessions.messages(
        sessionId,
      )) as unknown as OpenCodeApiMessage[];
      if (activeScopeRef.current !== requestScope) return;
      correlateSnapshotUsers(rawMessages, requestScope);
      dispatch({
        type: "LOAD_MESSAGES",
        messages: normalizeMessages(rawMessages),
      });
    } catch {
      // Silent
    }
  }, [correlateSnapshotUsers, markPendingTurnsTerminal, opencode, scopeKey, sessionId]);

  /** Retry the last user message. */
  const retry = useCallback(async () => {
    if (!sessionId) return;

    const lastParts = lastSendPartsRef.current;
    if (!lastParts) {
      // Fallback: find last user message content
      const lastUser = [...state.messages]
        .reverse()
        .find((m) => m.role === "user");
      if (!lastUser) return;
      const textContent = lastUser.content || "Retry";
      await send([{ type: "text", text: textContent }]);
      return;
    }

      await send(lastParts, lastSendOptionsRef.current);
  }, [sessionId, state.messages, send]);

  /** Revert to a specific message/part checkpoint. */
  const revert = useCallback(
    async (messageId: string, partId?: string) => {
      if (!sessionId || !scopeKey) return;
      const requestScope = scopeKey;
      try {
        await opencode.sessions.revert(sessionId, messageId, partId);
        // Refetch messages after revert
        const rawMessages = (await opencode.sessions.messages(
          sessionId,
        )) as unknown as OpenCodeApiMessage[];
        if (activeScopeRef.current !== requestScope) return;
        dispatch({
          type: "LOAD_MESSAGES",
          messages: normalizeMessages(rawMessages),
        });
      } catch (err: unknown) {
        if (activeScopeRef.current !== requestScope) return;
        dispatch({
          type: "SET_ERROR",
          error:
            err instanceof Error ? err.message : "Failed to revert message",
        });
      }
    },
    [opencode, scopeKey, sessionId],
  );

  /** Clear all messages locally. */
  const clear = useCallback(() => {
    dispatch({ type: "CLEAR" });
    lastSendPartsRef.current = null;
    lastSendOptionsRef.current = undefined;
  }, []);

  /** Resume — reconnect SSE after interruption. */
  const resume = useCallback(async () => {
    if (!sessionId || !scopeKey) return;
    const requestScope = scopeKey;

    // Refetch messages to get current state
    try {
      const rawMessages = (await opencode.sessions.messages(
        sessionId,
      )) as unknown as OpenCodeApiMessage[];
      if (activeScopeRef.current !== requestScope) return;
      dispatch({
        type: "LOAD_MESSAGES",
        messages: normalizeMessages(rawMessages),
      });
    } catch {
      // Silent
    }

    // Check if session seems busy (last message is assistant & incomplete)
    const lastMsg = [...state.messages].pop();
    if (lastMsg?.role === "assistant" && lastMsg.isStreaming) {
      connectSSE(sessionId);
    }
  }, [opencode, scopeKey, sessionId, state.messages, connectSSE]);

  const sessionReady = scopeKey !== null && loadedScopeKey === scopeKey;
  return {
    messages: sessionReady ? state.messages : [],
    isStreaming: sessionReady && state.isStreaming,
    isLoading: scopeKey !== null && (state.isLoading || !sessionReady),
    error: scopeKey === null || sessionReady ? state.error : null,
    sessionStatus: sessionReady ? state.sessionStatus : null,
    sessionInfo: sessionReady ? state.sessionInfo : undefined,
    questions: sessionReady ? state.questions : [],
    permissions: sessionReady ? activePermissions : [],
    replyPermission,
    streamActivity: sessionReady ? state.streamActivity : "idle",
    send,
    stop,
    retry,
    revert,
    clear,
    resume,
  };
}

/**
 * Runtime test export — the internal chatReducer is only exposed when
 * NODE_ENV === "test" so production code never depends on it.
 */
export const __test =
  process.env.NODE_ENV === "test"
    ? {
        chatReducer,
      }
    : undefined;

export type { ChatAction, ChatState };
