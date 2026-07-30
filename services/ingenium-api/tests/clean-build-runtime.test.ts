import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreRoot = resolve(apiRoot, "../../packages/ingenium-core");
const emailRoot = resolve(apiRoot, "../../packages/ingenium-email");
const tscPath = createRequire(import.meta.url).resolve("typescript/bin/tsc");

function expectSuccessfulBuild(build: ReturnType<typeof spawnSync>): void {
  const output = `${build.stdout}\n${build.stderr}`;
  expect(build.error, output).toBeUndefined();
  expect(build.status, output).toBe(0);
}

function buildCleanCoreDistribution(outputDirectory: string): string {
  const packageDirectory = join(outputDirectory, "node_modules", "ingenium-core");
  const distributionDirectory = join(packageDirectory, "dist");
  mkdirSync(packageDirectory, { recursive: true });

  const build = spawnSync(
    process.execPath,
    [tscPath, "--project", join(coreRoot, "tsconfig.json"), "--outDir", distributionDirectory],
    { cwd: coreRoot, encoding: "utf8", timeout: 60_000 },
  );
  expectSuccessfulBuild(build);

  // tsc emits JavaScript but not the SQL migration assets consumed by the
  // compiled database module.
  cpSync(join(coreRoot, "data"), join(distributionDirectory, "data"), { recursive: true });
  cpSync(join(coreRoot, "package.json"), join(packageDirectory, "package.json"));
  return distributionDirectory;
}

function buildCleanEmailDistribution(outputDirectory: string, coreDistribution: string): string {
  const packageDirectory = join(outputDirectory, "node_modules", "ingenium-email");
  const distributionDirectory = join(packageDirectory, "dist");
  const configPath = join(outputDirectory, "email.tsconfig.json");
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(
    configPath,
    `${JSON.stringify({
      extends: relative(outputDirectory, join(emailRoot, "tsconfig.json")),
      compilerOptions: {
        outDir: distributionDirectory,
        baseUrl: emailRoot,
        paths: {
          "ingenium-core": [relative(emailRoot, join(coreDistribution, "lib", "index.d.ts"))],
          "ingenium-core/lib/*": [relative(emailRoot, join(coreDistribution, "lib", "*.d.ts"))],
        },
      },
    })}\n`,
    "utf8",
  );

  const build = spawnSync(
    process.execPath,
    [tscPath, "--project", configPath],
    { cwd: emailRoot, encoding: "utf8", timeout: 60_000 },
  );
  expectSuccessfulBuild(build);
  cpSync(join(emailRoot, "package.json"), join(packageDirectory, "package.json"));
  return distributionDirectory;
}

function buildCleanApiDistribution(
  outputDirectory: string,
  coreDistribution: string,
  emailDistribution: string,
): string {
  const distributionDirectory = join(outputDirectory, "api-dist");
  const configPath = join(outputDirectory, "api.tsconfig.json");
  writeFileSync(
    configPath,
    `${JSON.stringify({
      extends: relative(outputDirectory, join(apiRoot, "tsconfig.json")),
      compilerOptions: {
        outDir: distributionDirectory,
        baseUrl: apiRoot,
        paths: {
          "ingenium-core": [relative(apiRoot, join(coreDistribution, "lib", "index.d.ts"))],
          "ingenium-core/lib/*": [relative(apiRoot, join(coreDistribution, "lib", "*.d.ts"))],
          "ingenium-email": [relative(apiRoot, join(emailDistribution, "index.d.ts"))],
          "ingenium-email/lib/*": [relative(apiRoot, join(emailDistribution, "lib", "*.d.ts"))],
        },
      },
    })}\n`,
    "utf8",
  );

  const build = spawnSync(
    process.execPath,
    [tscPath, "--project", configPath],
    { cwd: apiRoot, encoding: "utf8", timeout: 60_000 },
  );
  expectSuccessfulBuild(build);
  return distributionDirectory;
}

function withoutWorkspaceCoreDistribution<T>(run: () => T): T {
  const workspaceDistribution = join(coreRoot, "dist");
  const quarantine = `${workspaceDistribution}.clean-build-${process.pid}-${Date.now()}`;
  const restoreWorkspaceDistribution = existsSync(workspaceDistribution);

  if (restoreWorkspaceDistribution) renameSync(workspaceDistribution, quarantine);

  try {
    expect(existsSync(workspaceDistribution)).toBe(false);
    return run();
  } finally {
    // The clean-build subprocesses resolve only their run-owned distribution.
    // Remove any accidental workspace output before restoring the pre-test tree.
    rmSync(workspaceDistribution, { recursive: true, force: true });
    if (restoreWorkspaceDistribution) renameSync(quarantine, workspaceDistribution);
    vi.resetModules();
  }
}

describe("clean-build runtime distribution", () => {
  it("builds an empty distribution without the workspace core dist and resolves the API entrypoint imports", () => {
    const outputDirectory = mkdtempSync(join(apiRoot, ".clean-build-"));

    try {
      const packageJson = JSON.parse(readFileSync(join(apiRoot, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      };
      expect(packageJson.scripts?.start).toBe("npm run build && node dist/scripts/api-server.js");

      withoutWorkspaceCoreDistribution(() => {
        const coreDistribution = buildCleanCoreDistribution(outputDirectory);
        const emailDistribution = buildCleanEmailDistribution(outputDirectory, coreDistribution);
        const apiDistribution = buildCleanApiDistribution(outputDirectory, coreDistribution, emailDistribution);
        const entrypoint = join(apiDistribution, "scripts", "api-server.js");
        expect(existsSync(join(apiDistribution, "lib", "middleware", "api-token.js"))).toBe(true);
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
      });
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it("keeps the unseal migration trigger in a clean core distribution", () => {
    // Keep the temporary distribution below the workspace so Node's normal
    // upward package lookup can resolve the monorepo's better-sqlite3 install.
    const outputDirectory = mkdtempSync(join(apiRoot, ".core-clean-build-"));
    const databasePath = join(outputDirectory, "runtime", "data.db");
    const coreEntry = pathToFileURL(join(outputDirectory, "node_modules", "ingenium-core", "dist", "lib", "index.js")).href;
    const legacySecret = "clean-build-unseal-migration-secret";

    try {
      const distributionDirectory = buildCleanCoreDistribution(outputDirectory);
      expect(existsSync(join(distributionDirectory, "lib", "index.js"))).toBe(true);
      expect(existsSync(join(distributionDirectory, "lib", "tools", "protected-settings.js"))).toBe(true);

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
