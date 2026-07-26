/**
 * LLM-powered smart-reply suggestion engine.
 *
 * Uses voice samples from the user's Sent folder (few-shot examples) and a
 * configured LLM to generate 3 distinct reply drafts for a target email.
 * Falls back gracefully on any failure — returns an empty array, never throws.
 *
 * 🔴 All functions follow "return sentinel, never throw" pattern — the caller
 *    (sync-engine) is a long-lived background loop and must not crash.
 * 🔴 max_tokens is set to 8192 (never falls back to reasoning_content) per
 *    AGENTS.md HARD RULE #10 — reasoning models may return empty content.
 */
import type { EmailAccount, OAuthToken } from "./types.js";
export interface SmartReply {
    /** Tone label (e.g., "concise", "warm", "formal"). Max 50 chars. */
    tone: string;
    /** Reply subject line. Max 200 chars. */
    subject: string;
    /** Reply body text. Max 2000 chars. */
    body: string;
}
export interface LLMConfig {
    model: string;
    /** OpenAI-compatible API endpoint. Supports custom endpoints (e.g., Ollama, vLLM, LiteLLM). */
    endpoint?: string;
    apiKey?: string;
    allowPrivateNetwork?: boolean;
}
/**
 * Collect recent Sent emails with cached bodies to use as few-shot voice samples.
 *
 * 1. Calls GmailProvider.listMessages for the Sent folder
 * 2. Filters to UIDs with an already-cached body (avoids live fetches)
 * 3. Extracts .text from cached bodies, truncated to 400 chars
 *
 * Returns up to `limit` objects. Never throws — returns empty array on any error.
 */
export declare function getVoiceSamples(account: EmailAccount, tokens: OAuthToken, limit?: number, _signal?: AbortSignal): Promise<Array<{
    subject: string;
    snippet: string;
}>>;
/**
 * Call the configured LLM to generate 3 distinct smart replies.
 *
 * Builds a few-shot prompt showing the user's past reply patterns, then asks
 * the LLM to compose 3 distinct reply drafts.
 *
 * Returns an array of exactly 3 SmartReply objects (padded/truncated as needed).
 * Never throws — returns empty array on any failure.
 */
export declare function generateSmartReplies(targetEmail: {
    from: string;
    subject: string;
    bodySnippet: string;
}, voiceSamples: Array<{
    subject: string;
    snippet: string;
}>, llmConfig: LLMConfig, signal?: AbortSignal): Promise<SmartReply[]>;
/**
 * Call the configured LLM to generate a 2-3 sentence summary of an email.
 *
 * Returns the raw summary text. Never throws — returns empty string on any failure.
 */
export declare function generateEmailSummary(emailBody: string, subject: string, llmConfig: LLMConfig): Promise<string>;
/**
 * Call the configured LLM to review and improve a draft email.
 *
 * Returns the improved text. Never throws — returns empty string on any failure.
 */
export declare function reviewDraft(text: string, subject: string | undefined, llmConfig: LLMConfig): Promise<string>;
//# sourceMappingURL=suggest-llm.d.ts.map