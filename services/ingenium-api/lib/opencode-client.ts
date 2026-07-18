import { logger } from "ingenium-core";
import { config } from "../config/index.js";

/**
 * Server-side typed HTTP client for the OpenCode v1.18.3 REST API.
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
 * 🔴 Verified against: OpenCode v1.18.3 contract (see /tmp/opencode-contract.md)
 */

/* ── Types ── */

export interface OpenCodeErrorShape {
  error: {
    message: string;
    code: string;
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

/** Shape for prompt send request body (v1.18.3 contract) */
export interface SendPromptBody {
  parts: Array<TextPartInput | FilePartInput>;
  model?: { providerID: string; modelID: string };
  agent?: string;
  system?: string;
  tools?: Record<string, boolean>;
  variant?: string;
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

/* ── Message shape (v1.18.3 contract) ── */

export interface MessageInfo {
  id: string;
  sessionID: string;
  role: "user" | "assistant";
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

/* ── Session shape (v1.18.3 contract) ── */

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

/* ── Provider shape (v1.18.3 contract) ── */

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

export interface AuthProviderEntry {
  type: string;
  key?: string;
  access?: string;
  refresh?: string;
  metadata?: Record<string, unknown>;
}

export type AuthStatusResponse = Record<string, AuthProviderEntry>;

/* ── Agent shape (v1.18.3 contract) ── */

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

/* ── Skill shape (v1.18.3 contract) ── */

export interface SkillInfo {
  name: string;
  description: string;
  location: string;
  content: string;
}

/* ── MCP Server shape ── */

export interface McpServerInfo {
  name: string;
  connected?: boolean;
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

/* ── Helpers ── */

/**
 * Build a Basic auth header value from the configured password.
 * Uses "opencode" as the username per the v1.18.3 contract:
 *   Authorization: Basic base64("opencode:<PASSWORD>")
 *
 * Returns `null` if OPENCODE_SERVER_PASSWORD is not set — callers
 * should validate this before issuing requests.
 */
/** @internal — exported for testing */
export function buildAuthHeader(): string | null {
  const password = process.env.OPENCODE_SERVER_PASSWORD;
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
  } = {},
): Promise<OpenCodeResult<T>> {
  const auth = buildAuthHeader();
  if (!auth) {
    return {
      error: {
        message: "OPENCODE_SERVER_PASSWORD is not configured",
        code: "AUTH_NOT_CONFIGURED",
      },
    };
  }

  const { method = "GET", body, query } = opts;

  // Build URL with query params
  let url = `${config.opencodeUrl}${path}`;
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

  const headers: Record<string, string> = {
    Authorization: auth,
    Accept: "application/json",
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    logger.debug(SOURCE, `${method} ${url}`, {
      headers: redactHeaders(headers),
      bodyLen: body ? JSON.stringify(body).length : 0,
    });

    const response = await fetch(url, init);
    const contentType = response.headers.get("content-type") ?? "";

    if (!response.ok) {
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

      logger.warn(SOURCE, `OpenCode ${response.status} for ${method} ${path}`, {
        status: response.status,
        code: errCode,
      });

      return { error: { message: errMsg, code: errCode } };
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

    // AbortError is thrown when we cancel a streaming request — re-throw
    // so the caller can distinguish cancellation from a real error.
    if (e.name === "AbortError") {
      throw err;
    }

    logger.error(SOURCE, `Fetch failed for ${method} ${path}: ${e.message}`, {
      name: e.name,
      code: e.name === "TypeError" ? (e as any).code : undefined,
    });

    return {
      error: {
        message: e.message ?? "Network error contacting OpenCode server",
        code: "NETWORK_ERROR",
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
  const auth = buildAuthHeader();
  if (!auth) {
    return {
      error: {
        message: "OPENCODE_SERVER_PASSWORD is not configured",
        code: "AUTH_NOT_CONFIGURED",
      },
    };
  }

  let url = `${config.opencodeUrl}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  try {
    const headers: Record<string, string> = {
      Authorization: auth,
      Accept: "text/event-stream",
      ...extraHeaders,
    };
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
 * Singleton OpenCode API client for v1.18.3.
 *
 * Every method returns a `OpenCodeResult<T>` — callers should check
 * `isOpenCodeError(result)` before accessing the payload.
 *
 * Endpoints verified against the v1.18.3 contract at /tmp/opencode-contract.md.
 */
export const opencodeClient = {
  /* ── Health ── */

  health: (): Promise<OpenCodeResult<OpenCodeHealth>> =>
    request<OpenCodeHealth>("/global/health"),

  /* ── Sessions ── */

  listSessions: (directory?: string): Promise<OpenCodeResult<SessionInfo[]>> =>
    request<SessionInfo[]>("/session", { query: { directory } }),

  createSession: (
    body: CreateSessionBody,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> =>
    request<SessionInfo>("/session", {
      method: "POST",
      body,
      query: { directory },
    }),

  getSession: (
    id: string,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> =>
    request<SessionInfo>(`/session/${id}`, { query: { directory } }),

  updateSession: (
    id: string,
    body: UpdateSessionBody,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> =>
    request<SessionInfo>(`/session/${id}`, {
      method: "PATCH",
      body,
      query: { directory },
    }),

  deleteSession: (
    id: string,
    directory?: string,
  ): Promise<OpenCodeResult<boolean>> =>
    request<boolean>(`/session/${id}`, {
      method: "DELETE",
      query: { directory },
    }),

  /* ── Session status ── */

  getSessionStatus: (directory?: string): Promise<OpenCodeResult<SessionStatus[]>> =>
    request<SessionStatus[]>("/session/status", { query: { directory } }),

  /* ── Messages ── */

  getMessages: (
    sessionId: string,
    limit?: number,
    before?: string,
    directory?: string,
  ): Promise<OpenCodeResult<MessageEnvelope[]>> =>
    request<MessageEnvelope[]>(`/session/${sessionId}/message`, {
      query: { limit, before, directory },
    }),

  getSessionMessage: (
    sessionId: string,
    messageId: string,
    directory?: string,
  ): Promise<OpenCodeResult<MessageEnvelope>> =>
    request<MessageEnvelope>(`/session/${sessionId}/message/${messageId}`, {
      query: { directory },
    }),

  sendPrompt: (
    sessionId: string,
    body: SendPromptBody,
    directory?: string,
  ): Promise<OpenCodeResult<MessageEnvelope>> =>
    request<MessageEnvelope>(`/session/${sessionId}/message`, {
      method: "POST",
      body,
      query: { directory },
    }),

  deleteMessage: (
    sessionId: string,
    messageId: string,
    directory?: string,
  ): Promise<OpenCodeResult<boolean>> =>
    request<boolean>(`/session/${sessionId}/message/${messageId}`, {
      method: "DELETE",
      query: { directory },
    }),

  /* ── Session actions ── */

  abortSession: (
    sessionId: string,
    directory?: string,
  ): Promise<OpenCodeResult<boolean>> =>
    request<boolean>(`/session/${sessionId}/abort`, {
      method: "POST",
      query: { directory },
    }),

  forkSession: (
    sessionId: string,
    messageId?: string,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> =>
    request<SessionInfo>(`/session/${sessionId}/fork`, {
      method: "POST",
      body: messageId ? ({ messageID: messageId } satisfies ForkBody) : undefined,
      query: { directory },
    }),

  shareSession: (
    sessionId: string,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> =>
    request<SessionInfo>(`/session/${sessionId}/share`, {
      method: "POST",
      query: { directory },
    }),

  unshareSession: (
    sessionId: string,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> =>
    request<SessionInfo>(`/session/${sessionId}/share`, {
      method: "DELETE",
      query: { directory },
    }),

  compactSession: (
    sessionId: string,
    body?: SummarizeBody,
    directory?: string,
  ): Promise<OpenCodeResult<boolean>> =>
    request<boolean>(`/session/${sessionId}/summarize`, {
      method: "POST",
      body,
      query: { directory },
    }),

  revertSession: (
    sessionId: string,
    body: RevertBody,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> =>
    request<SessionInfo>(`/session/${sessionId}/revert`, {
      method: "POST",
      body,
      query: { directory },
    }),

  unrevertSession: (
    sessionId: string,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> =>
    request<SessionInfo>(`/session/${sessionId}/unrevert`, {
      method: "POST",
      body: {},
      query: { directory },
    }),

  getSessionChildren: (
    sessionId: string,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo[]>> =>
    request<SessionInfo[]>(`/session/${sessionId}/children`, {
      query: { directory },
    }),

  getSessionDiff: (
    sessionId: string,
    messageId?: string,
    directory?: string,
  ): Promise<OpenCodeResult<unknown>> =>
    request<unknown>(`/session/${sessionId}/diff`, {
      query: { messageID: messageId, directory },
    }),

  sendCommand: (
    sessionId: string,
    body: CommandBody,
    directory?: string,
  ): Promise<OpenCodeResult<unknown>> =>
    request<unknown>(`/session/${sessionId}/command`, {
      method: "POST",
      body,
      query: { directory },
    }),

  initSession: (
    sessionId: string,
    directory?: string,
  ): Promise<OpenCodeResult<SessionInfo>> =>
    request<SessionInfo>(`/session/${sessionId}/init`, {
      method: "POST",
      body: {},
      query: { directory },
    }),

  /* ── Providers ── */

  listProviders: (directory?: string): Promise<OpenCodeResult<ProvidersResponse>> =>
    request<ProvidersResponse>("/provider", { query: { directory } }),

  /* ── Auth ── */

  addAuth: (
    providerID: string,
    body: AuthRequestBody,
    directory?: string,
  ): Promise<OpenCodeResult<unknown>> =>
    request<unknown>(`/auth/${providerID}`, {
      method: "POST",
      body,
      query: { directory },
    }),

  deleteAuth: (
    providerID: string,
    directory?: string,
  ): Promise<OpenCodeResult<unknown>> =>
    request<unknown>(`/auth/${providerID}`, {
      method: "DELETE",
      query: { directory },
    }),

  getAuthStatus: (directory?: string): Promise<OpenCodeResult<AuthStatusResponse>> =>
    request<AuthStatusResponse>("/auth", { query: { directory } }),

  /* ── Agents ── */

  listAgents: (): Promise<OpenCodeResult<AgentInfo[]>> =>
    request<AgentInfo[]>("/agent"),

  /* ── Skills (v1.18.3: GET /skill works, but we DO NOT proxy it — skills are
         managed by the Ingenium skill system, not OpenCode) ── */

  listSkills: (): Promise<OpenCodeResult<SkillInfo[]>> =>
    request<SkillInfo[]>("/skill"),

  /* ── MCP ── */

  getMCPStatus: (directory?: string): Promise<OpenCodeResult<Record<string, McpServerInfo>>> =>
    request<Record<string, McpServerInfo>>("/mcp", { query: { directory } }),

  connectMCP: (name: string): Promise<OpenCodeResult<unknown>> =>
    request<unknown>(`/mcp/${encodeURIComponent(name)}/connect`, {
      method: "POST",
    }),

  disconnectMCP: (name: string): Promise<OpenCodeResult<unknown>> =>
    request<unknown>(`/mcp/${encodeURIComponent(name)}/disconnect`, {
      method: "POST",
    }),

  /* ── Permissions ── */

  /**
   * Get pending permission requests (global).
   * v1.18.3 contract: GET /permission returns array of PermissionRequest objects.
   */
  getPermissions: (directory?: string): Promise<OpenCodeResult<PermissionRequest[]>> =>
    request<PermissionRequest[]>("/permission", { query: { directory } }),

  /**
   * Reply to a session-scoped permission request.
   * v1.18.3 contract: POST /session/{sessionId}/permissions/{permissionId}
   *   body: { "response": "once" | "always" | "reject" }
   */
  replyPermission: (
    sessionId: string,
    permissionId: string,
    body: PermissionReplyBody,
    directory?: string,
  ): Promise<OpenCodeResult<unknown>> =>
    request<unknown>(`/session/${sessionId}/permissions/${permissionId}`, {
      method: "POST",
      body,
      query: { directory },
    }),

  /* ── Questions ── */

  /**
   * Get pending questions (global).
   * v1.18.3 contract: GET /question returns array of QuestionInfo objects.
   * Note: Questions also arrive via SSE events and message parts.
   */
  getQuestions: (directory?: string): Promise<OpenCodeResult<QuestionInfo[]>> =>
    request<QuestionInfo[]>("/question", { query: { directory } }),

  /* ── SSE ── */

  /**
   * Returns a ReadableStream piping SSE events from the OpenCode /event endpoint.
   * v1.18.3 contract: GET /event?session={id} for filtered, or /event?directory=/workspace.
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
 * Execute an LLM request through an ephemeral, tool-denied OpenCode session.
 */
export async function brokerExecute(params: {
  providerID: string;
  modelID: string;
  system: string;
  user: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; content: string; error?: string }> {
  const source = "opencode-broker";
  const timeoutMs = Math.min(Math.max(params.timeoutMs ?? 30_000, 0), 30_000);
  const created = await opencodeClient.createSession({ title: "ingenium-llm-broker" });

  if (isOpenCodeError(created)) {
    logger.warn(source, "Failed to create broker session", {
      code: created.error.code,
    });
    return { ok: false, content: "", error: created.error.message };
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
      system: params.system,
      tools: {},
    });

    if (isOpenCodeError(sent)) {
      logger.warn(source, `Failed to send prompt for broker session ${sessionId}`, {
        code: sent.error.code,
      });
      return { ok: false, content: "", error: sent.error.message };
    }

    const deadline = Date.now() + timeoutMs;
    let delayMs = 500;

    while (Date.now() <= deadline) {
      const messages = await opencodeClient.getMessages(sessionId);
      if (isOpenCodeError(messages)) {
        logger.warn(source, `Failed to poll broker session ${sessionId}`, {
          code: messages.error.code,
        });
        return { ok: false, content: "", error: messages.error.message };
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

    logger.warn(source, `Broker session ${sessionId} timed out`, { timeoutMs });
    return { ok: false, content: "", error: "timeout" };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : "Broker execution failed";
    logger.error(source, `Broker session ${sessionId} failed: ${error}`);
    return { ok: false, content: "", error };
  } finally {
    const deleted = await opencodeClient.deleteSession(sessionId);
    if (isOpenCodeError(deleted)) {
      logger.warn(source, `Failed to delete broker session ${sessionId}`, {
        code: deleted.error.code,
      });
    }
  }
}
