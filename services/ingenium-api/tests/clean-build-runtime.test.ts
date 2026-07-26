import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tscPath = createRequire(import.meta.url).resolve("typescript/bin/tsc");

describe("clean-build runtime distribution", () => {
  it("builds an empty distribution and resolves the API entrypoint imports", () => {
    const outputDirectory = mkdtempSync(join(apiRoot, ".clean-build-"));

    try {
      const packageJson = JSON.parse(readFileSync(join(apiRoot, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      };
      expect(packageJson.scripts?.start).toBe("npm run build && node dist/scripts/api-server.js");

      const build = spawnSync(
        process.execPath,
        [tscPath, "--project", "tsconfig.json", "--outDir", outputDirectory],
        { cwd: apiRoot, encoding: "utf8", timeout: 60_000 },
      );
      const buildOutput = `${build.stdout}\n${build.stderr}`;

      expect(build.error, buildOutput).toBeUndefined();
      expect(build.status, buildOutput).toBe(0);

      const entrypoint = join(outputDirectory, "scripts", "api-server.js");
      expect(existsSync(join(outputDirectory, "lib", "middleware", "api-token.js"))).toBe(true);
      expect(existsSync(entrypoint)).toBe(true);

      const runtimeEnvironment: NodeJS.ProcessEnv = {
        ...process.env,
        // An invalid token makes the process exit before binding a port, while
        // ESM still resolves the complete static import graph first.
        INGENIUM_API_TOKEN: "invalid",
      };
      delete runtimeEnvironment.INGENIUM_API_TOKEN_FILE;

      const runtime = spawnSync(process.execPath, [entrypoint], {
        cwd: apiRoot,
        encoding: "utf8",
        env: runtimeEnvironment,
        timeout: 10_000,
      });
      const runtimeOutput = `${runtime.stdout}\n${runtime.stderr}`;

      expect(runtime.error, runtimeOutput).toBeUndefined();
      expect(runtime.signal, runtimeOutput).toBeNull();
      expect(runtime.status, runtimeOutput).toBe(1);
      expect(runtimeOutput).toContain("[api] FATAL API authentication configuration:");
      expect(runtimeOutput).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find module/);
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
});
