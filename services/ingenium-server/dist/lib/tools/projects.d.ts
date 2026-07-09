/** List all projects known to the Ingenium API. */
export declare function projectList(): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Initialise a new project on the Ingenium API. */
export declare function projectInit(name: string): Promise<{
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
//# sourceMappingURL=projects.d.ts.map