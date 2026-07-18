/**
 * opencode-proxy.test.ts — Real integration tests for OpenCode HTTP API proxy routes.
 *
 * Tests the /api/v1/opencode/* proxy by routing through an in-process Express app
 * that forwards requests to the REAL OpenCode server at http://localhost:4098.
 * No mocks — these are true integration tests.
 *
 * Requirements:
 *   - OpenCode server running at http://localhost:4098
 *   - OPENCODE_SERVER_PASSWORD set in process.env
 *
 * Pattern: standalone Express server on random port (same as dashboard.test.ts).
 * Every test that creates sessions tracks them for cleanup via `afterAll`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { opencodeRouter } from "../lib/routes/opencode.js";

/* ── Test server setup ───────────────────────────────────────────────────── */

const SAVED_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD;

let server: Server | null = null;
let baseUrl: string;

/** Track created session IDs for cleanup */
const createdSessions: string[] = [];

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/opencode", opencodeRouter);
  return app;
}

beforeAll(async () => {
  if (!SAVED_PASSWORD) {
    throw new Error(
      "OPENCODE_SERVER_PASSWORD must be set in environment for integration tests",
    );
  }

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
  // Cleanup: delete all sessions we created
  for (const sessionId of createdSessions) {
    try {
      await fetch(api(`/sessions/${sessionId}`), { method: "DELETE" });
    } catch {
      // Best-effort cleanup
    }
  }

  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
});

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function api(path: string): string {
  return `${baseUrl}/api/v1/opencode${path}`;
}

