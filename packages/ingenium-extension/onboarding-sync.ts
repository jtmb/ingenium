import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, basename, dirname, extname } from "node:path";
import { homedir } from "node:os";

const API_BASE = (typeof process !== "undefined" ? process.env.INGENIUM_API_URL : undefined) ?? "http://localhost:4097/api/v1";
const DEFAULT_PROJECT = process.env.INGENIUM_PROJECT || "global-default";

// ── helpers ────────────────────────────────────────────────────────

type UpsertResult = { created: number; skipped: number; errors: number };

function encodeProject(): string {
  return `project=${encodeURIComponent(DEFAULT_PROJECT)}`;
}

/**
 * Strip YAML frontmatter (--- ... ---) from content and return:
 * { body, frontmatter } where frontmatter is a key-value object.
 */
function parseYamlFrontmatter(content: string): { body: string; frontmatter: Record<string, string> } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { body: content, frontmatter: {} };
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const eqIdx = line.indexOf(":");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fm[key] = value;
  }
  return { body: content.slice(match[0].length), frontmatter: fm };
}

function logResult(service: string, result: UpsertResult): string {
  return `onboarding-sync/${service}: created ${result.created}, skipped ${result.skipped}, errors ${result.errors}`;
}

// ── sync functions ─────────────────────────────────────────────────

// 1. Plugins — read opencode.json plugin[] array, push each .ts to API
async function syncPlugins(worktree: string): Promise<UpsertResult> {
  const result: UpsertResult = { created: 0, skipped: 0, errors: 0 };
  try {
    // Read opencode.json from worktree
    const opencodePath = resolve(worktree, "opencode.json");
    if (!existsSync(opencodePath)) return result;

    const raw = readFileSync(opencodePath, "utf-8");
    // Strip comments (// ...) for JSONC parsing
    const stripped = raw.replace(/^\s*\/\/.*$/gm, "");
    const config = JSON.parse(stripped);
    const pluginPaths: string[] = config.plugin || [];
    if (pluginPaths.length === 0) return result;

    // List existing plugins from API
    const listRes = await fetch(`${API_BASE}/plugins?${encodeProject()}`);
    const existing = new Set<string>();
    if (listRes.ok) {
      const listData = await listRes.json() as { data: Array<{ name: string }> };
      for (const p of listData.data) existing.add(p.name);
    }

    for (const pluginPath of pluginPaths) {
      try {
        // Name = filename without extension (e.g. "observer" from "observer.ts")
        const name = basename(pluginPath, extname(pluginPath));
        if (existing.has(name)) { result.skipped++; continue; }

        const fullPath = resolve(worktree, pluginPath);
        if (!existsSync(fullPath)) { result.errors++; continue; }
        const sourceContent = readFileSync(fullPath, "utf-8");

        const createRes = await fetch(`${API_BASE}/plugins?${encodeProject()}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, file_path: pluginPath, source_content: sourceContent }),
        });
        if (createRes.ok) result.created++;
        else result.errors++;
      } catch { result.errors++; }
    }
  } catch { result.errors++; }
  return result;
}

// 2. Config — push opencode.json (project) and ~/.config/opencode/opencode.jsonc (global)
async function syncConfigs(worktree: string): Promise<UpsertResult> {
  const result: UpsertResult = { created: 0, skipped: 0, errors: 0 };
  try {
    // Project config
    const projPath = resolve(worktree, "opencode.json");
    if (existsSync(projPath)) {
      try {
        const content = readFileSync(projPath, "utf-8");
        // Check if config already exists
        const getRes = await fetch(`${API_BASE}/config?${encodeProject()}&type=project`);
        const existing = getRes.ok ? await getRes.json() : null;
        if (existing?.data) { result.skipped++; }
        else {
          const putRes = await fetch(`${API_BASE}/config?${encodeProject()}&type=project`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
          });
          if (putRes.ok) result.created++;
          else result.errors++;
        }
      } catch { result.errors++; }
    }

    // Global config
    const globalPath = resolve(homedir(), ".config", "opencode", "opencode.jsonc");
    if (existsSync(globalPath)) {
      try {
        const content = readFileSync(globalPath, "utf-8");
        const getRes = await fetch(`${API_BASE}/config?${encodeProject()}&type=global`);
        const existing = getRes.ok ? await getRes.json() : null;
        if (existing?.data) { result.skipped++; }
        else {
          const putRes = await fetch(`${API_BASE}/config?${encodeProject()}&type=global`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
          });
          if (putRes.ok) result.created++;
          else result.errors++;
        }
      } catch { result.errors++; }
    }
  } catch { result.errors++; }
  return result;
}

// 3. Commands — read .opencode/commands/*.md, push to API
async function syncCommands(worktree: string): Promise<UpsertResult> {
  const result: UpsertResult = { created: 0, skipped: 0, errors: 0 };
  try {
    const commandsDir = resolve(worktree, ".opencode", "commands");
    if (!existsSync(commandsDir)) return result;

    // List existing commands
    const listRes = await fetch(`${API_BASE}/commands?${encodeProject()}`);
    const existing = new Set<string>();
    if (listRes.ok) {
      const listData = await listRes.json() as { data: Array<{ name: string }> };
      for (const c of listData.data) existing.add(c.name);
    }

    const entries = readdirSync(commandsDir);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      try {
        const name = entry.slice(0, -3); // strip .md
        if (existing.has(name)) { result.skipped++; continue; }

        const filePath = resolve(commandsDir, entry);
        const content = readFileSync(filePath, "utf-8");
        const createRes = await fetch(`${API_BASE}/commands?${encodeProject()}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, file_path: entry, content }),
        });
        if (createRes.ok) result.created++;
        else result.errors++;
      } catch { result.errors++; }
    }
  } catch { result.errors++; }
  return result;
}

