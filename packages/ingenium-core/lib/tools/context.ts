import { getDb, execTransaction, checkpointAfterWrite, sanitizeFts5Query } from "../db.js";
import { ContextEntry } from "../schema.js";

export type ContextSource = "manual" | "agent" | "import" | "system";
export interface ContextInput { content: string; tags?: string[]; priority?: number; sessionId?: string; source?: ContextSource; metadata?: Record<string, unknown>; }
export interface ContextPage { data: ContextEntry[]; total: number; offset: number; limit: number; }

const CONTEXT_SOURCES = new Set<ContextSource>(["manual", "agent", "import", "system"]);

function validate(input: ContextInput): Required<Pick<ContextInput, "content" | "tags" | "priority" | "source">> & ContextInput {
  const content = input.content?.trim();
  if (!content) throw new Error("content is required");
  const priority = input.priority ?? 5;
  if (!Number.isInteger(priority) || priority < 0 || priority > 10) throw new Error("priority must be an integer between 0 and 10");
  const tags = input.tags ?? [];
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 64)) throw new Error("tags must be non-empty strings up to 64 characters");
  const source = input.source ?? "manual";
  if (!CONTEXT_SOURCES.has(source)) throw new Error("source must be one of: manual, agent, import, system");
  if (input.sessionId !== undefined && (typeof input.sessionId !== "string" || input.sessionId.length > 128)) throw new Error("sessionId must be a string up to 128 characters");
  return { ...input, content, priority, tags: [...new Set(tags.map((tag) => tag.trim()))].sort(), source };
}

/**
 * Save a context/plan entry for a project.
 * Entries are used to persist working context across sessions — the task management
 * and plan surface reads from this table.
 *
 * 🔴 WAL SAFETY: checkpointAfterWrite() is called OUTSIDE execTransaction().
 * Calling a WAL checkpoint inside an active transaction causes SQLITE_LOCKED.
 */
export function createContext(projectId: string, input: ContextInput): ContextEntry {
  const value = validate(input);
  const entry = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const result = db.prepare(
       `INSERT INTO context_entries (project_id, content, tags, priority, session_id, source, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(projectId, value.content, JSON.stringify(value.tags), value.priority, value.sessionId ?? null, value.source, JSON.stringify(value.metadata ?? {}), now, now);
    return db.prepare("SELECT * FROM context_entries WHERE id = ?").get(result.lastInsertRowid) as ContextEntry;
  });
  checkpointAfterWrite();
  return entry;
}

/** Backward-compatible plan entry writer. */
export function saveContext(projectId: string, content: string, tags?: string, priority?: number): ContextEntry {
  let parsedTags: string[] = [];
  if (tags) {
    try { parsedTags = Array.isArray(JSON.parse(tags)) ? JSON.parse(tags) : tags.split(","); } catch { parsedTags = tags.split(","); }
  }
  return createContext(projectId, { content, tags: parsedTags, priority });
}

/**
 * Full-text search across context entries using FTS5.
 * Returns results ranked by BM25 relevance. Falls back to an empty array
 * if sanitizeFts5Query rejects the input (empty or invalid FTS5 syntax).
 */
export function searchContext(projectId: string, query: string, limit = 50): ContextEntry[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const sanitized = sanitizeFts5Query(query);
  if (!sanitized) return [];
  return db.prepare(
    `SELECT c.* FROM context_entries c
     INNER JOIN context_fts fts ON fts.rowid = c.id
     WHERE c.project_id = ? AND context_fts MATCH ?
      ORDER BY c.priority DESC, rank, c.created_at DESC, c.id DESC
     LIMIT ?`
  ).all(projectId, sanitized, limit) as ContextEntry[];
}

export function listContext(projectId: string, limit = 20, offset = 0): ContextPage {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const safeOffset = Math.max(Math.trunc(offset), 0);
  const total = (db.prepare("SELECT count(*) AS total FROM context_entries WHERE project_id = ?").get(projectId) as { total: number }).total;
  const data = db.prepare("SELECT * FROM context_entries WHERE project_id = ? ORDER BY priority DESC, created_at DESC, id DESC LIMIT ? OFFSET ?").all(projectId, safeLimit, safeOffset) as ContextEntry[];
  return { data, total, limit: safeLimit, offset: safeOffset };
}

export function getContext(projectId: string, id: number): ContextEntry | undefined {
  return getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data").prepare("SELECT * FROM context_entries WHERE project_id = ? AND id = ?").get(projectId, id) as ContextEntry | undefined;
}

export function getContextBatch(projectId: string, ids: number[]): ContextEntry[] {
  const valid = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (!valid.length) return [];
  const placeholders = valid.map(() => "?").join(",");
  return getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data").prepare(`SELECT * FROM context_entries WHERE project_id = ? AND id IN (${placeholders}) ORDER BY priority DESC, created_at DESC, id DESC`).all(projectId, ...valid) as ContextEntry[];
}

export function updateContext(projectId: string, id: number, fields: Partial<ContextInput>): ContextEntry | undefined {
  const existing = getContext(projectId, id);
  if (!existing) return undefined;
  const currentTags = JSON.parse(existing.tags || "[]") as string[];
  const value = validate({ content: fields.content ?? existing.content, tags: fields.tags ?? currentTags, priority: fields.priority ?? existing.priority, sessionId: fields.sessionId ?? existing.session_id ?? undefined, source: fields.source ?? (existing.source as ContextSource), metadata: fields.metadata ?? JSON.parse(existing.metadata || "{}") });
  const updated = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    db.prepare("UPDATE context_entries SET content = ?, tags = ?, priority = ?, session_id = ?, source = ?, metadata = ?, updated_at = ? WHERE project_id = ? AND id = ?").run(value.content, JSON.stringify(value.tags), value.priority, value.sessionId ?? null, value.source, JSON.stringify(value.metadata ?? {}), new Date().toISOString(), projectId, id);
    return getContext(projectId, id);
  });
  checkpointAfterWrite();
  return updated;
}

export function deleteContext(projectId: string, id: number): boolean {
  const changes = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    return db.prepare("DELETE FROM context_entries WHERE project_id = ? AND id = ?").run(projectId, id).changes;
  });
  if (changes) checkpointAfterWrite();
  return changes > 0;
}

/** Get the most recent context entries for a project, ordered by creation time descending. */
export function recentContext(projectId: string, limit = 20): ContextEntry[] {
  return listContext(projectId, limit).data;
}
