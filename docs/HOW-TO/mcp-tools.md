# REFERENCES

 ## 🛠️ Ingenium MCP Tools Reference

- All **150 tools** across **23 categories**, grouped by what they do. Every tool needs a **project** name (except where noted).
- The canonical catalog (source of truth) lives at `packages/ingenium-core/lib/tools/mcp-tool-catalog.ts`.
  If you see a discrepancy between this document and the catalog, the catalog wins.

## 📁 PROJECTS — Managing workspaces

| Tool | What it does |
|------|-------------|
| `ingenium_project_list` | Shows all your projects. **No project needed.** |
| `ingenium_project_init` | Creates a brand new project. **No project needed.** |
| `ingenium_project_delete` | Deletes a project forever. **No project needed.** |
| `ingenium_project_restore` | Brings back an archived project. |
| `ingenium_project_list_archived` | Shows deleted/archived projects. |
| `ingenium_project_purge` | Permanently wipes old projects. |
| `ingenium_project_set_global` | Makes a project shared across everything. |

---

## 📝 SKILLS — Guides the AI uses to work

| Tool | What it does |
|------|-------------|
| `ingenium_skill_list` | Lists every skill. |
| `ingenium_skill_load` | Opens one specific skill. |
| `ingenium_skill_search` | Searches through all skills. |
| `ingenium_skill_create` | Makes a brand new skill. |
| `ingenium_skill_update` | Changes an existing skill. |
| `ingenium_skill_delete` | Removes a skill forever. |
| `ingenium_skill_enable` | Turns a skill ON (writes it to disk). |
| `ingenium_skill_disable` | Turns a skill OFF (removes from disk). |
| `ingenium_skill_sync` | Saves disk file changes back to the database. |
| `ingenium_skill_consolidate` | Triggers LLM-driven skill audit — merges redundant skills to stay under 20 total. |

---

## 👁️ OBSERVE — Log notes about user behavior

| Tool | What it does |
|------|-------------|
| `ingenium_observe` | Saves a note about how you like things done. Types: correction, preference, pattern, insight, feedback, behavior, terminology, workflow, error, goal. |

## 👁️ OBSERVATIONS — Things the AI notices about you

| Tool | What it does |
|------|-------------|
| `ingenium_observation_search` | Searches past observations. |
| `ingenium_observation_list` | Lists observations (filter by status or type). |
| `ingenium_observation_stats` | Shows how many observations exist (total, pending, processed). |

---

## 🧠 PERSONALITY — Your preferences & habits

| Tool | What it does |
|------|-------------|
| `ingenium_personality` | Shows your full personality profile. |
| `ingenium_personality_traits` | Lists specific personality traits (optionally by type). |

---

## ⚙️ SYNTHESIS — Turns observations into skills & traits

| Tool | What it does |
|------|-------------|
| `ingenium_synthesis_run` | Processes pending observations into personality traits and skill updates. |
| `ingenium_synthesis_status` | Checks if synthesis is running (pending count, last run, processed count). |
| `ingenium_synthesis_cross_project` | Finds patterns across all your projects and shares them. |
| `synthesize_observations` | Process all pending observations through the synthesis pipeline (returns JSON summary). |

---

## 🔍 EXTRACTION — Scans chat history

| Tool | What it does |
|------|-------------|
| `ingenium_extraction_run` | Reads recent chat messages, finds candidates with simple rules, then uses AI to pull out real behavior patterns. |
| `auto_observe_now` | Thin trigger — tells the API to scan OpenCode messages and extract observations. |

---

## 🩺 PIPELINE — Observability timeline

| Tool | What it does |
|------|-------------|
| `ingenium_pipeline_events` | List pipeline events with optional source/type/limit filters. |
| `ingenium_pipeline_timeline` | Get grouped timeline with parent-child nesting. |
| `ingenium_pipeline_event_log` | Log a new pipeline event with type, source, title, and optional parent/session/importance. |

---

## 📶 STATUS — Service health & process monitoring

| Tool | What it does |
|------|-------------|
| `ingenium_service_status` | Get overall service health — supervisord process states + application health. |
| `ingenium_service_application_detail` | Get detailed status for a specific application (email-client or synthesis-engine). |
| `ingenium_service_process_detail` | Get single process detail via supervisor process info. |
| `ingenium_service_process_logs` | Read process logs with byte-size cap (max 10KB). |

---

## ❤️ HEALTH — API health check

| Tool | What it does |
|------|-------------|
| `ingenium_health_check` | Quick health check — returns API status and uptime. No project param needed. |

---

## 💬 OPENCODE — Message access

| Tool | What it does |
|------|-------------|
| `ingenium_opencode_messages` | Read recent user messages from the OpenCode DB (used by the extraction engine). |

---

## ✅ TASKS — Full task management (Kanban)

