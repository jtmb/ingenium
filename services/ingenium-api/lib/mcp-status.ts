/**
 * MCP status projection for the dashboard-facing OpenCode proxy.
 *
 * OpenCode v1.18.9 reports a tagged status rather than the legacy boolean
 * `connected` flag. Keep accepting that boolean for older installations, but
 * never forward arbitrary upstream diagnostics to the browser.
 */

import { isSafeMcpServerName } from "./browser-safe-scalars.js";

export const KNOWN_MCP_CONNECTION_STATUSES = [
  "connected",
  "disabled",
  "failed",
  "needs_auth",
  "needs_client_registration",
] as const;

export type KnownMcpConnectionStatus =
  (typeof KNOWN_MCP_CONNECTION_STATUSES)[number];

export type McpConnectionStatus = KnownMcpConnectionStatus | "unknown";

export interface SanitizedMcpServerStatus {
  status: McpConnectionStatus;
  /** Compatibility field for older dashboard clients. */
  connected: boolean;
  toolCount?: number;
  /** A fixed, browser-safe status explanation. Never upstream error text. */
  error?: string;
}

const STATUS_ERRORS: Partial<Record<McpConnectionStatus, string>> = {
  failed: "MCP server failed to connect.",
  needs_auth: "MCP server requires authentication. Configure its credentials and reconnect.",
  needs_client_registration: "MCP server requires client registration. Update its configuration and reopen OpenCode.",
  unknown: "MCP server returned an unrecognized status.",
};

const INGENIUM_LAUNCHER_FAILURE = "Ingenium MCP could not connect. Build the extension launcher, then verify the protected API token and project identity.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKnownStatus(value: unknown): value is KnownMcpConnectionStatus {
  return typeof value === "string"
    && (KNOWN_MCP_CONNECTION_STATUSES as readonly string[]).includes(value);
}

function readToolCount(info: Record<string, unknown>): number | undefined {
  const count = typeof info.toolCount === "number" ? info.toolCount : info.tools;
  if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) {
    return count;
  }
  if (Array.isArray(info.tools)) return info.tools.length;
  return undefined;
}

/** Normalize one OpenCode MCP server result into the public API contract. */
export function normalizeMcpServerStatus(info: unknown, name?: string): SanitizedMcpServerStatus {
  if (!isRecord(info)) {
    return {
      status: "unknown",
      connected: false,
      error: STATUS_ERRORS.unknown,
    };
  }

  // v1.18.9 status takes precedence over the legacy boolean when both exist.
  const status: McpConnectionStatus = isKnownStatus(info.status)
    ? info.status
    : typeof info.status === "undefined" && typeof info.connected === "boolean"
      ? info.connected ? "connected" : "disabled"
      : "unknown";
  const toolCount = readToolCount(info);
  const error = name === "ingenium" && status === "failed"
    ? INGENIUM_LAUNCHER_FAILURE
    : STATUS_ERRORS[status];

  return {
    status,
    connected: status === "connected",
    ...(toolCount === undefined ? {} : { toolCount }),
    ...(error ? { error } : {}),
  };
}

/**
 * Normalize the complete `/mcp` response. A non-record root is invalid rather
 * than an empty server list, so callers can surface a real refresh failure.
 */
export function normalizeMcpStatusResponse(
  response: unknown,
): Record<string, SanitizedMcpServerStatus> | null {
  if (!isRecord(response)) return null;
  const sanitized: Record<string, SanitizedMcpServerStatus> = {};
  for (const [name, info] of Object.entries(response)) {
    if (!isSafeMcpServerName(name)) continue;
    sanitized[name] = normalizeMcpServerStatus(info, name);
  }
  return sanitized;
}
