/**
 * Get a setting value by project and key.
 * @returns The stored value, or `defaultVal` if the key is not set.
 */
export declare function getSetting(projectId: string, key: string, defaultVal?: string): string | undefined;
/**
 * Set a setting value (upsert). Returns the set value.
 * Uses ON CONFLICT ... DO UPDATE SET for atomic upsert — avoids a separate SELECT + branch.
 */
export declare function setSetting(projectId: string, key: string, value: string): string;
//# sourceMappingURL=settings.d.ts.map