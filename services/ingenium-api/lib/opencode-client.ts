import { logger, runtimes } from "ingenium-core";
import { createOpencodeClient as createV2OpenCodeClient, type SessionMessage, type SessionV2Info } from "@opencode-ai/sdk/v2";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config/index.js";
import { currentOpenCodeRuntimeTarget, withOpenCodeRuntimeTarget } from "./runtime-opencode-context.js";

/**
 * Server-side typed HTTP client for OpenCode. Session and message reads use the
 * official v2 SDK; the remaining methods retain the established compatibility
 * surface until their v2 request/response mappings are complete.
 *
 * Routes all requests through `fetch` with HTTP Basic auth, normalizing errors
 * into a consistent `{ error: { message, code } }` shape. The SSE streaming
 * method returns a `ReadableStream` for piping through Express responses.
 *
 * 🔴 Credential safety:
 * - The password is never included in log messages (headers are redacted).
 * - The Authorization header value is never serialized to error messages.
 * - Runtime checks prevent `undefined` passwords from reaching the wire.
 *
 * 🔴 v2 session/message reads are bound to the native session location before
 * their data is returned to API consumers.
 */

/* ── Types ── */

export interface OpenCodeErrorShape {
  error: {
    message: string;
    code: string;
    /** Upstream HTTP status for server-side recovery decisions; never serialized. */
    status?: number;
  };
}

/**
 * Result wrapper: either the expected payload or a normalized error.
 * Callers should check for `data` vs `error` to determine success.
 */
export type OpenCodeResult<T> = T | OpenCodeErrorShape;

/** Shape returned by GET /global/health */
export interface OpenCodeHealth {
  healthy: boolean;
  version?: string;
}

/** Shape for session creation request body */
export interface CreateSessionBody {
  title?: string;
  directory?: string;
}

/** Shape for session update request body */
export interface UpdateSessionBody {
  title?: string;
}

/** Text part input for prompt requests */
export interface TextPartInput {
  type: "text";
  text: string;
}

/** File part input for prompt requests */
export interface FilePartInput {
  type: "file";
  mime: string;
  url: string;
  filename?: string;
}

/** Shape for prompt send request body on the retained OpenCode REST surface. */
export interface SendPromptBody {
  messageID?: string;
  parts: Array<TextPartInput | FilePartInput>;
  model?: { providerID: string; modelID: string };
  agent?: string;
  system?: string;
  tools?: Record<string, boolean>;
  variant?: string;
}

/**
 * The only OpenCode agent that may execute API-owned broker requests. Its
 * profile has a wildcard-deny permission boundary, so prompt-level tool
 * selections can never grant it a default or future tool capability.
 */
export const LLM_BROKER_AGENT = "ingenium-llm-broker";

/**
 * Interactive broker consumers normally receive at most 30 seconds. Docs AI
 * is explicitly allowed a longer bounded window for document transformations.
 * Background self-learning work has its own finite upper bound so it cannot
 * inherit an interactive timeout or run without a deadline.
 */
export const DEFAULT_BROKER_TIMEOUT_MS = 30_000;
export const DOCS_AI_BROKER_TIMEOUT_MS = 60_000;
/** Background callers preserve the core pipeline's established 60-second request. */
export const BACKGROUND_BROKER_TIMEOUT_MS = 60_000;
/** A background caller may explicitly request more time, but never indefinitely. */
export const MAX_BACKGROUND_BROKER_TIMEOUT_MS = 180_000;
/** Maximum for interactive broker policies (default and Docs AI). */
export const MAX_BROKER_TIMEOUT_MS = DOCS_AI_BROKER_TIMEOUT_MS;

export type BrokerTimeoutPolicy = "default" | "docs-ai" | "background";

export interface BrokerTimeoutResolution {
  policy: BrokerTimeoutPolicy;
  requestedTimeoutMs: number;
  effectiveTimeoutMs: number;
}

/** @internal — exported for bounded-timeout contract tests. */
export function resolveBrokerTimeout(
  timeoutMs: number | undefined,
  policy: BrokerTimeoutPolicy = "default",
): BrokerTimeoutResolution {
  const policyDefaultTimeoutMs = policy === "default"
    ? DEFAULT_BROKER_TIMEOUT_MS
    : policy === "docs-ai"
      ? DOCS_AI_BROKER_TIMEOUT_MS
      : BACKGROUND_BROKER_TIMEOUT_MS;
  const policyMaximumTimeoutMs = policy === "default"
    ? DEFAULT_BROKER_TIMEOUT_MS
    : policy === "docs-ai"
      ? DOCS_AI_BROKER_TIMEOUT_MS
      : MAX_BACKGROUND_BROKER_TIMEOUT_MS;
  const requestedTimeoutMs = typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
    ? timeoutMs
    : policyDefaultTimeoutMs;

  return {
    policy,
    requestedTimeoutMs,
    effectiveTimeoutMs: Math.min(
      Math.max(requestedTimeoutMs, 0),
      policyMaximumTimeoutMs,
    ),
  };
}

/** Shape for summarization request body */
export interface SummarizeBody {
  providerID: string;
  modelID: string;
}

/** Shape for permission reply */
export interface PermissionReplyBody {
  response: "once" | "always" | "reject";
}

/** Shape for fork request body */
export interface ForkBody {
  messageID?: string;
}

/** Shape for revert request body */
export interface RevertBody {
  messageID: string;
  partID?: string;
}

/** Shape for command request body */
export interface CommandBody {
  command: string;
  args?: string[];
  arguments?: string[];
}

/* ── Message shape on the retained OpenCode REST surface ── */

export interface MessageInfo {
  id: string;
  sessionID: string;
  role: "user" | "assistant" | "system";
  time: {
    created: number;
    completed?: number;
  };
  agent?: string;
  model?: { providerID: string; modelID: string };
  modelID?: string;
  providerID?: string;
  parentID?: string;
  mode?: string;
  path?: { cwd: string; root: string };
  cost?: number;
  tokens?: {
    total?: number;
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read: number; write: number };
  };
  finish?: string;
  error?: unknown;
  summary?: { diffs?: unknown[] };
}

export interface MessagePart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text" | "reasoning" | "step-start" | "step-finish" | "tool";
  text?: string;
  time?: { start: number; end: number };
  snapshot?: string;
  reason?: string;
  tokens?: unknown;
  cost?: number;
}

export interface MessageEnvelope {
  info: MessageInfo;
  parts: MessagePart[];
}

/* ── Session shape on the retained OpenCode REST surface ── */

export interface SessionTime {
  created: number;
  updated: number;
}

