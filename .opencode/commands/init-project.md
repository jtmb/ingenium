---
description: "Repository-authoritative Ingenium initialization (dry-run or apply)"
agent: ingenium-orchestrator
---

# `/init-project` — deterministic repository sync

Run the extension binary; it calls `repositorySync(worktree, options)` directly.
Do **not** enumerate files into MCP `*_create` calls or hardcode a project name.

## Arguments

Exactly one mode is required:

- `--dry-run` — resolve the validated project identity and preview remote changes;
  it does not provision a project, mutate remote state, or write the local
  manifest.
- `--apply` — resolve/provision the validated project then apply the repository
  projection. The v2 baseline is persisted only after the corresponding API
  confirmation.

Optional scope:

- `--docs-only` — synchronize only `docs/**/*.md`, including repository path,
  hierarchy, hash, managed tags, and RAG contract.
- `--project <name>` — use a validated project name for this invocation. It
  takes precedence over `INGENIUM_PROJECT` and the validated worktree basename.

Use `--help` to print the complete non-interactive CLI contract. In the
production image, the command is available on `PATH` at
`/usr/local/bin/ingenium-init-project`; it does not rely on a workspace
`node_modules/.bin` entry.

## Execution contract

1. From the active worktree, run `ingenium-init-project --dry-run` or
   `ingenium-init-project --apply`; append `--docs-only` for the Docs scope and
   `--project <name>` when an explicit validated target is required.
2. The binary resolves the project with validated `--project` first, then
   validated `INGENIUM_PROJECT`, otherwise a validated worktree basename; it
   never defaults to `global-default`.
3. Report its JSON result. Surface errors without retrying with resource-specific
   create/update loops.

The `all` scope is repository-authoritative for exactly:

- `docs/**/*.md`
- `.opencode/skills/**`
- `.opencode/agents/**` (including linked compatibility mirrors; never the
  immutable broker)
- configured local plugin sources and `.opencode/plugins/**`

Commands, MCP server definitions, project/global config, and any manual or
unmanaged remote resource are not initialization inputs in this workflow.

### Scanner boundaries

- **Skills** include only direct child directories of `.opencode/skills/` that
  contain a regular `SKILL.md` whose frontmatter `name` matches the directory.
  Symlinks, support files/directories without that entry point, and directories
  containing `MIGRATED-TO.md` are excluded.
- **Agents** include complete profiles in an agent category directory or a
  root-level compatibility mirror. Incomplete notes/diagnostics, symlinks, and
  the reserved `ingenium-llm-broker` profile are excluded. A canonical profile
  and its compatibility mirrors must have matching semantic content.
- **Plugins** include only regular `.ts`, `.js`, `.mjs`, or `.cjs` sources from
  `.opencode/plugins/` or paths explicitly listed in the local `opencode.json`
  plugin array. Secret-like paths and secret-like option keys are rejected;
  commands and configuration are not scanned as resources.

The production image must retain the configured plugin source files at their
repository paths. The runtime image therefore packages the extension
distribution plus its configured `auto-observer.ts`, `observer.ts`, and
`resource-sync.ts` sources; replacing those paths with `dist/` paths would
break repository-source identity during onboarding.
