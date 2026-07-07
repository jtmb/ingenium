/** List all plugins available for a project. */
export declare function pluginList(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Enable a plugin for a project. */
export declare function pluginEnable(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Disable a plugin for a project. */
export declare function pluginDisable(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=plugins.d.ts.map