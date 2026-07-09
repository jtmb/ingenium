---
description: "Initialize the Ingenium project — register all skills, agents, and plugins in the DB via MCP tools"
agent: primary/ingenium-orchestrator
---

Initialize this project for Ingenium. Everything is done via MCP tools — no shell, no container access.

> **Note:** Use `*_create` tools, not `*_sync`. The API runs inside Docker where disk files aren't available. Always read content from the host filesystem with Read tool, then create via MCP.

## Step 1 — Create the project

```
ingenium_project_init(name="gh-llm-bootstrap")
```
If project already exists, note it and continue.

## Step 2 — Register skills from `.opencode/skills/`

1. Use Glob to discover skill directories: `opencode/skills/*/SKILL.md`
2. For each skill directory:
   a. Read `SKILL.md` (full content — includes YAML frontmatter + body)
   b. Read `metadata.json` if it exists (or skip if absent — not all skills have one)
   c. Parse `name:` and `description:` from the YAML frontmatter in SKILL.md
   d. Parse `tags` (comma-separated) and `alwaysApply` from metadata.json
   e. Call:
      ```
      ingenium_skill_create(
        project="gh-llm-bootstrap",
        name="<name>",
        description="<description>",
        content="<full SKILL.md content>",
        tags="<comma-separated tags>",
        always_apply=<0 or 1>
      )
      ```
   f. Skip if already exists (error is fine — that means it was previously created)

## Step 3 — Register agents from `.opencode/agents/`

1. Use Glob to discover agent files: `opencode/agents/**/*.md`
2. For each agent file:
   a. Read the full content
   b. Extract `category` from the file's directory name (primary/, execution/, research/, security/)
   c. Call:
      ```
      ingenium_agent_create(
        project="gh-llm-bootstrap",
        name="<filename-without-.md>",
        content="<full file content>",
        category="<primary|execution|research|security>"
      )
      ```
   d. Skip if error (already exists)

## Step 4 — Register plugins from `seed/plugins/`

1. Read each `.ts` file from the project's `seed/plugins/` directory
2. For each, call:
   ```
   ingenium_plugin_create(
     project="gh-llm-bootstrap",
     name="<filename-without-.ts>",
     filePath=".opencode/plugins/<filename>.ts",
     sourceContent="<full file content>"
   )
   ```
3. Skip if error (already exists)

## Step 5 — Report

| Resource | Expected | Registered | Status |
|----------|----------|------------|--------|
| Skills | (from glob) | (from skill_list) | ✅ / ⚠️ |
| Agents | (from glob) | (from agent_list) | ✅ / ⚠️ |
| Plugins | (from glob) | (from plugin_list) | ✅ / ⚠️ |

List any failures with the specific name and error message.
