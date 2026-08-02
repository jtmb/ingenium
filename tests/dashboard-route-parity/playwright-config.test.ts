import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = process.cwd();
const playwrightCli = resolve(repositoryRoot, "node_modules/@playwright/test/cli.js");
const configPath = resolve(repositoryRoot, "tests/dashboard-route-parity/playwright.config.ts");

describe("dashboard route parity Playwright config", () => {
  it("loads through Playwright and lists the exclusive parity spec", () => {
    const result = spawnSync(
      process.execPath,
      [playwrightCli, "test", "--config", configPath, "--list"],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          RUN_DASHBOARD_ROUTE_PARITY: "1",
          INGENIUM_ROUTE_PARITY_URL: "http://localhost:3000",
        },
        encoding: "utf8",
      },
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status, output).toBe(0);
    expect(output).toContain("production-route-parity.spec.ts");
    expect(output).not.toContain("playwright-config.test.ts");
  });

  it("serializes fresh-page navigation against the external gateway", () => {
    const source = readFileSync(configPath, "utf8");

    expect(source).toContain("workers: 1");
    expect(source).toContain("fullyParallel: false");
    expect(source).toContain("retries: 0");
  });
});
