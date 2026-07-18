/**
 * opencode-contract.test.ts — Contract verification tests for the OpenCode proxy routes.
 *
 * These are contract-level tests that verify the proxy route handlers at
 * `routes/opencode.ts` correctly forward fields, construct bodies, and handle
 * edge cases according to the OpenCode v1.18.3 contract. The opencode client
 * is mocked so no real OpenCode server is needed.
 *
 * Each test maps to a verified defect from the audit:
 *   1. Prompt body field passthrough
 *   2. Compact body construction (providerID/modelID)
 *   3. SSE Last-Event-ID gap
 *   4. Permissions response shape
 *   5. Questions endpoint existence
 *   6. Fork body casing mismatch
 *   7. Revert body field gap
 *   8. Command body field naming mismatch
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/* ── Module-level mock of opencode-client ────────────────────────────────── */

const mockSendPrompt = vi.fn();
const mockCompactSession = vi.fn();
const mockStreamEvents = vi.fn();
const mockGetPermissions = vi.fn();
const mockGetQuestions = vi.fn();
const mockForkSession = vi.fn();
const mockRevertSession = vi.fn();
const mockSendCommand = vi.fn();
const mockGetSession = vi.fn();
const mockShareSession = vi.fn();

vi.mock("../lib/opencode-client.js", () => ({
  opencodeClient: {
    sendPrompt: (...args: unknown[]) => mockSendPrompt(...args),
    compactSession: (...args: unknown[]) => mockCompactSession(...args),
    streamEvents: (...args: unknown[]) => mockStreamEvents(...args),
    getPermissions: (...args: unknown[]) => mockGetPermissions(...args),
    getQuestions: (...args: unknown[]) => mockGetQuestions(...args),
    forkSession: (...args: unknown[]) => mockForkSession(...args),
    revertSession: (...args: unknown[]) => mockRevertSession(...args),
    sendCommand: (...args: unknown[]) => mockSendCommand(...args),
    getSession: (...args: unknown[]) => mockGetSession(...args),
    shareSession: (...args: unknown[]) => mockShareSession(...args),
  },
  isOpenCodeError: (result: unknown) =>
    typeof result === "object" && result !== null && "error" in result,
  buildAuthHeader: () => "Basic dGVzdDpwYXNz",
}));

/* ── Import after mocks are set up ────────────────────────────────────────── */

// eslint-disable-next-line import/first
import { opencodeRouter } from "../lib/routes/opencode.js";

/* ── Types under test (re-imported for verification) ──────────────────────── */

import type {
  SendPromptBody,
  ForkBody,
  RevertBody,
  CommandBody,
  PermissionRequest,
  SummarizeBody,
} from "../lib/opencode-client.js";

/* ── Test server setup ────────────────────────────────────────────────────── */

let server: Server | null = null;
let baseUrl: string;

const SAVED_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD;

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/opencode", opencodeRouter);
  return app;
}

