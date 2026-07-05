import type { Plugin } from "opencode";

const BUILD_DIR_PATTERN =
  /(find|grep|rg).*(node_modules|\.git|dist|build|\.next|target|__pycache__|venv)/;

const plugin: Plugin = {
  name: "pre-tool-use",
  description: "Warns when commands target build/cache directories",

  hooks: {
    "tool.execute.before": async (input, output) => {
      // Only intercept bash commands
      if (input.tool !== "bash") return;

      const command = input.args?.join(" ") ?? "";
      if (BUILD_DIR_PATTERN.test(command)) {
        console.warn(
          "⚠️ Command targets node_modules or build directories — this may hang the terminal. " +
            "Alternatives: use language tools (tsc --noEmit, cargo check), " +
            "read package manifests, or narrow the search path."
        );
      }
    },
  },
};

export default plugin;
