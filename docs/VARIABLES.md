# VARIABLES — Environment Variables

All environment variables used across the Ingenium monorepo. Any new variable added to the codebase MUST be documented here in the same commit.

---

## Core (`packages/ingenium-core`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `INGENIUM_CORE_DB_PATH` | `./.ingenium/data.db` | `db.ts`, all tool modules | Path to the SQLite database file |
| `INGENIUM_HOME` | `~/.ingenium` | `tools/projects.ts` | Base directory for project data storage |
| `LOG_LEVEL` | `info` | `logger.ts` | Pino log level (`debug`, `info`, `warn`, `error`) |
| `NODE_ENV` | — | `logger.ts` | If `production`, JSON logging; otherwise pretty-print |
| `INGENIUM_GLOBAL_CONFIG_PATH` | `/home/appuser/.config/opencode/` | `tools/paths.ts` | Global config path for skills/plugins/commands; overridable to custom directory |
| `INGENIUM_PROJECT` | `global-default` | extension plugins (`observer-core.ts`, `skill-sync.ts`, `onboarding-sync.ts`, `auto-observer.ts`) | Project name for extension plugins to write to (container = `global-default`, external = derived from worktree directory name) |

## API (`services/ingenium-api`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `INGENIUM_API_PORT` | `4097` | `config/index.ts` | Port the Express API server listens on |
| `INGENIUM_API_RATE_LIMIT` | `100` | `lib/middleware/rate-limit.ts` | Max requests per minute per IP |
| `INGENIUM_API_TOKEN` | _(none)_ | `lib/middleware/auth.ts` | Optional bearer token for API authentication |
| `CORS_ORIGIN` | `*` | `config/index.ts` | Allowed CORS origin for browser requests |
| `INGENIUM_CORE_DB_PATH` | _(uses core default)_ | all route handlers | Path to the SQLite database |
| `SYNTHESIS_INTERVAL_MS` | `900000` | `scheduler.ts` | Scheduled synthesis + extraction interval (15 min), 0 = disabled |
| `INGENIUM_OPENCODE_DB_PATH` | `/var/opencode/opencode.db` | extraction engine | OpenCode SQLite DB path for the server-side extraction engine. Mounted read-write in Docker. |

## MCP Server (`services/ingenium-server`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `INGENIUM_API_URL` | `http://localhost:4097/api/v1` | `config/index.ts`, `lib/client.ts` | URL of the API server to call |
| `INGENIUM_API_TIMEOUT` | `10000` | `config/index.ts` | HTTP request timeout in milliseconds |
| `LOG_LEVEL` | `info` | `lib/logger.ts` | Log level for the MCP server |
| `OBSERVER_CHECK_INTERVAL` | `0` | observer plugin | Session idle check interval in ms, 0 = disabled |

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
| `INGENIUM_EMAIL_ENCRYPTION_KEY` | _(required)_ | `oauth.ts`, `accounts.ts` | 32-byte hex key for AES-256-GCM credential encryption |
| `OAUTH_REDIRECT_URI` | `http://localhost:3000/mail/oauth/callback` | `oauth.ts` | OAuth2 callback URL for Gmail/Outlook |

## Docker / opencode-web

Inside the container, **supervisord** manages three processes: API (:4097), Dashboard (:3000), and opencode-web (binds 0.0.0.0:4098 inside container, published 127.0.0.1:4098 on host).

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `OPENCODE_SERVER_PASSWORD` | _(none, required for Docker)_ | `scripts/docker-entrypoint.sh` | Entrypoint guard — verifies the environment is configured |
| `INGENIUM_CORE_DB_PATH` | `./.ingenium/data.db` | Core `db.ts` | Path to the SQLite database (must map volume in Docker) |
| `THREAD_API_TOKEN` | _(none)_ | OpenCode config | API token for Thread MCP server |

---

## 🔴 Rules

1. **Every new `process.env` reference** in any package MUST be added to this document in the same commit.
2. **Every variable** must list its default value (or note if none).
3. **Every variable** must list which file(s) use it.
4. **Never delete a row** without checking all references first.
5. **CI enforces** this document exists and has an entry for every `process.env` call.
