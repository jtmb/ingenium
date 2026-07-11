export declare function agentList(project: string, category?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function agentGet(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function agentCreate(project: string, name: string, content: string, description?: string, category?: string, mode?: string, model?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function agentUpdate(project: string, name: string, updates: Record<string, any>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function agentDelete(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function agentEnable(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function agentDisable(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Sync an agent from its .md file on disk to the DB — edits made directly to the file are persisted. */
export declare function agentSync(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=agents.d.ts.map