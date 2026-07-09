---
description: "Initialize the Ingenium project — sync all skills, agents, and plugins into the DB via MCP tools"
agent: ingenium-orchestrator
---

Initialize this project for Ingenium. Everything is done via MCP tools — no shell, no container access.

## Step 1 — Create the project

```
ingenium_project_init(name="gh-llm-bootstrap")
```
If it already exists (returns an error), note it and continue.

## Step 2 — Sync skills from `.opencode/skills/`

1. Use Glob to discover all skill directories that follow the split-skill format:
   - Pattern: `opencode/skills/*/SKILL.md` — every directory with a `SKILL.md` file
   - Skip any directory whose `SKILL.md` lacks YAML frontmatter (no `---` block with `name:`)
2. For each valid skill directory, extract the name (the directory basename)
3. Call `ingenium_skill_sync(project="gh-llm-bootstrap", name="<name>")` for each
   - This reads `SKILL.md` + `metadata.json` from `.opencode/skills/<name>/` and upserts into the DB
4. Verify: `ingenium_skill_list(project="gh-llm-bootstrap")` — count should match discovered valid skills

## Step 3 — Sync agents from `.opencode/agents/`

1. Use Glob to discover agent files: `opencode/agents/**/*.md`
2. For each, call `ingenium_agent_sync(project="gh-llm-bootstrap", name="<filename-without-.md>")`
   - Skip any that fail (already exist or invalid format)
3. Verify: `ingenium_agent_list(project="gh-llm-bootstrap")` — count should match discovered agents

## Step 4 — Sync plugins from `seed/plugins/`

1. Read each `.ts` file in the project's `seed/plugins/` directory
2. For each, call:
   ```
   ingenium_plugin_create(
     project="gh-llm-bootstrap",
     name="<name>",
     filePath=".opencode/plugins/<name>.ts",
     sourceContent="<full file content>"
   )
   ```
3. Verify: `ingenium_plugin_list(project="gh-llm-bootstrap")` — count should match discovered plugins

## Step 5 — Report

Discover what's on disk vs what's in the DB, then output:

| Resource | On Disk | In DB | Status |
|----------|---------|-------|--------|
| Skills | N | N | ✅ / ⚠️ |
| Agents | N | N | ✅ / ⚠️ |
| Plugins | N | N | ✅ / ⚠️ |

Note any failures with the specific name and error message.
