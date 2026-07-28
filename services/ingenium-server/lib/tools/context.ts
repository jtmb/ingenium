/**
 * MCP tool handlers for persistent context storage.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Supports saving context entries with tags/priority and full-text search.
 */
import { api } from "../client.js";
import { z } from "zod";

const OPEN_CODE_SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

/**
 * OpenCode session IDs are opaque API-owned identifiers. Restrict the transport
 * boundary to the API's safe identifier grammar before forwarding a request.
 */
export function isSafeOpenCodeSessionImportSessionId(value: unknown): value is string {
  return typeof value === "string" && OPEN_CODE_SESSION_ID_PATTERN.test(value);
}

/**
 * Accept only explicit absolute paths without control characters or dot-segment
 * aliases. The API performs its own project-basename ownership verification.
 */
export function isSafeOpenCodeSessionImportDirectory(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_024
    || CONTROL_CHARACTER_PATTERN.test(value)) return false;

  const normalized = value.replace(/\\/g, "/");
  if (!normalized.startsWith("/") && !/^[A-Za-z]:\//.test(normalized)) return false;
  return !normalized.split("/").some((segment) => segment === "." || segment === "..");
}

/** The import tool is available only to the OpenCode session launched for this project. */
export function isAuthoritativeOpenCodeSessionImportProject(
  requestedProject: unknown,
  authoritativeProject: string | null,
): requestedProject is string {
  return authoritativeProject !== null && requestedProject === authoritativeProject;
}

/**
 * The transport schema intentionally binds the import to the launcher project.
 * This prevents one MCP session from importing another project's OpenCode data.
 */
export function createOpenCodeSessionImportInputSchema(authoritativeProject: string | null) {
  return z.object({
    project: z.string().min(1).max(64).refine(
      (value) => isAuthoritativeOpenCodeSessionImportProject(value, authoritativeProject),
      "The requested project is not authorized for this session import.",
    ),
    sessionId: z.string().refine(
      isSafeOpenCodeSessionImportSessionId,
      "A safe OpenCode session ID is required.",
    ),
    directory: z.string().refine(
      isSafeOpenCodeSessionImportDirectory,
      "A safe absolute OpenCode directory is required.",
    ),
    title: z.string().trim().min(1).max(256).optional(),
    limit: z.number().int().min(1).max(100),
  });
}

