import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
