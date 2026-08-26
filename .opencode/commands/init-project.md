---
description: "Repository-authoritative Ingenium initialization (dry-run or apply)"
agent: ingenium-orchestrator
---

# `/init-project` — deterministic repository sync

Invoke the dedicated authenticated MCP repository-sync operation. The operation
accepts the verified worktree manifest and applies it through the configured MCP
stdio transport; it is not a direct API/CLI `repositorySync` call and does not
perform direct database synchronization. Do **not** enumerate files into MCP
`*_create` calls or hardcode a project name.

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

The MCP operation exposes the complete non-interactive contract; do not invoke
an extension CLI or API endpoint as a substitute.

## Execution contract

1. From the active worktree, call the dedicated MCP repository-sync operation in
   dry-run or apply mode; append the Docs-only scope and `--project <name>` when
   an explicit validated target is required. The operation is the only supported
   repository projection entry point.
2. The MCP operation resolves the project with validated `--project` first, then
   validated `INGENIUM_PROJECT`, otherwise a validated worktree basename; it
   never defaults to `global-default`.
3. For `all` scope, lineage-proven legacy tombstone cleanup runs before the full
   skill scan and MCP call. Dry-run reports cleanup candidates without deleting
   them. Apply revalidates and removes only an exact `MIGRATED-TO.md` from an
   otherwise empty mapped legacy directory, then removes that directory. The
   consolidation map and canonical source indexes remain untouched. `--docs-only`
   does not run tombstone cleanup.
4. Report its JSON result. Surface errors without retrying with resource-specific
   create/update loops. Rebuild/restart the extension and restart OpenCode when
   the transport or plugin source changes; a repository content change alone is
   consumed by the next sync lifecycle event.

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
  Before an `all`-scope scan, cleanup accepts only candidates proven by the exact
  consolidation mapping, marker text, canonical target, regular source index,
  containment, and marker-only directory shape. Every rejected candidate remains
  untouched with a bounded reason.
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
