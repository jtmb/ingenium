#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  rmSync,
  writeSync,
} from "node:fs";
import { createServer } from "node:http";
import { basename, isAbsolute, join } from "node:path";

export const THREAD_GUARD_SESSION = "ingenium";
export const THREAD_GUARD_PORT = 8081;

const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
const MAX_REQUEST_BYTES = 24 * 1024 * 1024;
const MAX_UPSTREAM_MESSAGE_BYTES = 1_048_576;
const MAX_IN_FLIGHT = 8;
const REQUEST_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 3_000;
const SAFE_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:jsonl|json|md|txt)$/;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const OPERATIONS = new Map([
  ["upload", "thread_upload_file"],
  ["search", "thread_search"],
  ["read", "thread_read_entries"],
  ["batch", "thread_read_entries_batch"],
  ["tags", "thread_get_tags"],
  ["stats", "thread_get_stats"],
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function safeError(response, status, message) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", connection: "close" });
  response.end(JSON.stringify({ ok: false, error: message }));
}

function parseJsonObject(bytes) {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!isRecord(value) || Object.keys(value).some((key) => key === "__proto__" || key === "constructor" || key === "prototype")) return null;
    return value;
  } catch {
    return null;
  }
}

function assertPrivateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  chmodSync(path, PRIVATE_DIRECTORY_MODE);
  const entry = lstatSync(path);
  const uid = currentUid();
  if (!entry.isDirectory() || entry.isSymbolicLink() || (entry.mode & 0o777) !== PRIVATE_DIRECTORY_MODE || (uid !== null && entry.uid !== uid)) {
    throw new Error("invalid private directory");
  }
}

function writeAll(descriptor, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
    if (written <= 0) throw new Error("write failed");
    offset += written;
  }
}

function createPrivateUpload(tempDirectory, filename, bytes) {
  assertPrivateDirectory(tempDirectory);
  const runDirectory = join(tempDirectory, `request-${randomUUID()}`);
  mkdirSync(runDirectory, { mode: PRIVATE_DIRECTORY_MODE });
  chmodSync(runDirectory, PRIVATE_DIRECTORY_MODE);
  const uploadPath = join(runDirectory, `${randomUUID()}-${filename}`);
  let descriptor;
  try {
    descriptor = openSync(uploadPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, PRIVATE_FILE_MODE);
    writeAll(descriptor, bytes);
    fsyncSync(descriptor);
    const entry = fstatSync(descriptor);
    const uid = currentUid();
    if (!entry.isFile() || entry.nlink !== 1 || (entry.mode & 0o777) !== PRIVATE_FILE_MODE || entry.size !== bytes.length || (uid !== null && entry.uid !== uid)) {
      throw new Error("write failed");
    }
  } catch (error) {
    try {
      if (descriptor !== undefined) closeSync(descriptor);
    } catch {
      // Best-effort cleanup; do not reveal a temporary pathname.
    }
    rmSync(runDirectory, { recursive: true, force: true });
    throw error;
  }
  closeSync(descriptor);
  return {
    path: uploadPath,
    cleanup() {
      try {
        rmSync(runDirectory, { recursive: true, force: true });
      } catch {
        // The private run directory is retained only if cleanup itself fails.
      }
    },
  };
}

function strictBase64(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(MAX_UPLOAD_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("invalid upload");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES || bytes.toString("base64") !== value) throw new Error("invalid upload");
  return bytes;
}

function optionalTags(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 1_024 || hasControlCharacters(value)) throw new Error("invalid request");
  return value;
}

function optionalPriority(value) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0 || value > 10) throw new Error("invalid request");
  return value;
}

function assertArgumentKeys(arguments_, allowed) {
  for (const key of Object.keys(arguments_)) {
    if (!allowed.has(key)) throw new Error("invalid request");
  }
}

