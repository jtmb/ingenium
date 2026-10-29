import { buildProjectNavigationHref } from "./project-navigation";

export type RecentWorkKind = "conversation" | "document" | "task";
export type RecentWorkDirection = "asc" | "desc";
export interface RecentWorkItem {
  key: string;
  kind: RecentWorkKind;
  id: string;
  title: string;
  description: string;
  projectId: string;
  projectName: string;
  updatedAt: string;
  open: { kind: "chat"; sessionId: string; runtimeId: string }
    | { kind: "document"; pageId: number; spaceId: number }
    | { kind: "task"; taskId: string };
}
export interface RecentWorkPage {
  items: RecentWorkItem[];
  nextCursor: string | null;
  direction: RecentWorkDirection;
  sources: Record<RecentWorkKind, "available" | "denied" | "unavailable">;
  unavailable: RecentWorkKind[];
}

const kinds = ["conversation", "document", "task"] as const;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 512): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** Reject malformed or cross-project responses instead of displaying an empty success. */
export function normalizeRecentWorkPage(value: unknown, project: string, direction: RecentWorkDirection): RecentWorkPage {
  const fail = (): never => { throw new Error("Recent work returned an invalid response"); };
  if (!record(value) || !Array.isArray(value.items) || value.items.length > 100 || value.direction !== direction
    || !record(value.sources) || !Array.isArray(value.unavailable)
    || !(value.nextCursor === null || (typeof value.nextCursor === "string" && /^[A-Za-z0-9_-]{1,2048}$/.test(value.nextCursor)))) return fail();
  const sources = {} as RecentWorkPage["sources"];
  for (const kind of kinds) {
    const state = value.sources[kind];
    if (state !== "available" && state !== "denied" && state !== "unavailable") return fail();
    sources[kind] = state;
  }
  if (value.unavailable.some(kind => !kinds.includes(kind as RecentWorkKind))) return fail();
  const keys = new Set<string>();
  const items = value.items.map((item): RecentWorkItem => {
    if (!record(item) || !kinds.includes(item.kind as RecentWorkKind) || !text(item.id)
      || typeof item.title !== "string" || item.title.length === 0 || item.title.length > 4096
      || typeof item.description !== "string" || item.description.length > 1024
      || sources[item.kind as RecentWorkKind] !== "available"
      || !text(item.projectId) || !text(item.projectName) || (item.projectId !== project && item.projectName !== project)
      || item.key !== `${item.kind}:${item.id}` || keys.has(item.key as string) || !record(item.open)
      || typeof item.updatedAt !== "string") return fail();
    try { if (new Date(item.updatedAt).toISOString() !== item.updatedAt) return fail(); } catch { return fail(); }
    let open: RecentWorkItem["open"];
    if (item.kind === "conversation" && item.open.kind === "chat" && text(item.open.sessionId) && text(item.open.runtimeId))
      open = { kind: "chat", sessionId: item.open.sessionId, runtimeId: item.open.runtimeId };
    else if (item.kind === "document" && item.open.kind === "document" && positiveInteger(item.open.pageId)
      && positiveInteger(item.open.spaceId) && String(item.open.pageId) === item.id)
      open = { kind: "document", pageId: item.open.pageId, spaceId: item.open.spaceId };
    else if (item.kind === "task" && item.open.kind === "task" && item.open.taskId === item.id)
      open = { kind: "task", taskId: item.id };
    else return fail();
    keys.add(item.key as string);
    return { key: item.key as string, id: item.id, kind: item.kind as RecentWorkKind, title: item.title, description: item.description,
      projectId: item.projectId, projectName: item.projectName, updatedAt: item.updatedAt, open };
  });
  return { items, sources, direction, unavailable: [...new Set(value.unavailable as RecentWorkKind[])], nextCursor: value.nextCursor as string | null };
}

export function recentWorkHref(item: RecentWorkItem): string {
  const query = new URLSearchParams();
  let pathname: string;
  if (item.open.kind === "chat") {
    pathname = "/chat"; query.set("session", item.open.sessionId); query.set("runtime", item.open.runtimeId);
  } else if (item.open.kind === "document") {
    pathname = "/docs"; query.set("space", String(item.open.spaceId)); query.set("page", String(item.open.pageId));
  } else {
    pathname = "/tasks"; query.set("task", item.open.taskId);
  }
  return buildProjectNavigationHref(pathname, item.projectName, query.toString());
}

export function compareRecentWork(a: RecentWorkItem, b: RecentWorkItem, direction: RecentWorkDirection): number {
  return a.updatedAt === b.updatedAt ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    : (a.updatedAt > b.updatedAt ? -1 : 1) * (direction === "desc" ? 1 : -1);
}
