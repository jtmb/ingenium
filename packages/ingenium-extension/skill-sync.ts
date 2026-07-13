import { tool } from "@opencode-ai/plugin";
import { resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const API_BASE = (typeof process !== "undefined" ? process.env.INGENIUM_API_URL : undefined) ?? "http://localhost:4097/api/v1";
const DEFAULT_PROJECT = process.env.INGENIUM_PROJECT || "global-default";

/**
 * Fetch all skills from the API and write any missing ones to the local
 * .opencode/skills/ directory. Returns counts of synced vs skipped.
 */
async function syncSkillsFromApi(worktree: string): Promise<{ synced: number; skipped: number }> {
  let synced = 0;
  let skipped = 0;

  try {
    // 1. List all skills
    const listRes = await fetch(`${API_BASE}/skills?project=${DEFAULT_PROJECT}`);
    if (!listRes.ok) return { synced: 0, skipped: 0 };
    const listData = await listRes.json() as { data: Array<{ id: string; name: string }> };

    // 2. For each skill, check if it exists locally
    for (const skill of listData.data) {
      const dir = resolve(worktree, ".opencode", "skills", skill.name);
      const skillMdPath = resolve(dir, "SKILL.md");

      if (existsSync(skillMdPath)) {
        skipped++;
        continue;
      }

      // 3. Fetch full skill with file_tree
      try {
        const fullRes = await fetch(`${API_BASE}/skills/${encodeURIComponent(skill.name)}?project=${DEFAULT_PROJECT}`);
        if (!fullRes.ok) continue;
        const fullData = await fullRes.json() as { data: { name: string; description: string; content: string; tags?: string; always_apply?: number; file_tree?: string } };
        const s = fullData.data;

        // 4. Write to disk
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

        // Write SKILL.md with YAML frontmatter
        const frontmatter = `---\nname: ${s.name}\ndescription: "${(s.description || "").replace(/"/g, '\\"')}"\n---\n`;
        writeFileSync(skillMdPath, frontmatter + "\n" + s.content);

        // Write metadata.json
        const tags = s.tags ? s.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [];
        const meta = JSON.stringify({ tags, alwaysApply: (s.always_apply || 0) === 1 }, null, 2);
        writeFileSync(resolve(dir, "metadata.json"), meta);

        // Write file_tree entries
        if (s.file_tree) {
          try {
            const tree = JSON.parse(s.file_tree);
            for (const [relPath, content] of Object.entries(tree)) {
              const filePath = resolve(dir, relPath);
              const parent = resolve(filePath, "..");
              if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
              writeFileSync(filePath, content as string, "utf-8");
            }
          } catch { /* skip broken file_tree */ }
        }

        synced++;
      } catch { /* skip individual skill errors */ }
    }
  } catch { /* non-fatal */ }

  return { synced, skipped };
}

export const SkillSyncPlugin = async (ctx: { worktree: string; client: any }) => {
  const worktree = ctx.worktree;

  return {
    event: async ({ event }: { event: any }) => {
      if (event.type === "session.created") {
        const result = await syncSkillsFromApi(worktree);
        if (result.synced > 0) {
          await ctx.client.app.log({
            body: {
              service: "skill-sync",
              level: "info",
              message: `Synced ${result.synced} skill(s) from API to .opencode/skills/ (${result.skipped} already present)`,
            },
          });
        }
      }

      if (event.type === "session.idle") {
        // Periodic check — same logic
        const result = await syncSkillsFromApi(worktree);
        if (result.synced > 0) {
          await ctx.client.app.log({
            body: {
              service: "skill-sync",
              level: "info",
              message: `Synced ${result.synced} skill(s) from API (${result.skipped} already present)`,
            },
          });
        }
      }
    },
  };
};
