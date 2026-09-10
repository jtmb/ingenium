/**
 * Onboarding Sync Plugin — Thin backward-compat wrapper.
 *
 * Delegates repository-owned resources to resource-sync.ts. Commands, config,
 * and MCP server definitions are deliberately outside this compatibility path.
 *
 * Published to npm for existing installations — do NOT delete.
 *
 */
import { pushDiskToApi } from "./resource-sync.js";

type UpsertResult = { created: number; skipped: number; errors: number };

function logResult(service: string, result: UpsertResult): string {
  return `onboarding-sync/${service}: created ${result.created}, skipped ${result.skipped}, errors ${result.errors}`;
}

export const OnboardingSyncPlugin = async (ctx: { worktree: string; client: any }) => {
  const worktree = ctx.worktree;

  return {
    event: async ({ event }: { event: any }) => {
      if (event.type !== "session.created") return;

      const pushResult = await pushDiskToApi(worktree);

      const parts: string[] = [];
      const plugR = pushResult.plugins;
      const agtR = pushResult.agents;
      const sklR = pushResult.skills;

      if (plugR.created > 0 || plugR.skipped > 0 || plugR.errors > 0)
        parts.push(logResult("plugins", plugR));
      if (agtR.created > 0 || agtR.skipped > 0 || agtR.errors > 0)
        parts.push(logResult("agents", agtR));
      if (sklR.created > 0 || sklR.skipped > 0 || sklR.errors > 0)
        parts.push(logResult("skills", sklR));

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
