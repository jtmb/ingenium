import { readFile } from "node:fs/promises";

/**
 * Protected broker enforcer for OpenCode V2.
 *
 * The managed configuration defines the broker agent, but project configuration
 * merges after global configuration. This plugin appends agent rules and rewrites
 * the broker entry so a project cannot shadow, disable, or re-permission it:
 *
 *  - any agent whose `name` is the broker but whose `id` is not is removed;
 *  - the canonical broker id is rewritten to the protected profile, `subagent`
 *    mode and hidden. The native catalog uses approval-only permissions, while
 *    protected permission and pre-execution hooks deny every broker operation.
 *
 * V1 shipped this as a `config` hook. V2 has no mutable global config object, so
 * the equivalent is an `agent.transform`, which replays onto the merged agent
 * registry after configuration is loaded.
 */

const BROKER = "ingenium-llm-broker";
const PROFILE = "/usr/local/share/ingenium/opencode-managed/agents/ingenium-llm-broker.md";
const DESCRIPTION = "Internal agent for Ingenium LLM broker — never invoke directly";

function profileBody(profile) {
  const end = profile.indexOf("\n---\n", 4);
  if (!profile.startsWith("---\n") || end === -1) throw new Error("Protected broker profile is malformed");
  return profile.slice(end + 5).trim();
}

function brokerPermissions() {
  return [
    { action: "*", resource: "*", effect: "ask" },
    {
      action: "external_directory",
      resource: "/home/appuser/.local/share/opencode/tool-output/*",
      effect: "deny",
    },
    {
      action: "external_directory",
      resource: "/home/ingenium-opencode/.local/share/opencode/tool-output/*",
      effect: "deny",
    },
  ];
}

export default {
  id: "ingenium.enforce-reserved-broker",
  async setup(ctx) {
    const profile = typeof ctx.options?.profilePath === "string" ? ctx.options.profilePath : PROFILE;
    const prompt = profileBody(await readFile(profile, "utf8"));

    const enforce = (editor) => {
      for (const agent of editor.list()) {
        if (agent.id !== BROKER && (agent.name === BROKER || agent.id.endsWith(`/${BROKER}`))) editor.remove(agent.id);
      }
      // V2 can replay this transform while configuration registrations are
      // being replaced. update creates a missing entry; throwing here would
      // permanently disable enforcement during that ordinary reload window.
      editor.update(BROKER, (agent) => {
        agent.name = BROKER;
        agent.description = DESCRIPTION;
        agent.mode = "subagent";
        agent.hidden = true;
        agent.system = prompt;
        agent.permissions = brokerPermissions();
        // Clear every project-controlled field the managed configuration does
        // not own; a merged project entry must not disable or redirect the broker.
        agent.disabled = false;
        agent.model = undefined;
        agent.steps = undefined;
        agent.color = undefined;
        agent.request = { settings: {}, headers: {}, body: {} };
      });
    };

    // Configuration is an internal post-plugin in V2. Its transform can run
    // after external setup and replace the broker. Deny tool authorization
    // independently, including during that activation window.
    await ctx.permission.hook("evaluate", (evaluation) => {
      if (evaluation.agent === BROKER || evaluation.agent?.endsWith(`/${BROKER}`)) {
        evaluation.effect = "deny";
      }
    });
    // Keep native tool definitions available to OpenCode's provider flow without
    // granting execution. This also blocks plugin tools that do not perform a
    // permission assertion themselves, before their implementation can run.
    await ctx.tool.hook("execute.before", (execution) => {
      if (execution.agent === BROKER || execution.agent?.endsWith(`/${BROKER}`)) {
        throw new Error("INGENIUM_BROKER_TOOLS_DENIED");
      }
    });
    let registration = await ctx.agent.transform(enforce);
    const controller = new AbortController();
    const updates = (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (controller.signal.aborted) break;
        if (event.type !== "plugin.updated") continue;
        // Activation has installed the internal configuration transform by
        // this point. Reinsert our transform last, also after plugin reloads.
        await registration.dispose();
        registration = await ctx.agent.transform(enforce);
      }
    })().catch((error) => {
      if (!controller.signal.aborted) {
        console.error("ERROR: protected broker registry enforcement stopped");
      }
    });
    return async () => {
      controller.abort();
      await updates;
      await registration.dispose();
    };
  },
};
