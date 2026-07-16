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
import { settingGet, settingSet, settingTestLlm } from "../lib/tools/settings.js";
import * as commandTools from "../lib/tools/commands.js";
import * as agentTools from "../lib/tools/agents.js";
import * as observationTools from "../lib/tools/observations.js";
import * as personalityTools from "../lib/tools/personality.js";
import { synthesisRun, synthesisStatus, synthesisCrossProject } from "../lib/tools/synthesis.js";
import { extractionRun } from "../lib/tools/extraction.js";
import * as emailTools from "../lib/tools/emails.js";
import * as configTools from "../lib/tools/configs.js";
import * as logTools from "../lib/tools/logs.js";
import * as jobTools from "../lib/tools/jobs.js";
import * as pipelineTools from "../lib/tools/pipeline.js";
import * as statusTools from "../lib/tools/status.js";
import { healthCheck } from "../lib/tools/health.js";
import { opencodeMessages } from "../lib/tools/opencode.js";

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

/** Wraps a tool handler to check if the tool is enabled for the project before executing.
 *  For tools without a project parameter, defaults to "global-default" for state checking. */
function wrapHandler(toolName: string, handler: (args: any) => Promise<any>) {
  return async (args: any) => {
    const project = args?.project || "global-default";
    const enabled = await checkToolEnabled(toolName, project);
    if (!enabled) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          error: { code: "TOOL_DISABLED", message: `Tool '${toolName}' is disabled for this project` }
        }) }]
      };
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

server.registerTool(
  "ingenium_setting_test_llm",
  { description: "Test the configured synthesis LLM connection.", inputSchema: { project: projectParam } },
  wrapHandler("ingenium_setting_test_llm", async ({ project }) => settingTestLlm(project)),
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

server.registerTool(
  "ingenium_skill_consolidate",
  {
    description: "Trigger LLM-driven skill audit — merges redundant skills to maintain ≤20 total. Analyzes all enabled skills and proposes merges/deletes for overlapping topics.",
    inputSchema: { project: projectParam },
  },
  wrapHandler("ingenium_skill_consolidate", async ({ project }) => skillTools.skillConsolidate(project)),
);

server.registerTool(
  "ingenium_skill_sync_all",
  { description: "Sync ALL skills disk↔DB for a project.", inputSchema: { project: projectParam } },
  wrapHandler("ingenium_skill_sync_all", async ({ project }) => skillTools.skillSyncAll(project)),
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
    observationTools.observationStore(project, observation_type, content, importance, source, context)),
);

server.registerTool(
  "ingenium_observation_search",
  {
    description: "Full-text search across observations.",
    inputSchema: { project: projectParam, query: z.string() },
  },
  wrapHandler("ingenium_observation_search", async ({ project, query }) => observationTools.observationSearch(project, query)),
);

server.registerTool(
  "ingenium_observation_list",
  {
    description: "List observations with optional status and type filters.",
    inputSchema: { project: projectParam, status: z.string().optional(), type: z.string().optional() },
  },
  wrapHandler("ingenium_observation_list", async ({ project, status, type }) => observationTools.observationList(project, status, type)),
);

server.registerTool(
  "ingenium_observation_stats",
  {
    description: "Get observation pipeline statistics (total, pending, processed).",
    inputSchema: { project: projectParam },
  },
  wrapHandler("ingenium_observation_stats", async ({ project }) => observationTools.observationStats(project)),
);

server.registerTool(
  "ingenium_observation_get",
  { description: "Get a single observation by ID.", inputSchema: { project: projectParam, observation_id: z.number() } },
  wrapHandler("ingenium_observation_get", async ({ project, observation_id }) => observationTools.observationGet(project, observation_id)),
);

server.registerTool(
  "ingenium_observation_update",
  {
    description: "Update an observation (status, importance).",
    inputSchema: { project: projectParam, observation_id: z.number(), status: z.string().optional(), importance: z.number().optional() },
  },
  wrapHandler("ingenium_observation_update", async ({ project, observation_id, status, importance }) => observationTools.observationUpdate(project, observation_id, status, importance)),
);

