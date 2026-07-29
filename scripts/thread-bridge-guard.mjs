import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const THREAD_BRIDGE_SESSION = "ingenium";
export const THREAD_BRIDGE_EXPORT_DIRECTORY = "/workspace/ingenium/.ingenium/thread-exports";

const MAX_STDIO_MESSAGE_BYTES = 1_048_576;
const MAX_EXPORT_BYTES = 16 * 1024 * 1024;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const EXPORT_FILE_PATTERN = /^thread-export-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;
const RECEIPT_FILE_PATTERN = /^thread-export-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl\.receipt\.json$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ALLOWED_TOOLS = new Set(["thread_upload_file", "thread_search", "thread_read"]);
const RELAY_METHODS = new Set([
  "initialize",
  "ping",
  "notifications/initialized",
  "notifications/cancelled",
  "notifications/progress",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeRequestId(message) {
  if (!Object.hasOwn(message, "id")) return null;
  const { id } = message;
  if (typeof id !== "string" && typeof id !== "number" && id !== null) return null;
  return id;
}

function requestKey(id) {
  return `${typeof id}:${String(id)}`;
}

function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function sameFile(first, second) {
  return first.dev === second.dev
    && first.ino === second.ino
    && first.size === second.size
    && first.mode === second.mode
    && first.uid === second.uid
    && first.nlink === second.nlink;
}

/** Reject symlinks and lexical aliases all the way from the filesystem root. */
function assertCanonicalDirectory(path) {
  if (!isAbsolute(path) || resolve(path) !== path || hasControlCharacters(path)) throw new Error("invalid directory");
  const segments = path === sep ? [] : path.slice(1).split(sep);
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === ".." || hasControlCharacters(segment))) {
    throw new Error("invalid directory");
  }

  let current = sep;
  const root = lstatSync(current);
  if (!root.isDirectory() || root.isSymbolicLink() || realpathSync(current) !== current) throw new Error("invalid directory");
  for (const segment of segments) {
    current = `${current === sep ? "" : current}${sep}${segment}`;
    const entry = lstatSync(current);
    if (!entry.isDirectory() || entry.isSymbolicLink() || realpathSync(current) !== current) throw new Error("invalid directory");
  }
}

function assertPrivateDirectory(path) {
  assertCanonicalDirectory(path);
  const entry = lstatSync(path);
  if ((entry.mode & 0o777) !== PRIVATE_DIRECTORY_MODE) throw new Error("invalid directory");
  const uid = currentUid();
  if (uid !== null && entry.uid !== uid) throw new Error("invalid directory");
}

function assertExportPath(path, exportDirectory) {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path || hasControlCharacters(path)) {
    throw new Error("invalid export path");
  }
  const relativePath = relative(exportDirectory, path);
  if (
    relativePath.length === 0
    || relativePath === "."
    || isAbsolute(relativePath)
    || relativePath.startsWith(`..${sep}`)
    || relativePath === ".."
  ) throw new Error("invalid export path");
  const segments = relativePath.split(sep);
  if (segments.length !== 1 || segments.some((segment) => segment.length === 0 || segment === "." || segment === ".." || hasControlCharacters(segment))) {
    throw new Error("invalid export path");
  }
  if (!EXPORT_FILE_PATTERN.test(segments[0])) throw new Error("invalid export path");
}

function assertReceiptPath(path, exportPath, exportDirectory) {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path || hasControlCharacters(path)) {
    throw new Error("invalid receipt path");
  }
  if (dirname(path) !== exportDirectory || path !== `${exportPath}.receipt.json` || !RECEIPT_FILE_PATTERN.test(basename(path))) {
    throw new Error("invalid receipt path");
  }
}

function assertPrivateFile(path, maximumBytes) {
  const first = lstatSync(path);
  const uid = currentUid();
  if (
    !first.isFile()
    || first.isSymbolicLink()
    || first.nlink !== 1
    || (first.mode & 0o777) !== PRIVATE_FILE_MODE
    || first.size < 0
    || first.size > maximumBytes
    || (uid !== null && first.uid !== uid)
  ) throw new Error("invalid artifact");
  const bytes = readFileSync(path);
  const second = lstatSync(path);
  if (!sameFile(first, second) || bytes.length !== second.size) throw new Error("invalid artifact");
  return bytes;
}

function parseReceipt(bytes, exportPath, exportBytes) {
  let receipt;
  try {
    receipt = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("invalid receipt");
  }
  if (!isRecord(receipt)) throw new Error("invalid receipt");
  const keys = Object.keys(receipt).sort();
  const expectedKeys = ["byteLength", "exportFile", "schemaVersion", "sha256", "sourceSessionSha256"];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) throw new Error("invalid receipt");
  if (
    receipt.schemaVersion !== 1
    || receipt.exportFile !== basename(exportPath)
    || typeof receipt.sourceSessionSha256 !== "string"
    || !SHA256_PATTERN.test(receipt.sourceSessionSha256)
    || !Number.isSafeInteger(receipt.byteLength)
    || receipt.byteLength !== exportBytes.length
    || typeof receipt.sha256 !== "string"
    || receipt.sha256 !== sha256(exportBytes)
  ) throw new Error("invalid receipt");
}

