/**
 * Context file-import boundary.
 *
 * The MCP process is allowed to read only an owner-private file from the
 * launcher-bound project's dedicated context-upload directory. The resulting
 * complete snapshot is sent once to the API; this module never writes Context
 * entries or talks to the database directly.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { api } from "../client.js";

export const CONTEXT_UPLOAD_MAX_FILE_BYTES = 8 * 1024 * 1024;
/** OpenCode CLI exports include non-visible diagnostic payloads before filtering. */
export const CONTEXT_UPLOAD_MAX_OPENCODE_EXPORT_BYTES = 64 * 1024 * 1024;
export const CONTEXT_UPLOAD_MAX_ENTRIES = 10_000;
export const CONTEXT_UPLOAD_MAX_MESSAGE_CHARS = 262_144;
export const CONTEXT_UPLOAD_SNAPSHOT_PATH = "/context/conversations/import";

const CONTEXT_UPLOAD_SESSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const SOURCE_KEY_PREFIX = "context-upload-file:";

type UploadRole = "user" | "assistant";
type UploadFormat = "opencode" | "json" | "jsonl" | "text";

interface RawEntry {
  role: UploadRole;
  content: string;
  sourceId?: string;
}

interface SnapshotEntry {
  role: UploadRole;
  content: string;
  sourceMessageId: string;
  metadata: Record<string, never>;
}

export interface ContextUploadFileOptions {
  conversationId?: string;
  tags?: string[];
  priority?: number;
}

export interface PreparedContextUploadSnapshot {
  format: UploadFormat;
  sourceFileHash: string;
  sourceKey: string;
  sourceSessionId: string;
  snapshotHash: string;
  entryCount: number;
  bytes: Uint8Array;
}

export type ContextUploadErrorCode =
  | "PROJECT_IDENTITY_REQUIRED"
  | "CONTEXT_UPLOAD_INVALID"
  | "CONTEXT_UPLOAD_FILE_REJECTED"
  | "CONTEXT_UPLOAD_TOO_LARGE"
  | "CONTEXT_UPLOAD_PARSE_FAILED"
  | "CONTEXT_UPLOAD_EMPTY"
  | "CONTEXT_UPLOAD_SNAPSHOT_TOO_LARGE"
  | "CONTEXT_UPLOAD_UNAVAILABLE"
  | "CONTEXT_UPLOAD_REJECTED";

/** Errors intentionally expose stable codes only, never a filesystem path or source text. */
export class ContextUploadFileError extends Error {
  constructor(public readonly code: ContextUploadErrorCode) {
    super(code);
    this.name = "ContextUploadFileError";
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function boundedString(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= CONTEXT_UPLOAD_MAX_FILE_BYTES
    ? value
    : undefined;
}

function safeResultError(code: ContextUploadErrorCode) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code } }) }],
  };
}

function isContainedBy(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path.length > 0 && !path.startsWith("..") && !isAbsolute(path);
}

function currentUid(): number | null {
  return process.platform !== "win32" && typeof process.getuid === "function"
    ? process.getuid()
    : null;
}

function isPrivateDirectory(stat: Stats): boolean {
  const uid = currentUid();
  return stat.isDirectory()
    && !stat.isSymbolicLink()
    && (uid === null || stat.uid === uid)
    && (stat.mode & 0o022) === 0;
}

function isPrivateRegularFile(stat: Stats): boolean {
  const uid = currentUid();
  return stat.isFile()
    && !stat.isSymbolicLink()
    && stat.nlink === 1
    && (uid === null || stat.uid === uid)
    && (stat.mode & 0o400) !== 0
    && (stat.mode & 0o077) === 0;
}

function equalFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.uid === right.uid
    && left.mode === right.mode
    && left.size === right.size;
}

function safeSession(value: string): string {
  if (
    value.length === 0
    || value.length > 128
    || value !== value.trim()
    || !CONTEXT_UPLOAD_SESSION_PATTERN.test(value)
    || value === "."
    || value === ".."
  ) {
    throw new ContextUploadFileError("CONTEXT_UPLOAD_INVALID");
  }
  return value;
}

