---
title: OpenCode Web and CLI
description: Using the embedded OpenCode Web and CLI interfaces in the Ingenium dashboard.
---

# Usage: OpenCode

## Overview

The dashboard includes an embedded OpenCode service at `/opencode` with a **Web (iframe) and CLI (ttyd iframe) dual-mode interface**. The compatibility profile retains its local `.localhost` roots. Production allocates the current user's ready workspace and launches exact `web--<runtime-id>.<runtime-domain>` and `cli--<runtime-id>.<runtime-domain>` HTTPS roots. Direct 4098/4099 ports remain private.

The supported runtime is OpenCode **1.18.9**. Docker verifies the pinned
archive SHA-256 and executable version, while package compatibility tests verify
that the root, extension, and local `.opencode` manifests and lockfiles all
resolve `@opencode-ai/plugin` and `@opencode-ai/sdk` to `1.18.9`. OpenCode
**1.18.3+** is retained as the historical boundary for root-relative assets;
the current contract is tested against 1.18.9.

For the conversational chat interface, see [Ingenium Chat](/chat).

## OpenCode Web/CLI Mode Switch

- **Web mode** — Redeems a browser-generated one-time `web` exchange proof before embedding its runtime HTTPS root.
- **CLI mode** — Redeems a distinct `cli` proof for the same runtime container; it shares process/worktree state, not the Web cookie.
- **Mode switch** — A right-edge glass tab toggles between modes. Inactive iframes are hidden via `opacity`/`visibility`/`pointer-events` instead of `display:none` to prevent xterm dimension zeroing. Both iframes remain in the DOM at full viewport size once mounted.
- **Keyboard shortcut**: `Ctrl+Shift+\`` switches between modes from anywhere on the page.
- **Persistence**: The chosen mode is saved in `localStorage` and restored on page load.
- **Toolbar**: The /opencode page toolbar contains only the Web/CLI mode toggle. Chat navigation is handled through the main navigation bar (not duplicated in the toolbar).

## Terminal Attachment

Direct attachment to host ports 4098 and 4099 is intentionally unavailable; those listeners remain private. Use the local roots on gateway port `3000` (`opencode.localhost:3000` and `cli.localhost:3000`), which Windows reaches through WSL localhost forwarding. For LAN or remote deployments, an operator must provide a separate TLS-authenticated operator profile protecting the dashboard and both dedicated root HTTPS origins, then configure `NEXT_PUBLIC_OPENCODE_WEB_URL` and `NEXT_PUBLIC_OPENCODE_CLI_URL` before rebuilding. The Windows helper only verifies existing gateway reachability and does not configure transport automatically.

The installation API uses `INGENIUM_API_TOKEN` internally, while external OpenCode
MCP uses a scoped credential from the ignored, owner-only
`.opencode/.ingenium-mcp-credential` file (mode `0600`). Do not put plaintext
credentials in tracked `opencode.json`/`opencode.jsonc`. Dashboard API calls use a server-side
proxy that injects the token; browser code never receives it. The loopback API
boundary is `127.0.0.1:4097`. OAuth on `127.0.0.1:1455` reaches Nginx and then
private Express `4096`; the auth middleware allowlists only the exact
unauthenticated `GET /auth/callback` path.

## Ingenium MCP launcher preflight

The tracked local `opencode.json` launches the packaged
`packages/ingenium-extension/dist/scripts/mcp-server.js` artifact, not a
service build path. Build it before starting a local OpenCode session:

```bash
npm run build --workspace=packages/ingenium-extension
```

The launcher checks the scoped credential and explicit project/workspace/worktree
bindings before loading the transport. `INGENIUM_PROJECT` is a display locator;
the API-authorized project UUID is authoritative. The project must exist before
credential issuance because its immutable UUID is part of the credential grant.

The container also projects its persistent global config at startup so the
`auto-observer`, `observer`, and `resource-sync` plugins resolve the owner-only
`.opencode/.ingenium-repository-sync-credential`, while the MCP child resolves
`.opencode/.ingenium-mcp-credential`. `ingenium-init-project` preflights the
repository-sync credential before it syncs repository resources. The shared
extension project resolver uses the same authenticated preflight before its
project attestation, with a finite retry only for transient API
unavailability. Authentication failures fail closed; diagnostics never emit the
token, URL, HTTP detail, response body, or browser-accessible credential data.
Container OpenCode startup also performs a finite authenticated API readiness
check before loading plugins, so a cold API start does not silently consume the
first resource-sync opportunity.

If the Chat MCP drawer reports that Ingenium cannot connect, rebuild the
extension artifact, verify the owner-only token file, and verify the intended
project identity. The drawer deliberately does not reveal upstream paths,
tokens, or transport diagnostics.

Web and CLI sessions share the same backend process state.

In the production profile, Web, CLI, and VS Code processes for one
owner/workspace run in the same isolated `user-runtime` container and share only that
runtime's HOME/worktree/session state. Different runtimes use different containers
and Docker networks. The dashboard reads per-user runtime status, creates an opaque
body-only proof, and receives only the audience launch URL/status from the API. It
never receives the private backend, runtime capability, or runtime session token.
Expired and unavailable states are retryable; iframe, pop-out, and standalone views
use the same exchange, and logout/revoke invalidates reconnects.

