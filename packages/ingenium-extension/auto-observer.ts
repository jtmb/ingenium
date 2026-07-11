import { tool } from "@opencode-ai/plugin";

const API_BASE = (typeof process !== "undefined" ? process.env.INGENIUM_API_URL : undefined) ?? "http://localhost:4097/api/v1";
// TODO: PROJECT should be dynamic (derived from worktree or env) rather than hardcoded.
// Currently kept for backward compatibility — overridable via INGENIUM_PROJECT env var.
const PROJECT = process.env.INGENIUM_PROJECT || "gh-llm-bootstrap";

// Track last run timestamp for dedup — only process messages newer than this.
// Start at epoch so the first run scans ALL messages; subsequent runs are incremental.
let lastRunAt = 0;

/**
 * Patterns to detect in user messages.
 * Key: observation_type, Value: regex patterns
 */
const PATTERNS: Map<string, RegExp[]> = new Map(Object.entries({
  correction: [
    /no[.,!]? (?:use|don|do|should|make it)/i,
    /(?:change|replace|swap|switch) .* (?:to|with|instead)/i,
    /(?:should be|could be|would be|needs to be) .* (?:instead|rather)/i,
    /that.?s (?:wrong|incorrect|not what|not right)/i,
    /(?:actually|correction|typo|fix|wrong|retard|dumb|idiot|ape|fuck)/i,
  ],
  preference: [
    /(?:prefer|rather|like|want|choose) .*(?:instead|over|more|less)/i,
    /i (?:always|usually|normally|tend to) (?:use|do|write|name)/i,
    /don.?t (?:like|use|want|do) .*(?:because|just|ever)/i,
    /(?:never|always) (?:use|do|write|put) /i,
    /(?:use|standard|convention|style|format) .*(?:space|tab|quote|brace|paren|camel|snake|pascal)/i,
  ],
  terminology: [
    /(?:call it|call them|known as|name|naming|renamed|renaming) /i,
    /(?:it.?s called|we call|refers? to|known as) /i,
    /(?:not |rather than|instead of) .*(?:it.?s |just )/i,
  ],
  workflow: [
    /(?:run|execute|start|check) .*(?:test|build|lint|check|validate|git)/i,
    /(?:commit|push|git) .*(?:first|before|after|always)/i,
    /(?:ci|cd|deploy|release|publish) .*(?:pipeline|step|flow|process)/i,
    /(?:troubleshoot|debug|fix|repair) .*(?:not working|broken|fail|error|issue)/i,
  ],
}));

/**
 * Fetch recent user messages from the Ingenium API (which reads the OpenCode DB server-side).
 * This avoids the bun:sqlite sandbox issue in OpenCode's plugin runtime.
 */
async function fetchUserMessages(since: number, limit: number = 500): Promise<Array<{ text: string; time_created: number }>> {
  try {
    const url = `${API_BASE}/opencode/messages?project=${PROJECT}&since=${since}&limit=${limit}`;
    console.log(`[auto-observer] Fetching messages from API: ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[auto-observer] API returned ${res.status} for /opencode/messages`);
      return [];
    }
    const json = await res.json();
    const messages = json?.data?.messages ?? [];
    console.log(`[auto-observer] API returned ${messages.length} user messages`);
    return messages;
  } catch (err: any) {
    console.error(`[auto-observer] Failed to fetch messages from API:`, err.message);
    return [];
  }
}

/**
 * Scan user messages for behavior patterns using regex.
 */
