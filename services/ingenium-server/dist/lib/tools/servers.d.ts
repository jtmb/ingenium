/** List all registered child MCP servers for a project. */
export declare function serverList(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Add a new child MCP server definition. */
export declare function serverAdd(project: string, name: string, command: string, args?: string, env?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Remove a child MCP server definition. */
export declare function serverRemove(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=servers.d.ts.map