function safeInputPath(filePath: string): string {
  if (
    !isAbsolute(filePath)
    || filePath.length > 4_096
    || CONTROL_CHARACTER_PATTERN.test(filePath)
    || filePath.includes("\\")
    || filePath !== resolve(filePath)
  ) {
    throw new ContextUploadFileError("CONTEXT_UPLOAD_FILE_REJECTED");
  }
  const components = filePath.split(sep);
  if (components.some((component) => component === "." || component === "..")) {
    throw new ContextUploadFileError("CONTEXT_UPLOAD_FILE_REJECTED");
  }
  return filePath;
}

/**
 * A JSON file is the only source that can be an OpenCode CLI export. Its exact
 * format is verified after bounded JSON parsing; all non-OpenCode formats keep
 * the ordinary 8 MiB source limit.
 */
function maxRawSourceBytes(filePath: string): number {
  return extname(filePath).toLowerCase() === ".json"
    ? CONTEXT_UPLOAD_MAX_OPENCODE_EXPORT_BYTES
    : CONTEXT_UPLOAD_MAX_FILE_BYTES;
}

function verifiedWorktree(path: string, project: string): string | null {
  if (!isAbsolute(path) || path !== resolve(path) || basename(path) !== project) return null;
  try {
    const metadata = lstatSync(path);
    if (!isPrivateDirectory(metadata)) return null;
    const canonical = realpathSync(path);
    return canonical === path ? canonical : null;
  } catch {
    return null;
  }
}

/**
 * Accept only the Docker canonical worktree or a launcher-verified equivalent
 * worktree. The latter is deliberately tied to the launcher project basename.
 */
function contextUploadWorktrees(project: string): string[] {
  const candidates = [resolve("/workspace", project)];
  const configuredWorktree = process.env.INGENIUM_WORKTREE;
  if (configuredWorktree) candidates.push(configuredWorktree);
  candidates.push(process.cwd());

  const verified = new Set<string>();
  for (const candidate of candidates) {
    const worktree = verifiedWorktree(candidate, project);
    if (worktree) verified.add(worktree);
  }
  return [...verified];
}

function verifyDirectoryPath(worktree: string, root: string): void {
  const uploadRelative = relative(worktree, root);
  if (uploadRelative !== `.ingenium${sep}context-uploads`) {
    throw new ContextUploadFileError("CONTEXT_UPLOAD_FILE_REJECTED");
  }
  let current = worktree;
  for (const segment of uploadRelative.split(sep)) {
    current = resolve(current, segment);
    try {
      if (!isPrivateDirectory(lstatSync(current)) || realpathSync(current) !== current) {
        throw new ContextUploadFileError("CONTEXT_UPLOAD_FILE_REJECTED");
      }
    } catch (error) {
      if (error instanceof ContextUploadFileError) throw error;
      throw new ContextUploadFileError("CONTEXT_UPLOAD_FILE_REJECTED");
    }
  }
}

function resolveVerifiedUploadRoot(project: string, filePath: string): string {
  for (const worktree of contextUploadWorktrees(project)) {
    const root = resolve(worktree, ".ingenium", "context-uploads");
    if (!isContainedBy(root, filePath)) continue;
    verifyDirectoryPath(worktree, root);
    return root;
  }
  throw new ContextUploadFileError("CONTEXT_UPLOAD_FILE_REJECTED");
}

function verifyFileParents(root: string, filePath: string): void {
  const parent = resolve(filePath, "..");
  if (!isContainedBy(root, filePath) || !isContainedBy(root, parent) && parent !== root) {
    throw new ContextUploadFileError("CONTEXT_UPLOAD_FILE_REJECTED");
  }
  const parentRelative = relative(root, parent);
  if (!parentRelative) return;
  let current = root;
  for (const segment of parentRelative.split(sep)) {
    current = resolve(current, segment);
    try {
      if (!isPrivateDirectory(lstatSync(current)) || realpathSync(current) !== current) {
        throw new ContextUploadFileError("CONTEXT_UPLOAD_FILE_REJECTED");
      }
    } catch (error) {
      if (error instanceof ContextUploadFileError) throw error;
      throw new ContextUploadFileError("CONTEXT_UPLOAD_FILE_REJECTED");
    }
  }
}

