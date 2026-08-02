/**
 * MCP tool handlers for the Backups feature.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Supports backup CRUD, download streaming, restore preview/start/status, and schedule management.
 */
import { api } from "../client.js";
import { apiRequestHeaders, config } from "../../config/index.js";
import { resolveSafeDownloadPath, streamDownloadResponse } from "../safe-download.js";

/** Create a new backup with an optional type (e.g. "full", "skills", "config"). */
export async function backupCreate(project: string, type?: string) {
  const body: Record<string, unknown> = {};
  if (type) body.type = type;
  const res = await api.post("/backups", body, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** List all backups for a project. */
export async function backupList(project: string) {
  const res = await api.get("/backups", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get a single backup by ID. */
export async function backupGet(project: string, backupId: string) {
  const res = await api.get(`/backups/${backupId}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/**
 * Download a backup and write it to a validated path.
 * 🔴 SAFETY: Never returns raw binary content. Always writes to a validated path
 * within /workspace or the user's home directory. Returns file metadata only.
 */
export async function backupDownload(project: string, backupId: string, outputPath: string) {
  if (!outputPath) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: "outputPath is required — specify a path within /workspace or your home directory" }) }] };
  }

  // 🔴 Validate outputPath before making any network call
  let safePath: string;
  try {
    safePath = resolveSafeDownloadPath(outputPath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid path";
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Invalid outputPath: ${message}` }) }] };
  }

  // Build the API URL and perform a raw fetch for binary response
  const apiBase = config.apiUrl.endsWith("/") ? config.apiUrl : config.apiUrl + "/";
  const url = new URL(`backups/${backupId}/download`, apiBase);
  url.searchParams.set("project", project);

  const response = await fetch(url.toString(), { headers: apiRequestHeaders() });
  if (!response.ok) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Download failed: HTTP ${response.status}` }) }] };
  }

  const { mimeType, size } = await streamDownloadResponse(response, safePath);
  return { content: [{ type: "text" as const, text: JSON.stringify({ savedPath: safePath, mimeType, size }) }] };
}

/** Delete a backup by ID. */
export async function backupDelete(project: string, backupId: string) {
  await api.del(`/backups/${backupId}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: backupId }) }] };
}

/** Preview what a restore would do without executing it. */
export async function backupRestorePreview(project: string, backupId: string) {
  const res = await api.post("/backups/restore/preview", { backupId }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Start a restore operation. Requires confirm=true to proceed. */
export async function backupRestoreStart(project: string, backupId: string) {
  const res = await api.post("/backups/restore", { backupId, confirm: true }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get the status of a restore operation by job ID. */
export async function backupRestoreStatus(project: string, jobId: string) {
  const res = await api.get(`/backups/restore/${jobId}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get the current backup schedule configuration. */
export async function backupScheduleGet(project: string) {
  const res = await api.get("/backups/schedule", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Set/update the backup schedule configuration. */
export async function backupScheduleSet(project: string, configData: Record<string, unknown>) {
  const res = await api.put("/backups/schedule", configData, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
