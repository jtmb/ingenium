import { ContextEntry } from "../schema.js";
export declare function saveContext(projectId: string, content: string, tags?: string, priority?: number): ContextEntry;
export declare function searchContext(projectId: string, query: string, limit?: number): ContextEntry[];
export declare function recentContext(projectId: string, limit?: number): ContextEntry[];
//# sourceMappingURL=context.d.ts.map