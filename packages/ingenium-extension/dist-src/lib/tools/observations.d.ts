/** Store a new observation. The agent calls this naturally during workflow. */
export declare function observationStore(project: string, observationType: string, content: string, importance?: number, source?: string, context?: string, sessionId?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Search observations via FTS5 */
export declare function observationSearch(project: string, query: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** List observations with optional status/type filters */
export declare function observationList(project: string, status?: string, type?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Get observation stats */
export declare function observationStats(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=observations.d.ts.map