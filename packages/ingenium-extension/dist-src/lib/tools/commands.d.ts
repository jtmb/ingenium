/** List all commands for a project. */
export declare function commandList(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Get a command by name. */
export declare function commandGet(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Create a new command. */
export declare function commandCreate(project: string, name: string, filePath: string, content?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Update an existing command. */
export declare function commandUpdate(project: string, name: string, updates: {
    file_path?: string;
    content?: string;
}): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Delete a command. */
export declare function commandDelete(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=commands.d.ts.map