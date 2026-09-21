import { readFile } from "node:fs/promises";

const BROKER = "ingenium-llm-broker";
const PROFILE = "/usr/local/share/ingenium/opencode-managed/agents/ingenium-llm-broker.md";

function profileBody(profile) {
  const end = profile.indexOf("\n---\n", 4);
  if (!profile.startsWith("---\n") || end === -1) throw new Error("Protected broker profile is malformed");
  return profile.slice(end + 5).trim();
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function ProtectedBrokerPlugin(_input, options = {}) {
  const profile = typeof options.profilePath === "string" ? options.profilePath : PROFILE;
  const prompt = profileBody(await readFile(profile, "utf8"));

  return {
    config: async (config) => {
      config.agent ??= {};
      for (const [name, agent] of Object.entries(config.agent)) {
        if (name !== BROKER && isRecord(agent) && agent.name === BROKER) delete config.agent[name];
      }
      if (isRecord(config.mode)) delete config.mode[BROKER];
      config.agent[BROKER] = {
        name: BROKER,
        description: "Internal agent for Ingenium LLM broker — never invoke directly",
        mode: "subagent",
        hidden: true,
        prompt,
        permission: {
          "*": "deny",
          external_directory: {
            "/home/appuser/.local/share/opencode/tool-output/*": "deny",
            "/home/ingenium-opencode/.local/share/opencode/tool-output/*": "deny",
          },
        },
      };
    },
  };
}
