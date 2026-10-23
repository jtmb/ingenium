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
 * Implements the native OpenCode 2.0.11 `/api` contract, including location-bound
 * sessions, paginated envelopes, split provider/model catalogs, prompt admission,
 * and global native events. Legacy routes deliberately return 404 so stale clients
 * cannot accidentally pass acceptance. POST /__fixture/reset is runner-only.
 */

export const DEFAULT_FIXTURE_PORT = 4999;
const FIXTURE_VERSION = "2.0.11";

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
  projectID: string;
  location: { directory: string };
  time: { created: number; updated: number };
  cost: number;
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
  agent: string;
  model: { id: string; providerID: string };
}

interface FixtureMessage {
  id: string;
  type: "user" | "assistant";
  time: { created: number; completed?: number };
  text?: string;
  metadata?: Record<string, unknown>;
  content?: Array<Record<string, unknown>>;
  model?: FixtureSession["model"];
  finish?: string;
}

const sessions: FixtureSession[] = [];
const messages = new Map<string, FixtureMessage[]>();
const activeTurns = new Set<string>();
let generation = 0;
let eventSequence = 0;
let sessionSequence = 0;

function resetFixtureState(): void {
  generation += 1;
  sessions.length = 0;
  messages.clear();
  activeTurns.clear();
}

function makeSession(directory: string, title: string): FixtureSession {
  // API checkpoint receipts survive a per-test fixture reset. Reusing a native
  // session ID would collide with an earlier test's immutable turn identity.
  const id = `fixture-session-${++sessionSequence}`;
  return {
    id, title, projectID: "fixture-project", location: { directory },
    time: { created: Date.now(), updated: Date.now() },
    cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    agent: "ingenium-chat", model: { id: "fixture-model", providerID: "opencode" },
  };
}

const fixtureModel = {
  modelID: "fixture-model", providerID: "opencode", name: "Fixture Model",
  capabilities: {}, cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
  limit: { context: 4096, output: 1024 }, status: "active", settings: {},
};

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

/** The native event endpoint is global and stays connected between turns. */
function streamSSE(res: ServerResponse): void {
  const state = runtime();
  state.sseResponses.add(res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
    Connection: "keep-alive", "X-Accel-Buffering": "no",
  });
  writeSse(res, ": connected\n\n");
  res.once("close", () => state.sseResponses.delete(res));
}

