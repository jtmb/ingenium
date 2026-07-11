/**
 * Ingenium MCP Server — main entry point.
 *
 * Creates an MCP server using @modelcontextprotocol/sdk's McpServer, registers all tool handlers
 * via registerTool, and starts the stdio transport. Does NOT import ingenium-core or any SQLite
 * library — all data access goes through HTTP to the Ingenium API.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "../config/index.js";
import { logger } from "../lib/logger.js";
import { stopAll } from "../lib/proxy.js";

// Import MCP tool handlers
import * as skillTools from "../lib/tools/skills.js";
import * as taskTools from "../lib/tools/tasks.js";
import * as contextTools from "../lib/tools/context.js";
import * as projectTools from "../lib/tools/projects.js";
import * as pluginTools from "../lib/tools/plugins.js";
import * as serverTools from "../lib/tools/servers.js";
import { settingGet, settingSet } from "../lib/tools/settings.js";
import { projectRestore, projectListArchived, projectPurge, projectSetGlobal } from "../lib/tools/projects.js";
import { pluginGet } from "../lib/tools/plugins.js";
import * as commandTools from "../lib/tools/commands.js";
import { commandGet } from "../lib/tools/commands.js";
import { planList } from "../lib/tools/context.js";
import * as agentTools from "../lib/tools/agents.js";
import {
  observationStore, observationSearch, observationList, observationStats,
} from "../lib/tools/observations.js";
import {
  personalityProfile, personalityTraits,
} from "../lib/tools/personality.js";
import {
  synthesisRun, synthesisStatus, synthesisCrossProject,
} from "../lib/tools/synthesis.js";
import * as emailTools from "../lib/tools/emails.js";
import * as configTools from "../lib/tools/configs.js";

// ── Tool State Check Wrapper ──────────────────────────────
const API_CLIENT = process.env.INGENIUM_API_URL ?? "http://localhost:4097/api/v1";

async function checkToolEnabled(toolName: string, project: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_CLIENT}/mcp-tools/${encodeURIComponent(toolName)}/state?project=${encodeURIComponent(project)}`);
    if (!res.ok) return true;
    const data = await res.json();
    return data.data?.enabled !== false;
  } catch {
    return true; // default to enabled on error
  }
}

/** Wraps a tool handler to check if the tool is enabled for the project before executing. */
function wrapHandler(toolName: string, handler: (args: any) => Promise<any>) {
  return async (args: any) => {
    const project = args?.project;
    if (project && typeof project === "string") {
      const enabled = await checkToolEnabled(toolName, project);
      if (!enabled) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            error: { code: "TOOL_DISABLED", message: `Tool '${toolName}' is disabled for this project` }
          }) }]
        };
      }
    }
    return handler(args);
  };
}

/** Shared required project parameter. Projects must be created explicitly via ingenium_project_init or the dashboard. */
const projectParam = z.string();

const server = new McpServer(
  { name: config.mcpName, version: config.mcpVersion },
  { capabilities: { tools: {}, resources: {} } },
);

// ── Settings ─────────────────────────────────────────────

server.registerTool(
  "ingenium_setting_get",
  { description: "Get a setting value by key", inputSchema: { project: projectParam, key: z.string() } },
  wrapHandler("ingenium_setting_get", async ({ project, key }) => settingGet(project, key)),
);

server.registerTool(
  "ingenium_setting_set",
  { description: "Set a setting value", inputSchema: { project: projectParam, key: z.string(), value: z.string() } },
  wrapHandler("ingenium_setting_set", async ({ project, key, value }) => settingSet(project, key, value)),
);

// ── Skills ──────────────────────────────────────────────

server.registerTool(
  "ingenium_skill_list",
  { description: "List all skills for a project.", inputSchema: { project: projectParam } },
  wrapHandler("ingenium_skill_list", async ({ project }) => skillTools.skillList(project)),
);

server.registerTool(
  "ingenium_skill_load",
  { description: "Load a single skill by name.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_skill_load", async ({ project, name }) => skillTools.skillLoad(project, name)),
);

server.registerTool(
  "ingenium_skill_search",
  { description: "Full-text search across skills.", inputSchema: { project: projectParam, query: z.string() } },
  wrapHandler("ingenium_skill_search", async ({ project, query }) => skillTools.skillSearch(project, query)),
);

