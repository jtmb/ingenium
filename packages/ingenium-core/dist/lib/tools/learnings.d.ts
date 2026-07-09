import { Learning } from "../schema.js";
export declare function logLearning(projectId: string, entryType: Learning["entry_type"], content: string, tags?: string, priority?: number, sessionId?: string): Learning;
export declare function searchLearnings(projectId: string, query: string, limit?: number): Learning[];
export declare function recentLearnings(projectId: string, limit?: number): Learning[];
export declare function getLearnings(projectId: string, status?: string, limit?: number): Learning[];
export declare function updateLearning(learningId: number, data: Partial<Pick<Learning, "status" | "entry_type" | "content" | "tags" | "priority">>): Learning | null;
//# sourceMappingURL=learnings.d.ts.map