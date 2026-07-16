/** List all plugins available for a project. */
export declare function pluginList(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Enable a plugin for a project. Synced to disk + opencode.json plugin array. */
export declare function pluginEnable(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Disable a plugin for a project. Synced to disk + opencode.json plugin array. */
export declare function pluginDisable(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Create a new plugin. Auto-populates sourceContent from disk if empty. */
export declare function pluginCreate(project: string, name: string, filePath: string, sourceContent?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Delete a plugin from a project. */
export declare function pluginDelete(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Update a plugin's file path or source content. */
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
/** Get a plugin's source content directly from disk (not from DB cache). */
export declare function pluginSource(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=plugins.d.ts.map