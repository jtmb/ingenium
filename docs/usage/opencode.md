---
title: OpenCode Web and CLI
description: Using the embedded OpenCode Web and CLI interfaces in the Ingenium dashboard.
---

# Usage: OpenCode

## Overview

The dashboard includes an embedded OpenCode service at `/opencode` with a **Web (iframe) and CLI (ttyd iframe) dual-mode interface** for interacting with the Ingenium MCP tools. The browser-facing OpenCode process disables Basic Auth so the iframe opens without a login prompt. Ports 4098 and 4099 are bound to host loopback (`127.0.0.1`) for security; the API proxy retains its separate server-side password guard.

For the conversational chat interface, see [Ingenium Chat](/chat).

## OpenCode Web/CLI Mode Switch

- **Web mode** — Embeds the OpenCode Web UI in a full-viewport iframe. The iframe `src` is dynamically resolved by `runtime-urls.ts`: loopback HTTP (localhost/127.0.0.1) uses the direct port (`http://localhost:4098/`); LAN HTTP and HTTPS deployments use a same-origin reverse-proxy path (`/opencode-web/`) to avoid mixed-content and cross-origin issues. Overridable via `NEXT_PUBLIC_OPENCODE_WEB_URL` (relative same-origin paths only). The session persists across tab navigation with a hidden iframe technique.
- **CLI mode** — Embeds a ttyd terminal in a full-viewport iframe. URL resolution follows the same pattern: loopback HTTP → `http://localhost:4099/`, LAN HTTP / HTTPS → `/opencode-cli/` (overridable via `NEXT_PUBLIC_OPENCODE_CLI_URL`, relative same-origin paths only). The xterm.js terminal connects via `opencode attach http://localhost:4098 --dir /workspace`, sharing the same session state as the Web UI.
- **Mode switch** — A right-edge glass tab toggles between modes. Inactive iframes are hidden via `opacity`/`visibility`/`pointer-events` instead of `display:none` to prevent xterm dimension zeroing. Both iframes remain in the DOM at full viewport size once mounted.
- **Keyboard shortcut**: `Ctrl+Shift+\`` switches between modes from anywhere on the page.
- **Persistence**: The chosen mode is saved in `localStorage` and restored on page load.
- **Toolbar**: The /opencode page toolbar contains only the Web/CLI mode toggle. Chat navigation is handled through the main navigation bar (not duplicated in the toolbar).

## Terminal Attachment (Direct)

```bash
opencode attach http://localhost:4098 --dir /workspace
```

All sessions (Web iframe, CLI ttyd, direct terminal) share the same backend process state.

## Related Features

- The workspace (`~/repos`) is mounted to `/workspace` in the container via Docker volume.
- The `appuser` has passwordless `sudo` access inside the container for package installation.
- Use the OpenCode interface to interact with all 245 Ingenium MCP tools across 28 categories.
