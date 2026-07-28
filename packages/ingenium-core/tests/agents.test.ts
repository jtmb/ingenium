import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import { getDb } from "../lib/db.js";
import { saveConfig } from "../lib/tools/configs.js";
import { bootstrapReservedBroker, createAgent, deleteAgent, disableAgent, enableAgent, getAgent, isAgentCategory, isSafeAgentName, LLM_BROKER_CONTENT, LLM_BROKER_DESCRIPTION, LLM_BROKER_METADATA, LLM_BROKER_PERMISSIONS, LLM_BROKER_SKILLS, syncAgentFromDisk, updateAgent } from "../lib/tools/agents.js";
import { deleteProject } from "../lib/tools/projects.js";

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
  it("writes public profiles as 0644 and repairs a legacy restrictive mode", () => {
    const agent = createAgent(projectId, "public-profile", "# Original");
    const agentPath = join(root, ".opencode", "agents", "execution", "public-profile.md");

    expect(statSync(agentPath).mode & 0o777).toBe(0o644);
    chmodSync(agentPath, 0o600);
    updateAgent(projectId, agent.name, { content: "# Updated" });

    expect(statSync(agentPath).mode & 0o777).toBe(0o644);
    expect(readFileSync(agentPath, "utf-8")).toContain("# Updated");
  });

  it("refuses a symlinked profile target without modifying its target", () => {
    const agent = createAgent(projectId, "symlinked-profile", "# Original");
    const agentPath = join(root, ".opencode", "agents", "execution", "symlinked-profile.md");
    const outsidePath = join(root, "outside-agent.md");
    writeFileSync(outsidePath, "# Outside", "utf-8");
    unlinkSync(agentPath);
    symlinkSync(outsidePath, agentPath);

    expect(() => updateAgent(projectId, agent.name, { content: "# Replacement" }))
      .toThrow("Unsafe agent profile path");
    expect(lstatSync(agentPath).isSymbolicLink()).toBe(true);
    expect(readFileSync(outsidePath, "utf-8")).toBe("# Outside");
  });

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

  it("rejects the broker disable lifecycle and restores its trusted disk profile", () => {
    const broker = bootstrapReservedBroker(projectId);
    const disabled = disableAgent(projectId, broker.name);
    const brokerPath = join(root, ".opencode", "agents", "execution", "ingenium-llm-broker.md");

    expect(disabled).toBeUndefined();
    expect(getAgent(projectId, broker.name)?.enabled).toBe(1);
    mkdirSync(join(root, ".opencode", "agents", "execution"), { recursive: true });
    writeFileSync(brokerPath, "---\nname: ingenium-llm-broker\nhidden: false\npermission:\n  \"*\": allow\n---\n\n# Stale broker");

    const synced = syncAgentFromDisk(projectId, broker.name);

    expect(synced?.id).toBe(broker.id);
    expect(synced?.enabled).toBe(1);
    expect(getAgent(projectId, broker.name)?.enabled).toBe(1);
    expect(readFileSync(brokerPath, "utf-8")).toContain(LLM_BROKER_CONTENT);
  });

  it("rejects public core broker creation and provisions only the canonical internal template", () => {
    expect(() => createAgent(projectId, "ingenium-llm-broker", "# Arbitrary broker")).toThrow(/internal bootstrap/);

    const broker = bootstrapReservedBroker(projectId);
    expect(broker.description).toBe(LLM_BROKER_DESCRIPTION);
    expect(broker.content).toBe(LLM_BROKER_CONTENT);
    expect(broker.permissions).toBe(LLM_BROKER_PERMISSIONS);
    expect(broker.metadata).toBe(LLM_BROKER_METADATA);
    expect(broker.skills).toBe(LLM_BROKER_SKILLS);
    expect(bootstrapReservedBroker(projectId).id).toBe(broker.id);
  });

  it.each([
    ["malformed", "{not-json", "[not-json"],
    ["permissive", JSON.stringify({ "*": "allow", read: "allow" }), JSON.stringify({ hidden: false })],
  ])("rejects %s external broker create fields", (_case, permissions, metadata) => {
    expect(() => createAgent(
      projectId,
      "ingenium-llm-broker",
      "# Broker",
      "",
      "execution",
      "subagent",
      undefined,
      true,
      permissions,
      metadata,
    )).toThrow(/internal bootstrap/);
  });

  it("rejects every core mutation of the broker", () => {
    const broker = bootstrapReservedBroker(projectId);

    expect(enableAgent(projectId, broker.name)).toBeUndefined();
    expect(disableAgent(projectId, broker.name)).toBeUndefined();
    expect(deleteAgent(projectId, broker.name)).toBe(false);
    expect(updateAgent(projectId, broker.name, {
      content: "# Replacement",
      permissions: JSON.stringify({ "*": "allow" }),
      metadata: JSON.stringify({ hidden: false }),
    })).toBeUndefined();
    expect(getAgent(projectId, broker.name)).toMatchObject({
      id: broker.id,
      content: LLM_BROKER_CONTENT,
      enabled: 1,
      permissions: LLM_BROKER_PERMISSIONS,
      metadata: LLM_BROKER_METADATA,
    });
  });

  it.each([
    ["omitted", "", ""],
    ["malformed", "permission: [not-a-mapping", "hidden: perhaps"],
    ["permissive", "permission:\n  \"*\": allow\n  read: allow", "hidden: false"],
  ])("normalizes %s broker disk frontmatter during sync", (_case, permission, hidden) => {
    bootstrapReservedBroker(projectId);
    const brokerPath = join(root, ".opencode", "agents", "execution", "ingenium-llm-broker.md");
    mkdirSync(join(root, ".opencode", "agents", "execution"), { recursive: true });
    writeFileSync(brokerPath, [
      "---",
      "name: ingenium-llm-broker",
      "description: \"Internal broker\"",
      "mode: subagent",
      hidden,
      permission,
      "---",
      "",
      LLM_BROKER_CONTENT,
      "",
    ].join("\n"));

    const synced = syncAgentFromDisk(projectId, "ingenium-llm-broker");
    expect(synced?.permissions).toBe(LLM_BROKER_PERMISSIONS);
    expect(synced?.metadata).toBe(LLM_BROKER_METADATA);
    const normalizedDisk = readFileSync(brokerPath, "utf-8");
    expect(normalizedDisk).toContain("hidden: true");
    expect(normalizedDisk).toContain('"*": deny');
    expect(normalizedDisk).not.toMatch(/^\s+(?:read|write|bash):\s+allow$/m);
  });

  it.each([
    ["missing delimiter", "# Untrusted disk broker"],
    ["mismatched name", "---\nname: another-agent\nhidden: false\npermission:\n  \"*\": allow\n---\n\n# Untrusted disk broker"],
    ["permissive fields", "---\nname: ingenium-llm-broker\nhidden: false\npermission:\n  \"*\": allow\n  read: allow\n---\n\n# Untrusted disk broker"],
  ])("fails closed for broker disk sync with %s", (_case, untrustedContent) => {
    const broker = bootstrapReservedBroker(projectId);
    const brokerPath = join(root, ".opencode", "agents", "execution", "ingenium-llm-broker.md");
    writeFileSync(brokerPath, untrustedContent);

    const synced = syncAgentFromDisk(projectId, broker.name);

    expect(synced?.id).toBe(broker.id);
    expect(synced?.content).toBe(LLM_BROKER_CONTENT);
    expect(synced?.permissions).toBe(LLM_BROKER_PERMISSIONS);
    expect(synced?.metadata).toBe(LLM_BROKER_METADATA);
    expect(readFileSync(brokerPath, "utf-8")).toContain(LLM_BROKER_CONTENT);
    expect(readFileSync(brokerPath, "utf-8")).toMatch(/^permission:\n  "\*": deny$/m);
  });

  it("quarantines an orphan broker profile instead of importing it from disk", () => {
    const brokerPath = join(root, ".opencode", "agents", "execution", "ingenium-llm-broker.md");
    mkdirSync(join(root, ".opencode", "agents", "execution"), { recursive: true });
    writeFileSync(brokerPath, "---\nname: ingenium-llm-broker\nhidden: false\npermission:\n  \"*\": allow\n---\n\n# Untrusted");

    expect(syncAgentFromDisk(projectId, "ingenium-llm-broker")).toBeUndefined();
    expect(existsSync(brokerPath)).toBe(false);
    expect(getAgent(projectId, "ingenium-llm-broker")).toBeUndefined();
  });

  it("blocks raw second-connection mutations and REPLACE bypasses with recursive_triggers disabled", () => {
    const broker = bootstrapReservedBroker(projectId);
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH!);
    const raw = new Database(process.env.INGENIUM_CORE_DB_PATH!);
    const brokerPath = join(root, ".opencode", "agents", "execution", "ingenium-llm-broker.md");

    const assertOriginalBroker = () => {
      expect(db.prepare(
        "SELECT id, name, content, enabled, permissions, metadata FROM agents WHERE project_id = ? AND name = ?",
      ).get(projectId, broker.name)).toEqual({
        id: broker.id,
        name: broker.name,
        content: LLM_BROKER_CONTENT,
        enabled: 1,
        permissions: LLM_BROKER_PERMISSIONS,
        metadata: LLM_BROKER_METADATA,
      });
    };

    raw.pragma("recursive_triggers = OFF");
    expect(raw.pragma("recursive_triggers", { simple: true })).toBe(0);
    expect(() => raw.prepare("UPDATE agents SET enabled = 0 WHERE id = ?").run(broker.id))
      .toThrow(/reserved LLM broker is immutable/);
    expect(() => raw.prepare("UPDATE agents SET enabled = 1 WHERE id = ?").run(broker.id))
      .toThrow(/reserved LLM broker is immutable/);
    expect(() => raw.prepare("UPDATE agents SET content = ? WHERE id = ?").run("# Injected", broker.id))
      .toThrow(/reserved LLM broker is immutable/);
    expect(() => raw.prepare("UPDATE agents SET id = ? WHERE id = ?").run("replacement-id", broker.id))
      .toThrow(/reserved LLM broker is immutable/);
    expect(() => raw.prepare("UPDATE agents SET name = ? WHERE id = ?").run("renamed-broker", broker.id))
      .toThrow(/reserved LLM broker is immutable/);
    expect(() => raw.prepare("DELETE FROM agents WHERE id = ?").run(broker.id))
      .toThrow(/reserved LLM broker cannot be deleted directly/);

    expect(() => raw.prepare(
      `INSERT OR REPLACE INTO agents
       (id, project_id, name, description, category, mode, model, reasoning_effort, permissions, metadata, skills, content, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
    ).run(
      "replace-broker",
      projectId,
      broker.name,
      LLM_BROKER_DESCRIPTION,
      "execution",
      "subagent",
      LLM_BROKER_PERMISSIONS,
      LLM_BROKER_METADATA,
      LLM_BROKER_SKILLS,
      LLM_BROKER_CONTENT,
    )).toThrow(/reserved LLM broker cannot be replaced/);
    expect(() => raw.prepare(
      `INSERT OR REPLACE INTO agents
       (id, project_id, name, description, category, mode, permissions, metadata, content, enabled, created_at, updated_at)
       VALUES (?, ?, 'ordinary-replacement', '', 'execution', 'subagent', '{}', '{}', '# Ordinary', 1, datetime('now'), datetime('now'))`,
    ).run(broker.id, projectId)).toThrow(/reserved LLM broker cannot be replaced/);
    expect(() => raw.prepare(
      "UPDATE OR REPLACE agents SET content = ?, enabled = 0 WHERE id = ?",
    ).run("# Replaced broker", broker.id)).toThrow(/reserved LLM broker is immutable/);

    const ordinary = createAgent(projectId, "ordinary-agent", "# Ordinary");
    expect(() => raw.prepare("UPDATE OR REPLACE agents SET id = ? WHERE id = ?").run(broker.id, ordinary.id))
      .toThrow(/reserved LLM broker identity cannot be claimed/);
    expect(() => raw.prepare("UPDATE OR REPLACE agents SET name = ? WHERE id = ?").run(broker.name, ordinary.id))
      .toThrow(/reserved LLM broker identity cannot be claimed/);

    assertOriginalBroker();
    writeFileSync(brokerPath, "---\nname: ingenium-llm-broker\nhidden: false\npermission:\n  \"*\": allow\n---\n\n# Reappeared broker");
    const synced = syncAgentFromDisk(projectId, broker.name);

    expect(synced).toMatchObject({
      id: broker.id,
      content: LLM_BROKER_CONTENT,
      enabled: 1,
      permissions: LLM_BROKER_PERMISSIONS,
      metadata: LLM_BROKER_METADATA,
    });
    assertOriginalBroker();
    const restored = readFileSync(brokerPath, "utf-8");
    expect(restored).toContain(LLM_BROKER_CONTENT);
    expect(restored).toContain("hidden: true");
    expect(restored).toContain('"*": deny');
    expect(restored).not.toContain("# Reappeared broker");
    raw.close();
  });

  it("backfills the full canonical template when migration 058 upgrades a legacy broker", () => {
    const legacyPath = join(root, "legacy-broker.db");
    const legacy = new Database(legacyPath);
    const migrations = resolve(__dirname, "../data/migrations");
    legacy.exec(readFileSync(join(migrations, "001_init.sql"), "utf-8"));
    legacy.exec(readFileSync(join(migrations, "003_agents.sql"), "utf-8"));
    legacy.prepare("INSERT INTO projects (id, name, path, created_at, updated_at) VALUES ('legacy-project', 'legacy-project', '', datetime('now'), datetime('now'))").run();
    legacy.prepare("INSERT INTO agents (id, project_id, name, description, category, mode, permissions, content, enabled, created_at, updated_at) VALUES ('legacy-broker', 'legacy-project', 'ingenium-llm-broker', '', 'execution', 'subagent', '{\"read\":\"allow\"}', '# Broker', 0, datetime('now'), datetime('now'))").run();
    legacy.exec(readFileSync(join(migrations, "054_agent_frontmatter_metadata.sql"), "utf-8"));
    legacy.exec(readFileSync(join(migrations, "057_reserved_broker_immutable.sql"), "utf-8"));
    legacy.exec(readFileSync(join(migrations, "058_reserved_broker_connection_independent.sql"), "utf-8"));
    expect(legacy.prepare("SELECT description, category, mode, model, reasoning_effort, skills, content, enabled, permissions, metadata FROM agents WHERE id = 'legacy-broker'").get()).toEqual({
      description: LLM_BROKER_DESCRIPTION,
      category: "execution",
      mode: "subagent",
      model: null,
      reasoning_effort: null,
      skills: LLM_BROKER_SKILLS,
      content: LLM_BROKER_CONTENT,
      enabled: 1,
      permissions: LLM_BROKER_PERMISSIONS,
      metadata: LLM_BROKER_METADATA,
    });
    legacy.pragma("recursive_triggers = OFF");
    expect(legacy.pragma("recursive_triggers", { simple: true })).toBe(0);
    expect(() => legacy.prepare("UPDATE agents SET enabled = 0 WHERE id = 'legacy-broker'").run())
      .toThrow(/reserved LLM broker is immutable/);
    legacy.close();

    createProject("child-free-project");
    expect(deleteProject("child-free-project")).toEqual({ status: "deleted" });
    const broker = bootstrapReservedBroker(projectId);
    const protectedProjectDelete = deleteProject("agent-config-project");
    expect(protectedProjectDelete.status).toBe("has_children");
    if (protectedProjectDelete.status === "has_children") {
      expect(protectedProjectDelete.childTables).toContain("agents");
    }
    expect(getAgent(projectId, broker.name)?.enabled).toBe(1);
  });
});
