---
title: Environment Variables — Comprehensive Reference
description: Canonical reference for all environment variables used across the Ingenium monorepo.
---

# Environment Variables — Canonical Reference

> This is the canonical reference for all environment variables used across the Ingenium monorepo.

---

## All Variables (Alphabetical)

| Variable | Default | Consumed By | Description |
|----------|---------|-------------|-------------|
| `CORS_ORIGIN` | _(legacy single-origin fallback only)_ | ingenium-api | Backward-compatible fallback when `DASHBOARD_ALLOWED_ORIGINS` is unset. New deployments must use the explicit allowlist. |
| `DASHBOARD_ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | dashboard proxy, ingenium-api, supervised launchers | Comma-separated exact HTTP(S) browser origins shared by dashboard-proxy CSRF and API CORS/CSRF. Paths, credentials, fragments, whitespace, and wildcards are rejected. |
| `GOOGLE_OAUTH_CLIENT_ID` | _(required for OAuth)_ | ingenium-email | Google OAuth2 app client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | _(required for OAuth)_ | ingenium-email | Google OAuth2 app client secret |
| `INGENIUM_API_PORT` | `4096` in Docker (`4097` standalone) | ingenium-api | Private Express server listen port; public host API boundary is `127.0.0.1:4097`. |
| `INGENIUM_API_RATE_LIMIT` | `100` | ingenium-api | Max requests per minute per IP |
| `INGENIUM_API_TIMEOUT` | `10000` | ingenium-server | API request timeout in ms |
| `INGENIUM_API_TOKEN` | _(required, no default)_ | entrypoint, API boundary, ingenium-api, dashboard server proxy | Mandatory 32–128 character base64url bearer token. Never store it in tracked `opencode.json`; OpenCode may use the ignored mode-0600 worktree fallback. |
| `INGENIUM_API_TOKEN_FILE` | _(optional bootstrap; container runtime default `/run/ingenium-secrets/api-token`)_ | entrypoint, API boundary, ingenium-api, dashboard, health probe | Protected regular-file source for the API token. Symlinks and unsafe permissions are rejected. |
| `INGENIUM_API_URL` | `http://localhost:4097/api/v1` | ingenium-server | Base URL for API calls from MCP server |
| `INGENIUM_BACKUPS_DIR` | `/app/.ingenium/backups` | ingenium-core, ingenium-api | Backup snapshot storage directory. Empty or whitespace-only values are treated as unset. |
| `INGENIUM_CORE_DB_PATH` | `/app/.ingenium/data` in Docker; host fallback resolves to `.ingenium/data` | core + API | Canonical SQLite database file path; do not create a sibling `data.db` |
| `INGENIUM_DOCS_ROOT` | _(none — required for repo indexing)_ | ingenium-core | Repository root directory for canonical docs indexing. `indexConfiguredDocs()` walks `{root}/docs/**/*.md`, skips symlinks, and rejects paths escaping the root. Used by `POST /api/v1/rag/ingest`. |
| `INGENIUM_EMAIL_ENCRYPTION_KEY` | _(required, no default)_ | ingenium-email, docker-entrypoint.sh | **64 hex characters** (32 bytes) or a **64-character base64url secret** deterministically reduced to an AES-256 key for credential encryption |
| `INGENIUM_GLOBAL_CONFIG_PATH` | `/home/appuser/.config/opencode/` | ingenium-core | Global config path for skills/plugins/commands |
| `INGENIUM_HOME` | `~/.ingenium` | core, supervisord | Ingenium data home directory |
| `INGENIUM_OPENCODE_DB_PATH` | `/var/opencode/opencode.db` | ingenium-api | OpenCode SQLite DB path for extraction engine |
| `INGENIUM_PROJECT` | _(none — required override)_ | @ingenium/extension plugins | **Extension session override.** When set, takes priority over worktree-derived project name. Required when worktree is `/workspace` (container mount). Unlike other vars, this has no code-level default — the resolver throws if it cannot determine a valid project name. Set explicitly in Docker entrypoint for the container's own session. |
| `IMAGE_REVISION` | _(required; `git rev-parse HEAD`)_ | Docker Compose build arg, Docker OCI label | Lowercase 40-character SHA for the checkout being built. Export before every Compose command; it is public image provenance, not a credential. |
| `IMAGE_SOURCE` | `https://github.com/jtmb/ingenium` | Docker Compose build arg, Docker OCI label | Public credential-free HTTPS repository URL recorded as OCI source metadata. |
| `LOG_LEVEL` | `info` | ingenium-server | Pino log level |
| `MS_OAUTH_CLIENT_ID` | _(required for OAuth)_ | ingenium-email | Microsoft OAuth2 app client ID |
| `MS_OAUTH_CLIENT_SECRET` | _(required for OAuth)_ | ingenium-email | Microsoft OAuth2 app client secret |
| `NEXT_PUBLIC_API_URL` | `/api/v1` | ingenium-dashboard | Same-origin API prefix for browser requests; the dashboard server injects the bearer token and does not expose it to the browser. |
| `NODE_ENV` | _(none)_ | services | Node environment (production/development) |
| `OAUTH_REDIRECT_URI` | `http://localhost:3000/mail/oauth/callback` | ingenium-email | OAuth2 callback URL |
| `OBSERVER_CHECK_INTERVAL` | `0` | observer plugin | Session idle check interval, 0 = disabled |
| `OPENCODE_SERVER_PASSWORD` | _(none, required, no default)_ | API proxy, docker-entrypoint.sh | **Required.** Server-side OpenCode proxy guard credential; not used by the loopback-only browser iframe process. |
| `NEXT_PUBLIC_OPENCODE_WEB_URL` | `http://opencode.localhost:3000/` at build time | Docker Compose build args, dashboard bundle | Public root origin embedded by Next.js during image build. Remote/LAN profiles must use an authenticated root HTTPS origin. |
| `NEXT_PUBLIC_OPENCODE_CLI_URL` | `http://cli.localhost:3000/` at build time | Docker Compose build args, dashboard bundle | Public root origin embedded by Next.js during image build. Remote/LAN profiles must use an authenticated root HTTPS origin. |
| `SYNTHESIS_INTERVAL_MS` | `900000` | ingenium-api | Scheduled synthesis interval (15 min), 0 = disabled |
| `USAGE_SYNC_INTERVAL_MS` | `300000` | ingenium-api | Scheduled metadata-only OpenCode usage sync interval (5 min), 0 = disabled. Project ownership always requires an explicit OpenCode mapping; no `global-default` fallback is used. |

---

## Per-Project Mail Settings

| Setting Key | Default | Description |
|-------------|---------|-------------|
| `mail_offline_window` | `500` | Max email headers to sync per folder |
| `mail_body_window` | `200` | Max email bodies to cache per folder |
| `mail_sync_interval_ms` | `300000` | Round-robin cadence between folder syncs (5 min) |
| `synthesis_interval_ms` | `900000` | Synthesis pipeline interval (15 min), 0 = disabled |

---

## 🔴 Rules

1. **Every new `process.env` reference** MUST be added in the same commit.
2. **Every variable** must list its default value (or note if none).
3. **Every variable** must list which file(s) or service(s) use it.
4. **Never delete a row** without checking all references first.
5. **CI enforces** VARIABLES.md exists and has an entry for every `process.env` call.
