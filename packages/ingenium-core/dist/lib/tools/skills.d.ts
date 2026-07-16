import { Skill, SkillVersion } from "../schema.js";
/**
 * Validate a skill name for filesystem safety.
 *
 * A safe skill name is a non-empty string ≤ 64 characters that does not contain
 * path separators (`/`, `\\`), null bytes, and is not `.` or `..`.
 * Spaces and underscores are allowed for backward compatibility.
 *
 * Use before any filesystem path derived from a skill name and before DB
 * mutation entry points that create/update by name.
 */
export declare function isSafeSkillName(name: unknown): name is string;
/**
 * Validate file_tree value: must be undefined, null, or a JSON string representing
 * a non-array object whose values are all strings. Empty-string, arrays, primitives,
 * and non-string values are invalid.
 */
export declare function isValidSkillFileTree(value: unknown): boolean;
/**
 * Strip ALL leading YAML frontmatter blocks from text.
 * Handles BOM, CRLF, and stacked/repeated blocks (idempotent).
 * Returns text unchanged if no frontmatter is found.
 */
export declare function stripLeadingFrontmatter(text: string): string;
/** List all enabled skills for a project. */
export declare function listSkills(projectId: string): Skill[];
/** List all archived skills for a project. */
export declare function listArchivedSkills(projectId: string): Skill[];
/** Get a single skill by project and name (active or archived). Returns undefined if not found. */
export declare function getSkill(projectId: string, name: string): Skill | undefined;
/** Get a skill by its UUID id. Returns undefined if not found. */
export declare function getSkillById(skillId: string): Skill | undefined;
/**
 * Full-text search across skills using FTS5.
 * Returns results ranked by BM25 relevance. Falls back to an empty array
 * if sanitizeFts5Query rejects the input.
 */
export declare function searchSkills(projectId: string, query: string): Skill[];
/**
 * Get all version snapshots for a skill, ordered by revision descending (newest first).
 */
export declare function getSkillVersions(skillId: string): SkillVersion[];
/**
 * Get a specific version of a skill by revision number.
 */
export declare function getSkillVersion(skillId: string, revision: number): SkillVersion | undefined;
/**
 * Write a skill's full representation to disk.
 *
 * Does NOT write if the skill is archived (SKILL.md removed, but auxiliary files preserved).
 */
export declare function writeSkillToDisk(skill: Skill): void;
/** Remove only SKILL.md from disk for a given skill (preserves metadata.json and all auxiliary files). */
export declare function removeSkillMdOnly(name: string, projectId?: string): void;
/**
 * Create or upsert a skill for a project.
 * Increments revision on every call (create starts at 0, upsert bumps existing).
 *
 * Uses ON CONFLICT ... DO UPDATE SET for atomic upsert.
 * Writes to DB first (transactional), THEN to disk after transaction commits.
 *
 * 🔴 checkpointAfterWrite() is OUTSIDE execTransaction() — WAL safety.
 */
export declare function createSkill(projectId: string, name: string, description: string, content: string, category?: string, tags?: string, alwaysApply?: number, fileTree?: string): Skill;
/**
 * Update a skill's content and metadata. Increments revision.
 *
 * FTS5 sync handled by AFTER UPDATE triggers (migration 024).
 * Version snapshot handled by AFTER UPDATE trigger (migration 042) — fires only because revision changes.
 *
 * Returns undefined if the skill doesn't exist.
 */
export declare function updateSkill(projectId: string, name: string, content: string, description?: string, tags?: string, alwaysApply?: number, fileTree?: string): Skill | undefined;
/**
 * Enable a skill and write it to disk after the DB transaction commits.
 * Increments revision to capture enablement in version history.
 */
export declare function enableSkill(projectId: string, name: string): Skill | undefined;
/** Disable a skill and remove SKILL.md from disk after the DB transaction commits. */
export declare function disableSkill(projectId: string, name: string): Skill | undefined;
/**
 * Archive a skill (soft-delete): sets archived_at, removes only SKILL.md from disk
 * but preserves metadata.json and all auxiliary source files (file_tree contents).
 *
 * The skill remains in the DB with archived_at set and is excluded from listSkills().
 * Auxiliary files are preserved for potential restoration. Only SKILL.md is removed
 * to make it undiscoverable — metadata.json and all file_tree content survive.
 *
 * 🔴 No-op if the skill is already archived (returns undefined, no revision bump).
 * Returns undefined if the skill doesn't exist.
 */
export declare function archiveSkill(projectId: string, name: string): Skill | undefined;
/**
 * Restore an archived skill: clears archived_at, writes full representation to disk.
 *
 * 🔴 No-op if the skill is NOT archived (returns undefined, no revision bump).
 * Returns undefined if the skill doesn't exist.
 */
export declare function restoreSkill(projectId: string, name: string): Skill | undefined;
/**
 * Rollback a skill to a prior revision.
 *
 * Loads the immutable skill_versions row for the given revision, applies its exact
 * state as a NEW revision, and writes disk. This ensures history remains append-only
 * and the restored state is byte-equivalent to the prior revision.
 *
 * Returns undefined if the skill or version record doesn't exist.
 */
export declare function rollbackSkill(projectId: string, name: string, targetRevision: number): Skill | undefined;
/**
 * Delete a skill (archive semantics only).
 *
 * ⚠️ This function now delegates to archiveSkill. The old hard-delete behavior is no
 * longer available — skills are never permanently deleted from the DB. This preserves
 * the version history and allows restoration.
 *
 * Use archiveSkill() explicitly for new code. deleteSkill() is retained for backward
 * compatibility with existing callers (API layer, MCP tools, etc.).
 *
 * Returns false if the skill doesn't exist, true if successfully archived.
 */
export declare function deleteSkill(projectId: string, name: string): boolean;
/**
 * Sync a skill from its `.opencode/skills/<name>/` directory on disk into the DB.
 *
 * 🔴 Filesystem I/O (reads, directory walks) happens OUTSIDE the DB transaction.
 * Only a short compare/upsert runs inside execTransaction. Path traversal security
 * checks are preserved in the pre-transaction read phase.
 *
 * Avoids revision bump when content/metadata/fileTree are unchanged.
 * Protects archived skills (disk is not authoritative for archived state).
 */
export declare function syncSkillFromDisk(projectId: string, name: string): Skill | undefined;
/**
 * Write all enabled, non-archived skills for a project to disk.
 */
export declare function syncAllSkills(projectId: string, db?: any): number;
/**
 * Copy all enabled skills from one project to another.
 * Increments revision on newly created skills.
 */
export declare function copySkills(sourceProjectId: string, targetProjectId: string): number;
//# sourceMappingURL=skills.d.ts.map