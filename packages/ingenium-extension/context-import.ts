import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { tool, type PluginInput, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin";
import { apiRequestHeaders } from "./api-auth.js";
import { ensureExtensionProject } from "./project-resolver.js";

const API_BASE = (typeof process !== "undefined" ? process.env.INGENIUM_API_URL : undefined) ?? "http://localhost:4097/api/v1";
export const CONTEXT_IMPORT_SCHEMA_VERSION = 2;
export const CONTEXT_IMPORT_CHUNK_CHARS = 32_000;
export const CONTEXT_IMPORT_MAX_ENTRIES = 16_384;
/** @deprecated Use CONTEXT_IMPORT_MAX_ENTRIES. */
export const CONTEXT_IMPORT_MAX_CHUNKS = CONTEXT_IMPORT_MAX_ENTRIES;
export const CONTEXT_IMPORT_MAX_UTF8_BYTES = 64 * 1024 * 1024;
export const CONTEXT_IMPORT_SOURCE_PAGE_SIZE = 100;
export const CONTEXT_IMPORT_MAX_SOURCE_PAGES = 128;
export const CONTEXT_IMPORT_MAX_SOURCE_ENVELOPES = CONTEXT_IMPORT_SOURCE_PAGE_SIZE * CONTEXT_IMPORT_MAX_SOURCE_PAGES;
const CONTEXT_IMPORT_TITLE_MAX_CHARS = 256;
const CONTEXT_MESSAGE_LIST_LIMIT = 100;
const CONTEXT_MESSAGE_LIST_MAX_PAGES = 256;
const CONTEXT_CURSOR_MAX_CHARS = 4_096;
const CONTEXT_IMPORT_MAX_RATE_LIMIT_RETRIES = 3;
const CONTEXT_IMPORT_MAX_RETRY_AFTER_MS = 30_000;

type ContextImportRole = "user" | "assistant";

interface OpenCodeMessageRecord {
  info: Record<string, unknown>;
  parts: unknown[];
}

interface ContextConversationResponse {
  id: string;
  revision: number;
}

interface ContextAppendResponse {
  revision: number;
  idempotent: boolean;
}

export interface ContextImportEntry {
  role: ContextImportRole;
  content: string;
  idempotencyKey: string;
  metadata: {
    source: "opencode-session";
    importerSchemaVersion: typeof CONTEXT_IMPORT_SCHEMA_VERSION;
    sessionFingerprint: string;
    messageFingerprint: string;
    chunkIndex: number;
    chunkCount: number;
  };
}

export type ContextImportFailure = "authentication" | "source_unavailable" | "source_invalid" | "unavailable" | "conflict" | "invalid_response" | "bounds" | "invalid_input";

/** Safe, content-free error classification for the native OpenCode tool. */
export class ContextImportError extends Error {
  constructor(readonly failure: ContextImportFailure) {
    super("Unable to import current session context");
    this.name = "ContextImportError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function contextIdempotencyKey(kind: "conversation" | "message", identity: string): string {
  return `context-import.v${CONTEXT_IMPORT_SCHEMA_VERSION}.${kind}.${fingerprint(identity)}`;
}

function isCompletedAssistant(info: Record<string, unknown>): boolean {
  const time = record(info.time);
  return typeof time?.completed === "number" && Number.isFinite(time.completed) && info.error === undefined;
}

function splitText(content: string): string[] {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < content.length) {
    let end = Math.min(offset + CONTEXT_IMPORT_CHUNK_CHARS, content.length);
    // Keep UTF-16 surrogate pairs intact while retaining exact text bytes.
    if (end < content.length && /[\uD800-\uDBFF]/.test(content.charAt(end - 1))) end -= 1;
    if (end <= offset) end = Math.min(offset + 1, content.length);
    chunks.push(content.slice(offset, end));
    offset = end;
  }
  return chunks;
}

/**
 * Accept only ordinary user and completed-assistant text. The source paginator
 * supplies chronological input; every generated entry is bounded and has a
 * stable key derived from source identity plus its exact chunk contents.
 */
export function buildContextImportEntries(sessionId: string, messages: unknown[]): ContextImportEntry[] {
  const entries: ContextImportEntry[] = [];
  const sessionFingerprint = fingerprint(sessionId);
  const sourceMessageIds = new Set<string>();
  let utf8Bytes = 0;

  for (const candidate of messages) {
    const message = record(candidate) as OpenCodeMessageRecord | null;
    const info = message && record(message.info);
    if (!info) continue;
    const sourceMessageId = typeof info.id === "string" ? info.id : "";
    if (sourceMessageId) {
      if (sourceMessageIds.has(sourceMessageId)) throw new ContextImportError("source_invalid");
      sourceMessageIds.add(sourceMessageId);
    }
    if (!Array.isArray(message?.parts)) continue;
    const role = info.role;
    if (role !== "user" && role !== "assistant") continue;
    if (role === "assistant" && !isCompletedAssistant(info)) continue;

    const text = message.parts
      .map(record)
      .filter((part): part is Record<string, unknown> => part !== null)
      .filter((part) => part.type === "text" && part.synthetic !== true && part.ignored !== true)
      .map((part) => typeof part.text === "string" ? part.text.trim() : "")
      .filter(Boolean)
      .join("\n\n");
    if (!text) continue;

    if (!sourceMessageId) continue;
    const sourceMessageFingerprint = fingerprint(sourceMessageId);
    const chunks = splitText(text);
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      if (entries.length >= CONTEXT_IMPORT_MAX_ENTRIES) throw new ContextImportError("bounds");
      const content = chunks[chunkIndex]!;
      const contentBytes = Buffer.byteLength(content, "utf8");
      if (contentBytes > CONTEXT_IMPORT_MAX_UTF8_BYTES - utf8Bytes) throw new ContextImportError("bounds");
      utf8Bytes += contentBytes;
      entries.push({
        role,
        content,
        idempotencyKey: contextIdempotencyKey(
          "message",
          `${sessionId}\u0000${sourceMessageId}\u0000${chunkIndex}\u0000${content}`,
        ),
        metadata: {
          source: "opencode-session",
          importerSchemaVersion: CONTEXT_IMPORT_SCHEMA_VERSION,
          sessionFingerprint,
          messageFingerprint: sourceMessageFingerprint,
          chunkIndex,
          chunkCount: chunks.length,
        },
      });
    }
  }
  return entries;
}

