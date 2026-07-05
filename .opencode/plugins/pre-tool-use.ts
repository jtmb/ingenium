import { Plugin } from "@opencode-ai/plugin";

const BUILD_DIR_PATTERN =
  /(find|grep|rg).*(node_modules|\.git|dist|build|\.next|target|__pycache__|venv)/;

const plugin: Plugin = async () => {
  return {
    "tool.execute.before": async (input: { tool: string; sessionID: string; callID: string }, output: { args: any[] }) => {
      // Only intercept bash commands
      if (input.tool !== "bash") return;

      const command = output.args?.join(" ") ?? "";
      if (BUILD_DIR_PATTERN.test(command)) {
        console.warn(
          "Command targets node_modules or build directories — this may hang the terminal. " +
            "Alternatives: use language tools (tsc --noEmit, cargo check), " +
            "read package manifests, or narrow the search path."
        );
      }
    },
  };
};

export default plugin;
