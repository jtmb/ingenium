import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error This deployment-only ESM script intentionally has no TypeScript declaration file.
import { projectOpenCodeGlobalConfig } from "../../scripts/project-opencode-global-config.mjs";

const directories: string[] = [];

function temporaryConfigPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "ingenium-global-config-"));
  directories.push(directory);
  return join(directory, "opencode.jsonc");
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("container OpenCode global-config projection", () => {
  it("replaces legacy bootstrap entries, retains unrelated configuration, and never persists an inline bearer", () => {
    const configPath = temporaryConfigPath();
    const inlineToken = "a".repeat(32);
    writeFileSync(configPath, `{
      // Existing operator configuration is retained.
      "provider": { "example": { "enabled": true } },
      "mcp": {
        "other": { "command": ["other"] },
        "ingenium": {
          "command": ["node", "legacy.js"],
          "environment": {
            "INGENIUM_API_TOKEN": "${inlineToken}",
            "CUSTOM_VALUE": "preserved"
          }
        }
      },
      "plugin": [
        "/app/packages/ingenium-extension/skill-sync.ts",
        "plugins/operator-plugin.ts",
      ],
    }\n`, { mode: 0o600 });
    chmodSync(configPath, 0o600);

    projectOpenCodeGlobalConfig(configPath);

    const raw = readFileSync(configPath, "utf8");
    const config = JSON.parse(raw) as {
      provider: { example: { enabled: boolean } };
      mcp: { other: unknown; ingenium: { command: string[]; environment: Record<string, string> } };
      plugin: string[];
    };
    expect(raw).not.toContain(inlineToken);
    expect(config.provider).toEqual({ example: { enabled: true } });
    expect(config.mcp.other).toEqual({ command: ["other"] });
    expect(config.mcp.ingenium.command).toEqual([
      "node",
      "/app/packages/ingenium-extension/dist/scripts/mcp-server.js",
    ]);
    expect(config.mcp.ingenium.environment).toMatchObject({
      CUSTOM_VALUE: "preserved",
      INGENIUM_API_URL: "http://localhost:4097/api/v1",
      INGENIUM_API_TOKEN_FILE: ".opencode/.ingenium-api-token",
      INGENIUM_PROJECT: "global-default",
      INGENIUM_WORKTREE: "/workspace",
    });
    expect(config.mcp.ingenium.environment.INGENIUM_API_TOKEN).toBeUndefined();
    expect(config.plugin).toEqual([
      "plugins/operator-plugin.ts",
      "/app/packages/ingenium-extension/auto-observer.ts",
      "/app/packages/ingenium-extension/observer.ts",
      "/app/packages/ingenium-extension/resource-sync.ts",
    ]);
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });
});
