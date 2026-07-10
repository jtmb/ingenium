import { Observation, PersonalityTrait, Skill } from "../schema.js";
import { getSetting } from "./settings.js";
import { logger } from "../logger.js";

/**
 * Structured response from the LLM synthesis engine.
 * The LLM returns JSON matching this shape.
 */
export interface SynthesisLLMResult {
  skills_to_create: Array<{
    name: string;
    description: string;
    content: string;
  }>;
  skills_to_update: Array<{
    name: string;
    patch: string;
    patch_type: "add-rule" | "update-section" | "add-pattern";
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
 * Build the prompt sent to the LLM.
 */
function buildPrompt(
  observations: Observation[],
  existingSkills: Pick<Skill, "name" | "description">[],
  existingTraits: Pick<PersonalityTrait, "trait_type" | "trait_value" | "confidence">[],
): string {
  // Format observations
  const obsText = observations.map(o =>
    `  - type:${o.observation_type} importance:${o.importance} "${o.content.substring(0, 200)}"`
  ).join("\n");

  // Format existing skills
  const skillsText = existingSkills.length > 0
    ? existingSkills.map(s => `  - ${s.name}: ${s.description}`).join("\n")
    : "  (none)";

  // Format existing traits
  const traitsText = existingTraits.length > 0
    ? existingTraits.map(t => `  - ${t.trait_type}: ${t.trait_value} (${Math.round((t.confidence || 0) * 100)}%)`).join("\n")
    : "  (none)";

  return `You are a skill synthesis engine for the Ingenium self-learning pipeline.

You analyze user interaction observations and generate structured skill definitions that teach AI agents how to better serve this specific user.

## Existing Skills
${skillsText}

## Existing Personality Traits
${traitsText}

## Recent Pending Observations
${obsText}

## Your Task

Analyze these observations and respond with ONLY valid JSON (no markdown, no code blocks).

1. If observations reveal a pattern NOT covered by existing skills → add to skills_to_create
2. If observations reinforce or extend an existing skill → add to skills_to_update
3. If observations reveal new personality traits → include in personality_traits
4. If nothing is actionable → return empty arrays

### Response Format (strict JSON only):
{
  "skills_to_create": [
    {
      "name": "kebab-case-name",
      "description": "One-line description",
      "content": "Full SKILL.md markdown content with ## 🔴 HARD RULEs and code examples"
    }
  ],
  "skills_to_update": [
    {
      "name": "existing-skill-name",
      "patch": "Markdown content to add (rule, pattern, or section)",
      "patch_type": "add-rule"
    }
  ],
  "personality_traits": [
    { "trait_type": "code_preference", "trait_value": "snake_case", "confidence": 0.7 }
  ],
  "insights": ["One-line insight from this batch"],
  "summary": "One-line summary of synthesis actions"
}

### Skill Content Guidelines
- Use 🔴 HARD RULE blocks for mandatory constraints
- Include code examples showing correct vs incorrect usage
- Reference specific user preferences from observations
- Keep skills focused and actionable`;
}

/**
 * Validate that the LLM response matches the expected structure.
 */
function validateResponse(raw: any): SynthesisLLMResult {
  const result: SynthesisLLMResult = {
    skills_to_create: [],
    skills_to_update: [],
    insights: [],
    summary: "",
  };

  if (!raw || typeof raw !== "object") return result;

  if (Array.isArray(raw.skills_to_create)) {
    result.skills_to_create = raw.skills_to_create.slice(0, 5).map((s: any) => ({
      name: String(s.name || "").slice(0, 64).replace(/[^a-z0-9-]/gi, "-").toLowerCase(),
      description: String(s.description || "").slice(0, 200),
      content: String(s.content || ""),
    })).filter((s: { name: string; content: string }) => s.name && s.content);
  }

  if (Array.isArray(raw.skills_to_update)) {
    result.skills_to_update = raw.skills_to_update.slice(0, 5).map((s: any) => ({
      name: String(s.name || ""),
      patch: String(s.patch || ""),
      patch_type: (s.patch_type === "update-section" || s.patch_type === "add-pattern") ? s.patch_type : "add-rule",
    })).filter((s: { name: string; patch: string }) => s.name && s.patch);
  }

  if (Array.isArray(raw.personality_traits)) {
    result.personality_traits = raw.personality_traits.slice(0, 3).map((t: any) => ({
      trait_type: t.trait_type as any,
      trait_value: String(t.trait_value || "").slice(0, 200),
      confidence: Math.min(1, Math.max(0, Number(t.confidence) || 0.3)),
    })).filter((t: { trait_type: string; trait_value: string }) => t.trait_type && t.trait_value);
  }

  result.insights = (Array.isArray(raw.insights) ? raw.insights : []).slice(0, 5).map(String);
  result.summary = String(raw.summary || `Synthesized ${result.skills_to_create.length} skill(s), ${result.skills_to_update.length} update(s)`).slice(0, 200);

  return result;
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
export async function callSynthesisLLM(
  observations: Observation[],
  existingSkills: Pick<Skill, "name" | "description">[],
  existingTraits: Pick<PersonalityTrait, "trait_type" | "trait_value" | "confidence">[],
  endpoint: string,
  model: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<SynthesisLLMResult> {
  if (observations.length === 0) {
    return { skills_to_create: [], skills_to_update: [], insights: [], summary: "No observations to process." };
  }

  const prompt = buildPrompt(observations, existingSkills, existingTraits);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  // Normalize endpoint: strip trailing /v1 if present to avoid double /v1
  const baseEndpoint = endpoint.replace(/\/+v1\/?$/i, "").replace(/\/+$/, "");

  try {
    const response = await fetch(`${baseEndpoint}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a skill synthesis engine that outputs only valid JSON." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "unknown error");
      logger.warn({ status: response.status, error: errText }, "LLM synthesis API returned error");
      // Try parsing as non-JSON response format
      const fallbackResponse = await fetch(`${baseEndpoint}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a skill synthesis engine. Respond ONLY with valid JSON." },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 4096,
        }),
        signal,
      });
      if (!fallbackResponse.ok) {
        return { skills_to_create: [], skills_to_update: [], insights: [], summary: `API error: ${fallbackResponse.status}` };
      }
      const fbJson = await fallbackResponse.json();
      const fbContent = fbJson.choices?.[0]?.message?.content || "{}";
      const fbParsed = tryParseJSON(fbContent);
      return validateResponse(fbParsed);
    }

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content || "{}";
    const parsed = tryParseJSON(content);
    return validateResponse(parsed);
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { skills_to_create: [], skills_to_update: [], insights: [], summary: "LLM synthesis was cancelled." };
    }
    logger.error({ err: err.message }, "LLM synthesis call failed");
    return { skills_to_create: [], skills_to_update: [], insights: [`LLM error: ${err.message}`], summary: "LLM synthesis failed" };
  }
}

function tryParseJSON(text: string): any {
  try {
    // Strip markdown code blocks if present
    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    }
    return JSON.parse(cleaned);
  } catch {
    // Try to extract JSON from markdown
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return null;
  }
}

/**
 * Check if LLM synthesis is configured for a project.
 */
export function isLLMSynthesisConfigured(projectId: string): boolean {
  const model = getSetting(projectId, "synthesis_model");
  return !!model;
}

/**
 * Get the configured LLM synthesis settings.
 */
export function getLLMSynthesisConfig(projectId: string): { model: string; apiKey?: string } | null {
  const model = getSetting(projectId, "synthesis_model");
  if (!model) return null;
  return { model, apiKey: getSetting(projectId, "synthesis_api_key") };
}
