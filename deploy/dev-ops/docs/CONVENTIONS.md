# Conventions

## Naming

| What | Convention | Example |
|------|-----------|---------|
| **Skill directories** | `{name}-conventions` for frameworks, `{verb}-{noun}` for tasks | `nextjs-conventions`, `update-skills`, `write-docs` |
| **Skill frontmatter `name`** | MUST match directory name exactly | `name: nextjs-conventions` in `.agents/skills/nextjs-conventions/SKILL.md` |
| **Skill frontmatter `description`** | Keyword-rich, one sentence, includes triggers | `"Use when editing **/*.py files. Covers type hints, pytest, ..."` |
| **Bootstrap scripts** | `{purpose}.sh` or `{purpose}-{sub}.sh` | `bootstrap.sh`, `hook-bootstrap.sh` |
| **Test scripts** | `test-{what}.sh` | `test-self-improving.sh` |
| **Hook files** | `{lifecycle-event}.json` | `session-start.json`, `pre-tool-use.json` |
| **Agent files** | `ingenium-{role}.md` | `ingenium-orchestrator.md`, `ingenium-software-engineer.md` |
| **Agent directory structure** | Nested by role | `primary/`, `execution/`, `research/`, `security/` |
| **Doc files** | `UPPERCASE-WITH-DASHES.md` | `ARCHITECTURE.md`, `TECH-STACK.md`, `CONVENTIONS.md` |
| **Plugin files** | `{lifecycle-event}.ts` | `session-start.ts`, `pre-tool-use.ts`, `post-tool-use.ts` |
| **Plugin config** | `tsconfig.json` | `strict: true` with additional strict flags |
| **Learnings entries** | ISO date + topic | `## 2026-07-02 — always-read-agents removed` |

## File Organization

- **One concern per skill.** Each `.agents/skills/{name}/` contains exactly one `SKILL.md`. No bundling — testing rules and styling rules go in separate skills.
- **Each SKILL.md is self-contained.** It should reference other skills by name (e.g., "See `generic-conventions`") rather than duplicating their content.
- **Link to docs, don't duplicate.** Skills reference `docs/ARCHITECTURE.md` etc. instead of copying doc content.
- **`deploy/` has 3 domain variants: `software-dev/` (general engineering), `dev-ops/` (K8s operations), `sec-ops/` (penetration testing). Each variant contains skills/, hooks/, agents/, plugins/, docs/, and config files. The source repo (`.agents/`, `.opencode/`) is the truth; deploy is an output.
- **`tests/` lives at project root** alongside `docs/`, not inside `.agents/`. Tests validate the skill system but are not part of it.
- **`learnings.md` lives in `.agents/skills/`** — it's a development artifact, not a deployable convention.
- **YAML frontmatter is always between `---` fences** on lines 1 and the line before Markdown content. No tabs (spaces only). Colons in descriptions must be inside quotes.

## Error Handling

- **Bash scripts** use `set -euo pipefail` at the top of every script.
- **`inherit_errexit` is ON by default in bash 5.x** — subshells inherit `set -e`, so `$(grep ... | wc -l)` kills the script when grep finds nothing. Fix: `$( { grep ... || true; } | wc -l)`.
- **Test failures are explicit** — `test-self-improving.sh` prints `✓ PASS` or `✗ FAIL` with clear descriptions. No silent failures.
- **Frontmatter errors are silent** — bad YAML doesn't throw errors, it just means the skill won't load. The test suite catches these.

## Thread / Export Conventions

- **Full transcript export is mandatory at session end** — the AI MUST write a comprehensive markdown transcript to `/tmp/opencode/session-{YYYY-MM-DD}-transcript.md` and upload it to Thread via `thread_upload_file` with Tags: `["export", "transcript", "full-session"]`, Priority: 9.
- **This is a 🔴 HARD RULE** in the `thread-auto-context` skill — not optional, not deferrable.
- **Export order**: transcript → session summary → decisions → git state. The transcript is step 0.
- **Tag conventions**: use `export` + `transcript` + `full-session` for transcripts, `export` + `session-state` for summaries, `export` + `decisions` for decision logs, `export` + `git-status` for git state.
- **No duplicates**: before creating entries, search `"export" AND "opencode"` and update existing entries rather than creating new ones.
- **OpenCode detection**: check `$OPENCODE`, `opencode.json`, or `.opencode/` before exporting. Skip if not in OpenCode.

## Git Practices

- **Conventional Commits**: `type(scope): description` format.
  - `feat:` — new skill or feature
  - `refactor:` — restructuring without behavior change
  - `fix:` — bug fix
  - `docs:` — documentation only
  - `chore:` — maintenance (test updates, config changes)
- **Atomic commits**: One logical change per commit. Moving tests/ to root is one commit; updating 5 docs is another.
- **Every commit gets a learnings entry** if it changes skills, agents, hooks, plugins, deploy structure, config, architecture decisions, bug fixes, or discovered patterns.
- **Learnings entries include the commit hash**: `**Commit**: \`f2557f0\`` — verified by `git rev-parse --short HEAD`.
- **Branch naming**: `feature/description`, `fix/description`, `refactor/description`.

## Code Style

### Bash Scripts

- `#!/usr/bin/env bash` shebang
- `set -euo pipefail` at line 2
- Functions use lowercase with underscores: `check_skill_count()`
- Variables: `UPPERCASE` for constants/globals, `lowercase` for locals
- `[[ ]]` for conditionals, never `[ ]`
- `$()` for command substitution, never backticks
- Quote all variable expansions: `"$var"` not `$var`
- `printf` for formatted output, not `echo -e`

### TypeScript (Plugins)

- `import type { Plugin } from "@opencode-ai/plugin"` for plugin SDK imports (type-only imports)
- `const plugin: Plugin = async () => ({ "hook.name": async (...) => { } })` factory function pattern
- All hook parameters are explicitly typed: `input: { tool: string; sessionID: string; callID: string }`, `_input`, `_output`
- Use `_` prefix for unused parameters (TypeScript `noUnusedLocals` / `noUnusedParameters` flags enforce this)
- Null-safe access with `??` operator: `input.args?.join(" ") ?? ""`
- tsconfig must include `strict: true`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`
- Target `ES2022` with `NodeNext` module resolution for ESM compatibility
- Export default the plugin object: `export default plugin`

### Markdown

- ATX-style headers (`#`, `##`) with space after `#`
- Fenced code blocks with language tag: ` ```bash `
- Tables aligned with pipes, not forced to column-align
- Links use reference style only for repeated URLs
- Mermaid diagrams in ` ```mermaid ` fenced blocks

### YAML Frontmatter

```yaml
---
name: skill-name
description: "One sentence. Keyword-rich. Includes when to invoke."
---
```
- `name` must match the parent directory name
- `description` must be one sentence, quoted if it contains colons
- Opening `---` on line 1, closing `---` immediately before body text
- Spaces only (no tabs), UTF-8 encoding

## Orchestration Rules

- **Orchestrator NEVER writes code directly.** ALL code writing is delegated to @ingenium-software-engineer.
- **Orchestrator uses bash ONLY for:** git add/commit/push, git rev-parse, and test/build verification after subagents finish.
- **Every tool call passes the Pre-Action Gate:** "Should a subagent do this?"
- **After every change, @ingenium-docs is spawned** — mandatory, never optional.
- **Every 5 tool calls, a Periodic Self-Audit runs** — checking if delegation rules were followed.
