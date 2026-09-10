import type { OpenCodeMessagesClient, OpenCodeMessagesFailure, OpenCodeMessage } from "ingenium-core";
import { config } from "../config/index.js";
import { loadApiToken } from "./middleware/api-token.js";

/** Internal read requests must not outlive a scheduler or extraction trigger. */
export const OPENCODE_MESSAGES_REQUEST_TIMEOUT_MS = 10_000;

function isMessage(value: unknown): value is OpenCodeMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return typeof message.text === "string"
    && typeof message.time_created === "number"
    && Number.isFinite(message.time_created)
    && (message.messageId === undefined || typeof message.messageId === "string")
    && (message.sessionId === undefined || typeof message.sessionId === "string");
}

/**
 * Convert transport responses into stable diagnostics. These categories are
 * intentionally credential- and endpoint-free so they may be logged by core.
 */
export function classifyOpenCodeMessagesFailure(status: number): OpenCodeMessagesFailure {
  if (status === 401 || status === 403) return "authentication";
  if (status === 404) return "not_found";
  if (status === 423) return "locked";
  return "unavailable";
}

/**
 * Construct the API-owned client used by extraction. The bearer is loaded only
 * while constructing the request, installed only in its HTTP headers, and is
 * never returned or logged. The endpoint and timeout are injectable solely for isolated tests.
 */
export function createOpenCodeMessagesClient(
  apiOrigin = `http://127.0.0.1:${config.port}`,
  requestTimeoutMs = OPENCODE_MESSAGES_REQUEST_TIMEOUT_MS,
): OpenCodeMessagesClient {
  return async ({ since, limit, projectName }) => {
    let token: string;
    try {
      token = loadApiToken();
    } catch {
      return { messages: [], failure: "authentication" };
    }

    const url = new URL("/api/v1/opencode/messages", apiOrigin);
    url.searchParams.set("since", String(since));
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("project", projectName);

    const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "X-Ingenium-Internal-Service": "1",
        },
        signal: timeoutSignal,
      });
      if (!response.ok) {
        return { messages: [], failure: classifyOpenCodeMessagesFailure(response.status) };
      }

      const payload: unknown = await response.json();
      const messages = (payload as { data?: { messages?: unknown } })?.data?.messages;
      if (!Array.isArray(messages) || !messages.every(isMessage)) {
        return { messages: [], failure: "invalid_response" };
      }
      return { messages };
    } catch {
      return { messages: [], failure: timeoutSignal.aborted ? "timeout" : "unavailable" };
    }
  };
}