async function detectPatterns(): Promise<Array<{ type: string; content: string; context?: string }>> {
  console.log(`[auto-observer] Starting pattern detection (lastRunAt=${lastRunAt}, since=${new Date(lastRunAt).toISOString()})`);

  const messages = await fetchUserMessages(lastRunAt, 2000);

  if (messages.length === 0) {
    console.log("[auto-observer] No new messages to scan since last run");
    return [];
  }

  const seen = new Set<string>();
  const observations: Array<{ type: string; content: string; context?: string }> = [];

  for (const msg of messages) {
    const text = String(msg.text || "").trim();
    if (!text || text.length < 10) continue;

    // Update lastRunAt to the latest message time
    if (msg.time_created && typeof msg.time_created === 'number' && msg.time_created > lastRunAt) {
      lastRunAt = msg.time_created;
    }

    for (const [obsType, patterns] of PATTERNS) {
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
          const snippet = match[1] || match[0] || text.substring(0, 200);
          const key = `${obsType}:${snippet.substring(0, 60)}`;
          if (!seen.has(key)) {
            seen.add(key);
            observations.push({
              type: obsType,
              content: snippet,
              context: text.substring(0, 500),
            });
          }
          break; // One match per pattern category per message
        }
      }
    }
  }

  console.log(`[auto-observer] Pattern detection complete: ${observations.length} patterns found across ${PATTERNS.size} categories`);
  return observations;
}

/**
 * Call the LLM enrichment endpoint to extract actionable rules from raw observations.
 * Falls back to originals on any error.
 */
async function enrichObservations(
  observations: Array<{ type: string; content: string; context?: string }>,
): Promise<Array<{ type: string; content: string; context?: string; enriched_content?: string; skip: boolean }>> {
  if (observations.length === 0) return [];

  console.log(`[auto-observer] Enriching ${observations.length} observations via API...`);

  try {
    const res = await fetch(`${API_BASE}/observations/enrich?project=${PROJECT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observations }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.warn(`[auto-observer] Enrichment API returned ${res.status} — using raw observations`);
      return observations.map(o => ({ ...o, skip: false }));
    }

    const json = await res.json();
    const enriched = (json.data || []).map((item: any) => ({
      type: item.type,
      content: item.content,
      context: item.context,
      enriched_content: item.enriched_content,
      skip: item.skip === true,
    }));

    const skipped = enriched.filter(o => o.skip).length;
    console.log(`[auto-observer] Enrichment complete: ${enriched.length - skipped} enriched, ${skipped} skipped as noise`);
    return enriched;
  } catch (err: any) {
    console.error(`[auto-observer] Enrichment failed:`, err.message, "— falling back to raw observations");
    return observations.map(o => ({ ...o, skip: false }));
  }
}

/**
 * POST detected observations to the Ingenium API.
 * Returns the number successfully created.
 * Uses enriched_content when available, falls back to raw content.
 */
async function createObservations(
  observations: Array<{ type: string; content: string; context?: string; enriched_content?: string; skip: boolean }>,
  client: any,
): Promise<number> {
  const actionable = observations.filter(o => !o.skip);
  if (actionable.length === 0) return 0;

  console.log(`[auto-observer] Creating ${actionable.length} observations...`);

  let created = 0;
  for (const obs of actionable) {
    try {
      const finalContent = obs.enriched_content || obs.content;
      const res = await fetch(`${API_BASE}/observations?project=${PROJECT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observation_type: obs.type,
          content: finalContent,
          importance: 5,
          source: "auto-observer",
          context: obs.context || undefined,
        }),
      });
      if (res.ok) {
        created++;
      } else {
        console.error(`[auto-observer] API error creating observation: ${res.status} ${res.statusText}`);
      }
    } catch (err: any) {
      console.error(`[auto-observer] ERROR creating observation:`, err.message);
    }
  }

  if (created > 0) {
    console.log(`[auto-observer] Created ${created} observations successfully (${actionable.length - created} failed, ${observations.length - actionable.length} skipped)`);
    try {
      await client.app.log({
        body: {
          service: "auto-observer",
          level: "info",
          message: `Auto-observed ${created} user behavior pattern(s) from ${actionable.length} enriched (${observations.length - actionable.length} skipped as noise)`,
        },
      });
    } catch (err: any) {
      console.error(`[auto-observer] ERROR logging to client app log:`, err.message);
    }
  } else {
    console.log(`[auto-observer] No observations created (0/${actionable.length} succeeded)`);
  }

  return created;
}