function forcedArguments(operation, arguments_) {
  if (!isRecord(arguments_) || Object.keys(arguments_).some((key) => key === "__proto__" || key === "constructor" || key === "prototype")) {
    throw new Error("invalid request");
  }
  const output = Object.create(null);
  if (operation === "upload") {
    assertArgumentKeys(arguments_, new Set(["filename", "contentBase64", "tags", "priority"]));
    if (typeof arguments_.filename !== "string" || basename(arguments_.filename) !== arguments_.filename || !SAFE_FILENAME_PATTERN.test(arguments_.filename)) {
      throw new Error("invalid upload");
    }
    output.bytes = strictBase64(arguments_.contentBase64);
    output.filename = arguments_.filename;
    const tags = optionalTags(arguments_.tags);
    const priority = optionalPriority(arguments_.priority);
    if (tags !== undefined) output.tags = tags;
    if (priority !== undefined) output.priority = priority;
    return output;
  }
  if (operation === "search") {
    assertArgumentKeys(arguments_, new Set(["query", "limit", "use_cache"]));
    if (typeof arguments_.query !== "string" || arguments_.query.length === 0 || arguments_.query.length > 4_096 || hasControlCharacters(arguments_.query)) {
      throw new Error("invalid request");
    }
    output.query = arguments_.query;
    if (arguments_.limit !== undefined) {
      if (!Number.isSafeInteger(arguments_.limit) || arguments_.limit < 1 || arguments_.limit > 100) throw new Error("invalid request");
      output.limit = arguments_.limit;
    }
    if (arguments_.use_cache !== undefined) {
      if (typeof arguments_.use_cache !== "boolean") throw new Error("invalid request");
      output.use_cache = arguments_.use_cache;
    }
    return output;
  }
  if (operation === "read") {
    assertArgumentKeys(arguments_, new Set(["limit", "after", "sort"]));
    if (arguments_.limit !== undefined) {
      if (!Number.isSafeInteger(arguments_.limit) || arguments_.limit < 1 || arguments_.limit > 200) throw new Error("invalid request");
      output.limit = arguments_.limit;
    }
    if (arguments_.after !== undefined) {
      if (!Number.isSafeInteger(arguments_.after) || arguments_.after < 0) throw new Error("invalid request");
      output.after = arguments_.after;
    }
    if (arguments_.sort !== undefined) {
      if (arguments_.sort !== "asc" && arguments_.sort !== "desc") throw new Error("invalid request");
      output.sort = arguments_.sort;
    }
    return output;
  }
  if (operation === "batch") {
    assertArgumentKeys(arguments_, new Set(["ids"]));
    if (!Array.isArray(arguments_.ids) || arguments_.ids.length === 0 || arguments_.ids.length > 100 || !arguments_.ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
      throw new Error("invalid request");
    }
    output.ids = [...arguments_.ids];
  }
  if (operation === "tags" || operation === "stats") assertArgumentKeys(arguments_, new Set());
  return output;
}

function requestKey(id) {
  return `${typeof id}:${String(id)}`;
}

class OfficialThreadBridge {
  constructor({ command, args, cwd, env, onFatal }) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
    this.onFatal = onFatal;
    this.child = null;
    this.processGroupId = null;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.closed = false;
    this.ready = null;
    this.readyState = false;
  }

  start() {
    if (this.child || this.closed) throw new Error("bridge unavailable");
    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.processGroupId = process.platform === "win32" ? null : this.child.pid ?? null;
    this.child.stdout?.on("data", (chunk) => this.onStdout(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    this.child.stdout?.on("error", () => this.fail());
    this.child.stdin?.on("error", () => this.fail());
    // The official bridge logs incoming argument values to stderr. Drain it
    // without logging or forwarding it across the guard boundary.
    this.child.stderr?.resume();
    this.child.once("error", () => this.fail());
    this.child.once("close", () => this.fail());
    this.ready = this.request("initialize", {
      protocolVersion: "2024-11-05",
      clientInfo: { name: "ingenium-thread-guard", version: "1.0.0" },
      capabilities: {},
    }).then(() => {
      try {
        this.child?.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
        this.readyState = true;
      } catch {
        throw new Error("bridge unavailable");
      }
    });
    void this.ready.catch(() => this.fail());
  }

  isReady() {
    return this.readyState && !this.closed;
  }

  call(toolName, arguments_) {
    if (!this.ready) return Promise.reject(new Error("bridge unavailable"));
    return this.ready.then(() => this.request("tools/call", { name: toolName, arguments: arguments_ }));
  }

  request(method, params) {
    if (this.closed || !this.child?.stdin || this.child.stdin.destroyed || this.pending.size >= MAX_IN_FLIGHT) {
      return Promise.reject(new Error("bridge unavailable"));
    }
    const id = this.nextId++;
    const message = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestKey(id));
        reject(new Error("bridge unavailable"));
        this.fail();
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestKey(id), { resolve, reject, timer });
      try {
        this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
          if (error) this.fail();
        });
      } catch {
        this.fail();
      }
    });
  }

  onStdout(chunk) {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_UPSTREAM_MESSAGE_BYTES) {
      this.fail();
      return;
    }
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) return;
      const line = this.buffer.toString("utf8", 0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.subarray(newline + 1);
      if (line.length === 0) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.fail();
        return;
      }
      if (!isRecord(message) || !Object.hasOwn(message, "id")) continue;
      const pending = this.pending.get(requestKey(message.id));
      if (!pending) continue;
      this.pending.delete(requestKey(message.id));
      clearTimeout(pending.timer);
      if (isRecord(message.error) || !Object.hasOwn(message, "result")) pending.reject(new Error("bridge unavailable"));
      else pending.resolve(message.result);
    }
  }

  async stop() {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("bridge unavailable"));
    }
    this.pending.clear();
    try {
      this.child?.stdin?.end();
    } catch {
      // The child may have exited between the state check and stdin close.
    }
    this.signal("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, Math.floor(SHUTDOWN_TIMEOUT_MS / 2)));
    this.signal("SIGKILL");
  }

  signal(signal) {
    try {
      if (this.processGroupId !== null) process.kill(-this.processGroupId, signal);
      else this.child?.kill(signal);
    } catch {
      // ESRCH means the dedicated bridge group has already exited.
    }
  }

  fail() {
    if (this.closed) return;
    void this.stop().finally(() => this.onFatal());
  }
}

