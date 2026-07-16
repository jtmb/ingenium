---
title: OpenCode Web/CLI
description: Using the embedded OpenCode Web/CLI dual-mode interface in the Ingenium dashboard.
---

# Usage: OpenCode

## Overview

The dashboard includes an embedded OpenCode service at `/opencode` with a **Web/CLI dual-mode toggle** for interacting with the Ingenium MCP tools. The OpenCode Dashboard embeds Web and CLI modes as iframes. Authentication is handled by the OpenCode Web server's native HTTP Basic Auth (configured via `OPENCODE_SERVER_PASSWORD`). The browser presents a single auth prompt, then caches credentials for the session. Ports 4098 and 4099 are bound to host loopback (127.0.0.1) for security.

## OpenCode Web/CLI Mode Switch

- **Web mode** — Embeds the OpenCode Web UI (`http://localhost:4098/`) in a full-viewport iframe. The session persists across tab navigation with a hidden iframe technique.
- **CLI mode** — Embeds a ttyd terminal (`http://localhost:4099/`) in a full-viewport iframe. The xterm.js terminal connects via `opencode attach http://localhost:4098 --dir /workspace`, sharing the same session state as the Web UI.
- **Mode switch** — A right-edge glass tab (`OpenCodeSwitch` component) toggles between modes. The inactive iframe is hidden via `opacity`/`visibility`/`pointer-events` instead of `display:none` to prevent xterm dimension zeroing. Both iframes remain in the DOM at full viewport size once mounted.
- **Keyboard shortcut**: `Ctrl+Shift+\`` toggles between modes from anywhere on the page.
- **Persistence**: The chosen mode is saved in `localStorage` and restored on page load.

## Terminal Attachment (Direct)

```bash
opencode attach http://localhost:4098 --dir /workspace
```

All sessions (Web iframe, CLI ttyd, direct terminal) share the same backend process state.

## Related Features

- The workspace (`~/repos`) is mounted to `/workspace` in the container via Docker volume.
- The `appuser` has passwordless `sudo` access inside the container for package installation.
- Use the OpenCode interface to interact with all 212 Ingenium MCP tools across 24 categories.
