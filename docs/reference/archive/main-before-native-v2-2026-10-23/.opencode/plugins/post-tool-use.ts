import { Plugin } from "@opencode-ai/plugin";

// Tool call tracking plugin — silently incrementing counter only.
// Previously: console.info() every 10 calls leaked "Session checkpoint"
// messages as visible system text in the chat/terminal, blocking the UI.
// The reminders to run /update-skills and /generate-docs are already
// in the agent instructions and the learnings.md workflow.

let toolCallCount = 0;

const plugin: Plugin = async () => {
  return {
    "tool.execute.after": async (_input, _output) => {
      toolCallCount++;
      // Silent — agent instructions handle periodic reminders
    },
  };
};

export default plugin;