// 4. Agents — read .opencode/agents/<category>/*.md, push to API
async function syncAgents(worktree: string): Promise<UpsertResult> {
  const result: UpsertResult = { created: 0, skipped: 0, errors: 0 };
  try {
    const agentsDir = resolve(worktree, ".opencode", "agents");
    if (!existsSync(agentsDir)) return result;

    // List existing agents
    const listRes = await fetch(`${API_BASE}/agents?${encodeProject()}`);
    const existing = new Set<string>();
    if (listRes.ok) {
      const listData = await listRes.json() as { data: Array<{ name: string }> };
      for (const a of listData.data) existing.add(a.name);
    }

    const categories = readdirSync(agentsDir);
    for (const category of categories) {
      const catDir = resolve(agentsDir, category);
      if (!statSync(catDir).isDirectory()) continue;
      try {
        const files = readdirSync(catDir);
        for (const file of files) {
          if (!file.endsWith(".md")) continue;
          try {
            const name = file.slice(0, -3); // strip .md
            if (existing.has(name)) { result.skipped++; continue; }

            const filePath = resolve(catDir, file);
            const rawContent = readFileSync(filePath, "utf-8");
            const { body, frontmatter } = parseYamlFrontmatter(rawContent);

            const description = frontmatter.description || "";
            const mode = frontmatter.mode || "subagent";
            const model = frontmatter.model || "";

            const createRes = await fetch(`${API_BASE}/agents?${encodeProject()}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name,
                content: body,
                description,
                category,
                mode,
                model,
              }),
            });
            if (createRes.ok) result.created++;
            else result.errors++;
          } catch { result.errors++; }
        }
      } catch { result.errors++; }
    }
  } catch { result.errors++; }
  return result;
}

// 5. Skills — read .opencode/skills/<name>/SKILL.md + metadata.json, push to API
async function syncSkills(worktree: string): Promise<UpsertResult> {
  const result: UpsertResult = { created: 0, skipped: 0, errors: 0 };
  try {
    const skillsDir = resolve(worktree, ".opencode", "skills");
    if (!existsSync(skillsDir)) return result;

    // List existing skills
    const listRes = await fetch(`${API_BASE}/skills?${encodeProject()}`);
    const existing = new Set<string>();
    if (listRes.ok) {
      const listData = await listRes.json() as { data: Array<{ name: string }> };
      for (const s of listData.data) existing.add(s.name);
    }

    const entries = readdirSync(skillsDir);
    for (const entry of entries) {
      const skillDir = resolve(skillsDir, entry);
      if (!statSync(skillDir).isDirectory()) continue;
      try {
        if (existing.has(entry)) { result.skipped++; continue; }

        const skillMdPath = resolve(skillDir, "SKILL.md");
        if (!existsSync(skillMdPath)) { result.errors++; continue; }

        const rawContent = readFileSync(skillMdPath, "utf-8");
        const { body, frontmatter } = parseYamlFrontmatter(rawContent);

        const name = frontmatter.name || entry;
        const description = frontmatter.description || "";

        // Read metadata.json for tags + always_apply
        let tags = "";
        let alwaysApply = 0;
        const metaPath = resolve(skillDir, "metadata.json");
        if (existsSync(metaPath)) {
          try {
            const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
            tags = Array.isArray(meta.tags) ? meta.tags.join(", ") : (meta.tags || "");
            alwaysApply = meta.alwaysApply ? 1 : 0;
          } catch { /* ignore bad metadata */ }
        }

        const createRes = await fetch(`${API_BASE}/skills?${encodeProject()}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            description,
            content: body,
            tags,
            always_apply: alwaysApply,
          }),
        });
        if (createRes.ok) result.created++;
        else result.errors++;
      } catch { result.errors++; }
    }
  } catch { result.errors++; }
  return result;
}

