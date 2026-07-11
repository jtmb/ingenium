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
export declare function pluginCreate(project: string, name: string, filePath: string, sourceContent?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function pluginDelete(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function pluginUpdate(project: string, name: string, updates: {
    file_path?: string;
    source_content?: string;
}): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Get a plugin by name. */
export declare function pluginGet(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=plugins.d.ts.map