server.registerTool(
  "ingenium_skill_create",
  {
    description: "Create a new skill.",
    inputSchema: {
      project: projectParam,
      name: z.string(),
      description: z.string(),
      content: z.string(),
      category: z.string().optional(),
      tags: z.string().optional(),
      always_apply: z.number().optional(),
      files: z.string().optional(),
    },
  },
    wrapHandler("ingenium_skill_create", async ({ project, name, description, content, category, tags, always_apply, files }) =>
    skillTools.skillCreate(project, name, description, content, category, tags, always_apply, files)),
);

server.registerTool(
  "ingenium_skill_update",
  {
    description: "Update an existing skill's content.",
    inputSchema: { project: projectParam, name: z.string(), content: z.string(), description: z.string().optional(), tags: z.string().optional(), always_apply: z.number().optional(), files: z.string().optional() },
  },
  wrapHandler("ingenium_skill_update", async ({ project, name, content, description, tags, always_apply, files }) => skillTools.skillUpdate(project, name, content, description, tags, always_apply, files)),
);

server.registerTool(
  "ingenium_skill_delete",
  { description: "Delete a skill by name.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_skill_delete", async ({ project, name }) => skillTools.skillDelete(project, name)),
);

server.registerTool(
  "ingenium_skill_enable",
  { description: "Enable a skill and sync to disk.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_skill_enable", async ({ project, name }) => skillTools.skillEnable(project, name)),
);

server.registerTool(
  "ingenium_skill_disable",
  { description: "Disable a skill and remove from disk.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_skill_disable", async ({ project, name }) => skillTools.skillDisable(project, name)),
);

server.registerTool(
  "ingenium_skill_sync",
  { description: "Sync a skill from its .md file on disk to the DB — edits made directly to the file are persisted.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_skill_sync", async ({ project, name }) => skillTools.skillSync(project, name)),
);

// ── Observations ──────────────────────────────────────────

server.registerTool(
  "ingenium_observe",
  {
    description: "Store an observation about the user's behavior, preferences, or interaction pattern. The agent uses this naturally during its workflow — no explicit self-reporting needed. Types: correction, preference, pattern, insight, feedback, behavior, terminology, workflow, error, goal.",
    inputSchema: {
      project: projectParam,
      observation_type: z.string(),
      content: z.string(),
      importance: z.number().optional(),
      source: z.string().optional(),
      context: z.string().optional(),
    },
  },
    wrapHandler("ingenium_observe", async ({ project, observation_type, content, importance, source, context }) =>
    observationStore(project, observation_type, content, importance, source, context)),
);

server.registerTool(
  "ingenium_observation_search",
  {
    description: "Full-text search across observations.",
    inputSchema: { project: projectParam, query: z.string() },
  },
  wrapHandler("ingenium_observation_search", async ({ project, query }) => observationSearch(project, query)),
);

server.registerTool(
  "ingenium_observation_list",
  {
    description: "List observations with optional status and type filters.",
    inputSchema: { project: projectParam, status: z.string().optional(), type: z.string().optional() },
  },
  wrapHandler("ingenium_observation_list", async ({ project, status, type }) => observationList(project, status, type)),
);

server.registerTool(
  "ingenium_observation_stats",
  {
    description: "Get observation pipeline statistics (total, pending, processed).",
    inputSchema: { project: projectParam },
  },
  wrapHandler("ingenium_observation_stats", async ({ project }) => observationStats(project)),
);

// ── Personality ───────────────────────────────────────────

server.registerTool(
  "ingenium_personality",
  {
    description: "Get the full learned personality profile — aggregated traits about user preferences, communication style, and behavior patterns.",
    inputSchema: { project: projectParam },
  },
  wrapHandler("ingenium_personality", async ({ project }) => personalityProfile(project)),
);

server.registerTool(
  "ingenium_personality_traits",
  {
    description: "List personality traits, optionally filtered by type.",
    inputSchema: { project: projectParam, trait_type: z.string().optional() },
  },
  wrapHandler("ingenium_personality_traits", async ({ project, trait_type }) => personalityTraits(project, trait_type)),
);

// ── Synthesis ─────────────────────────────────────────────

server.registerTool(
  "ingenium_synthesis_run",
  {
    description: "Trigger the background synthesis pipeline — processes pending observations into personality traits and skill updates.",
    inputSchema: { project: projectParam },
  },
  wrapHandler("ingenium_synthesis_run", async ({ project }) => synthesisRun(project)),
);

