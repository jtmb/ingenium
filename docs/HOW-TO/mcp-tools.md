# REFERENCES

 ## 🛠️ Ingenium MCP Tools Reference

- All 73 tools, grouped by what they do. Every tool needs a **project** name (except where noted).

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

---

## 👁️ OBSERVATIONS — Things the AI notices about you

| Tool | What it does |
|------|-------------|
| `ingenium_observe` | Saves a note about how you like things done. Types: correction, preference, pattern, insight, feedback, behavior, terminology, workflow, error, goal. |
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

---

## 🔍 EXTRACTION — Scans chat history

| Tool | What it does |
|------|-------------|
| `ingenium_extraction_run` | Reads recent chat messages, finds candidates with simple rules, then uses AI to pull out real behavior patterns. |

---

## ✅ TASKS — To-do management

| Tool | What it does |
|------|-------------|
| `ingenium_task_create` | Makes a new task (add a description and who it's assigned to). |
| `ingenium_task_list` | Lists tasks (filter by kanban column: todo, in_progress, review, done). |
| `ingenium_task_move` | Moves a task to a different column. |
| `ingenium_task_complete` | Marks a task done. |
| `ingenium_task_next` | Tells you the highest-priority thing to work on next. |

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
| `ingenium_email_suggest` | Suggests how to reply based on past behavior. |
| `ingenium_email_draft_response` | Auto-writes a draft reply and saves to Drafts. |
| `ingenium_email_patterns` | Shows learned email reply styles (skills with category 'email'). |
| `ingenium_email_watch_start` | Starts live email monitoring (IMAP IDLE) for auto-drafting. |
| `ingenium_email_watch_status` | Checks if the email watcher is running. |

---

## 📋 LOGS — System logging

| Tool | What it does |
|------|-------------|
| `ingenium_logs_list` | Shows recent system logs (filter by source, level, or time). |
| `ingenium_logs_sources` | Lists where logs come from (scheduler, API, auto-observer, etc.). |

---

**Grand total: 73 tools in 13 categories.**