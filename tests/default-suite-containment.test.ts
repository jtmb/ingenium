import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_SUITE_FILES = [
  "tests/mcp-tools.spec.ts",
  "tests/ingenium-dashboard/mcp-tool-controls.spec.ts",
  "tests/ingenium-dashboard/homepage.spec.ts",
  "tests/ingenium-dashboard/dashboard.spec.ts",
  "tests/ingenium-dashboard/docs-ai.spec.ts",
  "tests/ingenium-dashboard/chat-states.spec.ts",
  "tests/ingenium-dashboard/chat-e2e-smoke.spec.ts",
  "tests/ingenium-dashboard/opencode-chat.spec.ts",
  "tests/ingenium-dashboard/jobs.spec.ts",
  "tests/ingenium-dashboard/pipeline.spec.ts",
  "tests/ingenium-dashboard/settings-providers.spec.ts",
  "tests/ingenium-dashboard/vault-first-run.spec.ts",
  "tests/ingenium-dashboard/lan-api-assertions.spec.ts",
  "tests/ingenium-dashboard/theme-flash.spec.ts",
  "tests/ingenium-dashboard/usage.spec.ts",
] as const;

const OPT_IN_FILES = [
  "mail.spec.ts",
  "chat-real-provider.smoke.spec.ts",
  "opencode.spec.ts",
  "integration.spec.ts",
  "qa-mail-darkmode-screenshots.spec.ts",
] as const;

const DEV_PORTS = [3000, 4097, 4098, 4099, 4999];

function sourceFor(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("default Playwright suite containment", () => {
  it("contains no literal localhost development or Docker endpoints", () => {
    const endpointPatterns = DEV_PORTS.flatMap((port) => [
      new RegExp(`localhost:${port}(?:\\D|$)`),
      new RegExp(`127\\.0\\.0\\.1:${port}(?:\\D|$)`),
    ]);

    for (const file of DEFAULT_SUITE_FILES) {
      const source = sourceFor(file);
      for (const pattern of endpointPatterns) {
        expect(source, `${file} contains ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("does not select explicit opt-in suites in the default config", () => {
    const config = sourceFor("tests/playwright.config.ts");
    for (const file of OPT_IN_FILES) {
      expect(config).not.toContain(file);
    }
  });
});
