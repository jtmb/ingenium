/**
 * Project CRUD — manages the two-project identity model (see AGENTS.md).
 *
 * Every project gets a UUID-based ID and a named directory under INGENIUM_HOME/projects/.
 * Global projects (is_global=1) serve as shared resource roots; normal projects are
 * tied to external worktree sessions. Skills auto-cascade from global → new projects.
 *
 * 🔴 All mutations use execTransaction() with checkpointAfterWrite() outside the txn.
 */
import { Project } from "../schema.js";
/** List all projects, newest first. */
export declare function listProjects(): Project[];
export declare const MAX_PROJECT_NAME_LENGTH = 64;
/** Names are identifiers, never paths. Keep this contract aligned with the extension resolver. */
export declare function isValidProjectName(value: unknown): value is string;
export declare function createProject(name: string, isGlobal?: boolean): Project;
/**
 * Soft-delete a project by setting archived_at.
 * Archived projects are excluded from the active list but can be restored.
 * Returns false if the project doesn't exist or is already archived.
 */
export declare function archiveProject(name: string): boolean;
/** Restore a previously archived project by clearing its archived_at timestamp. */
export declare function unarchiveProject(name: string): boolean;
/** List archived projects, newest-archived first. */
export declare function listArchivedProjects(): Project[];
/**
 * Permanently delete projects whose archived_at is older than retentionDays.
 * This is the only hard-delete path — used by the scheduled purge job.
 * Returns the number of projects deleted.
 */
export declare function purgeExpiredProjects(retentionDays: number): number;
/**
 * Hard-delete a project by name without touching its filesystem directory.
 * Referenced projects return a typed result rather than leaking a SQLite constraint
 * exception through the API.
 */
export type ProjectDeletionResult = {
    status: "deleted";
} | {
    status: "not_found";
} | {
    status: "has_children";
    childTables: string[];
};
export declare function deleteProject(name: string): ProjectDeletionResult;
/** Look up a project by name (case-sensitive). Returns undefined if not found. */
export declare function getProject(name: string): Project | undefined;
/** Rename a project. Returns the updated project, or undefined if not found. */
export declare function updateProject(currentName: string, newName: string): Project | undefined;
/**
 * Toggle a project's global flag. When isGlobal=true, the project's skills/plugins
 * become the shared baseline for all other projects. Only one project should be
 * global at a time (not enforced here — UI layer manages this).
 */
export declare function setProjectGlobal(name: string, isGlobal: boolean): boolean;
/** Get the single global project (is_global=1, not archived). There should be at most one. */
export declare function getGlobalProject(): Project | undefined;
export interface WorkspaceMigrationResult {
    migrated: boolean;
    dryRun: boolean;
    manifestId?: string;
    sourceSkillCount: number;
    sourceHashes: Array<{
        name: string;
        sha256: string;
    }>;
    movedChildRows: Record<string, number>;
    collisions: Array<{
        name: string;
        destinationName: string;
        sha256: string;
    }>;
}
/**
 * Move the historical DB-only /workspace project into global-default.
 * This intentionally never reads, renames, or deletes the /workspace filesystem path.
 */
export declare function migrateWorkspaceProject(dryRun?: boolean): WorkspaceMigrationResult;
export interface ProjectDetail {
    project: Project;
    skills_count: number;
    recent_skills: Array<{
        name: string;
        description: string;
        created_at: string;
    }>;
    observation_stats: {
        total: number;
        pending: number;
        processed: number;
        recent: Array<{
            observation_type: string;
            content: string;
            created_at: string;
        }>;
    };
    pipeline: Array<{
        event_type: string;
        title: string;
        created_at: string;
    }>;
    latest_synthesis: string | null;
    latest_synthesis_result: unknown;
}
/**
 * Get a comprehensive project snapshot for the dashboard: project metadata,
 * skill count + recent skills, observation stats + recent observations,
 * recent pipeline events, and the latest synthesis timestamp.
 *
 * Runs 9 independent SELECT queries — acceptable for the dashboard use case
 * but not suitable for high-frequency API endpoints.
 */
export declare function getProjectDetail(name: string): ProjectDetail | undefined;
//# sourceMappingURL=projects.d.ts.map