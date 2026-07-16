/**
 * Skill Sync Plugin — Thin backward-compat wrapper.
 *
 * Delegates to resource-sync.ts for skills-only synchronisation on session.created
 * and session.idle. Published to npm for existing installations — do NOT delete.
 *
 * NOTE: Exists solely for npm backward compatibility. New code should use ResourceSyncPlugin directly.
 */
import { skillsOnlySync } from "./resource-sync.js";

export const SkillSyncPlugin = async (ctx: { worktree: string; client: any }) => {
  const worktree = ctx.worktree;

  return {
    event: async ({ event }: { event: any }) => {
      if (event.type === "session.created") {
        try {
          const result = await skillsOnlySync(worktree);
          if (result.synced > 0) {
            await ctx.client.app.log({
              body: {
                service: "skill-sync",
                level: "info",
                message: `Synced ${result.synced} skill(s) from API to .opencode/skills/ (${result.skipped} already present)`,
              },
            });
          }
        } catch {
          /* non-fatal — sync failures must never break session startup */
        }
      }

      if (event.type === "session.idle") {
        try {
          const result = await skillsOnlySync(worktree);
          if (result.synced > 0) {
            await ctx.client.app.log({
              body: {
                service: "skill-sync",
                level: "info",
                message: `Synced ${result.synced} skill(s) from API (${result.skipped} already present)`,
              },
            });
          }
        } catch {
          /* non-fatal */
        }
      }
    },
  };
};
