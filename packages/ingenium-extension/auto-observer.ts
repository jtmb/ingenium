import { tool } from "@opencode-ai/plugin";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const API_BASE = (typeof process !== "undefined" ? process.env.INGENIUM_API_URL : undefined) ?? "http://localhost:4097/api/v1";
const PROJECT = "gh-llm-bootstrap";

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
    /(?:actually|correction|typo|fix|wrong)/i,
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
    /(?:run|execute|start) .*(?:test|build|lint|check|validate)/i,
    /(?:commit|push|git) .*(?:first|before|after|always)/i,
    /(?:ci|cd|deploy|release|publish) .*(?:pipeline|step|flow|process)/i,
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
 * Read recent user messages from the OpenCode DB and detect behavior patterns.
 * Returns observations to create. Uses dynamic import for better-sqlite3 to avoid
 * crashing if the module is unavailable.
 */
async function detectPatterns(dbPath: string): Promise<Array<{ type: string; content: string }>> {
  const results: Array<{ type: string; content: string }> = [];

  try {
    if (!existsSync(dbPath)) return results;

    // Dynamic import — fails gracefully if better-sqlite3 isn't in the runtime
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });

    // Get recent user messages (last 50)
    const messages = db.prepare(
      "SELECT data FROM message ORDER BY time_created DESC LIMIT 50"
    ).all() as Array<{ data: string }>;

    db.close();

    const seen = new Set<string>();

    for (const row of messages) {
      let parsed: any;
      try {
        parsed = JSON.parse(row.data);
      } catch {
        continue;
      }

      // Only process user messages with text content
      const role = parsed.role;
      const content = typeof parsed.content === "string" ? parsed.content : "";
      if (role !== "user" || !content || content.length < 10) continue;

      // Check against each pattern type
      for (const [type, regexps] of Object.entries(PATTERNS)) {
        for (const regex of regexps) {
          const match = content.match(regex);
          if (match) {
            // Build a short, meaningful observation
            const snippet = content.length > 200 ? content.substring(0, 200) : content;
            const key = `${type}:${snippet.substring(0, 60)}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push({ type, content: snippet });
            }
            break; // one match per type per message
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

export const AutoObserverPlugin = async (ctx: { worktree: string; client: any }) => {
  const worktree = ctx.worktree;
  let turnCount = 0;
  const CHECK_INTERVAL = 5; // check every 5 idle events

  return {
    event: async ({ event }: { event: any }) => {
      if (event.type === "session.created") {
        turnCount = 0;
      }

      if (event.type === "session.idle") {
        turnCount++;
        if (turnCount % CHECK_INTERVAL !== 0) return;

        const dbPath = getDbPath();
        const observations = await detectPatterns(dbPath);
        if (observations.length > 0) {
          await createObservations(observations, ctx.client, worktree);
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
          const observations = await detectPatterns(dbPath);
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
