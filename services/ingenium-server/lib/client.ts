/**
 * The single HTTP client that ALL MCP tools use to talk to the Ingenium API.
 * Features: retry with exponential jittered backoff, request timeouts, and status-based retry logic.
 * Does NOT import ingenium-core or any SQLite library — all data goes through HTTP.
 */
import { config } from "../config/index.js";

const MAX_RETRIES = 3;
const TIMEOUT_MS = config.apiTimeout;

/** Request options for the internal fetch wrapper. */
interface RequestOptions {
  method: string;
  body?: unknown;
  params?: Record<string, string>;
}

/**
 * Core HTTP request function with retry and timeout.
 * Retries on 5xx server errors and network failures with jittered backoff.
 * Times out individual requests after TIMEOUT_MS to prevent hanging.
 */
async function request(path: string, opts: RequestOptions, retries = MAX_RETRIES): Promise<Response> {
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

    // Retry on server errors (5xx) with jittered backoff
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

/** Typed HTTP client for the Ingenium API. Returns { ok, status, data } for every call. */
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
  del: async (path: string, params?: Record<string, string>) => {
    const res = await request(path, { method: "DELETE", params });
    return { ok: res.ok, status: res.status, data: null };
  },
};