/** Save a context entry with optional tags and priority. */
export async function planSave(project: string, content: string, tags?: string, priority?: number) {
  const res = await api.post("/context", { content, tags, priority }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Full-text search across context entries. */
export async function planSearch(project: string, query: string) {
  const res = await api.get("/context/search", { project, q: query });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** List all context entries for a project. */
export async function planList(project: string) {
  const res = await api.get(`/context?project=${project}`);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

export async function contextGet(project: string, id: number) { const res = await api.get(`/context/${id}`, { project }); return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] }; }
export async function contextUpdate(project: string, id: number, fields: Record<string, unknown>) { const res = await api.patch(`/context/${id}`, fields, { project }); return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] }; }
export async function contextDelete(project: string, id: number) { const res = await api.del(`/context/${id}`, { project }); return { content: [{ type: "text" as const, text: res.status === 204 ? "Context entry deleted" : JSON.stringify(res.data) }] }; }
export async function contextBatch(project: string, ids: number[]) { const res = await api.post("/context/batch", { ids }, { project }); return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] }; }

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function listParams(project: string, limit?: number, cursor?: string): Record<string, string> {
  return {
    project,
    ...(limit === undefined ? {} : { limit: String(limit) }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

// ── Immutable conversation context ─────────────────────────────────────────
// List/search calls intentionally return API summaries without message content.
// Explicit retrieve/batch calls are the only MCP operations that return content.

export async function contextConversationCreate(
  project: string,
  title: string,
  tags?: string[],
  priority?: number,
  metadata?: Record<string, unknown>,
  idempotencyKey?: string,
) {
  const res = await api.post("/context/conversations", { title, tags, priority, metadata, idempotencyKey }, { project });
  return textResult(res.data);
}

export async function contextConversationGet(project: string, conversationId: string) {
  const res = await api.get(`/context/conversations/${encodeURIComponent(conversationId)}`, { project });
  return textResult(res.data);
}

export async function contextConversationList(project: string, limit?: number, cursor?: string) {
  const res = await api.get("/context/conversations", listParams(project, limit, cursor));
  return textResult(res.data);
}

export async function contextMessageAppend(
  project: string,
  conversationId: string,
  role: string,
  content: string,
  expectedRevision: number,
  tags?: string[],
  priority?: number,
  metadata?: Record<string, unknown>,
  idempotencyKey?: string,
) {
  const res = await api.post(
    `/context/conversations/${encodeURIComponent(conversationId)}/messages`,
    { role, content, expectedRevision, tags, priority, metadata, idempotencyKey },
    { project },
  );
  return textResult(res.data);
}

export async function contextMessageList(project: string, conversationId: string, limit?: number, cursor?: string) {
  const res = await api.get(
    `/context/conversations/${encodeURIComponent(conversationId)}/messages`,
    listParams(project, limit, cursor),
  );
  return textResult(res.data);
}

export async function contextMessageSearch(project: string, conversationId: string, query: string, limit?: number) {
  const res = await api.get(
    `/context/conversations/${encodeURIComponent(conversationId)}/messages/search`,
    { project, q: query, ...(limit === undefined ? {} : { limit: String(limit) }) },
  );
  return textResult(res.data);
}

export async function contextMessageRetrieve(project: string, conversationId: string, messageId: string) {
  const res = await api.get(
    `/context/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
    { project },
  );
  return textResult(res.data);
}

export async function contextMessageBatchRetrieve(project: string, conversationId: string, messageIds: string[]) {
  const res = await api.post(
    `/context/conversations/${encodeURIComponent(conversationId)}/messages/batch`,
    { messageIds },
    { project },
  );
  return textResult(res.data);
}

export async function contextCheckpointCreate(
  project: string,
  conversationId: string,
  expectedRevision: number,
  ragSourceIds?: string[],
  metadata?: Record<string, unknown>,
  idempotencyKey?: string,
) {
  const res = await api.post(
    `/context/conversations/${encodeURIComponent(conversationId)}/checkpoints`,
    { expectedRevision, ragSourceIds, metadata, idempotencyKey },
    { project },
  );
  return textResult(res.data);
}

export async function contextCheckpointList(project: string, conversationId: string, limit?: number, cursor?: string) {
  const res = await api.get(
    `/context/conversations/${encodeURIComponent(conversationId)}/checkpoints`,
    listParams(project, limit, cursor),
  );
  return textResult(res.data);
}

export async function contextCheckpointGet(project: string, conversationId: string, checkpointId: string) {
  const res = await api.get(
    `/context/conversations/${encodeURIComponent(conversationId)}/checkpoints/${encodeURIComponent(checkpointId)}`,
    { project },
  );
  return textResult(res.data);
}

export async function contextCheckpointRestore(
  project: string,
  conversationId: string,
  checkpointId: string,
  expectedRevision: number,
  confirmationToken: string,
  title?: string,
  metadata?: Record<string, unknown>,
  idempotencyKey?: string,
) {
  const res = await api.post(
    `/context/conversations/${encodeURIComponent(conversationId)}/checkpoints/${encodeURIComponent(checkpointId)}/restore`,
    { expectedRevision, confirmationToken, title, metadata, idempotencyKey },
    { project },
  );
  return textResult(res.data);
}

/** Preview bounded, content-free maintenance candidates without changing state. */
export async function contextCheckpointMaintenancePreview(
  project: string,
  options: {
    conversationIds?: string[];
    staleBefore?: string;
    includeConflicts?: boolean;
    includeInvalid?: boolean;
    includeArchived?: boolean;
    limit?: number;
  },
) {
  const res = await api.post("/context/conversations/maintenance/preview", options, { project });
  return textResult(res.data);
}

/** Issue a one-time confirmation token for an archive, unarchive, or restore action. */
export async function contextCheckpointMaintenanceAuthorize(
  project: string,
  conversationId: string,
  operation: "archive_conversation" | "unarchive_conversation" | "restore_checkpoint",
  expectedRevision: number,
  checkpointId?: string,
) {
  const res = await api.post(
    `/context/conversations/${encodeURIComponent(conversationId)}/maintenance/authorize`,
    { operation, expectedRevision, checkpointId },
    { project },
  );
  return textResult(res.data);
}

export async function contextConversationArchive(
  project: string,
  conversationId: string,
  expectedRevision: number,
  confirmationToken: string,
) {
  const res = await api.post(
    `/context/conversations/${encodeURIComponent(conversationId)}/archive`,
    { expectedRevision, confirmationToken },
    { project },
  );
  return textResult(res.data);
}

export async function contextConversationUnarchive(
  project: string,
  conversationId: string,
  expectedRevision: number,
  confirmationToken: string,
) {
  const res = await api.post(
    `/context/conversations/${encodeURIComponent(conversationId)}/unarchive`,
    { expectedRevision, confirmationToken },
    { project },
  );
  return textResult(res.data);
}

/** Read bounded, content-free maintenance audit evidence for one conversation. */
export async function contextCheckpointAuditList(project: string, conversationId: string, limit?: number) {
  const res = await api.get(
    `/context/conversations/${encodeURIComponent(conversationId)}/maintenance/audit`,
    { project, ...(limit === undefined ? {} : { limit: String(limit) }) },
  );
  return textResult(res.data);
}

/** Import a bounded, project-owned OpenCode session through the authenticated API boundary. */
export async function contextOpenCodeSessionImport(
  project: string,
  sessionId: string,
  directory: string,
  title: string | undefined,
  limit: number,
) {
  const res = await api.post(
    "/context/imports/opencode-session",
    { sessionId, directory, title, limit },
    { project },
  );
  return textResult(res.data);
}
