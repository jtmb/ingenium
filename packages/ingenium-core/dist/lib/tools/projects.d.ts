import { Project } from "../schema.js";
export declare function listProjects(): Project[];
export declare function createProject(name: string, isGlobal?: boolean): Project;
export declare function archiveProject(name: string): boolean;
export declare function unarchiveProject(name: string): boolean;
export declare function listArchivedProjects(): Project[];
export declare function purgeExpiredProjects(retentionDays: number): number;
export declare function getProject(name: string): Project | undefined;
export declare function updateProject(currentName: string, newName: string): Project | undefined;
export declare function setProjectGlobal(name: string, isGlobal: boolean): boolean;
export declare function getGlobalProject(): Project | undefined;
//# sourceMappingURL=projects.d.ts.map