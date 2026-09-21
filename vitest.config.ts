import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Root lifecycle tests share fixture environment variables and audit the
    // repository artifact root, so sibling files must not overlap.
    fileParallelism: false,
    isolate: true,
  },
});
