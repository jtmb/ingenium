/**
 * Resolve the project root for disk operations.
 * For global (is_global=1) projects, returns the global OpenCode config directory.
 * For normal projects, returns the project root derived from INGENIUM_CORE_DB_PATH.
 */
export declare function resolveProjectBase(projectId?: string): string;
/**
 * Check whether a project ID corresponds to the global project (is_global=1).
 * Silently returns false if the project doesn't exist or DB is unavailable —
 * callers treat "not global" as the safe default for path resolution.
 */
export declare function isGlobal(projectId?: string): boolean;
/**
 * Resolve the skills directory for a project.
 * Global: <config>/skills/  |  Normal: <project>/.opencode/skills/
 */
export declare function getSkillsBase(projectId?: string): string;
/**
 * Resolve the plugins directory for a project.
 * Global: <config>/plugins/  |  Normal: <project>/.opencode/plugins/
 */
export declare function getPluginsBase(projectId?: string): string;
/**
 * Resolve the commands directory for a project.
 * Global: <config>/commands/  |  Normal: <project>/.opencode/commands/
 */
export declare function getCommandsBase(projectId?: string): string;
export declare function getConfigPath(projectId?: string): string;
//# sourceMappingURL=paths.d.ts.map