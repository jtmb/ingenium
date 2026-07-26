import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const scriptPath = join(process.cwd(), "scripts", "take-screenshots.js");
const screenshotScript = require("../../scripts/take-screenshots.js") as {
  buildScreenshotUrl: (baseUrl: string, route: string) => string;
  captureScreenshots: (options: {
    config: { baseUrl: string; waitTimeoutMs: number };
    screenshotsDir: string;
    launchBrowser: () => Promise<{ newPage: () => Promise<unknown>; close: () => Promise<void> }>;
  }) => Promise<void>;
  resolveScreenshotConfig: (environment: Record<string, string>) => {
    baseUrl: string;
    waitTimeoutMs: number;
  };
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Phase 5AA manual screenshot capture", () => {
  it("resolves an explicit target and configurable state-wait timeout", () => {
    const config = screenshotScript.resolveScreenshotConfig({
      INGENIUM_SCREENSHOT_TARGET: "https://dashboard.example.test/instance/",
      INGENIUM_SCREENSHOT_WAIT_TIMEOUT_MS: "4200",
    });

    expect(config).toEqual({
      baseUrl: "https://dashboard.example.test/instance",
      waitTimeoutMs: 4200,
    });
    expect(screenshotScript.buildScreenshotUrl(config.baseUrl, "/mail"))
      .toBe("https://dashboard.example.test/instance/mail");
    expect(screenshotScript.buildScreenshotUrl(config.baseUrl, "/opencode"))
      .toBe("https://dashboard.example.test/instance/opencode");
  });

  it("accepts the existing dashboard target environment as a compatibility alias", () => {
    expect(screenshotScript.resolveScreenshotConfig({
      INGENIUM_E2E_DASHBOARD_URL: "http://dashboard.example.test",
    })).toEqual({
      baseUrl: "http://dashboard.example.test",
      waitTimeoutMs: 15_000,
    });
  });

  it("exits nonzero when the configured target is invalid", () => {
    const environment = { ...process.env } as Record<string, string>;
    delete environment.INGENIUM_SCREENSHOT_BASE_URL;
    delete environment.INGENIUM_E2E_DASHBOARD_URL;
    environment.INGENIUM_SCREENSHOT_TARGET = "not-an-absolute-url";

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: environment,
      encoding: "utf8",
    });

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/valid absolute URL/i);
  });

  it("propagates capture failures while closing the browser in finally", async () => {
    const screenshotsDir = mkdtempSync(join(tmpdir(), "ingenium-phase-5aa-"));
    temporaryDirectories.push(screenshotsDir);
    let closeCalls = 0;

    const browser = {
      newPage: async () => ({
        goto: async () => {
          throw new Error("configured dashboard target failed");
        },
      }),
      close: async () => {
        closeCalls += 1;
      },
    };

    await expect(screenshotScript.captureScreenshots({
      config: { baseUrl: "https://dashboard.example.test", waitTimeoutMs: 100 },
      screenshotsDir,
      launchBrowser: async () => browser,
    })).rejects.toThrow("configured dashboard target failed");
    expect(closeCalls).toBe(1);
  });

  it("propagates a bounded dashboard state-wait timeout", async () => {
    const screenshotsDir = mkdtempSync(join(tmpdir(), "ingenium-phase-5aa-state-wait-"));
    temporaryDirectories.push(screenshotsDir);
    let closeCalls = 0;
    let observedTimeout;

    const browser = {
      newPage: async () => ({
        goto: async () => ({ status: () => 200 }),
        waitForFunction: async (
          _predicate: unknown,
          _argument: unknown,
          options: { timeout: number },
        ) => {
          observedTimeout = options.timeout;
          const error = new Error("dashboard state did not settle");
          error.name = "TimeoutError";
          throw error;
        },
      }),
      close: async () => {
        closeCalls += 1;
      },
    };

    await expect(screenshotScript.captureScreenshots({
      config: { baseUrl: "https://dashboard.example.test", waitTimeoutMs: 275 },
      screenshotsDir,
      launchBrowser: async () => browser,
    })).rejects.toThrow(/state wait timed out after 275ms/i);
    expect(observedTimeout).toBe(275);
    expect(closeCalls).toBe(1);
  });

  it("propagates an HTTP error response from the configured dashboard target", async () => {
    const screenshotsDir = mkdtempSync(join(tmpdir(), "ingenium-phase-5aa-http-error-"));
    temporaryDirectories.push(screenshotsDir);
    let closeCalls = 0;

    const browser = {
      newPage: async () => ({
        goto: async () => ({ status: () => 503 }),
      }),
      close: async () => {
        closeCalls += 1;
      },
    };

    await expect(screenshotScript.captureScreenshots({
      config: { baseUrl: "https://dashboard.example.test", waitTimeoutMs: 275 },
      screenshotsDir,
      launchBrowser: async () => browser,
    })).rejects.toThrow(/Dashboard target returned HTTP 503/);
    expect(closeCalls).toBe(1);
  });

  it("does not regress to a localhost target or fixed timeout", () => {
    const source = readFileSync(scriptPath, "utf8");

    expect(source).not.toContain("http://localhost");
    expect(source).not.toContain("waitForTimeout");
  });
});
