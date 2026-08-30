# @ingenium/extension

Client-side OpenCode package for connecting to the Ingenium MCP Server.

**Installation:** `npx -y @ingenium/extension`

**Package name:** `@ingenium/extension`

**Shipped plugins:**
- **observer.ts** — Session event handling, observation import, synthesis trigger
- **resource-sync.ts** — SHA-256 manifest-based Git-authoritative projection for repository docs, skills, agents, and plugins through authenticated MCP
- **auto-observer.ts** — Thin trigger (~62 lines) that POSTs to `/api/v1/extraction/run` on session idle
- **ponytail/** — Official immutable Ponytail OpenCode checkout pinned to upstream SHA `16f29800fd2681bdf24f3eb4ccffe38be3baec6b` with MIT provenance. It is loaded once from `./packages/ingenium-extension/ponytail/.opencode/plugins/ponytail.mjs` in repository configs; the container uses the equivalent `/app/.../ponytail.mjs` path. The published `@dietrichgebert/ponytail@4.8.4` package is not used because its named export is incompatible with OpenCode 1.18.9. The adapter is prompt-only and provides six `/ponytail*` commands; it adds no MCP tools or permissions.

**MCP server:** `dist/scripts/mcp-server.js` — stdio server with 281 `ingenium_`-prefixed registrations. The package's 2 extension-registered tools bring the built-in catalog to 283 across 30 baseline categories.

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
turn takes precedence over the validated worktree basename. Unsafe explicit
values, unsafe basenames, and the canonical `/workspace` worktree fail closed;
the basename is only a display locator and the credential-issued project UUID
is authoritative. The CLI never defaults to `global-default`.

## Coordination owner recovery provider

`ingenium-coordination-reset reset` first uses exactly one protected owner-secret
file or descriptor. When neither override exists, it reads the fixed ignored
`.opencode/.ingenium-coordination-owner-provider.json` reference. Provision that
reference without passing secret bytes through argv:

```text
ingenium-coordination-reset store --key-file /absolute/protected/key --bundle-directory /absolute/owner-only/directory
```

`store` requires the plaintext source through the protected file/descriptor
override, writes only AES-256-GCM authenticated ciphertext outside the worktree,
and atomically installs the nonsecret reference. The key and bundle must have
separate owner-only mode-`0700` parents and mode-`0600` regular files. The
provider is fixed to `bootstrap-admin@localhost`, project `ingenium`, and
workspace `shared-memory-ingenium`; tampering, wrong keys, symlinks, unsafe
permissions, or binding mismatches fail closed without logging secret material.
`ingenium-coordination-reset reset-learning` uses the same provider and fixed
binding to atomically rotate only the seven-scope learning credential; it does
not reconnect or replace the general coordination credential.

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

### Legacy tombstone cleanup

An `all`-scope repository sync runs `cleanupLegacySkillTombstones()` before the
full skill scan and MCP call. Docs-only sync skips cleanup. Dry-run reports
removable/rejected paths without mutation; apply mode revalidates each candidate,
unlinks only its exact `MIGRATED-TO.md`, and removes the now-empty directory.

Candidates must be contained, non-symlink, marker-only directories with a unique
safe entry in the valid canonical consolidation map, exact marker target/link,
an existing canonical target skill, and the exact regular canonical source-index
path. Malformed, unmapped, nonempty, symlinked, traversal-mapped, or otherwise
unproven candidates fail closed and remain untouched. The consolidation map and
canonical source indexes are preserved.
