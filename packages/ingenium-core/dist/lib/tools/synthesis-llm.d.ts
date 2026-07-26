import { Observation, PersonalityTrait, Skill } from "../schema.js";
/**
 * Structured response from the LLM synthesis engine.
 * The LLM returns JSON matching this shape.
 */
export interface SynthesisLLMResult {
    skills_to_create: Array<{
        name: string;
        description: string;
        content: string;
        tags?: string;
        reference_files?: Array<{
            path: string;
            content: string;
        }>;
    }>;
    skills_to_update: Array<{
        name: string;
        patch: string;
        patch_type: "add-rule" | "update-section" | "add-pattern";
        reference_files?: Array<{
            path: string;
            content: string;
        }>;
    }>;
    personality_traits?: Array<{
        trait_type: PersonalityTrait["trait_type"];
        trait_value: string;
        confidence: number;
    }>;
    insights: string[];
    summary: string;
}
/**
 * Call the LLM synthesis engine.
 *
 * @param observations - Pending observations to analyze
 * @param existingSkills - Current skills in the workspace (for dedup context)
 * @param existingTraits - Current personality traits (for context)
 * @param endpoint - OpenAI-compatible API endpoint URL (e.g. "https://api.openai.com/v1")
 * @param model - Model name (e.g. "gpt-4o", "xai/grok-4")
 * @param apiKey - API key for the provider
 * @returns Structured synthesis result
 */
export declare function callSynthesisLLM(observations: Observation[], existingSkills: Pick<Skill, "name" | "description">[], existingTraits: Pick<PersonalityTrait, "trait_type" | "trait_value" | "confidence">[], endpoint: string, model: string, apiKey?: string, signal?: AbortSignal, allowPrivateNetwork?: boolean): Promise<SynthesisLLMResult>;
export interface LLMConfig {
    model: string;
    apiKey?: string;
    endpoint?: string;
    allowPrivateNetwork?: boolean;
}
/**
 * Resolve LLM configuration with a fallback chain:
 *   1. Global project (is_global = 1) → "synthesis_model", "synthesis_api_key", "synthesis_endpoint"
 *   2. Current project (projectId) settings
 *   3. Environment variables: SYNTHESIS_MODEL, SYNTHESIS_API_KEY, SYNTHESIS_ENDPOINT
 *
 * Returns null if no config is found anywhere.
 */
export declare function resolveLLMConfig(projectId?: string): LLMConfig | null;
/**
 * Check if LLM synthesis is configured for the global project,
 * with fallback to the current project and env vars.
 */
export declare function isLLMSynthesisConfigured(projectId: string): boolean;
/**
 * Get the configured LLM synthesis settings.
 * Falls back: global → project → env vars.
 */
export declare function getLLMSynthesisConfig(projectId: string): {
    model: string;
    apiKey?: string;
} | null;
/**
 * Result from the trait consolidation LLM call.
 */
export interface ConsolidationResult {
    create: Array<{
        trait_type: PersonalityTrait["trait_type"];
        trait_value: string;
        confidence_hint: number;
        observation_ids: number[];
    }>;
    confirm: Array<{
        trait_id: number;
        observation_id: number;
    }>;
    ignore: number;
}
/**
 * Consolidate raw observations into normalized personality traits via LLM.
 * Returns null if LLM is not configured, signaling the caller to skip trait
 * creation and leave observations pending for a future cycle.
 */
export declare function consolidateTraits(projectId: string, observations: Array<{
    id: number;
    observation_type: string;
    content: string;
}>, existingTraits: Array<{
    id: number;
    trait_type: string;
    trait_value: string;
    confidence: number;
}>): Promise<ConsolidationResult | null>;
export interface EnrichedObservation {
    type: string;
    content: string;
    enriched_content?: string;
    context?: string;
    skip?: boolean;
}
/**
 * Enrich auto-observer observations using the configured LLM.
 * Falls back to original content on any error.
 *
 * @param observations - Raw observations from the auto-observer with optional conversation context
 * @param endpoint - OpenAI-compatible API endpoint URL
 * @param model - Model name
 * @param apiKey - API key
 * @param signal - Optional AbortSignal
 * @returns Enriched observations (falls back to originals on error)
 */
export declare function enrichObservations(observations: Array<{
    type: string;
    content: string;
    context?: string;
}>, endpoint: string, model: string, apiKey?: string, signal?: AbortSignal, allowPrivateNetwork?: boolean): Promise<EnrichedObservation[]>;
/**
 * Get the full LLM synthesis config including endpoint.
 * Falls back: global → project → env vars.
 *
 * @param projectId — Optional project ID for per-project fallback.
 *   If omitted, only checks global config + env vars.
 */
export declare function getFullLLMSynthesisConfig(projectId?: string): {
    model: string;
    apiKey?: string;
    endpoint?: string;
    allowPrivateNetwork?: boolean;
} | null;
/**
 * Result from the skill consolidation LLM call.
 * The LLM proposes merges (combine two overlapping skills) and deletes (remove redundant skills).
 */
export interface ConsolidationSkillResult {
    merges: Array<{
        source: string;
        target: string;
        reason: string;
    }>;
    delete: string[];
}
/**
 * Build the prompt for the skill consolidation audit.
 * The LLM receives the full skill catalog and proposes merges/deletes to reach ≤20 skills.
 */
export declare function buildConsolidationPrompt(skills: Array<{
    name: string;
    description: string;
    tags: string;
    content_preview: string;
}>, total: number): string;
/**
 * Call the LLM to audit all skills and propose merges/deletes.
 *
 * @param projectId - Project to act on
 * @param prompt - The consolidation prompt built by buildConsolidationPrompt
 * @returns Structured merge/delete proposals
 */
export declare function callConsolidationLLM(projectId: string, prompt: string, overrideEndpoint?: string, overrideModel?: string, overrideApiKey?: string): Promise<ConsolidationSkillResult>;
//# sourceMappingURL=synthesis-llm.d.ts.map