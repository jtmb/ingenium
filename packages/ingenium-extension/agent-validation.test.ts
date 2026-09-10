import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(resolve(root, "tests/test-agent-validation.sh"), "utf8");
const start = source.indexOf("const expected = {");
const end = source.indexOf("// Allowed variants by provider", start);
const config = JSON.parse(readFileSync(resolve(root, "opencode.json"), "utf8"));
const activeNames = readdirSync(resolve(root, ".opencode/agents"), { recursive: true, encoding: "utf8" })
  .filter((path) => path.includes("/") && path.endsWith(".md") && !path.endsWith("/ingenium-llm-broker.md") && !path.endsWith("/plan.md"))
  .map((path) => basename(path, ".md"));

function validate(agent: Record<string, unknown>): string[] {
  if (start < 0 || end < start) throw new Error("Agent model validator block not found");
  return runInNewContext(`const agent = JSON.parse(agentJson);\n${source.slice(start, end)}\nerrors;`, {
    agentJson: JSON.stringify(agent), activeNames, errors: [],
    require: createRequire(import.meta.url),
  });
}

function validatePermissions(profilePath?: string, change?: (source: string) => string): string[] {
  const blockStart = source.indexOf('const fs = require("fs");', source.indexOf("run_permission_parity_validation()"));
  const blockEnd = source.indexOf("\nNODE", blockStart);
  if (blockStart < 0 || blockEnd < blockStart) throw new Error("Permission validator block not found");
  const require = createRequire(import.meta.url);
  return runInNewContext(`${source.slice(blockStart, blockEnd)}\nerrors;`, {
    require: (name: string) => name === "fs" ? {
      ...require("fs"),
      readFileSync: (path: string, encoding: "utf8") => {
        const text = readFileSync(path, encoding);
        return profilePath && resolve(path) === resolve(root, profilePath) && change ? change(text) : text;
      },
    } : require(name),
    process: { argv: ["node", "-", resolve(root, ".opencode/agents"), resolve(root, "opencode.json")], exit: () => undefined },
    console: { log: () => undefined, error: () => undefined },
  });
}

describe("profile-only MCP designations", () => {
  it.each(["primary/ingenium-orchestrator.md", "execution/ingenium-recovery-engineer.md"])(
    "rejects the git show output-write bypass in %s", (profile) => {
      expect(validatePermissions(`.opencode/agents/${profile}`, (text) =>
        text.replace("  bash:\n", '  bash:\n    "git show *": allow\n'))).not.toEqual([]);
    },
  );
  it("accepts exact designated grants and the reported internal/operator-only inventory", () => {
    expect(validatePermissions()).toEqual([]);
  });

  it.each([
    ["primary/ingenium-orchestrator.md", "ingenium_coordination_status"],
    ["primary/ingenium-orchestrator.md", "ingenium_memory_list"],
    ["execution/ingenium-software-engineer-premium.md", "ingenium_coordination_memory_read"],
    ["chat/ingenium-chat.md", "ingenium_memory_save"],
    ["execution/ingenium-qa.md", "ingenium_docs_search"],
    ["research/ingenium-scout.md", "ingenium_docs_search_semantic"],
    ["security/ingenium-security-auditor.md", "ingenium_docs_list_comments"],
  ])("rejects missing %s designation for %s", (profile, tool) => {
    expect(validatePermissions(`.opencode/agents/${profile}`, (text) => text.replace(`  ${tool}: allow\n`, ""))).not.toEqual([]);
  });

  it.each([
    ["execution/ingenium-llm-broker.md", "ingenium_memory_read"],
    ["security/ingenium-security-auditor.md", "ingenium_docs_create_comment"],
    ["chat/ingenium-chat.md", "ingenium_email_send"],
    ["execution/ingenium-docs.md", "ingenium_nonexistent_tool"],
    ["execution/ingenium-software-engineer-fast.md", "ingenium_*"],
  ])("rejects unexpected %s grant for %s", (profile, tool) => {
    expect(validatePermissions(`.opencode/agents/${profile}`, (text) => text.replace('  "*": deny\n', `  "*": deny\n  ${tool}: allow\n`))).not.toEqual([]);
  });
});

describe("AGENT-100 validator model matrix", () => {
  it("accepts model-only mappings and canonical Fast profile identity", () => {
    expect(validate(config.agent)).toEqual([]);
    const profile = readFileSync(resolve(root, ".opencode/agents/execution/ingenium-software-engineer-fast.md"), "utf8");
    expect(profile.split("\n")).toContain("name: ingenium-software-engineer-fast");
    expect(config.agent["ingenium-software-engineer-fast"]).toBeDefined();
  });

  it("accepts only Plan's exact read-only permissions and Explore-only task grant", () => {
    const planError = "Plan profile must retain its exact read-only permissions and Explore-only task grant";
    expect(validatePermissions()).not.toContain(planError);
    for (const [before, after] of [
      ["    ingenium-explore: allow", "    ingenium-explore: allow\n    ingenium-docs: allow"],
      ["    ingenium-explore: allow", "    ingenium-explore: deny"],
      ['  task:\n    "*": deny', '  task:\n    "*": allow'],
      ['  skill:\n    "*": allow', '  skill:\n    "*": deny'],
      ["  edit: deny", "  edit: allow"],
      ["  read: allow", "  read: allow\n  webfetch: allow"],
    ] as const) {
      expect(validatePermissions(".opencode/agents/primary/plan.md", (text) => text.replace(before, after))).toContain(planError);
    }
  });

  it("rejects profile authority in the Plan root mapping", () => {
    expect(validate({ ...config.agent, plan: { ...config.agent.plan, permission: { "*": "deny" } } }))
      .toContain("Plan root mapping must contain only its exact model/variant");
  });

  it.each(["read", "glob", "grep", "list", "webfetch"])("rejects Scout generic %s grants", (tool) => {
    expect(validatePermissions(".opencode/agents/research/ingenium-scout.md", (text) =>
      text.replace('  "*": deny', `  "*": deny\n  ${tool}: allow`))).not.toEqual([]);
  });

  it("still rejects stale models and root permission authority", () => {
    const agent = structuredClone(config.agent);
    agent["ingenium-orchestrator"] = { model: "openai/gpt-5.6-sol", variant: "xhigh", permission: { "*": "allow" } };
    expect(validate(agent)).toEqual(expect.arrayContaining([
      expect.stringContaining("ingenium-orchestrator model must be deepseek/deepseek-v4-flash"),
      expect.stringContaining("mapping must contain only model/variant"),
    ]));
  });
});
