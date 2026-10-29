import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { authorization, contextConversations, docs, getDb, identity, organizations, projects, resetDbForTest, tasks } from "ingenium-core";
import { measureTestRunCleanup } from "../../../tests/test-run-cleanup-allocation.js";
import { readRecentWork, RecentWorkInputError } from "../lib/dashboard-recent-work.js";
import { dashboardRouter } from "../lib/routes/dashboard.js";
import { authorizationMiddleware } from "../lib/authorization-policy.js";
import { errorHandler } from "../lib/middleware/errors.js";

const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
let directory: string;
let project: ReturnType<typeof projects.createProject>;
let otherProject: ReturnType<typeof projects.createProject>;
let viewer: authorization.AuthorizationPrincipal;
let otherViewer: authorization.AuthorizationPrincipal;
let ownConversation: ReturnType<typeof contextConversations.createContextConversation>;
let task: ReturnType<typeof tasks.createTask>;
let documentId: number;
const updatedAt = "2026-10-28T10:00:00.000Z";

function conversation(projectId: string, owner: string, title: string, sessionId = title) {
  return contextConversations.createContextConversation(projectId, {
    title, ownerUserId: owner, organizationId: organizations.BOOTSTRAP_ORGANIZATION_ID, visibility: "private",
    metadata: { source: "opencode-chat", sourceSessionId: sessionId, sourceRuntimeId: "compatibility" },
  });
}

