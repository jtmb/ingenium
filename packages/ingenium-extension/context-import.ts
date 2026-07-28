import { createHash } from "node:crypto";
import { tool, type PluginInput, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin";
import { apiRequestHeaders } from "./api-auth.js";
import { ensureExtensionProject } from "./project-resolver.js";

const API_BASE = (typeof process !== "undefined" ? process.env.INGENIUM_API_URL : undefined) ?? "http://localhost:4097/api/v1";
const DEFAULT_IMPORT_LIMIT = 100;
const MAX_IMPORT_LIMIT = 100;
export const CONTEXT_IMPORT_CHUNK_CHARS = 32_000;
export const CONTEXT_IMPORT_MAX_CHUNKS = 512;
const CONTEXT_IMPORT_TITLE_MAX_CHARS = 256;
const CONTEXT_MESSAGE_LIST_LIMIT = 100;
const CONTEXT_MESSAGE_LIST_MAX_PAGES = 100;

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
    sessionFingerprint: string;
    messageFingerprint: string;
    chunkIndex: number;
    chunkCount: number;
  };
}

export type ContextImportFailure = "authentication" | "source_unavailable" | "unavailable" | "conflict" | "invalid_response" | "bounds" | "invalid_input";

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
  return `context-import.v1.${kind}.${fingerprint(identity)}`;
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
 * Preserve the source response order while accepting only ordinary user and
 * completed-assistant text. Every generated entry is bounded and has a stable
 * key derived from source identity plus its exact chunk contents.
 */
export function buildContextImportEntries(sessionId: string, messages: unknown[]): ContextImportEntry[] {
  const entries: ContextImportEntry[] = [];
  const sessionFingerprint = fingerprint(sessionId);

  for (const candidate of messages) {
    const message = record(candidate) as OpenCodeMessageRecord | null;
    const info = message && record(message.info);
    if (!info || !Array.isArray(message?.parts)) continue;
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

    const sourceMessageId = typeof info.id === "string" ? info.id : "";
    if (!sourceMessageId) continue;
    const sourceMessageFingerprint = fingerprint(sourceMessageId);
    const chunks = splitText(text);
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      if (entries.length >= CONTEXT_IMPORT_MAX_CHUNKS) throw new ContextImportError("bounds");
      const content = chunks[chunkIndex]!;
      entries.push({
        role,
        content,
        idempotencyKey: contextIdempotencyKey(
          "message",
          `${sessionId}\u0000${sourceMessageId}\u0000${chunkIndex}\u0000${content}`,
        ),
        metadata: {
          source: "opencode-session",
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

function requestedLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_IMPORT_LIMIT;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_IMPORT_LIMIT) {
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

async function contextRequest(
  worktree: string,
  url: string,
  init: RequestInit,
  abort: AbortSignal,
): Promise<unknown> {
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
  if (!response.ok) throw new ContextImportError(failureForStatus(response.status));
  return readJson(response);
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
      metadata: { source: "opencode-session", sessionFingerprint: fingerprint(sessionId) },
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
  abort: AbortSignal,
): Promise<Set<string>> {
  const keys = new Set<string>();
  let cursor: string | undefined;
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
    if (!Array.isArray(response.data) || (response.nextCursor !== null && typeof response.nextCursor !== "string")) {
      throw new ContextImportError("invalid_response");
    }
    for (const summary of response.data) {
      const item = record(summary);
      if (typeof item?.idempotency_key === "string") keys.add(item.idempotency_key);
    }
    if (response.nextCursor === null) return keys;
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

async function sourceMessages(
  client: Pick<PluginInput["client"], "session">,
  context: ToolContext,
  limit: number,
): Promise<unknown[]> {
  try {
    const result = await client.session.messages({
      path: { id: context.sessionID },
      query: { directory: context.directory, limit },
    });
    if (!Array.isArray(result.data)) throw new ContextImportError("source_unavailable");
    return result.data;
  } catch (error) {
    if (error instanceof ContextImportError) throw error;
    throw new ContextImportError("source_unavailable");
  }
}

export function createContextImportTool(client: Pick<PluginInput["client"], "session">): ToolDefinition {
  return tool({
    description: "Import the current OpenCode session's completed user and assistant text into an immutable Ingenium Context conversation.",
    args: {
      title: tool.schema.string().trim().min(1).max(CONTEXT_IMPORT_TITLE_MAX_CHARS).optional(),
      limit: tool.schema.number().int().min(1).max(MAX_IMPORT_LIMIT).optional(),
    },
    async execute(args, context) {
      try {
        // Identity comes exclusively from ToolContext. In particular, callers
        // cannot select a session, directory, worktree, or Ingenium project.
        const limit = requestedLimit(args.limit);
        const title = requestedTitle(args.title, context.sessionID);
        const messages = await sourceMessages(client, context, limit);
        const entries = buildContextImportEntries(context.sessionID, messages);
        if (entries.length === 0) {
          return JSON.stringify({ imported: false, reason: "no_importable_messages" });
        }

        const project = await ensureExtensionProject(context.worktree, API_BASE);
        const conversation = await createConversation(context.worktree, project, title, context.sessionID, context.abort);
        const existingKeys = await importedMessageKeys(context.worktree, project, conversation.id, context.abort);
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

        return JSON.stringify({ imported: true, conversationId: conversation.id, appended, skipped });
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
