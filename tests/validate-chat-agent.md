# ingenium-chat Agent Permission Validation

This document validates that `.opencode/agents/chat/ingenium-chat.md` meets all
permission and security requirements for a read-only conversational agent.

## Validation Against `tests/test-agent-validation.sh`

Run the full agent validation suite:

```bash
bash tests/test-agent-validation.sh -v
```

The chat agent is automatically discovered (as a new `.md` file under
`.opencode/agents/chat/`) and tested against all 10 validation checks.

## Permission Rule Checklist

| # | Rule | Status |
|---|------|--------|
| 1 | `name: ingenium-chat` matches filename stem | ✅ |
| 2 | `mode: primary` | ✅ |
| 3 | `model: deepseek/deepseek-v4-flash` | ✅ |
| 4 | `description` present and accurate | ✅ |
| 5 | `read: allow` — can read file contents | ✅ |
| 6 | `edit: deny` — cannot edit files | ✅ |
| 7 | `write: deny` — cannot create files | ✅ |
| 8 | `bash: deny` — cannot run shell commands | ✅ |
| 9 | `glob: allow` — can search for files | ✅ |
| 10 | `grep: allow` — can search file contents | ✅ |
| 11 | `webfetch: allow` — can fetch web content | ✅ |
| 12 | `playwright_*: deny` — no browser automation | ✅ |
| 13 | `task: {"*": "deny"}` — no subagent spawning | ✅ |
| 14 | Thread mutations all `deny` (create_session, create_entry, bulk_create_entries, update_entry, delete_entry, upload_file) | ✅ |
| 15 | Thread reads all `allow` (read_entries, read_entries_batch, search, get_tags, list_sessions, get_stats) | ✅ |
| 16 | `skill: {"*": "deny"}` — no skill access | ✅ |
| 17 | All Ingenium MCP tool names use single `ingenium_` prefix (no double `ingenium_ingenium_`) | ✅ |
| 18 | No mutating Ingenium tools are allowed (no project/task/skill/email/agent/plugin/config/server mutation tools) | ✅ |
| 19 | Read-only Ingenium tools are allowlisted (~89 tools across health, logs, projects, observations, personality, skills, tasks, plans, plugins, servers, agents, commands, config, email, pipeline, jobs, docs, settings, opencode messages, synthesis status) | ✅ |

## Allowed Ingenium MCP Tool Categories

The agent allowlists only these read-only categories:

| Category | Tools Allowed |
|----------|--------------|
| Service & health | `ingenium_health_check`, `ingenium_logs_list`, `ingenium_logs_sources`, `ingenium_service_status`, `ingenium_service_application_detail`, `ingenium_service_process_detail`, `ingenium_service_process_logs` |
| Dashboard | `ingenium_dashboard_summary` |
| Projects & observations (read) | `ingenium_project_list`, `ingenium_project_list_archived`, `ingenium_project_detail`, `ingenium_observation_list`, `ingenium_observation_stats`, `ingenium_observation_get`, `ingenium_observation_search` |
| Personality (read) | `ingenium_personality`, `ingenium_personality_traits` |
| Skills (read) | `ingenium_skill_list`, `ingenium_skill_load`, `ingenium_skill_search`, `ingenium_skill_list_archived`, `ingenium_skill_versions`, `ingenium_skill_lineage_list`, `ingenium_skill_proposal_list`, `ingenium_skill_proposal_get` |
| Tasks (read) | `ingenium_task_list`, `ingenium_task_next`, `ingenium_task_search`, `ingenium_task_get`, `ingenium_task_activity`, `ingenium_task_comments_list`, `ingenium_task_board_config_get`, `ingenium_task_notifications`, `ingenium_task_links_list`, `ingenium_task_tree` |
| Plans (read) | `ingenium_plan_search`, `ingenium_plan_list` |
| Plugins (read) | `ingenium_plugin_list`, `ingenium_plugin_get`, `ingenium_plugin_source` |
| Servers (read) | `ingenium_server_list` |
| Agents & commands (read) | `ingenium_agent_list`, `ingenium_agent_get`, `ingenium_command_list`, `ingenium_command_get` |
| Config (read) | `ingenium_config_get` |
| Email (read-only) | `ingenium_email_list`, `ingenium_email_search`, `ingenium_email_read`, `ingenium_email_folders`, `ingenium_email_accounts`, `ingenium_email_patterns`, `ingenium_email_watch_status`, `ingenium_email_sync_status`, `ingenium_email_summarize`, `ingenium_email_review_draft`, `ingenium_email_attachment_get` |
| Pipeline (read) | `ingenium_pipeline_events`, `ingenium_pipeline_timeline` |
| Jobs (read) | `ingenium_job_list`, `ingenium_job_runs`, `ingenium_job_run_logs`, `ingenium_job_get`, `ingenium_job_suggest` |
| Docs (read) | All `ingenium_docs_*` read-only tools (list/get/search/export) |
| Settings (read) | `ingenium_setting_get` |
| OpenCode (read) | `ingenium_opencode_messages` |
| Synthesis (read) | `ingenium_synthesis_status` |

## Denied (Mutating) Tool Categories

All of the following are DENIED (not in the allowlist, therefore implicitly
denied by the OpenCode permission model):

