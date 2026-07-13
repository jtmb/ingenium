/**
 * LLM-based observation extraction engine.
 *
 * Replaces the broken regex-only auto-observer plugin with a two-phase approach:
 *   1. Cheap regex pre-filter to select candidate messages (cost-cutting, not quality-judging)
 *   2. LLM extracts durable behavior rules from candidates
 *
 * Only LLM output becomes observations. Raw snippets never enter the DB.
 */
import { getSetting, setSetting } from "./settings.js";
import { storeObservation } from "./observations.js";
import { logEvent } from "./pipeline-events.js";
import { getFullLLMSynthesisConfig, isLLMSynthesisConfigured } from "./synthesis-llm.js";
import { getDb } from "../db.js";
import { logger } from "../logger.js";

// ── Types ──────────────────────────────────────────────────

interface CandidateMessage {
  text: string;
  time_created: number;
  hash: string;
}

interface ExtractionRule {
  content: string;
  type: string;   // "preference" | "correction" | "workflow" | "terminology" | "pattern"
  importance?: number;
}

interface ExtractionResult {
  scanned: number;
  candidates: number;
  created: number;
  skipped: number;
  failedBatches: number;
  watermark: number;
  reason?: string; // set when extraction is skipped/fails with a clear reason
}

// ── Simple 31-bit hash (djb2 variant) ────────────────────

function hashText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ── Candidate pre-filter regexes ─────────────────────────

/** Message is too short or too long to contain a meaningful behavioral signal */
function isReasonableLength(text: string): boolean {
  return text.length >= 30 && text.length <= 6000;
}

/** Messages that start with obvious task/technical markers */
const TASK_MARKER_RE = /^(EXECUTION task|Operation:|##|```|@ingenium-|Upload the full)/i;

/** Must contain at least one first-person or directive signal (permissive) */
const SIGNAL_RE = /\b(i |i'd|i want|i prefer|we |don'?t|do not|never|always|use |call it|instead|rather|make sure|stop|note that|remember)\b/i;

function isCandidate(text: string): boolean {
  if (!isReasonableLength(text)) return false;
  if (TASK_MARKER_RE.test(text)) return false;
  if (!SIGNAL_RE.test(text)) return false;
  return true;
}

// ── Seen-hash dedup ──────────────────────────────────────

const MAX_SEEN_HASHES = 2000;

function getSeenHashes(projectId: string): Set<string> {
  try {
    const raw = getSetting(projectId, "extraction_seen_hashes");
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.slice(-MAX_SEEN_HASHES));
  } catch {
    return new Set();
  }
}

function saveSeenHashes(projectId: string, hashes: Set<string>): void {
  const arr = Array.from(hashes).slice(-MAX_SEEN_HASHES);
  setSetting(projectId, "extraction_seen_hashes", JSON.stringify(arr));
}

// ── Watermark ────────────────────────────────────────────

function getWatermark(projectId: string): number {
  const raw = getSetting(projectId, "extraction_watermark");
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return isNaN(n) ? 0 : n;
}

function setWatermark(projectId: string, ts: number): void {
  setSetting(projectId, "extraction_watermark", String(ts));
}

// ── Fetch messages from the OpenCode endpoint ────────────

async function fetchMessages(
  watermark: number,
  limit: number,
  projectName: string,
): Promise<CandidateMessage[]> {
  const port = process.env.INGENIUM_API_PORT || "4097";
  const url = new URL(`http://localhost:${port}/api/v1/opencode/messages`);
  url.searchParams.set("since", String(watermark));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("project", projectName);

  const res = await fetch(url.toString());
  if (!res.ok) {
    logger.warn("extraction", `OpenCode messages endpoint returned ${res.status}`);
    return [];
  }

  const json = await res.json();
  const messages = json?.data?.messages;
  if (!Array.isArray(messages)) return [];
  return messages as CandidateMessage[];
}