/** Read the regular file through one O_NOFOLLOW descriptor after pre/post checks. */
function readProtectedUploadFile(project: string, inputPath: string, maxBytes: number): Uint8Array {
  const filePath = safeInputPath(inputPath);
  const root = resolveVerifiedUploadRoot(project, filePath);
  verifyFileParents(root, filePath);

  let before: Stats;
  try {
    before = lstatSync(filePath);
  } catch {
    throw new ContextUploadFileError("CONTEXT_UPLOAD_FILE_REJECTED");
  }
  if (!isPrivateRegularFile(before)) throw new ContextUploadFileError("CONTEXT_UPLOAD_FILE_REJECTED");
  if (before.size > maxBytes) throw new ContextUploadFileError("CONTEXT_UPLOAD_TOO_LARGE");

  let descriptor: number | undefined;
  try {
    descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (!isPrivateRegularFile(opened) || !equalFileIdentity(before, opened)) {
      throw new ContextUploadFileError("CONTEXT_UPLOAD_FILE_REJECTED");
    }
    if (opened.size > maxBytes) throw new ContextUploadFileError("CONTEXT_UPLOAD_TOO_LARGE");
    const bytes = readFileSync(descriptor);
    const afterRead = fstatSync(descriptor);
    if (!isPrivateRegularFile(afterRead) || !equalFileIdentity(opened, afterRead)) {
      throw new ContextUploadFileError("CONTEXT_UPLOAD_FILE_REJECTED");
    }
    if (bytes.byteLength > maxBytes || bytes.byteLength !== opened.size) {
      throw new ContextUploadFileError("CONTEXT_UPLOAD_TOO_LARGE");
    }
    return bytes;
  } catch (error) {
    if (error instanceof ContextUploadFileError) throw error;
    throw new ContextUploadFileError("CONTEXT_UPLOAD_FILE_REJECTED");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function excluded(record: Record<string, unknown>): boolean {
  return record.synthetic === true
    || record.ignored === true
    || record.ignore === true
    || record.hidden === true;
}

function roleFrom(record: Record<string, unknown>): UploadRole | null {
  const role = record.role;
  if (role === "user" || role === "assistant") return role;
  return null;
}

function textParts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const text: string[] = [];
  for (const candidate of value) {
    const part = asRecord(candidate);
    if (!part || excluded(part) || part.type !== "text") continue;
    const content = boundedString(part.text ?? part.content);
    if (content !== undefined) text.push(content);
  }
  return text;
}

function simpleContent(record: Record<string, unknown>): string | undefined {
  const direct = boundedString(record.content) ?? boundedString(record.text);
  if (direct !== undefined) return direct;
  const fromParts = textParts(record.parts ?? record.content);
  return fromParts.length > 0 ? fromParts.join("\n") : undefined;
}

function sourceIdFrom(record: Record<string, unknown>): string | undefined {
  const value = record.id ?? record.messageId ?? record.message_id ?? record.uuid;
  const sourceId = boundedString(value);
  return sourceId && !CONTROL_CHARACTER_PATTERN.test(sourceId) ? sourceId : undefined;
}

function completeAssistant(info: Record<string, unknown>): boolean {
  if (typeof info.finish === "string" && info.finish.length > 0) return true;
  if (info.completed === true || info.complete === true || info.status === "completed") return true;
  const time = asRecord(info.time);
  return typeof time?.completed === "number" && Number.isFinite(time.completed);
}

function parseOpenCodeMessages(messages: unknown[]): RawEntry[] {
  const entries: RawEntry[] = [];
  for (const candidate of messages) {
    const envelope = asRecord(candidate);
    const info = envelope ? asRecord(envelope.info) : null;
    if (!envelope || !info || excluded(envelope) || excluded(info)) continue;
    const role = roleFrom(info);
    if (!role || role === "assistant" && !completeAssistant(info)) continue;
    const visibleParts = textParts(envelope.parts);
    const content = visibleParts.join("\n");
    if (content.trim().length === 0) continue;
    entries.push({ role, content, sourceId: sourceIdFrom(info) });
  }
  return entries;
}

function parseSimpleEntry(candidate: unknown): RawEntry | null {
  const record = asRecord(candidate);
  if (!record || excluded(record)) return null;
  const role = roleFrom(record) ?? roleFrom(asRecord(record.author) ?? {}) ?? roleFrom(asRecord(record.message) ?? {});
  if (!role) return null;
  const nestedMessage = asRecord(record.message);
  const content = simpleContent(record) ?? (nestedMessage ? simpleContent(nestedMessage) : undefined);
  if (content === undefined || content.trim().length === 0) return null;
  return { role, content, sourceId: sourceIdFrom(record) ?? (nestedMessage ? sourceIdFrom(nestedMessage) : undefined) };
}

function parseSimpleJson(value: unknown): RawEntry[] {
  const record = asRecord(value);
  const candidates = Array.isArray(value)
    ? value
    : Array.isArray(record?.entries)
      ? record.entries
      : Array.isArray(record?.messages)
        ? record.messages
        : [value];
  return candidates.map(parseSimpleEntry).filter((entry): entry is RawEntry => entry !== null);
}

function parseJsonLines(text: string): RawEntry[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0 || lines.length > CONTEXT_UPLOAD_MAX_ENTRIES) {
    throw new ContextUploadFileError("CONTEXT_UPLOAD_PARSE_FAILED");
  }
  const entries: RawEntry[] = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new ContextUploadFileError("CONTEXT_UPLOAD_PARSE_FAILED");
    }
    const entry = parseSimpleEntry(parsed);
    if (entry) entries.push(entry);
  }
  return entries;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ContextUploadFileError("CONTEXT_UPLOAD_PARSE_FAILED");
  }
}

