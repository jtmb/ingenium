import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coreRoot = resolve(apiRoot, "../../packages/ingenium-core");
const emailRoot = resolve(apiRoot, "../../packages/ingenium-email");
const tscPath = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const outputDirectory = mkdtempSync(join(apiRoot, ".typecheck-core-"));
const coreOutputDirectory = join(outputDirectory, "core-dist");
const emailOutputDirectory = join(outputDirectory, "email-dist");
const emailConfigPath = join(outputDirectory, "email-tsconfig.json");
const configPath = join(outputDirectory, "tsconfig.json");

function runTypeScript(argumentsList, cwd) {
  const result = spawnSync(process.execPath, [tscPath, ...argumentsList], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.error) throw result.error;
  if (result.status === 0) return true;

  process.stderr.write(`${result.stdout}\n${result.stderr}`);
  process.exitCode = result.status ?? 1;
  return false;
}

try {
  if (runTypeScript(["--project", "tsconfig.json", "--outDir", coreOutputDirectory], coreRoot)) {
    writeFileSync(
      emailConfigPath,
      `${JSON.stringify({
        extends: relative(outputDirectory, join(emailRoot, "tsconfig.json")),
        compilerOptions: {
          outDir: emailOutputDirectory,
          baseUrl: emailRoot,
          paths: {
            "ingenium-core": [relative(emailRoot, join(coreOutputDirectory, "lib", "index.d.ts"))],
            "ingenium-core/lib/*": [relative(emailRoot, join(coreOutputDirectory, "lib", "*.d.ts"))],
          },
        },
      })}\n`,
      "utf8",
    );

    if (runTypeScript(["--project", emailConfigPath], emailRoot)) {
      writeFileSync(
        configPath,
        `${JSON.stringify({
          extends: relative(outputDirectory, join(apiRoot, "tsconfig.json")),
          compilerOptions: {
            baseUrl: apiRoot,
            paths: {
              "ingenium-core": [relative(apiRoot, join(coreOutputDirectory, "lib", "index.d.ts"))],
              "ingenium-core/lib/*": [relative(apiRoot, join(coreOutputDirectory, "lib", "*.d.ts"))],
              "ingenium-email": [relative(apiRoot, join(emailOutputDirectory, "index.d.ts"))],
              "ingenium-email/lib/*": [relative(apiRoot, join(emailOutputDirectory, "lib", "*.d.ts"))],
            },
          },
        })}\n`,
        "utf8",
      );

      runTypeScript(["--project", configPath, "--noEmit"], apiRoot);
    }
  }
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
