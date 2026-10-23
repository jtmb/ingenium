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
const parentStatusActions = [
  "subagent_followup_status", "task_declare_status", "task_complete_status", "lifecycle_operation_status",
] as const;

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
  it.each([
    "primary/ingenium-orchestrator.md", "chat/ingenium-chat.md",
    "execution/ingenium-docs.md", "execution/ingenium-qa.md",
    "execution/ingenium-recovery-engineer.md", "execution/ingenium-software-engineer-fast.md",
    "execution/ingenium-software-engineer-premium.md", "research/ingenium-explore.md",
    "research/ingenium-scout.md", "security/ingenium-security-auditor.md",
  ])("rejects hiding inherited skills in %s", (profile) => {
    const error = "must allow inherited skills and retain the nine explicit repository/Ponytail skill grants";
    const wildcard = '  - action: skill\n    resource: "*"\n    effect: allow\n';
    expect(validatePermissions(`.opencode/agents/${profile}`, (text) => text.replace(wildcard, "")))
      .toEqual(expect.arrayContaining([expect.stringContaining(error)]));
    expect(validatePermissions(`.opencode/agents/${profile}`, (text) => text.replace(
      wildcard, '  - action: skill\n    resource: "*"\n    effect: deny\n',
    ))).toEqual(expect.arrayContaining([expect.stringContaining(error)]));
  });

  it.each(["primary/ingenium-orchestrator.md", "execution/ingenium-recovery-engineer.md"])(
    "rejects the git show output-write bypass in %s", (profile) => {
      expect(validatePermissions(`.opencode/agents/${profile}`, (text) =>
        text.replace("  - action: shell\n", '  - action: shell\n    resource: "git show *"\n    effect: allow\n  - action: shell\n'))).not.toEqual([]);
    },
  );
  it("accepts exact designated grants and the reported internal/operator-only inventory", () => {
    expect(validatePermissions()).toEqual([]);
  });

  it.each(["primary/ingenium-orchestrator.md", "execution/ingenium-software-engineer-fast.md", "execution/ingenium-recovery-engineer.md", "chat/ingenium-chat.md"])(
    "rejects the retired recovery plugin tool on %s", (profile) => {
      expect(validatePermissions(`.opencode/agents/${profile}`, (text) => text.replace(
        "\n---\n", '\n  - action: ingenium_recovery_publish_parent_work\n    resource: "*"\n    effect: allow\n---\n',
      ))).toContain(`${basename(profile, ".md")} native plugin tool ingenium_recovery_publish_parent_work is retired`);
    },
  );

  it("grants orchestrator recovery and publication tools without enabling deployment or secret writes", () => {
    const profile = readFileSync(resolve(root, ".opencode/agents/primary/ingenium-orchestrator.md"), "utf8");
    const rules = [...profile.matchAll(/  - action: (.+)\n    resource: "\*"\n    effect: (allow|deny)/g)];
    const effect = (action: string) => rules.filter((rule) => rule[1] === '"*"' || rule[1] === action).at(-1)?.[2];
    const memoryServer = Object.keys(config.mcp.servers).find((name) => name === "basic-memory") ?? "basic-memory";
    const memoryAction = (tool: string) => `${memoryServer}_${tool}`;
    for (const action of [...parentStatusActions, "admission_status", "agent_memory_capacity", "session_context", "todo_history",
      "subagent_admission_repair", "opencode_runtime_status", "opencode_recovery_status", "openrig_runtime_handshake",
      "basic_memory_recovery", memoryAction("read_note"), memoryAction("recent_activity"), "git_diff", "binary_inspect",
      "repo_learning_pending_observations", "repo_learning_reflect", "repo_learning_reflect_batch",
      "repo_learning_resolve_conflict", "correction_ledger_ack", "repo_qa_gate", "repo_documentation_gate",
      "repo_commit", "repo_push"]) expect(effect(action), action).toBe("allow");
    for (const action of ["docker_build", "docker_compose", "binary_replace", memoryAction("write_note")])
      expect(effect(action), action).toBe("deny");
    const premium = readFileSync(resolve(root, ".opencode/agents/execution/ingenium-software-engineer-premium.md"), "utf8");
    for (const action of [memoryAction("read_note"), memoryAction("recent_activity")]) {
      expect(premium).toContain(`  - action: ${action}\n    resource: "*"\n    effect: allow`);
    }
    expect(validatePermissions()).toEqual([]);
  });

  it.each(parentStatusActions)("requires an effective primary allow for %s", (action) => {
    expect(validatePermissions()).toEqual([]);
    const profile = ".opencode/agents/primary/ingenium-orchestrator.md";
    const grant = `  - action: ${action}\n    resource: "*"\n    effect: allow\n`;
    const error = `ingenium-orchestrator parent-only harness control ${action} must be allow`;
    for (const replacement of ["", grant.replace("effect: allow", "effect: deny")]) {
      expect(validatePermissions(profile, (text) => text.replace(grant, replacement))).toContain(error);
    }
    expect(validatePermissions(profile, (text) => text.replace(
      grant, `${grant}  - action: "*"\n    resource: "*"\n    effect: deny\n`,
    ))).toContain(error);
  });

  it.each(parentStatusActions)("rejects parent-only %s grants on children", (action) => {
    for (const profile of [
      "execution/ingenium-docs.md", "execution/ingenium-qa.md", "execution/ingenium-recovery-engineer.md",
      "execution/ingenium-software-engineer-fast.md", "execution/ingenium-software-engineer-premium.md",
      "security/ingenium-security-auditor.md",
    ]) {
      expect(validatePermissions(`.opencode/agents/${profile}`, (text) => text.replace(
        "\n---\n", `\n  - action: ${action}\n    resource: "*"\n    effect: allow\n---\n`,
      ))).toContain(`${basename(profile, ".md")} parent-only harness control ${action} must be deny`);
    }
  });

  it("rejects hiding a mandatory nested harness control behind the native wildcard deny", () => {
    expect(validatePermissions(".opencode/agents/execution/ingenium-software-engineer-premium.md", (text) =>
      text.replace("  - action: rule_reconciliation\n    resource: \"*\"\n    effect: allow\n", "")))
      .toEqual(expect.arrayContaining([expect.stringContaining("must allow native harness control rule_reconciliation")]));
  });

  it("rejects parent lifecycle grants or unrelated external access on a child", () => {
    expect(validatePermissions(".opencode/agents/execution/ingenium-software-engineer-premium.md", (text) =>
      text.replace("  - action: execute", "  - action: task_declare\n    resource: \"*\"\n    effect: allow\n  - action: external_directory\n    resource: \"*\"\n    effect: allow\n  - action: execute")))
      .toEqual(expect.arrayContaining([
        expect.stringContaining("parent-only harness control task_declare must be deny"),
        expect.stringContaining("must not allow unrelated external directories"),
      ]));
  });

  it("rejects legacy name frontmatter that moves native grants into request metadata", () => {
    expect(validatePermissions(".opencode/agents/execution/ingenium-software-engineer-fast.md", (text) =>
      text.replace("---\n", "---\nname: ingenium-software-engineer-fast\n")))
      .toEqual(expect.arrayContaining([expect.stringContaining("must use native path identity, not legacy name frontmatter")]));
  });

  it.each(["ingenium-build deployment recovery-prepare *", "ingenium-build *", "node *", "bash *", "systemctl *", "docker *", "cat /proc/*"])(
    "rejects widening the Recovery literal grant to %s", (command) => {
      expect(validatePermissions(".opencode/agents/execution/ingenium-recovery-engineer.md", (text) =>
        text.replace("    resource: ingenium-build deployment recovery-prepare", `    resource: ${command}`))).not.toEqual([]);
    },
  );

  it.each([
    ["primary/ingenium-orchestrator.md", "ingenium_docs_search"],
    ["primary/ingenium-orchestrator.md", "ingenium_memory_list"],
    ["execution/ingenium-software-engineer-premium.md", "ingenium_memory_read"],
    ["chat/ingenium-chat.md", "ingenium_memory_save"],
    ["execution/ingenium-qa.md", "ingenium_docs_search"],
    ["research/ingenium-scout.md", "ingenium_docs_search_semantic"],
    ["security/ingenium-security-auditor.md", "ingenium_docs_list_comments"],
  ])("rejects missing %s designation for %s", (profile, tool) => {
    expect(validatePermissions(`.opencode/agents/${profile}`, (text) => text.replace(
      `  - action: ${tool}\n    resource: "*"\n    effect: allow\n`,
      "",
    ))).not.toEqual([]);
  });

  it.each([
    ["execution/ingenium-llm-broker.md", "ingenium_memory_read"],
    ["security/ingenium-security-auditor.md", "ingenium_docs_create_comment"],
    ["chat/ingenium-chat.md", "ingenium_email_send"],
    ["execution/ingenium-docs.md", "ingenium_nonexistent_tool"],
    ["execution/ingenium-software-engineer-fast.md", "ingenium_*"],
  ])("rejects unexpected %s grant for %s", (profile, tool) => {
    expect(validatePermissions(`.opencode/agents/${profile}`, (text) => text.replace(
      '  - action: "*"\n    resource: "*"\n    effect: deny\n',
      `  - action: "*"\n    resource: "*"\n    effect: deny\n  - action: ${tool}\n    resource: "*"\n    effect: allow\n`,
    ))).not.toEqual([]);
  });
});