function parseSourceFile(filePath: string, bytes: Uint8Array): { format: UploadFormat; entries: RawEntry[] } {
  const text = decodeUtf8(bytes);
  const extension = extname(filePath).toLowerCase();
  if (extension === ".jsonl" || extension === ".ndjson") {
    return { format: "jsonl", entries: parseJsonLines(text) };
  }
  if (extension === ".json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ContextUploadFileError("CONTEXT_UPLOAD_PARSE_FAILED");
    }
    const record = asRecord(parsed);
    if (record && isRecord(record.info) && Array.isArray(record.messages)) {
      return { format: "opencode", entries: parseOpenCodeMessages(record.messages) };
    }
    if (bytes.byteLength > CONTEXT_UPLOAD_MAX_FILE_BYTES) {
      throw new ContextUploadFileError("CONTEXT_UPLOAD_TOO_LARGE");
    }
    return { format: "json", entries: parseSimpleJson(parsed) };
  }
  if (extension !== ".md" && extension !== ".markdown" && extension !== ".txt") {
    const trimmed = text.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        const record = asRecord(parsed);
        if (record && isRecord(record.info) && Array.isArray(record.messages)) {
          return { format: "opencode", entries: parseOpenCodeMessages(record.messages) };
        }
        return { format: "json", entries: parseSimpleJson(parsed) };
      } catch {
        throw new ContextUploadFileError("CONTEXT_UPLOAD_PARSE_FAILED");
      }
    }
  }
  return text.trim().length === 0
    ? { format: "text", entries: [] }
    : { format: "text", entries: [{ role: "user", content: text, sourceId: "text" }] };
}