| Tool | What it does |
|------|-------------|
| `ingenium_task_create` | Makes a new task (add a description and who it's assigned to). |
| `ingenium_task_list` | Lists tasks (filter by kanban column: todo, in_progress, review, done). |
| `ingenium_task_move` | Moves a task to a different column. |
| `ingenium_task_complete` | Marks a task done. |
| `ingenium_task_next` | Tells you the highest-priority thing to work on next. |
| `ingenium_task_update` | Update task fields (title, description, priority, assignee). |
| `ingenium_task_delete` | Delete a task by ID. |
| `ingenium_task_search` | Full-text search across all tasks. |
| `ingenium_task_comment` | Add a comment to a task (optionally threaded). |
| `ingenium_task_activity` | Get the activity feed for a task. |
| `ingenium_task_link` | Link two tasks together (blocks, relates_to, duplicates). |
| `ingenium_task_board_config_get` | Get board configuration (columns, custom fields). |
| `ingenium_task_board_config_set` | Set board configuration. |
| `ingenium_task_subtask_create` | Create a subtask under an existing parent task. |
| `ingenium_task_notifications` | List task notifications for a recipient. |
| `ingenium_task_get` | Get a single task by ID. |
| `ingenium_task_comments_list` | List all comments for a task. |
| `ingenium_task_comment_edit` | Edit an existing task comment. |
| `ingenium_task_comment_react` | Add a reaction to a task comment. |
| `ingenium_task_links_list` | List all task links. |
| `ingenium_task_link_delete` | Delete a task link. |
| `ingenium_task_tree` | Get the full task tree (parent + subtasks + linked tasks). |
| `ingenium_task_notification_read` | Mark a notification as read. |
| `ingenium_task_bulk_update` | Bulk update multiple tasks with the same fields. |

---

## 📋 PLANS — Saved notes & context

| Tool | What it does |
|------|-------------|
| `ingenium_plan_save` | Saves a note with optional tags and priority. |
| `ingenium_plan_search` | Searches through saved notes. |
| `ingenium_plan_list` | Lists all saved notes. |

---

## 🔌 PLUGINS — Add-ons that change how things work

| Tool | What it does |
|------|-------------|
| `ingenium_plugin_list` | Lists all plugins. |
| `ingenium_plugin_get` | Shows details of one plugin. |
| `ingenium_plugin_create` | Installs a new plugin (give it a path to the file). |
| `ingenium_plugin_update` | Changes a plugin's file path or source code. |
| `ingenium_plugin_delete` | Removes a plugin forever. |
| `ingenium_plugin_enable` | Turns a plugin ON. |
| `ingenium_plugin_disable` | Turns a plugin OFF. |
| `ingenium_plugin_source` | Fetches a plugin's source content from disk. |

---

## ⌨️ COMMANDS — Shortcuts like /synthesize

| Tool | What it does |
|------|-------------|
| `ingenium_command_list` | Lists all commands. |
| `ingenium_command_get` | Shows one command by name. |
| `ingenium_command_create` | Makes a new command (give it a name, file path, and content). |
| `ingenium_command_update` | Changes a command's file path or content. |
| `ingenium_command_delete` | Removes a command. |

---

## ⚡ SETTINGS — Configuration values

| Tool | What it does |
|------|-------------|
| `ingenium_setting_get` | Reads one setting by key. |
| `ingenium_setting_set` | Writes one setting by key + value. |
| `ingenium_setting_test_llm` | Tests the configured synthesis LLM connection. |

---

## 🗂️ CONFIG — Project & global config files

| Tool | What it does |
|------|-------------|
| `ingenium_config_get` | Shows your opencode.json config (project or global). |
| `ingenium_config_set` | Changes your config (saves to database AND disk). |
| `ingenium_config_sync` | Grabs config from disk and saves to database. |

---

## 🖥️ SERVERS — Child MCP servers

| Tool | What it does |
|------|-------------|
| `ingenium_server_list` | Lists all child MCP servers. |
| `ingenium_server_add` | Adds a new MCP server (give it a name, command, and optional args/env). |
| `ingenium_server_remove` | Removes an MCP server. |
| `ingenium_server_update` | Updates a server's running state. |
| `ingenium_server_sync_all` | Bulk sync all server definitions for a project. |

---

## 🤖 AGENTS — AI sub-personalities

| Tool | What it does |
|------|-------------|
| `ingenium_agent_list` | Lists all agents (filter by category). |
| `ingenium_agent_get` | Opens one agent by name. |
| `ingenium_agent_create` | Makes a new agent with YAML content. |
| `ingenium_agent_update` | Changes an agent's metadata or content. |
| `ingenium_agent_delete` | Removes an agent forever. |
| `ingenium_agent_enable` | Turns an agent ON (writes its .md file to disk). |
| `ingenium_agent_disable` | Turns an agent OFF (removes its .md file from disk). |
| `ingenium_agent_sync` | Saves disk file changes back to the database. |

---

## 📧 EMAIL — Full email management via MCP

| Tool | What it does |
|------|-------------|
| `ingenium_email_list` | Shows emails in a folder (inbox, sent, etc.). |
| `ingenium_email_search` | Searches emails by keyword, sender, subject, or date. |
| `ingenium_email_read` | Opens one email by its unique ID. |
| `ingenium_email_send` | Writes and sends an email (HTML formatting, CC, BCC). |
| `ingenium_email_draft` | Saves a draft without sending. |
| `ingenium_email_folders` | Lists all email folders for an account. |
| `ingenium_email_accounts` | Lists connected email accounts. |
| `ingenium_email_triage` | Sorts your inbox by priority and suggests actions. |
| `ingenium_email_suggest` | Suggests 3 AI-drafted reply options (concise, warm, formal) based on past sent-email patterns. Gated to new/unread emails only. Falls back to template-based suggestions if no LLM is configured. |
| `ingenium_email_draft_response` | Auto-drafts a response to an email based on learned patterns and saves it to Drafts folder. Uses same LLM-driven or template fallback as suggest. |
| `ingenium_email_patterns` | Shows learned email reply styles (skills with category 'email'). |
| `ingenium_email_watch_start` | Starts live email monitoring (IMAP IDLE) for auto-drafting. |
| `ingenium_email_watch_status` | Checks if the email watcher is running. |
| `ingenium_email_account_create` | Creates a new email account connection. |
| `ingenium_email_account_delete` | Deletes an email account and clears cached data. |
| `ingenium_email_account_test` | Tests IMAP connection for an account. |
| `ingenium_email_oauth_url` | Gets OAuth authorization URL (NEVER returns tokens). |
| `ingenium_email_oauth_exchange` | Exchanges OAuth code for tokens (NEVER returns tokens — only success/failure). |
| `ingenium_email_summarize` | Gets LLM-generated email summary (cache-first). |
| `ingenium_email_review_draft` | Reviews and improves a draft via LLM (uncached). |
| `ingenium_email_move` | Moves an email to another folder. |
| `ingenium_email_set_flags` | Sets flags on an email. |
| `ingenium_email_delete` | Deletes an email (moves to Trash). |
| `ingenium_email_sync` | Triggers engine-backed sync. |
| `ingenium_email_sync_status` | Gets per-folder sync status. |
| `ingenium_email_watch_stop` | Stops the IMAP IDLE watcher. |
| `ingenium_email_attachment_get` | Downloads an email attachment to a validated safe path. |

---

## 📋 LOGS — System logging

| Tool | What it does |
|------|-------------|
| `ingenium_logs_list` | Shows recent system logs (filter by source, level, or time). |
| `ingenium_logs_sources` | Lists where logs come from (scheduler, API, auto-observer, etc.). |

---

## ⏰ JOBS — Background scheduled tasks

| Tool | What it does |
|------|-------------|
| `ingenium_job_list` | Lists all jobs. |
| `ingenium_job_create` | Creates a new job with schedule, trigger event, and timeout. |
| `ingenium_job_update` | Updates an existing job. |
| `ingenium_job_delete` | Removes a job. |
| `ingenium_job_run` | Manually triggers a job run. |
| `ingenium_job_runs` | Lists all runs for a job. |
| `ingenium_job_run_logs` | Gets logs from a specific run. |
| `ingenium_job_run_cancel` | Cancels a running job. |
| `ingenium_job_get` | Gets a single job by ID. |
| `ingenium_job_suggest` | Derives job config from a natural-language description using the Synthesis LLM. |

---

## 🔮 OBSERVATIONS — Extended pipeline control

| Tool | What it does |
|------|-------------|
| `ingenium_observation_get` | Gets a single observation by ID. |
| `ingenium_observation_update` | Updates observation status or importance. |
| `ingenium_observation_enrich` | Enriches raw observations via LLM. |
| `ingenium_observation_delete` | Hard deletes a single observation. |
| `ingenium_observation_delete_by_source` | Bulk deletes all observations for a source (requires confirm=true). |

---

## 🧠 PERSONALITY — Extended trait management

| Tool | What it does |
|------|-------------|
| `ingenium_personality_set_trait` | Upserts a trait (used by synthesis pipeline). |
| `ingenium_personality_trait_dismiss` | Dismisses a trait (sets inactive without deleting). |
| `ingenium_personality_trait_disable` | Disables a trait (harder deactivation). |
| `ingenium_personality_trait_delete` | Hard deletes a single personality trait. |
| `ingenium_personality_traits_delete_all` | Deletes ALL personality traits for project (requires confirm=true). |

---

## 📂 PROJECTS — Extended management

| Tool | What it does |
|------|-------------|
| `ingenium_project_rename` | Renames a project. |
| `ingenium_project_detail` | Gets detailed info about a project by name. |

---

## 🛠️ SKILLS — Extended management

| Tool | What it does |
|------|-------------|
| `ingenium_skill_sync_all` | Syncs ALL skills disk↔DB for a project. |

---

**Grand total: 150 tools in 23 categories.**