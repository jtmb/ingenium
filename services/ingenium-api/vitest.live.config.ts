import { defineConfig } from "vitest/config";

/** Explicit opt-in suite for a real OpenCode server. Never included by `npm test`. */
export default defineConfig({
  test: {
    include: ["tests/live/**/*.integration.ts"],
    testTimeout: 35_000,
  },
});
