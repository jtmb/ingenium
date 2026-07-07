/** Save a context entry with optional tags and priority. */
export declare function contextSave(project: string, content: string, tags?: string, priority?: number): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Full-text search across context entries. */
export declare function contextSearch(project: string, query: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=context.d.ts.map