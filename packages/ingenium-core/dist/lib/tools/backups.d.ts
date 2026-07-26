import { BackupRecord, BackupRestoreJob } from "../schema.js";
/** Create a consistent pair of Ingenium and OpenCode SQLite database snapshots. */
export declare function createSnapshot(projectId: string, backupType: string, dbPath: string, opencodeDbPath: string): Promise<{
    backupId: string;
    filename: string;
    sizeBytes: number;
    sha256: string;
}>;
/** List completed and failed backup records for a project, newest first. */
export declare function listBackups(projectId: string): BackupRecord[];
/** Get one backup record scoped to its owning project. */
export declare function getBackup(projectId: string, backupId: string): BackupRecord | null;
/** Resolve a validated snapshot component path for streaming or restore. */
export declare function getBackupComponentPath(projectId: string, backupId: string, component?: "ingenium" | "opencode"): string | null;
/** Delete backup metadata and its local snapshot component files. */
export declare function deleteBackup(projectId: string, backupId: string): void;
/** Verify snapshot component hashes, SQLite integrity, and the required migration-047 schema. */
export declare function validateRestorePreflight(backupId: string): {
    valid: boolean;
    errors: string[];
    manifest: object;
};
/** Create a restore job after confirming that the backup belongs to the project. */
export declare function startRestore(projectId: string, backupId: string): string;
/** Update a restore job state and record terminal completion timestamps. */
export declare function updateRestoreStatus(jobId: string, status: string, error?: string): void;
/** Get the current state of a restore job. */
export declare function getRestoreStatus(jobId: string): BackupRestoreJob | null;
//# sourceMappingURL=backups.d.ts.map