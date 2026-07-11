import { Project } from "../schema.js";
export declare function listProjects(): Project[];
export declare function createProject(name: string, isGlobal?: boolean): Project;
export declare function archiveProject(name: string): boolean;
export declare function unarchiveProject(name: string): boolean;
export declare function listArchivedProjects(): Project[];
export declare function purgeExpiredProjects(retentionDays: number): number;
export declare function deleteProject(name: string): boolean;
export declare function getProject(name: string): Project | undefined;
export declare function updateProject(currentName: string, newName: string): Project | undefined;
export declare function setProjectGlobal(name: string, isGlobal: boolean): boolean;
export declare function getGlobalProject(): Project | undefined;
export interface ProjectDetail {
    project: Project;
    skills_count: number;
    recent_skills: Array<{
        name: string;
        description: string;
        created_at: string;
    }>;
    observation_stats: {
        total: number;
        pending: number;
        processed: number;
        recent: Array<{
            observation_type: string;
            content: string;
            created_at: string;
        }>;
    };
    pipeline: Array<{
        event_type: string;
        title: string;
        created_at: string;
    }>;
    latest_synthesis: string | null;
    latest_synthesis_result: unknown;
}
export declare function getProjectDetail(name: string): ProjectDetail | undefined;
//# sourceMappingURL=projects.d.ts.map