function assertExportFingerprint(exportBytes, receiptBytes) {
  if (exportBytes.length === 0) return;
  const lines = exportBytes.toString("utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) throw new Error("invalid export");
  let sourceSessionSha256;
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      throw new Error("invalid export");
    }
    if (!isRecord(entry) || !isRecord(entry.metadata) || typeof entry.metadata.sourceSessionSha256 !== "string") {
      throw new Error("invalid export");
    }
    if (sourceSessionSha256 === undefined) sourceSessionSha256 = entry.metadata.sourceSessionSha256;
    if (entry.metadata.sourceSessionSha256 !== sourceSessionSha256) throw new Error("invalid export");
  }
  let receipt;
  try {
    receipt = JSON.parse(receiptBytes.toString("utf8"));
  } catch {
    throw new Error("invalid receipt");
  }
  if (!isRecord(receipt) || receipt.sourceSessionSha256 !== sourceSessionSha256) throw new Error("invalid receipt");
}

/**
 * Validate the owned JSONL and its atomically-published receipt twice. The
 * second complete read/stat/hash immediately precedes the upstream forward.
 */
function validateUploadArtifact(filePath, suppliedReceiptPath, exportDirectory) {
  try {
    assertPrivateDirectory(dirname(exportDirectory));
    assertPrivateDirectory(exportDirectory);
    assertExportPath(filePath, exportDirectory);
    const receiptPath = suppliedReceiptPath === undefined ? `${filePath}.receipt.json` : suppliedReceiptPath;
    assertReceiptPath(receiptPath, filePath, exportDirectory);

    for (let pass = 0; pass < 2; pass += 1) {
      const exportBytes = assertPrivateFile(filePath, MAX_EXPORT_BYTES);
      const receiptBytes = assertPrivateFile(receiptPath, 4 * 1024);
      parseReceipt(receiptBytes, filePath, exportBytes);
      assertExportFingerprint(exportBytes, receiptBytes);
    }
    return true;
  } catch {
    return false;
  }
}

function publicTool(tool) {
  if (!isRecord(tool) || typeof tool.name !== "string" || !ALLOWED_TOOLS.has(tool.name)) return null;
  const result = { ...tool };
  if (isRecord(tool.inputSchema)) {
    const schema = { ...tool.inputSchema };
    if (isRecord(tool.inputSchema.properties)) {
      const properties = { ...tool.inputSchema.properties };
      delete properties.session;
      schema.properties = properties;
    }
    if (Array.isArray(tool.inputSchema.required)) schema.required = tool.inputSchema.required.filter((entry) => entry !== "session");
    result.inputSchema = schema;
  }
  return result;
}

function filteredToolsResponse(message) {
  if (!isRecord(message.result) || !Array.isArray(message.result.tools)) return message;
  const tools = message.result.tools.map(publicTool).filter((tool) => tool !== null);
  return { ...message, result: { tools } };
}

function filteredInitializeResponse(message) {
  if (!isRecord(message.result)) return message;
  const capabilities = isRecord(message.result.capabilities) && isRecord(message.result.capabilities.tools)
    ? { tools: message.result.capabilities.tools }
    : { tools: {} };
  return { ...message, result: { ...message.result, capabilities } };
}

function filteredUploadResponse(message) {
  if (isRecord(message.error)) {
    return {
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32000, message: "Thread bridge upload failed." },
    };
  }
  const failed = isRecord(message.result) && message.result.isError === true;
  return {
    ...message,
    result: {
      content: [{ type: "text", text: JSON.stringify({ accepted: !failed }) }],
      ...(failed ? { isError: true } : {}),
    },
  };
}

function rewriteToolCall(message, exportDirectory) {
  if (!isRecord(message.params) || typeof message.params.name !== "string" || !ALLOWED_TOOLS.has(message.params.name)) return null;
  const rawArguments = message.params.arguments === undefined ? {} : message.params.arguments;
  if (!isRecord(rawArguments)) return null;

  const arguments_ = Object.create(null);
  for (const [key, value] of Object.entries(rawArguments)) {
    if (key === "session" || key === "receipt_path") continue;
    arguments_[key] = value;
  }
  if (message.params.name === "thread_upload_file") {
    if (typeof rawArguments.file_path !== "string") return null;
    if (rawArguments.receipt_path !== undefined && typeof rawArguments.receipt_path !== "string") return null;
    if (!validateUploadArtifact(rawArguments.file_path, rawArguments.receipt_path, exportDirectory)) return null;
  }
  arguments_.session = THREAD_BRIDGE_SESSION;
  return {
    ...message,
    params: {
      ...message.params,
      arguments: arguments_,
    },
  };
}

function encode(message) {
  return `${JSON.stringify(message)}\n`;
}

