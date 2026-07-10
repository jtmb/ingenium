---
description: "Initialize the Ingenium project — register all skills (with full file tree), agents, and plugins in the DB via MCP tools"
agent: primary/ingenium-orchestrator
---

Initialize this project for Ingenium. Everything is done via MCP tools — no shell, no container access.

> **Note:** Use `*_create` tools, not `*_sync`. The API runs in a remote container where host files aren't accessible. Always read files from the client filesystem with Read/Glob tools, then push content via MCP.

## Step 1 — Create the project

```
ingenium_project_init(name="gh-llm-bootstrap")
```
If project already exists, note it and continue.

## Step 2 — Register skills with full file tree

For each skill directory discovered via `Glob("opencode/skills/*/SKILL.md")`:

### 2a. Read the core files
- **SKILL.md** — full content (includes YAML frontmatter + body)
- **metadata.json** — parse `tags` array and `alwaysApply` boolean

### 2b. Parse frontmatter from SKILL.md
Extract `name:` and `description:` from the YAML frontmatter block (between the `---` delimiters).

### 2c. Build the file_tree JSON
Recursively discover ALL files in the skill directory using `Glob("opencode/skills/<name>/**/*")`. For each file EXCEPT `SKILL.md` and `metadata.json`:
1. Read its content
2. Compute the relative path from the skill directory root (e.g., `references/playwright/setup.md`)
3. Add to a JSON object: `{ "relative/path.md": "file content here" }`

Important: encode the JSON as a string for the MCP parameter.

### 2d. Create the skill

```
ingenium_skill_create(
  project="gh-llm-bootstrap",
  name="<name>",
  description="<description>",
  content="<full SKILL.md content>",
  tags="<comma-separated from metadata.json>",
  always_apply=<0 or 1 from metadata.json>,
  files="<JSON string of file_tree>"
)
```
Skip if the skill already exists (error is fine).

## Step 3 — Register agents

1. `Glob("opencode/agents/**/*.md")` to discover agent files
2. For each:
   a. Read full content
   b. Extract `category` from directory name (primary/, execution/, research/, security/)
   c. Call:
      ```
      ingenium_agent_create(
        project="gh-llm-bootstrap",
        name="<filename-without-.md>",
        content="<full content>",
        category="<category>"
      )
      ```
   d. Skip on error (already exists)

## Step 4 — Register plugins

1. Read each `.ts` file from `.opencode/plugins/`
2. For each:
   ```
   ingenium_plugin_create(
     project="gh-llm-bootstrap",
     name="<filename-without-.ts>",
     filePath=".opencode/plugins/<filename>.ts",
     sourceContent="<full content>"
   )
   ```
3. Skip on error (already exists)

## Step 5 — Report

Compare expected vs registered counts:

| Resource | On Disk | In DB | Status |
|----------|---------|-------|--------|
| Skills | N | N | ✅ / ⚠️ |
| Agents | N | N | ✅ / ⚠️ |
| Plugins | N | N | ✅ / ⚠️ |

List any failures with name + error message.