function requestedMaxSourceEnvelopes(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 1
    || value > CONTEXT_IMPORT_MAX_SOURCE_ENVELOPES
  ) {
    throw new ContextImportError("invalid_input");
  }
  return value;
}

function requestedTitle(value: unknown, sessionId: string): string {
  if (value !== undefined && (typeof value !== "string" || value.trim().length === 0 || value.trim().length > CONTEXT_IMPORT_TITLE_MAX_CHARS)) {
    throw new ContextImportError("invalid_input");
  }
  if (typeof value === "string") return value.trim();
  const title = `OpenCode session ${sessionId}`;
  return title.length <= CONTEXT_IMPORT_TITLE_MAX_CHARS
    ? title
    : `OpenCode session ${fingerprint(sessionId).slice(0, 24)}`;
}

function contextUrl(path: string, project: string, options: { cursor?: string; limit?: number } = {}): string {
  const params = new URLSearchParams({ project });
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  return `${API_BASE.replace(/\/+$/, "")}/context/${path}?${params}`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ContextImportError("invalid_response");
  }
}

function failureForStatus(status: number): ContextImportFailure {
  if (status === 401 || status === 403) return "authentication";
  if (status === 409) return "conflict";
  return "unavailable";
}

function responseStatus(response: unknown): number | undefined {
  const status = record(response)?.status;
  return typeof status === "number" && Number.isInteger(status) ? status : undefined;
}

function responseHeader(response: unknown, name: string): string | null | undefined {
  const headers = record(response)?.headers;
  if (headers === null || (typeof headers !== "object" && typeof headers !== "function")) return undefined;
  const getter = (headers as { get?: unknown }).get;
  if (typeof getter !== "function") return undefined;
  try {
    const value = getter.call(headers, name);
    return value === null || typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function retryAfterMilliseconds(response: unknown): number | null {
  const value = responseHeader(response, "Retry-After");
  if (typeof value !== "string" || value.length === 0) return null;

  let delayMs: number;
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    if (!Number.isSafeInteger(seconds)) return null;
    delayMs = seconds * 1_000;
  } else {
    const retryAt = Date.parse(value);
    if (!Number.isFinite(retryAt)) return null;
    delayMs = Math.max(0, retryAt - Date.now());
  }
  return Number.isFinite(delayMs) ? Math.min(delayMs, CONTEXT_IMPORT_MAX_RETRY_AFTER_MS) : null;
}

function waitForRetryAfter(delayMs: number, abort: AbortSignal): Promise<void> {
  if (abort.aborted) return Promise.reject(new ContextImportError("unavailable"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      abort.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ContextImportError("unavailable"));
    };
    abort.addEventListener("abort", onAbort, { once: true });
  });
}