server.registerTool(
  "ingenium_observation_enrich",
  {
    description: "Enrich raw observations via LLM.",
    inputSchema: { project: projectParam, observations: z.array(z.unknown()) },
  },
  wrapHandler("ingenium_observation_enrich", async ({ project, observations }) => observationTools.observationEnrich(project, observations)),
);

server.registerTool(
  "ingenium_observation_delete",
  { description: "Hard delete a single observation by ID.", inputSchema: { project: projectParam, observation_id: z.number() } },
  wrapHandler("ingenium_observation_delete", async ({ project, observation_id }) => observationTools.observationDelete(project, observation_id)),
);

server.registerTool(
  "ingenium_observation_delete_by_source",
  {
    description: "Bulk hard delete observations by source — requires confirm=true.",
    inputSchema: { project: projectParam, source: z.string(), confirm: z.boolean() },
  },
  wrapHandler("ingenium_observation_delete_by_source", async ({ project, source, confirm }) => observationTools.observationDeleteBySource(project, source, confirm)),
);

// ── Personality ───────────────────────────────────────────

server.registerTool(
  "ingenium_personality",
  {
    description: "Get the full learned personality profile — aggregated traits about user preferences, communication style, and behavior patterns.",
    inputSchema: { project: projectParam },
  },
  wrapHandler("ingenium_personality", async ({ project }) => personalityTools.personalityProfile(project)),
);

server.registerTool(
  "ingenium_personality_traits",
  {
    description: "List personality traits, optionally filtered by type.",
    inputSchema: { project: projectParam, trait_type: z.string().optional() },
  },
  wrapHandler("ingenium_personality_traits", async ({ project, trait_type }) => personalityTools.personalityTraits(project, trait_type)),
);

server.registerTool(
  "ingenium_personality_set_trait",
  {
    description: "Upsert a personality trait (used by synthesis pipeline).",
    inputSchema: {
      project: projectParam,
      trait_type: z.string(),
      trait_value: z.string(),
      display_label: z.string().optional(),
      confidence: z.number().optional(),
    },
  },
  wrapHandler("ingenium_personality_set_trait", async ({ project, trait_type, trait_value, display_label, confidence }) =>
    personalityTools.personalitySetTrait(project, trait_type, trait_value, display_label, confidence)),
);

server.registerTool(
  "ingenium_personality_trait_dismiss",
  { description: "Dismiss a trait (set as inactive without deleting).", inputSchema: { project: projectParam, trait_id: z.number() } },
  wrapHandler("ingenium_personality_trait_dismiss", async ({ project, trait_id }) => personalityTools.personalityTraitDismiss(project, trait_id)),
);

server.registerTool(
  "ingenium_personality_trait_disable",
  { description: "Disable a trait (harder deactivation).", inputSchema: { project: projectParam, trait_id: z.number() } },
  wrapHandler("ingenium_personality_trait_disable", async ({ project, trait_id }) => personalityTools.personalityTraitDisable(project, trait_id)),
);

server.registerTool(
  "ingenium_personality_trait_delete",
  { description: "Hard delete a single personality trait.", inputSchema: { project: projectParam, trait_id: z.number() } },
  wrapHandler("ingenium_personality_trait_delete", async ({ project, trait_id }) => personalityTools.personalityTraitDelete(project, trait_id)),
);