// ── LLM extraction batch call ────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You extract DURABLE USER BEHAVIOR RULES from chat messages. A valid rule is actionable and generalizable: preferences ('User prefers X over Y'), corrections ('User corrects agents to do X not Y'), workflow habits ('User always does X before Y'), terminology ('User calls X a Y'), patterns ('User consistently X').

REJECT: one-off task instructions, feature requests for the thing being built right now, code/file paths, questions, fragments, anything not generalizable. Each rule must describe a user behavior that will apply across future sessions — not a specific implementation task.

EXAMPLES of VALID durable rules:
- "User wants in-app modal dialogs instead of browser confirm()" (from correction about UI choices)
- "User requires QA to reproduce exact reported user actions, not adjacent endpoints" (from frustration about tests)
- "User prefers OneShot builds that are deployed and tested before delivery" (from workflow directive)

KEY INSIGHT: corrections about HOW work is done (testing rigor, UI conventions, deployment workflow) ARE durable even when stated during a specific build task. Only reject instructions about WHAT to build (feature X, file Y, component Z) — the "what" is one-off but the "how" is durable.

Return STRICT JSON:
{"rules":[{"content":"User prefers ...","type":"preference|correction|workflow|terminology|pattern","importance":1-10}]}

Return {"rules":[]} if nothing qualifies. Each content MUST be a complete sentence starting with 'User'. Do not echo the raw message.`;

function buildBatchUserPrompt(messages: CandidateMessage[]): string {
  const MAX_MSG_LEN = 4000;
  return messages
    .map((m, i) => `[${i + 1}] ${m.text.length > MAX_MSG_LEN ? m.text.slice(0, MAX_MSG_LEN) + "…" : m.text}`)
    .join("\n\n");
}

async function callLLMForExtraction(
  messages: CandidateMessage[],
  config: { model: string; endpoint: string; apiKey?: string },
): Promise<{ rules: ExtractionRule[]; failed: boolean }> {
  const userContent = buildBatchUserPrompt(messages);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  const baseEndpoint = config.endpoint.replace(/\/+v1\/?$/i, "").replace(/\/+$/, "");

  // Create a 60-second timeout per batch to prevent hanging forever
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    logger.warn("extraction", "LLM batch call timed out after 60s — aborting");
    controller.abort();
  }, 60_000);

  // Single retry with json_object fallback (no response_format on retry)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${baseEndpoint}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          temperature: 0.2,
          max_tokens: 4096, // Qwen is a reasoning model — reasoning_content can consume half the budget
          // LM Studio rejects "json_object" (requires "json_schema" or "text").
          // The system prompt already instructs strict JSON output, so skip response_format entirely.
          response_format: undefined,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        if (attempt === 0) continue;
        logger.warn("extraction", `LLM returned ${res.status}`, { status: res.status });
        return { rules: [], failed: true };
      }

      const json = await res.json();
      const msg = json.choices?.[0]?.message;
      // Reasoning models (Qwen) may put output in reasoning_content when content is empty
      const rawContent = msg?.content || msg?.reasoning_content || "{}";
      const rules = parseExtractionResponse(rawContent);
      if (rules.length === 0) {
        logger.info("extraction", "LLM returned 0 rules from batch", {
          rawResponse: rawContent.slice(0, 500),
          batchSize: messages.length,
          model: config.model,
        });
      } else {
        logger.info("extraction", `LLM extracted ${rules.length} rules from batch`, { batchSize: messages.length });
      }
      return { rules, failed: false };
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === "AbortError") {
        logger.warn("extraction", "LLM batch call aborted (timeout or cancel) — returning empty results");
        return { rules: [], failed: true };
      }
      if (attempt === 0) continue;
      logger.error("extraction", `LLM call failed: ${err?.message}`, { error: String(err?.message || err), name: err?.name || "Error", stack: err?.stack?.split("\n").slice(0, 5).join("\n") });
      return { rules: [], failed: true };
    }
  }

  clearTimeout(timeout);
  return { rules: [], failed: true };
}

/** Parse the LLM response JSON with defensive handling. */
function parseExtractionResponse(raw: string): ExtractionRule[] {
  // Strip markdown fences
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to extract JSON from markdown-wrapped text
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { return []; }
    } else {
      return [];
    }
  }

  if (!parsed || typeof parsed !== "object") return [];

  const rules: any[] = Array.isArray(parsed.rules) ? parsed.rules : [];
  const validTypes = new Set([
    "preference", "correction", "workflow", "terminology", "pattern",
    "insight", "feedback", "behavior", "error", "goal",
  ]);

  const result: ExtractionRule[] = [];

  for (const r of rules) {
    if (!r || typeof r.content !== "string" || r.content.length < 20) continue;

    let content: string = r.content.trim();
    // Ensure it starts like a sentence
    if (!/^[A-Z]/.test(content)) continue;
    // Normalize to "User" prefix if missing
    if (!content.startsWith("User ")) {
      content = "User " + content.charAt(0).toLowerCase() + content.slice(1);
    }
    if (content.length < 20 || !content.startsWith("User ")) continue;

    const type = String(r.type || "preference").toLowerCase();
    const mappedType = validTypes.has(type) ? type : "preference";

    const importance = typeof r.importance === "number"
      ? Math.max(1, Math.min(10, Math.round(r.importance)))
      : 6;

    result.push({ content, type: mappedType, importance } as ExtractionRule);
  }

  return result;
}

// ── Main export ──────────────────────────────────────────

export async function runExtraction(
  projectId: string,
  projectName: string,
  opts?: { limit?: number },
): Promise<ExtractionResult> {
  const limit = opts?.limit ?? 500;
  let scanned = 0;
  let candidates = 0;
  let created = 0;
  let skipped = 0;
  let highestTimestamp = 0;

  try {
    // 1. Check LLM config (with per-project fallback)
    if (!isLLMSynthesisConfigured(projectId)) {
      const reason = "No synthesis LLM configured — check Settings page (synthesis_model) or set SYNTHESIS_MODEL env var. Self-learning disabled.";
      logger.warn("extraction", reason, { projectId });
      return { scanned: 0, candidates: 0, created: 0, skipped: 0, failedBatches: 0, watermark: 0, reason };
    }

    const llmConfig = getFullLLMSynthesisConfig(projectId);
    if (!llmConfig || !llmConfig.endpoint) {
      const reason = "Synthesis LLM endpoint not configured — set synthesis_endpoint in Settings or SYNTHESIS_ENDPOINT env var";
      logger.warn("extraction", reason, { projectId });
      return { scanned: 0, candidates: 0, created: 0, skipped: 0, failedBatches: 0, watermark: 0, reason };
    }

    // 2. Watermark
    const watermark = getWatermark(projectId);

    // 3. Fetch messages
    const messages = await fetchMessages(watermark, limit, projectName);
    scanned = messages.length;

    if (scanned === 0) {
      logger.info("extraction", `No messages since watermark ${watermark}`);
      return { scanned: 0, candidates: 0, created: 0, skipped: 0, failedBatches: 0, watermark };
    }

    // 4. Pre-filter candidates
    const seenHashes = getSeenHashes(projectId);
    let newHashesAdded = false;

    const rawCandidates = messages.filter((m) => {
      const ts = m.time_created;
      if (ts > highestTimestamp) highestTimestamp = ts;

      if (!isCandidate(m.text)) return false;

      const hash = hashText(m.text.trim());
      if (seenHashes.has(hash)) return false;

      seenHashes.add(hash);
      newHashesAdded = true;
      return true;
    }).map(m => ({ ...m, hash: hashText(m.text.trim()) }));

    candidates = rawCandidates.length;

    if (candidates === 0) {
      // Advance watermark even if no candidates
      if (highestTimestamp > watermark) {
        setWatermark(projectId, highestTimestamp);
      }
      if (newHashesAdded) {
        saveSeenHashes(projectId, seenHashes);
      }
      return { scanned, candidates: 0, created: 0, skipped: 0, failedBatches: 0, watermark: highestTimestamp || watermark };
    }

    // 5. Batch LLM extraction
    const BATCH_SIZE = 15;
    let failedBatches = 0;

    for (let i = 0; i < rawCandidates.length; i += BATCH_SIZE) {
      logger.info("extraction", `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(rawCandidates.length / BATCH_SIZE)} (${rawCandidates.length} candidates total)`);
      const batch = rawCandidates.slice(i, i + BATCH_SIZE);
      const { rules, failed } = await callLLMForExtraction(batch, {
        model: llmConfig.model,
        endpoint: llmConfig.endpoint,
        apiKey: llmConfig.apiKey,
      });

      if (failed) {
        failedBatches++;
        continue; // do NOT process rules from failed batches
      }

      for (const rule of rules) {
        // Map rule type to valid observation_type
        const obsType = rule.type as "correction" | "preference" | "pattern" | "insight" | "feedback" | "behavior" | "terminology" | "workflow" | "error" | "goal";

        // Find the originating message for context
        const originatingMsg = batch.find(m =>
          m.text.toLowerCase().includes(rule.content.toLowerCase().slice(0, 30))
        );

        try {
          storeObservation(
            projectId,
            obsType,
            rule.content,
            rule.importance ?? 6,
            "auto-observer",
            (originatingMsg?.text || "").slice(0, 500),
          );
          created++;
        } catch (err: any) {
          logger.warn("extraction", `Failed to store observation: ${err?.message}`, { error: String(err?.message || err), name: err?.name || "Error", stack: err?.stack?.split("\n").slice(0, 5).join("\n") });
          skipped++;
        }
      }

      // Count rules that were rejected as skipped
      // (rules filtered out by parseExtractionResponse are implicit skips)
    }

    // 6. Advance watermark — ONLY if no batches failed
    if (failedBatches === 0 && highestTimestamp > watermark) {
      setWatermark(projectId, highestTimestamp);
    } else if (failedBatches > 0) {
      logger.warn("extraction", `Skipping watermark advance: ${failedBatches}/${Math.ceil(rawCandidates.length / BATCH_SIZE)} batches failed`);
    }

    // 7. Persist seen hashes — ONLY if no batches failed
    if (failedBatches === 0 && newHashesAdded) {
      saveSeenHashes(projectId, seenHashes);
    } else if (failedBatches > 0) {
      logger.warn("extraction", "Skipping seen-hash save due to batch failures");
    }

    // 8. Log pipeline event
    try {
      logEvent(
        projectId,
        "extraction_completed",
        "system",
        `Extraction completed: ${created} observation(s) created`,
        `Scanned ${scanned} messages, ${candidates} candidates, created ${created} observations, skipped ${skipped}`,
        {
          scanned,
          candidates,
          created,
          skipped,
          failedBatches,
          model: llmConfig.model,
        },
      );
    } catch (err: any) {
      logger.error("extraction", `Failed to log pipeline event: ${err?.message}`, { error: String(err?.message || err), name: err?.name || "Error", stack: err?.stack?.split("\n").slice(0, 5).join("\n") });
    }

    return { scanned, candidates, created, skipped, failedBatches, watermark: highestTimestamp || watermark };
  } catch (err: any) {
    // Log failure but don't throw — scheduler must continue
    logger.error("extraction", `Extraction run failed: ${err?.message}`, { error: String(err?.message || err), name: err?.name || "Error", stack: err.stack });

    try {
      logEvent(
        projectId,
        "extraction_failed",
        "system",
        `Extraction failed: ${String(err?.message || err)}`,
        undefined,
        { scanned, candidates, created, skipped, failedBatches: 0, error: String(err?.message || err) },
      );
    } catch {
      // Non-fatal
    }

    return { scanned, candidates, created, skipped, failedBatches: 0, watermark: highestTimestamp || getWatermark(projectId) };
  }
}

/**
 * Look up a project name from its ID. Returns undefined if not found.
 */
export function getProjectNameById(projectId: string): string | undefined {
  try {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    const row = db.prepare("SELECT name FROM projects WHERE id = ?").get(projectId) as { name: string } | undefined;
    return row?.name;
  } catch {
    return undefined;
  }
}
