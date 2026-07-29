import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export const THREAD_EXPORT_SCHEMA_VERSION = 1;
export const THREAD_EXPORT_RECEIPT_SCHEMA_VERSION = 1;
export const THREAD_EXPORT_DIRECTORY = ".ingenium/thread-exports";
export const THREAD_EXPORT_DEFAULT_TIMEOUT_MS = 30_000;
export const THREAD_EXPORT_MAX_TIMEOUT_MS = 60_000;
// OpenCode export envelopes can include large ignored reasoning/tool parts. The
// bounded raw envelope limit accommodates those parts while the independently
// bounded 16 MiB JSONL limit remains the maximum uploadable visible text.
export const THREAD_EXPORT_MAX_SOURCE_BYTES = 64 * 1024 * 1024;
export const THREAD_EXPORT_MAX_JSONL_BYTES = 16 * 1024 * 1024;
export const THREAD_EXPORT_MAX_MESSAGES = 10_000;

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const EXPORT_FILE_PATTERN = /^thread-export-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;
const RECEIPT_FILE_PATTERN = /^thread-export-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl\.receipt\.json$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type ThreadExportFailure =
  | "invalid_input"
  | "worktree_invalid"
  | "command_failed"
  | "timeout"
  | "output_too_large"
  | "malformed_export"
  | "bounds"
  | "write_failed"
  | "cleanup_denied";

/** Content-free error categories suitable for an interactive export command. */
export class ThreadExportError extends Error {
  constructor(readonly failure: ThreadExportFailure) {
    super("Unable to export OpenCode session for Thread");
    this.name = "ThreadExportError";
  }
}

export interface ThreadJsonlEntry {
  role: "user" | "assistant";
  content: string;
  metadata: {
    source: "opencode-export";
    schemaVersion: typeof THREAD_EXPORT_SCHEMA_VERSION;
    sourceSessionSha256: string;
    sourceMessageSha256: string;
    sourceMessageIndex: number;
    visiblePartCount: number;
  };
}

export interface ThreadExportReceipt {
  path: string;
  receiptPath: string;
  sha256: string;
  byteLength: number;
  messageCount: number;
  metadata: {
    source: "opencode-export";
    schemaVersion: typeof THREAD_EXPORT_SCHEMA_VERSION;
    sourceSessionSha256: string;
  };
}

export interface OpenCodeExportCommandOptions {
  timeoutMs: number;
  maxOutputBytes: number;
  shell: false;
}

/** Injectable only to make filesystem-free conversion tests deterministic. */
export type OpenCodeExportRunner = (
  sessionId: string,
  worktree: string,
  options: OpenCodeExportCommandOptions,
) => Promise<string>;

export interface ThreadExportOptions {
  sessionId: string;
  worktree: string;
  timeoutMs?: number;
  maxSourceBytes?: number;
  maxJsonlBytes?: number;
  maxMessages?: number;
  runner?: OpenCodeExportRunner;
}

export interface ThreadExportCleanupOptions {
  worktree: string;
  receipt: Pick<ThreadExportReceipt, "path" | "receiptPath" | "sha256">;
  /** This must be true only after the separate Thread upload has succeeded. */
  uploadSucceeded: boolean;
}

interface ThreadExportLimits {
  timeoutMs: number;
  maxSourceBytes: number;
  maxJsonlBytes: number;
  maxMessages: number;
}

interface OpenCodeExportMessage {
  info: Record<string, unknown>;
  parts: unknown[];
}

