import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import { getDb } from "../lib/db.js";
import { saveConfig } from "../lib/tools/configs.js";
import { createAgent, deleteAgent, disableAgent, enableAgent, isAgentCategory, isSafeAgentName, syncAgentFromDisk, updateAgent } from "../lib/tools/agents.js";

let root = "";
let projectId = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ingenium-agents-"));
  mkdirSync(join(root, ".ingenium"));
  process.env.INGENIUM_CORE_DB_PATH = join(root, ".ingenium", "data.db");
  resetDbForTest();
  projectId = createProject("agent-config-project").id;
});

afterEach(() => {
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  rmSync(root, { recursive: true, force: true });
});

describe("centralized agent runtime configuration", () => {
  it("keeps model and disable state in opencode.json, never agent markdown", () => {
    const agent = createAgent(projectId, "runtime-agent", "# Runtime agent", "test", "execution", "subagent", "deepseek/test-model");
    const configPath = join(root, "opencode.json");
    const agentPath = join(root, ".opencode", "agents", "execution", "runtime-agent.md");

    expect(JSON.parse(readFileSync(configPath, "utf-8")).agent[agent.name]).toEqual({ model: "deepseek/test-model" });
    expect(readFileSync(agentPath, "utf-8")).not.toMatch(/^model:/m);

    disableAgent(projectId, agent.name);
    expect(JSON.parse(readFileSync(configPath, "utf-8")).agent[agent.name]).toEqual({ model: "deepseek/test-model", disable: true });

    updateAgent(projectId, agent.name, { model: "deepseek/updated-model" });
    enableAgent(projectId, agent.name);
    expect(JSON.parse(readFileSync(configPath, "utf-8")).agent[agent.name]).toEqual({ model: "deepseek/updated-model" });
    expect(readFileSync(agentPath, "utf-8")).not.toMatch(/^model:/m);

    expect(deleteAgent(projectId, agent.name)).toBe(true);
    expect(JSON.parse(readFileSync(configPath, "utf-8")).agent).toBeUndefined();
  });

  it("uses centralized config instead of a legacy markdown model during disk sync", () => {
    const agentsDir = join(root, ".opencode", "agents", "execution");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(root, "opencode.json"), JSON.stringify({ agent: { "disk-agent": { model: "deepseek/runtime" } } }));
    writeFileSync(join(agentsDir, "disk-agent.md"), "---\nname: disk-agent\ndescription: \"disk\"\nmode: subagent\nmodel: legacy/markdown\npermission:\n  read: allow\n---\n\n# Disk agent\n");

    const agent = syncAgentFromDisk(projectId, "disk-agent");
    expect(agent?.model).toBe("deepseek/runtime");
  });

  it("preserves a centralized model when enabling an agent whose DB model is null", () => {
    const agent = createAgent(projectId, "config-agent", "# Agent", "test");
    saveConfig(projectId, "project", JSON.stringify({ untouched: { keep: true }, agent: { "config-agent": { model: "central/model" }, sibling: { model: "sibling/model" } } }));

    enableAgent(projectId, agent.name);

    expect(JSON.parse(readFileSync(join(root, "opencode.json"), "utf-8"))).toEqual({
      untouched: { keep: true },
      agent: { "config-agent": { model: "central/model" }, sibling: { model: "sibling/model" } },
    });
  });
});

describe("agent path and category integrity", () => {
  it("rejects traversal names and invalid categories before disk operations", () => {
    expect(isSafeAgentName("../escape")).toBe(false);
    expect(isSafeAgentName("agent/name")).toBe(false);
    expect(isSafeAgentName("agent\\name")).toBe(false);
    expect(isSafeAgentName("agent\u0000name")).toBe(false);
    expect(isSafeAgentName("a".repeat(65))).toBe(false);
    expect(() => createAgent(projectId, "../escape", "# Agent")).toThrow("Invalid agent name");
    expect(() => createAgent(projectId, "safe-agent", "# Agent", "", "../escape")).toThrow("Invalid agent category");
  });

  it("accepts chat and enforces the database category constraint", () => {
    expect(isAgentCategory("chat")).toBe(true);
    const chat = createAgent(projectId, "chat-agent", "# Chat", "", "chat");
    expect(chat.category).toBe("chat");

    const db = getDb(process.env.INGENIUM_CORE_DB_PATH!);
    expect(() => db.prepare(
      "INSERT INTO agents (id, project_id, name, description, category, mode, content, created_at, updated_at) VALUES ('invalid-category', ?, 'invalid-agent', '', 'unsafe', 'subagent', '# Invalid', datetime('now'), datetime('now'))",
    ).run(projectId)).toThrow();
  });

  it("normalizes legacy categories before adding the category constraint", () => {
    const legacyPath = join(root, "legacy.db");
    const legacy = new Database(legacyPath);
    const migrations = resolve(__dirname, "../data/migrations");
    legacy.exec(readFileSync(join(migrations, "001_init.sql"), "utf-8"));
    legacy.exec(readFileSync(join(migrations, "003_agents.sql"), "utf-8"));
    legacy.prepare("INSERT INTO projects (id, name, path, created_at, updated_at) VALUES ('legacy-project', 'legacy-project', '', datetime('now'), datetime('now'))").run();
    legacy.prepare("INSERT INTO agents (id, project_id, name, description, category, mode, content, created_at, updated_at) VALUES ('legacy-agent', 'legacy-project', 'legacy-agent', '', 'legacy', 'subagent', '# Legacy', datetime('now'), datetime('now'))").run();

    legacy.exec(readFileSync(join(migrations, "052_agent_category_integrity.sql"), "utf-8"));
    expect(legacy.prepare("SELECT category FROM agents WHERE id = 'legacy-agent'").get()).toEqual({ category: "execution" });
    expect(() => legacy.prepare("UPDATE agents SET category = 'legacy' WHERE id = 'legacy-agent'").run()).toThrow();
    legacy.close();
  });

  it("does not reactivate a disabled agent from a stale disk file", () => {
    const agent = createAgent(projectId, "disabled-agent", "# Original");
    disableAgent(projectId, agent.name);
    const diskPath = join(root, ".opencode", "agents", "execution", "disabled-agent.md");
    mkdirSync(join(root, ".opencode", "agents", "execution"), { recursive: true });
    writeFileSync(diskPath, "---\nname: disabled-agent\nmode: subagent\n---\n\n# Stale\n");

    const synced = syncAgentFromDisk(projectId, agent.name);
    expect(Boolean(synced?.enabled)).toBe(false);
    expect(synced?.content).toBe("# Original");
  });
});
