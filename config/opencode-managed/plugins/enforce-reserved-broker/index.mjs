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
 *    mode, hidden, and a terminal wildcard deny.
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
    { action: "*", resource: "*", effect: "deny" },
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

    await ctx.agent.transform((editor) => {
      for (const agent of editor.list()) {
        if (agent.id !== BROKER && agent.name === BROKER) editor.remove(agent.id);
      }
      if (editor.get(BROKER) === undefined) {
        throw new Error("Protected broker agent is missing from the managed configuration");
      }
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
    });
  },
};
