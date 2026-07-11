import { Skill } from "../schema.js";
export declare function listSkills(projectId: string): Skill[];
export declare function getSkill(projectId: string, name: string): Skill | undefined;
export declare function searchSkills(projectId: string, query: string): Skill[];
export declare function createSkill(projectId: string, name: string, description: string, content: string, category?: string, tags?: string, alwaysApply?: number, fileTree?: string): Skill;
export declare function updateSkill(projectId: string, name: string, content: string, description?: string, tags?: string, alwaysApply?: number, fileTree?: string): Skill | undefined;
export declare function deleteSkill(projectId: string, name: string): boolean;
export declare function enableSkill(projectId: string, name: string): Skill | undefined;
export declare function disableSkill(projectId: string, name: string): Skill | undefined;
export declare function syncSkillFromDisk(projectId: string, name: string): Skill | undefined;
export declare function syncAllSkills(projectId: string, db?: any): number;
export declare function copySkills(sourceProjectId: string, targetProjectId: string): number;
//# sourceMappingURL=skills.d.ts.map