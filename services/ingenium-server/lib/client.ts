/**
 * The single HTTP client that ALL MCP tools use to talk to the Ingenium API.
 *
 * Features:
 * - Retry safe/idempotent requests and API-keyed mutations with jittered backoff
 * - AbortSignal request timeouts (prevents hung MCP tool handlers)
 * - Status-based retry on 5xx only — 4xx errors are NOT retried (client errors are fatal)
 * - JSON body serialization, query param construction
 *
 * Retry design rationale:
 * - Eligible 5xx retries use a short jitter window (50-150ms) because these are typically
 *   transient API server blips (connection pool exhaustion, brief DB lock).
 * - Eligible network errors (DNS, ECONNREFUSED, timeout) use a longer window (100-300ms)
 *   because they often indicate scheduling-level issues that need a moment to resolve.
 * - 4xx is never retried: a 400/404/409 means the request itself is wrong, and
 *   retrying will produce the same result.
 *
 * DB isolation: Does NOT import ingenium-core or any SQLite library — all data goes through HTTP.
 */
import { apiRequestHeaders, config } from "../config/index.js";

/** Maximum retry attempts per request before giving up. */
const MAX_RETRIES = 3;
/** Per-request timeout in milliseconds (from config — defaults to 10s). */
const TIMEOUT_MS = config.apiTimeout;
const RETRYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);
const MAX_API_ERROR_BODY_BYTES = 8 * 1024;
const MAX_API_ERROR_CODE_LENGTH = 64;
const MAX_API_ERROR_MESSAGE_BYTES = 256;

/**
 * Deliberately outside the dashboard's `/api/v1` rewrite namespace. The value
 * is an API/service contract, not a credential; the bearer header remains the
 * authentication boundary.
 */
export const CHILD_MCP_RUNTIME_HANDOFF_PATH = "/_ingenium/child-mcp-runtime";
export const CHILD_MCP_RUNTIME_HANDOFF_HEADER = "x-ingenium-child-mcp-runtime";
const CHILD_MCP_RUNTIME_HANDOFF_VALUE = "1";

/** Internal options for the fetch wrapper. Not exported — consumers use the typed `api` object. */
export type QueryParameterValue = string | readonly string[];

export interface ApiSuccessResponse {
  status: number;
  data: any;
}

export interface ApiSettledResponse extends ApiSuccessResponse {
  ok: boolean;
  payload: unknown;
}

export interface ApiSettledRawResponse {
  ok: boolean;
  status: number;
  response: Response;
}

interface RequestOptions {
  method: string;
  body?: unknown;
  octetBody?: Uint8Array;
  contentType?: string;
  params?: Record<string, QueryParameterValue | undefined>;
  idempotencyKey?: string;
  /** Use only for the fixed child-MCP server-to-server secret handoff. */
  trustedChildMcpRuntime?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedStatus(status: unknown): number {
  return typeof status === "number"
    && Number.isSafeInteger(status)
    && status >= 100
    && status <= 599
    ? status
    : 502;
}

function fallbackErrorMessage(_status: number): string {
  return "The API request failed.";
}

function sanitizedErrorCode(value: unknown): string {
  return typeof value === "string"
    && value.length <= MAX_API_ERROR_CODE_LENGTH
    && /^[A-Z][A-Z0-9_]*$/.test(value)
    ? value
    : "API_REQUEST_FAILED";
}

function sanitizedErrorMessage(value: unknown, status: number): string {
  if (typeof value !== "string"
    || value.length === 0
    || /[\u0000-\u001f\u007f\\/]/.test(value)
    || /\b(?:authorization|bearer|token|secret|password|api[_ -]?key|stack|trace)\b/i.test(value)) {
    return fallbackErrorMessage(status);
  }
  const message = value.trim().replace(/\s+/g, " ");
  return message.length > 0 && Buffer.byteLength(message, "utf8") <= MAX_API_ERROR_MESSAGE_BYTES
    ? message
    : fallbackErrorMessage(status);
}

/** A bounded API response failure with no upstream body, details, or request metadata. */
export class ApiHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: unknown, code: unknown, message: unknown) {
    const safeStatus = normalizedStatus(status);
    super(sanitizedErrorMessage(message, safeStatus));
    this.name = "ApiHttpError";
    this.status = safeStatus;
    this.code = sanitizedErrorCode(code);
  }
}

/** A fixed boundary error for exhausted API network and timeout failures. */
export class ApiUnavailableError extends Error {
  readonly code = "API_UNAVAILABLE";

  constructor() {
    super("The API is unavailable.");
    this.name = "ApiUnavailableError";
  }
}

function declaredErrorBodyExceedsLimit(response: Response): boolean {
  const headers = (response as { headers?: Headers }).headers;
  const contentLength = headers?.get("content-length");
  if (typeof contentLength !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(contentLength)) return false;
  const length = Number(contentLength);
  return !Number.isSafeInteger(length) || length >= MAX_API_ERROR_BODY_BYTES;
}