| Category | Example Denied Tools |
|----------|---------------------|
| Project mutations | `ingenium_project_init`, `ingenium_project_rename`, `ingenium_project_delete`, `ingenium_project_restore`, `ingenium_project_purge`, `ingenium_project_set_global` |
| Task mutations | `ingenium_task_create`, `ingenium_task_update`, `ingenium_task_delete`, `ingenium_task_move`, `ingenium_task_complete`, `ingenium_task_link`, `ingenium_task_bulk_update`, `ingenium_task_subtask_create`, `ingenium_task_comment`, `ingenium_task_comment_edit` |
| Skill mutations | `ingenium_skill_create`, `ingenium_skill_update`, `ingenium_skill_delete`, `ingenium_skill_enable`, `ingenium_skill_disable`, `ingenium_skill_archive`, `ingenium_skill_restore`, `ingenium_skill_rollback`, `ingenium_skill_sync`, `ingenium_skill_sync_all`, `ingenium_skill_consolidate`, `ingenium_skill_proposal_create`, `ingenium_skill_proposal_submit`, `ingenium_skill_proposal_approve`, `ingenium_skill_proposal_reject`, `ingenium_skill_proposal_rollback`, `ingenium_skill_lineage_create` |
| Email mutations | `ingenium_email_send`, `ingenium_email_draft`, `ingenium_email_draft_response`, `ingenium_email_delete`, `ingenium_email_move`, `ingenium_email_set_flags`, `ingenium_email_account_create`, `ingenium_email_account_delete`, `ingenium_email_account_test`, `ingenium_email_sync`, `ingenium_email_watch_start`, `ingenium_email_watch_stop`, `ingenium_email_triage`, `ingenium_email_suggest`, `ingenium_email_oauth_url`, `ingenium_email_oauth_exchange` |
| Config mutations | `ingenium_config_set`, `ingenium_config_sync` |
| Agent mutations | `ingenium_agent_create`, `ingenium_agent_update`, `ingenium_agent_delete`, `ingenium_agent_enable`, `ingenium_agent_disable`, `ingenium_agent_sync` |
| Command mutations | `ingenium_command_create`, `ingenium_command_update`, `ingenium_command_delete` |
| Plugin mutations | `ingenium_plugin_create`, `ingenium_plugin_update`, `ingenium_plugin_delete`, `ingenium_plugin_enable`, `ingenium_plugin_disable` |
| Server mutations | `ingenium_server_add`, `ingenium_server_remove`, `ingenium_server_update`, `ingenium_server_sync_all` |
| Observation mutations | `ingenium_observation_delete`, `ingenium_observation_delete_by_source`, `ingenium_observation_update`, `ingenium_observation_enrich` |
| Personality mutations | `ingenium_personality_set_trait`, `ingenium_personality_trait_delete`, `ingenium_personality_trait_disable`, `ingenium_personality_trait_dismiss`, `ingenium_personality_traits_delete_all` |
| Synthesis mutations | `ingenium_synthesis_run`, `ingenium_synthesis_cross_project` |
| Extraction | `ingenium_extraction_run` |
| Pipeline | `ingenium_pipeline_event_log` |
| Job mutations | `ingenium_job_create`, `ingenium_job_update`, `ingenium_job_delete`, `ingenium_job_run`, `ingenium_job_run_cancel` |
| Docs mutations | All `ingenium_docs_*` write tools (create, update, delete, move, publish, restore, save_draft, add_tag, remove_tag, create_comment, resolve_comment, delete_comment, create_space, update_space, delete_space, create_template, update_template, delete_template, import_pages, link_project, unlink_project, trash_purge, toggle_favorite, attachment_download) |
| Observe | `ingenium_observe` |
| Settings mutations | `ingenium_setting_set`, `ingenium_setting_test_llm` |
| Project init | `ingenium_project_init` |

## Thread MCP Permission Matrix

| Tool | Permission |
|------|-----------|
| `thread_thread_create_session` | ❌ Deny |
| `thread_thread_create_entry` | ❌ Deny |
| `thread_thread_bulk_create_entries` | ❌ Deny |
| `thread_thread_update_entry` | ❌ Deny |
| `thread_thread_delete_entry` | ❌ Deny |
| `thread_thread_upload_file` | ❌ Deny |
| `thread_thread_read_entries` | ✅ Allow |
| `thread_thread_read_entries_batch` | ✅ Allow |
| `thread_thread_search` | ✅ Allow |
| `thread_thread_get_tags` | ✅ Allow |
| `thread_thread_list_sessions` | ✅ Allow |
| `thread_thread_get_stats` | ✅ Allow |

## Key Security Properties

1. **No side-channel execution**: `task: {"*": "deny"}` prevents spawning
   subagents that could execute mutating operations.
2. **No shell access**: `bash: deny` prevents arbitrary command execution.
3. **No file mutations**: `edit: deny` + `write: deny` prevents all file
   system modifications.
4. **No state mutations**: All Ingenium mutating tools are implicitly denied
   (not allowlisted).
5. **No skill modifications**: `skill: {"*": "deny"}` prevents loading skills
   that could influence behavior.
6. **Auditable allowlist**: Every allowed tool is explicitly listed — there is
   no broad `ingenium_*: allow` that could grant unintended access.
