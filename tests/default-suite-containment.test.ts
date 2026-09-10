import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const OPT_IN_FILES = [
  "mail.spec.ts",
  "chat-real-provider.smoke.spec.ts",
  "opencode.spec.ts",
  "vscode-docker.spec.ts",
  "integration.spec.ts",
  "qa-mail-darkmode-screenshots.spec.ts",
] as const;

const DEV_PORTS = [3000, 4097, 4098, 4099, 4999];
const PLAYWRIGHT_CONFIGS = [
  "tests/playwright.config.ts",
  "tests/playwright.docker.config.ts",
  "tests/playwright.real-provider.config.ts",
  "tests/playwright.mail.config.ts",
  "tests/playwright.manual.config.ts",
  "tests/dashboard-route-parity/playwright.config.ts",
] as const;

function sourceFor(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function defaultSuiteFiles(): string[] {
  const config = sourceFor("tests/playwright.config.ts");
  const testMatch = config.match(/testMatch:\s*\[([\s\S]*?)\],\s*timeout:/)?.[1];
  if (!testMatch) throw new Error("Unable to read testMatch from the default Playwright config");
  return [...testMatch.matchAll(/["']\*\*\/([^"']+\.spec\.ts)["']/g)]
    .map((match) => `tests/${match[1]}`);
}

describe("default Playwright suite containment", () => {
  it("contains no literal localhost development or Docker endpoints", () => {
    const endpointPatterns = DEV_PORTS.flatMap((port) => [
      new RegExp(`https?://localhost:${port}(?:\\D|$)`),
      new RegExp(`https?://127\\.0\\.0\\.1:${port}(?:\\D|$)`),
    ]);

    for (const file of defaultSuiteFiles()) {
      const source = sourceFor(file);
      for (const pattern of endpointPatterns) {
        expect(source, `${file} contains ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("routes every authenticated default-suite spec through the canonical fixture", () => {
    const authenticatedFiles = defaultSuiteFiles()
      .filter((file) => file.startsWith("tests/ingenium-dashboard/"));

    for (const file of authenticatedFiles) {
      const source = sourceFor(file);
      expect(source, `${file} bypasses the canonical authenticated fixture`).toMatch(
        /from ["']\.\/(?:fixture|external-suite-navigation-governor)["']/,
      );
      expect(source, `${file} imports raw Playwright instead of the canonical fixture`).not.toMatch(
        /from ["']@playwright\/test["']/,
      );
    }
  });

  it("does not select explicit opt-in suites in the default config", () => {
    const config = sourceFor("tests/playwright.config.ts");
    for (const file of OPT_IN_FILES) {
      expect(config).not.toContain(file);
    }
  });

  it("keeps external Docker selection read-only and mail-specific", () => {
    const dockerConfig = sourceFor("tests/playwright.docker.config.ts");
    const mailConfig = sourceFor("tests/playwright.mail.config.ts");
    expect(dockerConfig).toContain("integration.spec.ts");
    expect(dockerConfig).not.toContain("all-pages.spec.ts");
    expect(dockerConfig).not.toContain("mail.spec.ts");
    expect(dockerConfig).not.toContain("chat-real-provider.smoke.spec.ts");
    expect(mailConfig).toContain("mail.spec.ts");
    expect(mailConfig).toContain("mail-global-setup.ts");
  });

  it("serializes Docker browser work against the external gateway budget", () => {
    const dockerConfig = sourceFor("tests/playwright.docker.config.ts");

    expect(dockerConfig).toContain("workers: 1");
    expect(dockerConfig).toContain("fullyParallel: false");
    expect(dockerConfig).toContain("retries: 0");
  });

  it("uses a CJS-compatible canonical repository root in the default config", () => {
    const config = sourceFor("tests/playwright.config.ts");
    expect(config).toContain("getCanonicalRepoRoot(");
    expect(config).toContain("resolve(__dirname, \"..\")");
    expect(config).not.toContain("import.meta.dirname");
  });

  it("uses a CJS-compatible repository root in the manual config", () => {
    const config = sourceFor("tests/playwright.manual.config.ts");
    expect(config).toContain("resolve(__dirname, \"..\")");
    expect(config).not.toContain("import.meta.dirname");
  });

  it("resolves every Playwright output directory from the canonical repository root", () => {
    for (const file of PLAYWRIGHT_CONFIGS) {
      const config = sourceFor(file);
      expect(config, `${file} must use the canonical output helper`).toContain("getPlaywrightOutputDirectory(");
      expect(config, `${file} must not resolve output below tests/tests`).not.toContain("tests/tests");
    }
  });
});
