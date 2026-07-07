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

## API (`services/ingenium-api`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `INGENIUM_API_PORT` | `4097` | `config/index.ts` | Port the Express API server listens on |
| `INGENIUM_API_RATE_LIMIT` | `100` | `lib/middleware/rate-limit.ts` | Max requests per minute per IP |
| `INGENIUM_API_TOKEN` | _(none)_ | `lib/middleware/auth.ts` | Optional bearer token for API authentication |
| `CORS_ORIGIN` | `*` | `config/index.ts` | Allowed CORS origin for browser requests |
| `INGENIUM_CORE_DB_PATH` | _(uses core default)_ | all route handlers | Path to the SQLite database |

## MCP Server (`services/ingenium-server`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `INGENIUM_API_URL` | `http://localhost:4097/api/v1` | `config/index.ts`, `lib/client.ts` | URL of the API server to call |
| `INGENIUM_API_TIMEOUT` | `10000` | `config/index.ts` | HTTP request timeout in milliseconds |
| `LOG_LEVEL` | `info` | `lib/logger.ts` | Log level for the MCP server |

## Dashboard (`services/ingenium-dashboard`)

| Variable | Default | Used By | Description |
|----------|---------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4097/api/v1` | `src/lib/api.ts` | API URL for the dashboard HTTP client |

---

## 🔴 Rules

1. **Every new `process.env` reference** in any package MUST be added to this document in the same commit.
2. **Every variable** must list its default value (or note if none).
3. **Every variable** must list which file(s) use it.
4. **Never delete a row** without checking all references first.
5. **CI enforces** this document exists and has an entry for every `process.env` call.
