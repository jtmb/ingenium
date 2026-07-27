import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "production",
    },
    // Core tool tests override the process-wide INGENIUM_CORE_DB_PATH and
    // derive their disk-sync roots from it. Running files concurrently lets
    // one suite remove another suite's temporary .opencode directory.
    fileParallelism: false,
  },
});
