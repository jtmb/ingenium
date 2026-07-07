import { Learning } from "../schema.js";
export declare function logLearning(projectId: string, entryType: Learning["entry_type"], content: string, tags?: string, priority?: number, sessionId?: string): Learning;
export declare function searchLearnings(projectId: string, query: string, limit?: number): Learning[];
export declare function recentLearnings(projectId: string, limit?: number): Learning[];
//# sourceMappingURL=learnings.d.ts.map