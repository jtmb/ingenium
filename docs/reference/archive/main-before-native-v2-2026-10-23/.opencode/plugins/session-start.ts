import { Plugin } from "@opencode-ai/plugin";

// Skill-loading checklist is embedded in AGENTS.md and auto-loaded at
// session start via the `skill-load` skill — no console output needed.
// Previously: console.info() leaked the checklist as visible system
// messages in the chat/terminal, blocking user interaction.

const plugin: Plugin = async () => {
  return {
    event: async (input: { event: { type: string } }) => {
      const event = input.event;
      if (event.type !== "session.created") return;
      // Silent — checklist is already in AGENTS.md + skill-load skill
    },
  };
};

export default plugin;
