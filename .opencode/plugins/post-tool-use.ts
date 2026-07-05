import { Plugin } from "@opencode-ai/plugin";

// Simple in-memory counter for tool call tracking
// In production, use client.storage or similar
let toolCallCount = 0;

const plugin: Plugin = async () => {
  return {
    "tool.execute.after": async (_input, _output) => {
      toolCallCount++;

      if (toolCallCount % 10 === 0) {
        console.info(
          `Session checkpoint: ${toolCallCount} tool calls. ` +
            "Remember to log new patterns to .agents/skills/learnings.md. " +
            "If you created new conventions or patterns, run /update-skills. " +
            "Docs changed? Run /generate-docs."
        );
      }
    },
  };
};

export default plugin;
