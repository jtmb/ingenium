# @ingenium/extension

Client-side OpenCode package for connecting to the Ingenium MCP Server.

**Installation:** `npx -y @ingenium/extension`

**Package name:** `@ingenium/extension`

**Shipped plugins:**
- **observer.ts** — Session event handling, observation import, synthesis trigger
- **resource-sync.ts** — Unified SHA-256 manifest-based bidirectional sync for skills, agents, plugins, commands, and config between the API and local `.opencode/`
- **auto-observer.ts** — Thin trigger (~62 lines) that POSTs to `/api/v1/extraction/run` on session idle
- **ponytail/** — Official immutable Ponytail OpenCode checkout pinned to upstream SHA `16f29800fd2681bdf24f3eb4ccffe38be3baec6b` with MIT provenance. It is loaded once from `./packages/ingenium-extension/ponytail/.opencode/plugins/ponytail.mjs` in repository configs; the container uses the equivalent `/app/.../ponytail.mjs` path. The published `@dietrichgebert/ponytail@4.8.4` package is not used because its named export is incompatible with OpenCode 1.18.9. The adapter is prompt-only and provides six `/ponytail*` commands; it adds no MCP tools or permissions.

**MCP server:** `dist/scripts/mcp-server.js` — stdio server with 243 tools. The package's two extension-registered tools bring the complete catalog to 245.

## Repository initialization CLI

The package exposes `ingenium-init-project`. In the production Ingenium image,
the same command is available on `PATH` at
`/usr/local/bin/ingenium-init-project` (targeting the package distribution, not
the prunable workspace `.bin` directory).

```text
ingenium-init-project --dry-run [--docs-only] [--project <name>]
ingenium-init-project --apply [--docs-only] [--project <name>]
```

`--project` is validated and takes precedence over `INGENIUM_PROJECT`, which in
turn takes precedence over the validated worktree basename. The CLI never
defaults to `global-default`.

### Repository scan boundaries

The `all` projection scans only repository-authoritative resources:

- Skills: direct child directories of `.opencode/skills/` with a regular,
  name-matching `SKILL.md`; migrated directories (`MIGRATED-TO.md`), symlinks,
  and support artifacts are skipped.
- Agents: complete category profiles and root-level compatibility mirrors;
  incomplete notes, symlinks, and the reserved `ingenium-llm-broker` are
  excluded. Mirrors must be semantically identical to their canonical profile.
- Plugins: regular `.ts`, `.js`, `.mjs`, or `.cjs` files under
  `.opencode/plugins/` plus sources explicitly listed in the local
  `opencode.json` plugin array. Secret-like paths or option keys are rejected.

Commands, MCP server definitions, and project/global config are outside this
projection. In the production image, configured plugin sources are copied next
to the extension distribution at their repository paths, while
`ingenium-init-project` is exposed through the stable
`/usr/local/bin/ingenium-init-project` path.