function splitText(content: string): string[] {
  const segments: string[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    let end = Math.min(content.length, cursor + CONTEXT_UPLOAD_MAX_MESSAGE_CHARS);
    if (end < content.length && /[\uD800-\uDBFF]/.test(content.charAt(end - 1))) end -= 1;
    if (end <= cursor) end = Math.min(content.length, cursor + CONTEXT_UPLOAD_MAX_MESSAGE_CHARS);
    const segment = content.slice(cursor, end);
    if (segment.trim().length > 0) segments.push(segment);
    cursor = end;
  }
  return segments;
}

function snapshotEntries(session: string, raw: RawEntry[]): SnapshotEntry[] {
  const entries: SnapshotEntry[] = [];
  for (let sourceIndex = 0; sourceIndex < raw.length; sourceIndex += 1) {
    const entry = raw[sourceIndex]!;
    const sourceIdentity = entry.sourceId ?? `${sourceIndex}:${entry.role}:${sha256(entry.content)}`;
    const chunks = splitText(entry.content);
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      if (entries.length >= CONTEXT_UPLOAD_MAX_ENTRIES) {
        throw new ContextUploadFileError("CONTEXT_UPLOAD_SNAPSHOT_TOO_LARGE");
      }
      entries.push({
        role: entry.role,
        content: chunks[chunkIndex]!,
        sourceMessageId: sha256(`context-upload-file-entry-v1\u0000${session}\u0000${sourceIdentity}\u0000${chunkIndex}`),
        metadata: {},
      });
    }
  }
  return entries;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function normalizedTags(input: string[] | undefined): string[] {
  const tags = input ?? [];
  if (tags.length > 64) throw new ContextUploadFileError("CONTEXT_UPLOAD_INVALID");
  const normalized = tags.map((tag) => {
    if (typeof tag !== "string") throw new ContextUploadFileError("CONTEXT_UPLOAD_INVALID");
    const value = tag.trim();
    if (value.length === 0 || value.length > 64 || CONTROL_CHARACTER_PATTERN.test(value)) {
      throw new ContextUploadFileError("CONTEXT_UPLOAD_INVALID");
    }
    return value;
  });
  return [...new Set(normalized)].sort();
}

function normalizedPriority(input: number | undefined): number {
  const priority = input ?? 5;
  if (!Number.isInteger(priority) || priority < 0 || priority > 10) {
    throw new ContextUploadFileError("CONTEXT_UPLOAD_INVALID");
  }
  return priority;
}

function validateConversationId(value: string | undefined): void {
  if (value !== undefined && !UUID_PATTERN.test(value)) {
    throw new ContextUploadFileError("CONTEXT_UPLOAD_INVALID");
  }
}

function snapshotHash(
  sourceKey: string,
  sourceSessionId: string,
  title: string,
  tags: string[],
  priority: number,
  metadata: Record<string, string>,
  entries: SnapshotEntry[],
): string {
  const payload = {
    version: "context-conversation-snapshot-v1",
    sourceKey,
    sourceSessionId,
    title,
    tags,
    priority,
    metadata,
    entries: entries.map((entry) => ({
      role: entry.role,
      contentHash: sha256(entry.content),
      sourceFingerprint: sha256(`context-conversation-snapshot-source-message-v1\u0000${sourceKey}\u0000${entry.sourceMessageId}`),
      createdAt: null,
      metadata: entry.metadata,
    })),
  };
  return sha256(canonicalJson(payload));
}