async function cancelResponseBody(
  response: Response,
  reader?: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    if (reader) await reader.cancel();
    else await response.body?.cancel();
  } catch {}
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const candidate = response as Response & {
    text?: () => Promise<string>;
    json?: () => Promise<unknown>;
  };
  try {
    if (typeof candidate.text === "function") {
      const text = await candidate.text();
      if (text.trim().length === 0) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }
    if (typeof candidate.json === "function") {
      return await candidate.json();
    }
  } catch {
    // A malformed or interrupted body is never included in an MCP response.
  }
  return null;
}

async function parseBoundedErrorResponse(response: Response): Promise<unknown> {
  if (declaredErrorBodyExceedsLimit(response)) {
    await cancelResponseBody(response);
    return null;
  }

  const body = response.body;
  if (!body) return null;

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    await cancelResponseBody(response);
    return null;
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength >= MAX_API_ERROR_BODY_BYTES - byteLength) {
        await cancelResponseBody(response, reader);
        return null;
      }
      byteLength += value.byteLength;
      chunks.push(decoder.decode(value, { stream: true }));
    }

    chunks.push(decoder.decode());
    const text = chunks.join("");
    if (text.trim().length === 0) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch {
    await cancelResponseBody(response, reader);
    return null;
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

function responseData(payload: unknown): unknown {
  return isRecord(payload) && Object.prototype.hasOwnProperty.call(payload, "data")
    ? payload.data
    : payload;
}

async function settledResponse(response: Response): Promise<ApiSettledResponse> {
  const payload = response.ok
    ? await parseJsonResponse(response)
    : await parseBoundedErrorResponse(response);
  return {
    ok: response.ok,
    status: normalizedStatus(response.status),
    data: responseData(payload),
    payload,
  };
}

function responseErrorFields(payload: unknown): { code: unknown; message: unknown } {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
  return { code: error.code, message: error.message };
}

function bodyIdempotencyKey(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const value = body as Record<string, unknown>;
  const key = value.idempotency_key ?? value.idempotencyKey;
  return typeof key === "string" && key.length > 0 ? key : undefined;
}

function hasApiEnforcedIdempotency(path: string, method: string): boolean {
  const route = path.split("?", 1)[0] ?? path;
  if (route === "/tasks" || route.startsWith("/tasks/")) return true;
  if (route === "/coordination" || route.startsWith("/coordination/")) return true;
  if (method !== "POST") return false;
  return route === "/context/conversations"
    || /^\/context\/conversations\/[^/]+\/(?:messages|checkpoints)$/.test(route)
    || /^\/context\/conversations\/[^/]+\/checkpoints\/[^/]+\/restore$/.test(route)
    || route === "/backups/restore/preview"
    || /^\/backups\/restore\/[^/]+\/(?:confirm|execute)$/.test(route);
}

function canRetry(path: string, opts: RequestOptions): boolean {
  const method = opts.method.toUpperCase();
  return RETRYABLE_METHODS.has(method)
    || (opts.idempotencyKey !== undefined && hasApiEnforcedIdempotency(path, method));
}

/**
 * Core HTTP request function with retry and timeout.
 *
 * Retry strategy for safe/idempotent methods or API-enforced idempotency keys:
 * - 5xx server errors: retry with 50-150ms jittered backoff (transient server blips)
 * - Network errors (DNS, ECONNREFUSED, timeout): retry with 100-300ms jittered backoff
 * - 4xx client errors: NEVER retried — they indicate bad input, not transient conditions
 * - Exhaustion: throws a fixed ApiUnavailableError after MAX_RETRIES failures
 *
 * AbortSignal.timeout() handles the timeout case without a manual timer.
 */
async function request(path: string, opts: RequestOptions, retries = canRetry(path, opts) ? MAX_RETRIES : 0): Promise<Response> {
  let url: URL;
  try {
    url = opts.trustedChildMcpRuntime
      ? new URL(path, new URL(config.apiUrl).origin)
      : new URL(
        // Strip leading slash from normal API paths so URL resolution works when
        // appended to the v1 base URL (e.g. "skills/list" not "/skills/list").
        path.startsWith("/") ? path.slice(1) : path,
        config.apiUrl.endsWith("/") ? config.apiUrl : config.apiUrl + "/",
      );
    if (opts.params) {
      for (const [key, value] of Object.entries(opts.params)) {
        if (value === undefined) continue;
        if (typeof value === "string") {
          url.searchParams.set(key, value);
        } else {
          for (const entry of value) url.searchParams.append(key, entry);
        }
      }
    }
  } catch {
    throw new ApiUnavailableError();
  }

  let attemptsRemaining = retries;
  while (true) {
    try {
      const init: RequestInit = {
        method: opts.method,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: apiRequestHeaders({ "Content-Type": opts.contentType ?? "application/json" }, opts.trustedChildMcpRuntime ? "runtime" : undefined),
      };
      if (opts.trustedChildMcpRuntime) {
        (init.headers as Headers).set(
          CHILD_MCP_RUNTIME_HANDOFF_HEADER,
          CHILD_MCP_RUNTIME_HANDOFF_VALUE,
        );
      }
      if (opts.idempotencyKey !== undefined) {
        (init.headers as Headers).set("Idempotency-Key", opts.idempotencyKey);
      }
      if (opts.octetBody !== undefined) init.body = opts.octetBody as unknown as BodyInit;
      else if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

      const response = await fetch(url.toString(), init);
      if (!response.ok && response.status >= 500 && attemptsRemaining > 0) {
        await cancelResponseBody(response);
        attemptsRemaining -= 1;
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 100 + 50));
        continue;
      }
      return response;
    } catch {
      if (attemptsRemaining > 0) {
        attemptsRemaining -= 1;
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 200 + 100));
        continue;
      }
      throw new ApiUnavailableError();
    }
  }
}