// 6. MCP servers — read opencode.json mcp{} block, push to API
async function syncServers(worktree: string): Promise<UpsertResult> {
  const result: UpsertResult = { created: 0, skipped: 0, errors: 0 };
  try {
    const opencodePath = resolve(worktree, "opencode.json");
    if (!existsSync(opencodePath)) return result;

    const raw = readFileSync(opencodePath, "utf-8");
    // Strip comments (// ...) for JSONC parsing
    const stripped = raw.replace(/^\s*\/\/.*$/gm, "");
    const config = JSON.parse(stripped);
    const mcpBlock = config.mcp;
    if (!mcpBlock || typeof mcpBlock !== "object") return result;

    // List existing servers
    const listRes = await fetch(`${API_BASE}/servers?${encodeProject()}`);
    const existing = new Set<string>();
    if (listRes.ok) {
      const listData = await listRes.json() as { data: Array<{ name: string }> };
      for (const s of listData.data) existing.add(s.name);
    }

    const serverEntries = Object.entries(mcpBlock) as [string, any][];
    if (serverEntries.length === 0) return result;

    const serverPayloads = serverEntries.map(([name, entry]) => {
      const cmdArray: string[] = Array.isArray(entry.command) ? entry.command : [String(entry.command ?? "")];
      const command = cmdArray[0] || "";
      const args = cmdArray.length > 1 ? JSON.stringify(cmdArray.slice(1)) : undefined;
      const env = entry.environment ? JSON.stringify(entry.environment) : undefined;
      return { name, command, args, env, source: "opencode" as const };
    });

    const syncRes = await fetch(`${API_BASE}/servers/sync-all?${encodeProject()}`, {
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

// ── plugin export ──────────────────────────────────────────────────

export const OnboardingSyncPlugin = async (ctx: { worktree: string; client: any }) => {
  const worktree = ctx.worktree;

  return {
    event: async ({ event }: { event: any }) => {
      if (event.type !== "session.created") return;

      const results = await Promise.all([
        syncPlugins(worktree),
        syncConfigs(worktree),
        syncCommands(worktree),
        syncAgents(worktree),
        syncSkills(worktree),
        syncServers(worktree),
      ]);

      const [plugR, cfgR, cmdR, agtR, sklR, srvR] = results;

      const parts: string[] = [];
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
