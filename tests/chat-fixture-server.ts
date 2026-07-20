import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

/**
 * Lightweight OpenCode API fixture server for the chat E2E smoke test.
 *
 * Runs on port 4999 and implements the full OpenCode API surface needed
 * to exercise the browser → Next.js → API → OpenCode → SSE pipeline
 * deterministically, without a real LLM backend.
 *
 * Routes:
 *   POST /session            → create session
 *   GET  /session            → list sessions
 *   GET  /session/{id}/message → get messages
 *   POST /session/{id}/message → send prompt (201)
 *   GET  /event?session={id} → SSE stream
 *   GET  /provider           → providers (includes "opencode" free model)
 *   GET  /mcp                → empty MCP state
 *   GET  /permission         → empty permission list
 *   GET  /question           → empty question list
 *   GET  /agent              → empty agent list
 *
 * Any unhandled path returns 404.
 */

const PORT = 4999;
const FIXTURE_SESSION_ID = "fixture-session-1";

/* ── Session store ── */

interface FixtureSession {
  id: string;
  title: string;
  slug: string;
  projectID: string;
  directory: string;
  path: string;
  version: string;
  time: { created: number; updated: number };
  cost: number;
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  permission?: Array<{ permission: string; pattern: string; action: string }>;
}

interface FixtureMessage {
  info: {
    id: string;
    sessionID: string;
    role: "user" | "assistant";
    time: { created: number; completed?: number };
    modelID?: string;
    providerID?: string;
    finish?: string;
    parentID?: string;
    mode?: string;
    agent?: string;
    cost?: number;
    tokens?: { total?: number; input?: number; output?: number; reasoning?: number; cache?: { write?: number; read?: number } };
    summary?: { diffs?: unknown[] };
  };
  parts: Array<{
    id: string;
    sessionID: string;
    messageID: string;
    type: string;
    text?: string;
    time?: { start?: number; end?: number };
  }>;
}

const now = Date.now();

function makeSession(id: string, title: string): FixtureSession {
  return {
    id,
    title,
    slug: id,
    projectID: "fixture-project",
    directory: "/workspace",
    path: "/workspace",
    version: "1.18.3",
    time: { created: now, updated: now },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

/**
 * Sessions list starts empty so the dashboard's auto-creation flow fires.
 * When POST /session is called, the fixture session is created and added.
 * Subsequent GET /session calls return the populated list.
 */
const sessions: FixtureSession[] = [];

function userMessage(): FixtureMessage {
  return {
    info: {
      id: "msg-1",
      sessionID: FIXTURE_SESSION_ID,
      role: "user",
      time: { created: now },
    },
    parts: [
      {
        id: "part-1",
        sessionID: FIXTURE_SESSION_ID,
        messageID: "msg-1",
        type: "text",
        text: "Hello from E2E test",
      },
    ],
  };
}

/* ── Provider data ── */

const fixtureProviders = {
  all: [
    {
      id: "opencode",
      name: "OpenCode Zen",
      source: "builtin",
      env: [],
      options: {},
      models: {
        "fixture-model": {
          id: "fixture-model",
          providerID: "opencode",
          api: { id: "fixture", url: "http://localhost:4999", npm: "fixture" },
          name: "Fixture Model",
          capabilities: {},
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: 4096, output: 1024 },
          status: "active",
          options: {},
          headers: {},
          release_date: "2026-01-01",
          variants: {},
        },
      },
    },
  ],
  default: { opencode: "fixture-model" },
  connected: ["opencode"],
};

/* ── Helpers ── */

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(payload)),
  });
  res.end(payload);
}

function notFound(res: ServerResponse): void {
  json(res, 404, { error: { message: "Not found", code: "NOT_FOUND" } });
}

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/**
 * Generate an SSE-formatted event stream that the frontend parser consumes.
 *
 * The SSE parser in use-opencode-chat.ts accumulates `data:` lines until a
 * blank line is encountered, then JSON.parses the accumulated content.
 * `event:` lines are ignored but included for spec compliance.
 */
