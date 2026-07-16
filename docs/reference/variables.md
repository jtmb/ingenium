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
| `CORS_ORIGIN` | `http://localhost:3000` | ingenium-api | Allowed CORS origin for browser requests |
| `GOOGLE_OAUTH_CLIENT_ID` | _(required for OAuth)_ | ingenium-email | Google OAuth2 app client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | _(required for OAuth)_ | ingenium-email | Google OAuth2 app client secret |
| `INGENIUM_API_PORT` | `4097` | ingenium-api | Express server listen port |
| `INGENIUM_API_RATE_LIMIT` | `100` | ingenium-api | Max requests per minute per IP |
| `INGENIUM_API_TIMEOUT` | `10000` | ingenium-server | API request timeout in ms |
| `INGENIUM_API_TOKEN` | _(none)_ | ingenium-api | Optional bearer token for API authentication |
| `INGENIUM_API_URL` | `http://localhost:4097/api/v1` | ingenium-server | Base URL for API calls from MCP server |
| `INGENIUM_CORE_DB_PATH` | `./.ingenium/data.db` (host) / `/app/.ingenium/data` (container) | core + API | SQLite database file path |
| `INGENIUM_EMAIL_ENCRYPTION_KEY` | _(required, no default)_ | ingenium-email, docker-entrypoint.sh | **64 hex characters** (32 bytes) for AES-256-GCM credential encryption |
| `INGENIUM_GLOBAL_CONFIG_PATH` | `/home/appuser/.config/opencode/` | ingenium-core | Global config path for skills/plugins/commands |
| `INGENIUM_HOME` | `~/.ingenium` | core, supervisord | Ingenium data home directory |
| `INGENIUM_OPENCODE_DB_PATH` | `/var/opencode/opencode.db` | ingenium-api | OpenCode SQLite DB path for extraction engine |
| `INGENIUM_PROJECT` | `global-default` | @ingenium/extension plugins | Project name for extension plugins to write to |
| `LOG_LEVEL` | `info` | ingenium-server | Pino log level |
| `MS_OAUTH_CLIENT_ID` | _(required for OAuth)_ | ingenium-email | Microsoft OAuth2 app client ID |
| `MS_OAUTH_CLIENT_SECRET` | _(required for OAuth)_ | ingenium-email | Microsoft OAuth2 app client secret |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4097/api/v1` | ingenium-dashboard | API base URL for dashboard (browser-side) |
| `NODE_ENV` | _(none)_ | services | Node environment (production/development) |
| `OAUTH_REDIRECT_URI` | `http://localhost:3000/mail/oauth/callback` | ingenium-email | OAuth2 callback URL |
| `OBSERVER_CHECK_INTERVAL` | `0` | observer plugin | Session idle check interval, 0 = disabled |
| `OPENCODE_SERVER_PASSWORD` | _(none, required, no default)_ | OpenCode server, docker-entrypoint.sh | **Required.** Auth password for OpenCode web server |
| `SYNTHESIS_INTERVAL_MS` | `900000` | ingenium-api | Scheduled synthesis interval (15 min), 0 = disabled |
| `THREAD_API_TOKEN` | _(none)_ | OpenCode config | API token for Thread MCP server. 🔴 **Never commit to source.** |

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