function defaultOptions() {
  return {
    host: process.env.THREAD_GUARD_HOST ?? "0.0.0.0",
    port: Number(process.env.THREAD_GUARD_PORT ?? THREAD_GUARD_PORT),
    tempDirectory: process.env.THREAD_GUARD_TEMP_DIRECTORY ?? "/run/thread-guard",
    command: "/opt/thread/venv/bin/python",
    args: ["-m", "thread_bridge.bridge"],
    cwd: "/opt/thread/src",
    env: {
      PATH: process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      HOME: process.env.HOME ?? "/home/appuser",
      PYTHONUNBUFFERED: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      THREAD_SERVER_URL: "http://thread:5000",
    },
  };
}

/** Start the bounded frontend protocol around one official, pinned Thread bridge. */
export function startThreadGuardService(options = {}) {
  const configuration = { ...defaultOptions(), ...options };
  if (!Number.isInteger(configuration.port) || configuration.port < 1 || configuration.port > 65_535 || typeof configuration.host !== "string") {
    throw new Error("invalid Thread guard configuration");
  }
  let stopping = false;
  let inFlight = 0;
  const server = createServer({ maxHeaderSize: 8 * 1024 }, async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      if (stopping || !bridge.isReady()) {
        safeError(response, 503, "unavailable");
        return;
      }
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end("{\"ok\":true}");
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/call" || inFlight >= MAX_IN_FLIGHT) {
      safeError(response, inFlight >= MAX_IN_FLIGHT ? 429 : 404, "rejected");
      return;
    }
    const chunks = [];
    let total = 0;
    let rejected = false;
    request.on("data", (chunk) => {
      if (rejected) return;
      total += chunk.length;
      if (total > MAX_REQUEST_BYTES) {
        rejected = true;
        safeError(response, 413, "rejected");
        request.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    request.once("error", () => {
      if (!response.writableEnded) safeError(response, 400, "rejected");
    });
    request.once("end", async () => {
      if (rejected || response.writableEnded) return;
      const payload = parseJsonObject(Buffer.concat(chunks));
      if (!payload || Object.keys(payload).some((key) => key !== "operation" && key !== "arguments") || typeof payload.operation !== "string" || !OPERATIONS.has(payload.operation)) {
        safeError(response, 400, "rejected");
        return;
      }
      let arguments_;
      try {
        arguments_ = forcedArguments(payload.operation, payload.arguments);
      } catch {
        safeError(response, 400, "rejected");
        return;
      }
      inFlight += 1;
      let temporaryUpload;
      try {
        let upstreamArguments;
        if (payload.operation === "upload") {
          temporaryUpload = createPrivateUpload(configuration.tempDirectory, arguments_.filename, arguments_.bytes);
          upstreamArguments = { session: THREAD_GUARD_SESSION, file_path: temporaryUpload.path };
          if (arguments_.tags !== undefined) upstreamArguments.tags = arguments_.tags;
          if (arguments_.priority !== undefined) upstreamArguments.priority = arguments_.priority;
        } else {
          upstreamArguments = { ...arguments_, session: THREAD_GUARD_SESSION };
        }
        const result = await bridge.call(OPERATIONS.get(payload.operation), upstreamArguments);
        const safeResult = payload.operation === "upload"
          ? { isError: isRecord(result) && result.isError === true }
          : result;
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify({ ok: true, result: safeResult }));
      } catch {
        if (!response.writableEnded) safeError(response, 502, "unavailable");
      } finally {
        temporaryUpload?.cleanup();
        inFlight -= 1;
      }
    });
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS + 1_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;

  const shutdown = async (exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    await new Promise((resolve) => server.close(() => resolve()));
    await bridge.stop();
    if (options.onShutdown) options.onShutdown(exitCode);
  };
  const bridge = new OfficialThreadBridge({
    command: configuration.command,
    args: configuration.args,
    cwd: configuration.cwd,
    env: configuration.env,
    onFatal: () => { void shutdown(1); },
  });
  bridge.start();
  server.listen(configuration.port, configuration.host);
  return { server, bridge, shutdown };
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const service = startThreadGuardService({
    onShutdown: (exitCode) => process.exit(exitCode),
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => { void service.shutdown(0); });
  }
}
