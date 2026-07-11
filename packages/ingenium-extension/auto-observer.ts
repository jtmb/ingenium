import { tool } from "@opencode-ai/plugin";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const API_BASE = (typeof process !== "undefined" ? process.env.INGENIUM_API_URL : undefined) ?? "http://localhost:4097/api/v1";
// TODO: PROJECT should be dynamic (derived from worktree or env) rather than hardcoded.
// Currently kept for backward compatibility — overridable via INGENIUM_PROJECT env var.
const PROJECT = process.env.INGENIUM_PROJECT || "gh-llm-bootstrap";

// Track last run timestamp for dedup — only process messages newer than this
let lastRunAt = Date.now();

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
 * Resolve the OpenCode DB path from the user's home directory.
 */
function getDbPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return resolve(home, ".local", "share", "opencode", "opencode.db");
}

/**
 * Open the OpenCode DB using Bun's built-in SQLite.
 * Bun's `bun:sqlite` is the native runtime for OpenCode plugins — no native addons needed.
 */
function openDb(): any {
  const dbPath = getDbPath();
  try {
    const { Database } = require("bun:sqlite") as any;
    const db = new Database(dbPath, { readonly: true });
    console.log(`[auto-observer] Opened DB at ${dbPath}`);
    return db;
  } catch (err: any) {
    console.error(`[auto-observer] ERROR: Cannot open OpenCode DB at ${dbPath}:`, err.message);
    return null;
  }
}

/**
 * Read recent user messages from the OpenCode DB and detect behavior patterns.
 *
 * OpenCode v2 DB schema:
 *   - `part` table: id, message_id, session_id, time_created, time_updated, data (JSON)
 *   - `message` table: id, session_id, role, ...
 *   - `session_input` table exists but has 0 rows (dead table — do NOT query it)
 *
 * Uses json_extract() to access fields inside the `data` JSON column.
 * Joins with `message` table to filter for role='user' messages only.
 * Only scans messages newer than `lastRunAt` to avoid rescanning.
 */
async function detectPatterns(): Promise<Array<{ type: string; content: string; context?: string }>> {
  const dbPath = getDbPath();

  if (!existsSync(dbPath)) {
    console.warn(`[auto-observer] DB not found at ${dbPath} — skipping pattern detection`);
    return [];
  }

  const db = openDb();
  if (!db) {
    console.warn("[auto-observer] DB not available — skipping pattern detection");
    return [];
  }

  try {
    // Query part table using json_extract — joins with message table for role filtering.
    // Only scan messages after lastRunAt to avoid rescanning.
    // LIMIT 2000 because agent reasoning/tool-call entries vastly outnumber user text entries
    // (ratio typically 30:1 or higher).
    // message.data is a JSON blob with {role, model, agent, time, summary}
    // part.data is a JSON blob with {type, text} — use json_extract for both
    const rows = db.query(`
      SELECT
        json_extract(p.data, '$.text') as text,
        p.time_created
      FROM part p
      JOIN message m ON p.message_id = m.id
      WHERE json_extract(m.data, '$.role') = 'user'
        AND json_extract(p.data, '$.type') = 'text'
        AND length(json_extract(p.data, '$.text')) > 10
        AND p.time_created > ?
      ORDER BY p.time_created DESC
      LIMIT 2000
    `).all(lastRunAt);

    console.log(`[auto-observer] Scanned ${rows.length} recent user messages from OpenCode DB (since ${new Date(lastRunAt).toISOString()})`);

    if (rows.length === 0) {
      console.log("[auto-observer] No new messages to scan since last run");
      return [];
    }

    const seen = new Set<string>();
    const observations: Array<{ type: string; content: string; context?: string }> = [];

    for (const row of rows) {
      const text = String(row.text || "").trim();
      if (!text || text.length < 10) continue;

      // Update lastRunAt to the latest message time
      if (row.time_created && typeof row.time_created === 'number' && row.time_created > lastRunAt) {
        lastRunAt = row.time_created;
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
            break; // One match per pattern category
          }
        }
      }
    }

    console.log(`[auto-observer] Pattern detection complete: ${observations.length} patterns found across ${PATTERNS.size} categories`);
    return observations;
  } catch (err: any) {
    console.error(`[auto-observer] ERROR during pattern detection:`, err.message, err.stack);
    return [];
  } finally {
    if (db && typeof db.close === 'function') {
      try { db.close(); } catch { /* best effort */ }
    }
  }
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