describe("AGENT-100 validator model matrix", () => {
  it("accepts model-only mappings and canonical Fast profile identity", () => {
    expect(validate(config.agents)).toEqual([]);
    const profile = readFileSync(resolve(root, ".opencode/agents/execution/ingenium-software-engineer-fast.md"), "utf8");
    expect(profile).not.toMatch(/^name:/m);
    expect(config.agents["execution/ingenium-software-engineer-fast"]).toBeDefined();
  });

  it("accepts only Plan's exact read-only permissions and Explore-only task grant", () => {
    const planError = "Plan profile must retain its exact read-only permissions and Explore-only task grant";
    expect(validatePermissions()).not.toContain(planError);
    for (const [before, after] of [
      ["    resource: research/ingenium-explore\n    effect: allow", "    resource: research/ingenium-explore\n    effect: allow\n  - action: subagent\n    resource: execution/ingenium-docs\n    effect: allow"],
      ["    resource: research/ingenium-explore\n    effect: allow", "    resource: research/ingenium-explore\n    effect: deny"],
      ['  - action: subagent\n    resource: "*"\n    effect: deny', '  - action: subagent\n    resource: "*"\n    effect: allow'],
      ['  - action: skill\n    resource: "*"\n    effect: allow', '  - action: skill\n    resource: "*"\n    effect: deny'],
      ['  - action: edit\n    resource: "*"\n    effect: deny', '  - action: edit\n    resource: "*"\n    effect: allow'],
      ['  - action: read\n    resource: "*"\n    effect: allow', '  - action: read\n    resource: "*"\n    effect: allow\n  - action: webfetch\n    resource: "*"\n    effect: allow'],
    ] as const) {
      expect(validatePermissions(".opencode/agents/plan.md", (text) => text.replace(before, after))).toContain(planError);
    }
  });

  it("rejects profile authority in the Plan root mapping", () => {
    expect(validate({ ...config.agents, plan: { ...config.agents.plan, permissions: [] } }))
      .toContain("Plan root mapping must contain only its exact native model reference");
  });

  it("requires the native built-in Plan ID rather than a nested custom agent", () => {
    expect(config.agents.plan).toEqual({ model: "openai/gpt-6-astra#max" });
    expect(config.agents).not.toHaveProperty("primary/plan");
    const { plan, ...otherAgents } = config.agents;
    expect(validate({ ...otherAgents, "primary/plan": plan })).toEqual(expect.arrayContaining([
      "unexpected root agent mapping: primary/plan",
      "Plan root mapping must contain only its exact native model reference",
    ]));
  });

  it.each(["read", "glob", "grep", "list", "webfetch"])("rejects Scout generic %s grants", (tool) => {
    expect(validatePermissions(".opencode/agents/research/ingenium-scout.md", (text) =>
      text.replace(
        '  - action: "*"\n    resource: "*"\n    effect: deny',
        `  - action: "*"\n    resource: "*"\n    effect: deny\n  - action: ${tool}\n    resource: "*"\n    effect: allow`,
      ))).not.toEqual([]);
  });

  it("still rejects stale models and root permission authority", () => {
    const agent = structuredClone(config.agents);
    agent["primary/ingenium-orchestrator"] = { model: "stale/unsupported-model#xhigh", permissions: [] };
    expect(validate(agent)).toEqual(expect.arrayContaining([
      expect.stringContaining(`ingenium-orchestrator model must be ${config.agents["primary/ingenium-orchestrator"].model}`),
      expect.stringContaining("mapping must contain only model"),
    ]));
  });
});
