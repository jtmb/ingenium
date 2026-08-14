import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const playwrightCli = resolve(repoRoot, "node_modules/@playwright/test/cli.js");
const configPath = resolve(repoRoot, "tests/dashboard-route-parity/playwright.config.ts");

const result = spawnSync(process.execPath, [playwrightCli, "test", "--config", configPath, ...process.argv.slice(2)], {
  cwd: repoRoot,
  env: {
    ...process.env,
    RUN_DASHBOARD_ROUTE_PARITY: "1",
    INGENIUM_API_TOKEN: undefined,
    INGENIUM_API_TOKEN_FILE: undefined,
  },
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