server.registerTool(
  "ingenium_personality_traits_delete_all",
  {
    description: "Hard delete ALL personality traits for the project — requires confirm=true.",
    inputSchema: { project: projectParam, confirm: z.boolean() },
  },
  wrapHandler("ingenium_personality_traits_delete_all", async ({ project, confirm }) => personalityTools.personalityTraitsDeleteAll(project, confirm)),
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

// ── Extraction ──────────────────────────────────────────

server.registerTool(
  "ingenium_extraction_run",
  {
    description: "Trigger LLM-based observation extraction — scans OpenCode messages since last watermark, pre-filters candidates via cheap regex, then uses the synthesis LLM to extract durable user behavior rules.",
    inputSchema: { project: projectParam },
  },
  wrapHandler("ingenium_extraction_run", async ({ project }) => extractionRun(project)),
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

server.registerTool(
  "ingenium_task_update",
  {
    description: "Update task fields (title, description, assigned_to, priority, etc.).",
    inputSchema: {
      project: projectParam,
      task_id: z.string(),
      fields: z.record(z.unknown()),
    },
  },
  wrapHandler("ingenium_task_update", async ({ project, task_id, fields }) =>
    taskTools.taskUpdate(project, task_id, fields)),
);

server.registerTool(
  "ingenium_task_delete",
  { description: "Delete a task by ID.", inputSchema: { project: projectParam, task_id: z.string() } },
  wrapHandler("ingenium_task_delete", async ({ project, task_id }) => taskTools.taskDelete(project, task_id)),
);

server.registerTool(
  "ingenium_task_search",
  {
    description: "Full-text search across tasks.",
    inputSchema: { project: projectParam, query: z.string(), limit: z.number().optional() },
  },
  wrapHandler("ingenium_task_search", async ({ project, query, limit }) => taskTools.taskSearch(project, query, limit)),
);

server.registerTool(
  "ingenium_task_comment",
  {
    description: "Add a comment to a task, optionally threaded under a parent comment.",
    inputSchema: {
      project: projectParam,
      task_id: z.string(),
      author: z.string(),
      body: z.string(),
      parent_comment_id: z.string().optional(),
    },
  },
  wrapHandler("ingenium_task_comment", async ({ project, task_id, author, body, parent_comment_id }) =>
    taskTools.taskComment(project, task_id, author, body, parent_comment_id)),
);

server.registerTool(
  "ingenium_task_activity",
  {
    description: "Get activity feed for a task.",
    inputSchema: { project: projectParam, task_id: z.string(), limit: z.number().optional() },
  },
  wrapHandler("ingenium_task_activity", async ({ project, task_id, limit }) => taskTools.taskActivity(project, task_id, limit)),
);

server.registerTool(
  "ingenium_task_link",
  {
    description: "Link two tasks together (blocks, relates_to, duplicates).",
    inputSchema: {
      project: projectParam,
      task_id: z.string(),
      linked_task_id: z.string(),
      link_type: z.string(),
    },
  },
  wrapHandler("ingenium_task_link", async ({ project, task_id, linked_task_id, link_type }) =>
    taskTools.taskLink(project, task_id, linked_task_id, link_type)),
);

server.registerTool(
  "ingenium_task_board_config_get",
  {
    description: "Get board configuration (columns and custom field definitions).",
    inputSchema: { project: projectParam },
  },
  wrapHandler("ingenium_task_board_config_get", async ({ project }) => taskTools.taskBoardConfigGet(project)),
);

server.registerTool(
  "ingenium_task_board_config_set",
  {
    description: "Set board configuration (columns and/or custom field definitions).",
    inputSchema: {
      project: projectParam,
      columns: z.array(z.unknown()).optional(),
      custom_field_defs: z.array(z.unknown()).optional(),
    },
  },
  wrapHandler("ingenium_task_board_config_set", async ({ project, columns, custom_field_defs }) =>
    taskTools.taskBoardConfigSet(project, columns, custom_field_defs)),
);

server.registerTool(
  "ingenium_task_subtask_create",
  {
    description: "Create a subtask under an existing parent task.",
    inputSchema: {
      project: projectParam,
      parent_id: z.string(),
      title: z.string(),
      description: z.string().optional(),
      assigned_to: z.string().optional(),
    },
  },
  wrapHandler("ingenium_task_subtask_create", async ({ project, parent_id, title, description, assigned_to }) =>
    taskTools.taskSubtaskCreate(project, parent_id, title, description, assigned_to)),
);

server.registerTool(
  "ingenium_task_notifications",
  {
    description: "List task notifications for a recipient, optionally filtered by unread status.",
    inputSchema: {
      project: projectParam,
      recipient: z.string(),
      unread: z.boolean().optional(),
    },
  },
  wrapHandler("ingenium_task_notifications", async ({ project, recipient, unread }) =>
    taskTools.taskNotifications(project, recipient, unread)),
);

server.registerTool(
  "ingenium_task_get",
  { description: "Get a single task by ID.", inputSchema: { project: projectParam, task_id: z.string() } },
  wrapHandler("ingenium_task_get", async ({ project, task_id }) => taskTools.taskGet(project, task_id)),
);

server.registerTool(
  "ingenium_task_comments_list",
  { description: "List comments for a task.", inputSchema: { project: projectParam, task_id: z.string() } },
  wrapHandler("ingenium_task_comments_list", async ({ project, task_id }) => taskTools.taskCommentsList(project, task_id)),
);

server.registerTool(
  "ingenium_task_comment_edit",
  {
    description: "Edit an existing comment on a task.",
    inputSchema: {
      project: projectParam,
      task_id: z.string(),
      comment_id: z.string(),
      body: z.string(),
      actor: z.string().optional(),
    },
  },
  wrapHandler("ingenium_task_comment_edit", async ({ project, task_id, comment_id, body, actor }) =>
    taskTools.taskCommentEdit(project, task_id, comment_id, body, actor)),
);

server.registerTool(
  "ingenium_task_comment_react",
  {
    description: "Add a reaction to a task comment.",
    inputSchema: {
      project: projectParam,
      task_id: z.string(),
      comment_id: z.string(),
      reaction: z.string(),
      actor: z.string(),
    },
  },
  wrapHandler("ingenium_task_comment_react", async ({ project, task_id, comment_id, reaction, actor }) =>
    taskTools.taskCommentReact(project, task_id, comment_id, reaction, actor)),
);

server.registerTool(
  "ingenium_task_links_list",
  { description: "List task links (blocks, relates_to, duplicates).", inputSchema: { project: projectParam, task_id: z.string() } },
  wrapHandler("ingenium_task_links_list", async ({ project, task_id }) => taskTools.taskLinksList(project, task_id)),
);

server.registerTool(
  "ingenium_task_link_delete",
  {
    description: "Delete a task link by ID.",
    inputSchema: { project: projectParam, task_id: z.string(), link_id: z.string(), actor: z.string().optional() },
  },
  wrapHandler("ingenium_task_link_delete", async ({ project, task_id, link_id, actor }) => taskTools.taskLinkDelete(project, task_id, link_id, actor)),
);

server.registerTool(
  "ingenium_task_tree",
  { description: "Get the full task tree (parent + subtasks + linked tasks).", inputSchema: { project: projectParam, task_id: z.string() } },
  wrapHandler("ingenium_task_tree", async ({ project, task_id }) => taskTools.taskTree(project, task_id)),
);

server.registerTool(
  "ingenium_task_notification_read",
  { description: "Mark a notification as read.", inputSchema: { project: projectParam, notification_id: z.string() } },
  wrapHandler("ingenium_task_notification_read", async ({ project, notification_id }) => taskTools.taskNotificationRead(project, notification_id)),
);

server.registerTool(
  "ingenium_task_bulk_update",
  {
    description: "Bulk update multiple tasks with the same fields.",
    inputSchema: {
      project: projectParam,
      task_ids: z.array(z.string()),
      fields: z.record(z.unknown()),
    },
  },
  wrapHandler("ingenium_task_bulk_update", async ({ project, task_ids, fields }) => taskTools.taskBulkUpdate(project, task_ids, fields)),
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
  wrapHandler("ingenium_plan_list", async ({ project }) => contextTools.planList(project)),
);

// ── Projects ────────────────────────────────────────────

server.registerTool(
  "ingenium_project_list",
  { description: "List all projects known to the Ingenium API.", inputSchema: {} },
  wrapHandler("ingenium_project_list", async () => projectTools.projectList()),
);

server.registerTool(
  "ingenium_project_init",
  { description: "Initialise a new project on the Ingenium API.", inputSchema: { name: z.string(), isGlobal: z.boolean().optional() } },
  wrapHandler("ingenium_project_init", async ({ name, isGlobal }) => projectTools.projectInit(name, isGlobal)),
);

server.registerTool(
  "ingenium_project_delete",
  { description: "Delete a project by name.", inputSchema: { name: z.string() } },
  wrapHandler("ingenium_project_delete", async ({ name }) => projectTools.projectDelete(name)),
);

server.registerTool(
  "ingenium_project_restore",
  { description: "Restore an archived project.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_project_restore", async ({ project, name }) => projectTools.projectRestore(project, name)),
);

server.registerTool(
  "ingenium_project_list_archived",
  { description: "List archived projects.", inputSchema: { project: projectParam } },
  wrapHandler("ingenium_project_list_archived", async ({ project }) => projectTools.projectListArchived(project)),
);

server.registerTool(
  "ingenium_project_purge",
  { description: "Purge old projects.", inputSchema: { project: projectParam, retentionDays: z.number().optional() } },
  wrapHandler("ingenium_project_purge", async ({ project, retentionDays }) => projectTools.projectPurge(project, retentionDays)),
);

server.registerTool(
  "ingenium_project_set_global",
  { description: "Mark a project as global (or unmark).", inputSchema: { project: projectParam, name: z.string(), isGlobal: z.boolean() } },
  wrapHandler("ingenium_project_set_global", async ({ project, name, isGlobal }) => projectTools.projectSetGlobal(project, name, isGlobal)),
);

server.registerTool(
  "ingenium_project_rename",
  {
    description: "Rename an existing project.",
    inputSchema: { project: projectParam, name: z.string(), newName: z.string() },
  },
  wrapHandler("ingenium_project_rename", async ({ project, name, newName }) => projectTools.projectRename(project, name, newName)),
);

server.registerTool(
  "ingenium_project_detail",
  { description: "Get detailed info about a project by name.", inputSchema: { name: z.string() } },
  wrapHandler("ingenium_project_detail", async ({ name }) => projectTools.projectDetail(name)),
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
  wrapHandler("ingenium_plugin_get", async ({ project, name }) => pluginTools.pluginGet(project, name)),
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

server.registerTool(
  "ingenium_plugin_source",
  { description: "Get a plugin's source content from disk.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_plugin_source", async ({ project, name }) => pluginTools.pluginSource(project, name)),
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
  wrapHandler("ingenium_command_get", async ({ project, name }) => commandTools.commandGet(project, name)),
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

server.registerTool(
  "ingenium_server_update",
  {
    description: "Update a server's running state.",
    inputSchema: { project: projectParam, name: z.string(), running: z.boolean() },
  },
  wrapHandler("ingenium_server_update", async ({ project, name, running }) => serverTools.serverUpdate(project, name, running)),
);

server.registerTool(
  "ingenium_server_sync_all",
  {
    description: "Sync all servers — upserts an array of server definitions for a project.",
    inputSchema: { project: projectParam, servers: z.array(z.unknown()) },
  },
  wrapHandler("ingenium_server_sync_all", async ({ project, servers }) => serverTools.serverSyncAll(project, servers)),
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

// ── Logs ──────────────────────────────────────────────

server.registerTool(
  "ingenium_logs_list",
  {
    description: "List recent system log entries from the unified logger. Filter by source, level, or time.",
    inputSchema: {
      project: projectParam,
      source: z.string().optional(),
      level: z.string().optional(),
      since: z.string().optional(),
      limit: z.number().optional(),
    },
  },
  wrapHandler("ingenium_logs_list", async ({ project, source, level, since, limit }) =>
    logTools.logsList(project, source, level, since, limit)),
);

server.registerTool(
  "ingenium_logs_sources",
  {
    description: "List active log sources (e.g., scheduler, api, auto-observer).",
    inputSchema: { project: projectParam },
  },
  wrapHandler("ingenium_logs_sources", async ({ project }) =>
    logTools.logsSources(project)),
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

server.registerTool(
  "ingenium_email_account_create",
  {
    description: "Create a new email account connection.",
    inputSchema: {
      project: projectParam,
      email: z.string(),
      provider: z.string(),
      authType: z.string(),
      name: z.string().optional(),
      appPassword: z.string().optional(),
      imapHost: z.string().optional(),
      smtpHost: z.string().optional(),
      imapPort: z.number().optional(),
      smtpPort: z.number().optional(),
    },
  },
  wrapHandler("ingenium_email_account_create", async (args) =>
    emailTools.emailAccountCreate(args.project, args.email, args.provider, args.authType, args.name, args.appPassword, args.imapHost, args.smtpHost, args.imapPort, args.smtpPort)),
);

server.registerTool(
  "ingenium_email_account_delete",
  { description: "Delete an email account and clear its cached data.", inputSchema: { project: projectParam, account: z.string() } },
  wrapHandler("ingenium_email_account_delete", async ({ project, account }) => emailTools.emailAccountDelete(project, account)),
);

server.registerTool(
  "ingenium_email_account_test",
  { description: "Test IMAP connection for an account.", inputSchema: { project: projectParam, account: z.string() } },
  wrapHandler("ingenium_email_account_test", async ({ project, account }) => emailTools.emailAccountTest(project, account)),
);

server.registerTool(
  "ingenium_email_oauth_url",
  { description: "Get OAuth authorization URL — never returns tokens, only the URL.", inputSchema: { project: projectParam, provider: z.string() } },
  wrapHandler("ingenium_email_oauth_url", async ({ project, provider }) => emailTools.emailOauthUrl(project, provider)),
);

server.registerTool(
  "ingenium_email_oauth_exchange",
  {
    description: "Exchange OAuth code for tokens — never returns tokens, only success/failure.",
    inputSchema: {
      project: projectParam,
      provider: z.string(),
      code: z.string(),
      state: z.string(),
      redirectUri: z.string().optional(),
      accountId: z.string().optional(),
    },
  },
  wrapHandler("ingenium_email_oauth_exchange", async ({ project, provider, code, state, redirectUri, accountId }) =>
    emailTools.emailOauthExchange(project, provider, code, state, redirectUri, accountId)),
);

server.registerTool(
  "ingenium_email_summarize",
  {
    description: "Get LLM-generated email summary (cache-first).",
    inputSchema: { project: projectParam, account: z.string(), uid: z.number(), folder: z.string().optional() },
  },
  wrapHandler("ingenium_email_summarize", async ({ project, account, uid, folder }) => emailTools.emailSummarize(project, account, uid, folder)),
);

server.registerTool(
  "ingenium_email_review_draft",
  {
    description: "LLM-powered draft review and improvement.",
    inputSchema: { project: projectParam, text: z.string(), subject: z.string().optional() },
  },
  wrapHandler("ingenium_email_review_draft", async ({ project, text, subject }) => emailTools.emailReviewDraft(project, text, subject)),
);

server.registerTool(
  "ingenium_email_move",
  {
    description: "Move an email to another folder.",
    inputSchema: { project: projectParam, account: z.string(), uid: z.number(), fromFolder: z.string(), toFolder: z.string() },
  },
  wrapHandler("ingenium_email_move", async ({ project, account, uid, fromFolder, toFolder }) => emailTools.emailMove(project, account, uid, fromFolder, toFolder)),
);

server.registerTool(
  "ingenium_email_set_flags",
  {
    description: "Set flags on an email.",
    inputSchema: { project: projectParam, account: z.string(), uid: z.number(), folder: z.string(), flags: z.array(z.string()) },
  },
  wrapHandler("ingenium_email_set_flags", async ({ project, account, uid, folder, flags }) => emailTools.emailSetFlags(project, account, uid, folder, flags)),
);

server.registerTool(
  "ingenium_email_delete",
  {
    description: "Delete an email (moves to Trash via IMAP).",
    inputSchema: { project: projectParam, account: z.string(), uid: z.number(), folder: z.string().optional() },
  },
  wrapHandler("ingenium_email_delete", async ({ project, account, uid, folder }) => emailTools.emailDelete(project, account, uid, folder)),
);

server.registerTool(
  "ingenium_email_sync",
  {
    description: "Trigger engine-backed sync hint.",
    inputSchema: { project: projectParam, account: z.string(), folder: z.string().optional() },
  },
  wrapHandler("ingenium_email_sync", async ({ project, account, folder }) => emailTools.emailSync(project, account, folder)),
);

server.registerTool(
  "ingenium_email_sync_status",
  { description: "Get per-folder sync status from the engine.", inputSchema: { project: projectParam, account: z.string() } },
  wrapHandler("ingenium_email_sync_status", async ({ project, account }) => emailTools.emailSyncStatus(project, account)),
);

server.registerTool(
  "ingenium_email_watch_stop",
  { description: "Stop IMAP IDLE watcher.", inputSchema: { project: projectParam, account: z.string() } },
  wrapHandler("ingenium_email_watch_stop", async ({ project, account }) => emailTools.emailWatchStop(project, account)),
);

server.registerTool(
  "ingenium_email_attachment_get",
  {
    description: "Download an email attachment and write it to a validated path — never returns raw binary.",
    inputSchema: {
      project: projectParam,
      account: z.string(),
      uid: z.number(),
      attachmentId: z.string(),
      folder: z.string().optional(),
      outputPath: z.string().optional(),
    },
  },
  wrapHandler("ingenium_email_attachment_get", async ({ project, account, uid, attachmentId, folder, outputPath }) =>
    emailTools.emailAttachmentGet(project, account, uid, attachmentId, folder, outputPath)),
);

// ── Jobs ──────────────────────────────────────────────

server.registerTool(
  "ingenium_job_list",
  { description: "List all jobs for a project.", inputSchema: { project: projectParam } },
  wrapHandler("ingenium_job_list", async ({ project }) => jobTools.jobList(project)),
);

server.registerTool(
  "ingenium_job_create",
  {
    description: "Create a new job with optional schedule, trigger event, and timeout.",
    inputSchema: {
      project: projectParam,
      name: z.string(),
      description: z.string().optional(),
      agent: z.string(),
      prompt_template: z.string(),
      schedule_cron: z.string().optional(),
      trigger_event: z.string().optional(),
      timeout_minutes: z.number().optional(),
    },
  },
    wrapHandler("ingenium_job_create", async ({ project, name, description, agent, prompt_template, schedule_cron, trigger_event, timeout_minutes }) =>
    jobTools.jobCreate(project, name, description, agent, prompt_template, schedule_cron, trigger_event, timeout_minutes)),
);

server.registerTool(
  "ingenium_job_update",
  {
    description: "Update existing job fields (name, description, agent, prompt_template, schedule_cron, trigger_event, enabled, timeout_minutes).",
    inputSchema: {
      project: projectParam,
      job_id: z.string(),
      fields: z.record(z.unknown()),
    },
  },
  wrapHandler("ingenium_job_update", async ({ project, job_id, fields }) =>
    jobTools.jobUpdate(project, job_id, fields)),
);

server.registerTool(
  "ingenium_job_delete",
  { description: "Delete a job by ID.", inputSchema: { project: projectParam, job_id: z.string() } },
  wrapHandler("ingenium_job_delete", async ({ project, job_id }) => jobTools.jobDelete(project, job_id)),
);

server.registerTool(
  "ingenium_job_run",
  { description: "Manually trigger a job run.", inputSchema: { project: projectParam, job_id: z.string() } },
  wrapHandler("ingenium_job_run", async ({ project, job_id }) => jobTools.jobRun(project, job_id)),
);

server.registerTool(
  "ingenium_job_runs",
  { description: "List all runs for a job.", inputSchema: { project: projectParam, job_id: z.string() } },
  wrapHandler("ingenium_job_runs", async ({ project, job_id }) => jobTools.jobRuns(project, job_id)),
);

server.registerTool(
  "ingenium_job_run_logs",
  {
    description: "Get log entries for a specific run, optionally after a sequence number for tail polling.",
    inputSchema: { project: projectParam, run_id: z.string(), after: z.number().optional() },
  },
  wrapHandler("ingenium_job_run_logs", async ({ project, run_id, after }) => jobTools.jobRunLogs(project, run_id, after)),
);

server.registerTool(
  "ingenium_job_run_cancel",
  { description: "Cancel a running job.", inputSchema: { project: projectParam, run_id: z.string() } },
  wrapHandler("ingenium_job_run_cancel", async ({ project, run_id }) => jobTools.jobRunCancel(project, run_id)),
);

server.registerTool(
  "ingenium_job_get",
  { description: "Get a single job by ID.", inputSchema: { project: projectParam, job_id: z.string() } },
  wrapHandler("ingenium_job_get", async ({ project, job_id }) => jobTools.jobGet(project, job_id)),
);

server.registerTool(
  "ingenium_job_suggest",
  {
    description: "Get LLM-generated job suggestions based on a natural-language description.",
    inputSchema: { project: projectParam, description: z.string() },
  },
  wrapHandler("ingenium_job_suggest", async ({ project, description }) => jobTools.jobSuggest(project, description)),
);

// ── Pipeline ───────────────────────────────────────────

server.registerTool(
  "ingenium_pipeline_events",
  {
    description: "List pipeline events with optional filters (source, type, limit, since).",
    inputSchema: {
      project: projectParam,
      source: z.string().optional(),
      type: z.string().optional(),
      limit: z.number().optional(),
      since: z.string().optional(),
    },
  },
  wrapHandler("ingenium_pipeline_events", async ({ project, source, type, limit, since }) =>
    pipelineTools.pipelineEvents(project, source, type, limit, since)),
);

server.registerTool(
  "ingenium_pipeline_timeline",
  {
    description: "Get grouped timeline with children nested in parents.",
    inputSchema: {
      project: projectParam,
      source: z.string().optional(),
      limit: z.number().optional(),
      since: z.string().optional(),
    },
  },
  wrapHandler("ingenium_pipeline_timeline", async ({ project, source, limit, since }) =>
    pipelineTools.pipelineTimeline(project, source, limit, since)),
);

server.registerTool(
  "ingenium_pipeline_event_log",
  {
    description: "Log a new pipeline event for observability.",
    inputSchema: {
      project: projectParam,
      eventType: z.string(),
      eventSource: z.string(),
      title: z.string(),
      description: z.string().optional(),
      data: z.unknown().optional(),
      parentEventId: z.number().optional(),
      sessionId: z.string().optional(),
      importance: z.number().optional(),
    },
  },
  wrapHandler("ingenium_pipeline_event_log", async (args) =>
    pipelineTools.pipelineEventLog(args.project, args.eventType, args.eventSource, args.title, args.description, args.data as object | undefined, args.parentEventId, args.sessionId, args.importance)),
);

// ── Status ─────────────────────────────────────────────

server.registerTool(
  "ingenium_service_status",
  { description: "Get overall service health — supervisord process states + application health.", inputSchema: { project: projectParam } },
  wrapHandler("ingenium_service_status", async ({ project }) => statusTools.serviceStatus(project)),
);

server.registerTool(
  "ingenium_service_application_detail",
  {
    description: "Get detailed status for a specific application (email-client or synthesis-engine).",
    inputSchema: { project: projectParam, name: z.string() },
  },
  wrapHandler("ingenium_service_application_detail", async ({ project, name }) => statusTools.serviceApplicationDetail(project, name)),
);

server.registerTool(
  "ingenium_service_process_detail",
  { description: "Get single process detail via supervisor.getProcessInfo.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler("ingenium_service_process_detail", async ({ project, name }) => statusTools.serviceProcessDetail(project, name)),
);

server.registerTool(
  "ingenium_service_process_logs",
  {
    description: "Read process logs with byte-size cap (max 10000 bytes).",
    inputSchema: {
      project: projectParam,
      name: z.string(),
      offset: z.number().optional(),
      limit: z.number().optional(),
    },
  },
  wrapHandler("ingenium_service_process_logs", async ({ project, name, offset, limit }) =>
    statusTools.serviceProcessLogs(project, name, offset, limit)),
);

// ── Health ─────────────────────────────────────────────

server.registerTool(
  "ingenium_health_check",
  { description: "API health check — returns status and uptime. No project param needed.", inputSchema: {} },
  wrapHandler("ingenium_health_check", async () => healthCheck()),
);

// ── OpenCode ───────────────────────────────────────────

server.registerTool(
  "ingenium_opencode_messages",
  {
    description: "Read recent user messages from the OpenCode DB (used by the extraction engine).",
    inputSchema: { project: projectParam, limit: z.number().optional(), offset: z.number().optional() },
  },
  wrapHandler("ingenium_opencode_messages", async ({ project, limit, offset }) => opencodeMessages(project, limit, offset)),
);

// ── Dashboard ──────────────────────────────────────────

server.registerTool(
  "ingenium_dashboard_summary",
  {
    description: "Get aggregated dashboard summary — learning stats, task counts, job counts, and mail status.",
    inputSchema: { project: projectParam },
  },
  wrapHandler("ingenium_dashboard_summary", async ({ project }) => {
    const apiBase = config.apiUrl.endsWith("/") ? config.apiUrl : config.apiUrl + "/";
    const url = new URL("dashboard/summary", apiBase);
    url.searchParams.set("project", project);
    const res = await fetch(url.toString());
    const data = await res.json();
    return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
  }),
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
