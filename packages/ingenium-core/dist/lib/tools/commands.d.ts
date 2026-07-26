import { Command } from "../schema.js";
/** Ensure the command file directory exists. Creates recursively if missing. */
export declare function ensureCommandDir(projectId?: string): void;
/** List all commands registered for a project. */
export declare function listCommands(projectId: string): Command[];
/** Get a single command by name. Returns undefined if not found. */
export declare function getCommand(projectId: string, name: string): Command | undefined;
/**
 * Create a new command record and write its content file to disk.
 * The file path is validated against path traversal before any I/O.
 */
export declare function createCommand(projectId: string, name: string, filePath: string, content?: string): Command;
/**
 * Delete a command record and remove its file from disk.
 * File deletion is best-effort (the record is removed even if the file is gone).
 */
export declare function deleteCommand(projectId: string, name: string): boolean;
/**
 * Update a command's file path and/or content.
 * If the file_path changed, the old file is removed and the content is moved
 * (or written anew if content was also provided).
 * Path validation is applied on new file paths.
 */
export declare function updateCommand(projectId: string, name: string, updates: {
    file_path?: string;
    content?: string;
}): Command | undefined;
//# sourceMappingURL=commands.d.ts.map