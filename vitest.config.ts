import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Retained source snapshots are evidence, not additional test workspaces.
    exclude: [...configDefaults.exclude, "**/.opencode/**", "**/build/**", "**/tests/artifacts/**"],
    // Root lifecycle tests share fixture environment variables and audit the
    // repository artifact root, so sibling files must not overlap.
    fileParallelism: false,
    isolate: true,
  },
});
