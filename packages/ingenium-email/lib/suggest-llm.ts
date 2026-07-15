/**
 * LLM-powered smart-reply suggestion engine.
 *
 * Uses voice samples from the user's Sent folder (few-shot examples) and a
 * configured LLM to generate 3 distinct reply drafts for a target email.
 * Falls back gracefully on any failure — returns an empty array, never throws.
 */

import { emailCache } from "ingenium-core";
import { GmailProvider } from "./providers/gmail.js";
import type { EmailAccount, OAuthToken } from "./types.js";

// ── Exported interfaces ─────────────────────────────────────────────────────

export interface SmartReply {
  tone: string;
  subject: string;
  body: string;
}

export interface LLMConfig {
  model: string;
  endpoint?: string;
  apiKey?: string;
}

// ── getVoiceSamples ─────────────────────────────────────────────────────────

/**
 * Collect recent Sent emails with cached bodies to use as few-shot voice samples.
 *
 * 1. Calls GmailProvider.listMessages for the Sent folder
 * 2. Filters to UIDs with an already-cached body (avoids live fetches)
 * 3. Extracts .text from cached bodies, truncated to 400 chars
 *
 * Returns up to `limit` objects. Never throws — returns empty array on any error.
 */
export async function getVoiceSamples(
  account: EmailAccount,
  tokens: OAuthToken,
  limit: number = 15,
): Promise<Array<{ subject: string; snippet: string }>> {
  try {
    const sentFolder = "Sent";
    const messages = await GmailProvider.listMessages(account, tokens, sentFolder, 50);

    const samples: Array<{ subject: string; snippet: string }> = [];
    for (const msg of messages) {
      if (samples.length >= limit) break;
      const body = emailCache.getCachedEmailBody(account.id, sentFolder, msg.id);
      if (body?.text) {
        samples.push({
          subject: msg.subject ?? "(no subject)",
          snippet: body.text.substring(0, 400),
        });
      }
    }

    return samples;
  } catch {
    // Never throw — return empty array on any failure
    return [];
  }
}

// ── generateSmartReplies ────────────────────────────────────────────────────

/**
 * Call the configured LLM to generate 3 distinct smart replies.
 *
 * Builds a few-shot prompt showing the user's past reply patterns, then asks
 * the LLM to compose 3 distinct reply drafts.
 *
 * Returns an array of exactly 3 SmartReply objects (padded/truncated as needed).
 * Never throws — returns empty array on any failure.
 */
export async function generateSmartReplies(
  targetEmail: { from: string; subject: string; bodySnippet: string },
  voiceSamples: Array<{ subject: string; snippet: string }>,
  llmConfig: LLMConfig,
): Promise<SmartReply[]> {
  if (!llmConfig.endpoint || !llmConfig.model) return [];

  const prompt = buildSmartReplyPrompt(targetEmail, voiceSamples);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (llmConfig.apiKey) headers["Authorization"] = `Bearer ${llmConfig.apiKey}`;

  // Normalize endpoint: strip trailing /v1 if present to avoid double /v1
  const baseEndpoint = llmConfig.endpoint.replace(/\/+v1\/?$/i, "").replace(/\/+$/, "");

  try {
    const response = await fetch(`${baseEndpoint}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: "system", content: "You are an email reply assistant that outputs only valid JSON arrays." },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 8192,
      }),
    });

    if (!response.ok) return [];

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = tryParseJSON(content);
    if (!Array.isArray(parsed)) return [];

    // Validate each suggestion
    const valid: SmartReply[] = parsed
      .filter((s: any) => s && typeof s.tone === "string" && typeof s.subject === "string" && typeof s.body === "string")
      .map((s: any) => ({
        tone: String(s.tone).slice(0, 50),
        subject: String(s.subject).slice(0, 200),
        body: String(s.body).slice(0, 2000),
      }));

    // Pad to exactly 3: truncate if too many, add generic fallbacks if too few
    if (valid.length > 3) {
      return valid.slice(0, 3);
    }
    while (valid.length < 3) {
      valid.push({
        tone: "polite",
        subject: `Re: ${targetEmail.subject}`,
        body: `Thank you for your email. I'll get back to you soon.`,
      });
    }
    return valid;
  } catch {
    return [];
  }
}

// ── Prompt builder ─────────────────────────────────────────────────────────