### Repository synchronization

The external-worktree path is Git → `@ingenium/extension` resource-sync plugin
→ configured MCP stdio → authenticated API → database. Git is authoritative;
plugins, CLIs, and agents do not access SQLite or call mutation REST directly.
Use `/init-project` and its dedicated MCP repository-sync operation for
repository projection. Do not run `ingenium_skill_sync*` after edits; those are
admin repair/import tools. The deleted legacy skill-sync command is not part of
the workflow.
Rebuild the extension and restart OpenCode after plugin/config changes.

## Ponytail

The supported Ponytail integration is an immutable upstream checkout pinned to
`16f29800fd2681bdf24f3eb4ccffe38be3baec6b` under
`packages/ingenium-extension/ponytail/`; its MIT provenance and file hashes are
in `PROVENANCE.md`. It is loaded once from the project-relative path in local
`opencode.json`, or once from the container-absolute path in the generated
global config. The published `@dietrichgebert/ponytail@4.8.4` package is not
used because its named export is incompatible with OpenCode 1.18.9.

Ponytail contributes six slash commands (`/ponytail`, `/ponytail-audit`,
`/ponytail-debt`, `/ponytail-gain`, `/ponytail-help`, `/ponytail-review`) and
prompt instructions only. It does not expose MCP tools or permissions. The
runtime modes are `off`, `lite`, `full` (default), and `ultra`; the default is
resolved from `PONYTAIL_DEFAULT_MODE`, then the platform Ponytail config file,
then `full`. The active mode is stored in `.ponytail-active` under the
OpenCode config directory and changes apply on the next message. Restart
OpenCode after changing plugin registration.

For installation, hash review, update, and legacy/npm cleanup, see
[Ponytail OpenCode Integration](../configure/plugins.md#ponytail-opencode-integration).

## Context-native file upload

OpenCode can import a protected local export with
`ingenium_context_upload_file`. Its exact schema is:

```text
project, session, file_path, conversation_id?, tags?, priority?
```

The file must be a private regular file below the project-bound
`.ingenium/context-uploads` root and is read once through a descriptor-safe
`O_NOFOLLOW` check. OpenCode export JSON, simple JSON, JSONL/NDJSON, Markdown,
and text are supported. Only visible user and completed assistant messages are
kept. The tool makes one protected internal snapshot handoff and one
transactional import; it is not a public bulk API.

Visibility markers fail closed: `hidden`, `synthetic`, `ignored`, and `ignore`
must be absent or exactly `false`, `0`, `"false"`, or `"0"`. Any other present
value excludes the record, including markers nested in message, author, or
part objects. The descriptor read also compares complete file identity,
including nanosecond timestamps, before and after reading and re-hashes the
same descriptor; same-inode in-place mutation is rejected.

Without `conversation_id`, a new immutable Context conversation is created. An
existing conversation can be adopted only when the imported prefix matches;
replays are idempotent, matching extensions append and refresh the suffix, and
shorter or divergent snapshots are rejected. Imported conversations become
visible in the dashboard `/context` workspace, whose existing search, read, and
batch message surfaces load content explicitly. There is no external Thread
service or bridge, and no current-session/OpenCode-session import tool.

## Gateway boundaries

- **Rate limits are separate**: dashboard traffic uses its own `30r/s` bucket
  with a `60` request burst; OpenCode Web/CLI traffic uses a separate bucket
  with the same limits. Build assets and WebSocket upgrade handshakes use an
  empty rate-limit key, so normal iframe startup traffic does not consume the
  dynamic OpenCode request budget. Each surface still has a shared gateway
  connection cap of 16.
- **Loopback canonicalization**: supported dashboard origins are
  `http://localhost:3000/` and `http://127.0.0.1:3000/`. Direct IPv6 loopback
  navigation (`::1` or `[::1]`) is redirected with `308` to
  `http://localhost:3000/`; this keeps the iframe CSP origin valid because CSP
  does not accept the IPv6 literal form used here. The iframe roots remain
  `opencode.localhost:3000` and `cli.localhost:3000`.
- **Private upstreams**: ports `4098` and `4099` are container-internal only.
  The gateway clears browser authorization, identity, and proxy-chain headers
  before proxying; ttyd receives only the gateway-injected fixed identity.
  The gateway owns the iframe CSP and permits framing only from the supported
  dashboard loopback origins. Never publish the upstream ports as a workaround.
- **CLI WebSocket origin check**: the `/ws` gateway route allows only the
  explicit trusted local origins `http://localhost:3000`,
  `http://127.0.0.1:3000`, and `http://cli.localhost:3000`. Nginx preserves the
  browser `Origin` and derives a matching upstream `Host` before proxying, so
  ttyd's `--check-origin` validation remains enabled. Arbitrary origins are
  rejected with `403`; do not disable origin checking or bypass the gateway.

## Related Features

- The workspace (`~/repos`) is mounted to `/workspace` in the container via Docker volume.
- The `appuser` has passwordless `sudo` access inside the container for package installation.
- Use the OpenCode interface to interact with the built-in 282-tool Ingenium MCP catalog across 30 baseline categories (280 `ingenium_` catalog entries plus 2 extension tools); project-scoped child discovery can add tools and categories dynamically.
