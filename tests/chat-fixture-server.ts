import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { basename } from "node:path";

/**
 * Lightweight OpenCode API fixture server for the chat E2E smoke test.
 *
 * Implements the OpenCode API surface needed to exercise the browser →
 * Next.js → API → OpenCode → SSE pipeline deterministically, without a real
 * LLM backend. The managed runner supplies an isolated port when required.
 *
 * Routes:
 *   POST /session            → create session
 *   GET  /session            → list sessions
 *   GET  /session/{id}/message → get messages
 *   POST /session/{id}/message → send prompt (201)
 *   GET  /event?session={id} → SSE stream
 *   GET  /global/health      → healthy fixture status
 *   GET  /provider           → providers (includes "opencode" free model)
 *   GET  /mcp                → empty MCP state
 *   GET  /permission         → empty permission list
 *   GET  /question           → empty question list
 *   GET  /agent              → empty agent list
 *   POST /__fixture/reset    → clear per-test session state (runner mode only)
 *
 * Any unhandled path returns 404.
 */

export const DEFAULT_FIXTURE_PORT = 4999;
const FIXTURE_SESSION_ID = "fixture-session-1";
const FIXTURE_VERSION = "1.18.9";

export function getFixturePort(environment: NodeJS.ProcessEnv = process.env): number {
  const value = environment.CHAT_FIXTURE_PORT;
  if (value === undefined || value.trim() === "") return DEFAULT_FIXTURE_PORT;
  if (!/^\d+$/.test(value.trim())) throw new Error("CHAT_FIXTURE_PORT must be an integer");
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("CHAT_FIXTURE_PORT must be between 1024 and 65535");
  }
  return port;
}

interface FixtureRuntime {
  server: Server;
  port: number;
  sockets: Set<Socket>;
  sseResponses: Set<ServerResponse>;
  timers: Set<NodeJS.Timeout>;
  shuttingDown: boolean;
}

let fixtureRuntime: FixtureRuntime | undefined;

function runtime(): FixtureRuntime {
  if (!fixtureRuntime) throw new Error("Chat fixture server has not been created");
  return fixtureRuntime;
}

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
    version: FIXTURE_VERSION,
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

function fixtureProviders(port: number) {
  return {
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
          api: { id: "fixture", url: `http://127.0.0.1:${port}`, npm: "fixture" },
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
}

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
 *
 * Two modes:
 * - "simple": basic text-only response (backward compatible)
 * - "rich": full v1.18.9 pipeline — reasoning deltas, shell and Web Search
 *           calls, response text, completed metadata, session.idle
 *
 * In rich mode, small delays between event groups give the frontend time
 * to render intermediate states (reasoning, tool call, activity status)
 * before the stream completes.
 */

function delay(ms: number): Promise<void> {
  const state = runtime();
  if (state.shuttingDown) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      state.timers.delete(timer);
      resolve();
    }, ms);
    state.timers.add(timer);
  });
}

function writeSse(res: ServerResponse, body: string): boolean {
  const state = runtime();
  if (state.shuttingDown || res.destroyed || res.writableEnded) return false;
  try {
    return res.write(body);
  } catch {
    return false;
  }
}

