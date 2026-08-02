import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createPage, createSpace, linkProject } from "../lib/tools/docs.js";
import { ingestContextRagDocument } from "../lib/tools/context-rag.js";
import { createJob } from "../lib/tools/jobs.js";
import { createProject } from "../lib/tools/projects.js";
import {
  createChatTaskSourceReference,
  createChatTaskWithSourceReference,
  createEmailTaskSourceId,
  createTaskWithSourceReference,
  completeTask,
  createTask,
  createTaskSourceReference,
  createChatTaskSourceId,
  deleteTask,
  getTaskSourceReferenceTaskScope,
  isStoredTaskSourceReferenceAvailable,
  isValidTaskSourceReferenceIdentity,
  listTaskSourceReferences,
} from "../lib/tools/tasks.js";
import { TaskCaptureInputSchema } from "../lib/schema.js";

let directory = "";
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
const originalHome = process.env.INGENIUM_HOME;

function setup() {
  directory = mkdtempSync(join(tmpdir(), "ingenium-task-source-references-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  process.env.INGENIUM_HOME = join(directory, "home");
  resetDbForTest();
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
  const global = createProject("task-refs-global", true);
  const local = createProject("task-refs-local");
  const other = createProject("task-refs-other");
  return { db, global, local, other };
}

afterEach(() => {
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalHome === undefined) delete process.env.INGENIUM_HOME;
  else process.env.INGENIUM_HOME = originalHome;
});

describe("task source references", () => {
  it("atomically captures one source into one todo task and returns the first reference on retry", () => {
    const { db, global } = setup();
    const sourceId = createEmailTaskSourceId("capture-account", "Archive/2026", "capture-42");
    db.prepare(
      `INSERT INTO email_cache
       (account_id, folder, uid, subject, snippet, envelope_json, cached_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "capture-account",
      "Archive/2026",
      "capture-42",
      "Sensitive email subject",
      "Sensitive email snippet",
      '{"authorization":"secret"}',
      "2026-08-01T00:00:00.000Z",
    );
    const beforeTasks = (db.prepare("SELECT count(*) AS count FROM tasks WHERE project_id = ?").get(global.id) as { count: number }).count;
    const beforeActivity = (db.prepare("SELECT count(*) AS count FROM task_activity").get() as { count: number }).count;

    const created = createTaskWithSourceReference(global.id, "  Follow up with customer  ", "email", sourceId);
    expect(created.status).toBe("created");
    if (created.status !== "created") throw new Error("Expected task capture");
    expect(created.task).toMatchObject({ project_id: global.id, title: "Follow up with customer", column_id: "todo" });
    expect(created.reference).toMatchObject({ task_id: created.task.id, source_type: "email", source_id: sourceId });

    const duplicate = createTaskWithSourceReference(global.id, "Changed retry title", "email", sourceId);
    expect(duplicate.status).toBe("duplicate");
    if (duplicate.status !== "duplicate") throw new Error("Expected duplicate task capture");
    expect(duplicate.task.id).toBe(created.task.id);
    expect(duplicate.task.title).toBe("Follow up with customer");
    expect(duplicate.reference.id).toBe(created.reference.id);
    expect((db.prepare("SELECT count(*) AS count FROM tasks WHERE project_id = ?").get(global.id) as { count: number }).count)
      .toBe(beforeTasks + 1);
    expect((db.prepare("SELECT count(*) AS count FROM task_activity").get() as { count: number }).count)
      .toBe(beforeActivity + 1);
    expect(JSON.stringify(created)).not.toContain("Sensitive email");
    expect(JSON.stringify(created)).not.toContain("authorization");
  });

  it("rejects malformed capture inputs and leaves no task or activity for missing or foreign sources", () => {
    const { db, global, local, other } = setup();
    const foreignContext = ingestContextRagDocument(other.id, {
      title: "Foreign handoff",
      content: "Foreign context body must not create a local task.",
    });
    const localEmailId = createEmailTaskSourceId("local-account", "INBOX", "43");
    db.prepare(
      "INSERT INTO email_cache (account_id, folder, uid, cached_at) VALUES (?, ?, ?, ?)",
    ).run("local-account", "INBOX", "43", "2026-08-01T00:00:00.000Z");
    const beforeTasks = (db.prepare("SELECT count(*) AS count FROM tasks").get() as { count: number }).count;
    const beforeActivity = (db.prepare("SELECT count(*) AS count FROM task_activity").get() as { count: number }).count;

    expect(createTaskWithSourceReference(local.id, "Foreign source", "context", foreignContext.upload.rag_source_id))
      .toEqual({ status: "not_found" });
    expect(createTaskWithSourceReference(local.id, "Email outside global", "email", localEmailId))
      .toEqual({ status: "not_found" });
    expect(() => createTaskWithSourceReference(global.id, "Bad source", "email", "not-base64url=")).toThrow();
    expect((db.prepare("SELECT count(*) AS count FROM tasks").get() as { count: number }).count).toBe(beforeTasks);
    expect((db.prepare("SELECT count(*) AS count FROM task_activity").get() as { count: number }).count).toBe(beforeActivity);

    expect(TaskCaptureInputSchema.safeParse({
      source_type: "email",
      title: "Valid title",
      account_id: "local-account",
      folder: "INBOX",
      uid: "43",
      display_title: "client metadata",
    }).success).toBe(false);
    expect(TaskCaptureInputSchema.safeParse({
      source_type: "docs",
      title: "Documentation task",
      page_id: 1,
      source_id: "1",
    }).success).toBe(false);
    expect(TaskCaptureInputSchema.safeParse({
      source_type: "chat",
      title: "Chat task",
      session_id: "session-1",
      projectID: "client-supplied",
      messages: ["transcript"],
      content: "transcript",
    }).success).toBe(false);
  });

  it("atomically captures authorized docs and API-verified chats without source bodies", () => {
    const { db, global, local, other } = setup();
    const space = createSpace("Capture docs", "capture-docs");
    const page = createPage(space.id, "Release plan", "release-plan", "docs-body-sentinel").page!;
    linkProject(page.id, local.id);
    const chatSourceId = createChatTaskSourceId("https://opencode.example.test", "upstream-project", "session-1");
    const beforeTasks = (db.prepare("SELECT count(*) AS count FROM tasks").get() as { count: number }).count;

    const docsCapture = createTaskWithSourceReference(local.id, "Review release plan", "docs", String(page.id));
    expect(docsCapture.status).toBe("created");
    if (docsCapture.status !== "created") throw new Error("Expected docs capture");
    expect(docsCapture.reference).toMatchObject({
      source_type: "docs",
      display_title: "Release plan",
      display_detail: "Documentation page",
    });
    const docsDuplicate = createTaskWithSourceReference(local.id, "Changed retry title", "docs", String(page.id));
    expect(docsDuplicate.status).toBe("duplicate");
    if (docsDuplicate.status !== "duplicate") throw new Error("Expected docs duplicate");
    expect(docsDuplicate.task.id).toBe(docsCapture.task.id);

    const chatCapture = createChatTaskWithSourceReference(
      global.id,
      "Review OpenCode work",
      chatSourceId,
      { sourceTimestamp: "2026-08-01T00:00:00.000Z" },
    );
    expect(chatCapture.status).toBe("created");
    if (chatCapture.status !== "created") throw new Error("Expected chat capture");
    expect(chatCapture.reference).toMatchObject({
      source_type: "chat",
      display_title: "OpenCode chat",
      display_detail: "OpenCode chat",
      source_timestamp: "2026-08-01T00:00:00.000Z",
    });
    const chatDuplicate = createChatTaskWithSourceReference(
      global.id,
      "Changed retry title",
      chatSourceId,
      { sourceTimestamp: null },
    );
    expect(chatDuplicate.status).toBe("duplicate");
    if (chatDuplicate.status !== "duplicate") throw new Error("Expected chat duplicate");
    expect(chatDuplicate.task.id).toBe(chatCapture.task.id);

    expect(createTaskWithSourceReference(other.id, "Foreign docs", "docs", String(page.id))).toEqual({ status: "not_found" });
    expect(createChatTaskWithSourceReference(local.id, "Local chat", chatSourceId, { sourceTimestamp: null }))
      .toEqual({ status: "not_found" });
    expect((db.prepare("SELECT count(*) AS count FROM tasks").get() as { count: number }).count).toBe(beforeTasks + 2);
    expect(JSON.stringify([docsCapture, chatCapture])).not.toContain("docs-body-sentinel");
    expect(JSON.stringify([docsCapture, chatCapture])).not.toContain("chat-transcript-sentinel");
  });

  it("creates idempotent metadata-only references for each trusted source type", () => {
    const { db, global, local } = setup();
    const globalTask = createTask(global.id, "Global source task");
    const localTask = createTask(local.id, "Local source task");
    const emailId = createEmailTaskSourceId("account-a", "INBOX", "42");
    db.prepare(
      `INSERT INTO email_cache
       (account_id, folder, uid, subject, snippet, envelope_json, cached_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("account-a", "INBOX", "42", "Secret subject", "Secret snippet", '{"authorization":"secret"}', "2026-08-01T00:00:00.000Z");

    const context = ingestContextRagDocument(local.id, {
      title: "Context handoff",
      content: "Context body must never be copied into the task reference.",
    });
    const space = createSpace("Task source docs", "task-source-docs");
    const page = createPage(space.id, "Linked document", "linked-document", "Document body").page!;
    const job = createJob(local.id, "Nightly report", "Sensitive job description", "agent", "Sensitive prompt");

    const email = createTaskSourceReference(global.id, globalTask.id, "email", emailId);
    expect(email.status).toBe("created");
    if (email.status === "not_found") throw new Error("Expected email reference");
    expect(email).toMatchObject({ reference: { display_title: "Email", display_detail: "Email message" } });
    const duplicate = createTaskSourceReference(global.id, globalTask.id, "email", emailId);
    expect(duplicate.status).toBe("duplicate");
    if (duplicate.status === "not_found") throw new Error("Expected duplicate email reference");
    expect(duplicate.reference.id).toBe(email.reference.id);

    expect(createTaskSourceReference(local.id, localTask.id, "context", context.upload.rag_source_id).status).toBe("created");
    expect(createTaskSourceReference(local.id, localTask.id, "docs", String(page.id)).status).toBe("not_found");
    linkProject(page.id, local.id);
    expect(createTaskSourceReference(local.id, localTask.id, "docs", String(page.id)).status).toBe("created");
    expect(createTaskSourceReference(global.id, globalTask.id, "docs", String(page.id)).status).toBe("created");
    expect(createTaskSourceReference(local.id, localTask.id, "job", job.id).status).toBe("created");
    expect(createChatTaskSourceReference(
      global.id,
      globalTask.id,
      createChatTaskSourceId("https://opencode.example.test", "upstream-project", "session-1"),
      { sourceTimestamp: "2026-08-01T00:00:00.000Z" },
    ).status).toBe("created");

    expect(completeTask(global.id, globalTask.id)?.column_id).toBe("done");

    const references = listTaskSourceReferences(global.id, globalTask.id);
    expect(references.map((reference) => reference.source_type).sort()).toEqual(["chat", "docs", "email"]);
    for (const reference of references) {
      expect(reference).not.toHaveProperty("content");
      expect(reference).not.toHaveProperty("snippet");
      expect(reference).not.toHaveProperty("headers");
      expect(reference).not.toHaveProperty("prompt_template");
    }
  });

  it("enforces project ownership, global-only source policies, immutability, and source availability", () => {
    const { db, global, local, other } = setup();
    const globalTask = createTask(global.id, "Global task");
    const localTask = createTask(local.id, "Local task");
    const emailId = createEmailTaskSourceId("account-b", "Archive", "43");
    db.prepare(
      "INSERT INTO email_cache (account_id, folder, uid, cached_at) VALUES (?, ?, ?, ?)",
    ).run("account-b", "Archive", "43", "2026-08-01T00:00:00.000Z");
    const foreignJob = createJob(other.id, "Foreign job", undefined, "agent", "prompt");
    const localJob = createJob(local.id, "Local job", undefined, "agent", "prompt");

    expect(createTaskSourceReference(local.id, localTask.id, "email", emailId).status).toBe("not_found");
    expect(createTaskSourceReference(local.id, localTask.id, "job", foreignJob.id).status).toBe("not_found");
    expect(createTaskSourceReference(global.id, globalTask.id, "email", emailId).status).toBe("created");
    const jobReference = createTaskSourceReference(local.id, localTask.id, "job", localJob.id);
    expect(jobReference.status).toBe("created");
    if (jobReference.status === "not_found") throw new Error("Expected job reference");

    const emailReference = listTaskSourceReferences(global.id, globalTask.id)[0]!;
    expect(isStoredTaskSourceReferenceAvailable(emailReference)).toBe(true);
    db.prepare("DELETE FROM email_cache WHERE account_id = ? AND folder = ? AND uid = ?").run("account-b", "Archive", "43");
    expect(isStoredTaskSourceReferenceAvailable(emailReference)).toBe(false);

    expect(() => db.prepare("UPDATE task_source_references SET display_title = 'tampered' WHERE id = ?")
      .run(jobReference.reference.id)).toThrow(/immutable/);
    expect(deleteTask(local.id, localTask.id)).toBe(true);
    expect(listTaskSourceReferences(local.id, localTask.id)).toEqual([]);
    expect(getTaskSourceReferenceTaskScope(other.id, globalTask.id)).toBeUndefined();
    expect(isValidTaskSourceReferenceIdentity("email", "not-base64url=")).toBe(false);
    expect(isValidTaskSourceReferenceIdentity("docs", "01")).toBe(false);
    expect(() => createChatTaskSourceId("https://opencode.example.test", "../global/config", "session-1"))
      .toThrow("Invalid task source reference input");
  });

  it("uses generic display titles when a trusted source title resembles a secret", () => {
    const { global, local } = setup();
    const globalTask = createTask(global.id, "Global task");
    const localTask = createTask(local.id, "Local task");
    const context = ingestContextRagDocument(local.id, {
      title: "sk-abcdefghijklmnopqrstuvwxyz",
      content: "Safe context body",
    });
    const space = createSpace("Secret-title docs", "secret-title-docs");
    const page = createPage(space.id, "api_key=abcdefghijklmnopqrstuvwxyz", "secret-title-page", "Safe docs body").page!;
    linkProject(page.id, local.id);
    const job = createJob(local.id, "ghp_abcdefghijklmnopqrstuvwxyz123456", undefined, "agent", "prompt");

    const contextReference = createTaskSourceReference(local.id, localTask.id, "context", context.upload.rag_source_id);
    const docsReference = createTaskSourceReference(local.id, localTask.id, "docs", String(page.id));
    const jobReference = createTaskSourceReference(local.id, localTask.id, "job", job.id);
    const chatReference = createChatTaskSourceReference(
      global.id,
      globalTask.id,
      createChatTaskSourceId("https://opencode.example.test", "upstream-project", "session-2"),
      { sourceTimestamp: null },
    );

    if (contextReference.status === "not_found" || docsReference.status === "not_found" || jobReference.status === "not_found" || chatReference.status === "not_found") {
      throw new Error("Expected trusted source references");
    }
    expect(contextReference.reference.display_title).toBe("Context source");
    expect(docsReference.reference.display_title).toBe("Documentation page");
    expect(jobReference.reference.display_title).toBe("Job");
    expect(chatReference.reference.display_title).toBe("OpenCode chat");
  });

  it("fails closed when migration 072 is partially applied", () => {
    const { db } = setup();
    db.prepare("DROP TRIGGER task_source_references_immutable_update").run();
    resetDbForTest();
    expect(() => getDb(process.env.INGENIUM_CORE_DB_PATH)).toThrow(
      "Migration 072 is in a PARTIAL state. Missing required components: task_source_references_immutable_update trigger. Restore the migration's complete schema before retrying.",
    );
  });
});
