/**
 * MCP tool handlers for persistent context storage.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Supports saving context entries with tags/priority and full-text search.
 */
import { api } from "../client.js";
import { uploadContextFile, type ContextUploadFileOptions } from "./context-upload.js";

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

/** Import one descriptor-read file snapshot through the protected API boundary. */
export async function contextUploadFile(
  project: string,
  session: string,
  filePath: string,
  options: ContextUploadFileOptions,
  launcherProject: string | null,
) {
  return uploadContextFile(project, session, filePath, options, launcherProject);
}
