import type { Plugin } from "opencode";

// Simple in-memory counter for tool call tracking
// In production, use client.storage or similar
let toolCallCount = 0;

const plugin: Plugin = {
  name: "post-tool-use",
  description: "Tracks tool usage and reminds about learnings.md",

  hooks: {
    "tool.execute.after": async (input, output) => {
      toolCallCount++;

      if (toolCallCount % 10 === 0) {
        console.info(
          `📋 Session checkpoint: ${toolCallCount} tool calls. ` +
            "Remember to log new patterns to .agents/skills/learnings.md. " +
            "If you created new conventions or patterns, run /update-skills. " +
            "Docs changed? Run /generate-docs."
        );
      }
    },
  },
};

export default plugin;