server.registerTool(
  "ingenium_synthesis_status",
  {
    description: "Check the synthesis pipeline status (pending count, last run, processed count).",
    inputSchema: { project: projectParam },
  },
  wrapHandler("ingenium_synthesis_status", async ({ project }) => synthesisStatus(project)),
);

server.registerTool(
  "ingenium_synthesis_cross_project",
  {
    description: "Trigger cross-project synthesis — evaluates patterns across all projects and promotes shared patterns to the global-default project.",
    inputSchema: { project: projectParam },
  },
  wrapHandler("ingenium_synthesis_cross_project", async ({ project }) => synthesisCrossProject(project)),
);

// ── Tasks ───────────────────────────────────────────────

server.registerTool(
  "ingenium_task_create",
  {
    description: "Create a new task with optional description and assignee.",
    inputSchema: {
      project: projectParam,
      title: z.string(),
      description: z.string().optional(),
      assigned_to: z.string().optional(),
    },
  },
    wrapHandler("ingenium_task_create", async ({ project, title, description, assigned_to }) =>
    taskTools.taskCreate(project, title, description, assigned_to)),
);

server.registerTool(
  "ingenium_task_list",
  {
    description: "List tasks, optionally filtered by column.",
    inputSchema: { project: projectParam, column_id: z.string().optional() },
  },
  wrapHandler("ingenium_task_list", async ({ project, column_id }) => taskTools.taskList(project, column_id)),
);

server.registerTool(
  "ingenium_task_move",
  {
    description: "Move a task to a different column.",
    inputSchema: { project: projectParam, task_id: z.string(), column_id: z.string() },
  },
  wrapHandler("ingenium_task_move", async ({ project, task_id, column_id }) => taskTools.taskMove(project, task_id, column_id)),
);

server.registerTool(
  "ingenium_task_complete",
  { description: "Mark a task as completed.", inputSchema: { project: projectParam, task_id: z.string() } },
  wrapHandler("ingenium_task_complete", async ({ project, task_id }) => taskTools.taskComplete(project, task_id)),
);

server.registerTool(
  "ingenium_task_next",
  { description: "Get the highest-priority next task to work on.", inputSchema: { project: projectParam } },
  wrapHandler("ingenium_task_next", async ({ project }) => taskTools.taskNext(project)),
);

// ── Plans ─────────────────────────────────────────────

server.registerTool(
  "ingenium_plan_save",
  {
    description: "Save a context entry with optional tags and priority.",
    inputSchema: { project: projectParam, content: z.string(), tags: z.string().optional(), priority: z.number().optional() },
  },
  wrapHandler("ingenium_plan_save", async ({ project, content, tags, priority }) => contextTools.planSave(project, content, tags, priority)),
);

server.registerTool(
  "ingenium_plan_search",
  { description: "Full-text search across context entries.", inputSchema: { project: projectParam, query: z.string() } },
  wrapHandler("ingenium_plan_search", async ({ project, query }) => contextTools.planSearch(project, query)),
);

server.registerTool(
  "ingenium_plan_list",
  { description: "List plan/context entries.", inputSchema: { project: projectParam } },
  wrapHandler("ingenium_plan_list", async ({ project }) => planList(project)),
);

// ── Projects ────────────────────────────────────────────

server.registerTool(
  "ingenium_project_list",
  { description: "List all projects known to the Ingenium API.", inputSchema: {} },
  async () => projectTools.projectList(),
);

server.registerTool(
  "ingenium_project_init",
  { description: "Initialise a new project on the Ingenium API.", inputSchema: { name: z.string(), isGlobal: z.boolean().optional() } },
  async ({ name, isGlobal }) => projectTools.projectInit(name, isGlobal),
);

server.registerTool(
  "ingenium_project_delete",
  { description: "Delete a project by name.", inputSchema: { name: z.string() } },
  async ({ name }) => projectTools.projectDelete(name),
);

server.registerTool(
  "ingenium_project_restore",
  { description: "Restore an archived project.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_project_restore", async ({ project, name }) => projectRestore(project, name)),
);

server.registerTool(
  "ingenium_project_list_archived",
  { description: "List archived projects.", inputSchema: { project: projectParam } },
  wrapHandler("ingenium_project_list_archived", async ({ project }) => projectListArchived(project)),
);

server.registerTool(
  "ingenium_project_purge",
  { description: "Purge old projects.", inputSchema: { project: projectParam, retentionDays: z.number().optional() } },
  wrapHandler("ingenium_project_purge", async ({ project, retentionDays }) => projectPurge(project, retentionDays)),
);

