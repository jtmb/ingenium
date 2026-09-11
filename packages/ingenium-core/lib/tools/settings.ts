/**
 * Settings management — key-value store scoped to a project.
 * Used for user-configurable preferences like archive retention period, synthesis intervals, etc.
 * The `settings` table has a UNIQUE constraint on (project_id, key) — the upsert below
 * relies on this to avoid multi-step "select then insert/update" branches.
 */
import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import {
  getOAuthClientSecret,
  isOAuthClientSecretKey,
} from "./protected-settings.js";

export const AUTOMATIC_LEARNING_SETTING_KEY = "automatic_learning_enabled";

/**
 * Get a setting value by project and key.
 * @returns The stored value, or `defaultVal` if the key is not set.
 */
export function getSetting(projectId: string, key: string, defaultVal?: string): string | undefined {
  if (key === "cloudflare_tunnel_token") return defaultVal;
  if (isOAuthClientSecretKey(key)) {
    return getOAuthClientSecret(projectId, key) ?? defaultVal;
  }
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const row = db.prepare("SELECT value FROM settings WHERE project_id = ? AND key = ?").get(projectId, key) as { value: string } | undefined;
  return row?.value ?? defaultVal;
}

export function isAutomaticLearningEnabled(projectId: string): boolean {
  const value = getSetting(projectId, AUTOMATIC_LEARNING_SETTING_KEY);
  return value === undefined || value === "true";
}

/**
 * Set a setting value (upsert). Returns the set value.
 * Uses ON CONFLICT ... DO UPDATE SET for atomic upsert — avoids a separate SELECT + branch.
 */
export function setSetting(projectId: string, key: string, value: string): string {
  if (key === "context_auto_upload_enabled" && value !== "true" && value !== "false") {
    throw new Error("Context automatic upload setting must be true or false");
  }
  if (key === "context_upload_last_sync") {
    const status = JSON.parse(value) as Record<string, unknown>;
    if (!status || typeof status !== "object" || Array.isArray(status)
      || Object.keys(status).some((key) => !["status", "at", "session", "revision"].includes(key))
      || !["synced", "failed"].includes(String(status.status))
      || typeof status.at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(status.at)
      || typeof status.session !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(status.session)
      || (status.revision !== undefined && (!Number.isSafeInteger(status.revision) || (status.revision as number) < 0))) {
      throw new Error("Invalid Context sync status");
    }
  }
  if (key === "cloudflare_tunnel_token") {
    throw new Error("Cloudflare tunnel tokens must be stored in protected vault storage");
  }
  if (isOAuthClientSecretKey(key)) {
    throw new Error("OAuth client secrets must be stored in protected vault storage");
  }
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  if (key === "context_auto_upload_enabled" || key === "context_upload_last_sync") {
    execTransaction(() => {
      if (!db.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId)) throw new Error("Context project not found");
      db.prepare(`INSERT INTO settings (project_id, key, value) VALUES (?, ?, ?)
        ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`).run(projectId, key, value);
    });
    checkpointAfterWrite();
    return value;
  }
  db.prepare(
    `INSERT INTO settings (project_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`
  ).run(projectId, key, value);
  return value;
}
