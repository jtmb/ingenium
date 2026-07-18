/** List all projects known to the Ingenium API. */
export declare function projectList(): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Initialise a new project on the Ingenium API. */
export declare function projectInit(name: string, isGlobal?: boolean): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Delete a project by name. */
export declare function projectDelete(name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Restore a previously deleted project. */
export declare function projectRestore(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** List all archived (deleted) projects. */
export declare function projectListArchived(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Purge old projects based on retention period. */
export declare function projectPurge(project: string, retentionDays?: number): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Mark a project as global (or unmark). */
export declare function projectSetGlobal(project: string, name: string, isGlobal: boolean): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Rename a project. */
export declare function projectRename(_project: string, name: string, newName: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Get detailed info about a project by name (no project param needed). */
export declare function projectDetail(name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Run the DB-only historical /workspace migration. */
export declare function projectMigrateWorkspace(dryRun?: boolean): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=projects.d.ts.map