export interface SessionTokens {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface SessionModel {
  id: string;
  providerID: string;
  variant?: string;
}

export interface SessionShare {
  url: string;
}

export interface SessionRevert {
  messageID: string;
  snapshot: string;
  diff: string;
}

export interface SessionPermission {
  permission: string;
  pattern: string;
  action: string;
}

export interface SessionInfo {
  id: string;
  slug: string;
  projectID: string;
  parentID?: string;
  directory: string;
  path: string;
  title: string;
  version: string;
  time: SessionTime;
  cost: number;
  tokens: SessionTokens;
  summary?: { additions: number; deletions: number; files: number };
  agent?: string;
  model?: SessionModel;
  permission?: SessionPermission[];
  share?: SessionShare;
  revert?: SessionRevert;
}

interface V2SessionListResponse {
  data: SessionV2Info[];
  cursor?: { next?: string | null };
}

interface V2SessionMessagesResponse {
  data: SessionMessage[];
  cursor?: { next?: string | null };
}

interface V2SessionResponse {
  data: SessionV2Info;
}

/* ── Provider shape on the retained OpenCode REST surface ── */

export interface ProviderModel {
  id: string;
  providerID: string;
  api: { id: string; url: string; npm: string };
  name: string;
  capabilities: Record<string, unknown>;
  cost: { input: number; output: number; cache: { read: number; write: number } };
  limit: { context: number; output: number };
  status: string;
  options: Record<string, unknown>;
  headers: Record<string, unknown>;
  release_date: string;
  variants: Record<string, unknown>;
}

export interface ProviderInfo {
  id: string;
  name: string;
  source: string;
  env: string[];
  options: Record<string, unknown>;
  models: Record<string, ProviderModel>;
}

export interface ProvidersResponse {
  all: ProviderInfo[];
  default: Record<string, string>;
  connected: string[];
}

/* ── Auth shapes ── */

export interface AuthRequestBody {
  type: string;
  key: string;
  metadata?: Record<string, unknown>;
}

export interface AuthStatusResponse {
  providers: Array<{
    providerId: string;
    name: string;
    connected: boolean;
    keySet: boolean;
  }>;
}

export interface IntegrationPrompt {
  type: "text" | "select";
  key: string;
  message: string;
  placeholder?: string;
  options?: Array<{ label: string; value: string; hint?: string }>;
}

export interface IntegrationMethod {
  id?: string;
  type: "key" | "env" | "oauth";
  label?: string;
  names?: string[];
  prompts?: IntegrationPrompt[];
}

export interface IntegrationInfo {
  id: string;
  name: string;
  methods: IntegrationMethod[];
  connections: Array<{ type: string; id?: string; label?: string; name?: string }>;
}

export interface IntegrationAttempt {
  attemptID: string;
  url: string;
  instructions: string;
  mode: "auto" | "code";
  time: { created: number; expires: number };
}

interface V2Response<T> {
  location: Record<string, unknown>;
  data: T;
}

/* ── Agent shape on the retained OpenCode REST surface ── */

export interface AgentInfo {
  name: string;
  description: string;
  mode: "primary" | "subagent";
  native: boolean;
  permission: Array<{
    permission: string;
    pattern: string;
    action: string;
  }>;
  options: Record<string, unknown>;
}

/* ── Skill shape on the retained OpenCode REST surface ── */

export interface SkillInfo {
  name: string;
  description: string;
  location: string;
  content: string;
}

/* ── MCP Server shape ── */

export interface McpServerInfo {
  name: string;
  /** Current OpenCode connection state. */
  status?: "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration";
  /** Legacy compatibility for older servers. */
  connected?: boolean;
  toolCount?: number;
  tools?: number | unknown[];
}

/* ── Permission request shape ── */

export interface PermissionRequest {
  id: string;
  permission: string;
  pattern: string;
  action: string;
}

/* ── Question shape (still in API — GET /question returns array) ── */

export interface QuestionInfo {
  id: string;
  text?: string;
}

/* ── Session status shape ── */

export interface SessionStatus {
  type: "busy" | "idle";
}

/* ── Constants ── */

const SOURCE = "opencode-client";
const PROVIDER_CATALOG_ERROR: OpenCodeErrorShape["error"] = {
  code: "PROVIDER_CATALOG_FAILED",
  message: "OpenCode provider catalog is unavailable",
};
const PROVIDER_CONFIG_RELOAD_ERROR: OpenCodeErrorShape["error"] = {
  code: "PROVIDER_CONFIG_RELOAD_FAILED",
  message: "OpenCode provider configuration reload failed",
};
const PROVIDER_INSTANCE_DISPOSE_ERROR: OpenCodeErrorShape["error"] = {
  code: "PROVIDER_INSTANCE_DISPOSE_FAILED",
  message: "OpenCode provider instance reset failed",
};
const INTEGRATION_KEY_CONNECT_ERROR: OpenCodeErrorShape["error"] = {
  code: "PROVIDER_INTEGRATION_CONNECT_FAILED",
  message: "Provider connection failed",
};
const PROVIDER_AUTH_APPLY_ERROR: OpenCodeErrorShape["error"] = {
  code: "PROVIDER_AUTH_APPLY_FAILED",
  message: "Provider authentication update failed",
};
const PROVIDER_AUTH_REMOVE_ERROR: OpenCodeErrorShape["error"] = {
  code: "PROVIDER_AUTH_REMOVE_FAILED",
  message: "Provider authentication removal failed",
};
const PROVIDER_AUTH_STATUS_ERROR: OpenCodeErrorShape["error"] = {
  code: "PROVIDER_AUTH_STATUS_FAILED",
  message: "Provider authentication status is unavailable",
};

type SafeProviderOperation =
  | "provider_config_reload"
  | "provider_instance_dispose"
  | "integration_key_connect"
  | "provider_auth_apply"
  | "provider_auth_remove"
  | "provider_auth_status";

/* ── Helpers ── */

/**
 * Build a Basic auth header value from the configured password.
 * Uses "opencode" as the username per the retained OpenCode REST contract:
 *   Authorization: Basic base64("opencode:<PASSWORD>")
 *
 * Returns `null` if OPENCODE_SERVER_PASSWORD is not set — callers
 * should validate this before issuing requests.
 */
/** @internal — exported for testing */
function readProtectedOpenCodePassword(path: string): string {
  const parent = lstatSync(dirname(path));
  if (!parent.isDirectory() || parent.uid !== process.getuid?.() || parent.gid !== process.getgid?.() || (parent.mode & 0o777) !== 0o700) return "";
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.uid !== process.getuid?.() || metadata.gid !== process.getgid?.() || (metadata.mode & 0o777) !== 0o600 || metadata.size > 65) return "";
    const contents = readFileSync(descriptor, "utf8");
    const password = contents.endsWith("\n") ? contents.slice(0, -1) : contents;
    return /^[A-Za-z0-9_-]{64}$/.test(password) ? password : "";
  } finally {
    closeSync(descriptor);
  }
}

export function buildAuthHeader(): string | null {
  const file = process.env.OPENCODE_SERVER_PASSWORD_FILE?.trim();
  const inline = process.env.OPENCODE_SERVER_PASSWORD;
  if (file && inline) return null;
  const password = file ? readProtectedOpenCodePassword(file) : inline;
  if (!password) return null;
  const encoded = Buffer.from(`opencode:${password}`).toString("base64");
  return `Basic ${encoded}`;
}

