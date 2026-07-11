import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { logger } from "../logger.js";
import { Config } from "../schema.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { resolveProjectBase, getConfigPath } from "./paths.js";

export function getConfig(projectId: string, type: "project" | "global"): Config | undefined {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM configs WHERE project_id = ? AND type = ?").get(projectId, type) as Config | undefined;
}

export function saveConfig(projectId: string, type: "project" | "global", content: string): Config {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const existing = db.prepare("SELECT * FROM configs WHERE project_id = ? AND type = ?").get(projectId, type) as Config | undefined;
    if (existing) {
      db.prepare("UPDATE configs SET content = ?, updated_at = ? WHERE id = ?").run(content, now, existing.id);
    } else {
      const id = "config_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      db.prepare("INSERT INTO configs (id, project_id, type, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, projectId, type, content, now, now);
    }
    // Also write to disk at the correct config path
    try {
      const configPath = type === "global"
        ? resolve(resolveProjectBase(projectId), "opencode.jsonc")
        : getConfigPath(projectId);
      const dir = resolve(configPath, "..");
      if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); }
      writeFileSync(configPath, content, "utf-8");
    } catch (e) {
      // Disk write failure is non-fatal for the DB operation
      const cfgErrMsg = e instanceof Error ? e.message : String(e);
      const cfgErrName = e instanceof Error ? e.name : "Unknown";
      const cfgErrStack = e instanceof Error ? e.stack : undefined;
      logger.warn("configs", `Failed to write config to disk: ${cfgErrMsg}`, { error: cfgErrMsg, name: cfgErrName, stack: cfgErrStack?.split("\n").slice(0, 5).join("\n") });
    }
    checkpointAfterWrite();
    return db.prepare("SELECT * FROM configs WHERE project_id = ? AND type = ?").get(projectId, type) as Config;
  });
}

export function syncConfigFromDisk(projectId: string, type: "project" | "global"): Config | undefined {
  try {
    const configPath = type === "global"
      ? resolve(resolveProjectBase(projectId), "opencode.jsonc")
      : getConfigPath(projectId);
    if (!existsSync(configPath)) return undefined;
    const content = readFileSync(configPath, "utf-8");
    return saveConfig(projectId, type, content);
  } catch {
    return undefined;
  }
}