async function settledJson(path: string, options: RequestOptions): Promise<ApiSettledResponse> {
  const response = await request(path, options);
  return settledResponse(response);
}

async function successfulJson(path: string, options: RequestOptions): Promise<ApiSuccessResponse> {
  const response = await settledJson(path, options);
  if (!response.ok) {
    const fields = responseErrorFields(response.payload);
    throw new ApiHttpError(response.status, fields.code, fields.message);
  }
  return { status: response.status, data: response.data };
}

async function settledRawGet(
  path: string,
  params?: Record<string, QueryParameterValue | undefined>,
): Promise<ApiSettledRawResponse> {
  const response = await request(path, { method: "GET", params }, 0);
  if (!response.ok) await parseBoundedErrorResponse(response);
  return { ok: response.ok, status: normalizedStatus(response.status), response };
}

/**
 * Typed HTTP client for the Ingenium API.
 * Standard methods resolve only for 2xx responses. Adapters that intentionally
 * interpret a non-2xx response must use the explicit `settled` namespace.
 */
export const api = {
  get: async (path: string, params?: Record<string, QueryParameterValue | undefined>) => {
    return successfulJson(path, { method: "GET", params });
  },
  post: async (path: string, body?: unknown, params?: Record<string, QueryParameterValue | undefined>) => {
    return successfulJson(path, { method: "POST", body, params, idempotencyKey: bodyIdempotencyKey(body) });
  },
  put: async (path: string, body?: unknown, params?: Record<string, QueryParameterValue | undefined>) => {
    return successfulJson(path, { method: "PUT", body, params });
  },
  patch: async (path: string, body?: unknown, params?: Record<string, QueryParameterValue | undefined>) => {
    return successfulJson(path, { method: "PATCH", body, params, idempotencyKey: bodyIdempotencyKey(body) });
  },
  del: async (
    path: string,
    params?: Record<string, QueryParameterValue | undefined>,
    body?: unknown,
  ) => {
    return successfulJson(path, { method: "DELETE", params, body, idempotencyKey: bodyIdempotencyKey(body) });
  },
  settled: {
    get: async (path: string, params?: Record<string, QueryParameterValue | undefined>) => {
      return settledJson(path, { method: "GET", params });
    },
    post: async (path: string, body?: unknown, params?: Record<string, QueryParameterValue | undefined>) => {
      return settledJson(path, { method: "POST", body, params, idempotencyKey: bodyIdempotencyKey(body) });
    },
    patch: async (path: string, body?: unknown, params?: Record<string, QueryParameterValue | undefined>) => {
      return settledJson(path, { method: "PATCH", body, params, idempotencyKey: bodyIdempotencyKey(body) });
    },
    /** Submit one bounded binary snapshot without retrying the transport. */
    postOctetStream: async (path: string, body: Uint8Array, params?: Record<string, QueryParameterValue | undefined>) => {
      const response = await request(path, {
        method: "POST",
        octetBody: body,
        contentType: "application/octet-stream",
        params,
      }, 0);
      return settledResponse(response);
    },
    /** Preserve the API envelope for the report boundary and its repeated filters. */
    getMcpReport: async (
      project: string,
      filters: Record<string, QueryParameterValue | undefined> = {},
    ) => {
      return settledJson("/mcp-tools/report", { method: "GET", params: { project, ...filters } });
    },
    /** Preserve the attested state envelope for status-only callers. */
    getToolState: async (toolName: string, project: string) => {
      return settledJson(`/mcp-tools/${encodeURIComponent(toolName)}/state`, {
        method: "GET",
        params: { project },
      });
    },
    /** Fetch server-only child-MCP runtime data outside the dashboard API namespace. */
    getTrustedChildMcpRuntime: async (project: string) => {
      return settledJson(CHILD_MCP_RUNTIME_HANDOFF_PATH, {
        method: "GET",
        params: { project },
        trustedChildMcpRuntime: true,
      });
    },
    /** Raw downloads retain their binary response body and existing no-retry behavior. */
    getRaw: settledRawGet,
  },
};
