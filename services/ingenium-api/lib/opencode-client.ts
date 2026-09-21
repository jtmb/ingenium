import { logger, runtimes } from "ingenium-core";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config/index.js";
import { currentOpenCodeRuntimeTarget, withOpenCodeRuntimeTarget } from "./runtime-opencode-context.js";

/**
 * Server-side typed HTTP client for the OpenCode v2.0.11 `/api/**` surface.
 *
 * Every method maps to an operation in the authoritative v2 OpenAPI document
 * (`/tmp/opencode/oc-v2-openapi.json`, 113 paths). The v1 REST surface that this
 * client used previously (`/session`, `/event`, `/global/config`, `/auth`,
 * `/permission`, `/question`, ...) no longer serves JSON on v2 servers, so the
 * client talks to `/api/**` with `fetch` instead of the v1-era
 * `@opencode-ai/sdk` package (whose `/v2` preview paths do not match 2.0.11).
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
 * 🔴 v2 session reads are bound to the native session location before their
 * data is returned to API consumers.
 *
 * 🔴 Unmappable v1 behavior: v2 removed the per-request `system` prompt, share
 * toggles, per-message deletion, session init, and part-level revert. Those
 * methods keep their signatures but fail closed with typed errors; see the
 * individual method comments for the missing spec surface.
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

/** Shape returned by GET /api/info (v2 server identity) */
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

/**
 * Wire shapes for the v2.0.11 endpoints this client consumes. Field names and
 * optionality mirror the OpenAPI document rather than the retained API DTOs.
 */
interface V2LocationRef {
  directory: string;
}

interface V2ModelRef {
  id: string;
  providerID: string;
  variant?: string;
}

interface V2SessionInfo {
  id: string;
  projectID: string;
  parentID?: string;
  agent?: string;
  model?: V2ModelRef;
  cost: number;
  tokens: SessionTokens;
  time: SessionTime;
  title?: string;
  revert?: { messageID: string; partID?: string; snapshot?: string };
  location: V2LocationRef;
}

interface V2ContentPart {
  type: string;
  text?: string;
  id?: string;
}

interface V2ConversationMessage {
  id: string;
  type: string;
  time: { created: number; completed?: number };
  text?: string;
  output?: string;
  agent?: string;
  model?: V2ModelRef;
  content?: V2ContentPart[];
  finish?: string;
  tokens?: MessageInfo["tokens"];
  cost?: number;
  error?: unknown;
}

interface V2Page<T> {
  data: T[];
  cursor?: { next?: string | null; previous?: string | null };
}

interface V2ProviderInfo {
  id: string;
  name: string;
  activation: string;
  package?: string;
  settings?: Record<string, unknown>;
}

interface V2ModelCostTier {
  input?: number;
  output?: number;
  cache?: { read?: number; write?: number };
}

interface V2ModelInfo {
  id: string;
  modelID: string;
  providerID: string;
  name: string;
  status: string;
  cost?: V2ModelCostTier[];
  limit?: { context?: number; output?: number };
  capabilities?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  headers?: Record<string, string>;
  time?: { released?: number };
}

interface V2McpServer {
  name: string;
  status?: { status?: string; error?: string };
}

interface V2IntegrationConnection {
  type: string;
  id?: string;
  label?: string;
  name?: string;
}

interface V2IntegrationInfo {
  id: string;
  name: string;
  connections?: V2IntegrationConnection[];
}

interface V2PermissionRequest {
  id: string;
  sessionID: string;
  action: string;
  resources?: string[];
}

