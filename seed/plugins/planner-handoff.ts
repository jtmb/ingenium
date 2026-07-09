import { Plugin } from "@opencode-ai/plugin";

/**
 * Planner Handoff Plugin — auto-fills the prompt box when the planner
 * signals it's done and handing off to @ingenium-orchestrator.
 *
 * Watches for "Handing off to @ingenium-orchestrator" in completed
 * text parts. When detected, automatically fills the prompt with
 * "Ok Orchestrator, you are up." and shows a toast.
 */
const plugin: Plugin = async ({ client }) => {
  return {
    "experimental.text.complete": async (_input, output) => {
      // Watch for the planner's handoff signal in completed text parts.
      // Using experimental.text.complete avoids chunk fragmentation risk
      // from streaming — the full text is always available here.
      if (!output.text.includes("Handing off to @ingenium-orchestrator")) {
        return;
      }

      // Avoid double-fire if the same text is re-processed
      if (output.text.includes("⏎ already handled")) return;
      output.text += "\n⏎ already handled";

      // Auto-fill the prompt box
      await client.tui.appendPrompt({
        body: { text: "Ok Orchestrator, you are up." },
      });

      // Show a notification toast
      await client.tui.showToast({
        body: {
          title: "🤖 Planner → Orchestrator",
          message: "Prompt pre-filled. Switch to @ingenium-orchestrator to execute.",
          variant: "info",
          duration: 5000,
        },
      });
    },
  };
};

export default plugin;
