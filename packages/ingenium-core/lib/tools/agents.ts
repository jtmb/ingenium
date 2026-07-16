import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { Agent } from "../schema.js";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../logger.js";

function getAgentsDir(): string {
  return resolve(process.env.INGENIUM_CORE_DB_PATH ?? "./data", "..", "..", ".opencode", "agents");
}

/**
 * Write an agent definition to `.opencode/agents/<category>/<name>.md` as a YAML-frontmatter markdown file.
 *
 * If the file already exists, it does an in-place field update (replacing only name, description,
 * mode, and model in the YAML frontmatter) — this preserves any handwritten fields (like
 * permissions, skills, or custom YAML keys) that OpenCode's agent system uses.
 *
 * If the file doesn't exist, it creates a full frontmatter block from the DB record, including
 * permissions (read/write/bash/task/mcp/skill), skills list, and content body.
 */
function writeAgentToDisk(agent: Agent): void {
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

      // The `^model:` regex only matches uncommented lines — `# model:` passes through unchanged.
      if (agent.model) {
        if (updated.match(/^model:\s*.+$/m)) {
          updated = updated.replace(/^model:\s*.+$/m, `model: ${agent.model}`);
        } else {
          updated += `\nmodel: ${agent.model}`;
        }
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
  if (agent.model) frontmatter.push(`model: ${agent.model}`);
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
    return db.prepare("SELECT * FROM agents WHERE project_id = ? AND category = ? ORDER BY name")
      .all(projectId, category) as Agent[];
  }
  return db.prepare("SELECT * FROM agents WHERE project_id = ? ORDER BY category, name")
    .all(projectId) as Agent[];
}

/** Get a single agent by project and name. Returns undefined if not found. */
export function getAgent(projectId: string, name: string): Agent | undefined {
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
): Agent {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO agents (id, project_id, name, description, category, mode, model, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, projectId, name, description ?? "", category ?? "execution", mode ?? "subagent", model ?? null, content, now, now);

    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Agent;
    writeAgentToDisk(agent);
    checkpointAfterWrite();
    return agent;
  });
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
  updates: { description?: string; category?: string; mode?: string; model?: string; content?: string }
): Agent | undefined {
  return execTransaction(() => {
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
    checkpointAfterWrite();
    return agent;
  });
}

/** Delete an agent: removes from DB and deletes the `.md` file from disk. Returns false if not found. */
export function deleteAgent(projectId: string, name: string): boolean {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const agent = db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Agent | undefined;
    if (!agent) return false;
    db.prepare("DELETE FROM agents WHERE id = ?").run(agent.id);
    removeAgentFromDisk(agent);

    checkpointAfterWrite();
    return true;
  });
}

/** Enable an agent and write its `.md` file to disk. */
export function enableAgent(projectId: string, name: string): Agent | undefined {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    db.prepare("UPDATE agents SET enabled = 1, updated_at = ? WHERE project_id = ? AND name = ?")
      .run(now, projectId, name);
    const agent = db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Agent | undefined;
    if (agent) {
      writeAgentToDisk(agent);
    }
    checkpointAfterWrite();
    return agent;
  });
}

/** Disable an agent and remove its `.md` file from disk. */
export function disableAgent(projectId: string, name: string): Agent | undefined {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    db.prepare("UPDATE agents SET enabled = 0, updated_at = ? WHERE project_id = ? AND name = ?")
      .run(now, projectId, name);
    const agent = db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Agent | undefined;
    if (agent) {
      removeAgentFromDisk(agent);
    }
    checkpointAfterWrite();
    return agent;
  });
}

/**
 * Sync an agent from its `.md` file on disk into the DB.
 * Used by the bidirectional agent sync engine to reconcile disk → DB changes.
 *
 * If the agent exists in DB, its category from the DB is used to locate the file.
 * If not, all four category directories (primary, execution, research, security) are searched.
 *
 * Parses the full YAML frontmatter structure including:
 * - Basic fields: name, description, mode, model, reasoning_effort
 * - Permission blocks: read/write/bash, plus nested task/mcp/skill permissions
 * - Skills list
 */
export function syncAgentFromDisk(projectId: string, name: string): Agent | undefined {
  const categories = ["primary", "execution", "research", "security"];
  let filePath = "";
  let category = "";

  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const dbAgent = db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
    .get(projectId, name) as Agent | undefined;

  if (dbAgent) {
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
  const modelMatch = frontmatter.match(/^model:\s*(.+)$/m);
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
  const description = descMatch?.[1] ?? "";
  const mode = modeMatch?.[1] ?? "subagent";
  const model = modelMatch?.[1] ?? null;
  const reasoningEffort = reasoningMatch?.[1] ?? null;

  const permObj: any = { read: readPerm, write: writePerm, bash: bashPerm };
  if (Object.keys(taskPerms).length > 0) permObj.task = taskPerms;
  if (Object.keys(mcpPerms).length > 0) permObj.mcp = mcpPerms;
  if (Object.keys(skillPerms).length > 0) permObj.skill = skillPerms;
  const permissions = JSON.stringify(permObj);

  return execTransaction(() => {
    const now = new Date().toISOString();
    if (dbAgent) {
      db.prepare(
        `UPDATE agents SET name = ?, description = ?, category = ?, mode = ?, model = ?, reasoning_effort = ?, permissions = ?, skills = ?, content = ?, updated_at = ? WHERE id = ?`
      ).run(agentName, description, category, mode, model, reasoningEffort, permissions, JSON.stringify(skillMatches), body, now, dbAgent.id);
    } else {
      const id = randomUUID();
      db.prepare(
        `INSERT OR IGNORE INTO agents (id, project_id, name, description, category, mode, model, reasoning_effort, permissions, skills, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, projectId, agentName, description, category, mode, model, reasoningEffort, permissions, JSON.stringify(skillMatches), body, now, now);
    }
    checkpointAfterWrite();
    return db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
      .get(projectId, agentName) as Agent | undefined;
  });
}