server.registerTool(
  "ingenium_project_set_global",
  { description: "Mark a project as global (or unmark).", inputSchema: { project: projectParam, name: z.string(), isGlobal: z.boolean() } },
  wrapHandler("ingenium_project_set_global", async ({ project, name, isGlobal }) => projectSetGlobal(project, name, isGlobal)),
);

// ── Plugins ─────────────────────────────────────────────

server.registerTool(
  "ingenium_plugin_list",
  { description: "List all plugins available for a project.", inputSchema: { project: projectParam } },
  wrapHandler("ingenium_plugin_list", async ({ project }) => pluginTools.pluginList(project)),
);

server.registerTool(
  "ingenium_plugin_get",
  { description: "Get a single plugin by name.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_plugin_get", async ({ project, name }) => pluginGet(project, name)),
);

server.registerTool(
  "ingenium_plugin_enable",
  { description: "Enable a plugin for a project.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_plugin_enable", async ({ project, name }) => pluginTools.pluginEnable(project, name)),
);

server.registerTool(
  "ingenium_plugin_disable",
  { description: "Disable a plugin for a project.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_plugin_disable", async ({ project, name }) => pluginTools.pluginDisable(project, name)),
);

server.registerTool(
  "ingenium_plugin_create",
  {
    description: "Create a new plugin for a project.",
    inputSchema: { project: projectParam, name: z.string(), filePath: z.string(), sourceContent: z.string().optional() }
  },
  wrapHandler("ingenium_plugin_create", async ({ project, name, filePath, sourceContent }) => pluginTools.pluginCreate(project, name, filePath, sourceContent)),
);

server.registerTool(
  "ingenium_plugin_delete",
  { description: "Delete a plugin from a project.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_plugin_delete", async ({ project, name }) => pluginTools.pluginDelete(project, name)),
);

server.registerTool(
  "ingenium_plugin_update",
  {
    description: "Update a plugin's file path or source content.",
    inputSchema: { project: projectParam, name: z.string(), file_path: z.string().optional(), source_content: z.string().optional() }
  },
  wrapHandler("ingenium_plugin_update", async ({ project, name, file_path, source_content }) => pluginTools.pluginUpdate(project, name, { file_path, source_content })),
);

// ── Commands ─────────────────────────────────────────────

server.registerTool(
  "ingenium_command_list",
  { description: "List all commands for a project.", inputSchema: { project: projectParam } },
  wrapHandler("ingenium_command_list", async ({ project }) => commandTools.commandList(project)),
);

server.registerTool(
  "ingenium_command_get",
  { description: "Get a command by name.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_command_get", async ({ project, name }) => commandGet(project, name)),
);

server.registerTool(
  "ingenium_command_create",
  {
    description: "Create a new command.",
    inputSchema: { project: projectParam, name: z.string(), filePath: z.string(), content: z.string().optional() }
  },
  wrapHandler("ingenium_command_create", async ({ project, name, filePath, content }) => commandTools.commandCreate(project, name, filePath, content)),
);

server.registerTool(
  "ingenium_command_update",
  {
    description: "Update an existing command.",
    inputSchema: { project: projectParam, name: z.string(), file_path: z.string().optional(), content: z.string().optional() }
  },
  wrapHandler("ingenium_command_update", async ({ project, name, file_path, content }) => commandTools.commandUpdate(project, name, { file_path, content })),
);

server.registerTool(
  "ingenium_command_delete",
  { description: "Delete a command.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_command_delete", async ({ project, name }) => commandTools.commandDelete(project, name)),
);

// ── Config ───────────────────────────────────────────────

server.registerTool(
  "ingenium_config_get",
  {
    description: "Get config (opencode.json/opencode.jsonc) content for a project",
    inputSchema: { project: projectParam, type: z.enum(["project", "global"]).optional().default("project") },
  },
  wrapHandler("ingenium_config_get", async ({ project, type }: { project: string; type: string }) => configTools.configGet(project, type)),
);

server.registerTool(
  "ingenium_config_set",
  {
    description: "Set config content for a project (writes to DB and disk)",
    inputSchema: { project: projectParam, type: z.enum(["project", "global"]).optional().default("project"), content: z.string() },
  },
  wrapHandler("ingenium_config_set", async ({ project, type, content }: { project: string; type: string; content: string }) => configTools.configSet(project, type, content)),
);

