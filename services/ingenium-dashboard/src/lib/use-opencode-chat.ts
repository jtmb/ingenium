"use client";

import { useReducer, useEffect, useCallback, useRef, useState } from "react";
import { opencode, type OpenCodePart, type FilePart, type OpenCodePromptParams } from "./opencode";
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
}

/* ------------------------------------------------------------------ */
/*  State & types                                                     */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;  // text only — no reasoning mixed in
  parts: OpenCodePart[];
  reasoning?: string;  // separate reasoning content from thinking parts
  model?: { providerID: string; modelID: string };  // from message.updated info
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

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  isLoading: boolean;
  error: string | null;
  sessionStatus: "idle" | "busy" | null;
  sessionInfo?: SessionInfo;
  questions: ChatQuestionItem[];
}

/* ------------------------------------------------------------------ */
/*  Permission types                                                  */
/* ------------------------------------------------------------------ */

/** A pending permission request from the OpenCode API. */
export interface PermissionRequest {
  id: string;
  permission: string;
  pattern: string;
  action: string;
}

/** Permission polling result stored alongside chat state. */
interface PermissionState {
  requests: PermissionRequest[];
  replied: Set<string>;
}

/* ------------------------------------------------------------------ */
/*  Reducer actions                                                   */
/* ------------------------------------------------------------------ */

type ChatAction =
  | { type: "LOAD_MESSAGES"; messages: ChatMessage[] }
  | { type: "ADD_USER_MESSAGE"; message: ChatMessage }
  | { type: "ACCUMULATE_DELTA"; messageID: string; partID: string; delta: string; partType?: string }
  | { type: "UPSERT_PART"; messageID: string; part: OpenCodePart }
  | { type: "UPSERT_MESSAGE"; message: ChatMessage }
  | { type: "SET_STREAMING"; value: boolean }
  | { type: "SET_LOADING"; value: boolean }
  | { type: "SET_STATUS"; status: "idle" | "busy" | null }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "UPDATE_SESSION_INFO"; info: SessionInfo }
  | { type: "ADD_QUESTION"; question: ChatQuestionItem }
  | { type: "ADD_QUESTIONS"; questions: ChatQuestionItem[] }
  | { type: "REMOVE_QUESTIONS" }
  | { type: "REMOVE_LAST_USER" }
  | { type: "CLEAR" };

/* ------------------------------------------------------------------ */
/*  Reducer                                                           */
/* ------------------------------------------------------------------ */

/** Build a stable key for accumulator lookups. */
function partKey(messageID: string, partID: string): string {
  return `${messageID}::${partID}`;
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

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "LOAD_MESSAGES":
      return { ...state, messages: action.messages, isLoading: false, error: null };

    case "ADD_USER_MESSAGE": {
      return {
        ...state,
        messages: [...state.messages, action.message],
        error: null,
      };
    }

    case "ACCUMULATE_DELTA": {
      const msgs = [...state.messages];
      let target = msgs.find((m) => m.id === action.messageID);

      if (!target) {
        // Create placeholder assistant message
        target = {
          id: action.messageID,
          role: "assistant" as const,
          content: "",
          parts: [],
          timestamp: Date.now(),
          isStreaming: true,
        };
        msgs.push(target);
      }

      const key = partKey(action.messageID, action.partID);
      const existingIdx = target.parts.findIndex(
        (p) => "id" in p && p.id === action.partID,
      );

      if (existingIdx >= 0) {
        const part = target.parts[existingIdx]!;
        if (
          (part.type === "text" || part.type === "reasoning") &&
          "text" in part
        ) {
          const newParts = [...target.parts];
          newParts[existingIdx] = {
            ...part,
            text: (part as { text: string }).text + action.delta,
          } as OpenCodePart;
          const newTarget = {
            ...target,
            parts: newParts,
            content: buildContent(newParts),
            reasoning: extractReasoning(newParts),
            isStreaming: true,
          };
          msgs[msgs.indexOf(target)] = newTarget;
        }
      } else {
        // Create new part with correct type derived from the SSE field
        const partType = action.partType === "reasoning" ? "reasoning" : "text";
        const newPart: OpenCodePart = {
          id: action.partID,
          type: partType as OpenCodePart["type"],
          text: action.delta,
          time: { created: new Date().toISOString() },
        } as unknown as OpenCodePart;
        const newParts = [...target.parts, newPart];
        msgs[msgs.indexOf(target)] = {
          ...target,
          parts: newParts,
          content: buildContent(newParts),
          reasoning: extractReasoning(newParts),
          isStreaming: true,
        };
      }
      return { ...state, messages: msgs };
    }

    case "UPSERT_PART": {
      const msgs = [...state.messages];
      let target = msgs.find((m) => m.id === action.messageID);

      if (!target) {
        target = {
          id: action.messageID,
          role: "assistant" as const,
          content: "",
          parts: [],
          timestamp: Date.now(),
          isStreaming: true,
        };
        msgs.push(target);
      }

      const idx = target.parts.findIndex(
        (p) => "id" in p && p.id === action.part.id,
      );
      const newParts = [...target.parts];
      if (idx >= 0) {
        newParts[idx] = action.part;
      } else {
        newParts.push(action.part);
      }

      msgs[msgs.indexOf(target)] = {
        ...target,
        parts: newParts,
        content: buildContent(newParts),
        reasoning: extractReasoning(newParts),
      };
      return { ...state, messages: msgs };
    }

    case "UPSERT_MESSAGE": {
      const msgs = [...state.messages];
      const idx = msgs.findIndex((m) => m.id === action.message.id);
      if (idx >= 0) {
        msgs[idx] = action.message;
      } else {
        msgs.push(action.message);
      }
      return { ...state, messages: msgs };
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

    case "SET_ERROR":
      return { ...state, error: action.error, isStreaming: false, isLoading: false };

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
      };

    default:
      return state;
  }
}

