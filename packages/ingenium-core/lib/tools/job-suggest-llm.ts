import { logger } from "../logger.js";
import type { LLMConfig } from "./synthesis-llm.js";

/** The result shape returned by generateJobConfig. All fields nullable on any error. */
export interface JobSuggestResult {
  prompt_template: string | null;
  schedule_cron: string | null;
  trigger_event: string | null;
}

// ── Truncation caps ──────────────────────────────────────────
const MAX_DESCRIPTION = 2000;
const MAX_PROMPT_TEMPLATE = 4000;
const MAX_CRON = 100;
const MAX_TRIGGER_EVENT = 100;

function buildPrompt(description: string): string {
  return `You are a job configuration assistant. Given a user's description of a recurring or event-driven
task, derive the following JSON fields for an agent job:

1. "prompt_template": A concrete, self-contained instruction prompt for an AI agent to execute.
   Write this in the first person, as if the agent is receiving the task directly.
   Be specific about what action to take, what tools to use, and what output format is expected.
   Use {{variable}} syntax for any dynamic parameters.

2. "schedule_cron": A 5-field cron expression for how often the job should run.
   Set to null if the job is event-triggered only or has no recurring schedule.

3. "trigger_event": A short string identifying what event should trigger the job.
   Set to null if the job is schedule-only with no event trigger.
   Set to null if the description doesn't imply an event trigger.

User description: "${description}"

Respond ONLY with valid JSON (no markdown, no code fences):
{ "prompt_template": "string or null", "schedule_cron": "string or null", "trigger_event": "string or null" }`;
}

function tryParseJSON(text: string): any {
  try {
    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    }
    return JSON.parse(cleaned);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return null;
  }
}

function validateResult(raw: any): JobSuggestResult {
  const result: JobSuggestResult = {
    prompt_template: null,
    schedule_cron: null,
    trigger_event: null,
  };

  if (!raw || typeof raw !== "object") return result;

  if (typeof raw.prompt_template === "string" && raw.prompt_template.trim().length > 0) {
    result.prompt_template = raw.prompt_template.trim().slice(0, MAX_PROMPT_TEMPLATE);
  }

  if (typeof raw.schedule_cron === "string" && raw.schedule_cron.trim().length > 0) {
    result.schedule_cron = raw.schedule_cron.trim().slice(0, MAX_CRON);
  }

  if (typeof raw.trigger_event === "string" && raw.trigger_event.trim().length > 0) {
    result.trigger_event = raw.trigger_event.trim().slice(0, MAX_TRIGGER_EVENT);
  }

  return result;
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
export async function generateJobConfig(
  config: LLMConfig,
  description: string,
): Promise<JobSuggestResult> {
  // No model configured → no generation possible
  if (!config?.model) {
    return { prompt_template: null, schedule_cron: null, trigger_event: null };
  }

  // Empty description → nothing to derive from
  if (!description?.trim()) {
    return { prompt_template: null, schedule_cron: null, trigger_event: null };
  }

  const truncated = description.slice(0, MAX_DESCRIPTION);
  const prompt = buildPrompt(truncated);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  const baseEndpoint = (config.endpoint || "").replace(/\/+v1\/?$/i, "").replace(/\/+$/, "");

  try {
    const response = await fetch(`${baseEndpoint}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: "You are a job configuration assistant that outputs only valid JSON." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 8192,
      }),
    });

    if (!response.ok) {
      logger.warn("job-suggest-llm", `Job suggestion LLM returned HTTP ${response.status}`);
      return { prompt_template: null, schedule_cron: null, trigger_event: null };
    }

    const json = await response.json();

    // 🔴 HARD RULE: never fall back to reasoning_content.
    // We use max_tokens: 8192 to give the model enough room to finish thinking,
    // but if content is still empty, return nulls — never surface the scratchpad.
    const content = json.choices?.[0]?.message?.content;
    const hasReasoning = !!json.choices?.[0]?.message?.reasoning_content;

    if (!content || content.trim().length === 0) {
      logger.warn("job-suggest-llm", "LLM returned empty content — zero output produced", {
        finish_reason: json.choices?.[0]?.finish_reason,
        has_reasoning_content: hasReasoning,
      });
      return { prompt_template: null, schedule_cron: null, trigger_event: null };
    }

    const parsed = tryParseJSON(content);
    if (!parsed) {
      logger.warn("job-suggest-llm", "LLM returned unparseable JSON response", {
        content_preview: content.slice(0, 200),
      });
      return { prompt_template: null, schedule_cron: null, trigger_event: null };
    }

    const result = validateResult(parsed);

    // Log diagnostics when the parse succeeded but all fields are null
    // (the model was coherent but genuinely had nothing to derive).
    if (result.prompt_template === null && result.schedule_cron === null && result.trigger_event === null) {
      logger.warn("job-suggest-llm", "LLM returned all-null result — nothing derivable", {
        content_preview: content.slice(0, 200),
      });
    }

    return result;
  } catch (err: any) {
    logger.warn("job-suggest-llm", `Job suggestion LLM fetch failed: ${err?.message}`, {
      error: err?.message,
      name: err?.name || "Error",
      stack: err?.stack?.split("\n").slice(0, 5).join("\n"),
    });
    return { prompt_template: null, schedule_cron: null, trigger_event: null };
  }
}