/**
 * Return a redacted copy of headers safe for logging.
 * Passwords and auth tokens are replaced with `***REDACTED***`.
 */
/** @internal — exported for testing */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(headers)) {
    out[key] = key.toLowerCase() === "authorization" ? "***REDACTED***" : val;
  }
  return out;
}

const INVALID_PATH_SEGMENT = "__invalid_opencode_path_segment__";

/** Encode an upstream dynamic path component without changing query encoding. */
function pathSegment(value: string): string {
  if (value === "" || value === "." || value === "..") {
    return INVALID_PATH_SEGMENT;
  }
  return encodeURIComponent(value);
}

type V2OpenCodeClient = ReturnType<typeof createV2OpenCodeClient>["v2"];

interface OpenCodeMessagePage {
  messages: MessageEnvelope[];
  nextCursor?: string;
}

interface OpenCodeUserMessage {
  text: string;
  time_created: number;
  messageId?: string;
  sessionId?: string;
}

export interface NativeOpenCodeMessageBinding {
  worktree: string;
  sessionId: string;
  messageId?: string;
  role?: "user" | "assistant";
  text?: string;
}

const V2_PAGE_SIZE = 100;
const MAX_V2_LIST_PAGES = 100;
const V2_BINDING_ERROR: OpenCodeErrorShape["error"] = {
  code: "EXTERNAL_OBSERVATION_BINDING_REJECTED",
  message: "OpenCode session binding rejected",
};

function v2Client(directory?: string): V2OpenCodeClient | OpenCodeErrorShape {
  const target = currentOpenCodeRuntimeTarget();
  const requestedDirectory = directory ?? target?.directory;
  const auth = target
    ? target.password
      ? `Basic ${Buffer.from(`opencode:${target.password}`).toString("base64")}`
      : undefined
    : buildAuthHeader();
  if (!target && !auth) {
    return { error: { code: "AUTH_NOT_CONFIGURED", message: "OPENCODE_SERVER_PASSWORD is not configured" } };
  }

  return createV2OpenCodeClient({
    baseUrl: target?.baseUrl ?? config.opencodeUrl,
    ...(auth ? { headers: { Authorization: auth } } : {}),
    ...(requestedDirectory ? { directory: requestedDirectory } : {}),
  }).v2;
}

function statusOf(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const response = (value as Record<string, unknown>).response;
  if (!response || typeof response !== "object") return undefined;
  const status = (response as Record<string, unknown>).status;
  return typeof status === "number" ? status : undefined;
}

function v2Error(value: unknown, fallback = "OPENCODE_V2_UNAVAILABLE"): OpenCodeErrorShape {
  const status = statusOf(value);
  const code = status === 401 || status === 403
    ? "AUTHENTICATION_FAILED"
    : status === 404
      ? "NOT_FOUND"
      : status && status >= 500
        ? "HTTP_" + status
        : fallback;
  const error: OpenCodeErrorShape["error"] = {
    code,
    message: code === "AUTHENTICATION_FAILED"
      ? "OpenCode authentication failed"
      : code === "NOT_FOUND"
        ? "OpenCode resource not found"
        : "OpenCode request failed",
  };
  if (status !== undefined) Object.defineProperty(error, "status", { value: status, enumerable: false });
  return { error };
}

async function v2Call<T>(call: (client: V2OpenCodeClient) => Promise<unknown>, directory?: string): Promise<OpenCodeResult<T>> {
  const client = v2Client(directory);
  if (isOpenCodeError(client)) return client;
  try {
    const result = await call(client);
    if (!result || typeof result !== "object" || !("data" in result) || (result as { data?: unknown }).data === undefined) {
      return v2Error(result);
    }
    return (result as { data: T }).data;
  } catch {
    return { error: { code: "NETWORK_ERROR", message: "Network error contacting OpenCode server" } };
  }
}

function expectedOpenCodeDirectory(directory?: string): string | undefined {
  return directory ?? currentOpenCodeRuntimeTarget()?.directory;
}

function validNativeSessionId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function validateV2Session(info: unknown, directory?: string): info is SessionV2Info {
  if (!info || typeof info !== "object") return false;
  const value = info as Partial<SessionV2Info> & { location?: { directory?: unknown } };
  return typeof value.id === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.id)
    && typeof value.projectID === "string"
    && typeof value.location?.directory === "string"
    && (directory === undefined || value.location.directory === directory);
}

function bindingError(): OpenCodeErrorShape {
  const error: OpenCodeErrorShape["error"] = { ...V2_BINDING_ERROR };
  Object.defineProperty(error, "status", { value: 404, enumerable: false });
  return { error };
}

function mapV2Session(info: SessionV2Info): SessionInfo {
  return {
    id: info.id,
    slug: info.id,
    projectID: info.projectID,
    parentID: info.parentID,
    directory: info.location.directory,
    path: info.location.directory,
    title: info.title,
    version: "v2",
    time: info.time,
    cost: info.cost,
    tokens: info.tokens,
    agent: info.agent,
    model: info.model,
    revert: info.revert
      ? { messageID: info.revert.messageID, snapshot: info.revert.snapshot ?? "", diff: info.revert.diff ?? "" }
      : undefined,
  };
}

function messagePartId(messageId: string, suffix: string): string {
  return `${messageId}:${suffix}`;
}

function mapV2Message(message: SessionMessage, sessionId: string): MessageEnvelope | null {
  const base = { id: message.id, sessionID: sessionId };
  if (message.type === "user") {
    return {
      info: { ...base, role: "user", time: message.time },
      parts: [{ id: messagePartId(message.id, "text"), sessionID: sessionId, messageID: message.id, type: "text", text: message.text }],
    };
  }
  if (message.type === "assistant") {
    const parts: MessagePart[] = message.content.flatMap((part): MessagePart[] => {
      if (part.type === "text" || part.type === "reasoning") {
        return [{ id: part.id, sessionID: sessionId, messageID: message.id, type: part.type, text: part.text }];
      }
      if (part.type === "tool") {
        return [{ id: part.id, sessionID: sessionId, messageID: message.id, type: "tool" }];
      }
      return [];
    });
    const finishTime = message.time.completed ?? message.time.created;
    parts.push({
      id: messagePartId(message.id, "step-finish"),
      sessionID: sessionId,
      messageID: message.id,
      type: "step-finish",
      time: { start: message.time.created, end: finishTime },
      tokens: message.tokens,
      cost: message.cost,
      reason: message.finish,
    });
    return {
      info: {
        ...base,
        role: "assistant",
        time: message.time,
        agent: message.agent,
        model: { providerID: message.model.providerID, modelID: message.model.id },
        modelID: message.model.id,
        providerID: message.model.providerID,
        tokens: message.tokens,
        cost: message.cost,
        finish: message.finish,
        error: message.error,
      },
      parts,
    };
  }
  if (message.type === "system" || message.type === "synthetic" || message.type === "shell") {
    const text = message.type === "shell" ? message.output : message.text;
    return {
      info: { ...base, role: "system", time: message.time },
      parts: [{ id: messagePartId(message.id, "text"), sessionID: sessionId, messageID: message.id, type: "text", text }],
    };
  }
  return null;
}