/**
 * POST a pipeline event to the Ingenium API for observability.
 */
async function logPipelineEvent(project: string, title: string, data: any) {
  console.log(`[auto-observer] Logging pipeline event: "${title}"`);
  try {
    const res = await fetch(`${API_BASE}/pipeline/events?project=${project}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "observation_created",
        event_source: "plugin",
        title,
        description: JSON.stringify(data),
        importance: 4,
      }),
    });
    if (!res.ok) {
      console.warn(`[auto-observer] Pipeline event API returned ${res.status}: ${res.statusText}`);
    } else {
      console.log(`[auto-observer] Pipeline event logged successfully`);
    }
  } catch (err: any) {
    console.error(`[auto-observer] ERROR logging pipeline event:`, err.message);
  }
}

export const AutoObserverPlugin = async (ctx: { worktree: string; client: any }) => {
  const worktree = ctx.worktree;
  let turnCount = 0;
  const CHECK_INTERVAL = 5; // check every 5 idle events

  return {
    event: async ({ event }: { event: any }) => {
      if (event.type === "session.created") {
        console.log("[auto-observer] session.created — running detection");
        turnCount = 0;
        try {
          // Run detection immediately on session start
          const observations = await detectPatterns();
          if (observations.length > 0) {
            const enriched = await enrichObservations(observations);
            const created = await createObservations(enriched, ctx.client);
            await logPipelineEvent(
              PROJECT,
              `Auto-observer: ${observations.length} detected, ${created} created`,
              { detected: observations.length, created, enriched: enriched.length, dbfound: true },
            );
          } else {
            // Even when nothing found, log so we know the plugin is alive
            console.log("[auto-observer] session.created — no patterns detected");
            await logPipelineEvent(PROJECT, "Auto-observer: scanned — no patterns found", {
              dbfound: true,
              scanned: true,
            });
          }
        } catch (err: any) {
          console.error("[auto-observer] session.created — failed:", err.message);
          await logPipelineEvent(PROJECT, "Auto-observer: failed", {
            error: err?.message ?? String(err),
            dbfound: false,
          });
        }
      }

      if (event.type === "session.idle") {
        turnCount++;
        if (turnCount % CHECK_INTERVAL !== 0) return;

        console.log(`[auto-observer] session.idle — turn ${turnCount}, running detection`);
        try {
          const observations = await detectPatterns();
          if (observations.length > 0) {
            const enriched = await enrichObservations(observations);
            const created = await createObservations(enriched, ctx.client);
            await logPipelineEvent(
              PROJECT,
              `Auto-observer: ${observations.length} detected, ${created} created`,
              { detected: observations.length, created, enriched: enriched.length, dbfound: true },
            );
          } else {
            console.log(`[auto-observer] session.idle turn ${turnCount} — no patterns detected`);
          }
        } catch (err: any) {
          console.error(`[auto-observer] session.idle turn ${turnCount} — failed:`, err.message);
          await logPipelineEvent(PROJECT, "Auto-observer: failed", {
            error: err?.message ?? String(err),
            dbfound: false,
          });
        }
      }
    },

    tool: {
      auto_observe_now: tool({
        description:
          "Run auto-observer pattern detection immediately against recent user messages. Scans the OpenCode message history for correction, preference, terminology, and workflow patterns, then posts observations to the Ingenium API.",
        args: {},
        async execute(_args: any, context: { worktree: string }) {
          console.log("[auto-observer] auto_observe_now tool invoked — running detection");
          const observations = await detectPatterns();
          const enriched = await enrichObservations(observations);
          const created = await createObservations(enriched, ctx.client);
          console.log(`[auto-observer] auto_observe_now complete: ${observations.length} detected, ${enriched.length} enriched, ${created} created`);
          return JSON.stringify(
            { detected: observations.length, enriched: enriched.length, created, observations: enriched },
            null,
            2,
          );
        },
      }),
    },
  };
};