interface ThreadExportReceiptDocument {
  schemaVersion: typeof THREAD_EXPORT_RECEIPT_SCHEMA_VERSION;
  exportFile: string;
  sourceSessionSha256: string;
  byteLength: number;
  sha256: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function fail(failure: ThreadExportFailure): never {
  throw new ThreadExportError(failure);
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail("invalid_input");
  return value;
}

function limitsFor(options: ThreadExportOptions): ThreadExportLimits {
  return {
    timeoutMs: boundedInteger(options.timeoutMs, THREAD_EXPORT_DEFAULT_TIMEOUT_MS, THREAD_EXPORT_MAX_TIMEOUT_MS),
    maxSourceBytes: boundedInteger(options.maxSourceBytes, THREAD_EXPORT_MAX_SOURCE_BYTES, THREAD_EXPORT_MAX_SOURCE_BYTES),
    maxJsonlBytes: boundedInteger(options.maxJsonlBytes, THREAD_EXPORT_MAX_JSONL_BYTES, THREAD_EXPORT_MAX_JSONL_BYTES),
    maxMessages: boundedInteger(options.maxMessages, THREAD_EXPORT_MAX_MESSAGES, THREAD_EXPORT_MAX_MESSAGES),
  };
}

/** Session identifiers are command arguments, never shell fragments or paths. */
export function assertSafeOpenCodeSessionId(value: unknown): string {
  if (typeof value !== "string" || !SESSION_ID_PATTERN.test(value)) fail("invalid_input");
  return value;
}

/** Require an existing absolute real path with no syntactic or symlink indirection. */
export function resolveCanonicalWorktree(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value) || resolve(value) !== value) fail("worktree_invalid");
  let canonical: string;
  try {
    canonical = realpathSync(value);
    if (canonical !== value || !statSync(canonical).isDirectory()) fail("worktree_invalid");
    // A normal checkout has a .git directory; a linked worktree has a .git file.
    // Requiring one prevents exporting arbitrary filesystem directories.
    const git = lstatSync(join(canonical, ".git"));
    if (git.isSymbolicLink() || (!git.isDirectory() && !git.isFile())) fail("worktree_invalid");
  } catch (error) {
    if (error instanceof ThreadExportError) throw error;
    fail("worktree_invalid");
  }
  return canonical;
}

function processUid(): number | null {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function assertOwnedDirectory(path: string): void {
  try {
    const entry = lstatSync(path);
    if (
      !entry.isDirectory()
      || entry.isSymbolicLink()
      || (entry.mode & 0o777) !== 0o700
      || (processUid() !== null && entry.uid !== processUid())
    ) fail("write_failed");
  } catch (error) {
    if (error instanceof ThreadExportError) throw error;
    fail("write_failed");
  }
}

function assertOwnedPrivateFile(path: string, failure: "write_failed" | "cleanup_denied") {
  const entry = lstatSync(path);
  if (
    !entry.isFile()
    || entry.isSymbolicLink()
    || entry.nlink !== 1
    || (entry.mode & 0o777) !== 0o600
    || (processUid() !== null && entry.uid !== processUid())
  ) fail(failure);
  return entry;
}

function exportDirectory(worktree: string): string {
  const stateDirectory = join(worktree, ".ingenium");
  try {
    mkdirSync(stateDirectory, { mode: 0o700 });
  } catch (error) {
    if (!(error as NodeJS.ErrnoException).code || (error as NodeJS.ErrnoException).code !== "EEXIST") fail("write_failed");
  }
  try {
    chmodSync(stateDirectory, 0o700);
  } catch {
    fail("write_failed");
  }
  assertOwnedDirectory(stateDirectory);

  const directory = join(worktree, THREAD_EXPORT_DIRECTORY);
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (!(error as NodeJS.ErrnoException).code || (error as NodeJS.ErrnoException).code !== "EEXIST") fail("write_failed");
  }
  assertOwnedDirectory(directory);
  try {
    chmodSync(directory, 0o700);
  } catch {
    fail("write_failed");
  }
  return directory;
}

function isCompletedAssistant(info: Record<string, unknown>): boolean {
  const time = asRecord(info.time);
  return typeof time?.completed === "number" && Number.isFinite(time.completed) && info.error === undefined;
}

function visibleTextParts(parts: unknown[]): string[] {
  const result: string[] = [];
  for (const candidate of parts) {
    const part = asRecord(candidate);
    if (!part || part.type !== "text" || part.synthetic === true || part.ignored === true) continue;
    if (typeof part.text !== "string" || part.text.trim().length === 0) continue;
    result.push(part.text);
  }
  return result;
}

/**
 * Convert only the chronological, visible user/assistant text from an OpenCode
 * `export` envelope. No tool payload, reasoning, file content, or source IDs
 * are emitted to the Thread upload artifact.
 */
