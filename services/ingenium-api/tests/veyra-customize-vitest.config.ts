import { mergeConfig } from "vitest/config";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import base from "../vitest.config";

const outputRoot = process.env.VEYRA_CUSTOMIZE_OUTPUT_ROOT;
if (!outputRoot || !isAbsolute(outputRoot)) throw new Error("Supply the assigned absolute Customize coordination output root.");
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export default mergeConfig(base, {
  root: apiRoot,
  cacheDir: resolve(outputRoot, "vite-api"),
  test: {
    include: ["tests/veyra-customize-*.test.ts"],
    fileParallelism: false,
    isolate: true,
  },
});
