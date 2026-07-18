/**
 * Onboarding Sync Plugin — Thin backward-compat wrapper.
 *
 * Delegates disk→API push logic to resource-sync.ts. The server sync (MCP servers
 * from opencode.json mcp{} block) is handled inline since resource-sync.ts does
 * not manage servers (MCP servers are OpenCode-specific, not general resources).
 *
 * Published to npm for existing installations — do NOT delete.
 *
 * NOTE: Server sync is kept inline because MCP server definitions live in the
 * opencode.json "mcp" block, which is OpenCode-specific configuration, not a
 * general resource like skills/agents/plugins.
 */
import { pushDiskToApi } from "./resource-sync.js";
import { ensureExtensionProject } from "./project-resolver.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const API_BASE = (typeof process !== "undefined" ? process.env.INGENIUM_API_URL : undefined) ?? "http://localhost:4097/api/v1";

type UpsertResult = { created: number; skipped: number; errors: number };

function logResult(service: string, result: UpsertResult): string {
  return `onboarding-sync/${service}: created ${result.created}, skipped ${result.skipped}, errors ${result.errors}`;
}

/**
 * Sync MCP servers from opencode.json mcp{} block to the API.
 * MCP servers are read from the project's opencode.json "mcp" section and upserted
 * via the API's sync-all endpoint (create new, skip existing).
 *
 * HACK: JSONC-style comments are stripped before parsing because opencode.json
 * is technically JSONC, not strict JSON.
 */
async function syncServers(worktree: string, project: string): Promise<UpsertResult> {
  const result: UpsertResult = { created: 0, skipped: 0, errors: 0 };
  try {
    const opencodePath = resolve(worktree, "opencode.json");
    if (!existsSync(opencodePath)) return result;

    const raw = readFileSync(opencodePath, "utf-8");
    const stripped = raw.replace(/^\s*\/\/.*$/gm, "");
    const config = JSON.parse(stripped);
    const mcpBlock = config.mcp;
    if (!mcpBlock || typeof mcpBlock !== "object") return result;

    // Fetch existing servers to distinguish created vs skipped
    const listRes = await fetch(`${API_BASE}/servers?project=${encodeURIComponent(project)}`);
    const existing = new Set<string>();
    if (listRes.ok) {
      const listData = await listRes.json() as { data: Array<{ name: string }> };
      for (const s of listData.data) existing.add(s.name);
    }

    const serverEntries = Object.entries(mcpBlock) as [string, any][];
    if (serverEntries.length === 0) return result;

    const serverPayloads = serverEntries.map(([name, entry]) => {
      // entry.command can be a string or array (command + args)
      const cmdArray: string[] = Array.isArray(entry.command) ? entry.command : [String(entry.command ?? "")];
      const command = cmdArray[0] || "";
      const args = cmdArray.length > 1 ? JSON.stringify(cmdArray.slice(1)) : undefined;
      const env = entry.environment ? JSON.stringify(entry.environment) : undefined;
      return { name, command, args, env, source: "opencode" as const };
    });

    // Upsert all servers in a single API call
    const syncRes = await fetch(`${API_BASE}/servers/sync-all?project=${encodeURIComponent(project)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ servers: serverPayloads }),
    });
    if (syncRes.ok) {
      const newCount = serverPayloads.filter((p) => !existing.has(p.name)).length;
      const updatedCount = serverPayloads.length - newCount;
      result.created = newCount;
      result.skipped = updatedCount;
    } else {
      result.errors++;
    }
  } catch { result.errors++; }
  return result;
}

export const OnboardingSyncPlugin = async (ctx: { worktree: string; client: any }) => {
  const worktree = ctx.worktree;

  return {
    event: async ({ event }: { event: any }) => {
      if (event.type !== "session.created") return;

      const project = await ensureExtensionProject(worktree, API_BASE);
      const pushResult = await pushDiskToApi(worktree);

      // Server sync is handled inline (not in resource-sync.ts) because MCP server
      // definitions are OpenCode-specific config, not general resources
      const srvR = await syncServers(worktree, project);

      const parts: string[] = [];
      const plugR = pushResult.plugins;
      const cfgR = pushResult.configs;
      const cmdR = pushResult.commands;
      const agtR = pushResult.agents;
      const sklR = pushResult.skills;

      if (plugR.created > 0 || plugR.skipped > 0 || plugR.errors > 0)
        parts.push(logResult("plugins", plugR));
      if (cfgR.created > 0 || cfgR.skipped > 0 || cfgR.errors > 0)
        parts.push(logResult("configs", cfgR));
      if (cmdR.created > 0 || cmdR.skipped > 0 || cmdR.errors > 0)
        parts.push(logResult("commands", cmdR));
      if (agtR.created > 0 || agtR.skipped > 0 || agtR.errors > 0)
        parts.push(logResult("agents", agtR));
      if (sklR.created > 0 || sklR.skipped > 0 || sklR.errors > 0)
        parts.push(logResult("skills", sklR));
      if (srvR.created > 0 || srvR.skipped > 0 || srvR.errors > 0)
        parts.push(logResult("servers", srvR));

      if (parts.length > 0) {
        await ctx.client.app.log({
          body: {
            service: "onboarding-sync",
            level: "info",
            message: parts.join(" | "),
          },
        });
      }
    },
  };
};