async function retryRateLimitedResponse(response: unknown, abort: AbortSignal): Promise<boolean> {
  const delayMs = retryAfterMilliseconds(response);
  if (delayMs === null) return false;
  await waitForRetryAfter(delayMs, abort);
  return true;
}

async function contextRequest(
  worktree: string,
  url: string,
  init: RequestInit,
  abort: AbortSignal,
): Promise<unknown> {
  for (let attempt = 0; attempt <= CONTEXT_IMPORT_MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: apiRequestHeaders(worktree, init.headers),
        signal: abort,
      });
    } catch {
      throw new ContextImportError("unavailable");
    }
    if (response.status === 429) {
      if (
        attempt < CONTEXT_IMPORT_MAX_RATE_LIMIT_RETRIES
        && await retryRateLimitedResponse(response, abort)
      ) {
        continue;
      }
      throw new ContextImportError("unavailable");
    }
    if (!response.ok) throw new ContextImportError(failureForStatus(response.status));
    return readJson(response);
  }
  throw new ContextImportError("unavailable");
}

function dataFrom(value: unknown): Record<string, unknown> {
  const response = record(value);
  const data = response && record(response.data);
  if (!data) throw new ContextImportError("invalid_response");
  return data;
}

async function createConversation(
  worktree: string,
  project: string,
  title: string,
  sessionId: string,
  abort: AbortSignal,
): Promise<ContextConversationResponse> {
  const idempotencyKey = contextIdempotencyKey("conversation", sessionId);
  const response = dataFrom(await contextRequest(worktree, contextUrl("conversations", project), {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      title,
      tags: ["opencode", "session-import"],
      metadata: {
        source: "opencode-session",
        importerSchemaVersion: CONTEXT_IMPORT_SCHEMA_VERSION,
        sessionFingerprint: fingerprint(sessionId),
      },
      idempotencyKey,
    }),
  }, abort));
  if (typeof response.id !== "string" || typeof response.revision !== "number" || !Number.isSafeInteger(response.revision) || response.revision < 0) {
    throw new ContextImportError("invalid_response");
  }
  return { id: response.id, revision: response.revision };
}

async function importedMessageKeys(
  worktree: string,
  project: string,
  conversationId: string,
  entries: ContextImportEntry[],
  abort: AbortSignal,
): Promise<Set<string>> {
  const keys = new Set<string>();
  // Public Context message lists intentionally omit idempotency keys. Match the
  // content-free summary projection that remains: role, content hash, and
  // persisted metadata. This lets retries skip a previously written import
  // entry before its expected revision can become stale.
  const entryKeyBySummary = new Map(
    entries.map((entry) => [
      `${entry.role}\u0000${fingerprint(entry.content)}\u0000${JSON.stringify(entry.metadata)}`,
      entry.idempotencyKey,
    ]),
  );
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  for (let page = 0; page < CONTEXT_MESSAGE_LIST_MAX_PAGES; page += 1) {
    const response = dataFrom(await contextRequest(
      worktree,
      contextUrl(`conversations/${encodeURIComponent(conversationId)}/messages`, project, {
        cursor,
        limit: CONTEXT_MESSAGE_LIST_LIMIT,
      }),
      { method: "GET" },
      abort,
    ));
    if (
      !Array.isArray(response.data)
      || response.data.length > CONTEXT_MESSAGE_LIST_LIMIT
      || (response.nextCursor !== null && typeof response.nextCursor !== "string")
    ) {
      throw new ContextImportError("invalid_response");
    }
    for (const summary of response.data) {
      const item = record(summary);
      if (typeof item?.idempotency_key === "string") keys.add(item.idempotency_key);
      if ((item?.role === "user" || item?.role === "assistant")
        && typeof item.content_hash === "string" && typeof item.metadata === "string") {
        const matchingKey = entryKeyBySummary.get(
          `${item.role}\u0000${item.content_hash}\u0000${item.metadata}`,
        );
        if (matchingKey) keys.add(matchingKey);
      }
    }
    if (response.nextCursor === null) return keys;
    if (
      response.nextCursor.length === 0
      || response.nextCursor.length > CONTEXT_CURSOR_MAX_CHARS
      || seenCursors.has(response.nextCursor)
    ) {
      throw new ContextImportError("invalid_response");
    }
    seenCursors.add(response.nextCursor);
    cursor = response.nextCursor;
  }
  throw new ContextImportError("bounds");
}

