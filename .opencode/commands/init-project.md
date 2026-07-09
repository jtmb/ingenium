---
description: "Initialize the Ingenium project — sync all skills, agents, and plugins into the DB via MCP tools"
agent: ingenium-orchestrator
---

Initialize this project for Ingenium. Everything is done via MCP tools — no shell, no container access.

## Step 1 — Create the project

```
ingenium_project_init(name="gh-llm-bootstrap")
```
If it already exists, this is harmless (just note it and continue).

## Step 2 — Sync skills from `.opencode/skills/`

1. Use Glob to list skill directories: `ls -d .opencode/skills/*/` or `glob(".opencode/skills/*/SKILL.md")`
2. For each skill directory, extract the name (the directory basename)
3. Call `ingenium_skill_sync(project="gh-llm-bootstrap", name="<skill-name>")` for each
   - This reads `SKILL.md` + `metadata.json` from `.opencode/skills/<name>/` and upserts into the DB
4. Verify: `ingenium_skill_list(project="gh-llm-bootstrap")` — should show 17 skills

## Step 3 — Sync agents from `.opencode/agents/`

1. Use Glob to list agent files: `glob(".opencode/agents/**/*.md")`
2. For each agent file, call `ingenium_agent_sync(project="gh-llm-bootstrap", name="<agent-name>")`
3. Verify: `ingenium_agent_list(project="gh-llm-bootstrap")` — should show 9 agents

## Step 4 — Sync plugins from `seed/plugins/`

1. Read each file in `seed/plugins/` (learnings.ts, planner-handoff.ts, post-tool-use.ts, session-start.ts)
2. Call `ingenium_plugin_create(project="gh-llm-bootstrap", name="<name>", filePath=".opencode/plugins/<name>.ts", sourceContent="<content>")` for each
3. Verify: `ingenium_plugin_list(project="gh-llm-bootstrap")` — should show 4 plugins

## Step 5 — Report

Output a table:

| Resource | Count | Status |
|----------|-------|--------|
| Skills | N | ✅/⚠️ |
| Agents | N | ✅/⚠️ |
| Plugins | N | ✅/⚠️ |

Note any failures with the specific name and error.
