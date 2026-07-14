import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { Plugin } from "../schema.js";
import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { getPluginsBase, getConfigPath, isGlobal } from "./paths.js";

function validatePluginPath(filePath: string, projectId?: string): string {
  if (!/^[a-zA-Z0-9_\-./]+$/.test(filePath)) {
    throw new Error(`Invalid plugin file path: ${filePath}`);
  }
  const baseDir = getPluginsBase(projectId);
  const resolved = resolve(baseDir, filePath);
  const rel = relative(baseDir, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Plugin path escapes base directory: ${filePath}`);
  }
  return filePath;
}

function addPluginToConfig(filePath: string, projectId?: string): void {
  const isGlobalProject = isGlobal(projectId);
  const rel = isGlobalProject ? `plugins/${filePath}` : `.opencode/plugins/${filePath}`;
  try {
    const configPath = getConfigPath(projectId);
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    if (!config.plugin) config.plugin = [];
    if (!config.plugin.includes(rel)) {
      config.plugin.push(rel);
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    }
  } catch { /* config may not exist */ }
}

function removePluginFromConfig(filePath: string, projectId?: string): void {
  const isGlobalProject = isGlobal(projectId);
  const rel = isGlobalProject ? `plugins/${filePath}` : `.opencode/plugins/${filePath}`;
  try {
    const configPath = getConfigPath(projectId);
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    if (config.plugin) {
      config.plugin = config.plugin.filter((p: string) => p !== rel);
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    }
  } catch { /* config may not exist */ }
}

export function listPlugins(projectId: string): Plugin[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM plugins WHERE project_id = ?").all(projectId) as Plugin[];
}

export function enablePlugin(projectId: string, name: string): Plugin | undefined {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    db.prepare("UPDATE plugins SET enabled = 1, updated_at = ? WHERE project_id = ? AND name = ?")
      .run(now, projectId, name);

    const plugin = db.prepare("SELECT * FROM plugins WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Plugin | undefined;

    // Write the .ts file to disk
    if (plugin?.source_content) {
      ensurePluginDir(projectId);
      const filePath = validatePluginPath(plugin.file_path, projectId);
      const fullPath = resolve(getPluginsBase(projectId), filePath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, plugin.source_content);
      addPluginToConfig(plugin.file_path, projectId);
    }
    checkpointAfterWrite();
    return plugin;
  });
}

export function disablePlugin(projectId: string, name: string): Plugin | undefined {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    db.prepare("UPDATE plugins SET enabled = 0, updated_at = ? WHERE project_id = ? AND name = ?")
      .run(now, projectId, name);

    const plugin = db.prepare("SELECT * FROM plugins WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Plugin | undefined;

    // Remove the .ts file from disk
    if (plugin) {
      const filePath = validatePluginPath(plugin.file_path, projectId);
      const resolvedPath = resolve(getPluginsBase(projectId), filePath);
      if (existsSync(resolvedPath)) unlinkSync(resolvedPath);
      removePluginFromConfig(plugin.file_path, projectId);
    }
    checkpointAfterWrite();
    return plugin;
  });
}

export function ensurePluginDir(projectId?: string): void {
  const dir = getPluginsBase(projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function createPlugin(
  projectId: string,
  name: string,
  filePath: string,
  sourceContent?: string
): Plugin {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    validatePluginPath(filePath, projectId);
    const now = new Date().toISOString();
    const id = `plugin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const content = sourceContent || (() => {
      try {
        const resolvedPath = resolve(getPluginsBase(projectId), filePath);
        if (existsSync(resolvedPath)) {
          return readFileSync(resolvedPath, "utf-8");
        }
      } catch { /* file doesn't exist yet */ }
      return "";
    })();

    db.prepare(
      `INSERT INTO plugins (id, project_id, name, file_path, enabled, source_content, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(id, projectId, name, filePath, content, now, now);

    ensurePluginDir(projectId);
    if (content) {
      const fullPath = resolve(getPluginsBase(projectId), filePath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content);
      addPluginToConfig(filePath, projectId);
    }

    checkpointAfterWrite();
    return db.prepare("SELECT * FROM plugins WHERE id = ?").get(id) as Plugin;
  });
}

export function deletePlugin(projectId: string, name: string): boolean {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const plugin = db.prepare("SELECT * FROM plugins WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Plugin | undefined;
    if (!plugin) return false;

    try {
      const resolvedPath = resolve(getPluginsBase(projectId), validatePluginPath(plugin.file_path, projectId));
      if (existsSync(resolvedPath)) unlinkSync(resolvedPath);
      removePluginFromConfig(plugin.file_path, projectId);
    } catch { /* file may already be gone */ }

    db.prepare("DELETE FROM plugins WHERE id = ?").run(plugin.id);
    checkpointAfterWrite();
    return true;
  });
}

export function updatePlugin(
  projectId: string,
  name: string,
  updates: { file_path?: string; source_content?: string }
): Plugin | undefined {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const existing = db.prepare("SELECT * FROM plugins WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Plugin | undefined;
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const newFilePath = updates.file_path ?? existing.file_path;
    const newContent = updates.source_content !== undefined ? updates.source_content : (existing.source_content ?? "");

    if (updates.file_path) validatePluginPath(updates.file_path, projectId);

    db.prepare(
      "UPDATE plugins SET file_path = ?, source_content = ?, updated_at = ? WHERE id = ?"
    ).run(newFilePath, newContent, now, existing.id);

      if (updates.source_content !== undefined) {
       ensurePluginDir(projectId);
       if (updates.file_path && updates.file_path !== existing.file_path) {
         try {
           const oldPath = resolve(getPluginsBase(projectId), existing.file_path);
           if (existsSync(oldPath)) unlinkSync(oldPath);
         } catch { /* ignore */ }
         removePluginFromConfig(existing.file_path, projectId);
         addPluginToConfig(newFilePath, projectId);
       }
       const writePath = resolve(getPluginsBase(projectId), newFilePath);
       mkdirSync(dirname(writePath), { recursive: true });
       writeFileSync(writePath, newContent);
     } else if (updates.file_path && updates.file_path !== existing.file_path) {
       ensurePluginDir(projectId);
       const oldPath = resolve(getPluginsBase(projectId), existing.file_path);
       const newPath = resolve(getPluginsBase(projectId), newFilePath);
       if (existsSync(oldPath)) {
         const content = readFileSync(oldPath, "utf-8");
         mkdirSync(dirname(newPath), { recursive: true });
         writeFileSync(newPath, content);
         unlinkSync(oldPath);
       }
       removePluginFromConfig(existing.file_path, projectId);
       addPluginToConfig(newFilePath, projectId);
     }

    checkpointAfterWrite();
    return db.prepare("SELECT * FROM plugins WHERE id = ?").get(existing.id) as Plugin;
  });
}

export function getPlugin(projectId: string, name: string): Plugin | undefined {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM plugins WHERE project_id = ? AND name = ?")
    .get(projectId, name) as Plugin | undefined;
}
