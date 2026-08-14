import type { AuthorizationPermission } from "./authorization.js";

export type McpPolicyTarget = "installation" | "organization" | "project" | "private";

export interface McpAuthorizationPolicy {
  action: string;
  resource: string;
  permission: AuthorizationPermission;
  target: McpPolicyTarget;
  scopes: readonly string[];
  launcherBinding: "required" | "none";
}

const CHILD_MCP_POLICY: McpAuthorizationPolicy = {
  action: "child-mcp.execute",
  resource: "child-mcp",
  permission: "execute",
  target: "project",
  scopes: ["child-mcp:execute"],
  launcherBinding: "required",
};

const READ = new Set([
  "setting_get", "skill_list", "skill_load", "skill_search", "skill_list_archived", "skill_versions", "skill_lineage_list", "skill_proposal_list", "skill_proposal_page", "skill_proposal_counts", "skill_proposal_get",
  "observation_search", "observation_list", "observation_stats", "observation_get", "personality", "personality_traits", "synthesis_status",
  "task_list", "task_next", "task_search", "task_activity", "task_board_config_get", "task_notifications", "task_get", "task_comments_list", "task_links_list", "task_tree", "coordination_status",
  "plan_search", "plan_list", "context_get", "context_batch_get", "context_conversation_get", "context_conversation_list", "context_message_list", "context_message_search", "context_message_retrieve", "context_message_batch_retrieve", "context_checkpoint_list", "context_checkpoint_get", "context_checkpoint_maintenance_preview", "context_checkpoint_audit_list",
  "project_list", "project_list_archived", "project_detail", "plugin_list", "plugin_get", "plugin_source", "command_list", "command_get", "config_get", "server_list", "mcp_report_get", "agent_list", "agent_get",
  "logs_list", "logs_sources", "email_list", "email_search", "email_read", "email_folders", "email_accounts", "email_patterns", "email_watch_status", "email_summarize", "email_sync_status", "email_attachment_get",
  "job_list", "job_runs", "job_run_logs", "job_get", "pipeline_events", "pipeline_timeline", "service_status", "service_application_detail", "service_process_detail", "service_process_logs", "health_check", "opencode_messages", "dashboard_summary",
  "docs_list_spaces", "docs_get_space", "docs_list_pages", "docs_get_page_tree", "docs_get_page", "docs_search", "docs_get_draft", "docs_list_versions", "docs_get_version", "docs_list_comments", "docs_list_tags", "docs_get_page_tags", "docs_get_backlinks", "docs_list_attachments", "docs_list_templates", "docs_get_template", "docs_get_projects", "docs_get_favorites", "docs_export_space", "docs_trash_list", "docs_attachment_download", "docs_get_stats",
  "docs_search_semantic", "docs_rag_sources_list", "docs_rag_source_get", "docs_rag_stats", "provider_list", "provider_status", "vault_status", "vault_item_list", "vault_item_get", "vault_audit_list",
  "backup_list", "backup_get", "backup_download", "backup_restore_status", "backup_restore_audit_list", "backup_schedule_get",
]);

const ADMIN = new Set([
  "skill_delete", "skill_enable", "skill_disable", "skill_archive", "skill_restore", "skill_rollback", "skill_proposal_approve", "skill_proposal_reject", "skill_proposal_rollback",
  "observation_delete", "observation_delete_by_source", "personality_trait_disable", "personality_trait_delete", "personality_traits_delete_all", "task_delete", "task_link_delete",
  "context_delete", "context_checkpoint_restore", "context_checkpoint_maintenance_authorize", "context_conversation_archive", "context_conversation_unarchive",
  "project_delete", "project_restore", "project_purge", "project_set_global", "project_rename", "project_migrate_workspace",
  "plugin_enable", "plugin_disable", "plugin_delete", "command_delete", "agent_delete", "agent_enable", "agent_disable", "email_account_delete", "email_delete", "job_delete",
  "docs_delete_space", "docs_delete_page", "docs_restore_page", "docs_delete_draft", "docs_restore_version", "docs_delete_comment", "docs_delete_attachment", "docs_delete_template", "docs_trash_purge", "docs_rag_source_delete",
  "vault_unseal", "vault_seal", "vault_item_delete", "backup_delete", "backup_restore_preview", "backup_restore_authorize", "backup_restore_start", "backup_restore_execution_authorize", "backup_restore_execute", "backup_schedule_set",
]);

