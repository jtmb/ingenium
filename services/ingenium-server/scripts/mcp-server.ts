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
import * as docsTools from "../lib/tools/docs.js";
import * as ragTools from "../lib/tools/rag.js";
import * as providerTools from "../lib/tools/providers.js";
import * as vaultTools from "../lib/tools/vault.js";
import * as backupTools from "../lib/tools/backups.js";

// ── Tool State Check Wrapper ──────────────────────────────
// NOTE: Duplicates config.apiUrl because this is evaluated at module load time before config is imported.
const API_CLIENT = process.env.INGENIUM_API_URL ?? "http://localhost:4097/api/v1";

/**
 * Checks whether a tool is enabled for the given project via the API.
 * Fail-open on error (network blip, API down) — a disabled tool is a nuisance,
 * but a false-negative blocks the user's workflow entirely.
 */
async function checkToolEnabled(toolName: string, project: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_CLIENT}/mcp-tools/${encodeURIComponent(toolName)}/state?project=${encodeURIComponent(project)}`);
    if (!res.ok) return true;
    const data = await res.json();
    return data.data?.enabled !== false;
  } catch {
    return true;
  }
}

/**
 * Wraps a tool handler to check if the tool is enabled for the project before executing.
 * For tools without a project parameter, defaults to "global-default" for state checking.
 * This is the gateway through which ALL tool invocations flow — the enable/disable toggle
 * in the dashboard is enforced here, not in individual tool handlers.
 */
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

/**
 * Prefix for internal catalog lookup. Transport names are unprefixed;
 * this maps transport name → canonical catalog name (ingenium_XXX).
 * E.g., C("skill_create") → "ingenium_skill_create".
 */
const C = (name: string) => `ingenium_${name}`;

/**
 * Shared required project parameter for all project-scoped tools.
 * Projects are NOT auto-created on first use — they must be created explicitly
 * via ingenium_project_init or the dashboard. "global-default" is the singleton
 * global project created at container startup (see docker-entrypoint.sh).
 */
const projectParam = z.string();

const server = new McpServer(
  { name: config.mcpName, version: config.mcpVersion },
  { capabilities: { tools: {}, resources: {} } },
);

// ── Settings ─────────────────────────────────────────────

server.registerTool(
  "setting_get",
  { description: "Get a setting value by key", inputSchema: { project: projectParam, key: z.string() } },
  wrapHandler(C("setting_get"), async ({ project, key }) => settingGet(project, key)),
);

server.registerTool(
  "setting_set",
  { description: "Set a setting value", inputSchema: { project: projectParam, key: z.string(), value: z.string() } },
  wrapHandler(C("setting_set"), async ({ project, key, value }) => settingSet(project, key, value)),
);

server.registerTool(
  "setting_test_llm",
  { description: "Test the configured synthesis LLM connection.", inputSchema: { project: projectParam } },
  wrapHandler(C("setting_test_llm"), async ({ project }) => settingTestLlm(project)),
);

// ── Skills ──────────────────────────────────────────────

server.registerTool(
  "skill_list",
  { description: "List all skills for a project.", inputSchema: { project: projectParam } },
  wrapHandler(C("skill_list"), async ({ project }) => skillTools.skillList(project)),
);

server.registerTool(
  "skill_load",
  { description: "Load a single skill by name.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler(C("skill_load"), async ({ project, name }) => skillTools.skillLoad(project, name)),
);

server.registerTool(
  "skill_search",
  { description: "Full-text search across skills.", inputSchema: { project: projectParam, query: z.string() } },
  wrapHandler(C("skill_search"), async ({ project, query }) => skillTools.skillSearch(project, query)),
);

server.registerTool(
  "skill_create",
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
    wrapHandler(C("skill_create"), async ({ project, name, description, content, category, tags, always_apply, files }) =>
    skillTools.skillCreate(project, name, description, content, category, tags, always_apply, files)),
);

server.registerTool(
  "skill_update",
  {
    description: "Update an existing skill's content.",
    inputSchema: { project: projectParam, name: z.string(), content: z.string(), description: z.string().optional(), tags: z.string().optional(), always_apply: z.number().optional(), files: z.string().optional() },
  },
  wrapHandler(C("skill_update"), async ({ project, name, content, description, tags, always_apply, files }) => skillTools.skillUpdate(project, name, content, description, tags, always_apply, files)),
);

server.registerTool(
  "skill_delete",
  { description: "Delete a skill by name (archive-only semantics — soft-deletes to archived state, not permanent removal).", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler(C("skill_delete"), async ({ project, name }) => skillTools.skillDelete(project, name)),
);

server.registerTool(
  "skill_enable",
  { description: "Enable a skill and sync to disk.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler(C("skill_enable"), async ({ project, name }) => skillTools.skillEnable(project, name)),
);

server.registerTool(
  "skill_disable",
  { description: "Disable a skill and remove from disk.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler(C("skill_disable"), async ({ project, name }) => skillTools.skillDisable(project, name)),
);

server.registerTool(
  "skill_sync",
  { description: "Sync a skill from its .md file on disk to the DB — edits made directly to the file are persisted.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler(C("skill_sync"), async ({ project, name }) => skillTools.skillSync(project, name)),
);

server.registerTool(
  "skill_consolidate",
  {
    description: "Trigger LLM-driven skill audit — merges redundant skills to maintain ≤20 total. Analyzes all enabled skills and proposes merges/deletes for overlapping topics.",
    inputSchema: { project: projectParam },
  },
  wrapHandler(C("skill_consolidate"), async ({ project }) => skillTools.skillConsolidate(project)),
);

server.registerTool(
  "skill_sync_all",
  {
    description:
      "Sync ALL skills disk→DB for a project. Returns per-skill status (created/updated/unchanged/skipped_archived/error). Use ?write_to_disk=true to also push DB skills back to disk.",
    inputSchema: { project: projectParam },
  },
  wrapHandler(C("skill_sync_all"), async ({ project }) => skillTools.skillSyncAll(project)),
);

server.registerTool(
  "skill_sync_all_preview",
  {
    description:
      "Preview what sync-all would change without modifying anything. Returns lists of skills that would be created, updated, or skipped.",
    inputSchema: { project: projectParam },
  },
  wrapHandler(C("skill_sync_all_preview"), async ({ project }) => skillTools.skillSyncAllPreview(project)),
);

// ── Skills Governance (14) ─────────────────────────────────

server.registerTool(
  "skill_archive",
  {
    description: "Archive a skill (soft-delete — moves to archived state, not permanent removal).",
    inputSchema: { project: projectParam, name: z.string() },
  },
  wrapHandler(C("skill_archive"), async ({ project, name }) => skillTools.skillArchive(project, name)),
);

server.registerTool(
  "skill_restore",
  {
    description: "Restore a previously archived skill.",
    inputSchema: { project: projectParam, name: z.string() },
  },
  wrapHandler(C("skill_restore"), async ({ project, name }) => skillTools.skillRestore(project, name)),
);

server.registerTool(
  "skill_list_archived",
  {
    description: "List all archived skills for a project.",
    inputSchema: { project: projectParam },
  },
  wrapHandler(C("skill_list_archived"), async ({ project }) => skillTools.skillListArchived(project)),
);

server.registerTool(
  "skill_versions",
  {
    description: "Get version history for a skill.",
    inputSchema: { project: projectParam, name: z.string() },
  },
  wrapHandler(C("skill_versions"), async ({ project, name }) => skillTools.skillVersions(project, name)),
);

server.registerTool(
  "skill_rollback",
  {
    description: "Rollback a skill to a specific revision.",
    inputSchema: { project: projectParam, name: z.string(), revision: z.number().int().min(0) },
  },
  wrapHandler(C("skill_rollback"), async ({ project, name, revision }) => skillTools.skillRollback(project, name, revision)),
);

server.registerTool(
  "skill_lineage_create",
  {
    description: "Create a skill provenance lineage relationship linking a source skill to a target.",
    inputSchema: {
      project: projectParam,
      sourceProjectId: z.string(),
      sourceName: z.string(),
      targetSkillId: z.string().uuid(),
      sourceHash: z.string().optional(),
      mergedFilePaths: z.array(z.string()).optional(),
      tombstonePath: z.string().optional(),
      reason: z.string().optional(),
    },
  },
  wrapHandler(C("skill_lineage_create"), async (args) =>
    skillTools.skillLineageCreate(
      args.project, args.sourceProjectId, args.sourceName, args.targetSkillId,
      args.sourceHash, args.mergedFilePaths, args.tombstonePath, args.reason)),
);

server.registerTool(
  "skill_lineage_list",
  {
    description: "List provenance lineage relationships for a skill (source and target entries).",
    inputSchema: { project: projectParam, name: z.string() },
  },
  wrapHandler(C("skill_lineage_list"), async ({ project, name }) => skillTools.skillLineageList(project, name)),
);

server.registerTool(
  "skill_proposal_create",
  {
    description: "Create a new skill governance proposal (type: create/update/merge/archive).",
    inputSchema: {
      project: projectParam,
      proposalType: z.enum(["create", "update", "merge", "archive"]),
      targetName: z.string(),
      proposedState: z.object({
        description: z.string().optional(),
        content: z.string().optional(),
        category: z.string().optional(),
        tags: z.string().optional(),
        alwaysApply: z.number().int().min(0).max(1).optional(),
        fileTree: z.union([z.record(z.string(), z.string()), z.string()]).optional(),
      }).strict(),
      sourceProjectId: z.string().optional(),
      sourceName: z.string().optional(),
      expectedRevision: z.number().int().min(0).optional(),
      evidence: z.array(z.unknown()).optional(),
      observationIds: z.array(z.number()).optional(),
      qualityScore: z.number().min(0).max(1).optional(),
      noveltyScore: z.number().min(0).max(1).optional(),
      contradictionFlag: z.boolean().optional(),
      candidateGroupKey: z.string().optional(),
      alwaysApply: z.number().int().min(0).max(1).optional(),
      targetSkillId: z.string().uuid().optional(),
    },
  },
  wrapHandler(C("skill_proposal_create"), async (args) =>
    skillTools.skillProposalCreate(
      args.project, args.proposalType, args.targetName,
      args.proposedState as skillTools.ProposalProposedState,
      args.sourceProjectId, args.sourceName, args.expectedRevision, args.evidence,
      args.observationIds, args.qualityScore, args.noveltyScore,
      args.contradictionFlag, args.candidateGroupKey,
      args.alwaysApply, args.targetSkillId)),
);

server.registerTool(
  "skill_proposal_list",
  {
    description: "List all skill proposals for a project, optionally filtered by status (draft/pending/rejected/applied/rolled_back/stale).",
    inputSchema: { project: projectParam, status: z.enum(["draft", "pending", "rejected", "applied", "rolled_back", "stale"]).optional() },
  },
  wrapHandler(C("skill_proposal_list"), async ({ project, status }) => skillTools.skillProposalList(project, status)),
);

server.registerTool(
  "skill_proposal_get",
  {
    description: "Get a single skill proposal by ID (UUID).",
    inputSchema: { project: projectParam, proposalId: z.string().uuid() },
  },
  wrapHandler(C("skill_proposal_get"), async ({ project, proposalId }) => skillTools.skillProposalGet(project, proposalId)),
);

server.registerTool(
  "skill_proposal_submit",
  {
    description: "Submit a proposal for review (transitions from draft to pending).",
    inputSchema: { project: projectParam, proposalId: z.string().uuid() },
  },
  wrapHandler(C("skill_proposal_submit"), async ({ project, proposalId }) => skillTools.skillProposalSubmit(project, proposalId)),
);

server.registerTool(
  "skill_proposal_approve",
  {
    description: "Approve a pending proposal. Reviewer is required; reason is optional.",
    inputSchema: { project: projectParam, proposalId: z.string().uuid(), reviewer: z.string(), reason: z.string().optional() },
  },
  wrapHandler(C("skill_proposal_approve"), async ({ project, proposalId, reviewer, reason }) =>
    skillTools.skillProposalApprove(project, proposalId, reviewer, reason)),
);

server.registerTool(
  "skill_proposal_reject",
  {
    description: "Reject a pending proposal. Reviewer is required; reason is optional.",
    inputSchema: { project: projectParam, proposalId: z.string().uuid(), reviewer: z.string(), reason: z.string().optional() },
  },
  wrapHandler(C("skill_proposal_reject"), async ({ project, proposalId, reviewer, reason }) =>
    skillTools.skillProposalReject(project, proposalId, reviewer, reason)),
);

server.registerTool(
  "skill_proposal_rollback",
  {
    description: "Rollback an applied proposal (reverts the changes made when it was approved). Reviewer is required; reason is optional.",
    inputSchema: { project: projectParam, proposalId: z.string().uuid(), reviewer: z.string(), reason: z.string().optional() },
  },
  wrapHandler(C("skill_proposal_rollback"), async ({ project, proposalId, reviewer, reason }) =>
    skillTools.skillProposalRollback(project, proposalId, reviewer, reason)),
);

// ── Observations ──────────────────────────────────────────

server.registerTool(
  "observe",
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
    wrapHandler(C("observe"), async ({ project, observation_type, content, importance, source, context }) =>
    observationTools.observationStore(project, observation_type, content, importance, source, context)),
);

server.registerTool(
  "observation_search",
  {
    description: "Full-text search across observations.",
    inputSchema: { project: projectParam, query: z.string() },
  },
  wrapHandler(C("observation_search"), async ({ project, query }) => observationTools.observationSearch(project, query)),
);

server.registerTool(
  "observation_list",
  {
    description: "List observations with optional status and type filters.",
    inputSchema: { project: projectParam, status: z.string().optional(), type: z.string().optional() },
  },
  wrapHandler(C("observation_list"), async ({ project, status, type }) => observationTools.observationList(project, status, type)),
);

server.registerTool(
  "observation_stats",
  {
    description: "Get observation pipeline statistics (total, pending, processed).",
    inputSchema: { project: projectParam },
  },
  wrapHandler(C("observation_stats"), async ({ project }) => observationTools.observationStats(project)),
);

server.registerTool(
  "observation_get",
  { description: "Get a single observation by ID.", inputSchema: { project: projectParam, observation_id: z.number() } },
  wrapHandler(C("observation_get"), async ({ project, observation_id }) => observationTools.observationGet(project, observation_id)),
);

server.registerTool(
  "observation_update",
  {
    description: "Update an observation (status, importance).",
    inputSchema: { project: projectParam, observation_id: z.number(), status: z.string().optional(), importance: z.number().optional() },
  },
  wrapHandler(C("observation_update"), async ({ project, observation_id, status, importance }) => observationTools.observationUpdate(project, observation_id, status, importance)),
);

server.registerTool(
  "observation_enrich",
  {
    description: "Enrich raw observations via LLM.",
    inputSchema: { project: projectParam, observations: z.array(z.unknown()) },
  },
  wrapHandler(C("observation_enrich"), async ({ project, observations }) => observationTools.observationEnrich(project, observations)),
);

server.registerTool(
  "observation_delete",
  { description: "Hard delete a single observation by ID.", inputSchema: { project: projectParam, observation_id: z.number() } },
  wrapHandler(C("observation_delete"), async ({ project, observation_id }) => observationTools.observationDelete(project, observation_id)),
);

server.registerTool(
  "observation_delete_by_source",
  {
    description: "Bulk hard delete observations by source — requires confirm=true.",
    inputSchema: { project: projectParam, source: z.string(), confirm: z.boolean() },
  },
  wrapHandler(C("observation_delete_by_source"), async ({ project, source, confirm }) => observationTools.observationDeleteBySource(project, source, confirm)),
);

// ── Personality ───────────────────────────────────────────

server.registerTool(
  "personality",
  {
    description: "Get the full learned personality profile — aggregated traits about user preferences, communication style, and behavior patterns.",
    inputSchema: { project: projectParam },
  },
  wrapHandler(C("personality"), async ({ project }) => personalityTools.personalityProfile(project)),
);

server.registerTool(
  "personality_traits",
  {
    description: "List personality traits, optionally filtered by type.",
    inputSchema: { project: projectParam, trait_type: z.string().optional() },
  },
  wrapHandler(C("personality_traits"), async ({ project, trait_type }) => personalityTools.personalityTraits(project, trait_type)),
);

server.registerTool(
  "personality_set_trait",
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
  wrapHandler(C("personality_set_trait"), async ({ project, trait_type, trait_value, display_label, confidence }) =>
    personalityTools.personalitySetTrait(project, trait_type, trait_value, display_label, confidence)),
);

server.registerTool(
  "personality_trait_dismiss",
  { description: "Dismiss a trait (set as inactive without deleting).", inputSchema: { project: projectParam, trait_id: z.number() } },
  wrapHandler(C("personality_trait_dismiss"), async ({ project, trait_id }) => personalityTools.personalityTraitDismiss(project, trait_id)),
);

server.registerTool(
  "personality_trait_disable",
  { description: "Disable a trait (harder deactivation).", inputSchema: { project: projectParam, trait_id: z.number() } },
  wrapHandler(C("personality_trait_disable"), async ({ project, trait_id }) => personalityTools.personalityTraitDisable(project, trait_id)),
);

server.registerTool(
  "personality_trait_delete",
  { description: "Hard delete a single personality trait.", inputSchema: { project: projectParam, trait_id: z.number() } },
  wrapHandler(C("personality_trait_delete"), async ({ project, trait_id }) => personalityTools.personalityTraitDelete(project, trait_id)),
);

server.registerTool(
  "personality_traits_delete_all",
  {
    description: "Hard delete ALL personality traits for the project — requires confirm=true.",
    inputSchema: { project: projectParam, confirm: z.boolean() },
  },
  wrapHandler(C("personality_traits_delete_all"), async ({ project, confirm }) => personalityTools.personalityTraitsDeleteAll(project, confirm)),
);

// ── Synthesis ─────────────────────────────────────────────

server.registerTool(
  "synthesis_run",
  {
    description: "Trigger the background synthesis pipeline — processes pending observations into personality traits and skill updates.",
    inputSchema: { project: projectParam },
  },
  wrapHandler(C("synthesis_run"), async ({ project }) => synthesisRun(project)),
);

server.registerTool(
  "synthesis_status",
  {
    description: "Check the synthesis pipeline status (pending count, last run, processed count).",
    inputSchema: { project: projectParam },
  },
  wrapHandler(C("synthesis_status"), async ({ project }) => synthesisStatus(project)),
);

server.registerTool(
  "synthesis_cross_project",
  {
    description: "Trigger cross-project synthesis — evaluates patterns across all projects and promotes shared patterns to the global-default project.",
    inputSchema: { project: projectParam },
  },
  wrapHandler(C("synthesis_cross_project"), async ({ project }) => synthesisCrossProject(project)),
);

// ── Extraction ──────────────────────────────────────────

server.registerTool(
  "extraction_run",
  {
    description: "Trigger LLM-based observation extraction — scans OpenCode messages since last watermark, pre-filters candidates via cheap regex, then uses the synthesis LLM to extract durable user behavior rules.",
    inputSchema: { project: projectParam },
  },
  wrapHandler(C("extraction_run"), async ({ project }) => extractionRun(project)),
);

// ── Tasks ───────────────────────────────────────────────

server.registerTool(
  "task_create",
  {
    description: "Create a new task with optional description and assignee.",
    inputSchema: {
      project: projectParam,
      title: z.string(),
      description: z.string().optional(),
      assigned_to: z.string().optional(),
    },
  },
    wrapHandler(C("task_create"), async ({ project, title, description, assigned_to }) =>
    taskTools.taskCreate(project, title, description, assigned_to)),
);

server.registerTool(
  "task_list",
  {
    description: "List tasks, optionally filtered by column.",
    inputSchema: { project: projectParam, column_id: z.string().optional() },
  },
  wrapHandler(C("task_list"), async ({ project, column_id }) => taskTools.taskList(project, column_id)),
);

server.registerTool(
  "task_move",
  {
    description: "Move a task to a different column.",
    inputSchema: { project: projectParam, task_id: z.string(), column_id: z.string() },
  },
  wrapHandler(C("task_move"), async ({ project, task_id, column_id }) => taskTools.taskMove(project, task_id, column_id)),
);

server.registerTool(
  "task_complete",
  { description: "Mark a task as completed.", inputSchema: { project: projectParam, task_id: z.string() } },
  wrapHandler(C("task_complete"), async ({ project, task_id }) => taskTools.taskComplete(project, task_id)),
);

server.registerTool(
  "task_next",
  { description: "Get the highest-priority next task to work on.", inputSchema: { project: projectParam } },
  wrapHandler(C("task_next"), async ({ project }) => taskTools.taskNext(project)),
);

server.registerTool(
  "task_update",
  {
    description: "Update task fields (title, description, assigned_to, priority, etc.).",
    inputSchema: {
      project: projectParam,
      task_id: z.string(),
      fields: z.record(z.unknown()),
    },
  },
  wrapHandler(C("task_update"), async ({ project, task_id, fields }) =>
    taskTools.taskUpdate(project, task_id, fields)),
);

server.registerTool(
  "task_delete",
  { description: "Delete a task by ID.", inputSchema: { project: projectParam, task_id: z.string() } },
  wrapHandler(C("task_delete"), async ({ project, task_id }) => taskTools.taskDelete(project, task_id)),
);

server.registerTool(
  "task_search",
  {
    description: "Full-text search across tasks.",
    inputSchema: { project: projectParam, query: z.string(), limit: z.number().optional() },
  },
  wrapHandler(C("task_search"), async ({ project, query, limit }) => taskTools.taskSearch(project, query, limit)),
);

server.registerTool(
  "task_comment",
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
  wrapHandler(C("task_comment"), async ({ project, task_id, author, body, parent_comment_id }) =>
    taskTools.taskComment(project, task_id, author, body, parent_comment_id)),
);

server.registerTool(
  "task_activity",
  {
    description: "Get activity feed for a task.",
    inputSchema: { project: projectParam, task_id: z.string(), limit: z.number().optional() },
  },
  wrapHandler(C("task_activity"), async ({ project, task_id, limit }) => taskTools.taskActivity(project, task_id, limit)),
);

server.registerTool(
  "task_link",
  {
    description: "Link two tasks together (blocks, relates_to, duplicates).",
    inputSchema: {
      project: projectParam,
      task_id: z.string(),
      linked_task_id: z.string(),
      link_type: z.string(),
    },
  },
  wrapHandler(C("task_link"), async ({ project, task_id, linked_task_id, link_type }) =>
    taskTools.taskLink(project, task_id, linked_task_id, link_type)),
);

server.registerTool(
  "task_board_config_get",
  {
    description: "Get board configuration (columns and custom field definitions).",
    inputSchema: { project: projectParam },
  },
  wrapHandler(C("task_board_config_get"), async ({ project }) => taskTools.taskBoardConfigGet(project)),
);

server.registerTool(
  "task_board_config_set",
  {
    description: "Set board configuration (columns and/or custom field definitions).",
    inputSchema: {
      project: projectParam,
      columns: z.array(z.unknown()).optional(),
      custom_field_defs: z.array(z.unknown()).optional(),
    },
  },
  wrapHandler(C("task_board_config_set"), async ({ project, columns, custom_field_defs }) =>
    taskTools.taskBoardConfigSet(project, columns, custom_field_defs)),
);

server.registerTool(
  "task_subtask_create",
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
  wrapHandler(C("task_subtask_create"), async ({ project, parent_id, title, description, assigned_to }) =>
    taskTools.taskSubtaskCreate(project, parent_id, title, description, assigned_to)),
);

server.registerTool(
  "task_notifications",
  {
    description: "List task notifications for a recipient, optionally filtered by unread status.",
    inputSchema: {
      project: projectParam,
      recipient: z.string(),
      unread: z.boolean().optional(),
    },
  },
  wrapHandler(C("task_notifications"), async ({ project, recipient, unread }) =>
    taskTools.taskNotifications(project, recipient, unread)),
);

server.registerTool(
  "task_get",
  { description: "Get a single task by ID.", inputSchema: { project: projectParam, task_id: z.string() } },
  wrapHandler(C("task_get"), async ({ project, task_id }) => taskTools.taskGet(project, task_id)),
);

server.registerTool(
  "task_comments_list",
  { description: "List comments for a task.", inputSchema: { project: projectParam, task_id: z.string() } },
  wrapHandler(C("task_comments_list"), async ({ project, task_id }) => taskTools.taskCommentsList(project, task_id)),
);

server.registerTool(
  "task_comment_edit",
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
  wrapHandler(C("task_comment_edit"), async ({ project, task_id, comment_id, body, actor }) =>
    taskTools.taskCommentEdit(project, task_id, comment_id, body, actor)),
);

server.registerTool(
  "task_comment_react",
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
  wrapHandler(C("task_comment_react"), async ({ project, task_id, comment_id, reaction, actor }) =>
    taskTools.taskCommentReact(project, task_id, comment_id, reaction, actor)),
);

server.registerTool(
  "task_links_list",
  { description: "List task links (blocks, relates_to, duplicates).", inputSchema: { project: projectParam, task_id: z.string() } },
  wrapHandler(C("task_links_list"), async ({ project, task_id }) => taskTools.taskLinksList(project, task_id)),
);

server.registerTool(
  "task_link_delete",
  {
    description: "Delete a task link by ID.",
    inputSchema: { project: projectParam, task_id: z.string(), link_id: z.string(), actor: z.string().optional() },
  },
  wrapHandler(C("task_link_delete"), async ({ project, task_id, link_id, actor }) => taskTools.taskLinkDelete(project, task_id, link_id, actor)),
);

server.registerTool(
  "task_tree",
  { description: "Get the full task tree (parent + subtasks + linked tasks).", inputSchema: { project: projectParam, task_id: z.string() } },
  wrapHandler(C("task_tree"), async ({ project, task_id }) => taskTools.taskTree(project, task_id)),
);

server.registerTool(
  "task_notification_read",
  { description: "Mark a notification as read.", inputSchema: { project: projectParam, notification_id: z.string() } },
  wrapHandler(C("task_notification_read"), async ({ project, notification_id }) => taskTools.taskNotificationRead(project, notification_id)),
);

server.registerTool(
  "task_bulk_update",
  {
    description: "Bulk update multiple tasks with the same fields.",
    inputSchema: {
      project: projectParam,
      task_ids: z.array(z.string()),
      fields: z.record(z.unknown()),
    },
  },
  wrapHandler(C("task_bulk_update"), async ({ project, task_ids, fields }) => taskTools.taskBulkUpdate(project, task_ids, fields)),
);

// ── Plans ─────────────────────────────────────────────

server.registerTool(
  "plan_save",
  {
    description: "Save a context entry with optional tags and priority.",
    inputSchema: { project: projectParam, content: z.string(), tags: z.string().optional(), priority: z.number().optional() },
  },
  wrapHandler(C("plan_save"), async ({ project, content, tags, priority }) => contextTools.planSave(project, content, tags, priority)),
);

server.registerTool(
  "plan_search",
  { description: "Full-text search across context entries.", inputSchema: { project: projectParam, query: z.string() } },
  wrapHandler(C("plan_search"), async ({ project, query }) => contextTools.planSearch(project, query)),
);

server.registerTool(
  "plan_list",
  { description: "List plan/context entries.", inputSchema: { project: projectParam } },
  wrapHandler(C("plan_list"), async ({ project }) => contextTools.planList(project)),
);

// ── Projects ────────────────────────────────────────────

server.registerTool(
  "project_list",
  { description: "List all projects known to the Ingenium API.", inputSchema: {} },
  wrapHandler(C("project_list"), async () => projectTools.projectList()),
);

server.registerTool(
  "project_init",
  { description: "Initialise a new project on the Ingenium API.", inputSchema: { name: z.string(), isGlobal: z.boolean().optional() } },
  wrapHandler(C("project_init"), async ({ name, isGlobal }) => projectTools.projectInit(name, isGlobal)),
);

server.registerTool(
  "project_delete",
  { description: "Delete a project by name.", inputSchema: { name: z.string() } },
  wrapHandler(C("project_delete"), async ({ name }) => projectTools.projectDelete(name)),
);

server.registerTool(
  "project_restore",
  { description: "Restore an archived project.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler(C("project_restore"), async ({ project, name }) => projectTools.projectRestore(project, name)),
);

server.registerTool(
  "project_list_archived",
  { description: "List archived projects.", inputSchema: { project: projectParam } },
  wrapHandler(C("project_list_archived"), async ({ project }) => projectTools.projectListArchived(project)),
);

server.registerTool(
  "project_purge",
  { description: "Purge old projects.", inputSchema: { project: projectParam, retentionDays: z.number().optional() } },
  wrapHandler(C("project_purge"), async ({ project, retentionDays }) => projectTools.projectPurge(project, retentionDays)),
);

server.registerTool(
  "project_set_global",
  { description: "Mark a project as global (or unmark).", inputSchema: { project: projectParam, name: z.string(), isGlobal: z.boolean() } },
  wrapHandler(C("project_set_global"), async ({ project, name, isGlobal }) => projectTools.projectSetGlobal(project, name, isGlobal)),
);

server.registerTool(
  "project_rename",
  {
    description: "Rename an existing project.",
    inputSchema: { project: projectParam, name: z.string(), newName: z.string() },
  },
  wrapHandler(C("project_rename"), async ({ project, name, newName }) => projectTools.projectRename(project, name, newName)),
);

server.registerTool(
  "project_detail",
  { description: "Get detailed info about a project by name.", inputSchema: { name: z.string() } },
  wrapHandler(C("project_detail"), async ({ name }) => projectTools.projectDetail(name)),
);

server.registerTool(
  "project_migrate_workspace",
  { description: "DB-only migration of the historical invalid /workspace project into global-default. Use dryRun first; never accesses filesystem /workspace.", inputSchema: { dryRun: z.boolean().optional() } },
  wrapHandler(C("project_migrate_workspace"), async ({ dryRun }) => projectTools.projectMigrateWorkspace(dryRun)),
);

// ── Plugins ─────────────────────────────────────────────

server.registerTool(
  "plugin_list",
  { description: "List all plugins available for a project.", inputSchema: { project: projectParam } },
  wrapHandler(C("plugin_list"), async ({ project }) => pluginTools.pluginList(project)),
);

server.registerTool(
  "plugin_get",
  { description: "Get a single plugin by name.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler(C("plugin_get"), async ({ project, name }) => pluginTools.pluginGet(project, name)),
);

server.registerTool(
  "plugin_enable",
  { description: "Enable a plugin for a project.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler(C("plugin_enable"), async ({ project, name }) => pluginTools.pluginEnable(project, name)),
);

server.registerTool(
  "plugin_disable",
  { description: "Disable a plugin for a project.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler(C("plugin_disable"), async ({ project, name }) => pluginTools.pluginDisable(project, name)),
);

server.registerTool(
  "plugin_create",
  {
    description: "Create a new plugin for a project.",
    inputSchema: { project: projectParam, name: z.string(), filePath: z.string(), sourceContent: z.string().optional() }
  },
  wrapHandler(C("plugin_create"), async ({ project, name, filePath, sourceContent }) => pluginTools.pluginCreate(project, name, filePath, sourceContent)),
);

server.registerTool(
  "plugin_delete",
  { description: "Delete a plugin from a project.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler(C("plugin_delete"), async ({ project, name }) => pluginTools.pluginDelete(project, name)),
);

server.registerTool(
  "plugin_update",
  {
    description: "Update a plugin's file path or source content.",
    inputSchema: { project: projectParam, name: z.string(), file_path: z.string().optional(), source_content: z.string().optional() }
  },
  wrapHandler(C("plugin_update"), async ({ project, name, file_path, source_content }) => pluginTools.pluginUpdate(project, name, { file_path, source_content })),
);

server.registerTool(
  "plugin_source",
  { description: "Get a plugin's source content from disk.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler(C("plugin_source"), async ({ project, name }) => pluginTools.pluginSource(project, name)),
);

// ── Commands ─────────────────────────────────────────────

server.registerTool(
  "command_list",
  { description: "List all commands for a project.", inputSchema: { project: projectParam } },
  wrapHandler(C("command_list"), async ({ project }) => commandTools.commandList(project)),
);

server.registerTool(
  "command_get",
  { description: "Get a command by name.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler(C("command_get"), async ({ project, name }) => commandTools.commandGet(project, name)),
);

server.registerTool(
  "command_create",
  {
    description: "Create a new command.",
    inputSchema: { project: projectParam, name: z.string(), filePath: z.string(), content: z.string().optional() }
  },
  wrapHandler(C("command_create"), async ({ project, name, filePath, content }) => commandTools.commandCreate(project, name, filePath, content)),
);

server.registerTool(
  "command_update",
  {
    description: "Update an existing command.",
    inputSchema: { project: projectParam, name: z.string(), file_path: z.string().optional(), content: z.string().optional() }
  },
  wrapHandler(C("command_update"), async ({ project, name, file_path, content }) => commandTools.commandUpdate(project, name, { file_path, content })),
);

server.registerTool(
  "command_delete",
  { description: "Delete a command.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler(C("command_delete"), async ({ project, name }) => commandTools.commandDelete(project, name)),
);

// ── Config ───────────────────────────────────────────────

server.registerTool(
  "config_get",
  {
    description: "Get config (opencode.json/opencode.jsonc) content for a project",
    inputSchema: { project: projectParam, type: z.enum(["project", "global"]).optional().default("project") },
  },
  wrapHandler(C("config_get"), async ({ project, type }: { project: string; type: string }) => configTools.configGet(project, type)),
);

server.registerTool(
  "config_set",
  {
    description: "Set config content for a project (writes to DB and disk)",
    inputSchema: { project: projectParam, type: z.enum(["project", "global"]).optional().default("project"), content: z.string() },
  },
  wrapHandler(C("config_set"), async ({ project, type, content }: { project: string; type: string; content: string }) => configTools.configSet(project, type, content)),
);

server.registerTool(
  "config_sync",
  {
    description: "Sync config from disk to DB",
    inputSchema: { project: projectParam, type: z.enum(["project", "global"]).optional().default("project") },
  },
  wrapHandler(C("config_sync"), async ({ project, type }: { project: string; type: string }) => configTools.configSync(project, type)),
);

// ── Servers ─────────────────────────────────────────────

server.registerTool(
  "server_list",
  { description: "List all registered child MCP servers for a project.", inputSchema: { project: projectParam } },
  wrapHandler(C("server_list"), async ({ project }) => serverTools.serverList(project)),
);

server.registerTool(
  "server_add",
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
    wrapHandler(C("server_add"), async ({ project, name, command, args, env, source }) =>
    serverTools.serverAdd(project, name, command, args, env, source)),
);

server.registerTool(
  "server_remove",
  {
    description: "Remove a child MCP server definition.",
    inputSchema: { project: projectParam, name: z.string() },
  },
  wrapHandler(C("server_remove"), async ({ project, name }) => serverTools.serverRemove(project, name)),
);

server.registerTool(
  "server_update",
  {
    description: "Update a server's running state.",
    inputSchema: { project: projectParam, name: z.string(), running: z.boolean() },
  },
  wrapHandler(C("server_update"), async ({ project, name, running }) => serverTools.serverUpdate(project, name, running)),
);

server.registerTool(
  "server_sync_all",
  {
    description: "Sync all servers — upserts an array of server definitions for a project.",
    inputSchema: { project: projectParam, servers: z.array(z.unknown()) },
  },
  wrapHandler(C("server_sync_all"), async ({ project, servers }) => serverTools.serverSyncAll(project, servers)),
);

// ── Agents ──────────────────────────────────────────────

server.registerTool(
  "agent_list",
  { description: "List all agents for a project, optionally filtered by category.", inputSchema: { project: projectParam, category: z.string().optional() } },
  wrapHandler(C("agent_list"), async ({ project, category }) => agentTools.agentList(project, category)),
);

server.registerTool(
  "agent_get",
  { description: "Get an agent by name.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler(C("agent_get"), async ({ project, name }) => agentTools.agentGet(project, name)),
);

server.registerTool(
  "agent_create",
  {
    description: "Create a new agent with YAML-frontmatter content.",
    inputSchema: { project: projectParam, name: z.string(), content: z.string(), description: z.string().optional(), category: z.string().optional(), mode: z.string().optional(), model: z.string().optional() },
  },
  wrapHandler(C("agent_create"), async (args) => agentTools.agentCreate(args.project, args.name, args.content, args.description, args.category, args.mode, args.model)),
);

server.registerTool(
  "agent_update",
  {
    description: "Update an existing agent's metadata or content.",
    inputSchema: { project: projectParam, name: z.string(), description: z.string().optional(), category: z.string().optional(), mode: z.string().optional(), model: z.string().optional(), content: z.string().optional() },
  },
  wrapHandler(C("agent_update"), async (args) => agentTools.agentUpdate(args.project, args.name, args)),
);

server.registerTool(
  "agent_delete",
  { description: "Delete an agent by name.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler(C("agent_delete"), async ({ project, name }) => agentTools.agentDelete(project, name)),
);

server.registerTool(
  "agent_enable",
  { description: "Enable an agent and write its .md file to disk.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler(C("agent_enable"), async ({ project, name }) => agentTools.agentEnable(project, name)),
);

server.registerTool(
  "agent_disable",
  { description: "Disable an agent and remove its .md file from disk.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler(C("agent_disable"), async ({ project, name }) => agentTools.agentDisable(project, name)),
);

server.registerTool(
  "agent_sync",
  { description: "Sync an agent from its .md file on disk to the DB — edits made directly to the file are persisted.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler(C("agent_sync"), async ({ project, name }) => agentTools.agentSync(project, name)),
);

// ── Logs ──────────────────────────────────────────────

server.registerTool(
  "logs_list",
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
  wrapHandler(C("logs_list"), async ({ project, source, level, since, limit }) =>
    logTools.logsList(project, source, level, since, limit)),
);

server.registerTool(
  "logs_sources",
  {
    description: "List active log sources (e.g., scheduler, api, auto-observer).",
    inputSchema: { project: projectParam },
  },
  wrapHandler(C("logs_sources"), async ({ project }) =>
    logTools.logsSources(project)),
);

// ── Email ──────────────────────────────────────────────

server.registerTool(
  "email_list",
  {
    description: "List emails in a folder. Use this to check inbox, sent items, or any folder.",
    inputSchema: { project: projectParam, account: z.string(), folder: z.string().optional(), page: z.number().optional() },
  },
  wrapHandler(C("email_list"), async ({ project, account, folder, page }) => emailTools.emailList(project, account, folder, page)),
);

server.registerTool(
  "email_search",
  {
    description: "Search emails by keyword, sender, subject, or date range.",
    inputSchema: { project: projectParam, account: z.string(), query: z.string(), folder: z.string().optional() },
  },
  wrapHandler(C("email_search"), async ({ project, account, query, folder }) => emailTools.emailSearch(project, account, query, folder)),
);

server.registerTool(
  "email_read",
  {
    description: "Read a full email by its UID (unique ID).",
    inputSchema: { project: projectParam, account: z.string(), uid: z.number(), folder: z.string().optional() },
  },
  wrapHandler(C("email_read"), async ({ project, account, uid, folder }) => emailTools.emailRead(project, account, uid, folder)),
);

server.registerTool(
  "email_send",
  {
    description: "Compose and send an email. Use HTML for formatting.",
    inputSchema: {
      project: projectParam, account: z.string(), to: z.string(), subject: z.string(),
      html: z.string().optional(), text: z.string().optional(),
      cc: z.string().optional(), bcc: z.string().optional(),
    },
  },
    wrapHandler(C("email_send"), async ({ project, account, to, subject, html, text, cc, bcc }) =>
    emailTools.emailSend(project, account, to, subject, html, text, cc, bcc)),
);

server.registerTool(
  "email_draft",
  {
    description: "Save a draft email without sending.",
    inputSchema: {
      project: projectParam, account: z.string(), to: z.string(), subject: z.string(),
      html: z.string().optional(),
    },
  },
  wrapHandler(C("email_draft"), async ({ project, account, to, subject, html }) => emailTools.emailDraft(project, account, to, subject, html)),
);

server.registerTool(
  "email_folders",
  {
    description: "List all email folders for an account.",
    inputSchema: { project: projectParam, account: z.string() },
  },
  wrapHandler(C("email_folders"), async ({ project, account }) => emailTools.emailFolders(project, account)),
);

server.registerTool(
  "email_accounts",
  {
    description: "List connected email accounts.",
    inputSchema: { project: projectParam },
  },
  wrapHandler(C("email_accounts"), async ({ project }) => emailTools.emailAccounts(project)),
);

server.registerTool(
  "email_triage",
  {
    description: "Triage emails — categorize by priority and suggest actions based on learned patterns. Use this to process your inbox.",
    inputSchema: { project: projectParam, account: z.string(), limit: z.number().optional() },
  },
  wrapHandler(C("email_triage"), async ({ project, account, limit }) => emailTools.emailTriage(project, account, limit)),
);

server.registerTool(
  "email_suggest",
  {
    description: "Suggest an email response based on learned user patterns and past behavior.",
    inputSchema: { project: projectParam, account: z.string(), uid: z.number(), folder: z.string().optional() },
  },
  wrapHandler(C("email_suggest"), async ({ project, account, uid, folder }) => emailTools.emailSuggestResponse(project, account, uid, folder)),
);

server.registerTool(
  "email_draft_response",
  {
    description: "Auto-draft a response to an email based on learned patterns and save it to Drafts folder.",
    inputSchema: { project: projectParam, account: z.string(), uid: z.number(), folder: z.string().optional() },
  },
  wrapHandler(C("email_draft_response"), async ({ project, account, uid, folder }) => emailTools.emailDraftResponse(project, account, uid, folder)),
);

server.registerTool(
  "email_patterns",
  {
    description: "List all learned email response patterns (skills with category 'email').",
    inputSchema: { project: projectParam },
  },
  wrapHandler(C("email_patterns"), async ({ project }) => emailTools.emailPatterns(project)),
);

server.registerTool(
  "email_watch_start",
  {
    description: "Start IMAP IDLE watcher for real-time email monitoring and auto-drafting.",
    inputSchema: { project: projectParam, account: z.string() },
  },
  wrapHandler(C("email_watch_start"), async ({ project, account }) => emailTools.emailWatchStart(project, account)),
);

server.registerTool(
  "email_watch_status",
  {
    description: "Check if the IMAP IDLE watcher is running for an account.",
    inputSchema: { project: projectParam, account: z.string() },
  },
  wrapHandler(C("email_watch_status"), async ({ project, account }) => emailTools.emailWatchStatus(project, account)),
);

server.registerTool(
  "email_account_create",
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
  wrapHandler(C("email_account_create"), async (args) =>
    emailTools.emailAccountCreate(args.project, args.email, args.provider, args.authType, args.name, args.appPassword, args.imapHost, args.smtpHost, args.imapPort, args.smtpPort)),
);

server.registerTool(
  "email_account_delete",
  { description: "Delete an email account and clear its cached data.", inputSchema: { project: projectParam, account: z.string() } },
  wrapHandler(C("email_account_delete"), async ({ project, account }) => emailTools.emailAccountDelete(project, account)),
);

server.registerTool(
  "email_account_test",
  { description: "Test IMAP connection for an account.", inputSchema: { project: projectParam, account: z.string() } },
  wrapHandler(C("email_account_test"), async ({ project, account }) => emailTools.emailAccountTest(project, account)),
);

server.registerTool(
  "email_oauth_url",
  { description: "Get OAuth authorization URL — never returns tokens, only the URL.", inputSchema: { project: projectParam, provider: z.string() } },
  wrapHandler(C("email_oauth_url"), async ({ project, provider }) => emailTools.emailOauthUrl(project, provider)),
);

server.registerTool(
  "email_oauth_exchange",
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
  wrapHandler(C("email_oauth_exchange"), async ({ project, provider, code, state, redirectUri, accountId }) =>
    emailTools.emailOauthExchange(project, provider, code, state, redirectUri, accountId)),
);

server.registerTool(
  "email_summarize",
  {
    description: "Get LLM-generated email summary (cache-first).",
    inputSchema: { project: projectParam, account: z.string(), uid: z.number(), folder: z.string().optional() },
  },
  wrapHandler(C("email_summarize"), async ({ project, account, uid, folder }) => emailTools.emailSummarize(project, account, uid, folder)),
);

server.registerTool(
  "email_review_draft",
  {
    description: "LLM-powered draft review and improvement.",
    inputSchema: { project: projectParam, text: z.string(), subject: z.string().optional() },
  },
  wrapHandler(C("email_review_draft"), async ({ project, text, subject }) => emailTools.emailReviewDraft(project, text, subject)),
);

server.registerTool(
  "email_move",
  {
    description: "Move an email to another folder.",
    inputSchema: { project: projectParam, account: z.string(), uid: z.number(), fromFolder: z.string(), toFolder: z.string() },
  },
  wrapHandler(C("email_move"), async ({ project, account, uid, fromFolder, toFolder }) => emailTools.emailMove(project, account, uid, fromFolder, toFolder)),
);

server.registerTool(
  "email_set_flags",
  {
    description: "Set flags on an email.",
    inputSchema: { project: projectParam, account: z.string(), uid: z.number(), folder: z.string(), flags: z.array(z.string()) },
  },
  wrapHandler(C("email_set_flags"), async ({ project, account, uid, folder, flags }) => emailTools.emailSetFlags(project, account, uid, folder, flags)),
);

server.registerTool(
  "email_delete",
  {
    description: "Delete an email (moves to Trash via IMAP).",
    inputSchema: { project: projectParam, account: z.string(), uid: z.number(), folder: z.string().optional() },
  },
  wrapHandler(C("email_delete"), async ({ project, account, uid, folder }) => emailTools.emailDelete(project, account, uid, folder)),
);

server.registerTool(
  "email_sync",
  {
    description: "Trigger engine-backed sync hint.",
    inputSchema: { project: projectParam, account: z.string(), folder: z.string().optional() },
  },
  wrapHandler(C("email_sync"), async ({ project, account, folder }) => emailTools.emailSync(project, account, folder)),
);

server.registerTool(
  "email_sync_status",
  { description: "Get per-folder sync status from the engine.", inputSchema: { project: projectParam, account: z.string() } },
  wrapHandler(C("email_sync_status"), async ({ project, account }) => emailTools.emailSyncStatus(project, account)),
);

server.registerTool(
  "email_watch_stop",
  { description: "Stop IMAP IDLE watcher.", inputSchema: { project: projectParam, account: z.string() } },
  wrapHandler(C("email_watch_stop"), async ({ project, account }) => emailTools.emailWatchStop(project, account)),
);

server.registerTool(
  "email_attachment_get",
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
  wrapHandler(C("email_attachment_get"), async ({ project, account, uid, attachmentId, folder, outputPath }) =>
    emailTools.emailAttachmentGet(project, account, uid, attachmentId, folder, outputPath)),
);

// ── Jobs ──────────────────────────────────────────────

server.registerTool(
  "job_list",
  { description: "List all jobs for a project.", inputSchema: { project: projectParam } },
  wrapHandler(C("job_list"), async ({ project }) => jobTools.jobList(project)),
);

server.registerTool(
  "job_create",
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
    wrapHandler(C("job_create"), async ({ project, name, description, agent, prompt_template, schedule_cron, trigger_event, timeout_minutes }) =>
    jobTools.jobCreate(project, name, description, agent, prompt_template, schedule_cron, trigger_event, timeout_minutes)),
);

server.registerTool(
  "job_update",
  {
    description: "Update existing job fields (name, description, agent, prompt_template, schedule_cron, trigger_event, enabled, timeout_minutes).",
    inputSchema: {
      project: projectParam,
      job_id: z.string(),
      fields: z.record(z.unknown()),
    },
  },
  wrapHandler(C("job_update"), async ({ project, job_id, fields }) =>
    jobTools.jobUpdate(project, job_id, fields)),
);

server.registerTool(
  "job_delete",
  { description: "Delete a job by ID.", inputSchema: { project: projectParam, job_id: z.string() } },
  wrapHandler(C("job_delete"), async ({ project, job_id }) => jobTools.jobDelete(project, job_id)),
);

server.registerTool(
  "job_run",
  { description: "Manually trigger a job run.", inputSchema: { project: projectParam, job_id: z.string() } },
  wrapHandler(C("job_run"), async ({ project, job_id }) => jobTools.jobRun(project, job_id)),
);

server.registerTool(
  "job_runs",
  { description: "List all runs for a job.", inputSchema: { project: projectParam, job_id: z.string() } },
  wrapHandler(C("job_runs"), async ({ project, job_id }) => jobTools.jobRuns(project, job_id)),
);

server.registerTool(
  "job_run_logs",
  {
    description: "Get log entries for a specific run, optionally after a sequence number for tail polling.",
    inputSchema: { project: projectParam, run_id: z.string(), after: z.number().optional() },
  },
  wrapHandler(C("job_run_logs"), async ({ project, run_id, after }) => jobTools.jobRunLogs(project, run_id, after)),
);

server.registerTool(
  "job_run_cancel",
  { description: "Cancel a running job.", inputSchema: { project: projectParam, run_id: z.string() } },
  wrapHandler(C("job_run_cancel"), async ({ project, run_id }) => jobTools.jobRunCancel(project, run_id)),
);

server.registerTool(
  "job_get",
  { description: "Get a single job by ID.", inputSchema: { project: projectParam, job_id: z.string() } },
  wrapHandler(C("job_get"), async ({ project, job_id }) => jobTools.jobGet(project, job_id)),
);

server.registerTool(
  "job_suggest",
  {
    description: "Get LLM-generated job suggestions based on a natural-language description.",
    inputSchema: { project: projectParam, description: z.string() },
  },
  wrapHandler(C("job_suggest"), async ({ project, description }) => jobTools.jobSuggest(project, description)),
);

// ── Pipeline ───────────────────────────────────────────

server.registerTool(
  "pipeline_events",
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
  wrapHandler(C("pipeline_events"), async ({ project, source, type, limit, since }) =>
    pipelineTools.pipelineEvents(project, source, type, limit, since)),
);

server.registerTool(
  "pipeline_timeline",
  {
    description: "Get grouped timeline with children nested in parents.",
    inputSchema: {
      project: projectParam,
      source: z.string().optional(),
      limit: z.number().optional(),
      since: z.string().optional(),
    },
  },
  wrapHandler(C("pipeline_timeline"), async ({ project, source, limit, since }) =>
    pipelineTools.pipelineTimeline(project, source, limit, since)),
);

server.registerTool(
  "pipeline_event_log",
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
  wrapHandler(C("pipeline_event_log"), async (args) =>
    pipelineTools.pipelineEventLog(args.project, args.eventType, args.eventSource, args.title, args.description, args.data as object | undefined, args.parentEventId, args.sessionId, args.importance)),
);

// ── Status ─────────────────────────────────────────────

server.registerTool(
  "service_status",
  { description: "Get overall service health — supervisord process states + application health.", inputSchema: { project: projectParam } },
  wrapHandler(C("service_status"), async ({ project }) => statusTools.serviceStatus(project)),
);

server.registerTool(
  "service_application_detail",
  {
    description: "Get detailed status for a specific application (email-client or synthesis-engine).",
    inputSchema: { project: projectParam, name: z.string() },
  },
  wrapHandler(C("service_application_detail"), async ({ project, name }) => statusTools.serviceApplicationDetail(project, name)),
);

server.registerTool(
  "service_process_detail",
  { description: "Get single process detail via supervisor.getProcessInfo.", inputSchema: { project: projectParam, name: z.string() } },
  wrapHandler(C("service_process_detail"), async ({ project, name }) => statusTools.serviceProcessDetail(project, name)),
);

server.registerTool(
  "service_process_logs",
  {
    description: "Read process logs with byte-size cap (max 10000 bytes).",
    inputSchema: {
      project: projectParam,
      name: z.string(),
      offset: z.number().optional(),
      limit: z.number().optional(),
    },
  },
  wrapHandler(C("service_process_logs"), async ({ project, name, offset, limit }) =>
    statusTools.serviceProcessLogs(project, name, offset, limit)),
);

// ── Health ─────────────────────────────────────────────

server.registerTool(
  "health_check",
  { description: "API health check — returns status and uptime. No project param needed.", inputSchema: {} },
  wrapHandler(C("health_check"), async () => healthCheck()),
);

// ── OpenCode ───────────────────────────────────────────

server.registerTool(
  "opencode_messages",
  {
    description: "Read recent user messages from the OpenCode DB (used by the extraction engine).",
    inputSchema: { project: projectParam, limit: z.number().optional(), offset: z.number().optional() },
  },
  wrapHandler(C("opencode_messages"), async ({ project, limit, offset }) => opencodeMessages(project, limit, offset)),
);

// ── Dashboard ──────────────────────────────────────────

server.registerTool(
  "dashboard_summary",
  {
    description: "Get aggregated dashboard summary — learning stats, task counts, job counts, and mail status.",
    inputSchema: { project: projectParam },
  },
  // NOTE: Uses bare fetch instead of the retrying `api` client because the summary
  // endpoint aggregates from multiple sources and may be slower — the standard
  // 10s timeout + 3 retries could cascade under load. A single quick failure is
  // preferred over delaying the dashboard render.
  wrapHandler(C("dashboard_summary"), async ({ project }) => {
    const apiBase = config.apiUrl.endsWith("/") ? config.apiUrl : config.apiUrl + "/";
    const url = new URL("dashboard/summary", apiBase);
    url.searchParams.set("project", project);
    const res = await fetch(url.toString());
    const data = await res.json();
    return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
  }),
);

// ── Documentation ───────────────────────────────────────

server.registerTool(
  "docs_list_spaces",
  { description: "List all documentation spaces", inputSchema: { project: projectParam } },
  wrapHandler(C("docs_list_spaces"), async ({ project }) => docsTools.docsListSpaces(project)),
);

server.registerTool(
  "docs_get_space",
  {
    description: "Get a documentation space by ID or slug",
    inputSchema: { project: projectParam, id: z.number().optional(), slug: z.string().optional() },
  },
  wrapHandler(C("docs_get_space"), async ({ project, id, slug }) => docsTools.docsGetSpace(project, id, slug)),
);

server.registerTool(
  "docs_create_space",
  {
    description: "Create a new documentation space",
    inputSchema: { project: projectParam, name: z.string(), slug: z.string().optional(), description: z.string().optional(), icon: z.string().optional() },
  },
  wrapHandler(C("docs_create_space"), async ({ project, name, slug, description, icon }) => docsTools.docsCreateSpace(project, name, slug, description, icon)),
);

server.registerTool(
  "docs_update_space",
  {
    description: "Update a documentation space",
    inputSchema: { project: projectParam, id: z.number(), name: z.string().optional(), description: z.string().optional() },
  },
  wrapHandler(C("docs_update_space"), async ({ project, id, name, description }) => docsTools.docsUpdateSpace(project, id, name, description)),
);

server.registerTool(
  "docs_delete_space",
  { description: "Delete a documentation space", inputSchema: { project: projectParam, id: z.number() } },
  wrapHandler(C("docs_delete_space"), async ({ project, id }) => docsTools.docsDeleteSpace(project, id)),
);

server.registerTool(
  "docs_list_pages",
  {
    description: "List pages in a documentation space",
    inputSchema: { project: projectParam, spaceId: z.number(), parentPageId: z.number().optional() },
  },
  wrapHandler(C("docs_list_pages"), async ({ project, spaceId, parentPageId }) => docsTools.docsListPages(project, spaceId, parentPageId)),
);

server.registerTool(
  "docs_get_page_tree",
  { description: "Get the page tree for a space", inputSchema: { project: projectParam, spaceId: z.number() } },
  wrapHandler(C("docs_get_page_tree"), async ({ project, spaceId }) => docsTools.docsGetPageTree(project, spaceId)),
);

server.registerTool(
  "docs_get_page",
  {
    description: "Get a documentation page by ID or slug",
    inputSchema: { project: projectParam, id: z.number().optional(), spaceId: z.number().optional(), slug: z.string().optional() },
  },
  wrapHandler(C("docs_get_page"), async ({ project, id, spaceId, slug }) => docsTools.docsGetPage(project, id, spaceId, slug)),
);

server.registerTool(
  "docs_create_page",
  {
    description: "Create a new documentation page",
    inputSchema: { project: projectParam, spaceId: z.number(), title: z.string(), slug: z.string().optional(), content: z.string().optional(), parentPageId: z.number().optional() },
  },
  wrapHandler(C("docs_create_page"), async ({ project, spaceId, title, slug, content, parentPageId }) => docsTools.docsCreatePage(project, spaceId, title, slug, content, parentPageId)),
);

server.registerTool(
  "docs_update_page",
  {
    description: "Update a documentation page. Requires expectedRevision for optimistic concurrency.",
    inputSchema: { project: projectParam, id: z.number(), title: z.string().optional(), slug: z.string().optional(), content: z.string().optional(), expectedRevision: z.number() },
  },
  wrapHandler(C("docs_update_page"), async ({ project, id, title, slug, content, expectedRevision }) => docsTools.docsUpdatePage(project, id, title, slug, content, expectedRevision)),
);

server.registerTool(
  "docs_delete_page",
  { description: "Archive (soft-delete) a documentation page", inputSchema: { project: projectParam, id: z.number() } },
  wrapHandler(C("docs_delete_page"), async ({ project, id }) => docsTools.docsDeletePage(project, id)),
);

server.registerTool(
  "docs_restore_page",
  { description: "Restore an archived documentation page", inputSchema: { project: projectParam, id: z.number() } },
  wrapHandler(C("docs_restore_page"), async ({ project, id }) => docsTools.docsRestorePage(project, id)),
);

server.registerTool(
  "docs_publish_page",
  {
    description: "Publish a draft documentation page. Optionally pass expectedRevision for concurrency control.",
    inputSchema: { project: projectParam, id: z.number(), expectedRevision: z.number().optional() },
  },
  wrapHandler(C("docs_publish_page"), async ({ project, id, expectedRevision }) => docsTools.docsPublishPage(project, id, expectedRevision)),
);

server.registerTool(
  "docs_move_page",
  {
    description: "Move a page to a different parent or position",
    inputSchema: { project: projectParam, id: z.number(), newParentId: z.number().optional(), newSortOrder: z.number().optional() },
  },
  wrapHandler(C("docs_move_page"), async ({ project, id, newParentId, newSortOrder }) => docsTools.docsMovePage(project, id, newParentId, newSortOrder)),
);

server.registerTool(
  "docs_search",
  {
    description: "Full-text search across documentation pages",
    inputSchema: { project: projectParam, query: z.string(), spaceId: z.number().optional() },
  },
  wrapHandler(C("docs_search"), async ({ project, query, spaceId }) => docsTools.docsSearch(project, query, spaceId)),
);

server.registerTool(
  "docs_get_draft",
  { description: "Get the autosaved draft for a page", inputSchema: { project: projectParam, pageId: z.number() } },
  wrapHandler(C("docs_get_draft"), async ({ project, pageId }) => docsTools.docsGetDraft(project, pageId)),
);

server.registerTool(
  "docs_save_draft",
  { description: "Save a draft for a documentation page", inputSchema: { project: projectParam, pageId: z.number(), content: z.string(), title: z.string().optional(), slug: z.string().optional(), baseRevision: z.number().optional() } },
  wrapHandler(C("docs_save_draft"), async ({ project, pageId, content, title, slug, baseRevision }) => docsTools.docsSaveDraft(project, pageId, content, title, slug, baseRevision)),
);

server.registerTool(
  "docs_delete_draft",
  { description: "Delete the autosaved draft for a page", inputSchema: { project: projectParam, pageId: z.number() } },
  wrapHandler(C("docs_delete_draft"), async ({ project, pageId }) => docsTools.docsDeleteDraft(project, pageId)),
);

server.registerTool(
  "docs_list_versions",
  { description: "List version history for a page", inputSchema: { project: projectParam, pageId: z.number() } },
  wrapHandler(C("docs_list_versions"), async ({ project, pageId }) => docsTools.docsListVersions(project, pageId)),
);

server.registerTool(
  "docs_get_version",
  {
    description: "Get a specific version of a page",
    inputSchema: { project: projectParam, pageId: z.number(), versionId: z.number() },
  },
  wrapHandler(C("docs_get_version"), async ({ project, pageId, versionId }) => docsTools.docsGetVersion(project, pageId, versionId)),
);

server.registerTool(
  "docs_restore_version",
  {
    description: "Restore a page to a previous version",
    inputSchema: { project: projectParam, pageId: z.number(), versionId: z.number() },
  },
  wrapHandler(C("docs_restore_version"), async ({ project, pageId, versionId }) => docsTools.docsRestoreVersion(project, pageId, versionId)),
);

server.registerTool(
  "docs_list_comments",
  { description: "List comments on a documentation page", inputSchema: { project: projectParam, pageId: z.number() } },
  wrapHandler(C("docs_list_comments"), async ({ project, pageId }) => docsTools.docsListComments(project, pageId)),
);

server.registerTool(
  "docs_create_comment",
  {
    description: "Add a comment to a documentation page",
    inputSchema: { project: projectParam, pageId: z.number(), content: z.string(), parentCommentId: z.number().optional(), selectionText: z.string().optional(), selectionOffset: z.number().optional() },
  },
  wrapHandler(C("docs_create_comment"), async ({ project, pageId, content, parentCommentId, selectionText, selectionOffset }) => docsTools.docsCreateComment(project, pageId, content, parentCommentId, selectionText, selectionOffset)),
);

server.registerTool(
  "docs_resolve_comment",
  {
    description: "Resolve a comment",
    inputSchema: { project: projectParam, pageId: z.number(), commentId: z.number() },
  },
  wrapHandler(C("docs_resolve_comment"), async ({ project, pageId, commentId }) => docsTools.docsResolveComment(project, pageId, commentId)),
);

server.registerTool(
  "docs_delete_comment",
  {
    description: "Delete a comment",
    inputSchema: { project: projectParam, pageId: z.number(), commentId: z.number() },
  },
  wrapHandler(C("docs_delete_comment"), async ({ project, pageId, commentId }) => docsTools.docsDeleteComment(project, pageId, commentId)),
);

server.registerTool(
  "docs_list_tags",
  { description: "List all tags", inputSchema: { project: projectParam } },
  wrapHandler(C("docs_list_tags"), async ({ project }) => docsTools.docsListTags(project)),
);

server.registerTool(
  "docs_get_page_tags",
  { description: "Get tags for a page", inputSchema: { project: projectParam, pageId: z.number() } },
  wrapHandler(C("docs_get_page_tags"), async ({ project, pageId }) => docsTools.docsGetPageTags(project, pageId)),
);

server.registerTool(
  "docs_add_tag",
  { description: "Add a tag to a page", inputSchema: { project: projectParam, pageId: z.number(), tagName: z.string() } },
  wrapHandler(C("docs_add_tag"), async ({ project, pageId, tagName }) => docsTools.docsAddTag(project, pageId, tagName)),
);

server.registerTool(
  "docs_remove_tag",
  { description: "Remove a tag from a page", inputSchema: { project: projectParam, pageId: z.number(), tagId: z.number() } },
  wrapHandler(C("docs_remove_tag"), async ({ project, pageId, tagId }) => docsTools.docsRemoveTag(project, pageId, tagId)),
);

server.registerTool(
  "docs_get_backlinks",
  { description: "Get pages linking to this page", inputSchema: { project: projectParam, pageId: z.number() } },
  wrapHandler(C("docs_get_backlinks"), async ({ project, pageId }) => docsTools.docsGetBacklinks(project, pageId)),
);

server.registerTool(
  "docs_list_attachments",
  { description: "List attachments on a page", inputSchema: { project: projectParam, pageId: z.number() } },
  wrapHandler(C("docs_list_attachments"), async ({ project, pageId }) => docsTools.docsListAttachments(project, pageId)),
);

server.registerTool(
  "docs_delete_attachment",
  {
    description: "Delete an attachment",
    inputSchema: { project: projectParam, pageId: z.number(), attachmentId: z.number() },
  },
  wrapHandler(C("docs_delete_attachment"), async ({ project, pageId, attachmentId }) => docsTools.docsDeleteAttachment(project, pageId, attachmentId)),
);

server.registerTool(
  "docs_list_templates",
  { description: "List page templates", inputSchema: { project: projectParam } },
  wrapHandler(C("docs_list_templates"), async ({ project }) => docsTools.docsListTemplates(project)),
);

server.registerTool(
  "docs_get_template",
  { description: "Get a template by ID", inputSchema: { project: projectParam, id: z.number() } },
  wrapHandler(C("docs_get_template"), async ({ project, id }) => docsTools.docsGetTemplate(project, id)),
);

server.registerTool(
  "docs_create_template",
  {
    description: "Create a page template",
    inputSchema: { project: projectParam, name: z.string(), content: z.string(), description: z.string().optional(), category: z.string().optional() },
  },
  wrapHandler(C("docs_create_template"), async ({ project, name, content, description, category }) => docsTools.docsCreateTemplate(project, name, content, description, category)),
);

server.registerTool(
  "docs_delete_template",
  { description: "Delete a template", inputSchema: { project: projectParam, id: z.number() } },
  wrapHandler(C("docs_delete_template"), async ({ project, id }) => docsTools.docsDeleteTemplate(project, id)),
);

server.registerTool(
  "docs_update_template",
  {
    description: "Update a page template",
    inputSchema: { project: projectParam, id: z.number(), name: z.string().optional(), content: z.string().optional(), description: z.string().optional(), category: z.string().optional() },
  },
  wrapHandler(C("docs_update_template"), async ({ project, id, name, content, description, category }) => docsTools.docsUpdateTemplate(project, id, name, content, description, category)),
);

server.registerTool(
  "docs_link_project",
  {
    description: "Link a documentation page to a project",
    inputSchema: { project: projectParam, pageId: z.number(), projectId: z.string() },
  },
  wrapHandler(C("docs_link_project"), async ({ project, pageId, projectId }) => docsTools.docsLinkProject(project, pageId, projectId)),
);

server.registerTool(
  "docs_unlink_project",
  {
    description: "Unlink a page from a project",
    inputSchema: { project: projectParam, pageId: z.number(), linkedProjectId: z.string() },
  },
  wrapHandler(C("docs_unlink_project"), async ({ project, pageId, linkedProjectId }) => docsTools.docsUnlinkProject(project, pageId, linkedProjectId)),
);

server.registerTool(
  "docs_get_projects",
  { description: "Get projects linked to a page", inputSchema: { project: projectParam, pageId: z.number() } },
  wrapHandler(C("docs_get_projects"), async ({ project, pageId }) => docsTools.docsGetProjects(project, pageId)),
);

server.registerTool(
  "docs_toggle_favorite",
  { description: "Toggle favorite status for a page", inputSchema: { project: projectParam, pageId: z.number() } },
  wrapHandler(C("docs_toggle_favorite"), async ({ project, pageId }) => docsTools.docsToggleFavorite(project, pageId)),
);

server.registerTool(
  "docs_get_favorites",
  { description: "Get favorite pages", inputSchema: { project: projectParam } },
  wrapHandler(C("docs_get_favorites"), async ({ project }) => docsTools.docsGetFavorites(project)),
);

server.registerTool(
  "docs_import_pages",
  {
    description: "Import pages into a space",
    inputSchema: { project: projectParam, spaceId: z.number(), format: z.string(), data: z.string() },
  },
  wrapHandler(C("docs_import_pages"), async ({ project, spaceId, format, data }) => docsTools.docsImportPages(project, spaceId, format, data)),
);

server.registerTool(
  "docs_export_space",
  { description: "Export a space as JSON", inputSchema: { project: projectParam, spaceId: z.number() } },
  wrapHandler(C("docs_export_space"), async ({ project, spaceId }) => docsTools.docsExportSpace(project, spaceId)),
);

server.registerTool(
  "docs_trash_list",
  { description: "List archived pages in a space's trash", inputSchema: { project: projectParam, spaceId: z.number() } },
  wrapHandler(C("docs_trash_list"), async ({ project, spaceId }) => docsTools.docsListTrash(project, spaceId)),
);

server.registerTool(
  "docs_trash_purge",
  { description: "Permanently delete all archived pages in a space's trash", inputSchema: { project: projectParam, spaceId: z.number() } },
  wrapHandler(C("docs_trash_purge"), async ({ project, spaceId }) => docsTools.docsPurgeTrash(project, spaceId)),
);

server.registerTool(
  "docs_attachment_download",
  {
    description: "Get attachment download metadata URL — the caller uses the URL to download the file. Never returns raw binary.",
    inputSchema: { project: projectParam, pageId: z.number(), attachmentId: z.number() },
  },
  wrapHandler(C("docs_attachment_download"), async ({ project, pageId, attachmentId }) => docsTools.docsGetAttachmentDownload(project, pageId, attachmentId)),
);

server.registerTool(
  "docs_get_stats",
  { description: "Get documentation statistics", inputSchema: { project: projectParam } },
  wrapHandler(C("docs_get_stats"), async ({ project }) => docsTools.docsGetStats(project)),
);

// ── RAG (Retrieval-Augmented Generation) ─────────────────

server.registerTool(
  "docs_search_semantic",
  {
    description: "Semantic search across RAG document index.",
    inputSchema: { project: projectParam, query: z.string(), limit: z.number().optional() },
  },
  wrapHandler(C("docs_search_semantic"), async ({ project, query, limit }) => ragTools.ragSearch(project, query, limit)),
);

server.registerTool(
  "docs_ask",
  {
    description: "Ask a question against the RAG index and receive an LLM-grounded answer.",
    inputSchema: { project: projectParam, question: z.string() },
  },
  wrapHandler(C("docs_ask"), async ({ project, question }) => ragTools.ragAsk(project, question)),
);

server.registerTool(
  "docs_ingest",
  {
    description: "Create a new source and ingest a document into the RAG index.",
    inputSchema: { project: projectParam, title: z.string(), text: z.string(), format: z.string().optional() },
  },
  wrapHandler(C("docs_ingest"), async ({ project, title, text, format }) => ragTools.ragIngestDocument(project, title, text, format)),
);

server.registerTool(
  "docs_rag_sources_list",
  {
    description: "List all RAG document sources.",
    inputSchema: { project: projectParam },
  },
  wrapHandler(C("docs_rag_sources_list"), async ({ project }) => ragTools.ragListSources(project)),
);

server.registerTool(
  "docs_rag_source_get",
  {
    description: "Get a single RAG source by ID.",
    inputSchema: { project: projectParam, sourceId: z.string() },
  },
  wrapHandler(C("docs_rag_source_get"), async ({ project, sourceId }) => ragTools.ragGetSource(project, sourceId)),
);

server.registerTool(
  "docs_rag_source_delete",
  {
    description: "Delete a RAG source by ID.",
    inputSchema: { project: projectParam, sourceId: z.string() },
  },
  wrapHandler(C("docs_rag_source_delete"), async ({ project, sourceId }) => ragTools.ragDeleteSource(project, sourceId)),
);

server.registerTool(
  "docs_rag_reingest",
  {
    description: "Re-ingest an existing RAG source with new text content.",
    inputSchema: { project: projectParam, sourceId: z.string(), text: z.string(), format: z.string().optional() },
  },
  wrapHandler(C("docs_rag_reingest"), async ({ project, sourceId, text, format }) => ragTools.ragReingest(project, sourceId, text, format)),
);

server.registerTool(
  "docs_rag_stats",
  {
    description: "Get RAG index statistics (document count, chunk count, etc.).",
    inputSchema: { project: projectParam },
  },
  wrapHandler(C("docs_rag_stats"), async ({ project }) => ragTools.ragStats(project)),
);

// ── Providers ──────────────────────────────────────────

server.registerTool(
  "provider_list",
  { description: "List all available LLM providers from OpenCode", inputSchema: { project: projectParam } },
  wrapHandler(C("provider_list"), async ({ project }) => providerTools.providerList(project)),
);

server.registerTool(
  "provider_connect",
  {
    description: "Connect a provider with an API key",
    inputSchema: {
      project: projectParam,
      providerId: z.string(),
      key: z.string(),
      metadata: z.string().optional(),
    },
  },
  wrapHandler(C("provider_connect"), async ({ project, providerId, key, metadata }) =>
    providerTools.providerConnect(project, providerId, key, metadata)),
);

server.registerTool(
  "provider_disconnect",
  { description: "Disconnect a provider", inputSchema: { project: projectParam, providerId: z.string() } },
  wrapHandler(C("provider_disconnect"), async ({ project, providerId }) => providerTools.providerDisconnect(project, providerId)),
);

server.registerTool(
  "provider_status",
  { description: "Get provider connection status (keys redacted)", inputSchema: { project: projectParam } },
  wrapHandler(C("provider_status"), async ({ project }) => providerTools.providerStatus(project)),
);

// ── Vault ──────────────────────────────────────────────

server.registerTool(
  "vault_status",
  { description: "Get vault status (sealed/unsealed/error).", inputSchema: { project: projectParam } },
  wrapHandler(C("vault_status"), async ({ project }) => vaultTools.vaultStatus(project)),
);

server.registerTool(
  "vault_unseal",
  {
    description: "Unseal the vault with a passphrase.",
    inputSchema: { project: projectParam, passphrase: z.string() },
  },
  wrapHandler(C("vault_unseal"), async ({ project, passphrase }) => vaultTools.vaultUnseal(project, passphrase)),
);

server.registerTool(
  "vault_seal",
  { description: "Seal (lock) the vault.", inputSchema: { project: projectParam } },
  wrapHandler(C("vault_seal"), async ({ project }) => vaultTools.vaultSeal(project)),
);

server.registerTool(
  "vault_item_list",
  {
    description: "List vault items, optionally filtered by folder.",
    inputSchema: { project: projectParam, folder: z.string().optional() },
  },
  wrapHandler(C("vault_item_list"), async ({ project, folder }) => vaultTools.vaultItemList(project, folder)),
);

server.registerTool(
  "vault_item_create",
  {
    description: "Create a new vault item (password, note, etc.).",
    inputSchema: {
      project: projectParam,
      name: z.string(),
      type: z.string(),
      value: z.string(),
      folderId: z.string().optional(),
      tags: z.string().optional(),
      urls: z.string().optional(),
      username: z.string().optional(),
    },
  },
  wrapHandler(C("vault_item_create"), async ({ project, name, type, value, folderId, tags, urls, username }) =>
    vaultTools.vaultItemCreate(project, name, type, value, folderId, tags, urls, username)),
);

server.registerTool(
  "vault_item_get",
  {
    description: "Get a vault item by ID (metadata only — no secret value).",
    inputSchema: { project: projectParam, itemId: z.string() },
  },
  wrapHandler(C("vault_item_get"), async ({ project, itemId }) => vaultTools.vaultItemGet(project, itemId)),
);

server.registerTool(
  "vault_item_update",
  {
    description: "Update a vault item's value.",
    inputSchema: { project: projectParam, itemId: z.string(), value: z.string() },
  },
  wrapHandler(C("vault_item_update"), async ({ project, itemId, value }) => vaultTools.vaultItemUpdate(project, itemId, value)),
);

server.registerTool(
  "vault_item_delete",
  {
    description: "Delete a vault item by ID.",
    inputSchema: { project: projectParam, itemId: z.string() },
  },
  wrapHandler(C("vault_item_delete"), async ({ project, itemId }) => vaultTools.vaultItemDelete(project, itemId)),
);

server.registerTool(
  "vault_password_gen",
  {
    description: "Generate a secure random password.",
    inputSchema: { project: projectParam, length: z.number().optional() },
  },
  wrapHandler(C("vault_password_gen"), async ({ project, length }) => vaultTools.vaultPasswordGen(project, length)),
);

server.registerTool(
  "vault_audit_list",
  {
    description: "List vault audit log entries.",
    inputSchema: { project: projectParam },
  },
  wrapHandler(C("vault_audit_list"), async ({ project }) => vaultTools.vaultAuditList(project)),
);

// ── Backups (10) ────────────────────────────────────────

server.registerTool(
  "backup_create",
  {
    description: "Create a new backup with an optional type (e.g. 'full', 'skills', 'config').",
    inputSchema: { project: projectParam, type: z.string().optional() },
  },
  wrapHandler(C("backup_create"), async ({ project, type }) => backupTools.backupCreate(project, type)),
);

server.registerTool(
  "backup_list",
  {
    description: "List all backups for a project.",
    inputSchema: { project: projectParam },
  },
  wrapHandler(C("backup_list"), async ({ project }) => backupTools.backupList(project)),
);

server.registerTool(
  "backup_get",
  {
    description: "Get a single backup by ID.",
    inputSchema: { project: projectParam, backupId: z.string() },
  },
  wrapHandler(C("backup_get"), async ({ project, backupId }) => backupTools.backupGet(project, backupId)),
);

server.registerTool(
  "backup_download",
  {
    description: "Download a backup archive and write it to a validated path — never returns raw binary.",
    inputSchema: { project: projectParam, backupId: z.string(), outputPath: z.string() },
  },
  wrapHandler(C("backup_download"), async ({ project, backupId, outputPath }) =>
    backupTools.backupDownload(project, backupId, outputPath)),
);

server.registerTool(
  "backup_delete",
  {
    description: "Delete a backup by ID.",
    inputSchema: { project: projectParam, backupId: z.string() },
  },
  wrapHandler(C("backup_delete"), async ({ project, backupId }) => backupTools.backupDelete(project, backupId)),
);

server.registerTool(
  "backup_restore_preview",
  {
    description: "Preview what a restore would do without executing it.",
    inputSchema: { project: projectParam, backupId: z.string() },
  },
  wrapHandler(C("backup_restore_preview"), async ({ project, backupId }) =>
    backupTools.backupRestorePreview(project, backupId)),
);

server.registerTool(
  "backup_restore_start",
  {
    description: "Start a restore operation. Requires confirm=true to proceed.",
    inputSchema: { project: projectParam, backupId: z.string() },
  },
  wrapHandler(C("backup_restore_start"), async ({ project, backupId }) =>
    backupTools.backupRestoreStart(project, backupId)),
);

server.registerTool(
  "backup_restore_status",
  {
    description: "Get the status of a restore operation by job ID.",
    inputSchema: { project: projectParam, jobId: z.string() },
  },
  wrapHandler(C("backup_restore_status"), async ({ project, jobId }) =>
    backupTools.backupRestoreStatus(project, jobId)),
);

server.registerTool(
  "backup_schedule_get",
  {
    description: "Get the current backup schedule configuration.",
    inputSchema: { project: projectParam },
  },
  wrapHandler(C("backup_schedule_get"), async ({ project }) => backupTools.backupScheduleGet(project)),
);

server.registerTool(
  "backup_schedule_set",
  {
    description: "Set/update the backup schedule configuration.",
    inputSchema: { project: projectParam, config: z.record(z.unknown()) },
  },
  wrapHandler(C("backup_schedule_set"), async ({ project, config }) =>
    backupTools.backupScheduleSet(project, config)),
);

// ── Start ───────────────────────────────────────────────

/**
 * Connects the MCP server via stdio transport.
 *
 * Stdio is the transport used by MCP hosts (OpenCode, VS Code, etc.) to
 * communicate with child MCP servers. stdout carries JSON-RPC messages;
 * stderr carries log output. NEVER write to stdout directly.
 */
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

// Graceful shutdown: SIGTERM is sent by the parent process (or Docker) during
// container stop. We must stop child MCP servers (e.g. Thread, Kaban) before
// exiting to avoid orphaned processes.
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down");
  stopAll();
  process.exit(0);
});

// Hard exit on unhandled rejections — the MCP protocol has no error-recovery
// mechanism for a corrupted runtime. Better to restart cleanly via the host.
process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "Unhandled rejection");
  process.exit(1);
});
