/**
 * The single HTTP client that ALL MCP tools use to talk to the Ingenium API.
 *
 * Features:
 * - Retry with jittered backoff (two tiers: 50-150ms for 5xx, 100-300ms for network errors)
 * - AbortSignal request timeouts (prevents hung MCP tool handlers)
 * - Status-based retry on 5xx only — 4xx errors are NOT retried (client errors are fatal)
 * - JSON body serialization, query param construction
 *
 * Retry design rationale:
 * - 5xx retries use a short jitter window (50-150ms) because these are typically
 *   transient API server blips (connection pool exhaustion, brief DB lock).
 * - Network errors (DNS, ECONNREFUSED, timeout) use a longer window (100-300ms)
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

function bodyIdempotencyKey(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const value = body as Record<string, unknown>;
  const key = value.idempotency_key ?? value.idempotencyKey;
  return typeof key === "string" ? key : undefined;
}

/**
 * Core HTTP request function with retry and timeout.
 *
 * Retry strategy:
 * - 5xx server errors: retry with 50-150ms jittered backoff (transient server blips)
 * - Network errors (DNS, ECONNREFUSED, timeout): retry with 100-300ms jittered backoff
 * - 4xx client errors: NEVER retried — they indicate bad input, not transient conditions
 * - Exhaustion: throws the original error after MAX_RETRIES failures
 *
 * AbortSignal.timeout() handles the timeout case without a manual timer.
 */
async function request(path: string, opts: RequestOptions, retries = MAX_RETRIES): Promise<Response> {
  const url = opts.trustedChildMcpRuntime
    ? new URL(path, new URL(config.apiUrl).origin)
    : new URL(
      // Strip leading slash from normal API paths so URL resolution works when
      // appended to the v1 base URL (e.g. "skills/list" not "/skills/list").
      path.startsWith("/") ? path.slice(1) : path,
      config.apiUrl.endsWith("/") ? config.apiUrl : config.apiUrl + "/",
  );
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v === undefined) continue;
      if (typeof v === "string") {
        url.searchParams.set(k, v);
      } else {
        for (const value of v) url.searchParams.append(k, value);
      }
    }
  }

  const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);

  try {
    const init: RequestInit = {
      method: opts.method,
      signal: timeoutSignal,
      headers: apiRequestHeaders({ "Content-Type": opts.contentType ?? "application/json" }),
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

    // Retry on server errors (5xx) with jittered backoff — 4xx errors are NOT retried
    if (!response.ok && retries > 0 && response.status >= 500) {
      const delay = Math.random() * 100 + 50;
      await new Promise((r) => setTimeout(r, delay));
      return request(path, opts, retries - 1);
    }

    return response;
  } catch (err) {
    // Retry on network errors (DNS, connection refused, etc.) with jittered backoff
    if (retries > 0) {
      const delay = Math.random() * 200 + 100;
      await new Promise((r) => setTimeout(r, delay));
      return request(path, opts, retries - 1);
    }
    throw err;
  }
}

/**
 * Typed HTTP client for the Ingenium API.
 * Every method returns `{ ok, status, data }` — never throws for HTTP errors (only for network/timeout exhaustion).
 *
 * The `data` field falls back to the raw response JSON if the API's standard `{ data: ... }` envelope
 * is absent (handles both wrapped and unwrapped API responses transparently).
 */
export const api = {
  get: async (path: string, params?: Record<string, QueryParameterValue | undefined>) => {
    const res = await request(path, { method: "GET", params });
    const json = await res.json();
    return { ok: res.ok, status: res.status, data: json.data ?? json };
  },
  /**
   * Preserve the API envelope for the report boundary while keeping its data
   * payload available to the MCP wrapper. Repeated filter values remain
   * repeated query parameters; they are never joined into a lossy string.
   */
  getMcpReport: async (
    project: string,
    filters: Record<string, QueryParameterValue | undefined> = {},
  ) => {
    const res = await request("/mcp-tools/report", {
      method: "GET",
      params: { project, ...filters },
    });
    const payload = await res.json();
    return { ok: res.ok, status: res.status, data: payload?.data ?? payload, payload: payload as unknown };
  },
  /** Preserve the state response envelope so callers can verify project attestation. */
  getToolState: async (toolName: string, project: string) => {
    const res = await request(`/mcp-tools/${encodeURIComponent(toolName)}/state`, {
      method: "GET",
      params: { project },
    });
    const json = await res.json();
    return { ok: res.ok, status: res.status, data: json.data ?? json, payload: json as unknown };
  },
  /**
   * Fetch plaintext environment values only for the parent MCP process. This
   * cannot use `/api/v1`, because that namespace is available to dashboard
   * proxy callers and must remain metadata-only.
   */
  getTrustedChildMcpRuntime: async (project: string) => {
    const res = await request(CHILD_MCP_RUNTIME_HANDOFF_PATH, {
      method: "GET",
      params: { project },
      trustedChildMcpRuntime: true,
    });
    const json = await res.json();
    return { ok: res.ok, status: res.status, data: json.data ?? json };
  },
  post: async (path: string, body?: unknown, params?: Record<string, QueryParameterValue | undefined>) => {
    const res = await request(path, { method: "POST", body, params, idempotencyKey: bodyIdempotencyKey(body) });
    const json = await res.json();
    return { ok: res.ok, status: res.status, data: json.data ?? json };
  },
  /**
   * Submit one bounded binary snapshot. Unlike JSON calls this never retries:
   * replay safety belongs to the snapshot hash at the API boundary and callers
   * must not accidentally turn one import into multiple transport attempts.
   */
  postOctetStream: async (path: string, body: Uint8Array, params?: Record<string, QueryParameterValue | undefined>) => {
    const res = await request(path, {
      method: "POST",
      octetBody: body,
      contentType: "application/octet-stream",
      params,
    }, 0);
    const json = await res.json();
    return { ok: res.ok, status: res.status, data: json.data ?? json };
  },
  put: async (path: string, body?: unknown, params?: Record<string, QueryParameterValue | undefined>) => {
    const res = await request(path, { method: "PUT", body, params });
    const json = await res.json();
    return { ok: res.ok, status: res.status, data: json.data ?? json };
  },
  patch: async (path: string, body?: unknown, params?: Record<string, QueryParameterValue | undefined>) => {
    const res = await request(path, { method: "PATCH", body, params, idempotencyKey: bodyIdempotencyKey(body) });
    const json = await res.json();
    return { ok: res.ok, status: res.status, data: json.data ?? json };
  },
  /** NOTE: DELETE returns `data: null` — the API typically returns no body on deletes. */
  del: async (
    path: string,
    params?: Record<string, QueryParameterValue | undefined>,
    body?: unknown,
  ) => {
    const res = await request(path, { method: "DELETE", params, body, idempotencyKey: bodyIdempotencyKey(body) });
    return { ok: res.ok, status: res.status, data: null };
  },
};