async function streamSSE(res: ServerResponse, mode: "simple" | "rich" = "rich"): Promise<void> {
  const state = runtime();
  state.sseResponses.add(res);
  try {
  if (state.shuttingDown || res.destroyed || res.writableEnded) return;
  const url = new URL(`http://localhost${res.req.url ?? ""}`);
  const sessionId = url.searchParams.get("session");
  const messageID = "fixture-assistant-msg";
  const partID = "fixture-part-1";

  // These headers keep the stream incremental instead of buffered.
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  if (mode === "rich") {
    writeSse(res,
      `event: session.status\ndata: ${JSON.stringify({
        type: "session.status",
        properties: { status: { type: "busy" } },
      })}\n\n`,
    );

    // Allow the client to render the busy state before the next event.
    await delay(300);

    writeSse(res,
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

    await delay(300);

    // OpenCode announces each semantic part before its deltas; reasoning uses
    // the same "text" delta field as answer text.
    writeSse(res,
      `event: message.part.updated\ndata: ${JSON.stringify({
        type: "message.part.updated",
        properties: {
          part: {
            id: "reason-part-1",
            sessionID: sessionId ?? FIXTURE_SESSION_ID,
            messageID,
            type: "reasoning",
          },
        },
      })}\n\n`,
    );

    await delay(100);

    const reasoningChunks = [
      "Let me think about this...",
      " The user wants to know about the chat pipeline.",
      " I should explain how it works step by step.",
    ];
    for (const chunk of reasoningChunks) {
      await delay(100);
      writeSse(res,
        `event: message.part.delta\ndata: ${JSON.stringify({
          type: "message.part.delta",
          properties: {
            messageID,
            partID: "reason-part-1",
            field: "text",
            delta: chunk,
          },
        })}\n\n`,
      );
    }

    // Keep the provider in the thinking phase separate from later tool and
    // response events so the rich fixture exercises incremental reasoning.
    await delay(1_500);

    // Emit the full lifecycle so the UI can exercise each tool state.
    const toolPartId = "tool-part-1";
    const toolCallId = "call_bash_001";

    writeSse(res,
      `event: message.part.updated\ndata: ${JSON.stringify({
        type: "message.part.updated",
        properties: {
          part: {
            id: toolPartId,
            sessionID: sessionId ?? FIXTURE_SESSION_ID,
            messageID,
            type: "tool",
            tool: "bash",
            callID: toolCallId,
            state: {
              status: "pending",
              input: { command: "echo 'Hello from tool'" },
              time: { start: Date.now() },
            },
          },
        },
      })}\n\n`,
    );

    await delay(300);

    writeSse(res,
      `event: message.part.updated\ndata: ${JSON.stringify({
        type: "message.part.updated",
        properties: {
          part: {
            id: toolPartId,
            sessionID: sessionId ?? FIXTURE_SESSION_ID,
            messageID,
            type: "tool",
            tool: "bash",
            callID: toolCallId,
            state: {
              status: "running",
              input: { command: "echo 'Hello from tool'" },
              time: { start: Date.now() - 500 },
            },
          },
        },
      })}\n\n`,
    );

    await delay(300);

    writeSse(res,
      `event: message.part.updated\ndata: ${JSON.stringify({
        type: "message.part.updated",
        properties: {
          part: {
            id: toolPartId,
            sessionID: sessionId ?? FIXTURE_SESSION_ID,
            messageID,
            type: "tool",
            tool: "bash",
            callID: toolCallId,
            state: {
              status: "completed",
              input: { command: "echo 'Hello from tool'" },
              output: "Hello from tool\n",
              time: { start: Date.now() - 1000, end: Date.now() },
              title: "Run shell command",
            },
          },
        },
      })}\n\n`,
    );

    await delay(300);

    // Concrete results let the disclosure be tested without an external provider.
    writeSse(res,
      `event: message.part.updated\ndata: ${JSON.stringify({
        type: "message.part.updated",
        properties: {
          part: {
            id: "web-search-part-1",
            sessionID: sessionId ?? FIXTURE_SESSION_ID,
            messageID,
            type: "tool",
            tool: "websearch",
            callID: "call_websearch_001",
            state: {
              status: "completed",
              input: { query: "transparent chat streaming" },
              output: {
                results: [
                  { url: "https://results.example.test/chat-streaming" },
                ],
                visited: [
                  { url: "https://visited.example.test/stream-lifecycle" },
                ],
              },
              time: { start: Date.now() - 700, end: Date.now() },
            },
          },
        },
      })}\n\n`,
    );

    await delay(300);

    // Keep answer and reasoning as separate parts while following the same
    // part-updated → text-delta contract.
    writeSse(res,
      `event: message.part.updated\ndata: ${JSON.stringify({
        type: "message.part.updated",
        properties: {
          part: {
            id: partID,
            sessionID: sessionId ?? FIXTURE_SESSION_ID,
            messageID,
            type: "text",
          },
        },
      })}\n\n`,
    );

    await delay(100);

    writeSse(res,
      `event: message.part.delta\ndata: ${JSON.stringify({
        type: "message.part.delta",
        properties: {
          messageID,
          partID,
          field: "text",
          delta: "I've completed the analysis. The chat pipeline is working correctly.\n\n> **Note:** This callout remains plain provider output.",
        },
      })}\n\n`,
    );

    await delay(300);

    // Keep completion metadata separate so the browser can prove reasoning
    // remains open until session.idle.
    writeSse(res,
      `event: message.updated\ndata: ${JSON.stringify({
        type: "message.updated",
        properties: {
          info: {
            id: messageID,
            role: "assistant",
            sessionID: sessionId ?? FIXTURE_SESSION_ID,
            providerID: "opencode",
            modelID: "fixture-model",
            completed: true,
            time: { created: Date.now() - 3000, completed: Date.now() },
          },
        },
      })}\n\n`,
    );

    await delay(1_200);

    writeSse(res,
      `event: session.idle\ndata: ${JSON.stringify({
        type: "session.idle",
        properties: {},
      })}\n\n`,
    );

    // OpenCode's real /event endpoint remains connected after a turn reaches
    // session.idle. Hold this fixture connection open until the browser closes
    // it so the E2E path catches intermediary proxies that buffer an entire
    // SSE response instead of forwarding events as they arrive.
    await new Promise<void>((resolve) => {
      if (res.destroyed || res.writableEnded) {
        resolve();
        return;
      }
      res.once("close", resolve);
    });
  } else {
    const streamText = "Hello! I received your message. This confirms the chat pipeline is working.";

    writeSse(res,
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

    // The text part is announced before its delta.
    writeSse(res,
      `event: message.part.updated\ndata: ${JSON.stringify({
        type: "message.part.updated",
        properties: {
          part: {
            id: partID,
            sessionID: sessionId ?? FIXTURE_SESSION_ID,
            messageID,
            type: "text",
          },
        },
      })}\n\n`,
    );

    writeSse(res,
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

    writeSse(res,
      `event: session.idle\ndata: ${JSON.stringify({
        type: "session.idle",
        properties: {},
      })}\n\n`,
    );
  }

  } finally {
    state.sseResponses.delete(res);
    if (!res.writableEnded && !res.destroyed) res.end();
  }
}

function route(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? "/";
  const method = (req.method ?? "GET").toUpperCase();

  const path = url.split("?")[0]!;

  const query = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?")) : "");

  if (method === "POST" && path === "/__fixture/reset") {
    const expectedNonce = process.env.INGENIUM_TEST_RUN_NONCE;
    if (
      process.env.CHAT_FIXTURE_RUNNER !== "1"
      || !expectedNonce
      || req.headers["x-ingenium-fixture-run-nonce"] !== expectedNonce
    ) {
      notFound(res);
      return;
    }
    sessions.length = 0;
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
    return;
  }

  if (method === "POST" && path === "/session") {
    parseBody(req).then(() => {
      const s = makeSession(FIXTURE_SESSION_ID, "New conversation");
      sessions.push(s);
      json(res, 201, s);
    }).catch(() => {
      if (!res.destroyed && !res.writableEnded) res.destroy();
    });
    return;
  }

  if (method === "GET" && path === "/session") {
    json(res, 200, sessions);
    return;
  }

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

  const getMessagesMatch = path.match(/^\/session\/([^/]+)\/message$/);
  if (method === "GET" && getMessagesMatch) {
    const id = getMessagesMatch[1]!;
    if (id === FIXTURE_SESSION_ID) {
      // Return the user message only — the assistant response arrives via SSE.
      // Returning both would cause duplication with the SSE stream.
      json(res, 200, [userMessage()]);
    } else {
      notFound(res);
    }
    return;
  }

  const postMessageMatch = path.match(/^\/session\/([^/]+)\/message$/);
  if (method === "POST" && postMessageMatch) {
    parseBody(req).then((body) => {
      let userText = "";
      try {
        const parsed = JSON.parse(body);
        if (parsed.parts && Array.isArray(parsed.parts)) {
          userText = parsed.parts
            .filter((p: { type: string }) => p.type === "text")
            .map((p: { text?: string }) => p.text ?? "")
            .join(" ");
        }
      } catch {
      }

      const createdMsg = userMessage();
      createdMsg.info.id = "msg-3";
      if (userText) {
        createdMsg.parts[0]!.text = userText;
      }
      json(res, 201, createdMsg);
    }).catch(() => {
      if (!res.destroyed && !res.writableEnded) res.destroy();
    });
    return;
  }

  if (method === "GET" && path === "/event") {
    const sessionParam = query.get("session");
    const mode = (query.get("mode") || "rich") as "simple" | "rich";
    if (sessionParam && sessionParam !== FIXTURE_SESSION_ID) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      writeSse(res, `event: session.idle\ndata: {"type":"session.idle","properties":{}}\n\n`);
      if (!res.destroyed && !res.writableEnded) res.end();
      return;
    }
    streamSSE(res, mode);
    return;
  }

  if (method === "GET" && path === "/provider") {
    json(res, 200, fixtureProviders(runtime().port));
    return;
  }

  if (method === "GET" && path === "/global/health") {
    json(res, 200, { healthy: true, version: FIXTURE_VERSION });
    return;
  }

  if (method === "GET" && path === "/mcp") {
    json(res, 200, {});
    return;
  }

  if (method === "GET" && path === "/permission") {
    json(res, 200, []);
    return;
  }

  if (method === "GET" && path === "/question") {
    json(res, 200, []);
    return;
  }

  if (method === "GET" && path === "/agent") {
    json(res, 200, []);
    return;
  }

  notFound(res);
}

export function createChatFixtureServer(port = getFixturePort()): Server {
  const server = createServer(route);
  fixtureRuntime = {
    server,
    port,
    sockets: new Set(),
    sseResponses: new Set(),
    timers: new Set(),
    shuttingDown: false,
  };
  sessions.length = 0;
  server.on("connection", (socket) => {
    const state = runtime();
    state.sockets.add(socket);
    socket.once("close", () => state.sockets.delete(socket));
  });
  return server;
}

export async function startChatFixtureServer(port = getFixturePort()): Promise<Server> {
  const server = createChatFixtureServer(port);
  await new Promise<void>((resolve, reject) => {
    const onListening = () => {
      server.off("error", onError);
      const address = server.address() as AddressInfo | null;
      if (address && typeof address !== "string") runtime().port = address.port;
      resolve();
    };
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
  return server;
}

export async function closeChatFixtureServer(server: Server, timeoutMs = 5_000): Promise<void> {
  const state = fixtureRuntime?.server === server ? fixtureRuntime : undefined;
  if (state) {
    state.shuttingDown = true;
    for (const timer of state.timers) clearTimeout(timer);
    state.timers.clear();
    for (const response of state.sseResponses) response.destroy();
    for (const socket of state.sockets) socket.destroy();
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error(`Chat fixture did not close within ${timeoutMs}ms`)), timeoutMs);
    server.close((error) => finish(error ?? undefined));
    if (!server.listening) finish();
  });
  if (fixtureRuntime?.server === server) fixtureRuntime = undefined;
}

export interface FixtureSignalSource {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  removeListener(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export function installFixtureSignalHandlers(
  server: Server,
  signalSource: FixtureSignalSource = process,
  exit: (code: number) => void = (code) => process.exit(code),
): () => void {
  let shuttingDown = false;
  const onSignal = (code: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    void closeChatFixtureServer(server).catch(() => undefined).finally(() => exit(code));
  };
  const onInterrupt = () => onSignal(130);
  const onTerminate = () => onSignal(143);
  signalSource.once("SIGINT", onInterrupt);
  signalSource.once("SIGTERM", onTerminate);
  return () => {
    signalSource.removeListener("SIGINT", onInterrupt);
    signalSource.removeListener("SIGTERM", onTerminate);
  };
}

// The direct-argv check preserves `tsx tests/chat-fixture-server.ts` for local
// debugging. The explicit environment gate is used by the managed runner and
// keeps importing this module in Vitest from binding a listener.
const directExecution = typeof process.argv[1] === "string" && /^chat-fixture-server\.(ts|js)$/.test(basename(process.argv[1]));
if (directExecution || process.env.CHAT_FIXTURE_RUNNER === "1") {
  const port = getFixturePort();
  void startChatFixtureServer(port).then((server) => {
    installFixtureSignalHandlers(server);
    // eslint-disable-next-line no-console
    console.log(`[chat-fixture] Listening on http://127.0.0.1:${port}`);
  }).catch((error: unknown) => {
    const code = (error as NodeJS.ErrnoException).code;
    // eslint-disable-next-line no-console
    console.error(code === "EADDRINUSE" ? `[chat-fixture] Port ${port} is already in use` : error);
    process.exitCode = 1;
  });
}
