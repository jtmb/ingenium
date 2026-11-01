import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { logger } from "../logger.js";
import { Config } from "../schema.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {createHash} from "node:crypto";
import {readProjectionBytes,exactUtf8} from "./plugin-projection-materialize.js";
import { resolveProjectBase, getConfigPath } from "./paths.js";
import {managedPluginConfigPathIfPresent,PluginProjectionTransitionRequired} from "./plugin-projection-transition.js";

/**
 * Get configuration content from the DB.
 * "global" configs use the opencode.jsonc path, "project" configs use opencode.json.
 */
export function getConfig(projectId: string, type: "project" | "global"): Config | undefined {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM configs WHERE project_id = ? AND type = ?").get(projectId, type) as Config | undefined;
}

/**
 * Save config to both DB and disk.
 * DB write is authoritative; disk write is best-effort (failure is logged but
 * does not roll back the transaction). This ensures the config is not lost
 * even if the filesystem is read-only or the path is invalid.
 */
export function saveConfig(projectId: string, type: "project" | "global", content: string): Config {
  managedPluginConfigPathIfPresent(projectId);
  if(type==="project")getConfigPath(projectId);
  const config = execTransaction(() => {
    saveConfigInCurrentTransaction(projectId,type,content);
    const db=getDb(process.env.INGENIUM_CORE_DB_PATH??"./data");
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
    return db.prepare("SELECT * FROM configs WHERE project_id = ? AND type = ?").get(projectId, type) as Config;
  });
  checkpointAfterWrite();
  return config;
}

/** Same original DB owner, for a caller already retaining the actual outer Core transaction. */
export function saveConfigInCurrentTransaction(projectId:string,type:"project"|"global",content:string):Config{
 if(!getDb().inTransaction)throw new Error("Core config transaction required");
 managedPluginConfigPathIfPresent(projectId);
const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const existing = db.prepare("SELECT * FROM configs WHERE project_id = ? AND type = ?").get(projectId, type) as Config | undefined;
    if (existing) {
      db.prepare("UPDATE configs SET content = ?, updated_at = ? WHERE id = ?").run(content, now, existing.id);
    } else {
      const id = "config_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      db.prepare("INSERT INTO configs (id, project_id, type, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, projectId, type, content, now, now);
    }
 return getDb().prepare("SELECT * FROM configs WHERE project_id=? AND type=?").get(projectId,type) as Config;
}
/** Actual resolved config reader shared by migration readback and the normal agent-config consumer. */
export function readConfigProjection(projectId:string,type:"project"|"global"):{path:string;content:string;sha256:string}|undefined{
 managedPluginConfigPathIfPresent(projectId);
 const path=type==="global"?resolve(resolveProjectBase(projectId),"opencode.jsonc"):getConfigPath(projectId);
 const bytes=readProjectionBytes(path);if(!bytes)return undefined;
 try{return {path,content:exactUtf8(bytes),sha256:createHash("sha256").update(bytes).digest("hex")};}finally{bytes.fill(0);}
}
/**
 * Read config from the filesystem and save it to the DB.
 * Returns undefined if the file does not exist or is unreadable
 * (e.g., the workspace hasn't been initialized yet).
 * This is the "pull from disk" direction of the sync.
 */
export function syncConfigFromDisk(projectId: string, type: "project" | "global"): Config | undefined {
  managedPluginConfigPathIfPresent(projectId);
  try {
    const configPath = type === "global"
      ? resolve(resolveProjectBase(projectId), "opencode.jsonc")
      : getConfigPath(projectId);
    if (!existsSync(configPath)) return undefined;
    const content = readFileSync(configPath, "utf-8");
    return saveConfig(projectId, type, content);
  } catch (error) {
    if(error instanceof PluginProjectionTransitionRequired)throw error;
    return undefined;
  }
}