server.registerTool(
  "ingenium_config_sync",
  {
    description: "Sync config from disk to DB",
    inputSchema: { project: projectParam, type: z.enum(["project", "global"]).optional().default("project") },
  },
  wrapHandler("ingenium_config_sync", async ({ project, type }: { project: string; type: string }) => configTools.configSync(project, type)),
);

// ── Servers ─────────────────────────────────────────────

server.registerTool(
  "ingenium_server_list",
  { description: "List all registered child MCP servers for a project.", inputSchema: { project: projectParam } },
  wrapHandler("ingenium_server_list", async ({ project }) => serverTools.serverList(project)),
);

server.registerTool(
  "ingenium_server_add",
  {
    description: "Add a new child MCP server definition.",
    inputSchema: {
      project: projectParam,
      name: z.string(),
      command: z.string(),
      args: z.string().optional(),
      env: z.string().optional(),
      source: z.string().optional(),
    },
  },
    wrapHandler("ingenium_server_add", async ({ project, name, command, args, env, source }) =>
    serverTools.serverAdd(project, name, command, args, env, source)),
);

server.registerTool(
  "ingenium_server_remove",
  {
    description: "Remove a child MCP server definition.",
    inputSchema: { project: projectParam, name: z.string() },
  },
  wrapHandler("ingenium_server_remove", async ({ project, name }) => serverTools.serverRemove(project, name)),
);

// ── Agents ──────────────────────────────────────────────

server.registerTool(
  "ingenium_agent_list",
  { description: "List all agents for a project, optionally filtered by category.", inputSchema: { project: projectParam, category: z.string().optional() } },
  wrapHandler("ingenium_agent_list", async ({ project, category }) => agentTools.agentList(project, category)),
);

server.registerTool(
  "ingenium_agent_get",
  { description: "Get an agent by name.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_agent_get", async ({ project, name }) => agentTools.agentGet(project, name)),
);

server.registerTool(
  "ingenium_agent_create",
  {
    description: "Create a new agent with YAML-frontmatter content.",
    inputSchema: { project: projectParam, name: z.string(), content: z.string(), description: z.string().optional(), category: z.string().optional(), mode: z.string().optional(), model: z.string().optional() },
  },
  wrapHandler("ingenium_agent_create", async (args) => agentTools.agentCreate(args.project, args.name, args.content, args.description, args.category, args.mode, args.model)),
);

server.registerTool(
  "ingenium_agent_update",
  {
    description: "Update an existing agent's metadata or content.",
    inputSchema: { project: projectParam, name: z.string(), description: z.string().optional(), category: z.string().optional(), mode: z.string().optional(), model: z.string().optional(), content: z.string().optional() },
  },
  wrapHandler("ingenium_agent_update", async (args) => agentTools.agentUpdate(args.project, args.name, args)),
);

server.registerTool(
  "ingenium_agent_delete",
  { description: "Delete an agent by name.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_agent_delete", async ({ project, name }) => agentTools.agentDelete(project, name)),
);

server.registerTool(
  "ingenium_agent_enable",
  { description: "Enable an agent and write its .md file to disk.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_agent_enable", async ({ project, name }) => agentTools.agentEnable(project, name)),
);

server.registerTool(
  "ingenium_agent_disable",
  { description: "Disable an agent and remove its .md file from disk.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_agent_disable", async ({ project, name }) => agentTools.agentDisable(project, name)),
);

server.registerTool(
  "ingenium_agent_sync",
  { description: "Sync an agent from its .md file on disk to the DB — edits made directly to the file are persisted.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_agent_sync", async ({ project, name }) => agentTools.agentSync(project, name)),
);

// ── Email ──────────────────────────────────────────────

server.registerTool(
  "ingenium_email_list",
  {
    description: "List emails in a folder. Use this to check inbox, sent items, or any folder.",
    inputSchema: { project: projectParam, account: z.string(), folder: z.string().optional(), page: z.number().optional() },
  },
  wrapHandler("ingenium_email_list", async ({ project, account, folder, page }) => emailTools.emailList(project, account, folder, page)),
);

server.registerTool(
  "ingenium_email_search",
  {
    description: "Search emails by keyword, sender, subject, or date range.",
    inputSchema: { project: projectParam, account: z.string(), query: z.string(), folder: z.string().optional() },
  },
  wrapHandler("ingenium_email_search", async ({ project, account, query, folder }) => emailTools.emailSearch(project, account, query, folder)),
);