/** Build the exact bounded Context snapshot from a protected descriptor-read file. */
export function prepareContextUploadSnapshot(
  project: string,
  session: string,
  filePath: string,
  options: ContextUploadFileOptions = {},
): PreparedContextUploadSnapshot {
  const safeProject = safeSession(project);
  const safeSourceSession = safeSession(session);
  const safePath = safeInputPath(filePath);
  validateConversationId(options.conversationId);
  const sourceBytes = readProtectedUploadFile(safeProject, safePath, maxRawSourceBytes(safePath));
  const sourceFileHash = sha256(sourceBytes);
  const parsed = parseSourceFile(safePath, sourceBytes);
  if (parsed.format !== "opencode" && sourceBytes.byteLength > CONTEXT_UPLOAD_MAX_FILE_BYTES) {
    throw new ContextUploadFileError("CONTEXT_UPLOAD_TOO_LARGE");
  }
  const entries = snapshotEntries(safeSourceSession, parsed.entries);
  if (entries.length === 0) throw new ContextUploadFileError("CONTEXT_UPLOAD_EMPTY");
  const sourceKey = `${SOURCE_KEY_PREFIX}${safeSourceSession}`;
  const tags = normalizedTags(options.tags);
  const priority = normalizedPriority(options.priority);
  const metadata = { importer: "context_upload_file" };
  const hash = snapshotHash(sourceKey, safeSourceSession, safeSourceSession, tags, priority, metadata, entries);
  const request = {
    sourceKey,
    sourceSessionId: safeSourceSession,
    title: safeSourceSession,
    ...(options.conversationId === undefined ? {} : { existingConversationId: options.conversationId }),
    entries,
    tags,
    priority,
    metadata,
    snapshotHash: hash,
  };
  const bytes = Buffer.from(JSON.stringify(request), "utf8");
  if (bytes.byteLength > CONTEXT_UPLOAD_MAX_FILE_BYTES) {
    throw new ContextUploadFileError("CONTEXT_UPLOAD_SNAPSHOT_TOO_LARGE");
  }
  return {
    format: parsed.format,
    sourceFileHash,
    sourceKey,
    sourceSessionId: safeSourceSession,
    snapshotHash: hash,
    entryCount: entries.length,
    bytes,
  };
}

function apiMetadata(data: unknown): Record<string, unknown> {
  const value = asRecord(data);
  if (!value) return {};
  const result: Record<string, unknown> = {};
  for (const key of ["appended", "revision", "created", "adopted", "idempotent"] as const) {
    const candidate = value[key];
    if (typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean") {
      result[key] = candidate;
    }
  }
  const conversation = asRecord(value.conversation);
  if (conversation) {
    const sanitizedConversation: Record<string, unknown> = {};
    for (const key of ["id", "revision", "message_count", "checkpoint_count", "latest_message_id"] as const) {
      const candidate = conversation[key];
      if (typeof candidate === "string" || typeof candidate === "number" || candidate === null) {
        sanitizedConversation[key] = candidate;
      }
    }
    if (Object.keys(sanitizedConversation).length > 0) result.conversation = sanitizedConversation;
  }
  return result;
}

/**
 * Validate launcher binding, create one complete request body, and submit it
 * through the raw protected API boundary. Response content is never relayed.
 */
export async function uploadContextFile(
  project: string,
  session: string,
  filePath: string,
  options: ContextUploadFileOptions,
  launcherProject: string | null,
) {
  if (!launcherProject || project !== launcherProject) {
    return safeResultError("PROJECT_IDENTITY_REQUIRED");
  }
  let snapshot: PreparedContextUploadSnapshot;
  try {
    snapshot = prepareContextUploadSnapshot(project, session, filePath, options);
  } catch (error) {
    return safeResultError(error instanceof ContextUploadFileError ? error.code : "CONTEXT_UPLOAD_FILE_REJECTED");
  }

  try {
    // This is intentionally the only Context API write made by this tool.
    const response = await api.postOctetStream(
      CONTEXT_UPLOAD_SNAPSHOT_PATH,
      snapshot.bytes,
      { project },
    );
    if (!response.ok) return safeResultError("CONTEXT_UPLOAD_REJECTED");
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          sourceKey: snapshot.sourceKey,
          sourceSessionId: snapshot.sourceSessionId,
          sourceFileHash: snapshot.sourceFileHash,
          snapshotHash: snapshot.snapshotHash,
          format: snapshot.format,
          entryCount: snapshot.entryCount,
          ...apiMetadata(response.data),
        }),
      }],
    };
  } catch {
    return safeResultError("CONTEXT_UPLOAD_UNAVAILABLE");
  }
}
