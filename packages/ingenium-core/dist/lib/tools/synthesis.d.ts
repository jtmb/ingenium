export interface SynthesisResult {
    observations_processed: number;
    traits_created: number;
    traits_updated: number;
    skills_created: number;
    observations_skipped: number;
    errors: string[];
    summary: string;
}
/**
 * Run the synthesis pipeline: process pending observations into personality traits.
 *
 * The pipeline has two phases:
 *   1. **Trait consolidation** (LLM-driven) — the LLM decides CREATE/CONFIRM/IGNORE
 *      for each observation against existing traits.
 *   2. **Skill synthesis** (LLM-driven, optional) — if an LLM is configured,
 *      the same batch of observations is analyzed to create/update skills.
 *
 * Observations that the LLM acted on (CREATE or CONFIRM) are marked "processed".
 * Observations the LLM explicitly ignored are ALSO marked "processed" so they
 * don't waste tokens in every cycle.
 *
 * Trait decay: traits untouched for 7+ days lose 0.05 confidence per cycle.
 *
 * WARNING: The old heuristic classification described below has been replaced
 *          by LLM-based `consolidateTraits()`. The heuristics are retained here
 *          as documentation only and should be removed when Phase 1 migration
 *          to LLM-only is complete.
 *
 * Legacy heuristics (replaced):
 *   - "correction" → feedback_style, "preference" → code_preference, etc.
 *   - New traits started at 0.05-0.15 confidence (below display threshold 0.3)
 */
export declare function runSynthesis(projectId: string, sessionId?: string): Promise<SynthesisResult>;
/**
 * Get synthesis pipeline status and statistics for a project.
 */
export declare function getSynthesisStatus(projectId: string): {
    total_observations: number;
    pending_count: number;
    processed_count: number;
    trait_count: number;
    last_synthesis_at: string | null;
};
/**
 * Cross-project synthesis: identifies patterns present in 2+ projects
 * and promotes them to the global-default project as shared skills and traits.
 *
 * Skills appearing in ≥2 non-global projects are copied to the global project.
 * Traits with confidence ≥0.7 appearing in ≥2 projects are also promoted.
 * Already-existing global skills are updated to note their cross-project origin.
 */
export declare function runCrossProjectSynthesis(): Promise<SynthesisResult>;
/**
 * Result of a skill consolidation run.
 */
export interface ConsolidationResult {
    merged: number;
    deleted: number;
    summary: string;
}
/**
 * Audit all enabled skills for a project and use the LLM to propose merges/deletes,
 * condensing to ≤20 skills. This is a standalone pass that runs after synthesis,
 * not driven by new observations — it evaluates the entire skill catalog.
 *
 * Pre-consolidation state is saved as a setting (`consolidation_backup`) capped
 * at 50 KB, enabling a manual restore if the LLM's proposals are too aggressive.
 *
 * WARNING: Merges use `stripLeadingFrontmatter()` to avoid embedding YAML in
 *          the middle of the merged document. If either skill lacks frontmatter,
 *          the merge still proceeds (the function returns the body unchanged).
 */
export declare function consolidateSkills(projectId: string): Promise<ConsolidationResult>;
//# sourceMappingURL=synthesis.d.ts.map