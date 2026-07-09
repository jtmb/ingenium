/** List all skills for a project. */
export declare function skillList(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Load a single skill by name. */
export declare function skillLoad(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Full-text search across skills. */
export declare function skillSearch(project: string, query: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Create a new skill. */
export declare function skillCreate(project: string, name: string, description: string, content: string, category?: string, tags?: string, always_apply?: number, files?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Update an existing skill's content. */
export declare function skillUpdate(project: string, name: string, content: string, description?: string, tags?: string, always_apply?: number, files?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Delete a skill by name. */
export declare function skillDelete(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Enable a skill and sync to disk. */
export declare function skillEnable(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Disable a skill and remove from disk. */
export declare function skillDisable(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Sync a skill from its .md file on disk to the DB — edits made directly to the file are persisted. */
export declare function skillSync(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=skills.d.ts.map