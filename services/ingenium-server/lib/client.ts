/**
 * The single HTTP client that ALL MCP tools use to talk to the Ingenium API.
 *
 * Features:
 * - Retry with jittered backoff (two tiers: 50-150ms for 5xx, 100-300ms for network errors)
 * - AbortController-based request timeouts (prevents hung MCP tool handlers)
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
import { config } from "../config/index.js";

/** Maximum retry attempts per request before giving up. */
const MAX_RETRIES = 3;
/** Per-request timeout in milliseconds (from config — defaults to 10s). */
const TIMEOUT_MS = config.apiTimeout;

/** Internal options for the fetch wrapper. Not exported — consumers use the typed `api` object. */
interface RequestOptions {
  method: string;
  body?: unknown;
  params?: Record<string, string>;
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
 * AbortController handles the timeout case. The timer is always cleaned up in `finally`.
 */
async function request(path: string, opts: RequestOptions, retries = MAX_RETRIES): Promise<Response> {
  // Strip leading slash from the path so URL resolution works correctly when
  // appended to the base URL (e.g. "skills/list" not "/skills/list").
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(cleanPath, config.apiUrl.endsWith("/") ? config.apiUrl : config.apiUrl + "/");
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      url.searchParams.set(k, v);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const init: RequestInit = {
      method: opts.method,
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
    };
    if (opts.body) init.body = JSON.stringify(opts.body);

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
  } finally {
    clearTimeout(timer);
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
  get: async (path: string, params?: Record<string, string>) => {
    const res = await request(path, { method: "GET", params });
    const json = await res.json();
    return { ok: res.ok, status: res.status, data: json.data ?? json };
  },
  post: async (path: string, body?: unknown, params?: Record<string, string>) => {
    const res = await request(path, { method: "POST", body, params });
    const json = await res.json();
    return { ok: res.ok, status: res.status, data: json.data ?? json };
  },
  put: async (path: string, body?: unknown, params?: Record<string, string>) => {
    const res = await request(path, { method: "PUT", body, params });
    const json = await res.json();
    return { ok: res.ok, status: res.status, data: json.data ?? json };
  },
  patch: async (path: string, body?: unknown, params?: Record<string, string>) => {
    const res = await request(path, { method: "PATCH", body, params });
    const json = await res.json();
    return { ok: res.ok, status: res.status, data: json.data ?? json };
  },
  /** NOTE: DELETE returns `data: null` — the API typically returns no body on deletes. */
  del: async (path: string, params?: Record<string, string>) => {
    const res = await request(path, { method: "DELETE", params });
    return { ok: res.ok, status: res.status, data: null };
  },
};