/** Emit native events so browser acceptance also exercises the API projection. */
async function runTurn(session: FixtureSession, user: FixtureMessage): Promise<void> {
  const turnGeneration = generation;
  const assistantMessageID = `${user.id}-assistant`;
  const emit = (type: string, data: Record<string, unknown> = {}) => {
    if (turnGeneration !== generation || !activeTurns.has(session.id)) return;
    const event = {
      id: `fixture-event-${++eventSequence}`, type,
      data: { sessionID: session.id, assistantMessageID, timestamp: Date.now(), ...data },
    };
    for (const response of runtime().sseResponses) {
      writeSse(response, `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    }
  };
  activeTurns.add(session.id);
  // The browser subscribes before prompt admission; delayed native events let
  // the DOM demonstrate incremental reasoning independently of the final text.
  await delay(300);
  emit("session.next.step.started", { agent: session.agent, model: session.model });
  await delay(300);
  const reasoningID = `${assistantMessageID}:reasoning`;
  emit("session.next.reasoning.started", { reasoningID });
  const chunks = ["Let me think about this...", " The user wants to know about the chat pipeline.", " I should explain how it works step by step."];
  for (const delta of chunks) {
    await delay(100);
    emit("session.next.reasoning.delta", { reasoningID, delta });
  }
  await delay(1_500);
  emit("session.next.reasoning.ended", { reasoningID, text: chunks.join("") });
  const shell = { callID: `${assistantMessageID}:shell`, tool: "bash", input: { command: "echo 'Hello from tool'" } };
  emit("session.next.tool.input.ended", { ...shell, text: JSON.stringify(shell.input) });
  await delay(300);
  emit("session.next.tool.called", shell);
  await delay(300);
  emit("session.next.tool.success", { ...shell, result: "Hello from tool\n" });
  await delay(300);
  const search = { callID: `${assistantMessageID}:websearch`, tool: "websearch", input: { query: "transparent chat streaming" } };
  const searchResult = {
    results: [{ url: "https://results.example.test/chat-streaming" }],
    visited: [{ url: "https://visited.example.test/stream-lifecycle" }],
  };
  emit("session.next.tool.called", search);
  emit("session.next.tool.success", { ...search, result: searchResult });
  await delay(300);
  const textID = `${assistantMessageID}:text`;
  const text = "I've completed the analysis. The chat pipeline is working correctly.\n\n> **Note:** This callout remains plain provider output.";
  emit("session.next.text.started", { textID });
  await delay(100);
  emit("session.next.text.delta", { textID, delta: text });
  emit("session.next.text.ended", { textID, text });
  await delay(1_200);
  if (turnGeneration !== generation || !activeTurns.has(session.id)) return;
  messages.get(session.id)!.push({
    id: assistantMessageID, type: "assistant", time: { created: user.time.created, completed: Date.now() },
    model: session.model, finish: "stop", content: [
      { type: "reasoning", text: chunks.join("") },
      { type: "tool", id: shell.callID, name: shell.tool, state: { status: "completed", input: shell.input, content: "Hello from tool\n" } },
      { type: "tool", id: search.callID, name: search.tool, state: { status: "completed", input: search.input, content: searchResult } },
      { type: "text", text },
    ],
  });
  emit("session.next.step.ended", { finish: "stop", cost: 0, tokens: session.tokens });
  activeTurns.delete(session.id);
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://fixture.local");
  const path = url.pathname;
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "POST" && path === "/__fixture/reset") {
    const nonce = process.env.INGENIUM_TEST_RUN_NONCE;
    if (process.env.CHAT_FIXTURE_RUNNER !== "1" || !nonce || req.headers["x-ingenium-fixture-run-nonce"] !== nonce) {
      notFound(res); return;
    }
    resetFixtureState();
    res.writeHead(204, { "Cache-Control": "no-store" }); res.end(); return;
  }
  if (method === "GET" && path === "/api/info") {
    json(res, 200, { version: FIXTURE_VERSION }); return;
  }
  if (method === "GET" && path === "/api/provider") {
    json(res, 200, { data: [{ id: "opencode", name: "OpenCode Zen", activation: "enabled", package: "fixture", settings: {} }] }); return;
  }
  if (method === "GET" && path === "/api/model") {
    json(res, 200, { data: [fixtureModel] }); return;
  }
  if (method === "GET" && path === "/api/model/default") {
    json(res, 200, { data: fixtureModel }); return;
  }
  if (method === "GET" && path === "/api/agent") {
    json(res, 200, { data: [{ id: "ingenium-chat", name: "ingenium-chat", mode: "primary", permissions: [] }] }); return;
  }
  if (method === "GET" && ["/api/permission/request", "/api/form", "/api/integration", "/api/mcp"].includes(path)) {
    json(res, 200, { data: [] }); return;
  }
  if (method === "GET" && path === "/api/session/active") {
    json(res, 200, { data: Object.fromEntries([...activeTurns].map((id) => [id, { type: "busy" }])) }); return;
  }
  if (method === "GET" && path === "/api/event") {
    streamSSE(res); return;
  }
  if (method === "POST" && path === "/api/session") {
    const body = JSON.parse(await parseBody(req) || "{}");
    const session = makeSession(body.location?.directory ?? "/workspace", body.title ?? "New conversation");
    sessions.push(session); messages.set(session.id, []);
    json(res, 201, { data: session }); return;
  }
  if (method === "GET" && path === "/api/session") {
    const directory = url.searchParams.get("directory");
    json(res, 200, { data: sessions.filter((s) => directory === null || s.location.directory === directory), cursor: {} }); return;
  }
  const match = path.match(/^\/api\/session\/([^/]+)(?:\/(message|prompt|model|agent|interrupt))?$/);
  if (!match) { notFound(res); return; }
  const session = sessions.find((s) => s.id === match[1]);
  if (!session) { notFound(res); return; }
  const action = match[2];
  if (method === "GET" && !action) { json(res, 200, { data: session }); return; }
  if (method === "PATCH" && !action) {
    const body = JSON.parse(await parseBody(req));
    if (typeof body.title === "string") session.title = body.title;
    session.time.updated = Date.now();
    res.writeHead(204); res.end(); return;
  }
  if (method === "GET" && action === "message") {
    json(res, 200, { data: messages.get(session.id), cursor: {} }); return;
  }
  if (method === "POST" && action === "interrupt") {
    activeTurns.delete(session.id); json(res, 200, { interrupted: true }); return;
  }
  if (method === "POST" && (action === "agent" || action === "model")) {
    const body = JSON.parse(await parseBody(req));
    if (action === "agent") session.agent = body.agent;
    else session.model = body.model;
    res.writeHead(204); res.end(); return;
  }
  if (method === "POST" && action === "prompt") {
    const body = JSON.parse(await parseBody(req));
    const history = messages.get(session.id)!;
    const user: FixtureMessage = {
      id: `${session.id}-msg-${history.length + 1}`, type: "user", time: { created: Date.now() },
      text: body.text ?? "", metadata: body.metadata,
    };
    history.push(user);
    json(res, 201, { data: user });
    void runTurn(session, user).catch(() => activeTurns.delete(session.id)); return;
  }
  notFound(res);
}

export function createChatFixtureServer(port = getFixturePort()): Server {
  const server = createServer((req, res) => {
    void route(req, res).catch(() => {
      if (!res.headersSent) json(res, 400, { error: { code: "INVALID_REQUEST", message: "Invalid fixture request" } });
      else res.destroy();
    });
  });
  fixtureRuntime = {
    server,
    port,
    sockets: new Set(),
    sseResponses: new Set(),
    timers: new Set(),
    shuttingDown: false,
  };
  resetFixtureState();
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
