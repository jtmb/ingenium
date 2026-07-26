import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { Agent } from "../schema.js";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../logger.js";
import { getConfigPath } from "./paths.js";

export const AGENT_CATEGORIES = ["primary", "execution", "research", "security", "chat"] as const;
export type AgentCategory = typeof AGENT_CATEGORIES[number];

export function isSafeAgentName(name: unknown): name is string {
  return typeof name === "string"
    && name.length > 0
    && name.length <= 64
    && name.trim() === name
    && name !== "."
    && name !== ".."
    && !/[\\/\u0000-\u001f\u007f]/.test(name);
}

export function isAgentCategory(category: unknown): category is AgentCategory {
  return typeof category === "string" && (AGENT_CATEGORIES as readonly string[]).includes(category);
}

function assertSafeAgentName(name: unknown): asserts name is string {
  if (!isSafeAgentName(name)) throw new Error("Invalid agent name");
}

function assertAgentCategory(category: unknown): asserts category is AgentCategory {
  if (!isAgentCategory(category)) throw new Error("Invalid agent category");
}

function getAgentsDir(): string {
  return resolve(process.env.INGENIUM_CORE_DB_PATH ?? "./data", "..", "..", ".opencode", "agents");
}

type OpenCodeAgentConfig = Record<string, { model?: string; disable?: boolean }>;