export function convertOpenCodeExport(
  sessionId: string,
  value: unknown,
  limits: Pick<ThreadExportLimits, "maxMessages"> = { maxMessages: THREAD_EXPORT_MAX_MESSAGES },
): ThreadJsonlEntry[] {
  const envelope = asRecord(value);
  const exportInfo = envelope && asRecord(envelope.info);
  const messages = envelope?.messages;
  if (!exportInfo || !Array.isArray(messages)) fail("malformed_export");
  if (typeof exportInfo.id === "string" && exportInfo.id !== sessionId) fail("malformed_export");
  if (messages.length > limits.maxMessages) fail("bounds");

  const entries: ThreadJsonlEntry[] = [];
  const seenMessageIds = new Set<string>();
  const sourceSessionSha256 = sha256(sessionId);

  for (let index = 0; index < messages.length; index += 1) {
    const message = asRecord(messages[index]) as OpenCodeExportMessage | null;
    const info = message && asRecord(message.info);
    if (!info) fail("malformed_export");
    const role = info.role;
    if (role !== "user" && role !== "assistant") continue;
    if (info.synthetic === true || info.ignored === true) continue;
    if (role === "assistant" && !isCompletedAssistant(info)) continue;
    if (!Array.isArray(message.parts)) fail("malformed_export");

    const messageId = typeof info.id === "string" ? info.id : "";
    if (messageId) {
      if (seenMessageIds.has(messageId)) fail("malformed_export");
      seenMessageIds.add(messageId);
    }
    const parts = visibleTextParts(message.parts);
    if (parts.length === 0) continue;
    if (entries.length >= limits.maxMessages) fail("bounds");
    const sourceIdentity = messageId || `ordinal:${index}`;
    entries.push({
      role,
      content: parts.join("\n\n"),
      metadata: {
        source: "opencode-export",
        schemaVersion: THREAD_EXPORT_SCHEMA_VERSION,
        sourceSessionSha256,
        sourceMessageSha256: sha256(sourceIdentity),
        sourceMessageIndex: index,
        visiblePartCount: parts.length,
      },
    });
  }
  return entries;
}

function serializeEntries(entries: ThreadJsonlEntry[], maxBytes: number): Buffer {
  const lines: string[] = [];
  let bytes = 0;
  for (const entry of entries) {
    const line = `${JSON.stringify(entry)}\n`;
    bytes += Buffer.byteLength(line, "utf8");
    if (bytes > maxBytes) fail("bounds");
    lines.push(line);
  }
  return Buffer.from(lines.join(""), "utf8");
}

