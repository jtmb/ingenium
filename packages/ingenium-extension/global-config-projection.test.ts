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
      "permission": "ask",
      "agent": {
        "operator-agent": { "model": "operator/model", "question": "allow", "permission": "ask" },
        "non-plan-agent": { "permission": { "bash": "allow", "question": "allow" } },
        "ingenium-llm-broker": { "hidden": true, "permission": { "*": "deny", "question": "allow" } },
        "plan": { "variant": "operator-plan", "permission": "ask" }
      },
      "mcp": {
        "other": { "command": ["other"] },
        "unrelated-ponytail": { "command": ["unrelated-ponytail"] },
        "ponytail": { "command": ["legacy-ponytail"] },
        "ingenium": {
          "command": ["node", "legacy.js"],
          "environment": {
            "INGENIUM_API_TOKEN": "${inlineToken}",
            "CUSTOM_VALUE": "preserved"
          }
        }
      },
      "plugin": [
        "/app/packages/ingenium-extension/auto-observer.ts",
        "/app/packages/ingenium-extension/observer.ts",
        "/app/packages/ingenium-extension/resource-sync.ts",
        "@dietrichgebert/ponytail",
        "@dietrichgebert/ponytail@4.8.4",
        "@dietrichgebert/ponytail@latest",
        "@other/ponytail",
        "@dietrichgebert/ponytail-extra",
        "/app/legacy/.opencode/plugins/ponytail.mjs",
        "/app/packages/ingenium-extension/skill-sync.ts",
        "plugins/operator-plugin.ts",
      ],
    }\n`, { mode: 0o600 });
    chmodSync(configPath, 0o600);

    projectOpenCodeGlobalConfig(configPath);

    const raw = readFileSync(configPath, "utf8");
    const config = JSON.parse(raw) as {
      provider: { example: { enabled: boolean } };
      permission: Record<string, string>;
      agent: Record<string, { permission: Record<string, string>; [key: string]: unknown }>;
      mcp: {
        other: unknown;
        ponytail?: unknown;
        "unrelated-ponytail": unknown;
        ingenium: { command: string[]; environment: Record<string, string> };
      };
      plugin: string[];
    };
    expect(raw).not.toContain(inlineToken);
    expect(config.provider).toEqual({ example: { enabled: true } });
    expect(config.permission).toEqual({ "*": "ask", question: "deny" });
    expect(config.agent["operator-agent"]).toEqual({
      model: "operator/model",
      question: "deny",
      permission: { "*": "ask", question: "deny" },
    });
    expect(config.agent["non-plan-agent"]).toEqual({
      permission: { bash: "allow", question: "deny" },
    });
    expect(config.agent["ingenium-llm-broker"]).toEqual({
      hidden: true,
      permission: { "*": "deny", question: "deny" },
    });
    expect(config.agent.plan).toEqual({
      variant: "operator-plan",
      permission: { "*": "ask", question: "allow" },
    });
    for (const [name, projection] of Object.entries(config.agent)) {
      expect(projection.permission.question).toBe(name === "plan" ? "allow" : "deny");
    }
    expect(config.mcp.other).toEqual({ command: ["other"] });
    expect(config.mcp["unrelated-ponytail"]).toEqual({ command: ["unrelated-ponytail"] });
    expect(config.mcp.ponytail).toBeUndefined();
    expect(config.mcp.ingenium.command).toEqual([
      "node",
      "/app/packages/ingenium-extension/dist/scripts/mcp-server.js",
    ]);
    expect(config.mcp.ingenium.environment).toMatchObject({
      CUSTOM_VALUE: "preserved",
      INGENIUM_API_URL: "http://localhost:4097/api/v1",
      INGENIUM_MCP_CREDENTIAL: "{file:.opencode/.ingenium-mcp-credential}",
      INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/.ingenium-mcp-credential",
      INGENIUM_MCP_AUDIENCE: "mcp",
      INGENIUM_PROJECT: "global-default",
      INGENIUM_WORKSPACE_ID: "global-default-workspace",
      INGENIUM_WORKTREE: "/workspace",
    });
    expect(config.mcp.ingenium.environment.INGENIUM_API_TOKEN).toBeUndefined();
    expect(config.mcp.ingenium.environment.INGENIUM_API_TOKEN_FILE).toBeUndefined();
    expect(config.plugin).toEqual([
      "@other/ponytail",
      "@dietrichgebert/ponytail-extra",
      "plugins/operator-plugin.ts",
      "/app/packages/ingenium-extension/plugins/auto-observer.ts",
      "/app/packages/ingenium-extension/plugins/observer.ts",
      "/app/packages/ingenium-extension/plugins/resource-sync.ts",
      "/app/packages/ingenium-extension/ponytail/.opencode/plugins/ponytail.mjs",
    ]);
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });
});
