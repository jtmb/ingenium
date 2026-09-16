import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("../lib/opencode-client.js", () => ({
  opencodeClient: { getSession: (...args: unknown[]) => mocks.getSession(...args) },
  isOpenCodeError: (value: unknown) => typeof value === "object" && value !== null && "error" in value,
}));

import {
  contextRag,
  docs,
  getDb,
  jobs,
  projects,
  resetDbForTest,
  tasks,
  usage,
} from "ingenium-core";
import { tasksRouter } from "../lib/routes/tasks.js";
import { getOpenCodeUsageSourceInstance } from "../lib/usage-sync.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

let directory = "";
let server: Server;
let baseUrl = "";
let globalProject: ReturnType<typeof projects.createProject>;
let localProject: ReturnType<typeof projects.createProject>;
let otherProject: ReturnType<typeof projects.createProject>;
let globalTaskId = "";
let localTaskId = "";
let emailSourceId = "";
let chatSourceId = "";
let sourceInstance = "";

function url(taskId: string, suffix: string, project: string, extra = ""): string {
  return `${baseUrl}/api/v1/tasks/${taskId}${suffix}?project=${project}${extra}`;
}

function captureUrl(project?: string): string {
  return `${baseUrl}/api/v1/tasks/captures${project ? `?project=${encodeURIComponent(project)}` : ""}`;
}

