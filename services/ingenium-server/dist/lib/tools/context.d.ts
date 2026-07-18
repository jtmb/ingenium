/** Save a context entry with optional tags and priority. */
export declare function planSave(project: string, content: string, tags?: string, priority?: number): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Full-text search across context entries. */
export declare function planSearch(project: string, query: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** List all context entries for a project. */
export declare function planList(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function contextGet(project: string, id: number): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function contextUpdate(project: string, id: number, fields: Record<string, unknown>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function contextDelete(project: string, id: number): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function contextBatch(project: string, ids: number[]): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=context.d.ts.map