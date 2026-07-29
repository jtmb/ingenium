import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const THREAD_BRIDGE_SESSION = "ingenium";
export const THREAD_BRIDGE_EXPORT_DIRECTORY = "/workspace/ingenium/.ingenium/thread-exports";
export const THREAD_GUARD_URL = "http://thread-guard:8081/v1/call";

const MAX_STDIO_MESSAGE_BYTES = 1_048_576;
const MAX_GUARD_RESPONSE_BYTES = 1_048_576;
const MAX_EXPORT_BYTES = 16 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 4 * 1024;
const MAX_GUARD_REQUEST_BYTES = 24 * 1024 * 1024;
const GUARD_REQUEST_TIMEOUT_MS = 30_000;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const EXPORT_FILE_PATTERN = /^thread-export-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;
const RECEIPT_FILE_PATTERN = /^thread-export-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl\.receipt\.json$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RELAY_METHODS = new Set(["notifications/initialized", "notifications/cancelled", "notifications/progress"]);

const PUBLIC_TOOLS = [
  {
    name: "thread_upload_file",
    description: "Upload one receipt-verified Thread export to the fixed Ingenium session.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Private Thread export file path." },
        receipt_path: { type: "string", description: "Matching private Thread export receipt path." },
        tags: { type: "string", description: "Optional comma-separated tags." },
        priority: { type: "integer", minimum: 0, maximum: 10 },
      },
      required: ["file_path"],
    },
  },
  {
    name: "thread_search",
    description: "Search the fixed Ingenium Thread session.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        use_cache: { type: "boolean" },
      },
      required: ["query"],
    },
  },
  {
    name: "thread_read_entries",
    description: "Read entries from the fixed Ingenium Thread session.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 200 },
        after: { type: "integer", minimum: 0 },
        sort: { type: "string", enum: ["asc", "desc"] },
      },
    },
  },
  {
    name: "thread_read_entries_batch",
    description: "Read selected entries from the fixed Ingenium Thread session.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "integer", minimum: 1 }, maxItems: 100 },
      },
      required: ["ids"],
    },
  },
  {
    name: "thread_get_tags",
    description: "Get tags from the fixed Ingenium Thread session.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "thread_get_stats",
    description: "Get bounded Thread service statistics.",
    inputSchema: { type: "object", properties: {} },
  },
];

const PUBLIC_TOOL_NAMES = new Set(PUBLIC_TOOLS.map((tool) => tool.name));

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeRequestId(message) {
  if (!Object.hasOwn(message, "id")) return null;
  const { id } = message;
  return typeof id === "string" || typeof id === "number" || id === null ? id : null;
}

function encode(message) {
  return `${JSON.stringify(message)}\n`;
}

function assertCanonicalDirectory(path) {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path || hasControlCharacters(path)) {
    throw new Error("invalid directory");
  }
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
    || relativePath === ".."
    || isAbsolute(relativePath)
    || relativePath.startsWith(`..${sep}`)
  ) throw new Error("invalid export path");
  const segments = relativePath.split(sep);
  if (segments.length !== 1 || !EXPORT_FILE_PATTERN.test(segments[0])) throw new Error("invalid export path");
}

function assertReceiptPath(path, exportPath, exportDirectory) {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path || hasControlCharacters(path)) {
    throw new Error("invalid receipt path");
  }
  if (dirname(path) !== exportDirectory || path !== `${exportPath}.receipt.json` || !RECEIPT_FILE_PATTERN.test(basename(path))) {
    throw new Error("invalid receipt path");
  }
}

function assertPrivateFileDescriptor(entry, maximumBytes) {
  const uid = currentUid();
  if (
    !entry.isFile()
    || entry.nlink !== 1
    || (entry.mode & 0o777) !== PRIVATE_FILE_MODE
    || entry.size < 0
    || entry.size > maximumBytes
    || (uid !== null && entry.uid !== uid)
  ) throw new Error("invalid artifact");
}

function readDescriptorBytes(descriptor, size) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const read = readSync(descriptor, bytes, offset, size - offset, offset);
    if (read <= 0) throw new Error("invalid artifact");
    offset += read;
  }
  return bytes;
}

/**
 * Read only through an already-open O_NOFOLLOW descriptor. The optional hook is
 * test-only: it proves that replacing the pathname after open cannot change the
 * bytes sent to thread-guard.
 */