/* ------------------------------------------------------------------ */
/*  SSE event types (verified v1.18.3 contract)                       */
/* ------------------------------------------------------------------ */

interface SSEEnvelope {
  id?: string;
  type: string;
  properties: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  ChatMessage normalization helpers                                 */
/* ------------------------------------------------------------------ */

function normalizeMessage(raw: OpenCodeApiMessage): ChatMessage {
  // Convert OpenCode parts to our part format
  const parts: OpenCodePart[] = raw.parts.map((p) => ({
    id: p.id,
    sessionID: p.sessionID,
    messageID: p.messageID,
    type: p.type as OpenCodePart["type"],
    text: p.text,
    ...(p.time?.start ? { time: { start: p.time.start, end: p.time.end } } : {}),
    ...(p.snapshot ? { snapshot: p.snapshot } : {}),
    ...(p.reason ? { reason: p.reason } : {}),
    ...(p.tokens !== undefined ? { tokens: p.tokens } : {}),
    ...(p.cost !== undefined ? { cost: p.cost } : {}),
  })) as unknown as OpenCodePart[];

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
  };
}

function normalizeMessages(rawMessages: OpenCodeApiMessage[]): ChatMessage[] {
  return rawMessages.map(normalizeMessage);
}

/* ------------------------------------------------------------------ */
/*  SSE connection state machine (fetch + ReadableStream)             */
/* ------------------------------------------------------------------ */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4097/api/v1";

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

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

/**
 * React hook managing chat state with SSE streaming via fetch + ReadableStream.
 *
 * - Loads historical messages on sessionId change
 * - Opens SSE stream for real-time events after sending a prompt
 * - Parses v1.18.3 contract events: message.part.delta, message.part.updated,
 *   message.updated, session.status, session.idle, session.diff, session.error
 * - Idempotent reducer using messageID + partID as stable keys
 * - Exponential backoff reconnection (1s, 2s, 4s, max 30s, 3 attempts)
 * - AbortController for cancellation on unmount
 */