/** Create a session and track it for cleanup. Returns the parsed response body. */
async function createTrackedSession(
  title = "Integration Test Session",
  directory?: string,
): Promise<any> {
  const queryStr = directory ? `?directory=${encodeURIComponent(directory)}` : "";
  const res = await fetch(api(`/sessions${queryStr}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, directory: directory ?? "/workspace" }),
  });
  const body = await res.json();
  if (res.ok && body.data?.id) {
    createdSessions.push(body.data.id);
  }
  return { status: res.status, body };
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("OpenCode Proxy — Real Integration Tests", () => {
  /* ── Health ── */

  describe("GET /opencode/health", () => {
    it("returns healthy true and version from real OpenCode server", async () => {
      const res = await fetch(api("/health"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(body.data.healthy).toBe(true);
      expect(body.data.version).toBeDefined();
      expect(typeof body.data.version).toBe("string");
    });
  });

  /* ── Session CRUD ── */

  describe("Session CRUD", () => {
    let sessionId: string;

    it("POST /opencode/sessions creates a session with required fields", async () => {
      const { status, body } = await createTrackedSession("CRUD Test Session");
      expect(status).toBe(201);
      expect(body.data).toBeDefined();
      expect(typeof body.data.id).toBe("string");
      expect(body.data.id).toMatch(/^ses_/);
      expect(typeof body.data.slug).toBe("string");
      expect(typeof body.data.projectID).toBe("string");
      expect(typeof body.data.directory).toBe("string");
      expect(body.data.title).toBe("CRUD Test Session");
      sessionId = body.data.id;
    });

    it("GET /opencode/sessions returns array of sessions", async () => {
      const res = await fetch(api("/sessions"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
      // Our created session should be in the list
      const found = body.data.find((s: any) => s.id === sessionId);
      expect(found).toBeDefined();
    });

    it("GET /opencode/sessions/:id returns single session with required fields", async () => {
      const res = await fetch(api(`/sessions/${sessionId}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(sessionId);
      expect(body.data.title).toBe("CRUD Test Session");
      expect(typeof body.data.slug).toBe("string");
      expect(typeof body.data.projectID).toBe("string");
      expect(typeof body.data.directory).toBe("string");
    });

    it("PATCH /opencode/sessions/:id updates title", async () => {
      const res = await fetch(api(`/sessions/${sessionId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Updated CRUD Title" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.title).toBe("Updated CRUD Title");
    });

    it("DELETE /opencode/sessions/:id removes a session", async () => {
      // Create a separate session just for this test
      const { status: createStatus, body: createBody } = await createTrackedSession(
        "Delete Me Session",
      );
      expect(createStatus).toBe(201);
      const deleteId = createBody.data.id;

      // Remove from cleanup tracker since we're deleting it now
      const idx = createdSessions.indexOf(deleteId);
      if (idx >= 0) createdSessions.splice(idx, 1);

      const res = await fetch(api(`/sessions/${deleteId}`), { method: "DELETE" });
      expect(res.status).toBe(200);

      // Subsequent GET should fail
      const getRes = await fetch(api(`/sessions/${deleteId}`));
      expect(getRes.status).toBeGreaterThanOrEqual(400);
    });
  });

  /* ── Messages ── */

  describe("Messages", () => {
    let msgSessionId: string;

    beforeAll(async () => {
      // Create a session and send a prompt to populate messages
      const { status, body } = await createTrackedSession("Messages Test Session");
      expect(status).toBe(201);
      msgSessionId = body.data.id;

      // Send a simple prompt to generate messages
      await fetch(api(`/sessions/${msgSessionId}/prompt`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parts: [{ type: "text", text: "reply with only the word 'hello'" }],
          model: { providerID: "opencode", modelID: "big-pickle" },
        }),
      });
    }, 60000);

    it("GET /opencode/sessions/:id/messages returns messages with {info, parts} shape", async () => {
      const res = await fetch(api(`/sessions/${msgSessionId}/messages`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);

      // Check shape of first message
      const msg = body.data[0];
      expect(msg).toHaveProperty("info");
      expect(msg).toHaveProperty("parts");
      expect(typeof msg.info.id).toBe("string");
      expect(msg.info.id).toMatch(/^msg_/);
      expect(["user", "assistant"]).toContain(msg.info.role);
      expect(typeof msg.info.sessionID).toBe("string");

      // Parts should be array with required fields
      expect(Array.isArray(msg.parts)).toBe(true);
      if (msg.parts.length > 0) {
        const part = msg.parts[0];
        expect(typeof part.id).toBe("string");
        expect(typeof part.sessionID).toBe("string");
        expect(typeof part.messageID).toBe("string");
        expect(typeof part.type).toBe("string");
      }
    });
  }, 65000);

  /* ── Prompt ── */

  describe("POST /opencode/sessions/:id/prompt", () => {
    let promptSessionId: string;

    beforeAll(async () => {
      const { status, body } = await createTrackedSession("Prompt Test Session");
      expect(status).toBe(201);
      promptSessionId = body.data.id;
    });

    it("accepts parts array and returns 201", async () => {
      const res = await fetch(api(`/sessions/${promptSessionId}/prompt`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parts: [{ type: "text", text: "reply with only the word 'ok'" }],
          model: { providerID: "opencode", modelID: "big-pickle" },
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data).toBeDefined();
    }, 60000);

    it("user message appears in session messages after prompt", async () => {
      const res = await fetch(api(`/sessions/${promptSessionId}/messages`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.length).toBeGreaterThan(0);
      const userMsg = body.data.find((m: any) => m.info.role === "user");
      expect(userMsg).toBeDefined();
    });

    it("invalid body returns 4xx", async () => {
      const res = await fetch(api(`/sessions/${promptSessionId}/prompt`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Hello" }), // wrong shape per contract
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    }, 30000);
  }, 65000);

  /* ── Providers ── */

  describe("GET /opencode/providers", () => {
    it("returns provider data with {all, default, connected}", async () => {
      const res = await fetch(api("/providers?directory=/workspace"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(body.data.all).toBeDefined();
      expect(Array.isArray(body.data.all)).toBe(true);
      expect(body.data.all.length).toBeGreaterThan(0);

      // Check provider shape
      const provider = body.data.all[0];
      expect(typeof provider.id).toBe("string");
      expect(typeof provider.name).toBe("string");
    });
  });

  /* ── Agents ── */

  describe("GET /opencode/agents", () => {
    it("returns array of agents with required fields", async () => {
      const res = await fetch(api("/agents"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);

      const agent = body.data[0];
      expect(typeof agent.name).toBe("string");
      expect(typeof agent.description).toBe("string");
      expect(typeof agent.mode).toBe("string");
    });
  });

  /* ── Session Actions ── */

  describe("Session actions", () => {
    let actionSessionId: string;

    beforeAll(async () => {
      const { status, body } = await createTrackedSession("Actions Test Session");
      expect(status).toBe(201);
      actionSessionId = body.data.id;

      // Send a prompt so we have messages for fork
      await fetch(api(`/sessions/${actionSessionId}/prompt`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parts: [{ type: "text", text: "say 'test'" }],
          model: { providerID: "opencode", modelID: "big-pickle" },
        }),
      });
    }, 60000);

    it("POST /opencode/sessions/:id/abort returns 200", async () => {
      const res = await fetch(api(`/sessions/${actionSessionId}/abort`), {
        method: "POST",
      });
      expect(res.status).toBe(200);
    });

    it("POST /opencode/sessions/:id/fork creates new session with different id", async () => {
      const res = await fetch(api(`/sessions/${actionSessionId}/fork`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageID: "" }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.id).toBeDefined();
      expect(body.data.id).not.toBe(actionSessionId);

      // Track for cleanup
      createdSessions.push(body.data.id);
    });

    it("POST /opencode/sessions/:id/share returns share URL", async () => {
      const res = await fetch(api(`/sessions/${actionSessionId}/share`), {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(body.data.share).toBeDefined();
      expect(typeof body.data.share.url).toBe("string");
    });

    it("DELETE /opencode/sessions/:id/share returns 200", async () => {
      const res = await fetch(api(`/sessions/${actionSessionId}/share`), {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
    });
  }, 70000);

  /* ── Error cases ── */

  describe("Error handling", () => {
    it("GET nonexistent session returns 4xx/5xx", async () => {
      const res = await fetch(api("/sessions/ses_nonexistent123"));
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("PATCH nonexistent session returns 4xx/5xx", async () => {
      const res = await fetch(api("/sessions/ses_nonexistent123"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "nope" }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  /* ── Password guard ── */

  describe("Password guard", () => {
    it("returns 503 when OPENCODE_SERVER_PASSWORD is not set", async () => {
      const saved = process.env.OPENCODE_SERVER_PASSWORD;
      delete process.env.OPENCODE_SERVER_PASSWORD;

      try {
        const res = await fetch(api("/health"));
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.error.code).toBe("OPENCODE_NOT_CONFIGURED");
        expect(body.error.message).toContain("OPENCODE_SERVER_PASSWORD");
      } finally {
        process.env.OPENCODE_SERVER_PASSWORD = saved;
      }
    });
  });

  /* ── Password guard applies to all proxy routes ── */

  describe("Password guard coverage", () => {
    const routes: { method: string; path: string; body?: any }[] = [
      { method: "GET", path: "/health" },
      { method: "GET", path: "/sessions" },
      { method: "POST", path: "/sessions", body: {} },
      { method: "GET", path: "/sessions/x" },
      { method: "PATCH", path: "/sessions/x", body: {} },
      { method: "DELETE", path: "/sessions/x" },
      { method: "GET", path: "/sessions/x/messages" },
      { method: "POST", path: "/sessions/x/prompt", body: {} },
      { method: "DELETE", path: "/sessions/x/messages/y" },
      { method: "POST", path: "/sessions/x/abort" },
      { method: "POST", path: "/sessions/x/fork", body: {} },
      { method: "POST", path: "/sessions/x/share" },
      { method: "DELETE", path: "/sessions/x/share" },
      { method: "POST", path: "/sessions/x/compact", body: {} },
      { method: "POST", path: "/sessions/x/revert", body: { messageID: "msg_1" } },
      { method: "POST", path: "/sessions/x/unrevert" },
      { method: "GET", path: "/sessions/x/children" },
      { method: "GET", path: "/sessions/x/diff" },
      { method: "POST", path: "/sessions/x/command", body: { command: "ls" } },
      { method: "GET", path: "/providers" },
      { method: "GET", path: "/agents" },
      { method: "GET", path: "/mcp" },
      { method: "POST", path: "/mcp/x/connect" },
      { method: "POST", path: "/mcp/x/disconnect" },
      { method: "GET", path: "/permissions" },
      { method: "POST", path: "/sessions/x/permissions/y", body: {} },
      { method: "GET", path: "/questions" },
    ];

    routes.forEach(({ method, path, body }) => {
      it(`${method} ${path} returns 503 without password`, async () => {
        const saved = process.env.OPENCODE_SERVER_PASSWORD;
        delete process.env.OPENCODE_SERVER_PASSWORD;

        try {
          const init: RequestInit = { method };
          if (body !== undefined) {
            init.headers = { "Content-Type": "application/json" };
            init.body = JSON.stringify(body);
          }
          const res = await fetch(api(path), init);
          expect(res.status).toBe(503);
          const resBody = await res.json();
          expect(resBody.error.code).toBe("OPENCODE_NOT_CONFIGURED");
        } finally {
          process.env.OPENCODE_SERVER_PASSWORD = saved;
        }
      });
    });
  });
});