function readPrivateArtifact(path, maximumBytes, afterOpen) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const entry = fstatSync(descriptor);
    assertPrivateFileDescriptor(entry, maximumBytes);
    afterOpen?.();
    const bytes = readDescriptorBytes(descriptor, entry.size);
    if (fstatSync(descriptor).size !== entry.size) throw new Error("invalid artifact");
    return bytes;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function parseReceipt(receiptBytes, exportPath, exportBytes) {
  let receipt;
  try {
    receipt = JSON.parse(receiptBytes.toString("utf8"));
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
  return receipt;
}

function assertExportFingerprint(exportBytes, receipt) {
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
  if (receipt.sourceSessionSha256 !== sourceSessionSha256) throw new Error("invalid receipt");
}

/**
 * Verify receipt semantics and return immutable bytes from descriptors, never a
 * caller path. Callers can retain their receipt for the existing explicit
 * cleanup flow after an accepted upload.
 */
export function readThreadUploadArtifact({ filePath, receiptPath, exportDirectory = THREAD_BRIDGE_EXPORT_DIRECTORY, onFileOpened }) {
  assertPrivateDirectory(dirname(exportDirectory));
  assertPrivateDirectory(exportDirectory);
  assertExportPath(filePath, exportDirectory);
  const resolvedReceiptPath = receiptPath === undefined ? `${filePath}.receipt.json` : receiptPath;
  assertReceiptPath(resolvedReceiptPath, filePath, exportDirectory);
  const exportBytes = readPrivateArtifact(filePath, MAX_EXPORT_BYTES, onFileOpened);
  const receiptBytes = readPrivateArtifact(resolvedReceiptPath, MAX_RECEIPT_BYTES);
  const receipt = parseReceipt(receiptBytes, filePath, exportBytes);
  assertExportFingerprint(exportBytes, receipt);
  return { bytes: exportBytes, filename: basename(filePath) };
}

function optionalTags(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 1_024 || hasControlCharacters(value)) throw new Error("invalid arguments");
  return value;
}

function optionalPriority(value) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0 || value > 10) throw new Error("invalid arguments");
  return value;
}

function assertArgumentKeys(arguments_, allowed) {
  for (const key of Object.keys(arguments_)) {
    if (key !== "session" && !allowed.has(key)) throw new Error("invalid arguments");
  }
}

function normalizeArguments(toolName, arguments_, exportDirectory) {
  if (!isRecord(arguments_) || Object.keys(arguments_).some((key) => key === "__proto__" || key === "constructor" || key === "prototype")) {
    throw new Error("invalid arguments");
  }
  if (toolName === "thread_upload_file") {
    assertArgumentKeys(arguments_, new Set(["file_path", "receipt_path", "tags", "priority"]));
    if (typeof arguments_.file_path !== "string" || (arguments_.receipt_path !== undefined && typeof arguments_.receipt_path !== "string")) {
      throw new Error("invalid arguments");
    }
    const artifact = readThreadUploadArtifact({
      filePath: arguments_.file_path,
      receiptPath: arguments_.receipt_path,
      exportDirectory,
    });
    const result = { filename: artifact.filename, contentBase64: artifact.bytes.toString("base64") };
    const tags = optionalTags(arguments_.tags);
    const priority = optionalPriority(arguments_.priority);
    if (tags !== undefined) result.tags = tags;
    if (priority !== undefined) result.priority = priority;
    return { operation: "upload", arguments: result };
  }

  const output = Object.create(null);
  if (toolName === "thread_search") {
    assertArgumentKeys(arguments_, new Set(["query", "limit", "use_cache"]));
    if (typeof arguments_.query !== "string" || arguments_.query.length === 0 || arguments_.query.length > 4_096 || hasControlCharacters(arguments_.query)) {
      throw new Error("invalid arguments");
    }
    output.query = arguments_.query;
    if (arguments_.limit !== undefined) {
      if (!Number.isSafeInteger(arguments_.limit) || arguments_.limit < 1 || arguments_.limit > 100) throw new Error("invalid arguments");
      output.limit = arguments_.limit;
    }
    if (arguments_.use_cache !== undefined) {
      if (typeof arguments_.use_cache !== "boolean") throw new Error("invalid arguments");
      output.use_cache = arguments_.use_cache;
    }
    return { operation: "search", arguments: output };
  }
  if (toolName === "thread_read_entries") {
    assertArgumentKeys(arguments_, new Set(["limit", "after", "sort"]));
    if (arguments_.limit !== undefined) {
      if (!Number.isSafeInteger(arguments_.limit) || arguments_.limit < 1 || arguments_.limit > 200) throw new Error("invalid arguments");
      output.limit = arguments_.limit;
    }
    if (arguments_.after !== undefined) {
      if (!Number.isSafeInteger(arguments_.after) || arguments_.after < 0) throw new Error("invalid arguments");
      output.after = arguments_.after;
    }
    if (arguments_.sort !== undefined) {
      if (arguments_.sort !== "asc" && arguments_.sort !== "desc") throw new Error("invalid arguments");
      output.sort = arguments_.sort;
    }
    return { operation: "read", arguments: output };
  }
  if (toolName === "thread_read_entries_batch") {
    assertArgumentKeys(arguments_, new Set(["ids"]));
    if (!Array.isArray(arguments_.ids) || arguments_.ids.length === 0 || arguments_.ids.length > 100 || !arguments_.ids.every((id) => Number.isSafeInteger(id) && id > 0)) {
      throw new Error("invalid arguments");
    }
    return { operation: "batch", arguments: { ids: [...arguments_.ids] } };
  }
  if (toolName === "thread_get_tags") {
    assertArgumentKeys(arguments_, new Set());
    return { operation: "tags", arguments: output };
  }
  if (toolName === "thread_get_stats") {
    assertArgumentKeys(arguments_, new Set());
    return { operation: "stats", arguments: output };
  }
  throw new Error("invalid arguments");
}

