import { Observation, PersonalityTrait, Skill } from "../schema.js";
import { getSetting } from "./settings.js";
import { getGlobalProject } from "./projects.js";
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
    tags?: string;
    reference_files?: Array<{ path: string; content: string }>;
  }>;
  skills_to_update: Array<{
    name: string;
    patch: string;
    patch_type: "add-rule" | "update-section" | "add-pattern";
    reference_files?: Array<{ path: string; content: string }>;
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

1. Only propose a NEW skill when you see 3+ related observations forming a durable pattern. Prefer UPDATING an existing skill over creating one. Return empty skills_to_create if nothing meets the bar.
2. If observations reinforce or extend an existing skill → add to skills_to_update
3. If observations reveal new personality traits → include in personality_traits
4. If nothing is actionable → return empty arrays

### Response Format (strict JSON only):
{
  "skills_to_create": [
    {
      "name": "kebab-case-name",
      "description": "One-line description",
      "content": "Concise SKILL.md content with ## 🔴 HARD RULEs and ## Reference Files table",
      "tags": "tag1,tag2,tag3",
      "reference_files": [
        { "path": "references/topic.md", "content": "Detailed content for this reference file" }
      ]
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

## Skill Format Requirements

Each skill must follow the split-skill format:

1. \`name\` — Use a descriptive kebab-case name (e.g., \`shell-patterns\`, \`git-workflows\`). Do NOT include any prefix.
2. \`description\` — One-line summary
3. \`content\` — Concise SKILL.md with "## Reference Files" section linking to reference files
4. \`reference_files\` — Array of \`{ path, content }\` for detailed content

Example:
\`\`\`json
{
  "name": "shell-patterns",
  "description": "Common shell command patterns and safety rules",
  "content": "# Shell Patterns\\n\\n## 🔴 HARD RULEs\\n- Never use \`&\` in commands\\n\\n## Reference Files\\n\\n| File | Content |\\n|------|--------|\\n| [\`references/command-safety.md\`](references/command-safety.md) | Safe command patterns and anti-patterns |\\n| [\`references/output-formatting.md\`](references/output-formatting.md) | Output formatting conventions |",
  "tags": "shell,scripting,error-handling",
  "reference_files": [
    { "path": "references/command-safety.md", "content": "# Command Safety\\n\\nDetailed safety rules here..." },
    { "path": "references/output-formatting.md", "content": "# Output Formatting\\n\\nFormatting conventions here..." }
  ]
}
\`\`\`

IMPORTANT: Group related concepts. If you identify 3 patterns about shell commands, create ONE \`shell-patterns\` skill with 3 reference files, NOT 3 separate skills.

CAPS: Max 5 skills_to_create, max 5 skills_to_update. Do NOT create a skill unless 3+ observations support it.

### Skill Consolidation Rules
- This project currently has ${existingSkills.length} skills. Target: maintain ≤20 skills.
- STRONGLY prefer merging new knowledge into an EXISTING skill (via skills_to_update, adding a new references/ file) over creating a new one.
- Only propose skills_to_create when NO existing skill covers the domain.
- When updating an existing skill, include reference_files in the update to add new reference files to the skill.

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
    result.skills_to_create = raw.skills_to_create.slice(0, 5).map((s: any) => {
      let name = String(s.name || "").slice(0, 64).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
      const item: any = {
        name,
        description: String(s.description || "").slice(0, 200),
        content: String(s.content || ""),
        tags: s.tags ? String(s.tags) : undefined,
      };
      // Handle reference_files for split-skill format
      if (s.reference_files && Array.isArray(s.reference_files)) {
        item.reference_files = s.reference_files
          .filter((rf: any) => rf.path && rf.content && rf.path.startsWith("references/"))
          .slice(0, 10)  // cap at 10 reference files per skill
          .map((rf: any) => ({
            path: rf.path.replace(/[^a-zA-Z0-9_\-/\.]/g, ""),  // sanitize path
            content: rf.content.slice(0, 8000),  // cap content length
          }));
      }
      return item;
    }).filter((s: { name: string; content: string }) => s.name && s.content);
  }

  if (Array.isArray(raw.skills_to_update)) {
    result.skills_to_update = raw.skills_to_update.slice(0, 5).map((s: any) => {
      const update: any = {
        name: String(s.name || ""),
        patch: String(s.patch || ""),
        patch_type: (s.patch_type === "update-section" || s.patch_type === "add-pattern") ? s.patch_type : "add-rule",
      };
      if (s.reference_files && Array.isArray(s.reference_files)) {
        update.reference_files = s.reference_files
          .filter((rf: any) => rf.path && rf.content && rf.path.startsWith("references/"))
          .slice(0, 10)
          .map((rf: any) => ({
            path: rf.path.replace(/[^a-zA-Z0-9_\-/\.]/g, ""),
            content: rf.content.slice(0, 8000),
          }));
      }
      return update;
    }).filter((s: any) => s.name && s.patch);
  }

  if (Array.isArray(raw.personality_traits)) {
    result.personality_traits = raw.personality_traits.slice(0, 3).map((t: any) => ({
      trait_type: t.trait_type as any,
      trait_value: String(t.trait_value || "").slice(0, 200),
      confidence: Math.min(0.95, Math.max(0, Number(t.confidence) || 0.3)),
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
        max_tokens: 8192,
        response_format: { type: "json_object" },
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "unknown error");
      logger.warn("synthesis-llm", "LLM synthesis API returned error", { status: response.status, error: errText });
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
          max_tokens: 8192,
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
    logger.error("synthesis-llm", "LLM synthesis call failed", { err: String(err?.message || err) });
    return { skills_to_create: [], skills_to_update: [], insights: [`LLM error: ${String(err?.message || err)}`], summary: "LLM synthesis failed" };
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
 * Check if LLM synthesis is configured for the global project.
 */
export function isLLMSynthesisConfigured(_projectId: string): boolean {
  const gid = getGlobalProject()?.id;
  return gid ? !!getSetting(gid, "synthesis_model") : false;
}

/**
 * Get the configured LLM synthesis settings from the global project.
 */
export function getLLMSynthesisConfig(_projectId: string): { model: string; apiKey?: string } | null {
  const gid = getGlobalProject()?.id;
  if (!gid) return null;
  const model = getSetting(gid, "synthesis_model");
  const apiKey = getSetting(gid, "synthesis_api_key");
  if (!model) return null;
  return { model, apiKey: apiKey || undefined };
}

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
export async function consolidateTraits(
  projectId: string,
  observations: Array<{ id: number; observation_type: string; content: string }>,
  existingTraits: Array<{ id: number; trait_type: string; trait_value: string; confidence: number }>,
): Promise<ConsolidationResult | null> {
  if (!isLLMSynthesisConfigured(projectId)) return null;

  const gid = getGlobalProject()?.id;
  if (!gid) return null;

  const model = getSetting(gid, "synthesis_model");
  const apiKey = getSetting(gid, "synthesis_api_key") || undefined;
  const endpoint = getSetting(gid, "synthesis_endpoint");
  if (!model || !endpoint) return null;

  // Build prompt
  const obsText = observations.map(o =>
    `  [id:${o.id}] type:${o.observation_type} "${o.content.substring(0, 200)}"`
  ).join("\n");

  const traitsText = existingTraits.length > 0
    ? existingTraits.map(t => `  [id:${t.id}] ${t.trait_type}: ${t.trait_value} (conf: ${Math.round(t.confidence * 100)}%)`).join("\n")
    : "  (none)";

  const prompt = `You maintain a user personality model for the Ingenium self-learning pipeline.

## Existing Active Traits
${traitsText}

## New Observations
${obsText}

## Your Task

For each new observation, decide ONE of:
- **CONFIRM** — It supports an existing trait. Return that trait's id.
- **CREATE** — It reveals a new durable trait. Produce a clean, generalizable statement (e.g., "User prefers 2-space indentation", NOT "User said to use 2 spaces").
- **IGNORE** — It's noise, a one-off, or unactionable. Skip it.

### Rules
- **STRONGLY prefer CONFIRM over CREATE.** Before creating a new trait, scan every existing trait — if any existing trait expresses the SAME underlying preference or behavior (even if worded differently, or more/less precise), CONFIRM it instead of creating a near-duplicate. Only CREATE when no existing trait covers the observation's meaning. Reworded restatements of an existing trait are CONFIRMs, not new traits.
- Merge semantically-equivalent observations into ONE trait — do not create near-duplicates.
- Normalize wording: traits should be crisp, reusable, third-person statements about the user.
- Assign trait_type from this list: communication_style, code_preference, workflow_pattern, terminology, priority_signal, feedback_style, interaction_pattern, domain_knowledge, learned_skill, personality_trait.
- confidence_hint: 0.10-0.15 for a single observation, 0.20-0.30 if supported by 2+ observations in this batch.

### Response Format (STRICT JSON only, no markdown):
{
  "create": [
    {
      "trait_type": "code_preference",
      "trait_value": "User prefers 2-space indentation and corrects 4-space",
      "confidence_hint": 0.12,
      "observation_ids": [1, 3]
    }
  ],
  "confirm": [
    { "trait_id": 42, "observation_id": 2 }
  ],
  "ignore_count": 1
}`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const baseEndpoint = endpoint.replace(/\/+v1\/?$/i, "").replace(/\/+$/, "");

  try {
    const response = await fetch(`${baseEndpoint}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a personality model consolidator that outputs only valid JSON." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 8192,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      logger.warn("synthesis-llm", "consolidateTraits API returned error", { status: response.status });
      return null;
    }

    const json = await response.json();
    const finishReason = json.choices?.[0]?.finish_reason;
    const content = json.choices?.[0]?.message?.content;

    // Guard: if the LLM truncated due to token limit and produced no content,
    // return null so observations stay pending (not silently skipped).
    if (finishReason === "length" && (!content || content.trim().length === 0)) {
      logger.warn("synthesis-llm", "consolidateTraits truncated by token limit — leaving observations pending");
      return null;
    }

    const parsed = tryParseJSON(content || "{}");

    if (!parsed) return null;

    // Parse defensively
    const create = (Array.isArray(parsed.create) ? parsed.create : []).slice(0, 20).map((c: any) => ({
      trait_type: validTraitTypes.includes(c.trait_type) ? c.trait_type : "code_preference",
      trait_value: String(c.trait_value || "").slice(0, 200).trim(),
      confidence_hint: Math.min(0.30, Math.max(0.05, Number(c.confidence_hint) || 0.10)),
      observation_ids: (Array.isArray(c.observation_ids) ? c.observation_ids : []).map(Number).filter((n: number) => n > 0),
    })).filter((c: { trait_value: string }) => c.trait_value.length > 0);

    const confirm = (Array.isArray(parsed.confirm) ? parsed.confirm : []).slice(0, 50).map((c: any) => ({
      trait_id: Number(c.trait_id) || 0,
      observation_id: Number(c.observation_id) || 0,
    })).filter((c: { trait_id: number; observation_id: number }) => c.trait_id > 0 && c.observation_id > 0);

    const ignore = Number.isFinite(parsed.ignore_count) ? Math.abs(Math.round(parsed.ignore_count)) : 0;

    return { create, confirm, ignore };
  } catch (err: any) {
    logger.warn("synthesis-llm", "consolidateTraits fetch failed", { err: String(err?.message || err) });
    return null;
  }
}

const validTraitTypes: string[] = [
  "communication_style", "code_preference", "workflow_pattern",
  "terminology", "priority_signal", "feedback_style",
  "interaction_pattern", "domain_knowledge", "learned_skill", "personality_trait",
];

export interface EnrichedObservation {
  type: string;
  content: string;           // original raw content
  enriched_content?: string; // LLM-enriched version — the extracted rule/preference
  context?: string;          // conversation context window
  skip?: boolean;            // if LLM says it's noise/unactionable
}

/**
 * Build the enrichment prompt — extracts specific user behavior rules from raw snippets + conversation context.
 */
function buildEnrichmentPrompt(
  observations: Array<{ type: string; content: string; context?: string }>,
): string {
  const obsText = observations.map((o, i) => {
    return `[${i}] type:${o.type}\n  snippet: "${o.content.substring(0, 300)}"\n  context: "${(o.context || '(none)').substring(0, 500)}"`;
  }).join("\n\n");

  return `You are a behavior pattern extractor for the Ingenium self-learning system.

You analyze raw conversation snippets and extract the underlying user behavior rule or preference.

## Raw Observations
${obsText}

## Your Task

For each observation above (indexed [0], [1], etc.), determine:

1. **enriched_content** — A clear, actionable, specific statement of the user's behavior, preference, or rule derived from the snippet + conversation context. NOT just a rephrasing of the snippet — extract the *underlying rule* the snippet implies.

   Examples of GOOD enriched_content:
   - "User prefers 2-space indentation and will explicitly correct any 4-space indentation the agent produces"
   - "User wants all commit messages to follow conventional commits format (type: description)"
   - "User always runs lint before committing and gets frustrated when the agent commits without linting"

   Examples of BAD enriched_content (just rephrasing):
   - "User said to use 2 spaces"
   - "User mentioned conventional commits"
   - "User told agent to run lint"

2. **skip** — Set to true if the observation is noise: profanity without substance, off-topic, uncategorized, or genuinely not a behavior pattern (e.g., "this is fucked" with no specificity).

3. **content** — Leave as the original snippet (we keep it for audit trail).

## Response Format

Respond with ONLY a valid JSON array (no markdown, no code blocks):

[
  {
    "index": 0,
    "content": "original snippet here",
    "enriched_content": "User prefers...",
    "skip": false
  },
  {
    "index": 1,
    "content": "original snippet here",
    "enriched_content": null,
    "skip": true
  }
]

IMPORTANT:
- Keep enriched_content specific and actionable (1-3 sentences)
- If unsure, set skip to false and provide your best interpretation
- Return exactly one entry per input observation (same order)
- Only set skip:true for clear noise`;
}

/**
 * Extract structured enrichment results from LLM JSON response.
 */
function parseEnrichmentResponse(
  raw: any,
  count: number,
): Array<{ skip: boolean; enriched_content?: string }> {
  const results: Array<{ skip: boolean; enriched_content?: string }> = [];
  
  if (!Array.isArray(raw)) {
    // Non-array response — return all unenriched
    for (let i = 0; i < count; i++) {
      results.push({ skip: false });
    }
    return results;
  }

  for (let i = 0; i < count; i++) {
    const entry = raw.find((e: any) => e?.index === i);
    if (entry) {
      results.push({
        skip: entry.skip === true,
        enriched_content: typeof entry.enriched_content === 'string' && entry.enriched_content.length > 10
          ? entry.enriched_content
          : undefined,
      });
    } else {
      results.push({ skip: false });
    }
  }

  return results;
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
export async function enrichObservations(
  observations: Array<{ type: string; content: string; context?: string }>,
  endpoint: string,
  model: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<EnrichedObservation[]> {
  if (observations.length === 0) return [];
  if (!endpoint || !model) {
    // No LLM configured — return originals as-is
    return observations.map(o => ({ ...o, skip: false }));
  }

  const prompt = buildEnrichmentPrompt(observations);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const baseEndpoint = endpoint.replace(/\/+v1\/?$/i, "").replace(/\/+$/, "");
  const maxRetries = 1;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${baseEndpoint}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a behavior pattern extractor that outputs only valid JSON arrays." },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 2048,
          response_format: attempt === 0 ? { type: "json_object" } : undefined,
        }),
        signal,
      });

      if (!response.ok) {
        if (attempt < maxRetries) continue;
        logger.warn("synthesis-llm", "LLM enrichment returned error, falling back to raw observations", { status: response.status });
        return observations.map(o => ({ ...o, skip: false }));
      }

      const json = await response.json();
      const content = json.choices?.[0]?.message?.content || "{}";
      const parsed = tryParseJSON(content);
      
      if (!parsed) {
        if (attempt < maxRetries) continue;
        return observations.map(o => ({ ...o, skip: false }));
      }

      // Handle json_object response wrapping — the model may return {"observations": [...]} or just [...]
      const rawArray = Array.isArray(parsed) ? parsed : (parsed.observations || parsed.enriched || []);

      const enrichmentResults = parseEnrichmentResponse(rawArray, observations.length);

      return observations.map((obs, i) => {
        const enriched = enrichmentResults[i] || { skip: false };
        return {
          type: obs.type,
          content: obs.content,
          context: obs.context,
          enriched_content: enriched.enriched_content,
          skip: enriched.skip,
        };
      });
    } catch (err: any) {
      if (err.name === "AbortError") {
        return observations.map(o => ({ ...o, skip: false }));
      }
      if (attempt < maxRetries) continue;
      logger.error("synthesis-llm", "LLM enrichment call failed, falling back to raw observations", { err: String(err?.message || err) });
      return observations.map(o => ({ ...o, skip: false }));
    }
  }

  return observations.map(o => ({ ...o, skip: false }));
}

/**
 * Get the full LLM synthesis config including endpoint.
 * Extends getLLMSynthesisConfig to include endpoint.
 */
export function getFullLLMSynthesisConfig(): { model: string; apiKey?: string; endpoint?: string } | null {
  const gid = getGlobalProject()?.id;
  if (!gid) return null;
  const model = getSetting(gid, "synthesis_model");
  const apiKey = getSetting(gid, "synthesis_api_key");
  const endpoint = getSetting(gid, "synthesis_endpoint");
  if (!model || !endpoint) return null;
  return { model, apiKey: apiKey || undefined, endpoint };
}