async function withDashboard(run: (url: string) => Promise<void>, principal = viewer) {
  const app = express();
  app.use((req, _res, next) => {
    req.principal = { type: "user", id: principal.id, scopes: [...principal.scopes], session: { id: "recent-work-fixture-session" } } as any;
    next();
  });
  app.use(authorizationMiddleware);
  app.use("/api/v1/dashboard", dashboardRouter);
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/dashboard/recent-work?project=${project.name}`); }
  finally { await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); }
}

beforeEach(() => {
  resetDbForTest();
  directory = mkdtempSync(join(tmpdir(), "ingenium-recent-work-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "test.db");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(updatedAt));
  project = projects.createProject("recent-work-project");
  otherProject = projects.createProject("other-work-project");
  const first = identity.createUser("recent-first@example.test", "First viewer");
  const second = identity.createUser("recent-second@example.test", "Second viewer");
  for (const user of [first, second]) {
    organizations.addOrganizationMember(organizations.BOOTSTRAP_ORGANIZATION_ID, user.id, "member");
    for (const p of [project, otherProject]) organizations.addProjectMember(p.id, user.id, "editor");
  }
  viewer = { type: "browser-user", id: first.id, organizationId: organizations.BOOTSTRAP_ORGANIZATION_ID, scopes: ["*"] };
  otherViewer = { ...viewer, id: second.id };
  ownConversation = conversation(project.id, first.id, "Own saved conversation", "exact-owned-session");
  conversation(project.id, second.id, "Other private conversation", "foreign-session");
  conversation(otherProject.id, first.id, "Other project conversation");
  task = tasks.createTask(project.id, "Exact task");
  tasks.createTask(otherProject.id, "Other project task");
  const space = docs.createSpace(organizations.BOOTSTRAP_ORGANIZATION_ID, "Work docs", "work-docs", "", "");
  const page = docs.createPage(space.id, "Exact document", "exact-document", "Document body").page!;
  documentId = page.id;
  docs.linkProject(page.id, project.id);
  const unlinked = docs.createPage(space.id, "Unlinked document", "unlinked-document", "Other body").page!;
  docs.linkProject(unlinked.id, otherProject.id);
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
  db.prepare("UPDATE tasks SET updated_at = ?").run(updatedAt);
  db.prepare("UPDATE docs_pages SET updated_at = ?").run(updatedAt);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetDbForTest();
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (directory) {
    if (realpathSync(directory) !== resolve(directory) || !directory.startsWith(resolve(tmpdir()) + sep + "ingenium-recent-work-"))
      throw new Error("Fixture cleanup escaped its owned temporary leaf");
    const allocation = measureTestRunCleanup([directory]);
    if (allocation.sharedHardLinks.length) throw new Error("Fixture has unaccounted hard links");
    rmSync(directory, { recursive: true });
    console.info("Recent-work fixture removed", JSON.stringify(allocation));
  }
});

describe("permission-scoped recent work", () => {
  it("returns actual conversation/document/task identities and exact navigation targets", () => {
    const page = readRecentWork(project.id, viewer);
    expect(page.sources).toEqual({ conversation: "available", document: "available", task: "available" });
    expect(page.unavailable).toEqual([]);
    expect(page.items).toHaveLength(3);
    expect(page.items.map(item => item.kind)).toEqual(["conversation", "document", "task"]);
    expect(page.items.find(item => item.kind === "conversation")).toMatchObject({ id: ownConversation.id,
      open: { kind: "chat", sessionId: "exact-owned-session", runtimeId: "compatibility" } });
    expect(page.items.find(item => item.kind === "document")).toMatchObject({ id: String(documentId), open: { kind: "document", pageId: documentId } });
    expect(page.items.find(item => item.kind === "task")).toMatchObject({ id: task.id, open: { kind: "task", taskId: task.id } });
    expect(page.items.every(item => item.projectId === project.id && item.projectName === project.name && item.updatedAt === updatedAt)).toBe(true);
  });

  it("never exposes another user's private session or another project's work", () => {
    const first = JSON.stringify(readRecentWork(project.id, viewer));
    const second = JSON.stringify(readRecentWork(project.id, otherViewer));
    expect(first).toContain("Own saved conversation");
    expect(first).not.toMatch(/Other private|foreign-session|Other project|Unlinked document/);
    expect(second).toContain("Other private conversation");
    expect(second).not.toContain("exact-owned-session");
  });

  it("keeps individual domain read denials instead of inheriting dashboard permission", () => {
    const page = readRecentWork(project.id, { ...viewer, scopes: ["dashboard:read", "context:read"] });
    expect(page.items.map(item => item.kind)).toEqual(["conversation"]);
    expect(page.sources).toEqual({ conversation: "available", document: "denied", task: "denied" });
    expect(page.unavailable).toEqual([]);
  });

  it("paginates tied update times deterministically without skipping or duplicating kinds", () => {
    const all = readRecentWork(project.id, viewer).items.map(item => item.key);
    const collected: string[] = [];
    let cursor: string | undefined;
    do {
      const page = readRecentWork(project.id, viewer, { limit: 1, cursor });
      collected.push(...page.items.map(item => item.key));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(collected).toEqual(all);
    expect(new Set(collected).size).toBe(3);
  });

  it("rejects a cursor from another project or viewer", () => {
    const cursor = readRecentWork(project.id, viewer, { limit: 1 }).nextCursor!;
    expect(() => readRecentWork(otherProject.id, viewer, { cursor })).toThrow(RecentWorkInputError);
    expect(() => readRecentWork(project.id, otherViewer, { cursor })).toThrow(RecentWorkInputError);
    expect(() => readRecentWork(project.id, viewer, { cursor, direction: "asc" })).toThrow(RecentWorkInputError);
  });

  it("sorts the whole accessible catalog in either direction and paginates oldest first", () => {
    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run("2026-10-28T12:00:00.000Z", task.id);
    vi.setSystemTime(new Date("2026-10-28T13:00:00.000Z"));
    contextConversations.appendContextMessage(project.id, ownConversation.id, { role: "user", content: "Latest activity", expectedRevision: 0 });
    expect(readRecentWork(project.id, viewer).items.map(item => item.kind)).toEqual(["conversation", "task", "document"]);
    const collected: string[] = [];
    let cursor: string | undefined;
    do {
      const page = readRecentWork(project.id, viewer, { direction: "asc", limit: 1, cursor });
      collected.push(...page.items.map(item => item.kind));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(collected).toEqual(["document", "task", "conversation"]);
  });

  it.each([0, -1, 101, 1.5, NaN])("refuses invalid page limit %s", limit => {
    expect(() => readRecentWork(project.id, viewer, { limit })).toThrow(RecentWorkInputError);
  });

  it("keeps healthy source results when one store is unavailable", () => {
    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("DROP TABLE docs_page_projects").run();
    const page = readRecentWork(project.id, viewer);
    expect(page.sources.document).toBe("unavailable");
    expect(page.unavailable).toEqual(["document"]);
    expect(page.items.map(item => item.kind)).toEqual(["conversation", "task"]);
  });

  it("does not use page-visit settings as work-item rows", () => {
    const empty = projects.createProject("empty-recent-project");
    organizations.addProjectMember(empty.id, viewer.id, "editor");
    const page = readRecentWork(empty.id, viewer);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(page.sources).toEqual({ conversation: "available", document: "available", task: "available" });
  });

  it("uses actual appended-message activity rather than conversation creation time", () => {
    vi.setSystemTime(new Date("2026-10-28T11:00:00.000Z"));
    contextConversations.appendContextMessage(project.id, ownConversation.id, {
      role: "user", content: "New saved activity", expectedRevision: 0,
    });
    const page = readRecentWork(project.id, viewer);
    expect(page.items[0]).toMatchObject({ id: ownConversation.id, updatedAt: "2026-10-28T11:00:00.000Z" });
  });

  it("compares SQLite and ISO timestamps by time and uses the current document draft", () => {
    docs.saveDraft(documentId, "Draft body", "Current draft title");
    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("UPDATE docs_page_drafts SET saved_at = ? WHERE page_id = ?")
      .run("2026-10-28 12:00:00", documentId);
    const page = readRecentWork(project.id, viewer);
    expect(page.items[0]).toMatchObject({ kind: "document", id: String(documentId), title: "Current draft title", updatedAt: "2026-10-28T12:00:00.000Z" });
  });

  it("serves actual work items and validates pagination parameters through the HTTP route", async () => {
    await withDashboard(async url => {
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect((await response.json()).data.items).toHaveLength(3);
      expect((await fetch(url + "&limit=0")).status).toBe(400);
      expect((await fetch(url + "&cursor=invalid")).status).toBe(400);
    });
  });

  it("does not reveal work items to an organization member outside the project", async () => {
    const unassigned = identity.createUser("recent-unassigned@example.test", "Unassigned viewer");
    organizations.addOrganizationMember(organizations.BOOTSTRAP_ORGANIZATION_ID, unassigned.id, "member");
    await withDashboard(async url => {
      const response = await fetch(url);
      expect(response.status).toBe(404);
      expect(JSON.stringify(await response.json())).not.toMatch(/Exact task|Exact document|saved conversation/);
    }, { ...viewer, id: unassigned.id });
  });

  it("returns an unavailable response rather than an empty success when every allowed store fails", async () => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH), prepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
      if (sql.startsWith("SELECT * FROM (")) throw new Error("Controlled store failure");
      return prepare(sql);
    }) as typeof db.prepare);
    await withDashboard(async url => {
      const response = await fetch(url);
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("RECENT_WORK_UNAVAILABLE");
    });
  });
});