async function getV2Session(sessionId: string, directory?: string): Promise<OpenCodeResult<SessionV2Info>> {
  if (!validNativeSessionId(sessionId)) {
    return { error: { code: "INVALID_SESSION_ID", message: "Invalid OpenCode session identifier" } };
  }
  const expectedDirectory = expectedOpenCodeDirectory(directory);
  const result = await v2Call<V2SessionResponse>((client) => client.session.get({ sessionID: sessionId }), expectedDirectory);
  if (isOpenCodeError(result)) return result;
  return validateV2Session(result.data, expectedDirectory) ? result.data : bindingError();
}

async function getV2MessagePage(
  sessionId: string,
  directory: string | undefined,
  limit: number | undefined,
  cursor: string | undefined,
): Promise<OpenCodeResult<{ messages: MessageEnvelope[]; nextCursor?: string }>> {
  const session = await getV2Session(sessionId, directory);
  if (isOpenCodeError(session)) return session;
  const pageLimit = limit === undefined ? V2_PAGE_SIZE : Math.min(Math.max(limit, 1), V2_PAGE_SIZE);
  const request = cursor === undefined
    ? { sessionID: sessionId, limit: pageLimit, order: "asc" as const }
    : { sessionID: sessionId, limit: pageLimit, cursor };
  const result = await v2Call<V2SessionMessagesResponse>(
    (client) => client.session.messages(request),
    directory ?? session.location.directory,
  );
  if (isOpenCodeError(result) || !Array.isArray(result.data)) return isOpenCodeError(result) ? result : v2Error(result, "OPENCODE_V2_INVALID_RESPONSE");
  if (result.data.length > V2_PAGE_SIZE) return v2Error(result, "OPENCODE_V2_INVALID_RESPONSE");
  const nextCursor = result.cursor?.next;
  if (nextCursor !== undefined && nextCursor !== null
    && (typeof nextCursor !== "string" || nextCursor.length === 0)) {
    return v2Error(result, "OPENCODE_V2_INVALID_RESPONSE");
  }
  const messages = result.data.flatMap((message) => {
    const mapped = mapV2Message(message, sessionId);
    return mapped ? [mapped] : [];
  });
  return { messages, ...(typeof nextCursor === "string" ? { nextCursor } : {}) };
}

function projectDirectoryMatches(directory: string, project: string): boolean {
  if (!project) return true;
  return directory === project || directory.endsWith(`/${project}`) || directory.endsWith(`\\${project}`);
}

