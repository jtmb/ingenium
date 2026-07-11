import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { MCPToolState } from "../schema.js";

export function getToolState(projectId: string, toolName: string): boolean {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const row = db.prepare("SELECT enabled FROM mcp_tool_states WHERE project_id = ? AND tool_name = ?").get(projectId, toolName) as { enabled: number } | undefined;
  if (!row) return true; // default enabled
  return row.enabled === 1;
}

export function setToolState(projectId: string, toolName: string, enabled: boolean): MCPToolState {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    // Use UPSERT — table has UNIQUE(project_id, tool_name), no id column needed
    db.prepare(`
      INSERT INTO mcp_tool_states (project_id, tool_name, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, tool_name) DO UPDATE SET enabled = ?, updated_at = ?
    `).run(projectId, toolName, enabled ? 1 : 0, now, now, enabled ? 1 : 0, now);
    checkpointAfterWrite();
    return db.prepare("SELECT * FROM mcp_tool_states WHERE project_id = ? AND tool_name = ?").get(projectId, toolName) as MCPToolState;
  });
}

export function listToolStates(projectId: string): Array<{ tool_name: string; enabled: boolean }> {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const rows = db.prepare("SELECT tool_name, enabled FROM mcp_tool_states WHERE project_id = ? ORDER BY tool_name").all(projectId) as Array<{ tool_name: string; enabled: number }>;
  return rows.map(r => ({ tool_name: r.tool_name, enabled: r.enabled === 1 }));
}

const ALL_TOOLS = [
  "ingenium_setting_get", "ingenium_setting_set",
  "ingenium_skill_list", "ingenium_skill_load", "ingenium_skill_search", "ingenium_skill_create", "ingenium_skill_update", "ingenium_skill_delete", "ingenium_skill_enable", "ingenium_skill_disable", "ingenium_skill_sync",
  "ingenium_task_list", "ingenium_task_create", "ingenium_task_move", "ingenium_task_complete",
  "ingenium_project_list", "ingenium_project_init", "ingenium_project_delete", "ingenium_project_restore", "ingenium_project_list_archived", "ingenium_project_purge", "ingenium_project_set_global",
  "ingenium_plugin_list", "ingenium_plugin_get", "ingenium_plugin_create", "ingenium_plugin_update", "ingenium_plugin_delete", "ingenium_plugin_enable", "ingenium_plugin_disable",
  "ingenium_server_list", "ingenium_server_add", "ingenium_server_remove",
  "ingenium_agent_list", "ingenium_agent_get", "ingenium_agent_create", "ingenium_agent_update", "ingenium_agent_delete", "ingenium_agent_enable", "ingenium_agent_disable", "ingenium_agent_sync",
  "ingenium_observation_list", "ingenium_observation_search", "ingenium_observation_stats",
  "ingenium_personality", "ingenium_personality_traits",
  "ingenium_synthesis_run", "ingenium_synthesis_status", "ingenium_synthesis_cross_project",
  "ingenium_command_list", "ingenium_command_get", "ingenium_command_create", "ingenium_command_update", "ingenium_command_delete",
  "ingenium_config_get", "ingenium_config_set", "ingenium_config_sync",
  "ingenium_plan_list", "ingenium_plan_save", "ingenium_plan_search",
  "ingenium_email_list", "ingenium_email_search", "ingenium_email_read", "ingenium_email_send", "ingenium_email_draft", "ingenium_email_draft_response", "ingenium_email_folders", "ingenium_email_accounts", "ingenium_email_triage", "ingenium_email_suggest", "ingenium_email_patterns", "ingenium_email_watch_start", "ingenium_email_watch_status",
  "ingenium_observe",
];

export function getAllToolNames(): string[] {
  return [...ALL_TOOLS];
}

export function listToolStatesWithDefaults(projectId: string): Array<{ tool_name: string; enabled: boolean }> {
  const states = listToolStates(projectId);
  const stateMap = new Map(states.map(s => [s.tool_name, s.enabled]));
  return getAllToolNames().map(name => ({
    tool_name: name,
    enabled: stateMap.has(name) ? stateMap.get(name)! : true,
  }));
}

const CATEGORY_PREFIX: Record<string, string> = {
  setting: "Settings",
  skill: "Skills",
  task: "Tasks",
  project: "Projects",
  plugin: "Plugins",
  server: "Servers",
  agent: "Agents",
  observation: "Observations",
  personality: "Personality",
  synthesis: "Synthesis",
  command: "Commands",
  config: "Config",
  plan: "Plans",
  email: "Email",
  observe: "Observe",
};

export function getCategory(toolName: string): string {
  // toolName = "ingenium_skill_list" → prefix = "skill" → "Skills"
  const parts = toolName.split("_");
  const prefix = parts[1];
  if (prefix && CATEGORY_PREFIX[prefix]) {
    return CATEGORY_PREFIX[prefix];
  }
  return "Other";
}

export interface CategorizedTool {
  tool_name: string;
  enabled: boolean;
  category: string;
}

export function listCategorizedTools(projectId: string): Array<{
  category: string;
  enabled_count: number;
  total_count: number;
  tools: Array<{ tool_name: string; enabled: boolean }>;
}> {
  const tools = listToolStatesWithDefaults(projectId);
  const categorized = tools.map(t => ({ ...t, category: getCategory(t.tool_name) }));

  // Group by category
  const groups = new Map<string, Array<{ tool_name: string; enabled: boolean }>>();
  for (const t of categorized) {
    if (!groups.has(t.category)) groups.set(t.category, []);
    groups.get(t.category)!.push({ tool_name: t.tool_name, enabled: t.enabled });
  }

  // Return sorted categories
  const categoryOrder = Object.values(CATEGORY_PREFIX);
  return Array.from(groups.entries())
    .sort((a, b) => categoryOrder.indexOf(a[0]) - categoryOrder.indexOf(b[0]))
    .map(([category, tools]) => ({
      category,
      enabled_count: tools.filter(t => t.enabled).length,
      total_count: tools.length,
      tools,
    }));
}

export function setCategoryState(projectId: string, category: string, enabled: boolean): number {
  const prefix = Object.entries(CATEGORY_PREFIX).find(([, v]) => v === category)?.[0];
  if (!prefix) return 0;

  const matchingTools = getAllToolNames().filter(n => n.startsWith(`ingenium_${prefix}`));
  let changed = 0;
  for (const toolName of matchingTools) {
    setToolState(projectId, toolName, enabled);
    changed++;
  }
  return changed;
}
