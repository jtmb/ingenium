import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildRepositoryManifestV2, syncAgents, syncPlugins, writeAgentToDisk, type SyncManifest } from "./resource-sync.js";

let worktree = "";

function write(path: string, content: string): void {
  const target = join(worktree, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content);
}

function manifest(): SyncManifest {
  return { version: 1, project: "native-fixture", lastFullSync: "",
    resources: { skills: {}, agents: {}, plugins: {}, commands: {}, config: {} } };
}

const names = ["auto-observer", "observer", "resource-sync", "lifecycle", "ponytail"];
const plugins = names.map((name) => `./packages/ingenium-extension/plugins/v2/${name}`);

function config() {
  return {
    agents: { "execution/sync-agent": { model: "openai/gpt-6-sol", variant: "high" } },
    mcp: { servers: { ingenium: { type: "local", disabled: false, environment: { INGENIUM_PROJECT: "native-fixture" } } } },
    providers: { custom: { options: { baseURL: "https://example.invalid" } } },
    custom: { nested: { retained: true } },
    plugins: [plugins[0], { package: plugins[1], options: { retained: "manual" } }, ...plugins.slice(2), "example-user-plugin"],
  };
}

function start(): void {
  worktree = mkdtempSync("/tmp/opencode/ingenium-native113-");
  for (const name of names) mkdirSync(join(worktree, "packages/ingenium-extension/plugins/v2", name), { recursive: true });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (worktree) rmSync(worktree, { recursive: true, force: true });
  worktree = "";
});