async function appendEntry(
  worktree: string,
  project: string,
  conversationId: string,
  entry: ContextImportEntry,
  expectedRevision: number,
  abort: AbortSignal,
): Promise<ContextAppendResponse> {
  const response = dataFrom(await contextRequest(
    worktree,
    contextUrl(`conversations/${encodeURIComponent(conversationId)}/messages`, project),
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": entry.idempotencyKey },
      body: JSON.stringify({
        role: entry.role,
        content: entry.content,
        tags: ["opencode", "session-import"],
        metadata: entry.metadata,
        expectedRevision,
        idempotencyKey: entry.idempotencyKey,
      }),
    },
    abort,
  ));
  if (typeof response.revision !== "number" || !Number.isSafeInteger(response.revision) || response.revision < 0 || typeof response.idempotent !== "boolean") {
    throw new ContextImportError("invalid_response");
  }
  return { revision: response.revision, idempotent: response.idempotent };
}

function sourceResponse(result: unknown): unknown {
  const resultRecord = record(result);
  return resultRecord && "response" in resultRecord ? resultRecord.response : undefined;
}

function sourcePageData(result: unknown): unknown[] {
  const resultRecord = record(result);
  if (!resultRecord || !("data" in resultRecord)) throw new ContextImportError("source_unavailable");
  if (!Array.isArray(resultRecord.data)) throw new ContextImportError("source_invalid");
  if (resultRecord.data.length > CONTEXT_IMPORT_SOURCE_PAGE_SIZE) throw new ContextImportError("source_invalid");
  return resultRecord.data;
}

function sourcePageCursor(result: unknown): string | null {
  const response = sourceResponse(result);
  // The plugin SDK includes the native response. The absence of a mocked
  // response means a one-page source, preserving unit-test client ergonomics.
  if (response === undefined) return null;
  const cursor = responseHeader(response, "X-Next-Cursor");
  if (cursor === undefined) throw new ContextImportError("source_invalid");
  if (cursor === null) return null;
  if (cursor.length === 0 || cursor.length > CONTEXT_CURSOR_MAX_CHARS) {
    throw new ContextImportError("source_invalid");
  }
  return cursor;
}

function sourceTimestamp(candidate: unknown): number | null {
  const message = record(candidate);
  const info = message && record(message.info);
  const time = info && record(info.time);
  return typeof time?.created === "number" && Number.isFinite(time.created) ? time.created : null;
}

function chronologicalSourceMessages(messages: unknown[]): unknown[] {
  return messages
    .map((message, index) => ({ message, index, created: sourceTimestamp(message) }))
    .sort((left, right) => {
      if (left.created !== null && right.created !== null && left.created !== right.created) {
        return left.created - right.created;
      }
      if (left.created !== null && right.created === null) return -1;
      if (left.created === null && right.created !== null) return 1;
      return left.index - right.index;
    })
    .map(({ message }) => message);
}

async function sourcePage(
  client: Pick<PluginInput["client"], "session">,
  context: ToolContext,
  cursor: string | undefined,
): Promise<unknown> {
  const query = cursor === undefined
    ? { directory: context.directory, limit: CONTEXT_IMPORT_SOURCE_PAGE_SIZE }
    : { directory: context.directory, limit: CONTEXT_IMPORT_SOURCE_PAGE_SIZE, cursor };

  for (let attempt = 0; attempt <= CONTEXT_IMPORT_MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      const result = await client.session.messages({
        path: { id: context.sessionID },
        query,
      });
      const response = sourceResponse(result);
      if (responseStatus(response) !== 429) return result;
      if (
        attempt < CONTEXT_IMPORT_MAX_RATE_LIMIT_RETRIES
        && await retryRateLimitedResponse(response, context.abort)
      ) {
        continue;
      }
    } catch (error) {
      const response = sourceResponse(error);
      if (
        responseStatus(response) === 429
        && attempt < CONTEXT_IMPORT_MAX_RATE_LIMIT_RETRIES
        && await retryRateLimitedResponse(response, context.abort)
      ) {
        continue;
      }
      if (error instanceof ContextImportError) throw error;
    }
    throw new ContextImportError("source_unavailable");
  }
  throw new ContextImportError("source_unavailable");
}