function session(title = "Verified chat title", projectID = "upstream-project") {
  return {
    id: "session-1",
    slug: "session-1",
    projectID,
    directory: "/workspace",
    path: "/workspace",
    title,
    version: "1",
    time: { created: 1_754_006_400_000, updated: 1_754_006_400_000 },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-task-source-references-api-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  process.env.INGENIUM_HOME = join(directory, "home");
  resetDbForTest();
  globalProject = projects.createProject("task-reference-api-global", true);
  localProject = projects.createProject("task-reference-api-local");
  otherProject = projects.createProject("task-reference-api-other");
  globalTaskId = tasks.createTask(globalProject.id, "Global task").id;
  localTaskId = tasks.createTask(localProject.id, "Local task").id;
  emailSourceId = tasks.createEmailTaskSourceId("account-a", "INBOX", "42");
  sourceInstance = getOpenCodeUsageSourceInstance();
  chatSourceId = tasks.createChatTaskSourceId(sourceInstance, "upstream-project", "session-1");
  usage.mapOpenCodeProject(sourceInstance, "upstream-project", globalProject.id);
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
  db.prepare(
    `INSERT INTO mail_accounts
     (id, organization_id, owner_kind, email, name, provider, auth_type, config_json, created_by_actor_type, created_at, updated_at)
     VALUES (?, ?, 'organization', ?, ?, 'custom', 'app_password', '{}', 'compatibility', ?, ?)`,
  ).run("account-a", globalProject.organization_id, "task-source@example.test", "Task source", new Date().toISOString(), new Date().toISOString());
  db.prepare(
    `INSERT INTO email_cache
     (organization_id, account_id, folder, uid, subject, snippet, envelope_json, cached_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(globalProject.organization_id, "account-a", "INBOX", "42", "Secret subject", "Secret snippet", '{"authorization":"secret"}', "2026-08-01T00:00:00.000Z");

  const app = express();
  app.use(express.json());
  app.use("/api/v1/tasks", tasksRouter);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});

afterEach(() => vi.clearAllMocks());

afterAll(async () => {
  await closeHttpServer(server);
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  delete process.env.INGENIUM_HOME;
  rmSync(directory, { recursive: true, force: true });
});

describe("task source reference API", () => {
  it("captures email and context sources atomically, idempotently, and without source-content leakage", async () => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    db.prepare(
      `INSERT INTO mail_accounts
       (id, organization_id, owner_kind, email, name, provider, auth_type, config_json, created_by_actor_type, created_at, updated_at)
       VALUES (?, ?, 'organization', ?, ?, 'custom', 'app_password', '{}', 'compatibility', ?, ?)`,
    ).run("capture-account", globalProject.organization_id, "capture@example.test", "Capture", new Date().toISOString(), new Date().toISOString());
    db.prepare(
      `INSERT INTO email_cache
       (organization_id, account_id, folder, uid, subject, snippet, envelope_json, cached_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      globalProject.organization_id,
      "capture-account",
      "Archive/2026",
      "capture-42",
      "Sensitive capture subject",
      "Sensitive capture snippet",
      '{"authorization":"capture-secret"}',
      "2026-08-01T00:00:00.000Z",
    );
    const beforeGlobalTasks = (db.prepare("SELECT count(*) AS count FROM tasks WHERE project_id = ?").get(globalProject.id) as { count: number }).count;
    const beforeActivity = (db.prepare("SELECT count(*) AS count FROM task_activity").get() as { count: number }).count;
    const emailBody = {
      source_type: "email",
      title: "Follow up with customer",
      account_id: "capture-account",
      folder: "Archive/2026",
      uid: "capture-42",
    };

    const email = await fetch(captureUrl(localProject.name), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailBody),
    });
    expect(email.status).toBe(201);
    const emailResult = await email.json();
    expect(emailResult.data.task).toMatchObject({ project_id: globalProject.id, title: "Follow up with customer", column_id: "todo" });
    expect(emailResult.data.reference).toMatchObject({ source_type: "email", display_title: "Email" });
    expect(JSON.stringify(emailResult)).not.toContain("Sensitive capture");
    expect(JSON.stringify(emailResult)).not.toContain("authorization");
    expect((db.prepare("SELECT count(*) AS count FROM tasks WHERE project_id = ?").get(globalProject.id) as { count: number }).count)
      .toBe(beforeGlobalTasks + 1);
    expect((db.prepare("SELECT count(*) AS count FROM task_activity").get() as { count: number }).count)
      .toBe(beforeActivity + 1);

    const duplicate = await fetch(captureUrl(otherProject.name), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...emailBody, title: "Different retry title" }),
    });
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json()).data.task.id).toBe(emailResult.data.task.id);

    const localContext = contextRag.ingestContextRagDocument(localProject.id, {
      title: "Local context source",
      content: "Sensitive local context body",
    });
    const context = await fetch(captureUrl(localProject.name), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_type: "context",
        title: "Review context handoff",
        source_id: localContext.upload.rag_source_id,
      }),
    });
    expect(context.status).toBe(201);
    expect((await context.json()).data.reference).toMatchObject({ source_type: "context", display_title: "Local context source" });

    const foreignContext = contextRag.ingestContextRagDocument(otherProject.id, {
      title: "Foreign context source",
      content: "Sensitive foreign context body",
    });
    const beforeForeignCaptureTasks = (db.prepare("SELECT count(*) AS count FROM tasks").get() as { count: number }).count;
    const beforeForeignCaptureActivity = (db.prepare("SELECT count(*) AS count FROM task_activity").get() as { count: number }).count;
    const foreign = await fetch(captureUrl(localProject.name), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_type: "context",
        title: "Attempt foreign context",
        source_id: foreignContext.upload.rag_source_id,
      }),
    });
    expect(foreign.status).toBe(404);
    expect((db.prepare("SELECT count(*) AS count FROM tasks").get() as { count: number }).count).toBe(beforeForeignCaptureTasks);
    expect((db.prepare("SELECT count(*) AS count FROM task_activity").get() as { count: number }).count).toBe(beforeForeignCaptureActivity);
  });

  it("captures authorized docs and server-verified chats atomically with fixed chat metadata", async () => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const space = docs.createSpace("Capture API docs", "capture-api-docs");
    const page = docs.createPage(space.id, "Release plan", "capture-release-plan", "docs-body-sentinel").page!;
    docs.linkProject(page.id, localProject.id);
    const beforeTasks = (db.prepare("SELECT count(*) AS count FROM tasks").get() as { count: number }).count;

    const docsCapture = await fetch(captureUrl(localProject.name), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_type: "docs", title: "Review release plan", page_id: page.id }),
    });
    expect(docsCapture.status).toBe(201);
    const docsResult = await docsCapture.json();
    expect(docsResult.data).toMatchObject({
      task: { project_id: localProject.id, title: "Review release plan" },
      reference: { source_type: "docs", display_title: "Release plan", display_detail: "Documentation page" },
    });
    const docsDuplicate = await fetch(captureUrl(localProject.name), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_type: "docs", title: "Changed retry title", page_id: page.id }),
    });
    expect(docsDuplicate.status).toBe(200);
    expect((await docsDuplicate.json()).data.task.id).toBe(docsResult.data.task.id);
    expect((await fetch(captureUrl(otherProject.name), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_type: "docs", title: "Foreign docs", page_id: page.id }),
    })).status).toBe(404);

    mocks.getSession.mockResolvedValue(session("chat-title-sentinel"));
    const chatCapture = await fetch(captureUrl(otherProject.name), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_type: "chat", title: "Review OpenCode work", session_id: "session-1" }),
    });
    expect(chatCapture.status).toBe(201);
    const chatResult = await chatCapture.json();
    expect(chatResult.data).toMatchObject({
      task: { project_id: globalProject.id, title: "Review OpenCode work" },
      reference: { source_type: "chat", display_title: "OpenCode chat", display_detail: "OpenCode chat" },
    });
    expect(mocks.getSession).toHaveBeenCalledWith("session-1");
    expect(JSON.stringify(chatResult)).not.toContain("chat-title-sentinel");
    expect(JSON.stringify([docsResult, chatResult])).not.toContain("docs-body-sentinel");
    expect(JSON.stringify([docsResult, chatResult])).not.toContain("chat-transcript-sentinel");

    const chatDuplicate = await fetch(captureUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_type: "chat", title: "Changed retry title", session_id: "session-1" }),
    });
    expect(chatDuplicate.status).toBe(200);
    expect((await chatDuplicate.json()).data.task.id).toBe(chatResult.data.task.id);

    mocks.getSession.mockResolvedValue({ ...session(), id: "session-mismatch" });
    expect((await fetch(captureUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_type: "chat", title: "Mismatched session", session_id: "session-1" }),
    })).status).toBe(404);
    mocks.getSession.mockResolvedValue(session("unmapped-title", "unmapped-project"));
    expect((await fetch(captureUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_type: "chat", title: "Unmapped session", session_id: "session-1" }),
    })).status).toBe(404);
    mocks.getSession.mockResolvedValue({ error: { code: "NETWORK_ERROR", message: "unavailable" } });
    expect((await fetch(captureUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_type: "chat", title: "Unavailable session", session_id: "session-1" }),
    })).status).toBe(503);
    expect((db.prepare("SELECT count(*) AS count FROM tasks").get() as { count: number }).count).toBe(beforeTasks + 2);
  });

  it("rejects malformed capture bodies and reports unavailable global capture scope", async () => {
    const post = (body: unknown, project?: string) => fetch(captureUrl(project), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const validEmail = {
      source_type: "email",
      title: "Follow up",
      account_id: "capture-account",
      folder: "Archive/2026",
      uid: "capture-42",
    };

    expect((await post({ ...validEmail, display_title: "client metadata" })).status).toBe(422);
    expect((await post({ ...validEmail, description: "client task metadata" })).status).toBe(422);
    expect((await post({ ...validEmail, uid: 42 })).status).toBe(422);
    expect((await post({ source_type: "context", title: "Review", source_id: "not-a-uuid" }, localProject.name)).status).toBe(422);
    expect((await post({ source_type: "context", title: "Review", source_id: "00000000-0000-4000-8000-000000000000" })).status).toBe(422);
    expect((await post({ source_type: "docs", title: "Review", page_id: 1, source_id: "client-supplied" }, localProject.name)).status).toBe(422);
    expect((await post({
      source_type: "chat",
      title: "Review",
      session_id: "../session",
      source_id: "client-supplied",
      sourceInstance: "client-supplied",
      projectID: "client-supplied",
      session_title: "chat-title-sentinel",
      messages: ["chat-transcript-sentinel"],
      content: "chat-transcript-sentinel",
    })).status).toBe(422);
    expect(mocks.getSession).not.toHaveBeenCalled();

    projects.setProjectGlobal(globalProject.name, false);
    try {
      expect((await post(validEmail)).status).toBe(503);
    } finally {
      projects.setProjectGlobal(globalProject.name, true);
    }
  });

  it("creates all trusted source references, snapshots safe metadata, and handles duplicates", async () => {
    const context = contextRag.ingestContextRagDocument(localProject.id, {
      title: "Context handoff",
      content: "Context body must remain outside task source references.",
    });
    const space = docs.createSpace("API task docs", "api-task-docs");
    const page = docs.createPage(space.id, "Documentation title", "documentation-title", "Docs body").page!;
    const job = jobs.createJob(localProject.id, "Report job", "Secret job description", "agent", "Secret prompt template");
    mocks.getSession.mockResolvedValue(session());

    const post = (taskId: string, project: string, source_type: string, source_id: string) => fetch(
      url(taskId, "/references", project),
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_type, source_id }) },
    );

    const email = await post(globalTaskId, globalProject.name, "email", emailSourceId);
    expect(email.status).toBe(201);
    expect((await email.json()).data).toMatchObject({
      source_type: "email", display_title: "Email", display_detail: "Email message", availability: "available",
    });
    expect((await post(globalTaskId, globalProject.name, "email", emailSourceId)).status).toBe(200);

    expect((await post(localTaskId, localProject.name, "context", context.upload.rag_source_id)).status).toBe(201);
    expect((await post(localTaskId, localProject.name, "docs", String(page.id))).status).toBe(404);
    docs.linkProject(page.id, localProject.id);
    expect((await post(localTaskId, localProject.name, "docs", String(page.id))).status).toBe(201);
    expect((await post(globalTaskId, globalProject.name, "docs", String(page.id))).status).toBe(201);
    expect((await post(localTaskId, localProject.name, "job", job.id)).status).toBe(201);
    expect((await post(globalTaskId, globalProject.name, "chat", chatSourceId)).status).toBe(201);
    expect(mocks.getSession).toHaveBeenCalledWith("session-1");

    mocks.getSession.mockResolvedValue(session("Changed upstream title"));
    const listed = await fetch(url(globalTaskId, "/references", globalProject.name));
    expect(listed.status).toBe(200);
    const body = await listed.json();
    const chat = body.data.find((reference: { source_type: string }) => reference.source_type === "chat");
    expect(chat).toMatchObject({ display_title: "OpenCode chat", availability: "available" });
    const serialized = JSON.stringify(body);
    for (const forbidden of ["Secret subject", "Secret snippet", "authorization", "Secret prompt", "content", "headers", "attachments", "reasoning", "tool", "logs"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("rejects malformed, unauthorized, foreign, and client-supplied display metadata without existence leaks", async () => {
    const post = (taskId: string, project: string, body: unknown) => fetch(
      url(taskId, "/references", project),
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    const malformed = await post(globalTaskId, globalProject.name, { source_type: "email", source_id: "not-base64url=" });
    expect(malformed.status).toBe(422);
    expect((await post(globalTaskId, globalProject.name, {
      source_type: "email", source_id: emailSourceId, display_title: "attacker supplied",
    })).status).toBe(422);
    expect((await post(globalTaskId, globalProject.name, { source_type: "unknown", source_id: "x" })).status).toBe(422);
    expect((await post(localTaskId, localProject.name, { source_type: "email", source_id: emailSourceId })).status).toBe(404);
    expect((await post(globalTaskId, otherProject.name, { source_type: "email", source_id: emailSourceId })).status).toBe(404);
    expect((await post(globalTaskId, globalProject.name, { source_type: "job", source_id: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);
    expect((await post(localTaskId, localProject.name, { source_type: "chat", source_id: chatSourceId })).status).toBe(404);

    const unmapped = tasks.createChatTaskSourceId(sourceInstance, "unmapped-project", "session-1");
    const quarantined = tasks.createChatTaskSourceId(sourceInstance, "quarantined-project", "session-1");
    const foreignInstance = tasks.createChatTaskSourceId("https://foreign-opencode.example", "upstream-project", "session-1");
    const foreignMapping = tasks.createChatTaskSourceId(sourceInstance, "foreign-mapped-project", "session-1");
    usage.quarantineOpenCodeProject(sourceInstance, "quarantined-project", "session-1", "2026-08-01T00:00:00.000Z");
    usage.mapOpenCodeProject(sourceInstance, "foreign-mapped-project", otherProject.id);
    const pathProbe = Buffer.from(JSON.stringify([sourceInstance, "../global/config", "session-1"]), "utf8").toString("base64url");
    mocks.getSession.mockResolvedValue(session());
    expect((await post(globalTaskId, globalProject.name, { source_type: "chat", source_id: unmapped })).status).toBe(404);
    expect((await post(globalTaskId, globalProject.name, { source_type: "chat", source_id: quarantined })).status).toBe(404);
    expect((await post(globalTaskId, globalProject.name, { source_type: "chat", source_id: foreignInstance })).status).toBe(404);
    expect((await post(globalTaskId, globalProject.name, { source_type: "chat", source_id: foreignMapping })).status).toBe(404);
    expect((await post(globalTaskId, globalProject.name, { source_type: "chat", source_id: pathProbe })).status).toBe(422);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("reports deleted DB sources as missing, live-chat failures as unavailable, and deletes in scoped idempotent fashion", async () => {
    const before = await fetch(url(globalTaskId, "/references", globalProject.name));
    const beforeBody = await before.json();
    const email = beforeBody.data.find((reference: { source_type: string }) => reference.source_type === "email");
    const chat = beforeBody.data.find((reference: { source_type: string }) => reference.source_type === "chat");
    expect(email).toBeDefined();
    expect(chat).toBeDefined();

    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "DELETE FROM email_cache WHERE account_id = ? AND folder = ? AND uid = ?",
    ).run("account-a", "INBOX", "42");
    mocks.getSession.mockResolvedValue({ error: { code: "NETWORK_ERROR", message: "unavailable" } });
    const listed = await fetch(url(globalTaskId, "/references", globalProject.name));
    const listedBody = await listed.json();
    expect(listedBody.data.find((reference: { source_type: string }) => reference.source_type === "email")).toMatchObject({ availability: "missing" });
    expect(listedBody.data.find((reference: { source_type: string }) => reference.source_type === "chat")).toMatchObject({ availability: "unavailable" });

    const deleted = await fetch(url(globalTaskId, "/references", globalProject.name, `&reference_id=${email.id}`), { method: "DELETE" });
    expect(deleted.status).toBe(204);
    const repeated = await fetch(url(globalTaskId, `/references/${email.id}`, globalProject.name), { method: "DELETE" });
    expect(repeated.status).toBe(404);
    const foreign = await fetch(url(globalTaskId, `/references/${chat.id}`, otherProject.name), { method: "DELETE" });
    expect(foreign.status).toBe(404);
  });
});
