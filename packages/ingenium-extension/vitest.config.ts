import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Migration, snapshot and compiler fixtures perform real disk/process work.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["**/*.test.ts"],
    exclude: [
      ...configDefaults.exclude,
      "**/build/**",
      "**/distribution-*/**",
      "**/previous/**",
    ],
    env: {
      NODE_ENV: "production",
    },
  },
});