function parseConfig(content: string): Record<string, unknown> {
  return JSON.parse(content.replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;
}

function readProjectConfig(projectId: string): Record<string, unknown> {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const stored = (db.prepare("SELECT content FROM configs WHERE project_id = ? AND type = 'project'").get(projectId) as { content?: string } | undefined)?.content;
  if (stored) {
    try { return parseConfig(stored); } catch { /* use disk fallback */ }
  }
  try {
    const path = getConfigPath(projectId);
    return existsSync(path) ? parseConfig(readFileSync(path, "utf-8")) : {};
  } catch {
    return {};
  }
}

function configuredAgentModel(projectId: string, name: string): string | null {
  const entry = readProjectConfig(projectId).agent as OpenCodeAgentConfig | undefined;
  return typeof entry?.[name]?.model === "string" ? entry[name].model : null;
}

function updateAgentRuntimeConfig(
  projectId: string,
  name: string,
  options: { model?: string | null; disabled?: boolean; remove?: boolean },
): void {
  const content = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const stored = (db.prepare("SELECT * FROM configs WHERE project_id = ? AND type = 'project'").get(projectId) as { id: string; content: string } | undefined);
    let config: Record<string, unknown>;
    try {
      config = stored ? parseConfig(stored.content) : readProjectConfig(projectId);
    } catch {
      config = {};
    }
    const agents = (config.agent && typeof config.agent === "object" && !Array.isArray(config.agent))
      ? config.agent as OpenCodeAgentConfig
      : {};
    const entry = { ...(agents[name] ?? {}) };

    if (options.remove) {
      delete agents[name];
    } else {
      if (options.model !== undefined) {
        if (options.model) entry.model = options.model;
        else delete entry.model;
      }
      if (options.disabled !== undefined) {
        if (options.disabled) entry.disable = true;
        else delete entry.disable;
      }
      if (Object.keys(entry).length > 0) agents[name] = entry;
      else delete agents[name];
    }

    if (Object.keys(agents).length > 0) config.agent = agents;
    else delete config.agent;
    const serialized = JSON.stringify(config, null, 2);
    const now = new Date().toISOString();
    if (stored) {
      db.prepare("UPDATE configs SET content = ?, updated_at = ? WHERE id = ?").run(serialized, now, stored.id);
    } else {
      db.prepare("INSERT INTO configs (id, project_id, type, content, created_at, updated_at) VALUES (?, ?, 'project', ?, ?, ?)")
        .run(`config_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, projectId, serialized, now, now);
    }
    return serialized;
  });
  try {
    const path = getConfigPath(projectId);
    if (!existsSync(resolve(path, ".."))) mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf-8");
  } catch (error) {
    logger.warn("agents", "Failed to write agent runtime config to disk", { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Write an agent definition to `.opencode/agents/<category>/<name>.md` as a YAML-frontmatter markdown file.
 *
 * If the file already exists, it does an in-place field update (replacing only name, description,
 * mode in the YAML frontmatter) — this preserves any handwritten fields (like
 * permissions, skills, or custom YAML keys) that OpenCode's agent system uses.
 *
 * If the file doesn't exist, it creates a full frontmatter block from the DB record, including
 * permissions (read/write/bash/task/mcp/skill), skills list, and content body.
 */
function writeAgentToDisk(agent: Agent): void {
  assertSafeAgentName(agent.name);
  assertAgentCategory(agent.category);
  if (!agent.enabled) return;
  const categoryDir = resolve(getAgentsDir(), agent.category);
  if (!existsSync(categoryDir)) mkdirSync(categoryDir, { recursive: true });

  const filePath = resolve(categoryDir, `${agent.name}.md`);
  const escapedDesc = agent.description.replace(/"/g, '\\"');

  if (existsSync(filePath)) {
    const existingContent = readFileSync(filePath, "utf-8");
    const fmMatch = existingContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (fmMatch) {
      const frontmatter = fmMatch[1]!;

       let updated = frontmatter.replace(/^name:\s*.+$/m, `name: ${agent.name}`);
       // Models are runtime configuration only. Remove stale active model lines while
       // retaining comments that document historical model choices.
       updated = updated.replace(/^model:\s*.*(?:\r?\n|$)/gm, "");

      if (frontmatter.match(/^description:\s*".*"$/m)) {
        updated = updated.replace(/^description:\s*".*"$/m, `description: "${escapedDesc}"`);
      } else if (frontmatter.match(/^description:\s*.+$/m)) {
        updated = updated.replace(/^description:\s*.+$/m, `description: "${escapedDesc}"`);
      }

      if (updated.match(/^mode:\s*.+$/m)) {
        updated = updated.replace(/^mode:\s*.+$/m, `mode: ${agent.mode}`);
      } else {
        updated += `\nmode: ${agent.mode}`;
      }

       writeFileSync(filePath, `---\n${updated}\n---\n\n${agent.content}`);
      return;
    }
  }

  // File doesn't exist — create full frontmatter from scratch
  const permissions = (() => { try { return JSON.parse(agent.permissions); } catch { return {}; } })();
  const skills = (() => { try { return JSON.parse(agent.skills); } catch { return []; } })();

  const frontmatter = [
    "---",
    `name: ${agent.name}`,
    `description: "${escapedDesc}"`,
    `mode: ${agent.mode}`,
  ];
   if (agent.reasoning_effort) frontmatter.push(`reasoning_effort: "${agent.reasoning_effort}"`);
  frontmatter.push(`permission:`);
  frontmatter.push(`  read: ${permissions.read || "allow"}`);
  frontmatter.push(`  write: ${permissions.write || "allow"}`);
  frontmatter.push(`  bash: ${permissions.bash || "allow"}`);
  if (permissions.task) {
    frontmatter.push(`  task:`);
    for (const [k, v] of Object.entries(permissions.task)) {
      frontmatter.push(`    "${k}": "${v}"`);
    }
  }
  if (permissions.mcp) {
    frontmatter.push(`  mcp:`);
    for (const [k, v] of Object.entries(permissions.mcp)) {
      frontmatter.push(`    "${k}": "${v}"`);
    }
  }
  if (permissions.skill) {
    frontmatter.push(`  skill:`);
    for (const [k, v] of Object.entries(permissions.skill)) {
      frontmatter.push(`    "${k}": "${v}"`);
    }
  }
  frontmatter.push(`skills:`);
  for (const s of skills) frontmatter.push(`  - ${s}`);
  frontmatter.push("---");
  frontmatter.push("");
  frontmatter.push(agent.content);

  writeFileSync(filePath, frontmatter.join("\n"));
}

/**
 * Remove an agent's .md file from disk. Silently ignores if the file doesn't exist.
 * Used by disable/delete/update (on category change) operations.
 */
function removeAgentFromDisk(agent: Agent): void {
  assertSafeAgentName(agent.name);
  assertAgentCategory(agent.category);
  const filePath = resolve(getAgentsDir(), agent.category, `${agent.name}.md`);
  try { if (existsSync(filePath)) unlinkSync(filePath); } catch {}
}

/**
 * List agents for a project, optionally filtered by category.
 * Results are ordered by category then name (or just name if category is specified).
 */
export function listAgents(projectId: string, category?: string): Agent[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  if (category) {
    if (!isAgentCategory(category)) return [];
    return db.prepare("SELECT * FROM agents WHERE project_id = ? AND category = ? ORDER BY name")
      .all(projectId, category) as Agent[];
  }
  return db.prepare("SELECT * FROM agents WHERE project_id = ? ORDER BY category, name")
    .all(projectId) as Agent[];
}

/** Get a single agent by project and name. Returns undefined if not found. */
export function getAgent(projectId: string, name: string): Agent | undefined {
  if (!isSafeAgentName(name)) return undefined;
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
    .get(projectId, name) as Agent | undefined;
}

/**
 * Create a new agent for a project.
 * Persists to DB and writes the agent `.md` file to `.opencode/agents/<category>/`.
 *
 * Defaults: category="execution", mode="subagent", model=null (no model override).
 */
export function createAgent(
  projectId: string,
  name: string,
  content: string,
  description?: string,
  category?: string,
  mode?: string,
  model?: string,
  enabled = true,
): Agent {
  assertSafeAgentName(name);
  const safeCategory = category ?? "execution";
  assertAgentCategory(safeCategory);
  const agent = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO agents (id, project_id, name, description, category, mode, model, content, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, projectId, name, description ?? "", safeCategory, mode ?? "subagent", model ?? null, content, enabled ? 1 : 0, now, now);

    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Agent;
    if (enabled) writeAgentToDisk(agent);
    return agent;
  });
  updateAgentRuntimeConfig(projectId, name, { model: model ?? null, disabled: !enabled });
  checkpointAfterWrite();
  return agent;
}

/**
 * Update an existing agent's metadata and/or content.
 * Handles category changes by removing the old `.md` file and writing to the new category directory.
 *
 * NOTE: null model explicitly removes the model override; undefined preserves the existing value.
 */
export function updateAgent(
  projectId: string,
  name: string,
  updates: { description?: string; category?: string; mode?: string; model?: string | null; content?: string }
): Agent | undefined {
  if (!isSafeAgentName(name)) return undefined;
  if (updates.category !== undefined && !isAgentCategory(updates.category)) return undefined;
  const agent = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const existing = db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Agent | undefined;
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const newDesc = updates.description ?? existing.description;
    const newCat = updates.category ?? existing.category;
    const newMode = updates.mode ?? existing.mode;
    const newModel = updates.model !== undefined ? updates.model : existing.model;
    const newContent = updates.content ?? existing.content;

    db.prepare(
      `UPDATE agents SET description = ?, category = ?, mode = ?, model = ?, content = ?, updated_at = ? WHERE id = ?`
    ).run(newDesc, newCat, newMode, newModel, newContent, now, existing.id);

    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(existing.id) as Agent;
    if (updates.category && updates.category !== existing.category) {
      removeAgentFromDisk(existing);
    }
    writeAgentToDisk(agent);
    return agent;
  });
  if (agent && updates.model !== undefined) {
    updateAgentRuntimeConfig(projectId, name, { model: updates.model || null });
  }
  checkpointAfterWrite();
  return agent;
}

/** Delete an agent: removes from DB and deletes the `.md` file from disk. Returns false if not found. */
export function deleteAgent(projectId: string, name: string): boolean {
  if (!isSafeAgentName(name)) return false;
  const deleted = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const agent = db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Agent | undefined;
    if (!agent) return false;
    db.prepare("DELETE FROM agents WHERE id = ?").run(agent.id);
    removeAgentFromDisk(agent);

    return true;
  });
  if (deleted) updateAgentRuntimeConfig(projectId, name, { remove: true });
  checkpointAfterWrite();
  return deleted;
}

/** Enable an agent and write its `.md` file to disk. */
export function enableAgent(projectId: string, name: string): Agent | undefined {
  if (!isSafeAgentName(name)) return undefined;
  const agent = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    db.prepare("UPDATE agents SET enabled = 1, updated_at = ? WHERE project_id = ? AND name = ?")
      .run(now, projectId, name);
    const agent = db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Agent | undefined;
    if (agent) {
      writeAgentToDisk(agent);
    }
    return agent;
  });
  if (agent) updateAgentRuntimeConfig(projectId, name, { model: agent.model ?? undefined, disabled: false });
  checkpointAfterWrite();
  return agent;
}

/** Disable an agent and remove its `.md` file from disk. */
export function disableAgent(projectId: string, name: string): Agent | undefined {
  if (!isSafeAgentName(name)) return undefined;
  const agent = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    db.prepare("UPDATE agents SET enabled = 0, updated_at = ? WHERE project_id = ? AND name = ?")
      .run(now, projectId, name);
    const agent = db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Agent | undefined;
    if (agent) {
      removeAgentFromDisk(agent);
    }
    return agent;
  });
  if (agent) updateAgentRuntimeConfig(projectId, name, { model: agent.model, disabled: true });
  checkpointAfterWrite();
  return agent;
}

/**
 * Sync an agent from its `.md` file on disk into the DB.
 * Used by the bidirectional agent sync engine to reconcile disk → DB changes.
 *
 * If the agent exists in DB, its category from the DB is used to locate the file.
 * If not, all four category directories (primary, execution, research, security) are searched.
 *
 * Parses the full YAML frontmatter structure including:
 * - Basic fields: name, description, mode, reasoning_effort
 * - Permission blocks: read/write/bash, plus nested task/mcp/skill permissions
 * - Skills list
 */
export function syncAgentFromDisk(projectId: string, name: string): Agent | undefined {
  if (!isSafeAgentName(name)) return undefined;
  const categories = AGENT_CATEGORIES;
  let filePath = "";
  let category = "";

  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const dbAgent = db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
    .get(projectId, name) as Agent | undefined;

  if (dbAgent && !dbAgent.enabled) return dbAgent;

  if (dbAgent) {
    if (!isAgentCategory(dbAgent.category)) return undefined;
    filePath = resolve(
      process.env.INGENIUM_CORE_DB_PATH ?? "./data",
      "..", "..", ".opencode", "agents", dbAgent.category, `${name}.md`
    );
    category = dbAgent.category;
  } else {
    for (const cat of categories) {
      const candidate = resolve(
        process.env.INGENIUM_CORE_DB_PATH ?? "./data",
        "..", "..", ".opencode", "agents", cat, `${name}.md`
      );
      if (existsSync(candidate)) {
        filePath = candidate;
        category = cat;
        break;
      }
    }
  }

  if (!filePath || !existsSync(filePath)) {
    logger.warn("agents", "Agent file not found on disk", { name });
    return undefined;
  }

  const content = readFileSync(filePath, "utf-8");
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    logger.warn("agents", "Agent file has no frontmatter", { name });
    return undefined;
  }

  const frontmatter = fmMatch[1]!;
  const body = fmMatch[2]!.trim();

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*"(.+)"$/m);
  const modeMatch = frontmatter.match(/^mode:\s*(.+)$/m);
  const reasoningMatch = frontmatter.match(/^reasoning_effort:\s*"(.+)"$/m);
  const readPerm = frontmatter.match(/^  read:\s*(.+)$/m)?.[1] ?? "allow";
  const writePerm = frontmatter.match(/^  write:\s*(.+)$/m)?.[1] ?? "allow";
  const bashPerm = frontmatter.match(/^  bash:\s*(.+)$/m)?.[1] ?? "allow";
  const skillMatches = [...frontmatter.matchAll(/^\s+-\s(.+)$/gm)].map(m => m[1]!);

  // Parse nested task: permission block
  // Pattern: matches `  task:\n` followed by lines indented 4+ spaces (values) or # comments
  const taskPerms: Record<string, string> = {};
  const taskMatch = frontmatter.match(/^  task:\n((?:(?:    .+\n)|(?:\s*#.+\n))*)/m);
  if (taskMatch) {
    const taskLines = taskMatch[1]!.split('\n').filter(l => !l.trimStart().startsWith('#') && l.trim());
    for (const line of taskLines) {
      const kv = line.match(/^\s{4,}"(.+?)":\s*"(.+?)"/);
      if (kv) taskPerms[kv[1]!] = kv[2]!;
    }
  }

  // Parse nested mcp: permission block (same structure as task:)
  const mcpPerms: Record<string, string> = {};
  const mcpMatch = frontmatter.match(/^  mcp:\n((?:(?:    .+\n)|(?:\s*#.+\n))*)/m);
  if (mcpMatch) {
    const mcpLines = mcpMatch[1]!.split('\n').filter(l => !l.trimStart().startsWith('#') && l.trim());
    for (const line of mcpLines) {
      const kv = line.match(/^\s{4,}"(.+?)":\s*"(.+?)"/);
      if (kv) mcpPerms[kv[1]!] = kv[2]!;
    }
  }

  // Parse nested skill: permission block (same structure)
  const skillPerms: Record<string, string> = {};
  const skillMatch = frontmatter.match(/^  skill:\n((?:(?:    .+\n)|(?:\s*#.+\n))*)/m);
  if (skillMatch) {
    const skillLines = skillMatch[1]!.split('\n').filter(l => !l.trimStart().startsWith('#') && l.trim());
    for (const line of skillLines) {
      const kv = line.match(/^\s{4,}"(.+?)":\s*"(.+?)"/);
      if (kv) skillPerms[kv[1]!] = kv[2]!;
    }
  }

   const agentName = nameMatch?.[1] ?? name;
   if (!isSafeAgentName(agentName) || agentName !== name || !isAgentCategory(category)) return undefined;
  const description = descMatch?.[1] ?? "";
  const mode = modeMatch?.[1] ?? "subagent";
   // Markdown model lines are deliberately ignored. Config is authoritative;
   // absent a configured model, retain existing API metadata for compatibility.
   const model = configuredAgentModel(projectId, name) ?? dbAgent?.model ?? null;
  const reasoningEffort = reasoningMatch?.[1] ?? null;

  const permObj: any = { read: readPerm, write: writePerm, bash: bashPerm };
  if (Object.keys(taskPerms).length > 0) permObj.task = taskPerms;
  if (Object.keys(mcpPerms).length > 0) permObj.mcp = mcpPerms;
  if (Object.keys(skillPerms).length > 0) permObj.skill = skillPerms;
  const permissions = JSON.stringify(permObj);

   const agent = execTransaction(() => {
    const now = new Date().toISOString();
    if (dbAgent) {
      db.prepare(
        `UPDATE agents SET name = ?, description = ?, category = ?, mode = ?, model = ?, reasoning_effort = ?, permissions = ?, skills = ?, content = ?, updated_at = ? WHERE id = ?`
      ).run(agentName, description, category, mode, model, reasoningEffort, permissions, JSON.stringify(skillMatches), body, now, dbAgent.id);
    } else {
      const id = randomUUID();
      db.prepare(
        `INSERT OR IGNORE INTO agents (id, project_id, name, description, category, mode, model, reasoning_effort, permissions, skills, content, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(id, projectId, agentName, description, category, mode, model, reasoningEffort, permissions, JSON.stringify(skillMatches), body, now, now);
    }
     return db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
       .get(projectId, agentName) as Agent | undefined;
   });
   if (agent && !dbAgent) updateAgentRuntimeConfig(projectId, name, { model: agent.model ?? undefined, disabled: true });
   checkpointAfterWrite();
   return agent;
}
