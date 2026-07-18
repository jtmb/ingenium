---
title: Environment Variables
description: Per-service quick-reference for all environment variables used across the Ingenium monorepo.
---

# Environment Variables — Quick Reference

All environment variables used across the Ingenium monorepo. Any new variable added to the codebase MUST be documented in the same commit.

---

## Core (`packages/ingenium-core`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `INGENIUM_CORE_DB_PATH` | `./.ingenium/data.db` | `db.ts`, all tool modules | Path to the SQLite database file |
| `INGENIUM_HOME` | `~/.ingenium` | `tools/projects.ts` | Base directory for project data storage |
| `LOG_LEVEL` | `info` | `logger.ts` | Pino log level (`debug`, `info`, `warn`, `error`) |
| `NODE_ENV` | — | `logger.ts` | If `production`, JSON logging; otherwise pretty-print |
| `INGENIUM_GLOBAL_CONFIG_PATH` | `/home/appuser/.config/opencode/` | `tools/paths.ts` | Global config path for skills/plugins/commands |
| `INGENIUM_PROJECT` | `global-default` | extension plugins | Project name for extension plugins to write to |

## API (`services/ingenium-api`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `INGENIUM_API_PORT` | `4097` | `config/index.ts` | Port the Express API server listens on |
| `INGENIUM_API_RATE_LIMIT` | `100` | `lib/middleware/rate-limit.ts` | Max requests per minute per IP |
| `INGENIUM_API_TOKEN` | _(none)_ | `lib/middleware/auth.ts` | Optional bearer token for API authentication |
| `CORS_ORIGIN` | `http://localhost:3000` | `config/index.ts` | Allowed CORS origin for browser requests |
| `SYNTHESIS_INTERVAL_MS` | `900000` | `scheduler.ts` | Scheduled synthesis + extraction interval (15 min), 0 = disabled |
| `SYNTHESIS_MODEL` | _(none)_ | `synthesis-llm.ts` | Fallback synthesis model name (used when no provider config is saved in DB) |
| `SYNTHESIS_API_KEY` | _(none)_ | `synthesis-llm.ts` | Fallback synthesis API key (used when no provider config is saved in DB) |
| `SYNTHESIS_ENDPOINT` | _(none)_ | `synthesis-llm.ts` | Fallback synthesis endpoint URL (used when no provider config is saved in DB) |
| `SYNTHESIS_ALLOW_PRIVATE_NETWORK` | `false` | `synthesis-llm.ts` | When `true`, bypasses SSRF protection for the synthesis endpoint. Required for local inference servers (Ollama, LM Studio, vLLM). |
| `INGENIUM_OPENCODE_DB_PATH` | `/var/opencode/opencode.db` | extraction engine | OpenCode SQLite DB path for server-side extraction |

## MCP Server (`services/ingenium-server`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `INGENIUM_API_URL` | `http://localhost:4097/api/v1` | `config/index.ts`, `lib/client.ts` | URL of the API server to call |
| `INGENIUM_API_TIMEOUT` | `10000` | `config/index.ts` | HTTP request timeout in milliseconds |

## Dashboard (`services/ingenium-dashboard`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4097/api/v1` | `src/lib/api.ts` | API URL for the dashboard HTTP client |

## Email (`packages/ingenium-email`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `GOOGLE_OAUTH_CLIENT_ID` | _(required for OAuth)_ | `oauth.ts` | Google OAuth2 app client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | _(required for OAuth)_ | `oauth.ts` | Google OAuth2 app client secret |
| `MS_OAUTH_CLIENT_ID` | _(required for OAuth)_ | `oauth.ts` | Microsoft OAuth2 app client ID |
| `MS_OAUTH_CLIENT_SECRET` | _(required for OAuth)_ | `oauth.ts` | Microsoft OAuth2 app client secret |
| `INGENIUM_EMAIL_ENCRYPTION_KEY` | _(required)_ | `oauth.ts`, `accounts.ts` | **64 hex characters** (32 bytes) for AES-256-GCM credential encryption |
| `OAUTH_REDIRECT_URI` | `http://localhost:3000/mail/oauth/callback` | `oauth.ts` | OAuth2 callback URL for Gmail/Outlook |

## Docker / opencode-web

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `OPENCODE_SERVER_PASSWORD` | _(none, required)_ | `scripts/docker-entrypoint.sh`, `ingenium-api` (OpenCode proxy routes) | **Required.** Server-side API proxy guard credential. The browser-facing OpenCode Web child overrides it to empty and is restricted to host loopback. |
| `OPENCODE_SERVER_URL` | `http://localhost:4098` | `ingenium-api` (opencode client) | Base URL of the OpenCode web server |

> Multer file uploads for `/api/v1/opencode/upload` are stored at `/tmp/ingenium-chat-uploads/`.

## Backups

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `INGENIUM_BACKUPS_DIR` | `/app/.ingenium/backups` | `backup-scheduler.ts`, `routes/backups.ts` | Directory for backup snapshot files (Ingenium + OpenCode DB pairs) |
| `THREAD_API_TOKEN` | _(none)_ | OpenCode config | API token for Thread MCP server. 🔴 **Never commit to source.** |

---

## 🔴 Rules

1. **Every new `process.env` reference** MUST be added to this document in the same commit.
2. **Every variable** must list its default value (or note if none).
3. **Every variable** must list which file(s) use it.
4. **Never delete a row** without checking all references first.
5. **CI enforces** this document exists and has an entry for every `process.env` call.

---

*Comprehensive reference: [Reference/Variables](../reference/variables.md)*
