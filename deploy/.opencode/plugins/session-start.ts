import type { Plugin } from "opencode";

const plugin: Plugin = {
  name: "session-start",
  description: "Injects skill loading checklist at session start",

  hooks: {
    "session.created": async (client) => {
      const checklist = [
        "🔴 SESSION START — Skill Loading Checklist:",
        "1. Match skills to task — read AGENTS.md Quick-Reference table",
        "2. Load every matching skill from .agents/skills/<name>/SKILL.md",
        "3. Note all 🔴 HARD RULEs — they override everything",
        "4. Check .agents/skills/learnings.md for recent changes",
        "💡 Tip: Use /help for the skill catalog.",
      ].join("\n");

      client.app.log("info", checklist);
    },
  },
};

export default plugin;
