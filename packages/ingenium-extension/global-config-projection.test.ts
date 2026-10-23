import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, chownSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error This deployment-only ESM script intentionally has no TypeScript declaration file.
import { projectOpenCodeContainerConfig, projectOpenCodeGlobalConfig } from "../../scripts/project-opencode-global-config.mjs";
// @ts-expect-error This deployment-only ESM manifest intentionally has no TypeScript declaration file.
import { CANONICAL_PLUGIN_SPECS_V2 } from "./plugin-specs.mjs";
// @ts-expect-error This deployment-only ESM plugin intentionally has no TypeScript declaration file.
import ProtectedBrokerPlugin from "../../config/opencode-managed/plugins/enforce-reserved-broker/index.mjs";

const directories: string[] = [];
const canonicalPluginOrder = ["auto-observer", "observer", "resource-sync", "lifecycle", "ponytail"];

function pluginName(path: string): string | undefined {
  const v2 = path.match(/\/plugins\/v2\/(auto-observer|observer|resource-sync|lifecycle|ponytail)$/);
  if (v2) return v2[1];
  if (path.includes("ponytail")) return "ponytail";
  return path.match(/([^/]+)\.(?:ts|mjs)$/)?.[1];
}

function shellPluginSpecs(path: URL): string[] {
  const block = readFileSync(path, "utf8").match(/"plugins": \[([\s\S]*?)\]/)?.[1];
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
  it("isolates host-only integrations in a separate container config while retaining models and host bytes", () => {
    const source = temporaryConfigPath();
    const destination = temporaryConfigPath();
    const original = JSON.stringify({
      default_agent: "primary/plan",
      agents: { "primary/plan": { model: "provider/model", variant: "high" } },
      permissions: [{ action: "external_directory", resource: "*", effect: "allow" }],
      plugins: ["../host-only/plugin"],
      mcp: { servers: {
        ingenium: { command: ["host-node", "host-mcp"], environment: { PATH: "host-only", INGENIUM_API_TOKEN: "synthetic" } },
        "host-only": { command: ["../host-only/mcp"] },
      } },
    });
    writeFileSync(source, original, { mode: 0o600 });
    projectOpenCodeContainerConfig(source, destination);
    expect(readFileSync(source, "utf8")).toBe(original);
    const projected = JSON.parse(readFileSync(destination, "utf8"));
    expect(projected.default_agent).toBe("plan");
    expect(projected.agents).toEqual({ plan: { model: "provider/model#high" } });
    expect(projected.permissions).toEqual(JSON.parse(original).permissions);
    expect(projected.plugins).toEqual(CANONICAL_PLUGIN_SPECS_V2);
    expect(Object.keys(projected.mcp.servers)).toEqual(["ingenium"]);
    expect(projected.mcp.servers.ingenium.command).toEqual(["node", "/app/packages/ingenium-extension/dist/scripts/mcp-server.js"]);
    expect(projected.mcp.servers.ingenium.environment).not.toHaveProperty("PATH");
    expect(projected.mcp.servers.ingenium.environment).not.toHaveProperty("INGENIUM_API_TOKEN");
    expect(statSync(destination).mode & 0o777).toBe(0o600);
    expect(() => projectOpenCodeContainerConfig(source, source)).toThrow("distinct source and destination");
    expect(readFileSync(source, "utf8")).toBe(original);
    expect(() => projectOpenCodeContainerConfig(join(source, "missing"), destination)).toThrow();
  });

  it("uses the native MCP contract in the image fallback when no operator config is mounted", () => {
    const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
    const generated = dockerfile.match(/RUN echo '(\{[^\n]+\})' > \/app\/config\/opencode\.container\.json/);
    expect(generated).not.toBeNull();
    const fallback = JSON.parse(generated![1]!);
    expect(Object.keys(fallback.mcp)).toEqual(["servers"]);
    expect(fallback.mcp.servers.ingenium).toMatchObject({
      type: "local", disabled: false,
      command: ["node", "/app/packages/ingenium-extension/dist/scripts/mcp-server.js"],
    });
    expect(fallback.mcp.servers.ingenium).not.toHaveProperty("enabled");
  });

  it("projects the canonical root Plan profile without changing its permissions or identity", () => {
    const target = temporaryConfigPath();
    const source = new URL("../../.opencode/agents/", import.meta.url).pathname;
    const projector = new URL("../../scripts/project-agent-profiles.mjs", import.meta.url).pathname;

    execFileSync(process.execPath, [projector, "--project-server-owned", source, target]);

    const projected = join(target, "plan.md");
    expect(readFileSync(projected, "utf8")).toBe(readFileSync(join(source, "plan.md"), "utf8"));
    expect(existsSync(join(target, "primary", "plan.md"))).toBe(false);
    expect(statSync(projected).mode & 0o777).toBe(0o644);
    expect(statSync(projected).nlink).toBe(1);
    const before = statSync(projected);

    execFileSync(process.execPath, [projector, "--project-server-owned", source, target]);

    expect(statSync(projected).ino).toBe(before.ino);
    expect(statSync(projected).mtimeMs).toBe(before.mtimeMs);
  });

  it.each([
    ["source", "symlink"], ["source", "hardlink"],
    ["target", "symlink"], ["target", "hardlink"],
  ])("rejects a %s root Plan %s without modifying its outside file", (side, link) => {
    const directory = temporaryConfigPath();
    const source = join(directory, "source");
    const target = join(directory, "target");
    const outside = join(directory, "outside.md");
    mkdirSync(join(source, "chat"), { recursive: true });
    mkdirSync(target);
    writeFileSync(join(source, "chat", "ingenium-chat.md"), "Chat\n");
    writeFileSync(outside, "Outside must stay private\n", { mode: 0o600 });
    const plan = join(side === "source" ? source : target, "plan.md");
    if (side === "target") writeFileSync(join(source, "plan.md"), "Plan\n");
    if (link === "symlink") symlinkSync(outside, plan);
    else linkSync(outside, plan);
    const projector = new URL("../../scripts/project-agent-profiles.mjs", import.meta.url).pathname;

    expect(() => execFileSync(process.execPath, [projector, "--project-server-owned", source, target], { stdio: "pipe" })).toThrow();
    expect(readFileSync(outside, "utf8")).toBe("Outside must stay private\n");
    expect(statSync(outside).mode & 0o777).toBe(0o600);
  });

  it.each([false, true])("replaces broker shadows through a configuration reload (missing=%s)", async (missing) => {
    const registry = new Map<string, Record<string, unknown>>([
      ["ingenium-llm-broker", {
        id: "ingenium-llm-broker",
        name: "ingenium-llm-broker",
        description: "untrusted",
        disabled: true,
        hidden: false,
        mode: "primary",
        model: "untrusted/model",
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      }],
      ["alias", {
        id: "alias",
        name: "ingenium-llm-broker",
        mode: "primary",
        hidden: false,
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      }],
      ["retained", {
        id: "retained",
        name: "retained",
        mode: "primary",
        hidden: false,
        model: "trusted/model",
        permissions: [],
      }],
    ]);
    registry.set("execution/ingenium-llm-broker", { id: "execution/ingenium-llm-broker",
      name: "Execution Ingenium Llm Broker", mode: "primary", hidden: false,
      permissions: [{ action: "*", resource: "*", effect: "allow" }] });
    if (missing) registry.delete("ingenium-llm-broker");
    const editor = {
      list: () => [...registry.values()],
      get: (id: string) => registry.get(id),
      remove: (id: string) => { registry.delete(id); },
      update: (id: string, update: (agent: Record<string, unknown>) => void) => {
        const agent = registry.get(id) ?? { id, permissions: [] };
        registry.set(id, agent);
        update(agent);
      },
    };

    let evaluate: (evaluation: { agent: string; effect: string }) => void = () => {};
    const cleanup = await ProtectedBrokerPlugin.setup({
      options: { profilePath: new URL("../../.opencode/agents/execution/ingenium-llm-broker.md", import.meta.url).pathname },
      permission: { hook: async (_name: string, callback: typeof evaluate) => { evaluate = callback; } },
      agent: { transform: async (callback: (value: typeof editor) => void) => {
        callback(editor);
        return { dispose: async () => {} };
      } },
      event: { subscribe: async function* () {
        // Native configuration registers after external plugin setup.
        registry.set("ingenium-llm-broker", { id: "ingenium-llm-broker", hidden: false,
          mode: "primary", model: "untrusted/model", permissions: [{ action: "*", resource: "*", effect: "allow" }] });
        yield { type: "plugin.updated" };
      } },
    } as never);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await cleanup();
    for (const agent of ["ingenium-llm-broker", "execution/ingenium-llm-broker"]) {
      const evaluation = { agent, effect: "allow" };
      evaluate(evaluation);
      expect(evaluation.effect).toBe("deny");
    }
    const ordinary = { agent: "plan", effect: "allow" };
    evaluate(ordinary);
    expect(ordinary.effect).toBe("allow");

    expect(registry.get("alias")).toBeUndefined();
    expect(registry.get("execution/ingenium-llm-broker")).toBeUndefined();
    expect(registry.get("retained")).toEqual({
      id: "retained",
      name: "retained",
      mode: "primary",
      hidden: false,
      model: "trusted/model",
      permissions: [],
    });
    const broker = registry.get("ingenium-llm-broker");
    expect(broker).toMatchObject({
      id: "ingenium-llm-broker",
      name: "ingenium-llm-broker",
      description: "Internal agent for Ingenium LLM broker — never invoke directly",
      mode: "subagent",
      hidden: true,
      disabled: false,
      system: expect.stringContaining("This agent is reserved for system use."),
    });
    expect(broker?.model).toBeUndefined();
    expect(broker?.permissions).toEqual([
      { action: "*", resource: "*", effect: "deny" },
      { action: "external_directory", resource: "/home/appuser/.local/share/opencode/tool-output/*", effect: "deny" },
      { action: "external_directory", resource: "/home/ingenium-opencode/.local/share/opencode/tool-output/*", effect: "deny" },
    ]);
  });

  it("keeps root, projected global, Docker, and runtime plugin order aligned", () => {
    const configPath = temporaryConfigPath();
    writeFileSync(configPath, "{}\n", { mode: 0o600 });
    projectOpenCodeGlobalConfig(configPath);

    const rootConfig = JSON.parse(readFileSync(new URL("../../opencode.json", import.meta.url), "utf8")) as {
      plugins: Array<string | { package: string }>;
      mcp: { servers: { ingenium: { environment: Record<string, string> } } };
    };
    const projectedConfig = JSON.parse(readFileSync(configPath, "utf8")) as { plugins: string[] };
    const managedConfig = JSON.parse(readFileSync(new URL("../../config/opencode-managed/opencode.json", import.meta.url), "utf8")) as {
      plugins: string[];
      mcp: { servers: { ingenium: { command: string[]; environment: Record<string, string> } } };
    };

    expect(rootConfig.plugins.filter((spec): spec is string => typeof spec === "string").map(pluginName)).toEqual(canonicalPluginOrder);
    // The repository root config is resolved from its own directory, so it uses
    // relative V2 directories; entrypoints and the projection use the PWD-prefixed
    // canonical form.
    expect(rootConfig.plugins.filter((spec): spec is string => typeof spec === "string")).toEqual(CANONICAL_PLUGIN_SPECS_V2.map((spec: string) =>
      spec.replace("file://{env:PWD}/packages/ingenium-extension/", "./packages/ingenium-extension/"),
    ));
    expect(projectedConfig.plugins).toEqual(CANONICAL_PLUGIN_SPECS_V2);
    expect(managedConfig.plugins.filter((spec) => !spec.includes("enforce-reserved-broker"))).toEqual(CANONICAL_PLUGIN_SPECS_V2);
    expect(managedConfig.plugins.filter((spec) => spec.includes("enforce-reserved-broker"))).toEqual([
      "/usr/local/share/ingenium/opencode-managed/plugins/enforce-reserved-broker",
    ]);
    expect(managedConfig.mcp.servers.ingenium.command).toEqual([
      "node",
      "{env:PWD}/packages/ingenium-extension/dist/scripts/mcp-server.js",
    ]);
    expect(managedConfig.mcp.servers.ingenium.environment.INGENIUM_MCP_CREDENTIAL_FILE).toBe("{env:INGENIUM_MCP_CREDENTIAL_FILE}");
    for (const entrypoint of [
      new URL("../../scripts/docker-entrypoint.sh", import.meta.url),
      new URL("../../scripts/runtime-entrypoint.sh", import.meta.url),
    ]) {
      expect(shellPluginOrder(entrypoint)).toEqual(canonicalPluginOrder);
      expect(shellPluginSpecs(entrypoint)).toEqual(CANONICAL_PLUGIN_SPECS_V2);
    }
    const rootEnvironment = rootConfig.mcp.servers.ingenium.environment;
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

  it("preserves config ownership and shared mode across atomic projection", () => {
    const configPath = temporaryConfigPath();
    writeFileSync(configPath, "{}\n", { mode: 0o660 });
    chmodSync(configPath, 0o660);
    const processUid = process.getuid?.();
    const processGid = process.getgid?.();
    const processGroups = process.getgroups?.();
    if (processUid === undefined || processGid === undefined || processGroups === undefined) {
      throw new Error("Ownership regression requires POSIX process identity APIs");
    }
    const alternateGid = processGroups.find((gid) => gid !== processGid);
    const intendedUid = processUid === 0 ? 1 : processUid;
    const intendedGid = processUid === 0 ? (processGid === 0 ? 1 : 0) : alternateGid;
    let exercisedCrossIdentity = false;

    if (intendedGid !== undefined) {
      try {
        chownSync(configPath, intendedUid, intendedGid);
        exercisedCrossIdentity = intendedUid !== processUid || intendedGid !== processGid;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      }
    }
    if (!exercisedCrossIdentity) chownSync(configPath, processUid, processGid);
    const before = statSync(configPath);

    projectOpenCodeGlobalConfig(configPath);

    const after = statSync(configPath);
    expect({ uid: after.uid, gid: after.gid, mode: after.mode & 0o777 }).toEqual({
      uid: before.uid,
      gid: before.gid,
      mode: 0o660,
    });
    if (!exercisedCrossIdentity) {
      expect({ uid: before.uid, gid: before.gid }).toEqual({ uid: processUid, gid: processGid });
    }
  });

  it("makes unsupported config modes private", () => {
    const configPath = temporaryConfigPath();
    writeFileSync(configPath, "{}\n");
    chmodSync(configPath, 0o666);

    projectOpenCodeGlobalConfig(configPath);

    expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it("replaces legacy bootstrap entries, retains unrelated configuration, and never persists an inline bearer", () => {
    const configPath = temporaryConfigPath();
    const inlineToken = "sentinel_credential_content_123456";
    writeFileSync(configPath, `{
      // Existing operator configuration is retained.
      "provider": { "example": { "enabled": true } },
      "permission": "ask",
      "agent": {
        "operator-agent": { "model": "operator/model", "prompt": "Operator instructions", "permission": "ask" },
        "non-plan-agent": { "permission": { "bash": "allow", "question": "allow" } },
        "ingenium-llm-broker": { "hidden": true, "permission": { "*": "deny", "question": "allow" } },
        "plan": { "model": "operator/plan", "variant": "operator-plan", "permission": "ask", "prompt": "legacy", "disable": true, "hidden": true },
        "ingenium-orchestrator": { "model": "openai/model", "variant": "high", "permission": { "*": "deny" }, "prompt": "legacy", "disable": true, "mode": "primary" }
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
        "/app/packages/ingenium-extension/plugins/session-coordinator.ts",
        "plugins/operator-plugin.ts",
      ],
    }\n`, { mode: 0o600 });
    chmodSync(configPath, 0o600);

    projectOpenCodeGlobalConfig(configPath);

    const raw = readFileSync(configPath, "utf8");
    const config = JSON.parse(raw) as {
      provider: { example: { enabled: boolean } };
      permission: string;
      agent?: Record<string, { [key: string]: unknown }>;
      agents: Record<string, { [key: string]: unknown }>;
      mcp: {
        other: unknown;
        ponytail?: unknown;
        "unrelated-ponytail": unknown;
        servers: { ingenium: { command: string[]; environment: Record<string, string> } };
      };
      plugin?: string[];
      plugins: string[];
    };
    expect(raw).not.toContain(inlineToken);
    expect(config.provider).toEqual({ example: { enabled: true } });
    expect(config.permission).toBe("ask");
    expect(config.agent).toBeUndefined();
    expect(config.agents["operator-agent"]).toEqual({
      model: "operator/model",
      system: "Operator instructions",
      permissions: [{ action: "*", resource: "*", effect: "ask" }],
    });
    expect(config.agents["non-plan-agent"]).toEqual({
      permissions: [
        { action: "shell", resource: "*", effect: "allow" },
        { action: "question", resource: "*", effect: "allow" },
      ],
    });
    expect(config.agents["ingenium-llm-broker"]).toBeUndefined();
    expect(config.agents.plan).toEqual({ model: "operator/plan#operator-plan" });
    expect(config.agents).not.toHaveProperty("primary/plan");
    expect(config.agents["primary/ingenium-orchestrator"]).toEqual({ model: "openai/model#high" });
    expect(config.mcp.other).toEqual({ command: ["other"] });
    expect(config.mcp["unrelated-ponytail"]).toEqual({ command: ["unrelated-ponytail"] });
    expect(config.mcp.ponytail).toBeUndefined();
    expect(config.mcp.servers.ingenium.command).toEqual([
      "node",
      "/app/packages/ingenium-extension/dist/scripts/mcp-server.js",
    ]);
    expect(config.mcp.servers.ingenium.environment).toMatchObject({
      CUSTOM_VALUE: "preserved",
      INGENIUM_API_URL: "http://localhost:4097/api/v1",
      INGENIUM_MCP_CREDENTIAL_FILE: "/run/ingenium-opencode/.ingenium-mcp-credential",
      INGENIUM_MCP_AUDIENCE: "mcp",
      INGENIUM_PROJECT: "ingenium",
      INGENIUM_WORKSPACE_ID: "shared-memory-ingenium",
      INGENIUM_WORKTREE: "/home/brajam/repos/ingenium",
    });
    expect(config.mcp.servers.ingenium.environment.INGENIUM_API_TOKEN).toBeUndefined();
    expect(config.mcp.servers.ingenium.environment.INGENIUM_API_TOKEN_FILE).toBeUndefined();
    expect(config.mcp.servers.ingenium.environment.INGENIUM_MCP_CREDENTIAL).toBeUndefined();
    expect(JSON.stringify(config)).not.toContain(inlineToken);
    expect(config.plugins).toEqual([
      "@other/ponytail",
      "@dietrichgebert/ponytail-extra",
      "plugins/operator-plugin.ts",
      ...CANONICAL_PLUGIN_SPECS_V2,
    ]);
    expect(config.plugin).toBeUndefined();
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it("retires only the exact browser-agent mapping and is idempotent", () => {
    const configPath = temporaryConfigPath();
    writeFileSync(configPath, JSON.stringify({
      agent: {
        "browser-agent": { model: "legacy/browser", variant: "max", permission: { "*": "allow" } },
        "browser-agent-helper": { model: "operator/helper", permission: { "*": "allow" } },
        "operator-agent": { model: "operator/model", permission: "ask" },
        "ingenium-chat": {
          model: "deepseek/deepseek-v4-flash",
          variant: "max",
          prompt: "profile-owned",
        },
        "ingenium-llm-broker": { hidden: true, permission: { "*": "deny" } },
      },
    }), { mode: 0o600 });

    projectOpenCodeGlobalConfig(configPath);
    const firstProjection = readFileSync(configPath, "utf8");
    const agents = (JSON.parse(firstProjection) as { agents: Record<string, unknown> }).agents;

    expect(agents).not.toHaveProperty("browser-agent");
    expect(agents["browser-agent-helper"]).toEqual({
      model: "operator/helper",
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    });
    expect(agents["operator-agent"]).toEqual({
      model: "operator/model",
      permissions: [{ action: "*", resource: "*", effect: "ask" }],
    });
    expect(agents["chat/ingenium-chat"]).toEqual({ model: "deepseek/deepseek-v4-flash#max" });
    expect(agents["ingenium-llm-broker"]).toBeUndefined();

    projectOpenCodeGlobalConfig(configPath);
    expect(readFileSync(configPath, "utf8")).toBe(firstProjection);
  });

  it("migrates the nested Plan override and default to the built-in ID idempotently", () => {
    const configPath = temporaryConfigPath();
    writeFileSync(configPath, JSON.stringify({
      default_agent: "primary/plan",
      agents: {
        "primary/plan": { model: "openai/gpt-6-astra#max", system: "profile-owned", disabled: true },
      },
    }));

    projectOpenCodeGlobalConfig(configPath);

    const projected = readFileSync(configPath, "utf8");
    expect(JSON.parse(projected)).toMatchObject({
      default_agent: "plan",
      agents: { plan: { model: "openai/gpt-6-astra#max" } },
    });
    expect(JSON.parse(projected).agents).toEqual({ plan: { model: "openai/gpt-6-astra#max" } });
    projectOpenCodeGlobalConfig(configPath);
    expect(readFileSync(configPath, "utf8")).toBe(projected);
  });

  it.each([false, true])("preserves the native Plan override when the stale nested override comes first: %s", (nestedFirst) => {
    const configPath = temporaryConfigPath();
    const entries = [
      ["plan", { model: "openai/gpt-6-astra#max" }],
      ["primary/plan", { model: "operator/stale" }],
    ];
    writeFileSync(configPath, JSON.stringify({
      default_agent: "operator-agent",
      agent: { plan: { model: "operator/legacy", variant: "high" } },
      agents: Object.fromEntries(nestedFirst ? entries.reverse() : entries),
    }));

    projectOpenCodeGlobalConfig(configPath);

    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.agents).toEqual({ plan: { model: "openai/gpt-6-astra#max" } });
    expect(config.default_agent).toBe("operator-agent");
    expect(config.agent).toBeUndefined();
  });

  it("rejects permissive unknown Ingenium agent orphans without changing the config", () => {
    const configPath = temporaryConfigPath();
    const source = JSON.stringify({
      provider: { retained: true },
      agent: { "ingenium-unknown": { model: "operator/model", permission: { "*": "allow" } } },
    });
    writeFileSync(configPath, source, { mode: 0o600 });

    expect(() => projectOpenCodeGlobalConfig(configPath)).toThrow(/Permissive unknown Ingenium agent override/);
    expect(readFileSync(configPath, "utf8")).toBe(source);
  });
});
