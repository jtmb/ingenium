import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readDashboardApiTokenFile } from "../services/ingenium-dashboard/src/lib/dashboard-token";

const repoRoot = resolve(import.meta.dirname, "..");
const playwrightCli = resolve(repoRoot, "node_modules/@playwright/test/cli.js");
const configPath = resolve(repoRoot, "tests/dashboard-route-parity/playwright.config.ts");

function injectedTokenFile(): { path: string; cleanup: () => void } {
  const configured = process.env.INGENIUM_API_TOKEN_FILE?.trim();
  if (configured) {
    readDashboardApiTokenFile(configured);
    return { path: configured, cleanup: () => undefined };
  }

  const directory = mkdtempSync(join(tmpdir(), "ingenium-route-parity-token-"));
  const tokenFile = join(directory, "api-token");
  const container = process.env.INGENIUM_ROUTE_PARITY_TOKEN_CONTAINER?.trim() || "ingenium-control-plane";
  const serverTokenFile = process.env.INGENIUM_ROUTE_PARITY_SERVER_TOKEN_FILE?.trim()
    || "/run/ingenium-secrets/api-token";
  try {
    execFileSync("docker", ["cp", `${container}:${serverTokenFile}`, tokenFile], {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "pipe"],
    });
    chmodSync(tokenFile, 0o600);
    readDashboardApiTokenFile(tokenFile);
    return { path: tokenFile, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
  } catch {
    rmSync(directory, { recursive: true, force: true });
    throw new Error("Unable to inject the protected production API credential for route parity");
  }
}

const token = injectedTokenFile();
try {
  const result = spawnSync(process.execPath, [playwrightCli, "test", "--config", configPath, ...process.argv.slice(2)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RUN_DASHBOARD_ROUTE_PARITY: "1",
      INGENIUM_ROUTE_PARITY_URL: process.env.INGENIUM_ROUTE_PARITY_URL || "http://localhost:3000",
      INGENIUM_E2E_API_URL: process.env.INGENIUM_E2E_API_URL || "http://127.0.0.1:4097/api/v1",
      INGENIUM_API_TOKEN_FILE: token.path,
      INGENIUM_API_TOKEN: undefined,
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  token.cleanup();
}