describe("native resource-sync consumers in a synthetic worktree", () => {
  it("leaves all five V2 adapters and unrelated settings byte-identical with an empty API plugin list", async () => {
    start();
    const original = `${JSON.stringify(config(), null, 2)}\n`;
    write("opencode.json", original);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }));

    const result = await syncPlugins(worktree, "native-fixture", manifest(), { isInitialSync: false });

    expect(result).toMatchObject({ synced: 0, errors: 0 });
    expect(readFileSync(join(worktree, "opencode.json"), "utf8")).toBe(original);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("adds only enabled API plugins without losing original adapters, user entries, or nested config", async () => {
    start();
    const original = config();
    write("opencode.json", JSON.stringify(original));
    const incoming = [
      { name: "enabled", file_path: ".opencode/plugins/enabled.ts", source_content: "export {};", enabled: true },
      { name: "disabled", file_path: ".opencode/plugins/disabled.ts", source_content: "export {};", enabled: false },
    ];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: incoming }) });
    vi.stubGlobal("fetch", fetchMock);

    const state = manifest();
    await syncPlugins(worktree, "native-fixture", state, { isInitialSync: false });
    const expected = { ...original, plugins: [...original.plugins, incoming[0]!.file_path] };
    expect(JSON.parse(readFileSync(join(worktree, "opencode.json"), "utf8"))).toEqual(expected);
    await syncPlugins(worktree, "native-fixture", state, { isInitialSync: false });
    expect(JSON.parse(readFileSync(join(worktree, "opencode.json"), "utf8"))).toEqual(expected);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("round-trips ordered native and legacy-alias rules, hidden state, skills, and category model", async () => {
    start();
    const original = config();
    write("opencode.json", JSON.stringify(original));
    const permissions = {
      "*": "deny", bash: { "*": "deny", "git status": "allow", "rm -rf *": "deny" },
      write: { "*": "deny", "docs/**": "allow" }, task: { "*": "deny" },
    };
    expect(writeAgentToDisk(worktree, { name: "sync-agent", category: "execution", mode: "subagent",
      content: "# Synthetic agent", description: "Synthetic", model: "unused/never-authoritative",
      permissions: JSON.stringify(permissions), metadata: JSON.stringify({ hidden: true }),
      skills: JSON.stringify(["ponytail"]), enabled: false })).toBe(true);
    const profile = readFileSync(join(worktree, ".opencode/agents/execution/sync-agent.md"), "utf8");
    expect(profile).toContain("# skills:\n#   - ponytail");
    expect(profile).not.toMatch(/^(?:name|model|skills):/m);
    const expected = { "*": "deny", shell: permissions.bash, edit: permissions.write, subagent: permissions.task };
    const projected = buildRepositoryManifestV2(worktree, manifest());
    expect(projected.agents).toEqual([expect.objectContaining({ name: "sync-agent", category: "execution",
      permissions: expected, enabled: false, skills: ["ponytail"], metadata: { hidden: true } })]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const result = await syncAgents(worktree, "native-fixture", manifest(), { isInitialSync: true });
    expect(result).toMatchObject({ pushed: 1, errors: 0 });
    const sent = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
    expect(sent).toMatchObject({ name: "sync-agent", category: "execution", model: "openai/gpt-6-sol",
      enabled: false, metadata: '{"hidden":true}', permissions: JSON.stringify(expected) });
    expect(JSON.parse(readFileSync(join(worktree, "opencode.json"), "utf8"))).toEqual(original);
  });

  it("categorizes root plan.md while rejecting a partially specified native permission rule", () => {
    start();
    write(".opencode/agents/plan.md", '---\ndescription: "Synthetic plan"\nmode: primary\ndisabled: false\nhidden: false\npermissions:\n  - action: "*"\n    resource: "*"\n    effect: deny\n---\n\n# Plan\n');
    expect(buildRepositoryManifestV2(worktree, manifest()).agents).toEqual([
      expect.objectContaining({ name: "plan", category: "primary", permissions: { "*": "deny" } }),
    ]);
    write(".opencode/agents/plan.md", '---\ndescription: "Synthetic plan"\nmode: primary\ndisabled: false\nhidden: false\npermissions:\n  - action: "*"\n    resource: "*"\n    effect: deny\n  - action: shell\n    resource: "git status"\n---\n\n# Plan\n');
    expect(() => buildRepositoryManifestV2(worktree, manifest())).toThrow(/permission/i);
    write(".opencode/agents/plan.md", '---\ndescription: "Synthetic plan"\nmode: primary\ndisabled: false\nhidden: false\npermissions:\n  - action: "*"\n    resource: "*"\n    effect: deny\n  - action: shell\n    resource: "git status"\n    effect: unknown\n---\n\n# Plan\n');
    expect(() => buildRepositoryManifestV2(worktree, manifest())).toThrow(/permission/i);
  });

  it("native root plan model survives initial agent sync without changing categorized agents or config", async () => {
    start();
    const original = { ...config(), agents: {
      plan: { model: "openai/gpt-6-astra#max" },
      ...config().agents,
    } };
    const originalBytes = JSON.stringify(original);
    write("opencode.json", originalBytes);
    const rootPlan = '---\ndescription: "Synthetic plan"\nmode: primary\ndisabled: false\nhidden: false\npermissions:\n  - action: "*"\n    resource: "*"\n    effect: deny\n---\n\n# Plan\n';
    write(".opencode/agents/plan.md", rootPlan);
    expect(writeAgentToDisk(worktree, { name: "sync-agent", category: "execution", content: "# Synthetic execution",
      description: "Synthetic", mode: "subagent", permissions: '{"*":"deny"}', enabled: true })).toBe(true);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
      .mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncAgents(worktree, "native-fixture", manifest(), { isInitialSync: true });
    const posted = fetchMock.mock.calls.slice(1).map((call) => JSON.parse(call[1].body as string));
    expect(posted.find((agent) => agent.name === "plan")).toMatchObject({
      category: "primary", mode: "primary", model: "openai/gpt-6-astra#max", enabled: true,
      permissions: '{"*":"deny"}', metadata: '{"hidden":false}',
    });
    expect(posted.find((agent) => agent.name === "sync-agent")).toMatchObject({
      category: "execution", model: "openai/gpt-6-sol", enabled: true,
    });
    expect(result).toMatchObject({ pushed: 2, errors: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(readFileSync(join(worktree, ".opencode/agents/plan.md"), "utf8")).toBe(rootPlan);
    expect(readFileSync(join(worktree, "opencode.json"), "utf8")).toBe(originalBytes);
  });
});