function writeReceipt(path: string, contents: ThreadExportReceiptDocument): string {
  const receiptPath = `${path}.receipt.json`;
  const temporaryPath = `${receiptPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(contents), { encoding: "utf8", mode: 0o600, flag: "wx" });
    chmodSync(temporaryPath, 0o600);
    assertOwnedPrivateFile(temporaryPath, "write_failed");
    // link(2) publishes the complete receipt without replacing an existing
    // path. The generated export UUID makes any EEXIST a hard failure.
    linkSync(temporaryPath, receiptPath);
    unlinkSync(temporaryPath);
    assertOwnedPrivateFile(receiptPath, "write_failed");
    return receiptPath;
  } catch (error) {
    try {
      const temporary = lstatSync(temporaryPath);
      if (temporary.isFile() && !temporary.isSymbolicLink() && temporary.nlink === 1 && (temporary.mode & 0o777) === 0o600) {
        unlinkSync(temporaryPath);
      }
    } catch {
      // Best-effort deletion of a failed, generated temporary artifact.
    }
    if (error instanceof ThreadExportError) throw error;
    fail("write_failed");
  }
}

interface SourceCapture {
  directory: string;
  path: string;
  descriptor: number;
}

/**
 * Capture CLI output in a private regular file instead of a pipe. OpenCode can
 * terminate immediately after a large stdout write; a pipe can then lose its
 * unwritten tail despite a zero exit status. A regular descriptor makes that
 * write blocking while keeping the transient source envelope private.
 */
function createSourceCapture(): SourceCapture {
  let directory: string | undefined;
  let descriptor: number | undefined;
  try {
    directory = mkdtempSync(join(tmpdir(), "ingenium-thread-export-"));
    chmodSync(directory, 0o700);
    assertOwnedDirectory(directory);
    const path = join(directory, "opencode-export.json");
    descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    chmodSync(path, 0o600);
    assertOwnedPrivateFile(path, "write_failed");
    return { directory, path, descriptor };
  } catch {
    try {
      if (descriptor !== undefined) closeSync(descriptor);
    } catch {
      // Best-effort cleanup of a private capture descriptor.
    }
    try {
      if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup of a private capture directory.
    }
    fail("write_failed");
  }
}

/** Run the local CLI with an argument vector; neither a shell nor API is involved. */
export const runOpenCodeExport: OpenCodeExportRunner = async (sessionId, worktree, options) => await new Promise<string>((resolveOutput, rejectOutput) => {
  let settled = false;
  let timeout: NodeJS.Timeout | undefined;
  const capture = createSourceCapture();
  let captureDescriptor: number | undefined = capture.descriptor;
  const cleanupCapture = () => {
    try {
      if (captureDescriptor !== undefined) closeSync(captureDescriptor);
    } catch {
      // The descriptor can be closed after spawn before a timeout races it.
    }
    captureDescriptor = undefined;
    try {
      rmSync(capture.directory, { recursive: true, force: true });
    } catch {
      // Do not surface private temporary paths from best-effort cleanup.
    }
  };
  const settle = (callback: () => void) => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    cleanupCapture();
    callback();
  };
  let child: ReturnType<typeof spawn>;
  const terminate = () => {
    try {
      child.kill("SIGKILL");
    } catch {
      // The child may have exited between a bound check and termination.
    }
  };
  try {
    child = spawn("opencode", ["export", sessionId], {
      cwd: worktree,
      shell: options.shell,
      windowsHide: true,
      stdio: ["ignore", capture.descriptor, "pipe"],
    });
    closeSync(capture.descriptor);
    captureDescriptor = undefined;
  } catch {
    settle(() => rejectOutput(new ThreadExportError("command_failed")));
    return;
  }
  timeout = setTimeout(() => {
    terminate();
    settle(() => rejectOutput(new ThreadExportError("timeout")));
  }, options.timeoutMs);

  // Export diagnostics are never surfaced because they can include transcript
  // or filesystem data. Draining avoids blocking a noisy subprocess.
  child.stderr?.resume();
  child.once("error", () => settle(() => rejectOutput(new ThreadExportError("command_failed"))));
  child.once("close", (code) => {
    if (code !== 0) {
      settle(() => rejectOutput(new ThreadExportError("command_failed")));
      return;
    }
    let output: Buffer;
    try {
      const entry = assertOwnedPrivateFile(capture.path, "write_failed");
      if (entry.size > options.maxOutputBytes) {
        settle(() => rejectOutput(new ThreadExportError("output_too_large")));
        return;
      }
      output = readFileSync(capture.path);
      const afterRead = assertOwnedPrivateFile(capture.path, "write_failed");
      if (entry.dev !== afterRead.dev || entry.ino !== afterRead.ino || entry.size !== afterRead.size || output.length !== entry.size) {
        fail("write_failed");
      }
    } catch (error) {
      settle(() => rejectOutput(error instanceof ThreadExportError ? error : new ThreadExportError("write_failed")));
      return;
    }
    settle(() => resolveOutput(output.toString("utf8")));
  });
});

function writeExport(worktree: string, sessionId: string, entries: ThreadJsonlEntry[], maxJsonlBytes: number): ThreadExportReceipt {
  const contents = serializeEntries(entries, maxJsonlBytes);
  const directory = exportDirectory(worktree);
  const path = join(directory, `thread-export-${randomUUID()}.jsonl`);
  const sourceSessionSha256 = sha256(sessionId);
  try {
    writeFileSync(path, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    chmodSync(path, 0o600);
    assertOwnedPrivateFile(path, "write_failed");
  } catch (error) {
    if (error instanceof ThreadExportError) throw error;
    fail("write_failed");
  }
  const receiptPath = writeReceipt(path, {
    schemaVersion: THREAD_EXPORT_RECEIPT_SCHEMA_VERSION,
    exportFile: basename(path),
    sourceSessionSha256,
    byteLength: contents.length,
    sha256: sha256(contents),
  });
  return {
    path,
    receiptPath,
    sha256: sha256(contents),
    byteLength: contents.length,
    messageCount: entries.length,
    metadata: {
      source: "opencode-export",
      schemaVersion: THREAD_EXPORT_SCHEMA_VERSION,
      sourceSessionSha256,
    },
  };
}

/** Export one explicit OpenCode session to a private, upload-ready Thread JSONL file. */
export async function exportOpenCodeSessionToThread(options: ThreadExportOptions): Promise<ThreadExportReceipt> {
  const sessionId = assertSafeOpenCodeSessionId(options.sessionId);
  const worktree = resolveCanonicalWorktree(options.worktree);
  const limits = limitsFor(options);
  const output = await (options.runner ?? runOpenCodeExport)(sessionId, worktree, {
    timeoutMs: limits.timeoutMs,
    maxOutputBytes: limits.maxSourceBytes,
    shell: false,
  });
  if (typeof output !== "string") fail("command_failed");
  if (Buffer.byteLength(output, "utf8") > limits.maxSourceBytes) fail("output_too_large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    fail("malformed_export");
  }
  const entries = convertOpenCodeExport(sessionId, parsed, limits);
  return writeExport(worktree, sessionId, entries, limits.maxJsonlBytes);
}

/**
 * Delete only receipt-verified, mode-0600 export and receipt artifacts produced
 * under this worktree's private run directory. Callers must affirm upload success.
 */
export function cleanupThreadExport(options: ThreadExportCleanupOptions): void {
  if (options.uploadSucceeded !== true) fail("cleanup_denied");
  const worktree = resolveCanonicalWorktree(options.worktree);
  const directory = exportDirectory(worktree);
  const receipt = options.receipt;
  if (
    !receipt
    || typeof receipt.path !== "string"
    || typeof receipt.receiptPath !== "string"
    || typeof receipt.sha256 !== "string"
    || !SHA256_PATTERN.test(receipt.sha256)
  ) {
    fail("cleanup_denied");
  }
  const path = receipt.path;
  const receiptPath = receipt.receiptPath;
  if (
    !isAbsolute(path)
    || resolve(path) !== path
    || dirname(path) !== directory
    || !EXPORT_FILE_PATTERN.test(basename(path))
    || !isAbsolute(receiptPath)
    || resolve(receiptPath) !== receiptPath
    || dirname(receiptPath) !== directory
    || receiptPath !== `${path}.receipt.json`
    || !RECEIPT_FILE_PATTERN.test(basename(receiptPath))
  ) {
    fail("cleanup_denied");
  }
  try {
    const exportEntry = assertOwnedPrivateFile(path, "cleanup_denied");
    const exportBytes = readFileSync(path);
    const exportAfterRead = assertOwnedPrivateFile(path, "cleanup_denied");
    if (exportEntry.dev !== exportAfterRead.dev || exportEntry.ino !== exportAfterRead.ino || exportEntry.size !== exportAfterRead.size) fail("cleanup_denied");
    if (sha256(exportBytes) !== receipt.sha256) fail("cleanup_denied");
    const receiptEntry = assertOwnedPrivateFile(receiptPath, "cleanup_denied");
    const receiptBytes = readFileSync(receiptPath);
    const receiptAfterRead = assertOwnedPrivateFile(receiptPath, "cleanup_denied");
    if (receiptEntry.dev !== receiptAfterRead.dev || receiptEntry.ino !== receiptAfterRead.ino || receiptEntry.size !== receiptAfterRead.size) fail("cleanup_denied");
    let document: unknown;
    try {
      document = JSON.parse(receiptBytes.toString("utf8"));
    } catch {
      fail("cleanup_denied");
    }
    const receiptDocument = asRecord(document);
    const receiptKeys = receiptDocument ? Object.keys(receiptDocument).sort() : [];
    const expectedReceiptKeys = ["byteLength", "exportFile", "schemaVersion", "sha256", "sourceSessionSha256"];
    if (
      !receiptDocument
      || receiptKeys.length !== expectedReceiptKeys.length
      || receiptKeys.some((key, index) => key !== expectedReceiptKeys[index])
      || receiptDocument.schemaVersion !== THREAD_EXPORT_RECEIPT_SCHEMA_VERSION
      || receiptDocument.exportFile !== basename(path)
      || typeof receiptDocument.sourceSessionSha256 !== "string"
      || !SHA256_PATTERN.test(receiptDocument.sourceSessionSha256)
      || receiptDocument.byteLength !== exportBytes.length
      || receiptDocument.sha256 !== receipt.sha256
    ) fail("cleanup_denied");
    if (exportBytes.length > 0) {
      const entries = exportBytes.toString("utf8").split("\n");
      if (entries.at(-1) === "") entries.pop();
      if (entries.length === 0) fail("cleanup_denied");
      for (const entry of entries) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(entry);
        } catch {
          fail("cleanup_denied");
        }
        const metadata = asRecord(asRecord(parsed)?.metadata);
        if (!metadata || metadata.sourceSessionSha256 !== receiptDocument.sourceSessionSha256) fail("cleanup_denied");
      }
    }
    unlinkSync(path);
    unlinkSync(receiptPath);
  } catch (error) {
    if (error instanceof ThreadExportError) throw error;
    fail("cleanup_denied");
  }
}
