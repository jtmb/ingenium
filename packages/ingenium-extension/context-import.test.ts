import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildContextImportEntries,
  CONTEXT_IMPORT_CHUNK_CHARS,
  CONTEXT_IMPORT_MAX_SOURCE_PAGES,
  CONTEXT_IMPORT_SOURCE_PAGE_SIZE,
} from "./context-import.js";

const project = "context-import-project";
const token = "t".repeat(32);

interface RequestRecord {
  path: string;
  project: string | null;
  authorization: string | null;
  body?: Record<string, unknown>;
}

interface StoredConversation {
  id: string;
  createBody: Record<string, unknown>;
}

interface StoredMessage {
  idempotencyKey: string;
  body: Record<string, unknown>;
}

let originalApiUrl: string | undefined;
let originalProject: string | undefined;
let originalToken: string | undefined;
let requests: RequestRecord[];
let conversations: Map<string, StoredConversation>;
let messages: StoredMessage[];
let failContextRequest = false;
let contextRateLimitAttempts = 0;

function response(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders,
  });
}

function sourcePage(data: unknown[], nextCursor: string | null = null, status = 200, headers: HeadersInit = {}) {
  const responseHeaders = new Headers(headers);
  if (nextCursor !== null) responseHeaders.set("X-Next-Cursor", nextCursor);
  return { data, response: new Response(null, { status, headers: responseHeaders }) };
}

function installApiMock(): void {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const headers = new Headers(init?.headers);
    let body: Record<string, unknown> | undefined;
    if (typeof init?.body === "string" && init.body.length > 0) body = JSON.parse(init.body) as Record<string, unknown>;
    requests.push({
      path: url.pathname,
      project: url.searchParams.get("project"),
      authorization: headers.get("Authorization"),
      body,
    });

    if (headers.get("Authorization") !== `Bearer ${token}`) return response({ error: { detail: "do not expose rejected bearer" } }, 401);
    if (url.pathname === "/api/v1/auth/preflight") return response({ data: {} });
    if (url.pathname === "/api/v1/projects") return response({ data: {} }, 201);
    if (failContextRequest && url.pathname.startsWith("/api/v1/context/")) {
      return response({ error: { detail: "absolute /secret/worktree and token must not leak" } }, 503);
    }
    if (contextRateLimitAttempts > 0 && url.pathname.startsWith("/api/v1/context/")) {
      contextRateLimitAttempts -= 1;
      return response({ error: { detail: "must not be read" } }, 429, { "Retry-After": "0" });
    }

    if (url.pathname === "/api/v1/context/conversations" && init?.method === "POST") {
      const key = headers.get("Idempotency-Key")!;
      const existing = conversations.get(key);
      if (existing) {
        if (JSON.stringify(existing.createBody) !== JSON.stringify(body)) return response({ error: { code: "IDEMPOTENCY_KEY_REUSED" } }, 409);
        return response({ data: { id: existing.id, revision: messages.length } }, 201);
      }
      const conversation = { id: "a8c8093f-dc51-45f3-bfa5-4d80e65cfd81", createBody: body! };
      conversations.set(key, conversation);
      return response({ data: { id: conversation.id, revision: messages.length } }, 201);
    }

    if (url.pathname === "/api/v1/context/conversations/a8c8093f-dc51-45f3-bfa5-4d80e65cfd81/messages" && init?.method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? "100");
      const offset = Number(url.searchParams.get("cursor") ?? "0");
      const page = messages.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      return response({
        data: {
          // Production Context lists exclude idempotency keys. The importer
          // must reconcile entries using the content-free summary projection.
          data: page.map((message) => ({
            role: message.body.role,
            content_hash: createHash("sha256").update(String(message.body.content), "utf8").digest("hex"),
            metadata: JSON.stringify(message.body.metadata),
          })),
          nextCursor: nextOffset < messages.length ? String(nextOffset) : null,
        },
      });
    }

    if (url.pathname === "/api/v1/context/conversations/a8c8093f-dc51-45f3-bfa5-4d80e65cfd81/messages" && init?.method === "POST") {
      const key = headers.get("Idempotency-Key")!;
      const existing = messages.find((message) => message.idempotencyKey === key);
      if (existing) return response({ data: { revision: messages.length, idempotent: true } }, 201);
      if (body?.expectedRevision !== messages.length) {
        return response({ error: { code: "REVISION_CONFLICT", currentRevision: messages.length } }, 409);
      }
      messages.push({ idempotencyKey: key, body: body! });
      return response({ data: { revision: messages.length, idempotent: false } }, 201);
    }

    return response({ error: { code: "NOT_FOUND" } }, 404);
  }));
}

