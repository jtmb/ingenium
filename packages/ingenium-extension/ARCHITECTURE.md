# @ingenium/extension — Architecture

## What Runs Where

### CLIENT (Host Machine)
OpenCode runs here. These are client-side processes:

| Process | Type | What it does |
|---------|------|-------------|
| MCP: ingenium | stdio child process | Thin HTTP wrapper — exposes `ingenium_*` tools. ZERO database access. All data flows through API calls. **Part of @ingenium/extension package** (`dist/mcp-server.js`). |
| Plugin: observer.ts | OpenCode plugin | Hooks `session.created` and `session.idle`. Imports observations from file fallback, triggers synthesis pipeline. Writes `observations.md` to `.opencode/skills/`. |
| Plugin: skill-sync.ts | OpenCode plugin | Hooks `session.created` and `session.idle`. Fetches skills from API, writes missing ones to `.opencode/skills/<name>/` (SKILL.md + metadata.json + references/). |
| .opencode/ directory | Local filesystem | Skills, plugins, commands — written by client-side plugins. Read by OpenCode. |

### SERVER (Docker Container)
Container runs via `docker compose up --build`. These are server-side processes managed by supervisord:

| Process | Port | What it does |
|---------|------|-------------|
| ingenium-api | :4097 | Express REST API. Sole database authority. All CRUD operations for skills, plugins, commands, configs, agents, servers, settings, tasks, observations, personality traits, pipeline events, and synthesis pipeline. |
| ingenium-dashboard | :3000 | Next.js 16 App Router frontend. Calls API over HTTP. Zero database access. |
| opencode-server | :4096 | Auth-enabled OpenCode web server |
| opencode-iframe | :4098 | No-auth OpenCode iframe for embedded dashboard use |

### Data Flow

```
  CLIENT (HOST)                          │         SERVER (DOCKER)
                                         │
  OpenCode ──────────────────────────────│─────────────────────────────
  │                                      │
  ├─ Plugin: observer.ts                 │  Supervisord manages:
  │    session.created → import obs      │
  │    session.created → POST /synthesis │  ├─ ingenium-api :4097
  │    writes observations.md locally    │  │  ├─ skills CRUD
  │                                      │  │  ├─ plugins CRUD
  ├─ Plugin: skill-sync.ts              │  │  ├─ synthesis pipeline
  │    session.created → GET /skills     │  │  ├─ scheduler (every N min)
  │    writes to host .opencode/skills/  │  │  ├─ observations
  │                                      │  │  ├─ personality traits
  ├─ MCP: ingenium                      │  │  ├─ pipeline events
  │    HTTP → API :4097                 │  │  └─ sole SQLite authority
  │    exposes ingenium_* tools          │  │
  │                                      │  ├─ dashboard :3000
  └─ .opencode/   ← host filesystem     │  ├─ opencode-server :4096
     ├─ skills/  ← written by plugins   │  └─ opencode-iframe :4098
     ├─ plugins/                        │
     └─ commands/                       │
```

### Key Principles

1. **API is the sole database authority.** Only `ingenium-api` (in the container) imports `ingenium-core` or any SQL library.
2. **MCP server is a thin HTTP wrapper.** `ingenium-server` (client-side, stdio child process) calls the API over HTTP. Zero database access. CI enforces this.
3. **Plugins run client-side with filesystem access.** They write to the host's `.opencode/` directory. They talk to the API over HTTP. They use `INGENIUM_API_URL` env var so they work cross-machine.
4. **Docker container NEVER needs host mounts for `.opencode/`.** All data flows through HTTP API. The container has its own `.opencode/` for server-side skill writes (scheduler sync), but the host's `.opencode/` is populated by client-side plugins.
5. **Cross-machine works.** Set `INGENIUM_API_URL` to the Docker host's address in `opencode.json`. Plugins and MCP server both read this env var.

### Configuration

#### opencode.json (host)
```json
{
  "mcp": {
    "ingenium": {
      "command": ["node", "path/to/mcp-server.js"],
      "environment": {
        "INGENIUM_API_URL": "http://192.168.0.13:4097/api/v1"
      }
    }
  },
  "plugin": [
    "packages/ingenium-extension/observer.ts",
    "packages/ingenium-extension/skill-sync.ts"
  ]
}
```

#### opencode.jsonc (web UI global config)
```json
{
  "mcp": {
    "ingenium": {
      "command": ["node", "/app/services/ingenium-server/dist/scripts/mcp-server.js"],
      "environment": { "INGENIUM_API_URL": "http://localhost:4097/api/v1" }
    }
  },
  "plugin": [
    "/app/packages/ingenium-extension/observer.ts",
    "/app/packages/ingenium-extension/skill-sync.ts"
  ]
}
```
