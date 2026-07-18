import { ContextEntry } from "../schema.js";
export type ContextSource = "manual" | "agent" | "import" | "system";
export interface ContextInput {
    content: string;
    tags?: string[];
    priority?: number;
    sessionId?: string;
    source?: ContextSource;
    metadata?: Record<string, unknown>;
}
export interface ContextPage {
    data: ContextEntry[];
    total: number;
    offset: number;
    limit: number;
}
/**
 * Save a context/plan entry for a project.
 * Entries are used to persist working context across sessions — the task management
 * and plan surface reads from this table.
 *
 * 🔴 WAL SAFETY: checkpointAfterWrite() is called OUTSIDE execTransaction().
 * Calling a WAL checkpoint inside an active transaction causes SQLITE_LOCKED.
 */
export declare function createContext(projectId: string, input: ContextInput): ContextEntry;
/** Backward-compatible plan entry writer. */
export declare function saveContext(projectId: string, content: string, tags?: string, priority?: number): ContextEntry;
/**
 * Full-text search across context entries using FTS5.
 * Returns results ranked by BM25 relevance. Falls back to an empty array
 * if sanitizeFts5Query rejects the input (empty or invalid FTS5 syntax).
 */
export declare function searchContext(projectId: string, query: string, limit?: number): ContextEntry[];
export declare function listContext(projectId: string, limit?: number, offset?: number): ContextPage;
export declare function getContext(projectId: string, id: number): ContextEntry | undefined;
export declare function getContextBatch(projectId: string, ids: number[]): ContextEntry[];
export declare function updateContext(projectId: string, id: number, fields: Partial<ContextInput>): ContextEntry | undefined;
export declare function deleteContext(projectId: string, id: number): boolean;
/** Get the most recent context entries for a project, ordered by creation time descending. */
export declare function recentContext(projectId: string, limit?: number): ContextEntry[];
//# sourceMappingURL=context.d.ts.map