export function useOpenCodeChat(sessionId: string | null) {
  const [state, dispatch] = useReducer(chatReducer, {
    messages: [],
    isStreaming: false,
    isLoading: false,
    error: null,
    sessionStatus: null,
    questions: [],
  });

  /* ---- Refs for SSE lifecycle ---- */
  const sseAbortRef = useRef<AbortController | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const parserRef = useRef<SSEParser>(new SSEParser());
  const activeSessionRef = useRef<string | null>(null);
  // Store last send parts for retry
  const lastSendPartsRef = useRef<Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string; filename?: string }> | null>(
    null,
  );
  // Store last send options for retry
  const lastSendOptionsRef = useRef<SendOptions | undefined>(undefined);

  /* ---- Question polling state ---- */
  const questionPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ---- Permission state ---- */
  const [permissionState, setPermissionState] = useState<PermissionState>({
    requests: [],
    replied: new Set(),
  });
  const permissionPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ---- Load messages on sessionId change ---- */
  useEffect(() => {
    // Track the active session for SSE filter
    activeSessionRef.current = sessionId;

    if (!sessionId) {
      dispatch({ type: "CLEAR" });
      return;
    }

    let cancelled = false;
    dispatch({ type: "SET_LOADING", value: true });

    (async () => {
      try {
        const rawMessages = (await opencode.sessions.messages(
          sessionId,
        )) as unknown as OpenCodeApiMessage[];
        if (!cancelled) {
          dispatch({
            type: "LOAD_MESSAGES",
            messages: normalizeMessages(rawMessages),
          });
        }
      } catch (err: unknown) {
        if (!cancelled) {
          dispatch({
            type: "SET_ERROR",
            error: err instanceof Error ? err.message : "Failed to load messages",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  /* ---- SSE connect with fetch + ReadableStream ---- */
  const connectSSE = useCallback((sid: string) => {
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

    const streamUrl = `${API_URL}/opencode/sessions/${encodeURIComponent(sid)}/events`;
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

        async function readStream(): Promise<void> {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const events = parser.append(chunk);

            for (const evt of events) {
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

              dispatchSSEEvent(evt, sid);
            }
          }
        }

        await readStream();
      })
      .catch((err: unknown) => {
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
            type: "SET_ERROR",
            error: `Connection lost. Reconnecting in ${delay / 1000}s...`,
          });
          reconnectTimerRef.current = setTimeout(() => {
            connectSSE(sid);
          }, delay);
        } else {
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
  }, []);

  /* ---- Dispatch SSE events to reducer ---- */
  function dispatchSSEEvent(evt: SSEEnvelope, sid: string): void {
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
        dispatch({ type: "SET_STATUS", status: "idle" });
        dispatch({ type: "SET_STREAMING", value: false });
        // Mark all streaming messages as complete
        break;
      }

      case "session.error": {
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
        dispatch({ type: "SET_ERROR", error: msg });
        dispatch({ type: "SET_STREAMING", value: false });
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
        if (messageID && partID && (field === "text" || field === "reasoning") && delta !== undefined) {
          dispatch({
            type: "ACCUMULATE_DELTA",
            messageID,
            partID,
            delta,
            partType: field,
          });
        }
        break;
      }

      case "message.part.updated": {
        const part = props.part as Record<string, unknown>;
        if (!part || !part.id) break;
        const messageID = (part.messageID as string) ?? "";
        const sessionID = (part.sessionID as string) ?? sid;
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
        } as unknown as OpenCodePart;

        dispatch({
          type: "UPSERT_PART",
          messageID,
          part: normalizedPart,
        });

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
          isStreaming: !info.completed,
        };
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

  /* ---- Connect SSE when streaming starts ---- */
  useEffect(() => {
    if (state.isStreaming && sessionId) {
      const cleanup = connectSSE(sessionId);
      return () => {
        cleanup?.();
      };
    }
    return undefined;
  }, [state.isStreaming, sessionId, connectSSE]);

  /* ---- Cleanup on unmount ---- */
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

  /* ---- Permission polling ---- */
  const refreshPermissions = useCallback(async () => {
    if (!sessionId) return;
    try {
      const all = (await opencode.permissions.list()) as unknown as Array<{
        id: string;
        permission: string;
        pattern: string;
        action: string;
      }>;
      // Permissions are scoped globally or by SSE stream — no sessionID field
      const relevant = all.map((p) => ({
        id: p.id,
        permission: p.permission,
        pattern: p.pattern,
        action: p.action,
      }));
      setPermissionState((prev) => ({
        requests: relevant,
        replied: prev.replied,
      }));
    } catch {
      // Permission endpoint may not be available — silently ignore
    }
  }, [sessionId]);

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
    if (!sessionId) return;
    try {
      const raw = await opencode.questions.list();
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
  }, [sessionId]);

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
      try {
        await opencode.permissions.reply(sessionId, requestId, response);
        // Mark as replied
        setPermissionState((prev) => {
          const next = new Set(prev.replied);
          next.add(requestId);
          return { ...prev, replied: next };
        });
        // Refresh to remove the granted request
        await refreshPermissions();
      } catch (err: unknown) {
        dispatch({
          type: "SET_ERROR",
          error:
            err instanceof Error
              ? err.message
              : "Failed to reply to permission request",
        });
      }
    },
    [sessionId, refreshPermissions],
  );

  /** Active permissions (not yet replied). */
  const activePermissions = permissionState.requests.filter(
    (p) => !permissionState.replied.has(p.id),
  );

  /* ---- Actions ---- */

  /** Send a message with optional model/agent/variant/system/tools overrides. */
  const send = useCallback(
    async (
      parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string; filename?: string }>,
      options?: { model?: { providerID: string; modelID: string }; agent?: string; variant?: string; system?: string; tools?: Record<string, boolean> },
    ) => {
      if (!sessionId) return;
      dispatch({ type: "SET_ERROR", error: null });

      // Store for retry
      lastSendPartsRef.current = parts;
      lastSendOptionsRef.current = options;

      // Build user message from parts
      const content = parts
        .filter((p) => p.type === "text")
        .map((p) => (p as { type: "text"; text: string }).text)
        .join("\n\n");
      const userParts: OpenCodePart[] = parts.map((p, i) => {
        if (p.type === "file") {
          return {
            id: `user-part-${Date.now()}-${i}`,
            sessionID: sessionId,
            messageID: `user-${Date.now()}`,
            type: "file" as const,
            mime: p.mime,
            url: p.url,
            filename: p.filename,
          } as FilePart;
        }
        return {
          id: `user-part-${Date.now()}-${i}`,
          sessionID: sessionId,
          messageID: `user-${Date.now()}`,
          type: p.type,
          text: p.text,
        } as OpenCodePart;
      });

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content,
        parts: userParts,
        timestamp: Date.now(),
      };
      dispatch({ type: "ADD_USER_MESSAGE", message: userMsg });
      // Clear any pending questions — the user is sending a new prompt
      dispatch({ type: "REMOVE_QUESTIONS" });

      try {
        const promptBody: OpenCodePromptParams = {
          parts,
          model: options?.model,
          agent: options?.agent,
          system: options?.system,
          variant: options?.variant,
          tools: options?.tools,
        };
        dispatch({ type: "SET_STREAMING", value: true });
        await opencode.sessions.prompt(sessionId, promptBody);

        // The prompt endpoint can finish before the SSE subscription is established.
        // Reconcile with the authoritative session state so completed replies are shown.
        const rawMessages = (await opencode.sessions.messages(
          sessionId,
        )) as unknown as OpenCodeApiMessage[];
        dispatch({
          type: "LOAD_MESSAGES",
          messages: normalizeMessages(rawMessages),
        });
        dispatch({ type: "SET_STREAMING", value: false });
      } catch (err: unknown) {
        dispatch({ type: "REMOVE_LAST_USER" });
        dispatch({ type: "SET_STREAMING", value: false });
        dispatch({
          type: "SET_ERROR",
          error: err instanceof Error ? err.message : "Failed to send message",
        });
      }
    },
    [sessionId],
  );

  /** Stop generation. */
  const stop = useCallback(async () => {
    if (!sessionId) return;

    // Close SSE
    if (sseAbortRef.current) {
      sseAbortRef.current.abort();
      sseAbortRef.current = null;
    }
    dispatch({ type: "SET_STREAMING", value: false });

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
      dispatch({
        type: "LOAD_MESSAGES",
        messages: normalizeMessages(rawMessages),
      });
    } catch {
      // Silent
    }
  }, [sessionId]);

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
      if (!sessionId) return;
      try {
        await opencode.sessions.revert(sessionId, messageId, partId);
        // Refetch messages after revert
        const rawMessages = (await opencode.sessions.messages(
          sessionId,
        )) as unknown as OpenCodeApiMessage[];
        dispatch({
          type: "LOAD_MESSAGES",
          messages: normalizeMessages(rawMessages),
        });
      } catch (err: unknown) {
        dispatch({
          type: "SET_ERROR",
          error:
            err instanceof Error ? err.message : "Failed to revert message",
        });
      }
    },
    [sessionId],
  );

  /** Clear all messages locally. */
  const clear = useCallback(() => {
    dispatch({ type: "CLEAR" });
    lastSendPartsRef.current = null;
    lastSendOptionsRef.current = undefined;
  }, []);

  /** Resume — reconnect SSE after interruption. */
  const resume = useCallback(async () => {
    if (!sessionId) return;

    // Refetch messages to get current state
    try {
      const rawMessages = (await opencode.sessions.messages(
        sessionId,
      )) as unknown as OpenCodeApiMessage[];
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
  }, [sessionId, state.messages, connectSSE]);

  return {
    messages: state.messages,
    isStreaming: state.isStreaming,
    isLoading: state.isLoading,
    error: state.error,
    sessionStatus: state.sessionStatus,
    sessionInfo: state.sessionInfo,
    questions: state.questions,
    permissions: activePermissions,
    replyPermission,
    send,
    stop,
    retry,
    revert,
    clear,
    resume,
  };
}