function toolContext(overrides: Record<string, unknown> = {}) {
  return {
    sessionID: "current-session",
    messageID: "tool-message",
    agent: "ingenium",
    directory: "/safe/context-directory",
    worktree: "/safe/context-worktree",
    abort: new AbortController().signal,
    metadata: vi.fn(),
    ask: vi.fn(),
    ...overrides,
  };
}

function toolResultText(result: unknown): string {
  if (typeof result === "string") return result;
  const structured = result as { output?: unknown };
  if (typeof structured.output !== "string") throw new Error("Expected a text tool result");
  return structured.output;
}

function userMessage(id: string, text: string) {
  return { info: { id, role: "user", time: { created: 1 } }, parts: [{ type: "text", text }] };
}

function assistantMessage(id: string, text: string, completed: boolean) {
  return {
    info: { id, role: "assistant", time: completed ? { created: 2, completed: 3 } : { created: 2 } },
    parts: [{ type: "text", text }],
  };
}

function chronologicalUserMessage(id: string, text: string, created: number) {
  return { info: { id, role: "user", time: { created } }, parts: [{ type: "text", text }] };
}

function excludedMessage(id: string, created: number) {
  return { info: { id, role: "tool", time: { created } }, parts: [{ type: "text", text: "excluded" }] };
}

function paginatedSourceClient(source: unknown[]) {
  return {
    session: {
      messages: vi.fn(async ({ query }: { query: { cursor?: string; limit: number } }) => {
        const offset = query.cursor === undefined ? 0 : Number(query.cursor);
        const page = source.slice(offset, offset + query.limit);
        const nextOffset = offset + page.length;
        return sourcePage(page, nextOffset < source.length ? String(nextOffset) : null);
      }),
    },
  };
}

beforeEach(() => {
  originalApiUrl = process.env.INGENIUM_API_URL;
  originalProject = process.env.INGENIUM_PROJECT;
  originalToken = process.env.INGENIUM_API_TOKEN;
  process.env.INGENIUM_API_URL = "http://ingenium.test/api/v1";
  process.env.INGENIUM_PROJECT = project;
  process.env.INGENIUM_API_TOKEN = token;
  requests = [];
  conversations = new Map();
  messages = [];
  failContextRequest = false;
  contextRateLimitAttempts = 0;
  installApiMock();
  vi.resetModules();
});

