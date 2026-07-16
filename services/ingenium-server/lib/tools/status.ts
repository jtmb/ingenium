/**
 * MCP tool handlers for service status.
 * Supports fetching overall health, application detail, process detail, and process logs.
 */
import { api } from "../client.js";

const MAX_LOG_BYTES = 10000;

/** Get overall service health — supervisord process states + application health */
export async function serviceStatus(project: string) {
  const res = await api.get("/services/status", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get detailed status for a specific application (email-client or synthesis-engine) */
export async function serviceApplicationDetail(project: string, name: string) {
  const res = await api.get(`/services/applications/${encodeURIComponent(name)}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get single process detail via supervisor.getProcessInfo */
export async function serviceProcessDetail(project: string, name: string) {
  const res = await api.get(`/services/${encodeURIComponent(name)}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Read process logs with byte-size cap — 🔴 enforce limit (max 10000 bytes) */
export async function serviceProcessLogs(
  project: string,
  name: string,
  offset?: number,
  limit?: number,
) {
  const params: Record<string, string> = { project };
  if (offset !== undefined) params.offset = String(offset);
  // Enforce byte-size cap: max 10000 bytes
  const effectiveLimit = Math.min(limit ?? 4096, MAX_LOG_BYTES);
  params.limit = String(effectiveLimit);

  const res = await api.get(`/services/${encodeURIComponent(name)}/logs`, params);

  // Truncate log content to MAX_LOG_BYTES for safety
  const data = res.data as any;
  if (data?.log && Buffer.byteLength(data.log, "utf8") > MAX_LOG_BYTES) {
    const truncated = Buffer.from(data.log, "utf8").subarray(0, MAX_LOG_BYTES).toString("utf8");
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ log: truncated, offset: (offset ?? 0) + MAX_LOG_BYTES, more: true }),
      }],
    };
  }

  return { content: [{ type: "text" as const, text: JSON.stringify({ log: data?.log ?? "", offset: data?.offset ?? (offset ?? 0), more: data?.more ?? false }) }] };
}
