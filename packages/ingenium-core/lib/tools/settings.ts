/**
 * Settings management — key-value store scoped to a project.
 * Used for user-configurable preferences like archive retention period, synthesis intervals, etc.
 * The `settings` table has a UNIQUE constraint on (project_id, key) — the upsert below
 * relies on this to avoid multi-step "select then insert/update" branches.
 */
import { getDb } from "../db.js";

/**
 * Get a setting value by project and key.
 * @returns The stored value, or `defaultVal` if the key is not set.
 */
export function getSetting(projectId: string, key: string, defaultVal?: string): string | undefined {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const row = db.prepare("SELECT value FROM settings WHERE project_id = ? AND key = ?").get(projectId, key) as { value: string } | undefined;
  return row?.value ?? defaultVal;
}

/**
 * Set a setting value (upsert). Returns the set value.
 * Uses ON CONFLICT ... DO UPDATE SET for atomic upsert — avoids a separate SELECT + branch.
 */
export function setSetting(projectId: string, key: string, value: string): string {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  db.prepare(
    `INSERT INTO settings (project_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`
  ).run(projectId, key, value);
  return value;
}
