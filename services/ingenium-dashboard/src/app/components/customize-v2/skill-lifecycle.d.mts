import type { Skill } from "../../../lib/api";
export function createSkillLifecycle(request: <T>(path: string, options?: RequestInit) => Promise<T>): {
  list(project: string): Promise<{active: Skill[]; archived: Skill[]}>;
  change(project: string, name: string, action: "archive" | "restore"): Promise<{outcome: "succeeded" | "refused" | "unknown"; message?: string}>;
};
