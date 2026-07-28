export const KNOWN_MCP_STATUSES = [
  "connected",
  "disabled",
  "failed",
  "needs_auth",
  "needs_client_registration",
] as const;

export type KnownMcpStatus = (typeof KNOWN_MCP_STATUSES)[number];
export type McpStatus = KnownMcpStatus | "unknown";

export interface McpServerView {
  name: string;
  status: McpStatus;
  connected: boolean;
  toolCount?: number;
  error?: string;
}

const STATUS_ERRORS: Partial<Record<McpStatus, string>> = {
  failed: "MCP server failed to connect.",
  needs_auth: "MCP server requires authentication. Configure its credentials and reconnect.",
  needs_client_registration: "MCP server requires client registration. Update its configuration and reopen OpenCode.",
  unknown: "MCP server returned an unrecognized status.",
};

const INGENIUM_LAUNCHER_FAILURE = "Ingenium MCP could not connect. Build the extension launcher, then verify the protected API token and project identity.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKnownStatus(value: unknown): value is KnownMcpStatus {
  return typeof value === "string" && (KNOWN_MCP_STATUSES as readonly string[]).includes(value);
}

function readToolCount(value: Record<string, unknown>): number | undefined {
  const count = typeof value.toolCount === "number" ? value.toolCount : value.tools;
  if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) return count;
  if (Array.isArray(value.tools)) return value.tools.length;
  return undefined;
}

/** Defensive browser-side normalization for new and legacy proxy responses. */
export function normalizeMcpServer(name: string, value: unknown): McpServerView {
  if (!isRecord(value)) {
    return { name, status: "unknown", connected: false, error: STATUS_ERRORS.unknown };
  }
  const status: McpStatus = isKnownStatus(value.status)
    ? value.status
    : typeof value.status === "undefined" && typeof value.connected === "boolean"
      ? value.connected ? "connected" : "disabled"
      : "unknown";
  const toolCount = readToolCount(value);
  return {
    name,
    status,
    connected: status === "connected",
    ...(toolCount === undefined ? {} : { toolCount }),
    ...(name === "ingenium" && status === "failed"
      ? { error: INGENIUM_LAUNCHER_FAILURE }
      : STATUS_ERRORS[status] ? { error: STATUS_ERRORS[status] } : {}),
  };
}

/** Reject a malformed root response so the shell shows a refresh failure. */
export function normalizeMcpServers(value: unknown): McpServerView[] | null {
  if (!isRecord(value)) return null;
  return Object.entries(value).map(([name, server]) => normalizeMcpServer(name, server));
}

export function getMcpStatusLabel(status: McpStatus): string {
  switch (status) {
    case "connected": return "Connected";
    case "disabled": return "Disabled";
    case "failed": return "Failed";
    case "needs_auth": return "Needs authentication";
    case "needs_client_registration": return "Needs client registration";
    default: return "Status unavailable";
  }
}
