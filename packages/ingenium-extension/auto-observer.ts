import { tool } from "@opencode-ai/plugin";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const API_BASE = (typeof process !== "undefined" ? process.env.INGENIUM_API_URL : undefined) ?? "http://localhost:4097/api/v1";
const PROJECT = "gh-llm-bootstrap";

// Track last run timestamp for dedup — only process messages newer than this
let lastRunAt = Date.now();

/**
 * Patterns to detect in user messages.
 * Key: observation_type, Value: regex patterns
 */
const PATTERNS: Record<string, RegExp[]> = {
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
};

/**
 * Find the OpenCode DB path.
 * Searches common locations. Returns the first existing path or the default.
 */
function getDbPath(): string {
  const candidates = [
    resolve(process.env.HOME || "/home/appuser", ".local/share/opencode/opencode.db"),
    "/home/appuser/.local/share/opencode/opencode.db",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

/**
 * Open the OpenCode DB using better-sqlite3.
 * Tries direct require first, falls back to createRequire from worktree.
 */
function openDb(dbPath: string, worktree?: string): any {
  try {
    // Direct require — works in OpenCode's CommonJS plugin runtime
    return (require as any)("better-sqlite3")(dbPath, { readonly: true });
  } catch {
    try {
      // Fallback: resolve from worktree using createRequire
      const { createRequire } = require("node:module");
      const req = createRequire(resolve(worktree || process.cwd(), "noop.js"));
      return req("better-sqlite3")(dbPath, { readonly: true });
    } catch {
      return null;
    }
  }
}

/**
 * Read recent user messages from the OpenCode DB and detect behavior patterns.
 * Returns observations to create.
 */
async function detectPatterns(
  dbPath: string,
  worktree?: string,
): Promise<Array<{ type: string; content: string; context?: string }>> {
  const results: Array<{ type: string; content: string; context?: string }> = [];

  try {
    if (!existsSync(dbPath)) return results;

    const db = openDb(dbPath, worktree);
    if (!db) return results;

    let userTexts: Array<{ text: string; time_created: number }> = [];

    // Try session_input.prompt first
    try {
      const inputs = db
        .prepare(
          "SELECT prompt, time_created FROM session_input WHERE prompt IS NOT NULL AND prompt != '' ORDER BY time_created DESC LIMIT 30",
        )
        .all() as Array<{ prompt: string; time_created: number }>;
      for (const r of inputs) {
        if (r.prompt && r.prompt.length > 10) {
          userTexts.push({ text: r.prompt, time_created: r.time_created });
        }
      }
    } catch {
      /* table may not exist */
    }

    // Fall back to part.data — uses LIMIT 2000 because agent reasoning/tool-call
    // entries vastly outnumber user text entries (ratio typically 30:1 or higher).
    if (userTexts.length === 0) {
      try {
        const parts = db
          .prepare(
            "SELECT data, time_created FROM part ORDER BY time_created DESC LIMIT 2000",
          )
          .all() as Array<{ data: string; time_created: number }>;
        
        // Keep all parts in order for context extraction
        const allParts: Array<{ data: string; time_created: number }> = [];
        
        for (const r of parts) {
          try {
            const d = JSON.parse(r.data);
            allParts.push({ data: r.data, time_created: r.time_created });
            if (
              d.type === "text" &&
              d.text &&
              d.text.length > 10 &&
              r.time_created > lastRunAt
            ) {
              userTexts.push({ text: d.text, time_created: r.time_created });
            }
          } catch {
            /* skip unparseable */
          }
        }
      } catch {
        /* table may not exist */
      }
    }

    db.close();

    // Update dedup timestamp
    lastRunAt = Date.now();

    // Run pattern detection on collected texts
    const seen = new Set<string>();
    for (const entry of userTexts) {
      for (const [type, regexps] of Object.entries(PATTERNS)) {
        for (const regex of regexps) {
          const match = entry.text.match(regex);
          if (match) {
            const snippet = entry.text.length > 200 ? entry.text.substring(0, 200) : entry.text;
            const key = `${type}:${snippet.substring(0, 60)}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push({
                type,
                content: snippet,
                context: undefined, // context set during enrichment call
              });
            }
            break;
          }
        }
      }
    }
  } catch {
    // Non-fatal — better-sqlite3 may not be available in the runtime
  }

  return results;
}

/**
 * Call the LLM enrichment endpoint to extract actionable rules from raw observations.
 * Falls back to originals on any error.
 */
async function enrichObservations(
  observations: Array<{ type: string; content: string; context?: string }>,
): Promise<Array<{ type: string; content: string; context?: string; enriched_content?: string; skip: boolean }>> {
  if (observations.length === 0) return [];

  try {
    const res = await fetch(`${API_BASE}/observations/enrich?project=${PROJECT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observations }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return observations.map(o => ({ ...o, skip: false }));
    }

    const json = await res.json();
    return (json.data || []).map((item: any) => ({
      type: item.type,
      content: item.content,
      context: item.context,
      enriched_content: item.enriched_content,
      skip: item.skip === true,
    }));
  } catch {
    // Non-fatal — fall back to raw observations
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
  worktree: string,
): Promise<number> {
  const actionable = observations.filter(o => !o.skip);
  if (actionable.length === 0) return 0;

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
      if (res.ok) created++;
    } catch {
      // Skip individual errors — don't block the batch
    }
  }

  if (created > 0) {
    await client.app.log({
      body: {
        service: "auto-observer",
        level: "info",
        message: `Auto-observed ${created} user behavior pattern(s) from ${actionable.length} enriched (${observations.length - actionable.length} skipped as noise)`,
      },
    });
  }

  return created;
}

/**
 * POST a pipeline event to the Ingenium API for observability.
 */
async function logPipelineEvent(project: string, title: string, data: any) {
  try {
    await fetch(`${API_BASE}/pipeline/events?project=${project}`, {
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
  } catch {
    // Non-fatal — pipeline event logging is best-effort
  }
}

export const AutoObserverPlugin = async (ctx: { worktree: string; client: any }) => {
  const worktree = ctx.worktree;
  let turnCount = 0;
  const CHECK_INTERVAL = 5; // check every 5 idle events

  return {
    event: async ({ event }: { event: any }) => {
      if (event.type === "session.created") {
        turnCount = 0;
        try {
          // Run detection immediately on session start
          const dbPath = getDbPath();
          const observations = await detectPatterns(dbPath, worktree);
          if (observations.length > 0) {
            const enriched = await enrichObservations(observations);
            const created = await createObservations(enriched, ctx.client, worktree);
            await logPipelineEvent(
              PROJECT,
              `Auto-observer: ${observations.length} detected, ${created} created`,
              { detected: observations.length, created, enriched: enriched.length, dbfound: true },
            );
          } else {
            // Even when nothing found, log so we know the plugin is alive
            await logPipelineEvent(PROJECT, "Auto-observer: scanned — no patterns found", {
              dbfound: true,
              scanned: true,
            });
          }
        } catch (err: any) {
          await logPipelineEvent(PROJECT, "Auto-observer: failed", {
            error: err?.message ?? String(err),
            dbfound: false,
          });
        }
      }

      if (event.type === "session.idle") {
        turnCount++;
        if (turnCount % CHECK_INTERVAL !== 0) return;

        try {
          const dbPath = getDbPath();
          const observations = await detectPatterns(dbPath, worktree);
          if (observations.length > 0) {
            const enriched = await enrichObservations(observations);
            const created = await createObservations(enriched, ctx.client, worktree);
            await logPipelineEvent(
              PROJECT,
              `Auto-observer: ${observations.length} detected, ${created} created`,
              { detected: observations.length, created, enriched: enriched.length, dbfound: true },
            );
          }
        } catch (err: any) {
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
          const dbPath = getDbPath();
          const observations = await detectPatterns(dbPath, context.worktree);
          const enriched = await enrichObservations(observations);
          const created = await createObservations(enriched, ctx.client, context.worktree);
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
