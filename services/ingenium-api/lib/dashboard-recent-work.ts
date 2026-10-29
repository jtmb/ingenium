import { createHash } from "node:crypto";
import { authorization, getDb } from "ingenium-core";

type Kind = "conversation" | "document" | "task";
type SourceState = "available" | "denied" | "unavailable";
type OpenTarget = { kind: "chat"; sessionId: string; runtimeId: string }
  | { kind: "document"; pageId: number; spaceId: number }
  | { kind: "task"; taskId: string };

export interface RecentWorkItem {
  key: string;
  kind: Kind;
  id: string;
  title: string;
  description: string;
  projectId: string;
  projectName: string;
  updatedAt: string;
  open: OpenTarget;
}

export interface RecentWorkPage {
  items: RecentWorkItem[];
  nextCursor: string | null;
  direction: "asc" | "desc";
  sources: Record<Kind, SourceState>;
  unavailable: Kind[];
}

type Cursor = { version: 1; scope: string; updatedAt: string; key: string };
type Row = { key: string; id: string | number; title: string; description?: string; updatedAt: string;
  sessionId?: string; runtimeId?: string; spaceId?: number; kind: Kind };

export class RecentWorkInputError extends Error {}

function boundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
}

function readCursor(value: string | undefined, scope: string): Cursor | null {
  if (value === undefined) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(value)) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    if (cursor.version !== 1 || cursor.scope !== scope || !boundedIdentifier(cursor.key)
      || typeof cursor.updatedAt !== "string" || new Date(cursor.updatedAt).toISOString() !== cursor.updatedAt) throw new Error();
    return cursor;
  } catch {
    throw new RecentWorkInputError("Invalid recent-work cursor");
  }
}

