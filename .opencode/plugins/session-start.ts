import { Plugin } from "@opencode-ai/plugin";

const plugin: Plugin = async () => {
  return {
    event: async (input: { event: { type: string } }) => {
      const event = input.event;
      if (event.type !== "session.created") return;
      const checklist = [
        "SESSION START — Skill Loading Checklist:",
        "1. Match skills to task — read AGENTS.md Quick-Reference table",
        "2. Load every matching skill from .agents/skills/<name>/SKILL.md",
        "3. Note all HARD RULEs — they override everything",
        "4. Check .agents/skills/learnings.md for recent changes",
        "Tip: Use /help for the skill catalog.",
      ].join("\n");

      console.info(checklist);
    },
  };
};

export default plugin;