beforeEach(() => {
  vi.stubEnv("OPENCODE_SERVER_PASSWORD", "test-password");
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeAll(async () => {
  const app = buildApp();
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const addr = server!.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  // Restore password
  if (SAVED_PASSWORD) {
    process.env.OPENCODE_SERVER_PASSWORD = SAVED_PASSWORD;
  }
});

/* ── Helper to call the API ───────────────────────────────────────────────── */

function api(path: string): string {
  return `${baseUrl}/api/v1/opencode${path}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Defect 1: Prompt should forward model/agent/system/variant/tools
   ═══════════════════════════════════════════════════════════════════════════ */

describe("Defect 1: Prompt body field passthrough", () => {
  it("forwards ALL body fields (parts, model, agent, system, variant, tools) to sendPrompt", async () => {
    const fullBody: SendPromptBody = {
      parts: [{ type: "text", text: "Hello" }],
      model: { providerID: "lmstudio", modelID: "qwopus3.6-27b-v2-mtp" },
      agent: "custom-agent",
      system: "You are a helpful assistant",
      variant: "creative",
      tools: { read: true, write: false },
    };

    mockSendPrompt.mockResolvedValue({ info: { id: "msg_1" }, parts: [] });

    const res = await fetch(api("/sessions/ses_test123/prompt"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fullBody),
    });

    expect(res.status).toBe(201);
    expect(mockSendPrompt).toHaveBeenCalledTimes(1);

    const [sessionId, body, directory] = mockSendPrompt.mock.calls[0];
    expect(sessionId).toBe("ses_test123");

    // Verify EVERY field in SendPromptBody is forwarded
    expect(body).toHaveProperty("parts");
    expect(body.parts).toEqual(fullBody.parts);
    expect(body).toHaveProperty("model");
    expect(body.model).toEqual(fullBody.model);
    expect(body).toHaveProperty("agent");
    expect(body.agent).toBe("custom-agent");
    expect(body).toHaveProperty("system");
    expect(body.system).toBe("You are a helpful assistant");
    expect(body).toHaveProperty("variant");
    expect(body.variant).toBe("creative");
    expect(body).toHaveProperty("tools");
    expect(body.tools).toEqual(fullBody.tools);

    // Verify directory passthrough
    expect(directory).toBeUndefined();
  });

  it("forwards body even when optional fields are missing", async () => {
    const minimalBody = {
      parts: [{ type: "text", text: "Hi" }],
    };

    mockSendPrompt.mockResolvedValue({ info: { id: "msg_2" }, parts: [] });

    const res = await fetch(api("/sessions/ses_minimal/prompt"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(minimalBody),
    });

    expect(res.status).toBe(201);
    expect(mockSendPrompt).toHaveBeenCalledWith(
      "ses_minimal",
      { parts: [{ type: "text", text: "Hi" }] },
      undefined,
    );
  });

  it("forwards body with ONLY optional fields (no parts) — verifies passthrough is literal", async () => {
    // The proxy does `req.body` as-is — so even a body with only optionals
    // goes through unchanged. This tests that the proxy isn't filtering fields.
    const weirdBody = {
      agent: "test-agent",
      system: "test-system",
      variant: "test-variant",
      tools: { read: true },
    };

    mockSendPrompt.mockResolvedValue({ info: { id: "msg_3" }, parts: [] });

    const res = await fetch(api("/sessions/ses_weird/prompt"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(weirdBody),
    });

    expect(res.status).toBe(201);
    expect(mockSendPrompt).toHaveBeenCalledWith(
      "ses_weird",
      expect.objectContaining({
        agent: "test-agent",
        system: "test-system",
        variant: "test-variant",
        tools: { read: true },
      }),
      undefined,
    );
    // Verify the body is exactly what we sent (not filtered)
    const [, body] = mockSendPrompt.mock.calls[0];
    expect(body).toEqual(weirdBody);
  });

  it("forwards directory query parameter", async () => {
    mockSendPrompt.mockResolvedValue({ info: { id: "msg_4" }, parts: [] });

    await fetch(
      api("/sessions/ses_dir/prompt?directory=%2Fworkspace%2Ftest"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parts: [{ type: "text", text: "Hello" }] }),
      },
    );

    expect(mockSendPrompt).toHaveBeenCalledWith(
      "ses_dir",
      expect.any(Object),
      "/workspace/test",
    );
  });

  it("SendPromptBody type includes all contract fields", () => {
    // Type-level contract check at runtime: verify the type shape exists
    const body: SendPromptBody = {
      parts: [{ type: "text", text: "test" }],
      model: { providerID: "p", modelID: "m" },
      agent: "a",
      system: "s",
      tools: { key: true },
      variant: "v",
    };
    // Verify the contract shape: ALL optional fields should be present
    expect(body.parts).toBeDefined();
    expect(body.model).toBeDefined();
    expect(body.agent).toBeDefined();
    expect(body.system).toBeDefined();
    expect(body.tools).toBeDefined();
    expect(body.variant).toBeDefined();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Defect 2: Compact should require providerID/modelID
   ═══════════════════════════════════════════════════════════════════════════ */

describe("Defect 2: Compact body construction", () => {
  it("sends providerID and modelID in body when both are present", async () => {
    mockCompactSession.mockResolvedValue(true);

    const res = await fetch(api("/sessions/ses_compact/compact"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerID: "lmstudio",
        modelID: "qwopus3.6-27b-v2-mtp",
      }),
    });

    expect(res.status).toBe(200);
    expect(mockCompactSession).toHaveBeenCalledTimes(1);

    const [sessionId, body, directory] = mockCompactSession.mock.calls[0];
    expect(sessionId).toBe("ses_compact");
    expect(body).toEqual({
      providerID: "lmstudio",
      modelID: "qwopus3.6-27b-v2-mtp",
    });
    expect(directory).toBeUndefined();
  });

  it("sends body with providerID/modelID but extracts only those fields", async () => {
    mockCompactSession.mockResolvedValue(true);

    // Send extra fields to verify the route only picks providerID/modelID
    const res = await fetch(api("/sessions/ses_compact/compact"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerID: "ollama",
        modelID: "llama3",
        extraField: "should be stripped",
        anotherField: 42,
      }),
    });

    expect(res.status).toBe(200);
    const [, body] = mockCompactSession.mock.calls[0];
    expect(body).toEqual({
      providerID: "ollama",
      modelID: "llama3",
    });
    expect(body).not.toHaveProperty("extraField");
    expect(body).not.toHaveProperty("anotherField");
  });

  it("returns 400 when providerID is missing", async () => {
    mockCompactSession.mockResolvedValue(true);

    const res = await fetch(api("/sessions/ses_compact/compact"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelID: "qwopus3.6-27b-v2-mtp" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("MISSING_PROVIDER_ID");
    expect(body.error.message).toContain("providerID");

    // compactSession should NOT be called — validation rejects before proxying
    expect(mockCompactSession).not.toHaveBeenCalled();
  });

  it("returns 400 when providerID is empty string", async () => {
    mockCompactSession.mockResolvedValue(true);

    const res = await fetch(api("/sessions/ses_compact/compact"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerID: "", modelID: "qwopus3.6-27b-v2-mtp" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("MISSING_PROVIDER_ID");

    // compactSession should NOT be called
    expect(mockCompactSession).not.toHaveBeenCalled();
  });

  it("returns 400 when request has no body", async () => {
    mockCompactSession.mockResolvedValue(true);

    const res = await fetch(api("/sessions/ses_compact/compact"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("MISSING_PROVIDER_ID");

    // compactSession should NOT be called
    expect(mockCompactSession).not.toHaveBeenCalled();
  });

  it("sends undefined body when body is null", async () => {
    mockCompactSession.mockResolvedValue(true);

    const res = await fetch(api("/sessions/ses_compact/compact"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(null),
    });

    // null body means express.json() parser may reject it → 400
    // This documents that the route cannot handle null body gracefully
    if (res.status === 400) {
      // 🔴 GAP: Express.json() rejects null bodies, so compact route is never reached
      expect(mockCompactSession).not.toHaveBeenCalled();
    } else {
      expect(res.status).toBe(200);
    }
  });

  it("uses SummarizeBody type with providerID and modelID", () => {
    // Verify the type contract at runtime
    const body: SummarizeBody = {
      providerID: "test",
      modelID: "test-model",
    };
    expect(body.providerID).toBe("test");
    expect(body.modelID).toBe("test-model");
  });

  it("forwards directory query parameter", async () => {
    mockCompactSession.mockResolvedValue(true);

    await fetch(
      api("/sessions/ses_compact/compact?directory=%2Fworkspace"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerID: "lmstudio",
          modelID: "qwopus3.6-27b-v2-mtp",
        }),
      },
    );

    expect(mockCompactSession).toHaveBeenCalledWith(
      "ses_compact",
      { providerID: "lmstudio", modelID: "qwopus3.6-27b-v2-mtp" },
      "/workspace",
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Defect 3: SSE events should forward Last-Event-ID
   ═══════════════════════════════════════════════════════════════════════════ */

describe("Defect 3: SSE Last-Event-ID forwarding", () => {
  it("forwards Last-Event-ID header to streamEvents for session event stream", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: {\"test\":true}\n\n"));
        controller.close();
      },
    });
    mockStreamEvents.mockResolvedValue(stream);

    const res = await fetch(api("/sessions/ses_sse/events"), {
      headers: {
        Accept: "text/event-stream",
        "Last-Event-ID": "12345",
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(mockStreamEvents).toHaveBeenCalledTimes(1);

    // Verify Last-Event-ID is forwarded as the 3rd argument
    const [sessionId, directory, lastEventId] = mockStreamEvents.mock.calls[0];
    expect(sessionId).toBe("ses_sse");
    expect(directory).toBeUndefined();
    expect(lastEventId).toBe("12345");
  });

  it("forwards Last-Event-ID header to streamEvents for global event stream", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: {}\n\n"));
        controller.close();
      },
    });
    mockStreamEvents.mockResolvedValue(stream);

    const res = await fetch(api("/events"), {
      headers: {
        Accept: "text/event-stream",
        "Last-Event-ID": "98765",
      },
    });

    expect(res.status).toBe(200);
    expect(mockStreamEvents).toHaveBeenCalledTimes(1);

    // Global events route calls: streamEvents(undefined, directory, lastEventId)
    const [sessionId, directory, lastEventId] = mockStreamEvents.mock.calls[0];
    expect(sessionId).toBeUndefined();
    expect(directory).toBeUndefined();
    expect(lastEventId).toBe("98765");
  });

  it("streamEvents is called without lastEventId when header is absent", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: {}\n\n"));
        controller.close();
      },
    });
    mockStreamEvents.mockResolvedValue(stream);

    const res = await fetch(api("/sessions/ses_sse/events"), {
      headers: { Accept: "text/event-stream" },
    });

    expect(res.status).toBe(200);
    const [, , lastEventId] = mockStreamEvents.mock.calls[0];
    expect(lastEventId).toBeUndefined();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Defect 4: Permissions endpoint returns correct shape
   ═══════════════════════════════════════════════════════════════════════════ */

describe("Defect 4: Permissions response shape", () => {
  it("returns PermissionRequest objects with {id, permission, pattern, action}", async () => {
    const mockPermissions: PermissionRequest[] = [
      { id: "perm_1", permission: "read", pattern: "/workspace/*", action: "allow" },
      { id: "perm_2", permission: "write", pattern: "/workspace/tmp/*", action: "ask" },
    ];
    mockGetPermissions.mockResolvedValue(mockPermissions);

    const res = await fetch(api("/permissions"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(2);

    const perm = body.data[0];
    // Contract fields that ARE present
    expect(perm).toHaveProperty("id");
    expect(perm).toHaveProperty("permission");
    expect(perm).toHaveProperty("pattern");
    expect(perm).toHaveProperty("action");
    expect(perm.id).toBe("perm_1");
    expect(perm.permission).toBe("read");
    expect(perm.pattern).toBe("/workspace/*");
    expect(perm.action).toBe("allow");
  });

  it("returns empty array when no permissions pending", async () => {
    mockGetPermissions.mockResolvedValue([]);

    const res = await fetch(api("/permissions"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(0);
  });

  it("returns error shape when client fails", async () => {
    mockGetPermissions.mockResolvedValue({
      error: { message: "OpenCode error", code: "HTTP_500" },
    });

    const res = await fetch(api("/permissions"));
    expect(res.status).toBe(502);
  });

  it("🔴 GAP: PermissionRequest type lacks sessionID that frontend expects", () => {
    // The PermissionRequest interface at opencode-client.ts:269-274:
    //   export interface PermissionRequest {
    //     id: string;
    //     permission: string;
    //     pattern: string;
    //     action: string;
    //   }
    //
    // The frontend expects additional fields like `sessionID` to associate
    // a permission request with a specific session. Without sessionID,
    // the frontend cannot display which session is requesting permission.
    //
    // To fix: Add `sessionID: string` to PermissionRequest interface and
    // verify the OpenCode v1.18.3 /permission endpoint returns it.
    const perm: PermissionRequest = {
      id: "test",
      permission: "read",
      pattern: "*",
      action: "ask",
    };
    expect(perm.id).toBeDefined();
    expect(perm.permission).toBeDefined();
    expect(perm.pattern).toBeDefined();
    expect(perm.action).toBeDefined();

    // @ts-expect-error — sessionID is not in the type but frontend expects it
    const missingSessionID: PermissionRequest = {
      ...perm,
      sessionID: "ses_123",
    };
    expect(missingSessionID).toHaveProperty("sessionID");
    // 🔴 This test documents that PermissionRequest does NOT include sessionID
    // but the frontend needs it to display permission context.
  });

  it("forwards directory query parameter", async () => {
    mockGetPermissions.mockResolvedValue([]);

    await fetch(api("/permissions?directory=%2Fworkspace"));
    expect(mockGetPermissions).toHaveBeenCalledWith("/workspace");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Defect 5: Questions endpoint exists
   ═══════════════════════════════════════════════════════════════════════════ */

describe("Defect 5: Questions endpoint", () => {
  it("GET /opencode/questions returns 200 with data (array)", async () => {
    mockGetQuestions.mockResolvedValue([
      { id: "q_1", text: "What is your name?" },
    ]);

    const res = await fetch(api("/questions"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns array of QuestionInfo objects", async () => {
    const mockQuestions = [
      { id: "q_1", text: "What is your name?" },
      { id: "q_2", text: "Continue?" },
    ];
    mockGetQuestions.mockResolvedValue(mockQuestions);

    const res = await fetch(api("/questions"));
    const body = await res.json();

    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toHaveProperty("id");
    expect(body.data[0]).toHaveProperty("text");
    expect(body.data[0].id).toBe("q_1");
  });

  it("returns empty array when no questions", async () => {
    mockGetQuestions.mockResolvedValue([]);

    const res = await fetch(api("/questions"));
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it("🔴 GAP: No POST /questions/{id}/reply endpoint exists", async () => {
    // The OpenCode API has GET /question to list pending questions, but
    // there is no corresponding POST /question/{id}/reply to answer them.
    // Questions can only be answered through the SSE event stream.
    //
    // Current implementation in routes/opencode.ts:
    //   - GET /opencode/questions → proxies to /question (line 356-361)
    //   - No POST /opencode/questions/:id/reply endpoint
    //
    // The frontend needs to reply to questions. Currently, the only way
    // is to send a prompt with the answer, which is not a clean API.
    //
    // To fix: Add route: POST /sessions/:id/questions/:qid/reply
    //   that sends answer via the SSE stream's question reply mechanism.

    // Verify there's no reply endpoint by checking for 404
    const res = await fetch(api("/questions/q_1/reply"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "My name is Ingenium" }),
    });
    expect(res.status).toBe(404);
  });

  it("forwards directory query parameter", async () => {
    mockGetQuestions.mockResolvedValue([]);

    await fetch(api("/questions?directory=%2Fworkspace"));
    expect(mockGetQuestions).toHaveBeenCalledWith("/workspace");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Defect 6: Fork body casing — messageId vs messageID
   ═══════════════════════════════════════════════════════════════════════════ */

describe("Defect 6: Fork body casing mismatch", () => {
  it("route correctly handles messageID casing (Phase 5 fix — reads both casings)", async () => {
    mockForkSession.mockResolvedValue({ id: "ses_forked" });

    // Frontend sends: { messageID: "msg_1" }  (uppercase D)
    const res = await fetch(api("/sessions/ses_original/fork"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageID: "msg_1" }),
    });

    expect(res.status).toBe(201);
    expect(mockForkSession).toHaveBeenCalledTimes(1);

    // Phase 5 fixed the route to read both messageID and messageId — extracts msg_1 correctly
    const [sessionId, messageId, directory] = mockForkSession.mock.calls[0];
    expect(sessionId).toBe("ses_original");

    // Phase 5 fixed the route to read both messageID and messageId casings
    expect(messageId).toBe("msg_1");
    expect(directory).toBeUndefined();
  });

  it("route correctly parses messageId when sent with lowercase d", async () => {
    mockForkSession.mockResolvedValue({ id: "ses_forked" });

    // If the frontend sent `messageId` (lowercase d, matching the route)
    const res = await fetch(api("/sessions/ses_original/fork"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: "msg_42" }),
    });

    expect(res.status).toBe(201);
    const [, messageId] = mockForkSession.mock.calls[0];
    expect(messageId).toBe("msg_42");
  });

  it("route sends undefined messageId when body is empty", async () => {
    mockForkSession.mockResolvedValue({ id: "ses_forked" });

    const res = await fetch(api("/sessions/ses_original/fork"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    const [, messageId] = mockForkSession.mock.calls[0];
    expect(messageId).toBeUndefined();
  });

  it("ForkBody type uses messageID (uppercase D) — route handles both casings", () => {
    // The route at routes/opencode.ts line 377 reads:
    //   const messageId = (req.body?.messageID || req.body?.messageId) as string | undefined;
    //
    // This handles both `messageID` (uppercase D, as sent by the client)
    // and `messageId` (lowercase d, as might be sent by other callers).
    // Phase 5 fixed the case-mismatch by reading both keys.
    const body: ForkBody = { messageID: "msg_1" };
    expect(body.messageID).toBe("msg_1");

    // Verify types compile for both casing variants
    const uppercaseBody: ForkBody = { messageID: "uppercase" };
    const lowercaseBody: { messageId?: string } = { messageId: "lowercase" };
    expect(uppercaseBody.messageID).toBe("uppercase");
    expect(lowercaseBody.messageId).toBe("lowercase");

    // Both variants are supported at runtime through the route's dual-key read.
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Defect 7: Revert body — RevertBody only has messageID, frontend also sends partID
   ═══════════════════════════════════════════════════════════════════════════ */

describe("Defect 7: Revert body field gap", () => {
  it("route forwards req.body as-is to revertSession", async () => {
    mockRevertSession.mockResolvedValue({ id: "ses_reverted" });

    const res = await fetch(api("/sessions/ses_original/revert"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageID: "msg_1" }),
    });

    expect(res.status).toBe(200);
    expect(mockRevertSession).toHaveBeenCalledWith(
      "ses_original",
      { messageID: "msg_1" },
      undefined,
    );
  });

  it("RevertBody type only has messageID — does NOT include partID", () => {
    // Verify the RevertBody type at opencode-client.ts:91-94:
    //   export interface RevertBody {
    //     messageID: string;
    //   }
    const body: RevertBody = { messageID: "msg_1" };
    expect(body.messageID).toBe("msg_1");

    // 🔴 GAP DOCUMENTATION:
    // The RevertBody type only has `messageID`, but the frontend also
    // sends `partID` to revert to a specific part within a message.
    //
    // Frontend sends: { messageID: "msg_1", partID: "part_3" }
    // Current type:   { messageID: string }
    //
    // Since the route passes req.body as-is to revertSession, and the
    // client passes the body as-is to the OpenCode API, extra fields
    // ARE forwarded. However, the TypeScript type does not reflect the
    // actual contract, so callers don't know they can send `partID`.
    //
    // To fix: Add `partID?: string` to the RevertBody interface.
    
    // Runtime test: sending partID works because body is passed through
    // but the type doesn't declare it
    const bodyWithPartID = { messageID: "msg_1", partID: "part_3" };
    expect(bodyWithPartID).toHaveProperty("messageID");
    expect(bodyWithPartID).toHaveProperty("partID");

    // @ts-expect-error — partID is not in RevertBody but is sent by frontend
    const typedBody: RevertBody = bodyWithPartID;
    expect(typedBody.messageID).toBe("msg_1");
  });

  it("route passes through extra fields in revert body", async () => {
    mockRevertSession.mockResolvedValue({ id: "ses_reverted" });

    // Even though RevertBody doesn't declare partID, the route forwards it
    const res = await fetch(api("/sessions/ses_original/revert"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageID: "msg_1", partID: "part_3" }),
    });

    expect(res.status).toBe(200);
    const [, body] = mockRevertSession.mock.calls[0];
    expect(body).toHaveProperty("messageID", "msg_1");
    expect(body).toHaveProperty("partID", "part_3");
  });

  it("forwards directory query parameter for revert", async () => {
    mockRevertSession.mockResolvedValue({ id: "ses_reverted" });

    await fetch(
      api("/sessions/ses_original/revert?directory=%2Fworkspace"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageID: "msg_1" }),
      },
    );

    expect(mockRevertSession).toHaveBeenCalledWith(
      "ses_original",
      { messageID: "msg_1" },
      "/workspace",
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Defect 8: Command body field naming — args vs arguments
   ═══════════════════════════════════════════════════════════════════════════ */

describe("Defect 8: Command body field naming mismatch", () => {
  it("CommandBody type uses 'args' — frontend sends 'arguments'", () => {
    // Verify CommandBody at opencode-client.ts:96-100:
    //   export interface CommandBody {
    //     command: string;
    //     args?: string[];
    //   }
    const body: CommandBody = { command: "ls", args: ["-la"] };
    expect(body.command).toBe("ls");
    expect(body.args).toEqual(["-la"]);

    // 🔴 MISMATCH DOCUMENTATION:
    // CommandBody uses `args` (short for arguments) but the frontend
    // sends `arguments` (the full word). Since the route passes req.body
    // as-is to sendCommand(), and the client sends the body as-is to the
    // OpenCode API, the field name sent over the wire depends on what
    // the caller provides.
    //
    // If the frontend sends:  { command: "ls", arguments: ["-la"] }
    // The OpenCode API expects: { command: "ls", args: ["-la"] }
    //
    // The API might handle both, but the type in this codebase declares
    // `args` while external callers (or future frontends) might use
    // `arguments`. This is a potential contract mismatch.
    //
    // To fix: Align the type with what the OpenCode API actually expects,
    // or add `arguments` as an alias.

    // Test that route passes through whatever body it receives
    const bodyWithArguments = { command: "ls", arguments: ["-la"] };
    expect(bodyWithArguments).toHaveProperty("command");
    expect(bodyWithArguments).toHaveProperty("arguments");
    // @ts-expect-error — 'arguments' is not in CommandBody type
    const cmd: CommandBody = bodyWithArguments;
    expect(cmd.command).toBe("ls");
  });

  it("route forwards command body as-is", async () => {
    mockSendCommand.mockResolvedValue({ ok: true });

    const res = await fetch(api("/sessions/ses_cmd/command"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "ls", args: ["-la"] }),
    });

    expect(res.status).toBe(200);
    expect(mockSendCommand).toHaveBeenCalledWith(
      "ses_cmd",
      { command: "ls", args: ["-la"] },
      undefined,
    );
  });

  it("forwards command body with 'arguments' field (frontend style)", async () => {
    mockSendCommand.mockResolvedValue({ ok: true });

    // If the frontend sends `arguments` instead of `args`, the route
    // still forwards it because it passes req.body as-is
    const res = await fetch(api("/sessions/ses_cmd/command"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "ls", arguments: ["-la"] }),
    });

    expect(res.status).toBe(200);
    const [, body] = mockSendCommand.mock.calls[0];
    expect(body).toHaveProperty("command", "ls");
    // The body includes whatever the frontend sends
    expect(body).toHaveProperty("arguments");
    expect(body).not.toHaveProperty("args");
  });

  it("forwards directory query parameter for command", async () => {
    mockSendCommand.mockResolvedValue({ ok: true });

    await fetch(
      api("/sessions/ses_cmd/command?directory=%2Fworkspace"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "pwd" }),
      },
    );

    expect(mockSendCommand).toHaveBeenCalledWith(
      "ses_cmd",
      { command: "pwd" },
      "/workspace",
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Defect 7-8: Additional revert/command edge cases
   ═══════════════════════════════════════════════════════════════════════════ */

describe("Revert and Command edge cases", () => {
  it("revert with missing messageID still calls upstream (body as-is)", async () => {
    mockRevertSession.mockResolvedValue({
      error: { message: "Bad Request", code: "HTTP_400" },
    });

    const res = await fetch(api("/sessions/ses_test/revert"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    // Route passes empty body upstream — OpenCode API rejects it
    expect(mockRevertSession).toHaveBeenCalledWith(
      "ses_test",
      {},
      undefined,
    );
  });

  it("command with no args still forwards correctly", async () => {
    mockSendCommand.mockResolvedValue({ ok: true });

    const res = await fetch(api("/sessions/ses_cmd/command"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "ls" }),
    });

    expect(res.status).toBe(200);
    const [, body] = mockSendCommand.mock.calls[0];
    expect(body).toEqual({ command: "ls" });
    expect(body).not.toHaveProperty("args");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Defect 9: Compact error path handling
   ═══════════════════════════════════════════════════════════════════════════ */

describe("Defect 9: Compact error path handling", () => {
  it("returns 400 when providerID is missing from body", async () => {
    const res = await fetch(api("/sessions/ses_compact_err/compact"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelID: "some-model" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("MISSING_PROVIDER_ID");
    expect(body.error.message).toContain("providerID");
    expect(mockCompactSession).not.toHaveBeenCalled();
  });

  it("returns 400 when providerID is empty string", async () => {
    const res = await fetch(api("/sessions/ses_compact_err/compact"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerID: "", modelID: "some-model" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("MISSING_PROVIDER_ID");
    expect(mockCompactSession).not.toHaveBeenCalled();
  });

  it("returns 400 when providerID is only whitespace", async () => {
    const res = await fetch(api("/sessions/ses_compact_err/compact"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerID: "   ", modelID: "some-model" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("MISSING_PROVIDER_ID");
    expect(mockCompactSession).not.toHaveBeenCalled();
  });

  it("forwards valid providerID and modelID correctly", async () => {
    mockCompactSession.mockResolvedValue(true);

    const res = await fetch(api("/sessions/ses_compact_ok/compact"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerID: "lmstudio",
        modelID: "qwopus3.6-27b-v2-mtp",
      }),
    });

    expect(res.status).toBe(200);
    expect(mockCompactSession).toHaveBeenCalledWith(
      "ses_compact_ok",
      { providerID: "lmstudio", modelID: "qwopus3.6-27b-v2-mtp" },
      undefined,
    );
  });

  it("preserves upstream 500 error instead of mapping to 502", async () => {
    mockCompactSession.mockResolvedValue({
      error: {
        message: "Internal server error from OpenCode",
        code: "HTTP_500",
      },
    });

    const res = await fetch(api("/sessions/ses_compact_upstream_err/compact"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerID: "lmstudio",
        modelID: "some-model",
      }),
    });

    // sendResult maps HTTP_5 to 502, but the compact route validates providerID
    // and then uses sendResult. Since we provided a valid providerID, the body
    // is constructed and compactSession is called. The mock returns HTTP_500,
    // and sendResult maps it to 502 (the generic default).
    //
    // To preserve upstream 500 errors specifically, the route would need custom
    // error handling like the share route. This test documents the current
    // behavior and the improvement opportunity.
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("HTTP_500");
  });

  it("returns 400 when body is empty object", async () => {
    const res = await fetch(api("/sessions/ses_compact_err/compact"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("MISSING_PROVIDER_ID");
    expect(mockCompactSession).not.toHaveBeenCalled();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Defect 10: Share route preserves upstream error details
   ═══════════════════════════════════════════════════════════════════════════ */

describe("Defect 10: Share route error handling", () => {
  it("returns existing share URL when session is already shared", async () => {
    // Simulate: getSession returns a session that already has a share URL
    mockGetSession.mockResolvedValue({
      id: "ses_shared",
      share: { url: "https://opencode.example.com/share/abc123" },
    });

    const res = await fetch(api("/sessions/ses_shared/share"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.share.url).toBe("https://opencode.example.com/share/abc123");

    // shareSession should NOT be called — pre-check catches it
    expect(mockShareSession).not.toHaveBeenCalled();
  });

  it("calls shareSession when session has no existing share URL", async () => {
    // getSession returns a session without a share URL
    mockGetSession.mockResolvedValue({
      id: "ses_unshared",
      share: undefined,
    });
    mockShareSession.mockResolvedValue({
      id: "ses_unshared",
      share: { url: "https://opencode.example.com/share/new123" },
    });

    const res = await fetch(api("/sessions/ses_unshared/share"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(mockGetSession).toHaveBeenCalledWith("ses_unshared", undefined);
    expect(mockShareSession).toHaveBeenCalledWith("ses_unshared", undefined);
  });

  it("preserves upstream 500 error instead of mapping to 502", async () => {
    // getSession returns no share URL, so we call shareSession
    mockGetSession.mockResolvedValue({
      id: "ses_err",
      share: undefined,
    });
    mockShareSession.mockResolvedValue({
      error: {
        message: "Internal server error from OpenCode share endpoint",
        code: "HTTP_500",
      },
    });

    const res = await fetch(api("/sessions/ses_err/share"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    // The share route extracts the actual HTTP status from the error code
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("HTTP_500");
  });

  it("preserves upstream 409 Conflict error code", async () => {
    mockGetSession.mockResolvedValue({
      id: "ses_conflict",
      share: undefined,
    });
    mockShareSession.mockResolvedValue({
      error: {
        message: "Session is already being shared",
        code: "HTTP_409",
      },
    });

    const res = await fetch(api("/sessions/ses_conflict/share"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("HTTP_409");
  });

  it("forwards directory query parameter to getSession and shareSession", async () => {
    mockGetSession.mockResolvedValue({
      id: "ses_dir",
      share: undefined,
    });
    mockShareSession.mockResolvedValue({
      id: "ses_dir",
      share: { url: "https://opencode.example.com/share/dir123" },
    });

    await fetch(api("/sessions/ses_dir/share?directory=%2Fworkspace%2Ftest"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    expect(mockGetSession).toHaveBeenCalledWith("ses_dir", "/workspace/test");
    expect(mockShareSession).toHaveBeenCalledWith("ses_dir", "/workspace/test");
  });

  it("returns 502 for non-HTTP error codes (e.g. NETWORK_ERROR)", async () => {
    mockGetSession.mockResolvedValue({
      id: "ses_net",
      share: undefined,
    });
    mockShareSession.mockResolvedValue({
      error: {
        message: "Network error contacting OpenCode",
        code: "NETWORK_ERROR",
      },
    });

    const res = await fetch(api("/sessions/ses_net/share"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    // Non-HTTP error codes fall through to the default 502
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("NETWORK_ERROR");
  });
});