afterEach(() => {
  if (originalApiUrl === undefined) delete process.env.INGENIUM_API_URL;
  else process.env.INGENIUM_API_URL = originalApiUrl;
  if (originalProject === undefined) delete process.env.INGENIUM_PROJECT;
  else process.env.INGENIUM_PROJECT = originalProject;
  if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalToken;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.sequential("current-session Context import", () => {
  it("filters ordered text parts, excludes synthetic and incomplete content, and chunks deterministically", () => {
    const longText = "x".repeat(CONTEXT_IMPORT_CHUNK_CHARS + 1);
    const entries = buildContextImportEntries("session-1", [
      {
        info: { id: "user-1", role: "user", time: { created: 1 } },
        parts: [
          { type: "text", text: " first user part " },
          { type: "reasoning", text: "excluded" },
          { type: "text", text: "ignored", ignored: true },
          { type: "file", path: "/private/file" },
          { type: "text", text: "second user part" },
        ],
      },
      assistantMessage("assistant-incomplete", "partial answer", false),
      {
        info: { id: "assistant-1", role: "assistant", time: { created: 2, completed: 3 } },
        parts: [
          { type: "step-start" },
          { type: "text", text: "finished answer" },
          { type: "text", text: "hidden", synthetic: true },
        ],
      },
      { info: { id: "tool-1", role: "tool" }, parts: [{ type: "text", text: "excluded" }] },
      userMessage("user-long", longText),
    ]);

    expect(entries.map((entry) => [entry.role, entry.content])).toEqual([
      ["user", "first user part\n\nsecond user part"],
      ["assistant", "finished answer"],
      ["user", longText.slice(0, CONTEXT_IMPORT_CHUNK_CHARS)],
      ["user", longText.slice(CONTEXT_IMPORT_CHUNK_CHARS)],
    ]);
    expect(entries[2]!.metadata).toMatchObject({ chunkIndex: 0, chunkCount: 2 });
    expect(entries[3]!.metadata).toMatchObject({ chunkIndex: 1, chunkCount: 2 });
    expect(entries.slice(2).map((entry) => entry.idempotencyKey)).toEqual(buildContextImportEntries("session-1", [
      userMessage("user-long", longText),
    ]).map((entry) => entry.idempotencyKey));
  });

  it("registers the canonical native tool from the loaded ResourceSync plugin, forwards only ToolContext session data, and uses protected requests", async () => {
    const sourceMessages = [userMessage("user-1", "Keep this request.")];
    const client = { session: { messages: vi.fn().mockResolvedValue({ data: sourceMessages }) } };
    const { ResourceSyncPlugin } = await import("./resource-sync.js");
    const plugin = await ResourceSyncPlugin({ worktree: "/safe/resource-sync-worktree", client });
    const nativeTool = plugin.tool.ingenium_context_import_current_session;

    expect(Object.keys(plugin.tool)).toEqual(["ingenium_context_import_current_session"]);
    expect(Object.keys(nativeTool.args)).toEqual(["title", "maxSourceEnvelopes"]);
    const result = JSON.parse(toolResultText(await nativeTool.execute({ maxSourceEnvelopes: 1, project: "caller-override" } as never, toolContext({
      sessionID: "tool-context-session",
      directory: "/tool-context-directory",
      worktree: "/tool-context-worktree",
    }))));

    expect(result).toMatchObject({ imported: true, appended: 1, skipped: 0 });
    expect(client.session.messages).toHaveBeenCalledWith({
      path: { id: "tool-context-session" },
      query: { directory: "/tool-context-directory", limit: 100 },
    });
    expect(requests.every((request) => request.authorization === `Bearer ${token}`)).toBe(true);
    expect(requests.filter((request) => request.path.startsWith("/api/v1/context/")).every((request) => request.project === project)).toBe(true);
    expect(JSON.stringify(requests)).not.toContain("caller-override");
  });

  it("replays without duplicates and appends changed or newly-completed assistant messages in sequence", async () => {
    const source = [
      userMessage("user-1", "Initial request"),
      assistantMessage("assistant-1", "incomplete", false),
    ];
    const client = { session: { messages: vi.fn(async () => ({ data: source })) } };
    const { createContextImportTool } = await import("./context-import.js");
    const nativeTool = createContextImportTool(client as never);

    expect(JSON.parse(toolResultText(await nativeTool.execute({}, toolContext())))).toMatchObject({ appended: 1, skipped: 0 });
    source[1] = assistantMessage("assistant-1", "Completed answer", true);
    expect(JSON.parse(toolResultText(await nativeTool.execute({}, toolContext())))).toMatchObject({ appended: 1, skipped: 1 });
    source[1] = assistantMessage("assistant-1", "Completed answer, corrected", true);
    expect(JSON.parse(toolResultText(await nativeTool.execute({}, toolContext())))).toMatchObject({ appended: 1, skipped: 1 });

    expect(conversations.size).toBe(1);
    expect(messages).toHaveLength(3);
    expect(messages.map((message) => message.body.expectedRevision)).toEqual([0, 1, 2]);
    expect(messages.map((message) => message.body.content)).toEqual([
      "Initial request",
      "Completed answer",
      "Completed answer, corrected",
    ]);
  });

  it("paginates all 1,262 source envelopes into 907 chronological entries and replays without truncation", async () => {
    const source = Array.from({ length: 1_262 }, (_, ordinal) => (
      ordinal < 907
        ? chronologicalUserMessage(`message-${ordinal}`, `message ${ordinal}`, ordinal)
        : excludedMessage(`excluded-${ordinal}`, ordinal)
    )).reverse();
    const client = paginatedSourceClient(source);
    const { createContextImportTool } = await import("./context-import.js");
    const nativeTool = createContextImportTool(client as never);
    conversations.set("context-import.v1.conversation.incomplete", {
      id: "legacy-incomplete-conversation",
      createBody: { legacy: true },
    });

    const first = JSON.parse(toolResultText(await nativeTool.execute({}, toolContext())));
    expect(first).toMatchObject({
      imported: true,
      appended: 907,
      skipped: 0,
      sourceEnvelopes: 1_262,
      sourceBounded: false,
    });
    expect(client.session.messages).toHaveBeenCalledTimes(13);
    expect(client.session.messages).toHaveBeenNthCalledWith(1, {
      path: { id: "current-session" },
      query: { directory: "/safe/context-directory", limit: 100 },
    });
    expect(messages).toHaveLength(907);
    expect(messages[0]!.body.content).toBe("message 0");
    expect(messages[906]!.body.content).toBe("message 906");
    expect(messages[906]!.body.expectedRevision).toBe(906);
    expect(messages[0]!.idempotencyKey).toMatch(/^context-import\.v2\.message\./);

    const replay = JSON.parse(toolResultText(await nativeTool.execute({}, toolContext())));
    expect(replay).toMatchObject({
      imported: true,
      appended: 0,
      skipped: 907,
      sourceEnvelopes: 1_262,
      sourceBounded: false,
    });
    expect(messages).toHaveLength(907);
    expect(conversations.size).toBe(2);
    expect([...conversations.keys()].some((key) => /^context-import\.v2\.conversation\./.test(key))).toBe(true);
  });

  it("supports more than 907 sequential revisions and idempotency keys", async () => {
    const client = paginatedSourceClient(Array.from({ length: 908 }, (_, ordinal) => (
      chronologicalUserMessage(`sequential-${ordinal}`, `sequential ${ordinal}`, ordinal)
    )));
    const { createContextImportTool } = await import("./context-import.js");
    const nativeTool = createContextImportTool(client as never);

    expect(JSON.parse(toolResultText(await nativeTool.execute({}, toolContext())))).toMatchObject({ appended: 908 });
    expect(messages).toHaveLength(908);
    expect(messages[907]!.body.expectedRevision).toBe(907);
    expect(new Set(messages.map((message) => message.idempotencyKey)).size).toBe(908);
  });

  it("uses a source-envelope bound only when explicitly requested", async () => {
    const client = paginatedSourceClient([
      chronologicalUserMessage("one", "one", 1),
      chronologicalUserMessage("two", "two", 2),
      chronologicalUserMessage("three", "three", 3),
    ]);
    const { createContextImportTool } = await import("./context-import.js");
    const nativeTool = createContextImportTool(client as never);

    const result = JSON.parse(toolResultText(await nativeTool.execute({ maxSourceEnvelopes: 2 }, toolContext())));
    expect(result).toMatchObject({ appended: 2, sourceEnvelopes: 2, sourceBounded: true });
    expect(messages.map((message) => message.body.content)).toEqual(["one", "two"]);
  });

  it("rejects malformed, looping, duplicate, and cap-overflow source snapshots before creating a conversation", async () => {
    const { createContextImportTool } = await import("./context-import.js");
    const loopingTool = createContextImportTool({
      session: {
        messages: vi.fn(async () => sourcePage([chronologicalUserMessage("loop", "private loop", 1)], "loop")),
      },
    } as never);
    const looping = JSON.parse(toolResultText(await loopingTool.execute({}, toolContext())));
    expect(looping).toMatchObject({ imported: false, reason: "source_invalid" });
    expect(JSON.stringify(looping)).not.toContain("private loop");

    const duplicateTool = createContextImportTool({
      session: {
        messages: vi.fn(async () => ({
          data: [
            chronologicalUserMessage("duplicate", "first", 1),
            chronologicalUserMessage("duplicate", "second", 2),
          ],
        })),
      },
    } as never);
    expect(JSON.parse(toolResultText(await duplicateTool.execute({}, toolContext())))).toMatchObject({
      imported: false,
      reason: "source_invalid",
    });

    const malformedTool = createContextImportTool({
      session: { messages: vi.fn(async () => ({ data: { not: "an array" } })) },
    } as never);
    expect(JSON.parse(toolResultText(await malformedTool.execute({}, toolContext())))).toMatchObject({
      imported: false,
      reason: "source_invalid",
    });

    let page = 0;
    const overflowTool = createContextImportTool({
      session: {
        messages: vi.fn(async () => {
          const currentPage = page;
          page += 1;
          return sourcePage(
            Array.from({ length: CONTEXT_IMPORT_SOURCE_PAGE_SIZE }, (_, index) => (
              chronologicalUserMessage(`page-${currentPage}-${index}`, "bounded", currentPage * 100 + index)
            )),
            `next-${page}`,
          );
        }),
      },
    } as never);
    expect(JSON.parse(toolResultText(await overflowTool.execute({}, toolContext())))).toMatchObject({
      imported: false,
      reason: "bounds",
    });
    expect(page).toBe(CONTEXT_IMPORT_MAX_SOURCE_PAGES);
    expect(conversations.size).toBe(0);
  });

  it("retries SDK and Context API rate limits only when Retry-After is supplied", async () => {
    let sourceAttempts = 0;
    const client = {
      session: {
        messages: vi.fn(async () => {
          sourceAttempts += 1;
          if (sourceAttempts === 1) {
            return sourcePage([], null, 429, { "Retry-After": "0" });
          }
          return sourcePage([chronologicalUserMessage("retry", "retry succeeds", 1)]);
        }),
      },
    };
    contextRateLimitAttempts = 1;
    const { createContextImportTool } = await import("./context-import.js");
    const nativeTool = createContextImportTool(client as never);

    expect(JSON.parse(toolResultText(await nativeTool.execute({}, toolContext())))).toMatchObject({ appended: 1 });
    expect(sourceAttempts).toBe(2);
    expect(requests.filter((request) => request.path === "/api/v1/context/conversations")).toHaveLength(2);

    const noRetryMessages = vi.fn(async () => sourcePage([], null, 429));
    const withoutRetryAfter = createContextImportTool({
      session: { messages: noRetryMessages },
    } as never);
    expect(JSON.parse(toolResultText(await withoutRetryAfter.execute({}, toolContext())))).toMatchObject({
      imported: false,
      reason: "source_unavailable",
    });
    expect(noRetryMessages).toHaveBeenCalledTimes(1);
  });

  it("returns content-free failures for unavailable source, authentication, and API errors", async () => {
    const { createContextImportTool } = await import("./context-import.js");
    const sourceFailureTool = createContextImportTool({ session: { messages: vi.fn().mockResolvedValue({ error: "source /private/path" }) } } as never);
    const sourceFailure = toolResultText(await sourceFailureTool.execute({}, toolContext()));
    expect(sourceFailure).toContain('"reason":"source_unavailable"');
    expect(sourceFailure).not.toContain("/private/path");

    failContextRequest = true;
    const apiFailureTool = createContextImportTool({ session: { messages: vi.fn().mockResolvedValue({ data: [userMessage("user-1", "body must remain private")] }) } } as never);
    const apiFailure = toolResultText(await apiFailureTool.execute({}, toolContext()));
    expect(apiFailure).toContain('"reason":"unavailable"');
    expect(apiFailure).not.toContain("body must remain private");
    expect(apiFailure).not.toContain("/secret/worktree");

    failContextRequest = false;
    process.env.INGENIUM_API_TOKEN = "x".repeat(32);
    const authenticationFailureTool = createContextImportTool({ session: { messages: vi.fn().mockResolvedValue({ data: [userMessage("user-2", "authentication body")] }) } } as never);
    const authenticationFailure = toolResultText(await authenticationFailureTool.execute({}, toolContext()));
    expect(authenticationFailure).toContain('"reason":"authentication"');
    expect(authenticationFailure).not.toContain("authentication body");
    expect(authenticationFailure).not.toContain("Bearer");
  });
});
