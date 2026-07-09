/** Log a new learning entry. Supports optional tags, priority, and session association. */
export declare function learningLog(project: string, entryType: string, content: string, tags?: string, priority?: number, sessionId?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Full-text search across learning entries. */
export declare function learningSearch(project: string, query: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** List all learning entries for a project. */
export declare function learningList(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Scan recent learnings for skill gaps and auto-create tasks for AI engineers to write missing skills. */
export declare function skillFromLearnings(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=learnings.d.ts.map