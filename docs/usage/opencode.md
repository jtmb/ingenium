---
title: OpenCode Web and CLI
description: Using the embedded OpenCode Web and CLI interfaces in the Ingenium dashboard.
---

# Usage: OpenCode

## Overview

The dashboard includes an embedded OpenCode service at `/opencode` with a **Web (iframe) and CLI (ttyd iframe) dual-mode interface** for interacting with the Ingenium MCP tools. The dashboard root (`http://localhost:3000/`), Web root (`http://opencode.localhost:3000/`), and CLI root (`http://cli.localhost:3000/`) are local Windows↔WSL gateway roots and do not use HTTP Basic Auth or browser bearer tokens. Direct host ports 4098/4099 are private and are not supported.

For the conversational chat interface, see [Ingenium Chat](/chat).

## OpenCode Web/CLI Mode Switch

- **Web mode** — Embeds the root `opencode.localhost:3000` gateway. It is not served under `/opencode-web/`; root-relative assets and WebSockets make a subpath proxy unreliable.
- **CLI mode** — Embeds the root `cli.localhost:3000` gateway. It is not served under `/opencode-cli/`; the terminal shares backend session state with Web mode.
- **Mode switch** — A right-edge glass tab toggles between modes. Inactive iframes are hidden via `opacity`/`visibility`/`pointer-events` instead of `display:none` to prevent xterm dimension zeroing. Both iframes remain in the DOM at full viewport size once mounted.
- **Keyboard shortcut**: `Ctrl+Shift+\`` switches between modes from anywhere on the page.
- **Persistence**: The chosen mode is saved in `localStorage` and restored on page load.
- **Toolbar**: The /opencode page toolbar contains only the Web/CLI mode toggle. Chat navigation is handled through the main navigation bar (not duplicated in the toolbar).

## Terminal Attachment

Direct attachment to host ports 4098 and 4099 is intentionally unavailable; those listeners remain private. Use the local roots on gateway port `3000` (`opencode.localhost:3000` and `cli.localhost:3000`), which Windows reaches through WSL localhost forwarding. For LAN or remote deployments, an operator must provide a separate TLS-authenticated operator profile protecting the dashboard and both dedicated root HTTPS origins, then configure `NEXT_PUBLIC_OPENCODE_WEB_URL` and `NEXT_PUBLIC_OPENCODE_CLI_URL` before rebuilding. The Windows helper only verifies existing gateway reachability and does not configure transport automatically.

The API also requires `INGENIUM_API_TOKEN`. Do not put it in tracked
`opencode.json`/`opencode.jsonc`. The OpenCode MCP extension can use the
ignored, owner-only `.opencode/.ingenium-api-token` fallback (mode `0600`) when
the environment variable is unavailable. Dashboard API calls use a server-side
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

The launcher checks the protected token source and project identity before it
loads the stdio transport. Local sessions derive a validated project name from
their worktree unless `INGENIUM_PROJECT` explicitly overrides it. Docker is the
only `/workspace` session, so its generated OpenCode config explicitly uses
`global-default`. This avoids a clone-specific local project value while never
silently treating an external worktree as the global namespace.

The container also projects its persistent global config at startup so the
`auto-observer`, `observer`, and `resource-sync` plugins all resolve the
owner-only worktree token file. `ingenium-init-project` preflights that bearer
path before it provisions a project or syncs repository resources. The shared
extension project resolver uses the same authenticated preflight before its
initial project provision, with a finite retry only for transient API
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
- Use the OpenCode interface to interact with the built-in 268-tool Ingenium MCP catalog across 28 baseline categories (266 server registrations plus 2 extension tools); project-scoped child discovery can add tools and categories dynamically.