const EXECUTE = new Set([
  "setting_test_llm", "repository_sync", "skill_sync", "skill_consolidate", "skill_sync_all", "skill_sync_all_preview", "synthesis_run", "synthesis_cross_project", "extraction_run",
  "task_reserve", "task_release", "coordination_update", "coordination_claim", "coordination_release", "config_sync", "server_update", "server_sync_all", "agent_sync",
  "email_send", "email_triage", "email_suggest", "email_draft_response", "email_watch_start", "email_account_test", "email_oauth_url", "email_oauth_exchange", "email_review_draft", "email_sync", "email_watch_stop",
  "job_run", "job_run_cancel", "job_suggest", "docs_ask", "provider_connect", "provider_disconnect", "vault_password_gen",
]);

const PRIVATE = new Set([
  "plan_save", "plan_search", "plan_list", "context_get", "context_update", "context_delete", "context_batch_get", "context_upload_file", "context_conversation_create", "context_conversation_get", "context_conversation_list", "context_message_append", "context_message_list", "context_message_search", "context_message_retrieve", "context_message_batch_retrieve", "context_checkpoint_create", "context_checkpoint_list", "context_checkpoint_get", "context_checkpoint_restore", "context_checkpoint_maintenance_preview", "context_checkpoint_maintenance_authorize", "context_conversation_archive", "context_conversation_unarchive", "context_checkpoint_audit_list",
  "email_list", "email_search", "email_read", "email_send", "email_draft", "email_folders", "email_accounts", "email_triage", "email_suggest", "email_draft_response", "email_patterns", "email_watch_start", "email_watch_status", "email_account_create", "email_account_delete", "email_account_test", "email_oauth_url", "email_oauth_exchange", "email_summarize", "email_review_draft", "email_move", "email_set_flags", "email_delete", "email_sync", "email_sync_status", "email_watch_stop", "email_attachment_get",
]);

const INSTALLATION = new Set([
  "project_list", "project_migrate_workspace", "config_get", "config_set", "config_sync", "logs_list", "logs_sources", "service_status", "service_application_detail", "service_process_detail", "service_process_logs", "health_check", "opencode_messages",
  "provider_list", "provider_connect", "provider_disconnect", "provider_status", "vault_status", "vault_unseal", "vault_seal", "vault_item_list", "vault_item_create", "vault_item_get", "vault_item_update", "vault_item_delete", "vault_password_gen", "vault_audit_list",
  "backup_create", "backup_list", "backup_get", "backup_download", "backup_delete", "backup_restore_preview", "backup_restore_authorize", "backup_restore_start", "backup_restore_execution_authorize", "backup_restore_execute", "backup_restore_status", "backup_restore_audit_list", "backup_schedule_get", "backup_schedule_set",
  "synthesis_cross_project",
  "docs_list_spaces", "docs_get_space", "docs_create_space", "docs_update_space", "docs_delete_space", "docs_list_pages", "docs_get_page_tree", "docs_get_page", "docs_create_page", "docs_update_page", "docs_delete_page", "docs_restore_page", "docs_publish_page", "docs_move_page", "docs_search", "docs_get_draft", "docs_save_draft", "docs_delete_draft", "docs_list_versions", "docs_get_version", "docs_restore_version", "docs_list_comments", "docs_create_comment", "docs_resolve_comment", "docs_delete_comment", "docs_list_tags", "docs_get_page_tags", "docs_add_tag", "docs_remove_tag", "docs_get_backlinks", "docs_list_attachments", "docs_delete_attachment", "docs_list_templates", "docs_get_template", "docs_create_template", "docs_delete_template", "docs_update_template", "docs_link_project", "docs_unlink_project", "docs_get_projects", "docs_toggle_favorite", "docs_get_favorites", "docs_import_pages", "docs_export_space", "docs_trash_list", "docs_trash_purge", "docs_attachment_download", "docs_get_stats", "docs_search_semantic", "docs_ask", "docs_ingest", "docs_rag_sources_list", "docs_rag_source_get", "docs_rag_source_delete", "docs_rag_reingest", "docs_rag_stats",
]);

