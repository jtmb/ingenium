import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildContextImportEntries,
  CONTEXT_IMPORT_CHUNK_CHARS,
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

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
      return response({
        data: {
          data: messages.map((message) => ({ idempotency_key: message.idempotencyKey })),
          nextCursor: null,
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
    expect(Object.keys(nativeTool.args)).toEqual(["title", "limit"]);
    const result = JSON.parse(toolResultText(await nativeTool.execute({ limit: 1, project: "caller-override" } as never, toolContext({
      sessionID: "tool-context-session",
      directory: "/tool-context-directory",
      worktree: "/tool-context-worktree",
    }))));

    expect(result).toMatchObject({ imported: true, appended: 1, skipped: 0 });
    expect(client.session.messages).toHaveBeenCalledWith({
      path: { id: "tool-context-session" },
      query: { directory: "/tool-context-directory", limit: 1 },
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
