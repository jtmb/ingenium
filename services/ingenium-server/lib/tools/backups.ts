/**
 * MCP tool handlers for the Backups feature.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Supports backup CRUD, download streaming, restore preview/start/status, and schedule management.
 */
import { api } from "../client.js";
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

  const response = await api.settled.getRaw(
    `/backups/${encodeURIComponent(backupId)}/download`,
    { project },
  );
  if (!response.ok) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Download failed: HTTP ${response.status}` }) }] };
  }

  const { mimeType, size } = await streamDownloadResponse(response.response, safePath);
  return { content: [{ type: "text" as const, text: JSON.stringify({ savedPath: safePath, mimeType, size }) }] };
}

/** Delete a backup by ID. */
export async function backupDelete(project: string, backupId: string) {
  await api.del(`/backups/${backupId}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: backupId }) }] };
}

/** Create or replay a durable dry-run restore plan. */
export async function backupRestorePreview(project: string, backupId: string, dryRun: true, idempotencyKey: string) {
  const res = await api.post("/backups/restore/preview", { backupId, dryRun, idempotencyKey }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Issue one opaque confirmation token. This wrapper neither logs nor persists it. */
export async function backupRestoreAuthorize(project: string, planId: string, expectedRevision: number) {
  const res = await api.post(`/backups/restore/${encodeURIComponent(planId)}/authorize`, { expectedRevision }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Confirm a plan; this advances only to ready_for_executor and never applies a backup. */
export async function backupRestoreStart(
  project: string,
  planId: string,
  expectedRevision: number,
  confirmationToken: string,
  idempotencyKey: string,
) {
  const res = await api.post(
    `/backups/restore/${encodeURIComponent(planId)}/confirm`,
    { expectedRevision, confirmationToken, idempotencyKey },
    { project },
  );
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Issue the distinct one-time maintenance execution token for a ready plan. */
export async function backupRestoreExecutionAuthorize(project: string, planId: string, expectedRevision: number) {
  const res = await api.post(
    `/backups/restore/${encodeURIComponent(planId)}/execution/authorize`,
    { expectedRevision },
    { project },
  );
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Queue a fixed maintenance executor. No process or path arguments are accepted. */
export async function backupRestoreExecute(
  project: string,
  planId: string,
  expectedRevision: number,
  executionToken: string,
  idempotencyKey: string,
) {
  const res = await api.post(
    `/backups/restore/${encodeURIComponent(planId)}/execute`,
    { expectedRevision, executionToken, idempotencyKey },
    { project },
  );
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Get a restore plan's content-free current state. */
export async function backupRestoreStatus(project: string, planId: string) {
  const res = await api.get(`/backups/restore/${encodeURIComponent(planId)}`, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** List bounded immutable restore-plan audit evidence. */
export async function backupRestoreAuditList(project: string, planId: string, limit?: number) {
  const res = await api.get(`/backups/restore/${encodeURIComponent(planId)}/audit`, {
    project,
    ...(limit === undefined ? {} : { limit: String(limit) }),
  });
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