const PROJECT = new Set([
  "docs_search_semantic", "docs_ask", "docs_ingest", "docs_rag_sources_list", "docs_rag_source_get", "docs_rag_source_delete", "docs_rag_reingest", "docs_rag_stats",
]);

const ORGANIZATION = new Set(["project_init"]);
const UNBOUND = new Set(["project_list", "project_init", "project_delete", "project_restore", "project_list_archived", "project_purge", "project_set_global", "project_rename", "project_detail", "project_migrate_workspace", "health_check"]);
const WRITE = new Set([
  "setting_set", "skill_create", "skill_update", "skill_lineage_create", "skill_proposal_create", "skill_proposal_submit", "observe", "observation_update", "observation_enrich", "personality_set_trait", "personality_trait_dismiss",
  "task_create", "task_move", "task_complete", "task_update", "task_comment", "task_link", "task_board_config_set", "task_subtask_create", "task_comment_edit", "task_comment_react", "task_notification_read", "task_bulk_update",
  "plan_save", "context_update", "context_upload_file", "context_conversation_create", "context_message_append", "context_checkpoint_create", "project_init", "plugin_create", "plugin_update", "command_create", "command_update", "config_set", "server_add", "server_remove", "agent_create", "agent_update",
  "email_draft", "email_account_create", "email_move", "email_set_flags", "job_create", "job_update", "pipeline_event_log", "docs_create_space", "docs_update_space", "docs_create_page", "docs_update_page", "docs_publish_page", "docs_move_page", "docs_save_draft", "docs_create_comment", "docs_resolve_comment", "docs_add_tag", "docs_remove_tag", "docs_create_template", "docs_update_template", "docs_link_project", "docs_unlink_project", "docs_toggle_favorite", "docs_import_pages", "docs_ingest", "docs_rag_reingest", "vault_item_create", "vault_item_update", "backup_create",
  "synthesize_observations", "auto_observe_now",
]);

export function explicitMcpAuthorizationPolicy(toolName: string, category: string): McpAuthorizationPolicy {
  const transportName = toolName.startsWith("ingenium_") ? toolName.slice("ingenium_".length) : toolName;
  if (!READ.has(transportName) && !ADMIN.has(transportName) && !EXECUTE.has(transportName) && !WRITE.has(transportName)) throw new Error(`Missing explicit MCP authorization policy: ${toolName}`);
  const permission: AuthorizationPermission = ADMIN.has(transportName) ? "admin" : EXECUTE.has(transportName) ? "execute" : READ.has(transportName) ? "read" : "write";
  const target: McpPolicyTarget = PRIVATE.has(transportName) ? "private"
    : PROJECT.has(transportName) ? "project"
    : transportName.startsWith("docs_") ? "organization"
    : transportName.startsWith("vault_") ? "project"
    : INSTALLATION.has(transportName) ? "installation"
    : ORGANIZATION.has(transportName) ? "organization"
    : "project";
  const resource = transportName === "repository_sync" ? "repository" : category.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    action: `${resource}.${permission}`,
    resource,
    permission,
    target,
    scopes: [transportName === "repository_sync" ? "repository:sync" : `${resource}:${permission}`],
    launcherBinding: UNBOUND.has(transportName) || target === "installation" ? "none" : "required",
  };
}

export function childMcpAuthorizationPolicy(): McpAuthorizationPolicy {
  return CHILD_MCP_POLICY;
}