async function sourceMessages(
  client: Pick<PluginInput["client"], "session">,
  context: ToolContext,
  maxSourceEnvelopes: number | undefined,
): Promise<unknown[]> {
  const messages: unknown[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < CONTEXT_IMPORT_MAX_SOURCE_PAGES; page += 1) {
    const result = await sourcePage(client, context, cursor);
    const sourcePageMessages = sourcePageData(result);
    const remaining = maxSourceEnvelopes === undefined
      ? sourcePageMessages.length
      : Math.min(sourcePageMessages.length, maxSourceEnvelopes - messages.length);
    if (messages.length + remaining > CONTEXT_IMPORT_MAX_SOURCE_ENVELOPES) {
      throw new ContextImportError("bounds");
    }
    messages.push(...sourcePageMessages.slice(0, remaining));
    if (maxSourceEnvelopes !== undefined && messages.length === maxSourceEnvelopes) {
      return chronologicalSourceMessages(messages);
    }

    const nextCursor = sourcePageCursor(result);
    if (nextCursor === null) return chronologicalSourceMessages(messages);
    if (seenCursors.has(nextCursor)) throw new ContextImportError("source_invalid");
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  throw new ContextImportError("bounds");
}

export function createContextImportTool(client: Pick<PluginInput["client"], "session">): ToolDefinition {
  return tool({
    description: "Import the current OpenCode session's completed user and assistant text into an immutable Ingenium Context conversation.",
    args: {
      title: tool.schema.string().trim().min(1).max(CONTEXT_IMPORT_TITLE_MAX_CHARS).optional(),
      maxSourceEnvelopes: tool.schema.number().int().min(1).max(CONTEXT_IMPORT_MAX_SOURCE_ENVELOPES).optional(),
    },
    async execute(args, context) {
      try {
        // Identity comes exclusively from ToolContext. In particular, callers
        // cannot select a session, directory, worktree, or Ingenium project.
        const maxSourceEnvelopes = requestedMaxSourceEnvelopes(args.maxSourceEnvelopes);
        const title = requestedTitle(args.title, context.sessionID);
        const messages = await sourceMessages(client, context, maxSourceEnvelopes);
        const entries = buildContextImportEntries(context.sessionID, messages);
        if (entries.length === 0) {
          return JSON.stringify({ imported: false, reason: "no_importable_messages" });
        }

        const project = await ensureExtensionProject(context.worktree, API_BASE);
        const conversation = await createConversation(context.worktree, project, title, context.sessionID, context.abort);
        const existingKeys = await importedMessageKeys(context.worktree, project, conversation.id, entries, context.abort);
        let revision = conversation.revision;
        let appended = 0;
        let skipped = 0;

        for (const entry of entries) {
          if (existingKeys.has(entry.idempotencyKey)) {
            skipped += 1;
            continue;
          }
          const result = await appendEntry(
            context.worktree,
            project,
            conversation.id,
            entry,
            revision,
            context.abort,
          );
          revision = result.revision;
          existingKeys.add(entry.idempotencyKey);
          if (result.idempotent) skipped += 1;
          else appended += 1;
        }

        return JSON.stringify({
          imported: true,
          conversationId: conversation.id,
          appended,
          skipped,
          sourceEnvelopes: messages.length,
          sourceBounded: maxSourceEnvelopes !== undefined,
        });
      } catch (error) {
        const reason = error instanceof ContextImportError
          ? error.failure
          : "unavailable";
        // Do not log caught errors: upstream diagnostics may contain a token,
        // message body, or absolute filesystem path.
        return JSON.stringify({ imported: false, error: "context_import_failed", reason });
      }
    },
  });
}

export interface ContextImportPluginHooks {
  tool: {
    ingenium_context_import_current_session: ToolDefinition;
  };
}

/** Standalone export for consumers that load an extension plugin module directly. */
export const ContextImportPlugin = async (ctx: Pick<PluginInput, "client">): Promise<ContextImportPluginHooks> => ({
  tool: {
    ingenium_context_import_current_session: createContextImportTool(ctx.client),
  },
});
