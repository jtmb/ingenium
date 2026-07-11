import { Plugin } from "../schema.js";
export declare function listPlugins(projectId: string): Plugin[];
export declare function enablePlugin(projectId: string, name: string): Plugin | undefined;
export declare function disablePlugin(projectId: string, name: string): Plugin | undefined;
export declare function ensurePluginDir(projectId?: string): void;
export declare function createPlugin(projectId: string, name: string, filePath: string, sourceContent?: string): Plugin;
export declare function deletePlugin(projectId: string, name: string): boolean;
export declare function updatePlugin(projectId: string, name: string, updates: {
    file_path?: string;
    source_content?: string;
}): Plugin | undefined;
export declare function getPlugin(projectId: string, name: string): Plugin | undefined;
//# sourceMappingURL=plugins.d.ts.map