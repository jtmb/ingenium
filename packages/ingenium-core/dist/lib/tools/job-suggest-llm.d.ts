import type { LLMConfig } from "./synthesis-llm.js";
/** The result shape returned by generateJobConfig. All fields nullable on any error. */
export interface JobSuggestResult {
    prompt_template: string | null;
    schedule_cron: string | null;
    trigger_event: string | null;
}
/**
 * Derive a job configuration (prompt_template, schedule_cron, trigger_event)
 * from a free-text description using the configured Synthesis LLM.
 *
 * Returns nulls for all fields on any error — this function never throws.
 * Logs diagnostics (via the `logger` module) when the LLM produces zero
 * output so that silent failures are visible in the logs.
 *
 * @param config — Resolved LLM config (model, apiKey, endpoint)
 * @param description — Free-text description of the job (truncated to 2000 chars)
 */
export declare function generateJobConfig(config: LLMConfig, description: string): Promise<JobSuggestResult>;
//# sourceMappingURL=job-suggest-llm.d.ts.map