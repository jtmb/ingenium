import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreRoot = resolve(apiRoot, "../../packages/ingenium-core");
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
      expect(runtimeOutput).toContain("[api] FATAL API authentication configuration is invalid");
      expect(runtimeOutput).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find module/);
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it("keeps the unseal migration trigger in a clean core distribution", () => {
    // Keep the temporary distribution below the workspace so Node's normal
    // upward package lookup can resolve the monorepo's better-sqlite3 install.
    const outputDirectory = mkdtempSync(join(apiRoot, ".core-clean-build-"));
    const databasePath = join(outputDirectory, "runtime", "data.db");
    const coreEntry = pathToFileURL(join(outputDirectory, "lib", "index.js")).href;
    const legacySecret = "clean-build-unseal-migration-secret";

    try {
      const build = spawnSync(
        process.execPath,
        [tscPath, "--project", join(coreRoot, "tsconfig.json"), "--outDir", outputDirectory],
        { cwd: coreRoot, encoding: "utf8", timeout: 60_000 },
      );
      const buildOutput = `${build.stdout}\n${build.stderr}`;

      expect(build.error, buildOutput).toBeUndefined();
      expect(build.status, buildOutput).toBe(0);
      expect(existsSync(join(outputDirectory, "lib", "index.js"))).toBe(true);
      expect(existsSync(join(outputDirectory, "lib", "tools", "protected-settings.js"))).toBe(true);

      // tsc emits JavaScript but not the SQL migration assets consumed by the
      // compiled database module, so make this a real clean distribution.
      cpSync(join(coreRoot, "data"), join(outputDirectory, "data"), { recursive: true });

      const runtime = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `
            const core = await import(${JSON.stringify(coreEntry)});
            const project = core.projects.createProject("global-default", true);
            core.vault.initVault(project.id, "clean-build-vault-passphrase");
            core.getDb().prepare(
              "INSERT INTO settings (project_id, key, value) VALUES (?, ?, ?)",
            ).run(project.id, "oauth_gmail_client_secret", ${JSON.stringify(legacySecret)});
            const unsealed = core.vault.unsealVault(project.id, "clean-build-vault-passphrase");
            const legacy = core.getDb().prepare(
              "SELECT value FROM settings WHERE project_id = ? AND key = ?",
            ).get(project.id, "oauth_gmail_client_secret");
            const decrypted = core.protectedSettings.getOAuthClientSecret(
              project.id,
              "oauth_gmail_client_secret",
            );
            const result = {
              ok: unsealed.ok,
              legacyRemaining: legacy !== undefined,
              decrypted,
            };
            console.log("UNSEAL_MIGRATION_PARITY:" + JSON.stringify(result));
            if (!unsealed.ok || legacy !== undefined || decrypted !== ${JSON.stringify(legacySecret)}) {
              process.exitCode = 1;
            }
          `,
        ],
        {
          cwd: apiRoot,
          encoding: "utf8",
          timeout: 30_000,
          env: {
            ...process.env,
            INGENIUM_CORE_DB_PATH: databasePath,
            INGENIUM_HOME: join(outputDirectory, "home"),
          },
        },
      );
      const runtimeOutput = `${runtime.stdout}\n${runtime.stderr}`;

      expect(runtime.error, runtimeOutput).toBeUndefined();
      expect(runtime.signal, runtimeOutput).toBeNull();
      expect(runtime.status, runtimeOutput).toBe(0);
      expect(runtimeOutput).toContain(
        `UNSEAL_MIGRATION_PARITY:{"ok":true,"legacyRemaining":false,"decrypted":${JSON.stringify(legacySecret)}}`,
      );
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
});