interface V2FormInfo {
  id: string;
  sessionID: string;
  title: string;
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

/* ── Agent shape ── */

export interface AgentInfo {
  id?: string;
  name: string;
  description: string;
  mode: "primary" | "subagent" | "all";
  /** v1-only flag; v2 marks agents as `hidden` instead. */
  native?: boolean;
  hidden?: boolean;
  permission: Array<{
    permission: string;
    pattern: string;
    action: string;
  }>;
  options: Record<string, unknown>;
}

interface V2AgentInfo {
  id: string;
  name: string;
  description?: string;
  mode: "primary" | "subagent" | "all";
  hidden?: boolean;
  permissions?: Array<{ action: string; resource: string; effect: string }>;
}

/* ── Skill shape ── */

export interface SkillInfo {
  name: string;
  description: string;
  location: string;
  content: string;
}

interface V2SkillInfo {
  id: string;
  name: string;
  description?: string;
  path: string;
  content: string;
}

/* ── MCP Server shape ── */

export const MCP_CONNECTION_STATUSES = [
  "connected",
  "pending",
  "disabled",
  "failed",
  "needs_auth",
  "needs_client_registration",
] as const;

export type McpConnectionStatus = (typeof MCP_CONNECTION_STATUSES)[number];

function normalizeMcpConnectionStatus(value: unknown): McpConnectionStatus | undefined {
  return typeof value === "string" && (MCP_CONNECTION_STATUSES as readonly string[]).includes(value)
    ? (value as McpConnectionStatus)
    : undefined;
}

export interface McpServerInfo {
  name: string;
  /** Current OpenCode connection state. */
  status?: McpConnectionStatus;
  /** Legacy compatibility for older servers. */
  connected?: boolean;
  /** Upstream diagnostic text; route projection replaces it with a fixed message. */
  error?: string;
  toolCount?: number;
  tools?: number | unknown[];
}

/* ── Permission request shape ── */

export interface PermissionRequest {
  id: string;
  permission: string;
  pattern: string;
  action: string;
  sessionID?: string;
}

/* ── Question shape (projected from v2 forms) ── */

export interface QuestionInfo {
  id: string;
  text?: string;
  sessionID?: string;
}

/* ── Session status shape ── */

export interface SessionStatus {
  type: "busy" | "idle";
  sessionID?: string;
}

/* ── Constants ── */

const SOURCE = "opencode-client";
const PROVIDER_CATALOG_ERROR: OpenCodeErrorShape["error"] = {
  code: "PROVIDER_CATALOG_FAILED",
  message: "OpenCode provider catalog is unavailable",
};
const INTEGRATION_ID_REQUIRED_ERROR: OpenCodeErrorShape["error"] = {
  code: "OPENCODE_V2_INTEGRATION_ID_REQUIRED",
  message: "OpenCode v2 requires the integration ID for OAuth attempt operations",
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

function statusOf(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const direct = (value as Record<string, unknown>).status;
  if (typeof direct === "number") return direct;
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

type OpenCodeRequestOptions = NonNullable<Parameters<typeof request>[1]>;

/**
 * Send a v2 request and unwrap its `{ data }` envelope. Reads with additional
 * envelope fields (`location`, `cursor`) keep those fields on the raw response
 * and are handled by callers that need them.
 */
async function v2Data<T>(path: string, options: OpenCodeRequestOptions = {}): Promise<OpenCodeResult<T>> {
  const result = await request<{ data: T }>(path, options);
  if (isOpenCodeError(result)) return result;
  if (!result || typeof result !== "object" || !("data" in result) || (result as { data?: unknown }).data === undefined) {
    return v2Error(result, "OPENCODE_V2_INVALID_RESPONSE");
  }
  return (result as { data: T }).data;
}

function expectedOpenCodeDirectory(directory?: string): string | undefined {
  return directory ?? currentOpenCodeRuntimeTarget()?.directory;
}

function validNativeSessionId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function validateV2Session(info: unknown, directory?: string): info is V2SessionInfo {
  if (!info || typeof info !== "object") return false;
  const value = info as Partial<V2SessionInfo> & { location?: { directory?: unknown } };
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

function mapV2Session(info: V2SessionInfo): SessionInfo {
  return {
    id: info.id,
    slug: info.id,
    projectID: info.projectID,
    parentID: info.parentID,
    directory: info.location.directory,
    path: info.location.directory,
    title: info.title ?? "",
    version: "v2",
    time: info.time,
    cost: info.cost,
    tokens: info.tokens,
    agent: info.agent,
    model: info.model,
    revert: info.revert
      ? { messageID: info.revert.messageID, snapshot: info.revert.snapshot ?? "", diff: "" }
      : undefined,
  };
}

function messagePartId(messageId: string, suffix: string): string {
  return `${messageId}:${suffix}`;
}

function mapV2Message(message: V2ConversationMessage, sessionId: string): MessageEnvelope | null {
  const base = { id: message.id, sessionID: sessionId };
  if (message.type === "user") {
    return {
      info: { ...base, role: "user", time: message.time },
      parts: [{ id: messagePartId(message.id, "text"), sessionID: sessionId, messageID: message.id, type: "text", text: message.text ?? "" }],
    };
  }
  if (message.type === "assistant") {
    const content = Array.isArray(message.content) ? message.content : [];
    const parts: MessagePart[] = [];
    content.forEach((part, index) => {
      // v2 text/reasoning content carries no id, so a stable per-message id is
      // derived; tool content keeps its upstream id.
      const partId = typeof part.id === "string" && part.id.length > 0
        ? part.id
        : messagePartId(message.id, `content-${index}`);
      if (part.type === "text" || part.type === "reasoning") {
        parts.push({ id: partId, sessionID: sessionId, messageID: message.id, type: part.type, text: part.text ?? "" });
      } else if (part.type === "tool") {
        parts.push({ id: partId, sessionID: sessionId, messageID: message.id, type: "tool" });
      }
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
        model: message.model ? { providerID: message.model.providerID, modelID: message.model.id } : undefined,
        modelID: message.model?.id,
        providerID: message.model?.providerID,
        tokens: message.tokens,
        cost: message.cost,
        finish: message.finish,
        error: message.error,
      },
      parts,
    };
  }
  if (message.type === "system" || message.type === "synthetic" || message.type === "shell") {
    const text = message.type === "shell" ? message.output ?? "" : message.text ?? "";
    return {
      info: { ...base, role: "system", time: message.time },
      parts: [{ id: messagePartId(message.id, "text"), sessionID: sessionId, messageID: message.id, type: "text", text }],
    };
  }
  return null;
}

async function getV2Session(sessionId: string, directory?: string): Promise<OpenCodeResult<V2SessionInfo>> {
  if (!validNativeSessionId(sessionId)) {
    return { error: { code: "INVALID_SESSION_ID", message: "Invalid OpenCode session identifier" } };
  }
  const expectedDirectory = expectedOpenCodeDirectory(directory);
  const result = await v2Data<V2SessionInfo>(`/api/session/${pathSegment(sessionId)}`);
  if (isOpenCodeError(result)) return result;
  return validateV2Session(result, expectedDirectory) ? result : bindingError();
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
  const query: Record<string, string | number> = { limit: pageLimit };
  if (cursor === undefined) query.order = "asc";
  else query.cursor = cursor;
  const result = await request<V2Page<V2ConversationMessage>>(
    `/api/session/${pathSegment(session.id)}/message`,
    { query },
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

/**
 * Project the retained prompt-parts body onto the v2 prompt input. Multiple
 * text parts are joined with newlines because v2 admits a single text field;
 * file parts become `uri` attachments.
 */
function promptInputFromParts(body: SendPromptBody): OpenCodeResult<Record<string, unknown>> {
  const text = body.parts
    .filter((part): part is TextPartInput => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const files = body.parts
    .filter((part): part is FilePartInput => part.type === "file")
    .map((part) => ({ uri: part.url, ...(part.filename ? { name: part.filename } : {}) }));
  if (text.length === 0 && files.length === 0) {
    return { error: { code: "INVALID_PROMPT", message: "Prompt requests require at least one text or file part" } };
  }
  return {
    ...(body.messageID && /^msg_/.test(body.messageID) ? { id: body.messageID } : {}),
    text,
    ...(files.length > 0 ? { files } : {}),
  };
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

    // v2 void operations can answer 2xx with an empty body; treat that as a
    // successful no-payload result instead of a parse failure.
    const raw = await response.text();
    return (raw.length === 0 ? undefined : JSON.parse(raw)) as T;
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
 * Singleton OpenCode client for the v2 `/api/**` surface.
 *
 * Every method returns a `OpenCodeResult<T>` — callers should check
 * `isOpenCodeError(result)` before accessing the payload.
 *
 * Endpoints are covered by the OpenCode v2 contract tests.
 */
export const opencodeClient = {
  /* ── Health ── */

  /** GET /api/info [server.info] — v2 identity and readiness document. */
  health: async (): Promise<OpenCodeResult<OpenCodeHealth>> => {
    const result = await request<{ version?: string }>("/api/info");
    if (isOpenCodeError(result)) return result;
    return { healthy: true, version: result?.version };
  },

  /**
   * v2 has no arbitrary global-config patch: PATCH /api/experimental/config
   * [experimental.config.update] accepts `{ shell }` only. Provider
   * configuration is owned by integrations and credentials on v2, so this
   * fails closed instead of pretending a projection was applied.
   */
  updateGlobalConfig: (
    _config: Record<string, unknown>,
    _signal?: AbortSignal,
  ): Promise<OpenCodeResult<Record<string, unknown>>> =>
    Promise.resolve({
      error: {
        code: "OPENCODE_V2_CONFIG_PATCH_UNAVAILABLE",
        message: "OpenCode v2 does not accept an arbitrary global configuration patch",
      },
    }),

  /** POST /api/location/reload [location.reload] — rebuilds every loaded location. */
  disposeInstance: async (
    _directory?: string,
    signal?: AbortSignal,
  ): Promise<OpenCodeResult<boolean>> => {
    const result = await request<unknown>("/api/location/reload", {
      method: "POST",
      signal,
      sanitizedUpstreamError: PROVIDER_INSTANCE_DISPOSE_ERROR,
      safeProviderOperation: "provider_instance_dispose",
    });
    return isOpenCodeError(result) ? result : true;
  },

  /* ── Sessions ── */

  /** GET /api/session [session.list] — cursor-paginated, location-scoped listing. */
  listSessions: async (directory?: string): Promise<OpenCodeResult<SessionInfo[]>> => {
    const expectedDirectory = expectedOpenCodeDirectory(directory);
    const sessions: SessionInfo[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_V2_LIST_PAGES; page += 1) {
      const query: Record<string, string | number> = { limit: V2_PAGE_SIZE };
      if (expectedDirectory !== undefined) query.directory = expectedDirectory;
      if (cursor === undefined) query.order = "desc";
      else query.cursor = cursor;
      const result = await request<V2Page<V2SessionInfo>>("/api/session", { query });
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

  /** POST /api/session [session.create] — the directory travels as `location`. */
  createSession: async (
    body: CreateSessionBody,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> => {
    const location = directory ?? body.directory;
    const result = await v2Data<V2SessionInfo>("/api/session", {
      method: "POST",
      body: {
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(location ? { location: { directory: location } } : {}),
      },
    });
    if (isOpenCodeError(result)) return result;
    return validateV2Session(result, expectedOpenCodeDirectory(directory)) ? mapV2Session(result) : bindingError();
  },

  /** GET /api/session/{sessionID} [session.get]. */
  getSession: async (
    id: string,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> => {
    const result = await getV2Session(id, directory);
    return isOpenCodeError(result) ? result : mapV2Session(result);
  },

  /** PATCH /api/session/{sessionID} [session.update] — v2 returns no payload. */
  updateSession: async (
    id: string,
    body: UpdateSessionBody,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> => {
    const patched = await request<unknown>(`/api/session/${pathSegment(id)}`, {
      method: "PATCH",
      body: body.title === undefined ? {} : { title: body.title },
    });
    if (isOpenCodeError(patched)) return patched;
    const result = await getV2Session(id, directory);
    return isOpenCodeError(result) ? result : mapV2Session(result);
  },

  /** DELETE /api/session/{sessionID} [session.remove]. */
  deleteSession: async (
    id: string,
    _directory?: string,
  ): Promise<OpenCodeResult<boolean>> => {
    const result = await request<unknown>(`/api/session/${pathSegment(id)}`, { method: "DELETE" });
    return isOpenCodeError(result) ? result : true;
  },

  /* ── Session status ── */

  /**
   * GET /api/session/active [session.active] — v2 reports only the sessions
   * currently owned by this process, so every entry is busy and idle sessions
   * are simply absent.
   */
  getSessionStatus: async (_directory?: string): Promise<OpenCodeResult<SessionStatus[]>> => {
    const result = await v2Data<Record<string, { type?: string }>>("/api/session/active");
    if (isOpenCodeError(result)) return result;
    return Object.entries(result)
      .filter(([, status]) => status?.type === "running")
      .map(([sessionID]) => ({ type: "busy" as const, sessionID }));
  },

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

  /** GET /api/session/{sessionID}/message/{messageID} [session.message.get]. */
  getSessionMessage: async (
    sessionId: string,
    messageId: string,
    directory?: string,
  ): Promise<OpenCodeResult<MessageEnvelope>> => {
    const session = await getV2Session(sessionId, directory);
    if (isOpenCodeError(session)) return session;
    const result = await v2Data<V2ConversationMessage>(
      `/api/session/${pathSegment(session.id)}/message/${pathSegment(messageId)}`,
    );
    if (isOpenCodeError(result)) return result;
    return mapV2Message(result, sessionId) ?? {
      error: { code: "OPENCODE_V2_MESSAGE_TYPE_UNSUPPORTED", message: "OpenCode message type is not representable" },
    };
  },

  /**
   * POST /api/session/{sessionID}/prompt [session.prompt] — durable admission.
   *
   * The v2 body is `{ id?, text, files, agents, skills, metadata, delivery,
   * resume }`; it has no per-prompt model, agent, system, tools, or variant
   * fields. Model/agent/variant selections are applied to the session first
   * through the v2 switch endpoints, tool selections are owned by the selected
   * agent's permission rules, and a `system` instruction fails closed because
   * v2 session system prompts belong to agents.
   */
  sendPrompt: async (
    sessionId: string,
    body: SendPromptBody,
    directory?: string,
  ): Promise<OpenCodeResult<MessageEnvelope>> => {
    if (body.system !== undefined) {
      return {
        error: {
          code: "OPENCODE_V2_SYSTEM_PROMPT_UNAVAILABLE",
          message: "OpenCode v2 does not accept a per-prompt system instruction",
        },
      };
    }
    if (body.tools !== undefined && Object.keys(body.tools).length > 0) {
      return {
        error: {
          code: "OPENCODE_V2_TOOLS_UNAVAILABLE",
          message: "OpenCode v2 does not accept per-prompt tool selections",
        },
      };
    }
    const session = await getV2Session(sessionId, directory);
    if (isOpenCodeError(session)) return session;

    if (body.model) {
      const switched = await request<unknown>(`/api/session/${pathSegment(session.id)}/model`, {
        method: "POST",
        body: {
          model: {
            id: body.model.modelID,
            providerID: body.model.providerID,
            ...(body.variant ? { variant: body.variant } : {}),
          },
        },
      });
      if (isOpenCodeError(switched)) return switched;
    }
    if (body.agent) {
      const switched = await request<unknown>(`/api/session/${pathSegment(session.id)}/agent`, {
        method: "POST",
        body: { agent: body.agent },
      });
      if (isOpenCodeError(switched)) return switched;
    }

    const prompt = promptInputFromParts(body);
    if (isOpenCodeError(prompt)) return prompt;
    const admitted = await v2Data<{ id?: string; time?: { created?: number } }>(
      `/api/session/${pathSegment(session.id)}/prompt`,
      { method: "POST", body: prompt },
    );
    if (isOpenCodeError(admitted)) return admitted;
    return {
      info: {
        id: admitted.id ?? "",
        sessionID: sessionId,
        role: "user",
        time: { created: admitted.time?.created ?? Date.now() },
      },
      parts: [],
    };
  },

  /**
   * v2 has no message-delete route. The closest v2 operation is a revert
   * boundary [session.revert.stage/commit], which is a caller-level decision,
   * so this fails closed rather than deleting a neighbouring message.
   */
  deleteMessage: (
    _sessionId: string,
    _messageId: string,
    _directory?: string,
  ): Promise<OpenCodeResult<boolean>> =>
    Promise.resolve({
      error: {
        code: "OPENCODE_V2_MESSAGE_DELETE_UNAVAILABLE",
        message: "OpenCode v2 does not expose per-message deletion",
      },
    }),

  /* ── Session actions ── */

  /** POST /api/session/{sessionID}/interrupt [session.interrupt]. */
  abortSession: async (
    sessionId: string,
    directory?: string,
  ): Promise<OpenCodeResult<boolean>> => {
    const session = await getV2Session(sessionId, directory);
    if (isOpenCodeError(session)) return session;
    const result = await request<{ interrupted?: boolean }>(
      `/api/session/${pathSegment(session.id)}/interrupt`,
      { method: "POST" },
    );
    if (isOpenCodeError(result)) return result;
    return result.interrupted === true;
  },

  /** POST /api/session/{sessionID}/fork [session.fork] — v1 `messageID` is v2 `before`. */
  forkSession: async (
    sessionId: string,
    messageId?: string,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> => {
    const session = await getV2Session(sessionId, directory);
    if (isOpenCodeError(session)) return session;
    const result = await v2Data<V2SessionInfo>(`/api/session/${pathSegment(session.id)}/fork`, {
      method: "POST",
      body: messageId === undefined ? {} : { before: messageId },
    });
    if (isOpenCodeError(result)) return result;
    return validateV2Session(result, expectedOpenCodeDirectory(directory)) ? mapV2Session(result) : bindingError();
  },

  /** v2 has no session share surface; the v1 POST/DELETE /session/{id}/share paths were removed. */
  shareSession: async (
    _sessionId: string,
    _directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> => ({
    error: {
      code: "OPENCODE_V2_SHARE_UNAVAILABLE",
      message: "OpenCode v2 has no session share endpoint",
    },
  }),

  unshareSession: async (
    _sessionId: string,
    _directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> => ({
    error: {
      code: "OPENCODE_V2_SHARE_UNAVAILABLE",
      message: "OpenCode v2 has no session share endpoint",
    },
  }),

  /**
   * POST /api/session/{sessionID}/compact [session.compact]. v2 compaction has
   * no model field, so a requested provider/model pair is applied to the
   * session first; unlike v1 it then remains the session model.
   */
  compactSession: async (
    sessionId: string,
    body?: SummarizeBody,
    directory?: string,
  ): Promise<OpenCodeResult<boolean>> => {
    const session = await getV2Session(sessionId, directory);
    if (isOpenCodeError(session)) return session;
    if (body?.providerID && body.modelID) {
      const switched = await request<unknown>(`/api/session/${pathSegment(session.id)}/model`, {
        method: "POST",
        body: { model: { id: body.modelID, providerID: body.providerID } },
      });
      if (isOpenCodeError(switched)) return switched;
    }
    const result = await request<unknown>(`/api/session/${pathSegment(session.id)}/compact`, {
      method: "POST",
      body: {},
    });
    return isOpenCodeError(result) ? result : true;
  },

  /**
   * v1 revert maps to the v2 stage/commit pair [session.revert.stage,
   * session.revert.commit]: files are applied as v1 did, then the boundary is
   * committed. v2 stages at message granularity only, so `partID` fails closed.
   */
  revertSession: async (
    sessionId: string,
    body: RevertBody,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> => {
    if (body.partID !== undefined) {
      return {
        error: {
          code: "OPENCODE_V2_PART_REVERT_UNAVAILABLE",
          message: "OpenCode v2 does not support part-level revert",
        },
      };
    }
    const session = await getV2Session(sessionId, directory);
    if (isOpenCodeError(session)) return session;
    const staged = await request<unknown>(`/api/session/${pathSegment(session.id)}/revert/stage`, {
      method: "POST",
      body: { messageID: body.messageID, files: true },
    });
    if (isOpenCodeError(staged)) return staged;
    const committed = await request<unknown>(`/api/session/${pathSegment(session.id)}/revert/commit`, {
      method: "POST",
    });
    if (isOpenCodeError(committed)) return committed;
    const result = await getV2Session(session.id, directory);
    return isOpenCodeError(result) ? result : mapV2Session(result);
  },

  /** DELETE /api/session/{sessionID}/revert [session.revert.clear]. */
  unrevertSession: async (
    sessionId: string,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> => {
    const session = await getV2Session(sessionId, directory);
    if (isOpenCodeError(session)) return session;
    const cleared = await request<unknown>(`/api/session/${pathSegment(session.id)}/revert`, {
      method: "DELETE",
    });
    if (isOpenCodeError(cleared)) return cleared;
    const result = await getV2Session(session.id, directory);
    return isOpenCodeError(result) ? result : mapV2Session(result);
  },

  /** GET /api/session?parentID=... [session.list] — the v1 /children path is gone. */
  getSessionChildren: async (
    sessionId: string,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo[]>> => {
    const expectedDirectory = expectedOpenCodeDirectory(directory);
    const query: Record<string, string | number> = { parentID: sessionId };
    if (expectedDirectory !== undefined) query.directory = expectedDirectory;
    const result = await request<V2Page<V2SessionInfo>>("/api/session", { query });
    if (isOpenCodeError(result)) return result;
    if (!Array.isArray(result.data)) return v2Error(result, "OPENCODE_V2_INVALID_RESPONSE");
    const children: SessionInfo[] = [];
    for (const child of result.data) {
      if (child.parentID !== sessionId) continue;
      if (!validateV2Session(child, expectedDirectory)) return bindingError();
      children.push(mapV2Session(child));
    }
    return children;
  },

  /** GET /api/session/{sessionID}/diff [session.diff] — v1 `messageID` is v2 `from`. */
  getSessionDiff: async (
    sessionId: string,
    messageId?: string,
    directory?: string,
  ): Promise<OpenCodeResult<unknown>> => {
    const session = await getV2Session(sessionId, directory);
    if (isOpenCodeError(session)) return session;
    const query: Record<string, string | number> = {};
    if (messageId !== undefined) query.from = messageId;
    return v2Data<unknown>(`/api/session/${pathSegment(session.id)}/diff`, { query });
  },

  /** POST /api/session/{sessionID}/command [session.command]. */
  sendCommand: async (
    sessionId: string,
    body: CommandBody,
    directory?: string,
  ): Promise<OpenCodeResult<unknown>> => {
    const session = await getV2Session(sessionId, directory);
    if (isOpenCodeError(session)) return session;
    const args = body.args ?? body.arguments ?? [];
    const result = await request<unknown>(`/api/session/${pathSegment(session.id)}/command`, {
      method: "POST",
      body: { name: body.command, text: args.join(" ") },
    });
    return isOpenCodeError(result) ? result : true;
  },

  /** v2 has no session init route; the v1 POST /session/{id}/init path was removed. */
  initSession: async (
    _sessionId: string,
    _directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> => ({
    error: {
      code: "OPENCODE_V2_SESSION_INIT_UNAVAILABLE",
      message: "OpenCode v2 has no session init endpoint",
    },
  }),

  /* ── Providers ── */

  /**
   * The v2 catalog is split: GET /api/provider [provider.list] returns provider
   * metadata without models, and GET /api/model [model.list] carries the model
   * snapshot. This method recomposes the retained `ProvidersResponse` DTO for
   * existing callers; `connected` reflects each provider's activation state
   * because v2 no longer reports an auth-derived connection list here.
   */
  listProviders: async (_directory?: string): Promise<OpenCodeResult<ProvidersResponse>> => {
    const providersResult = await v2Data<V2ProviderInfo[]>("/api/provider", {
      // Provider errors commonly contain opaque vendor diagnostics. This
      // catalog is browser-facing, so no upstream code or message may escape.
      sanitizedUpstreamError: PROVIDER_CATALOG_ERROR,
    });
    if (isOpenCodeError(providersResult)) return providersResult;
    const modelsResult = await v2Data<V2ModelInfo[]>("/api/model", {
      sanitizedUpstreamError: PROVIDER_CATALOG_ERROR,
    });
    if (isOpenCodeError(modelsResult)) return modelsResult;
    const defaultResult = await v2Data<V2ModelInfo | null>("/api/model/default", {
      sanitizedUpstreamError: PROVIDER_CATALOG_ERROR,
    });
    if (isOpenCodeError(defaultResult)) return defaultResult;

    const modelsByProvider = new Map<string, Record<string, ProviderModel>>();
    for (const model of modelsResult) {
      if (typeof model?.providerID !== "string" || typeof model.modelID !== "string") continue;
      const cost = Array.isArray(model.cost) ? model.cost[0] : undefined;
      const providerModels = modelsByProvider.get(model.providerID) ?? {};
      providerModels[model.modelID] = {
        id: model.modelID,
        providerID: model.providerID,
        api: { id: model.providerID, url: "", npm: "" },
        name: model.name,
        capabilities: model.capabilities ?? {},
        cost: {
          input: cost?.input ?? 0,
          output: cost?.output ?? 0,
          cache: { read: cost?.cache?.read ?? 0, write: cost?.cache?.write ?? 0 },
        },
        limit: { context: model.limit?.context ?? 0, output: model.limit?.output ?? 0 },
        status: model.status,
        options: model.settings ?? {},
        headers: model.headers ?? {},
        release_date: model.time?.released === undefined ? "" : String(model.time.released),
        variants: {},
      };
      modelsByProvider.set(model.providerID, providerModels);
    }

    return {
      all: providersResult.map((provider) => ({
        id: provider.id,
        name: provider.name,
        source: provider.package ?? "",
        env: [],
        options: provider.settings ?? {},
        models: modelsByProvider.get(provider.id) ?? {},
      })),
      default: defaultResult ? { [defaultResult.providerID]: defaultResult.modelID } : {},
      connected: providersResult
        .filter((provider) => provider.activation !== "disabled")
        .map((provider) => provider.id),
    };
  },

  /** GET /api/integration [integration.list]. */
  listIntegrations: (_directory?: string): Promise<OpenCodeResult<V2Response<IntegrationInfo[]>>> =>
    request<V2Response<IntegrationInfo[]>>("/api/integration"),

  /** POST /api/integration/{integrationID}/connect/key [integration.connect.key]. */
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

  /**
   * POST /api/integration/{integrationID}/connect/oauth [integration.oauth.connect].
   * The v1 `inputs` map is submitted as the v2 form `answer`.
   */
  beginIntegrationOAuth: (
    integrationID: string,
    methodID: string,
    inputs: Record<string, string>,
  ): Promise<OpenCodeResult<V2Response<IntegrationAttempt>>> =>
    request<V2Response<IntegrationAttempt>>(`/api/integration/${pathSegment(integrationID)}/connect/oauth`, {
      method: "POST",
      body: { methodID, answer: inputs },
    }),

  /**
   * OAuth attempts are nested under their integration on v2, so the owning
   * integration ID is required. Callers that predate that nesting receive a
   * typed error rather than a path that cannot resolve.
   */
  getIntegrationAttempt: (
    attemptID: string,
    integrationID?: string,
  ): Promise<OpenCodeResult<V2Response<{ status: string; message?: string }>>> =>
    integrationID
      ? request<V2Response<{ status: string; message?: string }>>(
        `/api/integration/${pathSegment(integrationID)}/connect/oauth/${pathSegment(attemptID)}`,
      )
      : Promise.resolve({ error: { ...INTEGRATION_ID_REQUIRED_ERROR } }),

  completeIntegrationAttempt: async (
    attemptID: string,
    code?: string,
    integrationID?: string,
  ): Promise<OpenCodeResult<string>> => {
    if (!integrationID) return { error: { ...INTEGRATION_ID_REQUIRED_ERROR } };
    const result = await request<unknown>(
      `/api/integration/${pathSegment(integrationID)}/connect/oauth/${pathSegment(attemptID)}/complete`,
      { method: "POST", body: { code: code ?? null } },
    );
    return isOpenCodeError(result) ? result : "complete";
  },

  cancelIntegrationAttempt: async (
    attemptID: string,
    integrationID?: string,
  ): Promise<OpenCodeResult<string>> => {
    if (!integrationID) return { error: { ...INTEGRATION_ID_REQUIRED_ERROR } };
    const result = await request<unknown>(
      `/api/integration/${pathSegment(integrationID)}/connect/oauth/${pathSegment(attemptID)}`,
      { method: "DELETE" },
    );
    return isOpenCodeError(result) ? result : "cancelled";
  },

  /* ── Auth ── */

  /**
   * v2 stores provider credentials as integration connections, so an API-key
   * apply maps to POST /api/integration/{providerID}/connect/key. Other v1
   * auth types (well-known, OAuth) are separate v2 flows and fail closed here.
   */
  addAuth: (
    providerID: string,
    body: AuthRequestBody,
    _directory?: string,
    signal?: AbortSignal,
  ): Promise<OpenCodeResult<unknown>> => {
    if (body.type !== "api" || typeof body.key !== "string" || body.key.length === 0) {
      return Promise.resolve({
        error: {
          code: "OPENCODE_V2_AUTH_TYPE_UNAVAILABLE",
          message: "OpenCode v2 stores API-key credentials through integration key connections",
        },
      });
    }
    return request<unknown>(`/api/integration/${pathSegment(providerID)}/connect/key`, {
      method: "POST",
      body: { key: body.key },
      signal,
      sanitizedUpstreamError: PROVIDER_AUTH_APPLY_ERROR,
      safeProviderOperation: "provider_auth_apply",
    });
  },

  /**
   * v2 removes stored credentials by credential ID, so this resolves the
   * provider's credential connections first. A provider with no credential
   * connection is already disconnected and resolves successfully.
   */
  deleteAuth: async (
    providerID: string,
    _directory?: string,
    signal?: AbortSignal,
  ): Promise<OpenCodeResult<unknown>> => {
    const integrations = await v2Data<V2IntegrationInfo[]>("/api/integration", {
      signal,
      sanitizedUpstreamError: PROVIDER_AUTH_REMOVE_ERROR,
      safeProviderOperation: "provider_auth_remove",
    });
    if (isOpenCodeError(integrations)) return integrations;
    const integration = integrations.find((candidate) => candidate.id === providerID);
    const credentials = (integration?.connections ?? []).filter(
      (connection): connection is { type: string; id: string } =>
        connection.type === "credential" && typeof connection.id === "string",
    );
    if (credentials.length === 0) return true;
    for (const credential of credentials) {
      const removed = await request<unknown>(`/api/credential/${pathSegment(credential.id)}`, {
        method: "DELETE",
        signal,
        sanitizedUpstreamError: PROVIDER_AUTH_REMOVE_ERROR,
        safeProviderOperation: "provider_auth_remove",
      });
      if (isOpenCodeError(removed)) return removed;
    }
    return true;
  },

  getAuthStatus: async (
    _directory?: string,
    signal?: AbortSignal,
  ): Promise<OpenCodeResult<AuthStatusResponse>> => {
    const result = await request<V2Response<IntegrationInfo[]>>("/api/integration", {
      signal,
      sanitizedUpstreamError: PROVIDER_AUTH_STATUS_ERROR,
      safeProviderOperation: "provider_auth_status",
    });
    if (isOpenCodeError(result)) return result;
    return {
      providers: result.data.map((integration) => {
        const connections = Array.isArray(integration.connections) ? integration.connections : [];
        return {
          providerId: integration.id,
          name: integration.name,
          connected: connections.length > 0,
          keySet: connections.some((connection) => connection.type === "credential"),
        };
      }),
    };
  },

  /* ── Agents ── */

  /** GET /api/agent [agent.list] — v2 agents expose `permissions`, not `permission`. */
  listAgents: async (): Promise<OpenCodeResult<AgentInfo[]>> => {
    const result = await v2Data<V2AgentInfo[]>("/api/agent");
    if (isOpenCodeError(result)) return result;
    return result.map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description ?? "",
      mode: agent.mode,
      hidden: agent.hidden === true,
      permission: Array.isArray(agent.permissions)
        ? agent.permissions.map((rule) => ({ permission: rule.action, pattern: rule.resource, action: rule.effect }))
        : [],
      options: {},
    }));
  },

   /* ── Skills (GET /api/skill works, but we DO NOT proxy it — skills are
         managed by the Ingenium skill system, not OpenCode) ── */

  listSkills: async (): Promise<OpenCodeResult<SkillInfo[]>> => {
    const result = await v2Data<V2SkillInfo[]>("/api/skill");
    if (isOpenCodeError(result)) return result;
    return result.map((skill) => ({
      name: skill.name,
      description: skill.description ?? "",
      location: skill.path,
      content: skill.content,
    }));
  },

  /* ── MCP ── */

  /** GET /api/mcp [mcp.list] — v2 returns a server array; the route contract is keyed by name. */
  getMCPStatus: async (_directory?: string): Promise<OpenCodeResult<Record<string, McpServerInfo>>> => {
    const result = await v2Data<V2McpServer[]>("/api/mcp", {
      sanitizedUpstreamError: { code: "MCP_STATUS_FAILED", message: "OpenCode request failed" },
    });
    if (isOpenCodeError(result)) return result;
    const servers: Record<string, McpServerInfo> = {};
    for (const server of result) {
      if (typeof server?.name !== "string" || server.name.length === 0) continue;
      const status = normalizeMcpConnectionStatus(server.status?.status);
      servers[server.name] = {
        name: server.name,
        ...(status === undefined ? {} : { status }),
        ...(typeof server.status?.error === "string" ? { error: server.status.error } : {}),
      };
    }
    return servers;
  },

  /** POST /api/experimental/mcp/{server}/connect [experimental.mcp.connect]. */
  connectMCP: (name: string): Promise<OpenCodeResult<unknown>> =>
    request<unknown>(`/api/experimental/mcp/${pathSegment(name)}/connect`, {
      method: "POST",
      sanitizedUpstreamError: { code: "MCP_MUTATION_FAILED", message: "OpenCode request failed" },
    }),

  /** POST /api/experimental/mcp/{server}/disconnect [experimental.mcp.disconnect]. */
  disconnectMCP: (name: string): Promise<OpenCodeResult<unknown>> =>
    request<unknown>(`/api/experimental/mcp/${pathSegment(name)}/disconnect`, {
      method: "POST",
      sanitizedUpstreamError: { code: "MCP_MUTATION_FAILED", message: "OpenCode request failed" },
    }),

  /* ── Permissions ── */

  /** GET /api/permission/request [permission.request.list]. */
  getPermissions: async (_directory?: string): Promise<OpenCodeResult<PermissionRequest[]>> => {
    const result = await v2Data<V2PermissionRequest[]>("/api/permission/request");
    if (isOpenCodeError(result)) return result;
    return result.map((request) => ({
      id: request.id,
      permission: request.action,
      pattern: Array.isArray(request.resources) ? request.resources.join("\n") : "",
      action: request.action,
      sessionID: request.sessionID,
    }));
  },

  /**
   * Reply to a session-scoped permission request.
   * POST /api/session/{sessionID}/permission/{requestID}/reply
   * [session.permission.reply]; v2 names the decision field `decision`.
   */
  replyPermission: (
    sessionId: string,
    permissionId: string,
    body: PermissionReplyBody,
    _directory?: string,
  ): Promise<OpenCodeResult<unknown>> =>
    request<unknown>(`/api/session/${pathSegment(sessionId)}/permission/${pathSegment(permissionId)}/reply`, {
      method: "POST",
      body: { decision: body.response },
    }),

  /* ── Questions ── */

  /**
   * v2 replaced the v1 question queue with forms. GET /api/form [form.list]
   * returns pending forms for the location; the retained question contract is
   * projected from each form's id and title.
   */
  getQuestions: async (_directory?: string): Promise<OpenCodeResult<QuestionInfo[]>> => {
    const result = await v2Data<V2FormInfo[]>("/api/form");
    if (isOpenCodeError(result)) return result;
    return result.map((form) => ({ id: form.id, text: form.title, sessionID: form.sessionID }));
  },

  /* ── SSE ── */

  /**
   * GET /api/event [event.subscribe]. v2 streams native events across every
   * location and accepts no `session`/`directory` query filters, so subscribers
   * receive the full stream and filter by `properties.sessionID` themselves
   * (the dashboard already does this).
   */
  streamEvents: (
    _sessionId?: string,
    _directory?: string,
    lastEventId?: string,
  ): Promise<ReadableStream<Uint8Array> | OpenCodeErrorShape> =>
    streamRequest(
      "/api/event",
      undefined,
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
