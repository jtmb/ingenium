import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const coreRoot = resolve(apiRoot, "../../packages/ingenium-core");

/**
 * API unit tests exercise the checked-in core source rather than a workspace
 * distribution. Production builds retain the package export contract; this
 * test-only resolution prevents an old generated dist tree from changing the
 * API suite's behavior.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^ingenium-core\/lib\/(.+)$/,
        replacement: `${coreRoot}/lib/$1.ts`,
      },
      {
        find: /^ingenium-core$/,
        replacement: `${coreRoot}/lib/index.ts`,
      },
    ],
  },
  test: {
    // Core owns a process-wide database singleton and API tests temporarily
    // override its environment-backed path. Keep suites serialized and
    // isolated so neither state can leak to a later file.
    fileParallelism: false,
    isolate: true,
  },
});
