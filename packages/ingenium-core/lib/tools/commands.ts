import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { Command } from "../schema.js";
import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";

function validateCommandPath(filePath: string): string {
  if (!/^[a-zA-Z0-9_\-./]+$/.test(filePath)) {
    throw new Error(`Invalid command file path: ${filePath}`);
  }
  const baseDir = resolve(getProjectRoot(), ".opencode/commands");
  const resolved = resolve(baseDir, filePath);
  const rel = relative(baseDir, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Command path escapes base directory: ${filePath}`);
  }
  return filePath;
}

function getProjectRoot(): string {
  return resolve(process.env.INGENIUM_CORE_DB_PATH ?? "./data", "..", "..");
}

export function ensureCommandDir(): void {
  const dir = resolve(getProjectRoot(), ".opencode/commands");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function listCommands(projectId: string): Command[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM commands WHERE project_id = ?").all(projectId) as Command[];
}

export function getCommand(projectId: string, name: string): Command | undefined {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM commands WHERE project_id = ? AND name = ?")
    .get(projectId, name) as Command | undefined;
}

export function createCommand(
  projectId: string,
  name: string,
  filePath: string,
  content?: string
): Command {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    validateCommandPath(filePath);
    const now = new Date().toISOString();
    const id = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const body = content ?? "";

    db.prepare(
      `INSERT INTO commands (id, project_id, name, file_path, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, projectId, name, filePath, body, now, now);

    ensureCommandDir();
    if (body) {
      writeFileSync(resolve(getProjectRoot(), ".opencode/commands", filePath), body);
    }

    checkpointAfterWrite();
    return db.prepare("SELECT * FROM commands WHERE id = ?").get(id) as Command;
  });
}

export function deleteCommand(projectId: string, name: string): boolean {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const cmd = db.prepare("SELECT * FROM commands WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Command | undefined;
    if (!cmd) return false;

    try {
      const resolvedPath = resolve(getProjectRoot(), ".opencode/commands", validateCommandPath(cmd.file_path));
      if (existsSync(resolvedPath)) unlinkSync(resolvedPath);
    } catch { /* file may already be gone */ }

    db.prepare("DELETE FROM commands WHERE id = ?").run(cmd.id);
    checkpointAfterWrite();
    return true;
  });
}

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

    if (updates.file_path) validateCommandPath(updates.file_path);

    db.prepare(
      "UPDATE commands SET file_path = ?, content = ?, updated_at = ? WHERE id = ?"
    ).run(newFilePath, newContent, now, existing.id);

    if (updates.content !== undefined) {
      ensureCommandDir();
      if (updates.file_path && updates.file_path !== existing.file_path) {
        try {
          const oldPath = resolve(getProjectRoot(), ".opencode/commands", existing.file_path);
          if (existsSync(oldPath)) unlinkSync(oldPath);
        } catch { /* ignore */ }
      }
      writeFileSync(resolve(getProjectRoot(), ".opencode/commands", newFilePath), newContent);
    } else if (updates.file_path && updates.file_path !== existing.file_path) {
      ensureCommandDir();
      const oldPath = resolve(getProjectRoot(), ".opencode/commands", existing.file_path);
      const newPath = resolve(getProjectRoot(), ".opencode/commands", newFilePath);
      if (existsSync(oldPath)) {
        const body = readFileSync(oldPath, "utf-8");
        writeFileSync(newPath, body);
        unlinkSync(oldPath);
      }
    }

    checkpointAfterWrite();
    return db.prepare("SELECT * FROM commands WHERE id = ?").get(existing.id) as Command;
  });
}
