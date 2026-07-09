# AGENTS.md — Ingenium MCP Server Agent Protocol

This is the **Agent Protocol** for the Ingenium MCP Server. Skills are loaded from the Ingenium SQLite database via the MCP server. The skill source files live at `.agents/skills/` for editing.

> 🔴 **Security**: Never commit `THREAD_API_TOKEN` to source. Use `<YOUR_THREAD_API_TOKEN>` placeholder in `opencode.json`.

> **Dashboard**: Skills can be managed through the Ingenium Dashboard at [http://localhost:3000](http://localhost:3000).

---

## 🔴 MANDATORY — Load Skills Before Acting

**Before writing code, running a command, or responding to any request, you MUST load matching skills.** Skills contain 🔴 HARD RULEs that override everything else.

### Session Startup
1. **Match skills** — Check the catalog against the request and files you might edit
2. **Load matching skills** — Read `.agents/skills/<name>/SKILL.md` for each match
3. **Note 🔴 HARD RULEs** — These take priority over everything else
4. **Run `/repo-context`** for project identity

### Pre-Flight Check

| You're about to... | Check this skill |
|-------------------|-----------------|
| Edit a source file | Framework skill (`nextjs`, `python`, `go`, `rust`, `typescript-standalone`) |
| Run a terminal command | `local-models` — **no `&`, no infinite-wait** |
| Create a new file/service | `project-structure` |
| Write/run tests | `useful-tests` |
| Edit Docker/K8s | `containers` / `kubernetes` |
| Edit shell scripts | `shell-scripts` — `set -euo pipefail` |

### 🔴 MANDATORY Skills (load before ANY action)

`generic-conventions` `local-models` `debugging-patterns` `useful-tests` `project-structure` `error-interpretation` `self-correction-patterns` `skill-load` `api-design` `shell-scripts` `sql-database` `typescript-standalone` `agent-pipelines` `gitignore` `postgresql-optimization` `code-review-checklist` `refactoring-recipes` `cli-toolkit` `regex-reference` `web-design-reviewer` `playwright-mcp` `thread-auto-context` `update-skills` `help`

### 🔴 MANDATORY — Self-Improvement

After ANY code change, you MUST run the applicable self-improvement commands:

| Command | Action |
|---------|--------|
| `/update-skills` | Detects gaps and creates/retires skills |
| `/audit-skills` | Cross-references skills against README, mermaid, skill index |
| `/update-skill-index` | Regenerates `SKILL-INDEX.md` from all skill files |
| All changes | Log via `ingenium_learning_log` MCP tool with `entry_type`, tags, and content |

These are not optional. Skip none of them.

---

## Testing

```bash
bash tests/test-self-improving.sh        # all 5 tests
bash tests/test-self-improving.sh -v     # verbose output
```

Tests: dependency gap detection, missing coverage, skill enumeration, frontmatter validity, manual verification guide.

---


