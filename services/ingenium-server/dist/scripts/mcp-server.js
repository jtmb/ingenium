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
import * as learningTools from "../lib/tools/learnings.js";
import * as taskTools from "../lib/tools/tasks.js";
import * as contextTools from "../lib/tools/context.js";
import * as projectTools from "../lib/tools/projects.js";
import * as pluginTools from "../lib/tools/plugins.js";
import * as serverTools from "../lib/tools/servers.js";
/** Shared optional project parameter — defaults to "default" when omitted. */
const projectParam = z.string().optional().default("default");
const server = new McpServer({ name: config.mcpName, version: config.mcpVersion }, { capabilities: { tools: {}, resources: {} } });
// ── Skills ──────────────────────────────────────────────
server.registerTool("ingenium_skill_list", { description: "List all skills for a project.", inputSchema: { project: projectParam } }, async ({ project }) => skillTools.skillList(project));
server.registerTool("ingenium_skill_load", { description: "Load a single skill by name.", inputSchema: { project: projectParam, name: z.string() } }, async ({ project, name }) => skillTools.skillLoad(project, name));
server.registerTool("ingenium_skill_search", { description: "Full-text search across skills.", inputSchema: { project: projectParam, query: z.string() } }, async ({ project, query }) => skillTools.skillSearch(project, query));
server.registerTool("ingenium_skill_create", {
    description: "Create a new skill.",
    inputSchema: {
        project: projectParam,
        name: z.string(),
        description: z.string(),
        content: z.string(),
        category: z.string().optional(),
    },
}, async ({ project, name, description, content, category }) => skillTools.skillCreate(project, name, description, content, category));
server.registerTool("ingenium_skill_update", {
    description: "Update an existing skill's content.",
    inputSchema: { project: projectParam, name: z.string(), content: z.string() },
}, async ({ project, name, content }) => skillTools.skillUpdate(project, name, content));
// ── Learnings ───────────────────────────────────────────
server.registerTool("ingenium_learning_log", {
    description: "Log a new learning entry with optional tags, priority, and session association.",
    inputSchema: {
        project: projectParam,
        entry_type: z.string(),
        content: z.string(),
        tags: z.string().optional(),
        priority: z.number().optional(),
        session_id: z.string().optional(),
    },
}, async ({ project, entry_type, content, tags, priority, session_id }) => learningTools.learningLog(project, entry_type, content, tags, priority, session_id));
server.registerTool("ingenium_learning_search", { description: "Full-text search across learning entries.", inputSchema: { project: projectParam, query: z.string() } }, async ({ project, query }) => learningTools.learningSearch(project, query));
// ── Tasks ───────────────────────────────────────────────
server.registerTool("ingenium_task_create", {
    description: "Create a new task with optional description and assignee.",
    inputSchema: {
        project: projectParam,
        title: z.string(),
        description: z.string().optional(),
        assigned_to: z.string().optional(),
    },
}, async ({ project, title, description, assigned_to }) => taskTools.taskCreate(project, title, description, assigned_to));
server.registerTool("ingenium_task_list", {
    description: "List tasks, optionally filtered by column.",
    inputSchema: { project: projectParam, column_id: z.string().optional() },
}, async ({ project, column_id }) => taskTools.taskList(project, column_id));
server.registerTool("ingenium_task_move", {
    description: "Move a task to a different column.",
    inputSchema: { project: projectParam, task_id: z.string(), column_id: z.string() },
}, async ({ project, task_id, column_id }) => taskTools.taskMove(project, task_id, column_id));
server.registerTool("ingenium_task_complete", { description: "Mark a task as completed.", inputSchema: { project: projectParam, task_id: z.string() } }, async ({ project, task_id }) => taskTools.taskComplete(project, task_id));
server.registerTool("ingenium_task_next", { description: "Get the highest-priority next task to work on.", inputSchema: { project: projectParam } }, async ({ project }) => taskTools.taskNext(project));
// ── Context ─────────────────────────────────────────────
server.registerTool("ingenium_context_save", {
    description: "Save a context entry with optional tags and priority.",
    inputSchema: { project: projectParam, content: z.string(), tags: z.string().optional(), priority: z.number().optional() },
}, async ({ project, content, tags, priority }) => contextTools.contextSave(project, content, tags, priority));
server.registerTool("ingenium_context_search", { description: "Full-text search across context entries.", inputSchema: { project: projectParam, query: z.string() } }, async ({ project, query }) => contextTools.contextSearch(project, query));
// ── Projects ────────────────────────────────────────────
server.registerTool("ingenium_project_list", { description: "List all projects known to the Ingenium API.", inputSchema: {} }, async () => projectTools.projectList());
server.registerTool("ingenium_project_init", { description: "Initialise a new project on the Ingenium API.", inputSchema: { name: z.string() } }, async ({ name }) => projectTools.projectInit(name));
// ── Plugins ─────────────────────────────────────────────
server.registerTool("ingenium_plugin_list", { description: "List all plugins available for a project.", inputSchema: { project: projectParam } }, async ({ project }) => pluginTools.pluginList(project));
server.registerTool("ingenium_plugin_enable", { description: "Enable a plugin for a project.", inputSchema: { project: projectParam, name: z.string() } }, async ({ project, name }) => pluginTools.pluginEnable(project, name));
server.registerTool("ingenium_plugin_disable", { description: "Disable a plugin for a project.", inputSchema: { project: projectParam, name: z.string() } }, async ({ project, name }) => pluginTools.pluginDisable(project, name));
// ── Servers ─────────────────────────────────────────────
server.registerTool("ingenium_server_list", { description: "List all registered child MCP servers for a project.", inputSchema: { project: projectParam } }, async ({ project }) => serverTools.serverList(project));
server.registerTool("ingenium_server_add", {
    description: "Add a new child MCP server definition.",
    inputSchema: {
        project: projectParam,
        name: z.string(),
        command: z.string(),
        args: z.string().optional(),
        env: z.string().optional(),
    },
}, async ({ project, name, command, args, env }) => serverTools.serverAdd(project, name, command, args, env));
server.registerTool("ingenium_server_remove", {
    description: "Remove a child MCP server definition.",
    inputSchema: { project: projectParam, name: z.string() },
}, async ({ project, name }) => serverTools.serverRemove(project, name));
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