function buildSmartReplyPrompt(
  targetEmail: { from: string; subject: string; bodySnippet: string },
  voiceSamples: Array<{ subject: string; snippet: string }>,
): string {
  const samplesText = voiceSamples.length > 0
    ? voiceSamples.map((s, i) =>
        `[Example ${i + 1}]\nSubject: ${s.subject}\nReply: ${s.snippet}\n`
      ).join("\n")
    : "(No past examples available — use a generic professional tone)";

  return `You are a smart-reply engine that composes email drafts in the user's natural writing style.

Below are examples of the user's past replies. Match their tone, formality, and phrasing patterns:

${samplesText}

## Target Email to Reply To

From: ${targetEmail.from}
Subject: ${targetEmail.subject}

${targetEmail.bodySnippet}

## Your Task

Compose EXACTLY 3 distinct reply drafts. Each draft should:
- Use a different tone (e.g., concise, warm, formal)
- Have a clear subject line
- Sound like the user wrote it (match the style from the examples above)
- Be ready to send (no placeholders like [Your Name])

## Response Format (STRICT JSON only, no markdown, no code blocks):

[
  { "tone": "concise", "subject": "Re: ...", "body": "Hi,\\n\\n..." },
  { "tone": "warm", "subject": "Re: ...", "body": "Hi,\\n\\n..." },
  { "tone": "formal", "subject": "Re: ...", "body": "Dear ...,\\n\\n..." }
]

IMPORTANT: Return ONLY the JSON array. No explanation, no markdown fences.`;
}

// ── JSON parse (same multi-strategy as synthesis-llm.ts) ────────────────────

// ── generateEmailSummary ──────────────────────────────────────────────────────

/**
 * Call the configured LLM to generate a 2-3 sentence summary of an email.
 *
 * Returns the raw summary text. Never throws — returns empty string on any failure.
 */
export async function generateEmailSummary(
  emailBody: string,
  subject: string,
  llmConfig: LLMConfig,
): Promise<string> {
  if (!llmConfig.endpoint || !llmConfig.model) return "";

  const prompt = `Summarize the following email in 2-3 concise sentences, capturing the key points and any action items. Return ONLY the summary text, no preamble.

Subject: ${subject}

${emailBody}`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (llmConfig.apiKey) headers["Authorization"] = `Bearer ${llmConfig.apiKey}`;

  // Normalize endpoint: strip trailing /v1 if present to avoid double /v1
  const baseEndpoint = llmConfig.endpoint.replace(/\/+v1\/?$/i, "").replace(/\/+$/, "");

  try {
    const response = await fetch(`${baseEndpoint}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: "system", content: "You are an email summarizer that outputs only the summary text, no preamble, no markdown." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 8192,
      }),
    });

    if (!response.ok) return "";

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) return "";

    // Strip any markdown fences or JSON wrapping from the response
    let cleaned = content.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:text)?\s*/i, "").replace(/\s*```$/i, "");
    }

    return cleaned;
  } catch {
    return "";
  }
}

// ── reviewDraft ──────────────────────────────────────────────────────────────

/**
 * Call the configured LLM to review and improve a draft email.
 *
 * Returns the improved text. Never throws — returns empty string on any failure.
 */
export async function reviewDraft(
  text: string,
  subject: string | undefined,
  llmConfig: LLMConfig,
): Promise<string> {
  if (!llmConfig.endpoint || !llmConfig.model) return "";

  const prompt = subject
    ? `You are an email writing coach. Rewrite the following draft email to improve clarity, tone, grammar, and professionalism, while preserving the original meaning, facts, and intent. Return ONLY the improved text, no explanation, no markdown fences.

Subject: ${subject}

${text}`
    : `You are an email writing coach. Rewrite the following draft email to improve clarity, tone, grammar, and professionalism, while preserving the original meaning, facts, and intent. Return ONLY the improved text, no explanation, no markdown fences.

${text}`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (llmConfig.apiKey) headers["Authorization"] = `Bearer ${llmConfig.apiKey}`;

  // Normalize endpoint: strip trailing /v1 if present to avoid double /v1
  const baseEndpoint = llmConfig.endpoint.replace(/\/+v1\/?$/i, "").replace(/\/+$/, "");

  try {
    const response = await fetch(`${baseEndpoint}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: "system", content: "You are an email writing coach that outputs only improved text, no explanation, no markdown." },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 8192,
      }),
    });

    if (!response.ok) return "";

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) return "";

    // Strip any markdown fences from the response
    let cleaned = content.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:text|markdown)?\s*/i, "").replace(/\s*```$/i, "");
    }

    return cleaned;
  } catch {
    return "";
  }
}

// ── JSON parse (same multi-strategy as synthesis-llm.ts) ────────────────────

function tryParseJSON(text: string): any {
  try {
    let cleaned = text.trim();
    // Strip markdown code blocks if present
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    }
    return JSON.parse(cleaned);
  } catch {
    // Try to extract JSON array from markdown
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return null;
  }
}