export async function readRecentOpenCodeUserMessages(params: {
  since: number;
  limit: number;
  project?: string;
}): Promise<OpenCodeResult<OpenCodeUserMessage[]>> {
  const sessions = await opencodeClient.listSessions();
  if (isOpenCodeError(sessions)) return sessions;
  const messages: OpenCodeUserMessage[] = [];
  for (const session of sessions) {
    if (session.parentID || !projectDirectoryMatches(session.directory, params.project ?? "")) continue;
    let cursor: string | undefined;
    const cursors = new Set<string>();
    for (let page = 0; page < MAX_V2_LIST_PAGES; page += 1) {
      const result = await getV2MessagePage(session.id, session.directory, V2_PAGE_SIZE, cursor);
      if (isOpenCodeError(result)) return result;
      for (const message of result.messages) {
        if (message.info.role !== "user") continue;
        const part = message.parts.find((candidate) => candidate.type === "text" && typeof candidate.text === "string");
        const timeCreated = message.info.time.created;
        if (!part || typeof part.text !== "string" || part.text.length <= 10 || timeCreated <= params.since) continue;
        messages.push({ text: part.text, time_created: timeCreated, messageId: message.info.id, sessionId: session.id });
      }
      if (!result.nextCursor || result.messages.length === 0) break;
      if (cursors.has(result.nextCursor)) return { error: { code: "OPENCODE_V2_CURSOR_FAILED", message: "OpenCode pagination failed" } };
      cursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
  }
  messages.sort((left, right) => right.time_created - left.time_created);
  return messages.slice(0, Math.max(0, Math.min(params.limit, 2000)));
}

export async function verifyOpenCodeNativeMessage(
  binding: NativeOpenCodeMessageBinding,
): Promise<OpenCodeResult<{ nativeSessionId: string; message?: MessageEnvelope }>> {
  if (!/^session-[a-f0-9]{64}$/.test(binding.sessionId)
    || !binding.worktree.startsWith("/")
    || binding.worktree.length > 1024
    || /[\u0000-\u001f\u007f]/.test(binding.worktree)) {
    return bindingError();
  }
  const sessions = await opencodeClient.listSessions(binding.worktree);
  if (isOpenCodeError(sessions)) return sessions;
  for (const session of sessions) {
    const expectedSessionId = `session-${createHash("sha256").update(session.id, "utf8").digest("hex")}`;
    if (expectedSessionId !== binding.sessionId) continue;
    if (!binding.messageId) return { nativeSessionId: session.id };
    let cursor: string | undefined;
    const cursors = new Set<string>();
    for (let page = 0; page < MAX_V2_LIST_PAGES; page += 1) {
      const result = await getV2MessagePage(session.id, session.directory, V2_PAGE_SIZE, cursor);
      if (isOpenCodeError(result)) return result;
      const message = result.messages.find((candidate) => candidate.info.id === binding.messageId);
      if (message && (!binding.role || message.info.role === binding.role)) {
        if (binding.text !== undefined) {
          const text = message.parts.find((part) => part.type === "text")?.text;
          if (text !== binding.text) return bindingError();
        }
        return { nativeSessionId: session.id, message };
      }
      if (!result.nextCursor || result.messages.length === 0) break;
      if (cursors.has(result.nextCursor)) return { error: { code: "OPENCODE_V2_CURSOR_FAILED", message: "OpenCode pagination failed" } };
      cursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    return bindingError();
  }
  return bindingError();
}

/**
 * Central request dispatcher. Builds the full URL, injects auth, handles
 * error normalization, and returns a typed result.
 */
/** @internal — exported for testing */
export async function request<T>(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | undefined>;
    /** Optional caller-owned cancellation propagated to the HTTP transport. */
    signal?: AbortSignal;
    /** Route-owned failures must not log or return opaque upstream codes. */
    sanitizedUpstreamError?: OpenCodeErrorShape["error"];
    /** Fixed local label for logs around a sensitive provider operation. */
    safeProviderOperation?: SafeProviderOperation;
  } = {},
): Promise<OpenCodeResult<T>> {
  const target = currentOpenCodeRuntimeTarget();
  const auth = target ? (target.password ? `Basic ${Buffer.from(`opencode:${target.password}`).toString("base64")}` : null) : buildAuthHeader();
  if (!target && !auth) {
    return {
      error: {
        message: "OPENCODE_SERVER_PASSWORD is not configured",
        code: "AUTH_NOT_CONFIGURED",
      },
    };
  }

  const {
    method = "GET",
    body,
    query,
    signal,
    sanitizedUpstreamError,
    safeProviderOperation,
  } = opts;

  // Build URL with query params
  let url = `${target?.baseUrl ?? config.opencodeUrl}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) {
        params.set(k, String(v));
      }
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (auth) headers.Authorization = auth;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const init: RequestInit = { method, headers, signal };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    if (safeProviderOperation) {
      logger.debug(SOURCE, "OpenCode provider operation requested", {
        operation: safeProviderOperation,
      });
    } else {
      logger.debug(SOURCE, `${method} ${url}`, {
        headers: redactHeaders(headers),
        bodyLen: body ? JSON.stringify(body).length : 0,
      });
    }

    const response = await fetch(url, init);
    const contentType = response.headers.get("content-type") ?? "";

    if (!response.ok) {
      if (sanitizedUpstreamError) {
        // Do not parse credential-bearing error bodies; canceling releases the response stream.
        await response.body?.cancel().catch(() => undefined);
        logger.warn(
          SOURCE,
          safeProviderOperation ? "OpenCode provider operation failed" : `OpenCode ${response.status} for ${method} ${path}`,
          safeProviderOperation
            ? {
              operation: safeProviderOperation,
              code: sanitizedUpstreamError.code,
              status: response.status,
            }
            : { status: response.status },
        );
        const error: OpenCodeErrorShape["error"] = { ...sanitizedUpstreamError };
        Object.defineProperty(error, "status", { value: response.status, enumerable: false });
        return { error };
      }

      // Attempt to parse the error body
      let errMsg = `HTTP ${response.status}`;
      let errCode = `HTTP_${response.status}`;
      try {
        if (contentType.includes("application/json")) {
          const errBody: any = await response.json();
          errMsg = errBody?.message ?? errBody?.data?.message ?? errMsg;
          errCode = errBody?.name ?? errBody?._tag ?? errBody?.code ?? errCode;
        } else {
          const text = await response.text().catch(() => "");
          if (text) errMsg = text.slice(0, 500);
        }
      } catch {
        // Best-effort — use the fallback message
      }

      logger.warn(
        SOURCE,
        `OpenCode ${response.status} for ${method} ${path}`,
        { status: response.status, code: errCode },
      );

      const error: OpenCodeErrorShape["error"] = { message: errMsg, code: errCode };
      Object.defineProperty(error, "status", { value: response.status, enumerable: false });
      return { error };
    }

    // Non-JSON responses (shouldn't happen except maybe for 204/205)
    if (!contentType.includes("application/json")) {
      const text = await response.text();
      return text as unknown as T;
    }

    const data: T = await response.json();
    return data;
  } catch (err: unknown) {
    const e = err as Error & { name?: string };

    // Provider credential operations must not expose an abort implementation's
    // message or name; generic requests retain their cancellation contract.
    if (e.name === "AbortError") {
      if (safeProviderOperation && sanitizedUpstreamError) {
        return { error: { ...sanitizedUpstreamError } };
      }
      throw err;
    }

    if (sanitizedUpstreamError) {
      logger.error(
        SOURCE,
        safeProviderOperation ? "OpenCode provider operation failed" : `Fetch failed for ${method} ${path}`,
        safeProviderOperation
          ? { operation: safeProviderOperation, code: sanitizedUpstreamError.code }
          : { name: e.name },
      );
    } else {
      logger.error(SOURCE, `Fetch failed for ${method} ${path}: ${e.message}`, {
        name: e.name,
        code: e.name === "TypeError" ? (e as any).code : undefined,
      });
    }

    return {
      error: {
        message: sanitizedUpstreamError?.message ?? e.message ?? "Network error contacting OpenCode server",
        code: sanitizedUpstreamError?.code ?? "NETWORK_ERROR",
      },
    };
  }
}

/**
 * SSE streaming request — fetches a text/event-stream endpoint and returns
 * the response body as a ReadableStream (or an error shape on failure).
 */
async function streamRequest(
  path: string,
  query?: Record<string, string | number | undefined>,
  extraHeaders?: Record<string, string>,
): Promise<ReadableStream<Uint8Array> | OpenCodeErrorShape> {
  const target = currentOpenCodeRuntimeTarget();
  const auth = target ? (target.password ? `Basic ${Buffer.from(`opencode:${target.password}`).toString("base64")}` : null) : buildAuthHeader();
  if (!target && !auth) {
    return {
      error: {
        message: "OPENCODE_SERVER_PASSWORD is not configured",
        code: "AUTH_NOT_CONFIGURED",
      },
    };
  }

  let url = `${target?.baseUrl ?? config.opencodeUrl}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  try {
    const headers: Record<string, string> = { Accept: "text/event-stream", ...extraHeaders };
    if (auth) headers.Authorization = auth;
    const response = await fetch(url, {
      method: "GET",
      headers,
    });

    if (!response.ok || !response.body) {
      return {
        error: {
          message: `SSE stream failed: HTTP ${response.status}`,
          code: `HTTP_${response.status}`,
        },
      };
    }

    return response.body;
  } catch (err: unknown) {
    const e = err as Error;
    return {
      error: {
        message: e.message ?? "Network error streaming from OpenCode",
        code: "NETWORK_ERROR",
      },
    };
  }
}

/**
 * Helper: check whether a result is an error shape.
 */
export function isOpenCodeError<T>(result: OpenCodeResult<T>): result is OpenCodeErrorShape {
  return typeof result === "object" && result !== null && "error" in result;
}

/* ── Client ── */

/**
 * Singleton OpenCode API client. Session reads use the official v2 SDK;
 * remaining methods retain the compatibility REST surface.
 *
 * Every method returns a `OpenCodeResult<T>` — callers should check
 * `isOpenCodeError(result)` before accessing the payload.
 *
 * Endpoints are covered by the retained OpenCode REST contract tests.
 */
export const opencodeClient = {
  /* ── Health ── */

  health: (): Promise<OpenCodeResult<OpenCodeHealth>> =>
    request<OpenCodeHealth>("/global/health"),

  /** Apply a partial global config without interrupting active sessions. */
  updateGlobalConfig: (
    config: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<OpenCodeResult<Record<string, unknown>>> =>
    request<Record<string, unknown>>("/global/config", {
      method: "PATCH",
      body: { config },
      signal,
      sanitizedUpstreamError: PROVIDER_CONFIG_RELOAD_ERROR,
      safeProviderOperation: "provider_config_reload",
    }),

  disposeInstance: (
    directory?: string,
    signal?: AbortSignal,
  ): Promise<OpenCodeResult<boolean>> =>
    request<boolean>("/instance/dispose", {
      method: "POST",
      query: { directory },
      signal,
      sanitizedUpstreamError: PROVIDER_INSTANCE_DISPOSE_ERROR,
      safeProviderOperation: "provider_instance_dispose",
    }),

  /* ── Sessions ── */

  listSessions: async (directory?: string): Promise<OpenCodeResult<SessionInfo[]>> => {
    const expectedDirectory = expectedOpenCodeDirectory(directory);
    const sessions: SessionInfo[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_V2_LIST_PAGES; page += 1) {
      const request = cursor === undefined
        ? { directory: expectedDirectory, limit: V2_PAGE_SIZE, order: "desc" as const }
        : { directory: expectedDirectory, limit: V2_PAGE_SIZE, cursor };
      const result = await v2Call<V2SessionListResponse>((client) => client.session.list(request), expectedDirectory);
      if (isOpenCodeError(result)) return result;
      if (!Array.isArray(result.data)) return v2Error(result, "OPENCODE_V2_INVALID_RESPONSE");
      for (const session of result.data) {
        if (!validateV2Session(session, expectedDirectory)) return bindingError();
        sessions.push(mapV2Session(session));
      }
      const next = result.cursor?.next;
      if (!next) return sessions;
      if (cursors.has(next)) return { error: { code: "OPENCODE_V2_CURSOR_FAILED", message: "OpenCode pagination failed" } };
      cursors.add(next);
      cursor = next;
    }
    return { error: { code: "OPENCODE_V2_CURSOR_FAILED", message: "OpenCode pagination exceeded its safety limit" } };
  },

  createSession: (
    body: CreateSessionBody,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> =>
    request<SessionInfo>("/session", {
      method: "POST",
      body,
      query: { directory },
    }),

  getSession: async (
    id: string,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> => {
    const result = await getV2Session(id, directory);
    return isOpenCodeError(result) ? result : mapV2Session(result);
  },

  updateSession: (
    id: string,
    body: UpdateSessionBody,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> =>
    request<SessionInfo>(`/session/${pathSegment(id)}`, {
      method: "PATCH",
      body,
      query: { directory },
    }),

  deleteSession: (
    id: string,
    directory?: string,
  ): Promise<OpenCodeResult<boolean>> =>
    request<boolean>(`/session/${pathSegment(id)}`, {
      method: "DELETE",
      query: { directory },
    }),

  /* ── Session status ── */

  getSessionStatus: (directory?: string): Promise<OpenCodeResult<SessionStatus[]>> =>
    request<SessionStatus[]>("/session/status", { query: { directory } }),

  /* ── Messages ── */

  getMessagesPage: (
    sessionId: string,
    limit?: number,
    cursor?: string,
    directory?: string,
  ): Promise<OpenCodeResult<OpenCodeMessagePage>> =>
    getV2MessagePage(sessionId, directory, limit, cursor),

  getMessages: async (
    sessionId: string,
    limit?: number,
    before?: string,
    directory?: string,
  ): Promise<OpenCodeResult<MessageEnvelope[]>> => {
    const result = await getV2MessagePage(sessionId, directory, limit, before);
    return isOpenCodeError(result) ? result : result.messages;
  },

  getSessionMessage: (
    sessionId: string,
    messageId: string,
    directory?: string,
  ): Promise<OpenCodeResult<MessageEnvelope>> =>
    request<MessageEnvelope>(`/session/${pathSegment(sessionId)}/message/${pathSegment(messageId)}`, {
      query: { directory },
    }),

  sendPrompt: (
    sessionId: string,
    body: SendPromptBody,
    directory?: string,
  ): Promise<OpenCodeResult<MessageEnvelope>> =>
    request<MessageEnvelope>(`/session/${pathSegment(sessionId)}/message`, {
      method: "POST",
      body,
      query: { directory },
    }),

  deleteMessage: (
    sessionId: string,
    messageId: string,
    directory?: string,
  ): Promise<OpenCodeResult<boolean>> =>
    request<boolean>(`/session/${pathSegment(sessionId)}/message/${pathSegment(messageId)}`, {
      method: "DELETE",
      query: { directory },
    }),

  /* ── Session actions ── */

  abortSession: (
    sessionId: string,
    directory?: string,
  ): Promise<OpenCodeResult<boolean>> =>
    request<boolean>(`/session/${pathSegment(sessionId)}/abort`, {
      method: "POST",
      query: { directory },
    }),

  forkSession: (
    sessionId: string,
    messageId?: string,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> =>
    request<SessionInfo>(`/session/${pathSegment(sessionId)}/fork`, {
      method: "POST",
      body: messageId ? ({ messageID: messageId } satisfies ForkBody) : undefined,
      query: { directory },
    }),

  shareSession: (
    sessionId: string,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> =>
    request<SessionInfo>(`/session/${pathSegment(sessionId)}/share`, {
      method: "POST",
      query: { directory },
    }),

  unshareSession: (
    sessionId: string,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> =>
    request<SessionInfo>(`/session/${pathSegment(sessionId)}/share`, {
      method: "DELETE",
      query: { directory },
    }),

  compactSession: (
    sessionId: string,
    body?: SummarizeBody,
    directory?: string,
  ): Promise<OpenCodeResult<boolean>> =>
    request<boolean>(`/session/${pathSegment(sessionId)}/summarize`, {
      method: "POST",
      body,
      query: { directory },
    }),

  revertSession: (
    sessionId: string,
    body: RevertBody,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> =>
    request<SessionInfo>(`/session/${pathSegment(sessionId)}/revert`, {
      method: "POST",
      body,
      query: { directory },
    }),

  unrevertSession: (
    sessionId: string,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> =>
    request<SessionInfo>(`/session/${pathSegment(sessionId)}/unrevert`, {
      method: "POST",
      body: {},
      query: { directory },
    }),

  getSessionChildren: (
    sessionId: string,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo[]>> =>
    request<SessionInfo[]>(`/session/${pathSegment(sessionId)}/children`, {
      query: { directory },
    }),

  getSessionDiff: (
    sessionId: string,
    messageId?: string,
    directory?: string,
  ): Promise<OpenCodeResult<unknown>> =>
    request<unknown>(`/session/${pathSegment(sessionId)}/diff`, {
      query: { messageID: messageId, directory },
    }),

  sendCommand: (
    sessionId: string,
    body: CommandBody,
    directory?: string,
  ): Promise<OpenCodeResult<unknown>> =>
    request<unknown>(`/session/${pathSegment(sessionId)}/command`, {
      method: "POST",
      body,
      query: { directory },
    }),

  initSession: (
    sessionId: string,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> =>
    request<SessionInfo>(`/session/${pathSegment(sessionId)}/init`, {
      method: "POST",
      body: {},
      query: { directory },
    }),

  /* ── Providers ── */

  listProviders: (directory?: string): Promise<OpenCodeResult<ProvidersResponse>> =>
    request<ProvidersResponse>("/provider", {
      query: { directory },
      // Provider errors commonly contain opaque vendor diagnostics. This
      // catalog is browser-facing, so no upstream code or message may escape.
      sanitizedUpstreamError: PROVIDER_CATALOG_ERROR,
    }),

  listIntegrations: (directory?: string): Promise<OpenCodeResult<V2Response<IntegrationInfo[]>>> =>
    request<V2Response<IntegrationInfo[]>>("/api/integration", {
      query: { "location.directory": directory },
    }),

  connectIntegrationKey: (
    integrationID: string,
    key: string,
    signal?: AbortSignal,
  ): Promise<OpenCodeResult<string>> =>
    request<string>(`/api/integration/${pathSegment(integrationID)}/connect/key`, {
      method: "POST",
      body: { key },
      signal,
      sanitizedUpstreamError: INTEGRATION_KEY_CONNECT_ERROR,
      safeProviderOperation: "integration_key_connect",
    }),

  beginIntegrationOAuth: (
    integrationID: string,
    methodID: string,
    inputs: Record<string, string>,
  ): Promise<OpenCodeResult<V2Response<IntegrationAttempt>>> =>
    request<V2Response<IntegrationAttempt>>(`/api/integration/${pathSegment(integrationID)}/connect/oauth`, {
      method: "POST",
      body: { methodID, inputs },
    }),

  getIntegrationAttempt: (attemptID: string): Promise<OpenCodeResult<V2Response<{ status: string; message?: string }>>> =>
    request<V2Response<{ status: string; message?: string }>>(`/api/integration/attempt/${pathSegment(attemptID)}`),

  completeIntegrationAttempt: (attemptID: string, code?: string): Promise<OpenCodeResult<string>> =>
    request<string>(`/api/integration/attempt/${pathSegment(attemptID)}/complete`, {
      method: "POST",
      body: code ? { code } : {},
    }),

  cancelIntegrationAttempt: (attemptID: string): Promise<OpenCodeResult<string>> =>
    request<string>(`/api/integration/attempt/${pathSegment(attemptID)}`, { method: "DELETE" }),

  /* ── Auth ── */

  addAuth: (
    providerID: string,
    body: AuthRequestBody,
    directory?: string,
    signal?: AbortSignal,
  ): Promise<OpenCodeResult<unknown>> =>
    request<unknown>(`/auth/${pathSegment(providerID)}`, {
      method: "PUT",
      body,
      query: { directory },
      signal,
      sanitizedUpstreamError: PROVIDER_AUTH_APPLY_ERROR,
      safeProviderOperation: "provider_auth_apply",
    }),

  deleteAuth: (
    providerID: string,
    directory?: string,
    signal?: AbortSignal,
  ): Promise<OpenCodeResult<unknown>> =>
    request<unknown>(`/auth/${pathSegment(providerID)}`, {
      method: "DELETE",
      query: { directory },
      signal,
      sanitizedUpstreamError: PROVIDER_AUTH_REMOVE_ERROR,
      safeProviderOperation: "provider_auth_remove",
    }),

  getAuthStatus: async (
    directory?: string,
    signal?: AbortSignal,
  ): Promise<OpenCodeResult<AuthStatusResponse>> => {
    const result = await request<V2Response<IntegrationInfo[]>>("/api/integration", {
      query: { "location.directory": directory },
      signal,
      sanitizedUpstreamError: PROVIDER_AUTH_STATUS_ERROR,
      safeProviderOperation: "provider_auth_status",
    });
    if (isOpenCodeError(result)) return result;
    return {
      providers: result.data.map((integration) => ({
        providerId: integration.id,
        name: integration.name,
        connected: integration.connections.length > 0,
        keySet: integration.connections.some((connection) => connection.type === "credential"),
      })),
    };
  },

  /* ── Agents ── */

  listAgents: (): Promise<OpenCodeResult<AgentInfo[]>> =>
    request<AgentInfo[]>("/agent"),

   /* ── Skills (GET /skill works, but we DO NOT proxy it — skills are
         managed by the Ingenium skill system, not OpenCode) ── */

  listSkills: (): Promise<OpenCodeResult<SkillInfo[]>> =>
    request<SkillInfo[]>("/skill"),

  /* ── MCP ── */

  getMCPStatus: (directory?: string): Promise<OpenCodeResult<Record<string, McpServerInfo>>> =>
    request<Record<string, McpServerInfo>>("/mcp", {
      query: { directory },
      sanitizedUpstreamError: { code: "MCP_STATUS_FAILED", message: "OpenCode request failed" },
    }),

  connectMCP: (name: string): Promise<OpenCodeResult<unknown>> =>
    request<unknown>(`/mcp/${pathSegment(name)}/connect`, {
      method: "POST",
      sanitizedUpstreamError: { code: "MCP_MUTATION_FAILED", message: "OpenCode request failed" },
    }),

  disconnectMCP: (name: string): Promise<OpenCodeResult<unknown>> =>
    request<unknown>(`/mcp/${pathSegment(name)}/disconnect`, {
      method: "POST",
      sanitizedUpstreamError: { code: "MCP_MUTATION_FAILED", message: "OpenCode request failed" },
    }),

  /* ── Permissions ── */

  /**
   * Get pending permission requests (global).
    * Retained contract: GET /permission returns an array of PermissionRequest objects.
   */
  getPermissions: (directory?: string): Promise<OpenCodeResult<PermissionRequest[]>> =>
    request<PermissionRequest[]>("/permission", { query: { directory } }),

  /**
   * Reply to a session-scoped permission request.
    * Retained contract: POST /session/{sessionId}/permissions/{permissionId}
   *   body: { "response": "once" | "always" | "reject" }
   */
  replyPermission: (
    sessionId: string,
    permissionId: string,
    body: PermissionReplyBody,
    directory?: string,
  ): Promise<OpenCodeResult<unknown>> =>
    request<unknown>(`/session/${pathSegment(sessionId)}/permissions/${pathSegment(permissionId)}`, {
      method: "POST",
      body,
      query: { directory },
    }),

  /* ── Questions ── */

  /**
   * Get pending questions (global).
    * Retained contract: GET /question returns an array of QuestionInfo objects.
   * Note: Questions also arrive via SSE events and message parts.
   */
  getQuestions: (directory?: string): Promise<OpenCodeResult<QuestionInfo[]>> =>
    request<QuestionInfo[]>("/question", { query: { directory } }),

  /* ── SSE ── */

  /**
   * Returns a ReadableStream piping SSE events from the OpenCode /event endpoint.
    * Retained contract: GET /event?session={id} for filtered, or /event?directory=/workspace.
   * When `sessionId` is provided, events are filtered to that session.
   * When `directory` is provided, events are filtered to that directory.
   */
  streamEvents: (
    sessionId?: string,
    directory?: string,
    lastEventId?: string,
  ): Promise<ReadableStream<Uint8Array> | OpenCodeErrorShape> =>
    streamRequest(
      "/event",
      {
        session: sessionId,
        directory,
      },
      lastEventId ? { "Last-Event-ID": lastEventId } : undefined,
    ),
};

/**
 * Execute an LLM request through an ephemeral, fail-closed OpenCode session.
 *
 * Do not add agent or tool parameters here. The API constructs both fields so
 * callers, prompt content, and future broker consumers cannot override the
 * wildcard-deny broker profile or enable a tool.
 */
export async function brokerExecute(params: {
  providerID: string;
  modelID: string;
  system: string;
  user: string;
  timeoutMs?: number;
  /** Server-owned policy; browser input can never select this. */
  timeoutPolicy?: BrokerTimeoutPolicy;
}): Promise<{ ok: boolean; content: string; error?: string }> {
  const source = "opencode-broker";
  const timeout = resolveBrokerTimeout(params.timeoutMs, params.timeoutPolicy);
  const timeoutMs = timeout.effectiveTimeoutMs;
  const created = await opencodeClient.createSession({ title: "ingenium-llm-broker" });

  if (isOpenCodeError(created)) {
    logger.warn(source, "Failed to create broker session", {
      code: created.error.code,
    });
    return { ok: false, content: "", error: "broker session unavailable" };
  }

  const sessionId = created.id;
  logger.debug(source, `Created broker session ${sessionId}`, {
    providerID: params.providerID,
    modelID: params.modelID,
  });

  try {
    const sent = await opencodeClient.sendPrompt(sessionId, {
      parts: [{ type: "text", text: params.user }],
      model: { providerID: params.providerID, modelID: params.modelID },
      agent: LLM_BROKER_AGENT,
      system: params.system,
      // This is an explicit empty selection; the selected agent's wildcard
      // deny is the authoritative capability boundary.
      tools: {},
    });

    if (isOpenCodeError(sent)) {
      logger.warn(source, `Failed to send prompt for broker session ${sessionId}`, {
        code: sent.error.code,
      });
      return { ok: false, content: "", error: "broker request failed" };
    }

    const deadline = Date.now() + timeoutMs;
    let delayMs = 500;

    while (Date.now() <= deadline) {
      const messages = await opencodeClient.getMessages(sessionId);
      if (isOpenCodeError(messages)) {
        logger.warn(source, `Failed to poll broker session ${sessionId}`, {
          code: messages.error.code,
        });
        return { ok: false, content: "", error: "broker response unavailable" };
      }

      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.info.role === "assistant" && lastMessage.info.finish) {
        const content = lastMessage.parts
          .filter(part => part.type === "text")
          .map(part => part.text ?? "")
          .join("");
        return { ok: true, content };
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;

      await new Promise<void>(resolve => setTimeout(resolve, Math.min(delayMs, remainingMs)));
      delayMs = Math.min(delayMs * 2, 30_000);
    }

    logger.warn(source, `Broker session ${sessionId} timed out`, timeout);
    return { ok: false, content: "", error: "timeout" };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.name : "BrokerError";
    logger.error(source, `Broker session ${sessionId} failed`, { error });
    return { ok: false, content: "", error: "broker execution failed" };
  } finally {
    const deleted = await opencodeClient.deleteSession(sessionId);
    if (isOpenCodeError(deleted)) {
      logger.warn(source, `Failed to delete broker session ${sessionId}`, {
        code: deleted.error.code,
      });
    }
  }
}

/**
 * API-owned synthesis adapter. Core never imports this module: API routes use it
 * for interactive AI work, while legacy direct HTTP execution remains available
 * only to core deployments that have not configured the broker.
 */
export type SynthesisBrokerExecutor = (params: {
  providerID: string;
  modelID: string;
  system: string;
  user: string;
  timeoutMs?: number;
  timeoutPolicy?: BrokerTimeoutPolicy;
}) => Promise<{ ok: boolean; content: string; error?: string }>;

/**
 * Narrow, text-only bridge passed into core background work. Core owns prompts
 * and response parsing; the API retains provider resolution and the only path
 * that can select the tool-denied OpenCode broker agent.
 */
export function createBackgroundSynthesisBrokerExecutor(projectId: string): (params: {
  system: string;
  user: string;
  timeoutMs: number;
}) => Promise<{ ok: boolean; content: string; error?: string }> {
  return async ({ system, user, timeoutMs }) => {
    const runtime = runtimes.getReadyRuntimeForProject(projectId);
    if (runtime) {
      return withOpenCodeRuntimeTarget({ baseUrl: `http://${runtime.backendName}:4098` }, () => executeSynthesisBroker({
        projectId,
        system,
        user,
        timeoutMs,
        timeoutPolicy: "background",
      }));
    }
    return { ok: false, content: "", error: "no authorized synthesis automation executor configured" };
  };
}

export async function executeSynthesisBroker(params: {
  projectId: string;
  system: string;
  user: string;
  timeoutMs?: number;
  /** Route-owned policy. Defaults preserve the 30-second broker contract. */
  timeoutPolicy?: BrokerTimeoutPolicy;
  /** A route-validated selection. When present, do not silently switch models. */
  selection?: { providerID: string; modelID: string };
  /** Test-only/integration seam; production uses the tool-denied broker session. */
  executor?: SynthesisBrokerExecutor;
}): Promise<{ ok: boolean; content: string; error?: string }> {
  if (params.selection) {
    return (params.executor ?? brokerExecute)({
      ...params.selection,
      system: params.system,
      user: params.user,
      timeoutMs: params.timeoutMs,
      timeoutPolicy: params.timeoutPolicy,
    });
  }
  // This dynamic import avoids a static cycle: the Chat catalog itself gets
  // OpenCode's runtime provider list through this client. Resolution runs only
  // after this module has initialized and never accepts browser input.
  let choices: Array<{ providerID: string; modelID: string }>;
  try {
    const { resolveSynthesisProviderSelections } = await import("./synthesis-provider-resolution.js");
    choices = (await resolveSynthesisProviderSelections(params.projectId)).selections;
  } catch (error) {
    logger.warn("opencode-broker", "Unable to resolve synthesis provider choices", {
      error: error instanceof Error ? error.name : "unknown",
    });
    choices = [];
  }
  if (choices.length === 0) return { ok: false, content: "", error: "no synthesis provider configured" };

  for (const choice of choices) {
    const result = await (params.executor ?? brokerExecute)({
      ...choice,
      system: params.system,
      user: params.user,
      timeoutMs: params.timeoutMs,
      timeoutPolicy: params.timeoutPolicy,
    });
    if (result.ok) return result;
  }
  return { ok: false, content: "", error: "all configured synthesis providers failed" };
}