server.registerTool(
  "ingenium_email_read",
  {
    description: "Read a full email by its UID (unique ID).",
    inputSchema: { project: projectParam, account: z.string(), uid: z.number(), folder: z.string().optional() },
  },
  wrapHandler("ingenium_email_read", async ({ project, account, uid, folder }) => emailTools.emailRead(project, account, uid, folder)),
);

server.registerTool(
  "ingenium_email_send",
  {
    description: "Compose and send an email. Use HTML for formatting.",
    inputSchema: {
      project: projectParam, account: z.string(), to: z.string(), subject: z.string(),
      html: z.string().optional(), text: z.string().optional(),
      cc: z.string().optional(), bcc: z.string().optional(),
    },
  },
    wrapHandler("ingenium_email_send", async ({ project, account, to, subject, html, text, cc, bcc }) =>
    emailTools.emailSend(project, account, to, subject, html, text, cc, bcc)),
);

server.registerTool(
  "ingenium_email_draft",
  {
    description: "Save a draft email without sending.",
    inputSchema: {
      project: projectParam, account: z.string(), to: z.string(), subject: z.string(),
      html: z.string().optional(),
    },
  },
  wrapHandler("ingenium_email_draft", async ({ project, account, to, subject, html }) => emailTools.emailDraft(project, account, to, subject, html)),
);

server.registerTool(
  "ingenium_email_folders",
  {
    description: "List all email folders for an account.",
    inputSchema: { project: projectParam, account: z.string() },
  },
  wrapHandler("ingenium_email_folders", async ({ project, account }) => emailTools.emailFolders(project, account)),
);

server.registerTool(
  "ingenium_email_accounts",
  {
    description: "List connected email accounts.",
    inputSchema: { project: projectParam },
  },
  wrapHandler("ingenium_email_accounts", async ({ project }) => emailTools.emailAccounts(project)),
);

server.registerTool(
  "ingenium_email_triage",
  {
    description: "Triage emails — categorize by priority and suggest actions based on learned patterns. Use this to process your inbox.",
    inputSchema: { project: projectParam, account: z.string(), limit: z.number().optional() },
  },
  wrapHandler("ingenium_email_triage", async ({ project, account, limit }) => emailTools.emailTriage(project, account, limit)),
);

server.registerTool(
  "ingenium_email_suggest",
  {
    description: "Suggest an email response based on learned user patterns and past behavior.",
    inputSchema: { project: projectParam, account: z.string(), uid: z.number(), folder: z.string().optional() },
  },
  wrapHandler("ingenium_email_suggest", async ({ project, account, uid, folder }) => emailTools.emailSuggestResponse(project, account, uid, folder)),
);

server.registerTool(
  "ingenium_email_draft_response",
  {
    description: "Auto-draft a response to an email based on learned patterns and save it to Drafts folder.",
    inputSchema: { project: projectParam, account: z.string(), uid: z.number(), folder: z.string().optional() },
  },
  wrapHandler("ingenium_email_draft_response", async ({ project, account, uid, folder }) => emailTools.emailDraftResponse(project, account, uid, folder)),
);

server.registerTool(
  "ingenium_email_patterns",
  {
    description: "List all learned email response patterns (skills with category 'email').",
    inputSchema: { project: projectParam },
  },
  wrapHandler("ingenium_email_patterns", async ({ project }) => emailTools.emailPatterns(project)),
);

server.registerTool(
  "ingenium_email_watch_start",
  {
    description: "Start IMAP IDLE watcher for real-time email monitoring and auto-drafting.",
    inputSchema: { project: projectParam, account: z.string() },
  },
  wrapHandler("ingenium_email_watch_start", async ({ project, account }) => emailTools.emailWatchStart(project, account)),
);

server.registerTool(
  "ingenium_email_watch_status",
  {
    description: "Check if the IMAP IDLE watcher is running for an account.",
    inputSchema: { project: projectParam, account: z.string() },
  },
  wrapHandler("ingenium_email_watch_status", async ({ project, account }) => emailTools.emailWatchStatus(project, account)),
);

// ── Start ───────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("ingenium-server MCP transport started on stdio");
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal error in MCP server");
  stopAll();
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down");
  stopAll();
  process.exit(0);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "Unhandled rejection");
  process.exit(1);
});
