import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error This deployment-only ESM script intentionally has no TypeScript declaration file.
import { projectOpenCodeGlobalConfig } from "../../scripts/project-opencode-global-config.mjs";
// @ts-expect-error This deployment-only ESM manifest intentionally has no TypeScript declaration file.
import { CANONICAL_PLUGIN_SPECS } from "./plugin-specs.mjs";
// @ts-expect-error This deployment-only ESM plugin intentionally has no TypeScript declaration file.
import { ProtectedBrokerPlugin } from "../../config/opencode-managed/enforce-reserved-broker.mjs";

const directories: string[] = [];
const canonicalPluginOrder = ["auto-observer", "observer", "resource-sync", "session-coordinator", "ponytail"];

function pluginName(path: string): string | undefined {
  if (path.includes("ponytail")) return "ponytail";
  return path.match(/([^/]+)\.(?:ts|mjs)$/)?.[1];
}

function shellPluginSpecs(path: URL): string[] {
  const block = readFileSync(path, "utf8").match(/"plugin": \[([\s\S]*?)\]/)?.[1];
  return [...(block?.matchAll(/"([^"]+)"/g) ?? [])].map((match) => match[1]!);
}

function shellPluginOrder(path: URL): Array<string | undefined> {
  return shellPluginSpecs(path).map(pluginName);
}

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
  it("replaces every writable broker shadow without changing normal OpenCode configuration", async () => {
    const config = {
      provider: { retained: { npm: "provider-package" } },
      mcp: { retained: { type: "local", command: ["retained"] } },
      plugin: ["retained-plugin"],
      mode: {
        "ingenium-llm-broker": { model: "untrusted/mode", permission: { "*": "allow" } },
      },
      agent: {
        "ingenium-llm-broker": {
          disable: true,
          hidden: false,
          model: "untrusted/model",
          mode: "primary",
          tools: { bash: true },
          permission: { "*": "allow", bash: "allow" },
        },
        alias: { name: "ingenium-llm-broker", permission: { "*": "allow" } },
        retained: { model: "trusted/model" },
      },
    };

    const plugin = await ProtectedBrokerPlugin({}, {
      profilePath: new URL("../../.opencode/agents/execution/ingenium-llm-broker.md", import.meta.url).pathname,
    });
    await plugin.config(config);

    expect(config.provider).toEqual({ retained: { npm: "provider-package" } });
    expect(config.mcp).toEqual({ retained: { type: "local", command: ["retained"] } });
    expect(config.plugin).toEqual(["retained-plugin"]);
    expect(config.mode).not.toHaveProperty("ingenium-llm-broker");
    expect(config.agent).toEqual({
      retained: { model: "trusted/model" },
      "ingenium-llm-broker": {
        name: "ingenium-llm-broker",
        description: "Internal agent for Ingenium LLM broker — never invoke directly",
        mode: "subagent",
        hidden: true,
        prompt: expect.stringContaining("This agent is reserved for system use."),
        permission: {
          "*": "deny",
          external_directory: {
            "/home/appuser/.local/share/opencode/tool-output/*": "deny",
            "/home/ingenium-opencode/.local/share/opencode/tool-output/*": "deny",
          },
        },
      },
    });
  });

  it("keeps root, projected global, Docker, and runtime plugin order aligned", () => {
    const configPath = temporaryConfigPath();
    writeFileSync(configPath, "{}\n", { mode: 0o600 });
    projectOpenCodeGlobalConfig(configPath);

    const rootConfig = JSON.parse(readFileSync(new URL("../../opencode.json", import.meta.url), "utf8")) as { plugin: string[] };
    const projectedConfig = JSON.parse(readFileSync(configPath, "utf8")) as { plugin: string[] };
    const managedConfig = JSON.parse(readFileSync(new URL("../../config/opencode-managed/opencode.json", import.meta.url), "utf8")) as {
      plugin: string[];
      mcp: { ingenium: { command: string[]; environment: Record<string, string> } };
    };

    expect(rootConfig.plugin.map(pluginName)).toEqual(canonicalPluginOrder);
    expect(rootConfig.plugin).toEqual(CANONICAL_PLUGIN_SPECS);
    expect(projectedConfig.plugin.map(pluginName)).toEqual(canonicalPluginOrder);
    expect(projectedConfig.plugin).toEqual(CANONICAL_PLUGIN_SPECS);
    expect(managedConfig.plugin.filter((spec) => !spec.includes("enforce-reserved-broker.mjs"))).toEqual(CANONICAL_PLUGIN_SPECS);
    expect(managedConfig.mcp.ingenium.command).toEqual([
      "node",
      "{env:PWD}/packages/ingenium-extension/dist/scripts/mcp-server.js",
    ]);
    expect(managedConfig.mcp.ingenium.environment.INGENIUM_MCP_CREDENTIAL_FILE).toBe("{env:INGENIUM_MCP_CREDENTIAL_FILE}");
    for (const entrypoint of [
      new URL("../../scripts/docker-entrypoint.sh", import.meta.url),
      new URL("../../scripts/runtime-entrypoint.sh", import.meta.url),
    ]) {
      expect(shellPluginOrder(entrypoint)).toEqual(canonicalPluginOrder);
      expect(shellPluginSpecs(entrypoint)).toEqual(CANONICAL_PLUGIN_SPECS);
    }
    const rootEnvironment = (rootConfig as unknown as {
      mcp: { ingenium: { environment: Record<string, string> } };
    }).mcp.ingenium.environment;
    expect(rootEnvironment.INGENIUM_MCP_CREDENTIAL).toBeUndefined();
    expect(rootEnvironment.INGENIUM_MCP_CREDENTIAL_FILE).toBe(".opencode/.ingenium-mcp-credential");
    for (const source of [
      readFileSync(new URL("../../scripts/docker-entrypoint.sh", import.meta.url), "utf8"),
      readFileSync(new URL("../../scripts/runtime-entrypoint.sh", import.meta.url), "utf8"),
    ]) {
      expect(source).not.toContain('"INGENIUM_MCP_CREDENTIAL":');
      expect(source).toContain('"INGENIUM_MCP_CREDENTIAL_FILE":');
    }
    const runtimeEntrypoint = readFileSync(new URL("../../scripts/runtime-entrypoint.sh", import.meta.url), "utf8");
    expect(runtimeEntrypoint).toContain('"INGENIUM_STORAGE_MAPPING_HASH": "$INGENIUM_STORAGE_MAPPING_HASH"');
    expect(runtimeEntrypoint).toContain('import("file:///app/packages/ingenium-core/dist/lib/index.js")');
    expect(runtimeEntrypoint).not.toContain('from "ingenium-core"');
    const runtimeOpenCode = readFileSync(new URL("../../scripts/start-runtime-opencode-web.sh", import.meta.url), "utf8");
    expect(runtimeOpenCode).toContain('INGENIUM_STORAGE_MAPPING_HASH="$INGENIUM_STORAGE_MAPPING_HASH"');
  });

  it("replaces legacy bootstrap entries, retains unrelated configuration, and never persists an inline bearer", () => {
    const configPath = temporaryConfigPath();
    const inlineToken = "sentinel_credential_content_123456";
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
            "INGENIUM_MCP_CREDENTIAL": "${inlineToken}",
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
      INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/.ingenium-mcp-credential",
      INGENIUM_MCP_AUDIENCE: "mcp",
      INGENIUM_PROJECT: "global-default",
      INGENIUM_WORKSPACE_ID: "global-default-workspace",
      INGENIUM_WORKTREE: "/workspace",
    });
    expect(config.mcp.ingenium.environment.INGENIUM_API_TOKEN).toBeUndefined();
    expect(config.mcp.ingenium.environment.INGENIUM_API_TOKEN_FILE).toBeUndefined();
    expect(config.mcp.ingenium.environment.INGENIUM_MCP_CREDENTIAL).toBeUndefined();
    expect(JSON.stringify(config)).not.toContain(inlineToken);
    expect(config.plugin).toEqual([
      "@other/ponytail",
      "@dietrichgebert/ponytail-extra",
      "plugins/operator-plugin.ts",
      ...CANONICAL_PLUGIN_SPECS,
    ]);
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });
});