function streamSSE(res: ServerResponse): void {
  // Parse query string for session ID
  const url = new URL(`http://localhost${res.req.url ?? ""}`);
  const sessionId = url.searchParams.get("session");
  const messageID = "fixture-assistant-msg";
  const partID = "fixture-part-1";
  const streamText = "Hello! I received your message. This confirms the chat pipeline is working.";

  // SSE response headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // 1. message.updated — announces the assistant message
  res.write(
    `event: message.updated\ndata: ${JSON.stringify({
      type: "message.updated",
      properties: {
        info: {
          id: messageID,
          role: "assistant",
          sessionID: sessionId ?? FIXTURE_SESSION_ID,
          providerID: "opencode",
          modelID: "fixture-model",
        },
      },
    })}\n\n`,
  );

  // 2. message.part.delta — stream a single text chunk
  res.write(
    `event: message.part.delta\ndata: ${JSON.stringify({
      type: "message.part.delta",
      properties: {
        messageID,
        partID,
        field: "text",
        delta: streamText,
      },
    })}\n\n`,
  );

  // 3. session.idle — signal completion
  res.write(
    `event: session.idle\ndata: ${JSON.stringify({
      type: "session.idle",
      properties: {},
    })}\n\n`,
  );

  res.end();
}

/* ── Router ── */

function route(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? "/";
  const method = (req.method ?? "GET").toUpperCase();

  // Strip query string for path matching
  const path = url.split("?")[0]!;

  // Parse query
  const query = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?")) : "");

  // ── POST /session ──
  if (method === "POST" && path === "/session") {
    parseBody(req).then(() => {
      const s = makeSession(FIXTURE_SESSION_ID, "New conversation");
      sessions.push(s);
      json(res, 201, s);
    });
    return;
  }

  // ── GET /session ──
  if (method === "GET" && path === "/session") {
    json(res, 200, sessions);
    return;
  }

  // ── GET /session/{id} ──
  const sessionDetailMatch = path.match(/^\/session\/([^/]+)$/);
  if (method === "GET" && sessionDetailMatch) {
    const id = sessionDetailMatch[1]!;
    const s = sessions.find((s) => s.id === id);
    if (s) {
      json(res, 200, s);
    } else {
      notFound(res);
    }
    return;
  }

  // ── GET /session/{id}/message ──
  const getMessagesMatch = path.match(/^\/session\/([^/]+)\/message$/);
  if (method === "GET" && getMessagesMatch) {
    const id = getMessagesMatch[1]!;
    if (id === FIXTURE_SESSION_ID) {
      // Return the user message only — the assistant response arrives via SSE.
      // Returning both would cause duplication with the SSE stream.
      json(res, 200, [userMessage()]);
    } else {
      json(res, 200, []);
    }
    return;
  }

  // ── POST /session/{id}/message ──
  const postMessageMatch = path.match(/^\/session\/([^/]+)\/message$/);
  if (method === "POST" && postMessageMatch) {
    parseBody(req).then((body) => {
      let userText = "";
      try {
        const parsed = JSON.parse(body);
        // Extract text from parts array
        if (parsed.parts && Array.isArray(parsed.parts)) {
          userText = parsed.parts
            .filter((p: { type: string }) => p.type === "text")
            .map((p: { text?: string }) => p.text ?? "")
            .join(" ");
        }
      } catch {
        // Best-effort
      }

      const createdMsg = userMessage();
      createdMsg.info.id = "msg-3";
      if (userText) {
        createdMsg.parts[0]!.text = userText;
      }
      json(res, 201, createdMsg);
    });
    return;
  }

  // ── GET /event?session={id} ──
  if (method === "GET" && path === "/event") {
    const sessionParam = query.get("session");
    if (sessionParam && sessionParam !== FIXTURE_SESSION_ID) {
      // Unknown session — return empty SSE that immediately ends
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`event: session.idle\ndata: {"type":"session.idle","properties":{}}\n\n`);
      res.end();
      return;
    }
    streamSSE(res);
    return;
  }

  // ── GET /provider ──
  if (method === "GET" && path === "/provider") {
    json(res, 200, fixtureProviders);
    return;
  }

  // ── GET /mcp ──
  if (method === "GET" && path === "/mcp") {
    json(res, 200, {});
    return;
  }

  // ── GET /permission ──
  if (method === "GET" && path === "/permission") {
    json(res, 200, []);
    return;
  }

  // ── GET /question ──
  if (method === "GET" && path === "/question") {
    json(res, 200, []);
    return;
  }

  // ── GET /agent ──
  if (method === "GET" && path === "/agent") {
    json(res, 200, []);
    return;
  }

  // ── Default: 404 ──
  notFound(res);
}

/* ── Server ── */

const server = createServer(route);

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[chat-fixture] Listening on http://localhost:${PORT}`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    // eslint-disable-next-line no-console
    console.error(`[chat-fixture] Port ${PORT} is already in use — another instance may be running`);
    process.exit(1);
  }
  throw err;
});
