/**
 * Personality trait persistence — CRUD for learned user behavior traits.
 *
 * Traits are the durable output of the self-learning pipeline. Observations are
 * synthesized into traits with confidence scores. Confidence starts at 0.5 for
 * newly created traits, gets +0.1 on each re-observation, and caps at 0.95.
 * The display gate at 0.30 prevents noise from appearing in the profile.
 *
 * 🔴 All mutations use execTransaction() with checkpointAfterWrite() outside the txn.
 */
import { PersonalityTrait } from "../schema.js";
/**
 * Upsert a personality trait keyed by (project_id, trait_type, trait_value).
 *
 * If the trait already exists, this is a "re-observation": confidence is boosted
 * by +0.1 (capped at 0.95) and optional exemplar/label fields are updated.
 * If it was previously disabled (is_active = 0), it's re-activated.
 *
 * New traits start at default confidence 0.5 — above the display gate of 0.30
 * so they immediately appear in the profile.
 */
export declare function upsertTrait(projectId: string, traitType: PersonalityTrait["trait_type"], traitValue: string, label?: string, confidence?: number, exemplarObservationId?: number, exemplarText?: string): PersonalityTrait;
/**
 * List all traits for a project, optionally including inactive (disabled) ones.
 * Returned in descending confidence order so the strongest traits come first.
 */
export declare function listTraits(projectId: string, includeInactive?: boolean): PersonalityTrait[];
/**
 * Filter traits by optional trait type and minimum confidence threshold.
 * Only returns active traits. Uses post-filtering (not SQL) so the query is
 * simple and the dataset is small enough for in-memory filtering.
 */
export declare function getTraits(projectId: string, traitType?: PersonalityTrait["trait_type"], minConfidence?: number): PersonalityTrait[];
/**
 * Get the full personality profile as an array of (trait_type → grouped traits).
 * By default excludes traits below 0.30 confidence (the "display gate").
 *
 * The 0.30 threshold avoids showing speculative traits from a single observation
 * while allowing traits to appear quickly after just 2-3 reinforcing observations.
 * New traits start at 0.50, so one re-observation puts them at 0.60 — well above gate.
 * A trait at 0.30 needs ~3 observations starting from 0.5 with decay, or is explicitly
 * set there by synthesis.
 */
export declare function getProfile(projectId: string, options?: {
    includeHidden?: boolean;
}): Array<{
    project_id: string;
    trait_type: string;
    traits: string;
}>;
/**
 * Soft-delete a trait by ID — sets is_active = 0.
 * The trait remains in the DB for history but is excluded from getProfile().
 */
export declare function disableTrait(id: number): boolean;
/**
 * Enable or disable a specific trait by ID, scoped to a project.
 * Used by the dashboard toggle and the personaility-trait-dismiss MCP tool.
 */
export declare function setActive(projectId: string, traitId: number, active: boolean): void;
/**
 * Apply a signed delta to a trait's confidence (e.g., +0.15 for confirmation,
 * -0.10 for contradiction). Clamped to [0.0, 0.95] — the 0.95 ceiling matches
 * upsertTrait's cap to prevent runaway confidence from repeated reinforcement.
 * Returns the updated trait, or null if not found.
 */
export declare function updateConfidence(projectId: string, traitType: PersonalityTrait["trait_type"], traitValue: string, delta: number): PersonalityTrait | null;
/**
 * Hard-delete a single trait by ID, scoped to project.
 * Returns true if a row was actually deleted.
 */
export declare function deleteTrait(projectId: string, id: number): boolean;
/**
 * Hard-delete ALL traits for a project. Used by the "reset personality"
 * workflow — returns the count of deleted rows.
 */
export declare function deleteAllTraits(projectId: string): number;
//# sourceMappingURL=personality.d.ts.map