/** Read-only API aggregation. Each domain keeps its own authorization boundary. */
export function readRecentWork(projectId: string, principal: authorization.AuthorizationPrincipal,
  options: { limit?: number; cursor?: string; direction?: "asc" | "desc" } = {}): RecentWorkPage {
  const limit = options.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RecentWorkInputError("Recent-work limit must be from 1 to 100");
  const direction = options.direction ?? "desc";
  if (direction !== "asc" && direction !== "desc") throw new RecentWorkInputError("Invalid recent-work sort direction");
  const scope = createHash("sha256").update(`${projectId}\0${principal.type}\0${principal.id}\0${direction}`).digest("hex");
  const cursor = readCursor(options.cursor, scope);
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
  const project = db.prepare("SELECT id, name, organization_id FROM projects WHERE id = ? AND archived_at IS NULL")
    .get(projectId) as { id: string; name: string; organization_id: string } | undefined;
  if (!project || !authorization.requireProjectPermission(principal, projectId, "dashboard", "read").allowed)
    throw new RecentWorkInputError("Recent work is unavailable for this project");

  const sources: RecentWorkPage["sources"] = { conversation: "denied", document: "denied", task: "denied" };
  const rows: Row[] = [];
  const unavailable = new Set<Kind>();
  const owner = principal.type === "browser-user" || principal.type === "user-token" ? principal.id : null;

  function collect(kind: Kind, allowed: boolean, select: string, parameters: unknown[]) {
    if (!allowed) return;
    try {
      const after = cursor ? ` AND (updatedAt ${direction === "desc" ? "<" : ">"} ? OR (updatedAt = ? AND key > ?))` : "";
      const bindings = [...parameters, ...(cursor ? [cursor.updatedAt, cursor.updatedAt, cursor.key] : []), limit + 1];
      const data = db.prepare(`SELECT * FROM (${select}) WHERE updatedAt IS NOT NULL${after}
        ORDER BY updatedAt ${direction === "desc" ? "DESC" : "ASC"}, key ASC LIMIT ?`).all(...bindings) as Omit<Row, "kind">[];
      rows.push(...data.map(row => ({ ...row, kind })));
      sources[kind] = "available";
    } catch {
      sources[kind] = "unavailable";
      unavailable.add(kind);
    }
  }

  // Chat links are private runtime identities. A project/organization role never
  // makes another user's OpenCode session the current user's conversation.
  collect("conversation", owner !== null && authorization.requireProjectPermission(principal, projectId, "context", "read").allowed, `
    SELECT 'conversation:' || c.id AS key, c.id, c.title,
      (SELECT substr(m.content, 1, 160) FROM context_messages m WHERE m.project_id = c.project_id AND m.conversation_id = c.id ORDER BY m.sequence DESC LIMIT 1) AS description,
      strftime('%Y-%m-%dT%H:%M:%fZ', max(julianday(c.created_at),
        COALESCE((SELECT max(julianday(m.created_at)) FROM context_messages m WHERE m.project_id = c.project_id AND m.conversation_id = c.id), julianday(c.created_at)),
        COALESCE((SELECT max(julianday(cp.created_at)) FROM context_checkpoints cp WHERE cp.project_id = c.project_id AND cp.conversation_id = c.id), julianday(c.created_at)))) AS updatedAt,
      json_extract(c.metadata, '$.sourceSessionId') AS sessionId,
      json_extract(c.metadata, '$.sourceRuntimeId') AS runtimeId
    FROM context_conversations c
    WHERE c.project_id = ? AND c.organization_id = ? AND c.owner_user_id = ? AND c.visibility = 'private'
      AND json_extract(c.metadata, '$.source') = 'opencode-chat'
      AND COALESCE((SELECT event_type FROM context_checkpoint_audit_events a
        WHERE a.project_id = c.project_id AND a.conversation_id = c.id AND a.archive_sequence IS NOT NULL
        ORDER BY a.archive_sequence DESC LIMIT 1), 'conversation_unarchived') <> 'conversation_archived'`,
    [projectId, project.organization_id, owner]);

  collect("document", authorization.requireOrganizationPermission(principal, project.organization_id, "docs", "read").allowed, `
    SELECT 'document:' || p.id AS key, p.id,
      CASE WHEN d.title <> '' THEN d.title ELSE p.title END AS title, p.space_id AS spaceId,
      substr(COALESCE(d.content, p.content), 1, 160) AS description,
      strftime('%Y-%m-%dT%H:%M:%fZ', max(julianday(p.updated_at), COALESCE(julianday(d.saved_at), julianday(p.updated_at)))) AS updatedAt
    FROM docs_pages p JOIN docs_page_projects links ON links.page_id = p.id AND links.organization_id = p.organization_id
      LEFT JOIN docs_page_drafts d ON d.page_id = p.id AND d.organization_id = p.organization_id
    WHERE links.project_id = ? AND p.organization_id = ? AND p.status <> 'archived'`,
    [projectId, project.organization_id]);

  collect("task", authorization.requireProjectPermission(principal, projectId, "tasks", "read").allowed, `
    SELECT 'task:' || id AS key, id, title, substr(description, 1, 160) AS description, strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) AS updatedAt
    FROM tasks WHERE project_id = ? AND organization_id = ?`, [projectId, project.organization_id]);

  rows.sort((a, b) => a.updatedAt === b.updatedAt ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    : (a.updatedAt > b.updatedAt ? -1 : 1) * (direction === "desc" ? 1 : -1));
  const selected = rows.slice(0, limit);
  const items: RecentWorkItem[] = [];
  for (const row of selected) {
    let open: OpenTarget;
    if (row.kind === "conversation") {
      if (!boundedIdentifier(row.sessionId) || !boundedIdentifier(row.runtimeId)) { unavailable.add(row.kind); continue; }
      open = { kind: "chat", sessionId: row.sessionId, runtimeId: row.runtimeId };
    } else if (row.kind === "document") {
      if (!Number.isSafeInteger(row.id) || Number(row.id) < 1 || !Number.isSafeInteger(row.spaceId) || Number(row.spaceId) < 1) {
        unavailable.add(row.kind); continue;
      }
      open = { kind: "document", pageId: Number(row.id), spaceId: row.spaceId! };
    } else {
      open = { kind: "task", taskId: String(row.id) };
    }
    items.push({ key: row.key, kind: row.kind, id: String(row.id), title: row.title,
      description: typeof row.description === "string" ? row.description.replace(/\s+/g, " ") : "",
      projectId, projectName: project.name, updatedAt: row.updatedAt, open });
  }
  const tail = selected.at(-1);
  return { items, sources, direction, unavailable: [...unavailable], nextCursor: rows.length > limit && tail
    ? Buffer.from(JSON.stringify({ version: 1, scope, updatedAt: tail.updatedAt, key: tail.key })).toString("base64url") : null };
}
