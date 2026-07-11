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
): Promise<Array<{ type: string; content: string }>> {
  const results: Array<{ type: string; content: string }> = [];

  try {
    if (!existsSync(dbPath)) return results;

    const db = openDb(dbPath, worktree);
    if (!db) return results;

    let userTexts: string[] = [];

    // Try session_input.prompt first (primary — contains actual user text)
    try {
      const inputs = db
        .prepare(
          "SELECT prompt FROM session_input WHERE prompt IS NOT NULL AND prompt != '' ORDER BY time_created DESC LIMIT 30",
        )
        .all() as Array<{ prompt: string }>;
      for (const r of inputs) {
        if (r.prompt && r.prompt.length > 10) userTexts.push(r.prompt);
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
        for (const r of parts) {
          try {
            const d = JSON.parse(r.data);
            if (
              d.type === "text" &&
              d.text &&
              d.text.length > 10 &&
              r.time_created > lastRunAt
            ) {
              userTexts.push(d.text);
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
    for (const text of userTexts) {
      for (const [type, regexps] of Object.entries(PATTERNS)) {
        for (const regex of regexps) {
          const match = text.match(regex);
          if (match) {
            const snippet = text.length > 200 ? text.substring(0, 200) : text;
            const key = `${type}:${snippet.substring(0, 60)}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push({ type, content: snippet });
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
 * POST detected observations to the Ingenium API.
 * Returns the number successfully created.
 */
async function createObservations(
  observations: Array<{ type: string; content: string }>,
  client: any,
  worktree: string,
): Promise<number> {
  if (observations.length === 0) return 0;

  let created = 0;
  for (const obs of observations) {
    try {
      const res = await fetch(`${API_BASE}/observations?project=${PROJECT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observation_type: obs.type,
          content: obs.content,
          importance: 5,
          source: "auto-observer",
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
        message: `Auto-observed ${created} user behavior pattern(s) from ${observations.length} detected`,
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
            const created = await createObservations(observations, ctx.client, worktree);
            await logPipelineEvent(
              PROJECT,
              `Auto-observer: ${observations.length} detected, ${created} created`,
              { detected: observations.length, created, dbfound: true },
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
            const created = await createObservations(observations, ctx.client, worktree);
            await logPipelineEvent(
              PROJECT,
              `Auto-observer: ${observations.length} detected, ${created} created`,
              { detected: observations.length, created, dbfound: true },
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
          const created = await createObservations(observations, ctx.client, context.worktree);
          return JSON.stringify(
            { detected: observations.length, created, observations },
            null,
            2,
          );
        },
      }),
    },
  };
};
