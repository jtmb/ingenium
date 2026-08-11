import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import dockerConfig, { DOCKER_TEST_MATCH } from "../playwright.docker.config";
import routeParityConfig from "../dashboard-route-parity/playwright.config";
import {
  DOCKER_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS,
  EXTERNAL_SUITE_TRANSITION_INTERVAL_METADATA_KEY,
  ROUTE_PARITY_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS,
} from "./external-suite-navigation-governor";

const repositoryRoot = process.cwd();
const GOVERNOR_IMPORT = 'from "./external-suite-navigation-governor"';
const ROUTE_PARITY_GOVERNOR_IMPORT = 'from "../ingenium-dashboard/external-suite-navigation-governor"';

describe("external-suite Playwright configuration", () => {
  it("selects exactly seven Docker specs using the custom governor fixture", () => {
    expect(DOCKER_TEST_MATCH).toHaveLength(7);

    for (const match of DOCKER_TEST_MATCH) {
      const relativePath = match.replace("**/", "");
      const source = readFileSync(resolve(repositoryRoot, "tests", relativePath), "utf8");
      expect(source).toContain(GOVERNOR_IMPORT);
    }
  });

  it("uses the same fixture lifecycle for production route parity", () => {
    const source = readFileSync(
      resolve(repositoryRoot, "tests/dashboard-route-parity/production-route-parity.spec.ts"),
      "utf8",
    );

    expect(source).toContain(ROUTE_PARITY_GOVERNOR_IMPORT);
  });

  it("configures Docker and route parity from their explicit transition budgets", () => {
    const dockerConfigSource = readFileSync(resolve(repositoryRoot, "tests/playwright.docker.config.ts"), "utf8");
    const routeParityConfigSource = readFileSync(
      resolve(repositoryRoot, "tests/dashboard-route-parity/playwright.config.ts"),
      "utf8",
    );

    expect(DOCKER_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS).toBe(6_000);
    expect(ROUTE_PARITY_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS).toBe(6_000);
    expect(dockerConfig.projects?.[0]?.metadata).toMatchObject({
      [EXTERNAL_SUITE_TRANSITION_INTERVAL_METADATA_KEY]: DOCKER_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS,
    });
    expect(routeParityConfig.projects?.[0]?.metadata).toMatchObject({
      [EXTERNAL_SUITE_TRANSITION_INTERVAL_METADATA_KEY]: ROUTE_PARITY_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS,
    });
    expect(dockerConfigSource).toContain(EXTERNAL_SUITE_TRANSITION_INTERVAL_METADATA_KEY);
    expect(dockerConfigSource).toContain("DOCKER_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS");
    expect(routeParityConfigSource).toContain(EXTERNAL_SUITE_TRANSITION_INTERVAL_METADATA_KEY);
    expect(routeParityConfigSource).toContain("ROUTE_PARITY_EXTERNAL_SUITE_TRANSITION_INTERVAL_MS");
  });
});