/**
 * Run a transparent MCP stdio relay whose only public Thread surface is upload,
 * search, and read against the fixed Ingenium Thread session. Options are an
 * import-only seam for the child-runtime fixture; the production launcher passes
 * the pinned Python bridge explicitly and never reads a caller-controlled env.
 */
export function runThreadBridge({ command, args, cwd, env, exportDirectory = THREAD_BRIDGE_EXPORT_DIRECTORY }) {
  const upstream = spawn(command, args, {
    cwd,
    env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pendingToolsLists = new Set();
  const pendingInitializations = new Set();
  const pendingUploads = new Set();
  let inputBuffer = Buffer.alloc(0);
  let upstreamBuffer = Buffer.alloc(0);
  let stopped = false;

  const respond = (id, code, message) => {
    if (id === null) return;
    try {
      process.stdout.write(encode({ jsonrpc: "2.0", id, error: { code, message } }));
    } catch {
      stopped = true;
    }
  };
  const forward = (message) => {
    if (stopped || !upstream.stdin || upstream.stdin.destroyed) return false;
    try {
      upstream.stdin.write(encode(message));
      return true;
    } catch {
      return false;
    }
  };
  const handleClientMessage = (message) => {
    if (!isRecord(message) || typeof message.method !== "string") return;
    const id = safeRequestId(message);
    if (message.method === "initialize") {
      if (id === null) return;
      pendingInitializations.add(requestKey(id));
      if (!forward(message)) {
        pendingInitializations.delete(requestKey(id));
        respond(id, -32000, "Thread bridge unavailable.");
      }
      return;
    }
    if (message.method === "tools/list") {
      if (isRecord(message.params) && Object.hasOwn(message.params, "cursor")) {
        respond(id, -32602, "Thread bridge request rejected.");
        return;
      }
      if (id === null) return;
      pendingToolsLists.add(requestKey(id));
      if (!forward(message)) {
        pendingToolsLists.delete(requestKey(id));
        respond(id, -32000, "Thread bridge unavailable.");
      }
      return;
    }
    if (message.method === "tools/call") {
      if (id === null) return;
      const rewritten = rewriteToolCall(message, exportDirectory);
      if (!rewritten) {
        respond(id, -32602, "Thread bridge request rejected.");
        return;
      }
      if (message.params.name === "thread_upload_file") pendingUploads.add(requestKey(id));
      if (!forward(rewritten)) {
        pendingUploads.delete(requestKey(id));
        respond(id, -32000, "Thread bridge unavailable.");
      }
      return;
    }
    if (!RELAY_METHODS.has(message.method)) {
      respond(id, -32601, "Thread bridge request rejected.");
      return;
    }
    if (!forward(message)) respond(id, -32000, "Thread bridge unavailable.");
  };
  const handleUpstreamMessage = (message) => {
    if (!isRecord(message)) return;
    const id = safeRequestId(message);
    const key = id === null ? null : requestKey(id);
    const output = key !== null && pendingUploads.delete(key)
      ? filteredUploadResponse(message)
      : key !== null && pendingInitializations.delete(key)
        ? filteredInitializeResponse(message)
        : key !== null && pendingToolsLists.delete(key)
          ? filteredToolsResponse(message)
          : message;
    try {
      process.stdout.write(encode(output));
    } catch {
      stopped = true;
    }
  };
  const processLines = (chunk, state, handle) => {
    state.buffer = Buffer.concat([state.buffer, chunk]);
    if (state.buffer.length > MAX_STDIO_MESSAGE_BYTES) {
      stopped = true;
      upstream.kill("SIGTERM");
      return;
    }
    while (true) {
      const newline = state.buffer.indexOf("\n");
      if (newline === -1) return;
      const line = state.buffer.toString("utf8", 0, newline).replace(/\r$/, "");
      state.buffer = state.buffer.subarray(newline + 1);
      if (line.length === 0) continue;
      try {
        handle(JSON.parse(line));
      } catch {
        // Protocol failures deliberately reveal no request payload.
      }
    }
  };

  process.stdin.on("data", (chunk) => {
    const state = { buffer: inputBuffer };
    processLines(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), state, handleClientMessage);
    inputBuffer = state.buffer;
  });
  upstream.stdout?.on("data", (chunk) => {
    const state = { buffer: upstreamBuffer };
    processLines(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), state, handleUpstreamMessage);
    upstreamBuffer = state.buffer;
  });
  upstream.stdin?.on("error", () => { stopped = true; });
  upstream.stdout?.on("error", () => { stopped = true; });
  // Upstream diagnostics can contain request data. Drain rather than forward or log them.
  upstream.stderr?.resume();
  upstream.once("error", () => {
    if (!stopped) process.stderr.write("Thread bridge unavailable\n");
  });
  upstream.once("close", (code) => {
    stopped = true;
    process.exit(code ?? 1);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      stopped = true;
      try {
        upstream.kill(signal);
      } catch {
        // The parent child-runtime manager owns bounded process-group reaping.
      }
    });
  }
  return upstream;
}