async function readBoundedResponse(response) {
  const headerLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(headerLength) && headerLength > MAX_GUARD_RESPONSE_BYTES) throw new Error("guard unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("guard unavailable");
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_GUARD_RESPONSE_BYTES) throw new Error("guard unavailable");
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function callGuard(guardUrl, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  if (body.length > MAX_GUARD_REQUEST_BYTES) throw new Error("guard request too large");
  let response;
  try {
    response = await fetch(guardUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(GUARD_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("guard connection failed");
  }
  if (!response.ok) throw new Error(`guard rejected request (${response.status})`);
  let decoded;
  try {
    decoded = await readBoundedResponse(response);
  } catch {
    throw new Error("guard response invalid");
  }
  if (!isRecord(decoded) || decoded.ok !== true || !Object.hasOwn(decoded, "result")) throw new Error("guard response invalid");
  return decoded.result;
}

function safeResult(toolName, result) {
  if (toolName !== "thread_upload_file") return result;
  const failed = isRecord(result) && result.isError === true;
  return {
    content: [{ type: "text", text: JSON.stringify({ accepted: !failed }) }],
    ...(failed ? { isError: true } : {}),
  };
}

/** Run the safe local stdio MCP boundary. No caller path crosses the network. */
export function runThreadBridge({ guardUrl = THREAD_GUARD_URL, exportDirectory = THREAD_BRIDGE_EXPORT_DIRECTORY } = {}) {
  let inputBuffer = Buffer.alloc(0);
  let stopped = false;

  const respond = (id, error, result) => {
    if (id === null || stopped) return;
    try {
      process.stdout.write(encode(error
        ? { jsonrpc: "2.0", id, error }
        : { jsonrpc: "2.0", id, result }));
    } catch {
      stopped = true;
    }
  };

  const handle = async (message) => {
    if (!isRecord(message) || typeof message.method !== "string") return;
    const id = safeRequestId(message);
    if (message.method === "initialize") {
      respond(id, null, {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "ingenium-thread-guard", version: "1.0.0" },
        capabilities: { tools: {} },
      });
      return;
    }
    if (message.method === "ping") {
      respond(id, null, {});
      return;
    }
    if (message.method === "tools/list") {
      if (id === null || (isRecord(message.params) && Object.hasOwn(message.params, "cursor"))) {
        respond(id, { code: -32602, message: "Thread bridge request rejected." });
        return;
      }
      respond(id, null, { tools: PUBLIC_TOOLS });
      return;
    }
    if (message.method === "tools/call") {
      if (id === null || !isRecord(message.params) || typeof message.params.name !== "string" || !PUBLIC_TOOL_NAMES.has(message.params.name)) {
        respond(id, { code: -32602, message: "Thread bridge request rejected." });
        return;
      }
      try {
        const payload = normalizeArguments(message.params.name, message.params.arguments ?? {}, exportDirectory);
        const result = await callGuard(guardUrl, payload);
        respond(id, null, safeResult(message.params.name, result));
      } catch {
        respond(id, { code: -32000, message: "Thread bridge request rejected." });
      }
      return;
    }
    if (!RELAY_METHODS.has(message.method)) respond(id, { code: -32601, message: "Thread bridge request rejected." });
  };

  process.stdin.on("data", (chunk) => {
    if (stopped) return;
    inputBuffer = Buffer.concat([inputBuffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    if (inputBuffer.length > MAX_STDIO_MESSAGE_BYTES) {
      stopped = true;
      return;
    }
    while (true) {
      const newline = inputBuffer.indexOf("\n");
      if (newline === -1) return;
      const line = inputBuffer.toString("utf8", 0, newline).replace(/\r$/, "");
      inputBuffer = inputBuffer.subarray(newline + 1);
      if (line.length === 0) continue;
      try {
        void handle(JSON.parse(line));
      } catch {
        // Never reflect malformed request bytes or paths.
      }
    }
  });
}
