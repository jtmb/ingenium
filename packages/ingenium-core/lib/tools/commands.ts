import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { Command } from "../schema.js";
import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { getCommandsBase } from "./paths.js";

/**
 * Resolve a command file path to an absolute filesystem path.
 * Strips `.opencode/commands/` or `.opencode/` prefix since the base dir
 * already includes the `.opencode` structure.
 */
function resolveCommandFile(projectId: string | undefined, filePath: string): string {
  const cleanPath = filePath.replace(/^\.?opencode\/commands\//, "").replace(/^\.?opencode\//, "");
  return resolve(getCommandsBase(projectId), cleanPath);
}

/**
 * Validate a command file path:
 * 1. Character whitelist (alphanumeric, underscore, hyphen, dot, slash) — prevents injection.
 * 2. Path traversal guard — the resolved path must not escape the base directory.
 *
 * SECURITY: Without this check, a path like `../../etc/passwd` could escape
 *           the commands directory. The `relative()` + `startsWith("..")` check
 *           closes this vector.
 */
function validateCommandPath(filePath: string, projectId?: string): string {
  if (!/^[a-zA-Z0-9_\-./]+$/.test(filePath)) {
    throw new Error(`Invalid command file path: ${filePath}`);
  }
  const resolved = resolveCommandFile(projectId, filePath);
  const baseDir = getCommandsBase(projectId);
  const rel = relative(baseDir, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Command path escapes base directory: ${filePath}`);
  }
  return filePath;
}

/** Ensure the command file directory exists. Creates recursively if missing. */
export function ensureCommandDir(projectId?: string): void {
  const dir = getCommandsBase(projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** List all commands registered for a project. */
export function listCommands(projectId: string): Command[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM commands WHERE project_id = ?").all(projectId) as Command[];
}

/** Get a single command by name. Returns undefined if not found. */
export function getCommand(projectId: string, name: string): Command | undefined {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM commands WHERE project_id = ? AND name = ?")
    .get(projectId, name) as Command | undefined;
}

/**
 * Create a new command record and write its content file to disk.
 * The file path is validated against path traversal before any I/O.
 */
export function createCommand(
  projectId: string,
  name: string,
  filePath: string,
  content?: string
): Command {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    validateCommandPath(filePath, projectId);
    const now = new Date().toISOString();
    // NOTE: ID uses timestamp + random suffix for uniqueness without UUID dependency.
    const id = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const body = content ?? "";

    db.prepare(
      `INSERT INTO commands (id, project_id, name, file_path, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, projectId, name, filePath, body, now, now);

    ensureCommandDir(projectId);
    if (body) {
      const cmdPath = resolveCommandFile(projectId, filePath);
      mkdirSync(dirname(cmdPath), { recursive: true });
      writeFileSync(cmdPath, body);
    }

    checkpointAfterWrite();
    return db.prepare("SELECT * FROM commands WHERE id = ?").get(id) as Command;
  });
}

/**
 * Delete a command record and remove its file from disk.
 * File deletion is best-effort (the record is removed even if the file is gone).
 */
export function deleteCommand(projectId: string, name: string): boolean {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const cmd = db.prepare("SELECT * FROM commands WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Command | undefined;
    if (!cmd) return false;

    try {
      const resolvedPath = resolveCommandFile(projectId, cmd.file_path);
      if (existsSync(resolvedPath)) unlinkSync(resolvedPath);
    } catch { /* file may already be gone */ }

    db.prepare("DELETE FROM commands WHERE id = ?").run(cmd.id);
    checkpointAfterWrite();
    return true;
  });
}

/**
 * Update a command's file path and/or content.
 * If the file_path changed, the old file is removed and the content is moved
 * (or written anew if content was also provided).
 * Path validation is applied on new file paths.
 */
export function updateCommand(
  projectId: string,
  name: string,
  updates: { file_path?: string; content?: string }
): Command | undefined {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const existing = db.prepare("SELECT * FROM commands WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Command | undefined;
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const newFilePath = updates.file_path ?? existing.file_path;
    const newContent = updates.content !== undefined ? updates.content : (existing.content ?? "");

    if (updates.file_path) validateCommandPath(updates.file_path, projectId);

    db.prepare(
      "UPDATE commands SET file_path = ?, content = ?, updated_at = ? WHERE id = ?"
    ).run(newFilePath, newContent, now, existing.id);

    if (updates.content !== undefined) {
      ensureCommandDir(projectId);
      if (updates.file_path && updates.file_path !== existing.file_path) {
        try {
          const oldPath = resolveCommandFile(projectId, existing.file_path);
          if (existsSync(oldPath)) unlinkSync(oldPath);
        } catch { /* ignore */ }
      }
      const writePath = resolveCommandFile(projectId, newFilePath);
      mkdirSync(dirname(writePath), { recursive: true });
      writeFileSync(writePath, newContent);
    } else if (updates.file_path && updates.file_path !== existing.file_path) {
      ensureCommandDir(projectId);
      const oldPath = resolveCommandFile(projectId, existing.file_path);
      const newPath = resolveCommandFile(projectId, newFilePath);
      if (existsSync(oldPath)) {
        const body = readFileSync(oldPath, "utf-8");
        mkdirSync(dirname(newPath), { recursive: true });
        writeFileSync(newPath, body);
        unlinkSync(oldPath);
      }
    }

    checkpointAfterWrite();
    return db.prepare("SELECT * FROM commands WHERE id = ?").get(existing.id) as Command;
  });
}
