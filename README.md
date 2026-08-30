<div align="center">

<img src="docs/assets/logo.svg" alt="Ingenium" width="120" />

# Ingenium

### A local-first, self-hosted AI developer workspace built around OpenCode.

Integrates native AI chat, embedded OpenCode Web/CLI, project management, Kanban tasks, email with AI drafting, documentation workspace with RAG, encrypted secrets vault, scheduled jobs, backup management, service observability, agent profiles, MCP tool management, and a self-learning pipeline — served through a single Docker container.

<p>
  <img src="https://img.shields.io/badge/MCP%20tools-283-blue?style=flat-square" alt="283 MCP tools" />
  <img src="https://img.shields.io/badge/agents-12-orange?style=flat-square" alt="12 agents" />
  <img src="https://img.shields.io/badge/dashboard%20views-24-8A2BE2?style=flat-square" alt="24 dashboard views" />
  <img src="https://img.shields.io/badge/self--learning-%F0%9F%8C%B1-a371f7?style=flat-square" alt="Self-learning" />
</p>

</div>

---

**Ingenium** packages a full AI-enhanced developer workspace into a single container. It combines a Next.js dashboard (24 primary navigation routes plus a 19-tab Settings overlay) with an Express API, an embedded OpenCode instance, and background services — all managed by supervisord. The MCP stdio server is bundled separately in the `@ingenium/extension` package and launched as a child process by the MCP client. Every tool is backed by SQLite with WAL mode and FTS5 full-text search.

Plug any MCP-compatible client (OpenCode, Cline, Claude Desktop) into the extension package and gain 283 catalogued tools — 281 `ingenium_`-prefixed server registrations plus 2 extension-registered tools — covering projects, skills, tasks, mail, secrets, backups, jobs, agents, MCP servers, config, observations, personality traits, the synthesis pipeline, and the documentation workspace.

## What It Brings Together

| Area | Capabilities |
|------|-------------|
| **AI Chat** | Conversational agent interface at `/chat` with session management |
| **OpenCode** | Embedded Web/CLI dual mode through dedicated root gateways on loopback port `3000`; private upstreams remain on `:4098`/`:4099`. Toggle with `Ctrl+Shift+\``; session persists across tabs. Container mounts `~/repos` → `/workspace` |
| **Projects** | Name→UUID multi-project isolation, archive/restore/purge lifecycle, per-project skills and observations |
| **Skills** | 10 canonical skills in split-skill format (SKILL.md + metadata.json + references/) under `.opencode/skills/`. Dashboard split-pane viewer with syntax-highlighted editing, collapsible file tree. Conflict-aware bidirectional sync via SHA-256 manifest |
| **Tasks** | Kanban board (todo → in_progress → review → done) with dependency tracking, priority scoring, full audit history, and 30 MCP tools |
| **Mail** | 3-pane email client — Gmail/Outlook OAuth2 + IMAP/SMTP with OAuth auto/code modes. AI smart replies integrated in the compose panel. 27 MCP tools. Auth-error circuit breaker with degraded-health reporting |
| **Docs & RAG** | Documentation workspace with spaces/pages, templates, version history, trash. Stores deterministic 384-dimensional character-trigram vector embeddings with hybrid BM25/vector scoring; exposed REST search uses FTS5/BM25 full-text for citation-based Q&A |
| **Secrets** | Encrypted vault (scrypt key derivation, AES-256-GCM) with full audit trail of access and mutations |
| **Backups** | SQLite snapshot management with preflight validation, scheduled snapshots, archive retention, download, and RESTORE-100/101 preview, authorization, and fixed-executor handoff |
| **Jobs** | Cron, manual, and bounded trusted-event background agent tasks with real-time log streaming. Natural-language job wizard derives schedule + prompt from a description |
| **Observations** | FTS5-searchable log of 10 observation types from the self-learning pipeline. Full type/status filtering |
| **Personality** | 10 trait dimensions with confidence model (≥0.30 display threshold, time decay, dismiss). Traits inform agent behaviour |
| **Synthesis Pipeline** | API-side extraction engine reads OpenCode messages, regex pre-filter + LLM candidate batching creates observations. Phase 1 consolidates traits; Phase 2 proposes new skills (governed — requires approval). 15-minute autoscheduler with backup provider fallback. Cross-project synthesis shares patterns |
| **Agents** | 12-agent topology: 2 primary + 10 subagents, with model assignment and skill permissions. The hidden LLM broker is system-internal and not counted; the chat compatibility mirror is not a separate agent. |
| **MCP Tools** | 283 catalogued tools in 30 baseline categories: 281 `ingenium_`-prefixed server registrations plus 2 extension tools. Per-tool and per-category enable/disable toggles. Disabled tools return `TOOL_DISABLED` before execution |
| **Plugins** | OpenCode plugin lifecycle (enable, disable, configure) with auto-config sync between DB and `opencode.json` |
| **Config** | Tabbed editor for `opencode.json` (project) and `opencode.jsonc` (global). Sync from disk, save to DB + disk |
| **Logs & Status** | Structured log viewer with level filtering. Supervisord process states, uptime, restart counts |

The self-learning pipeline runs server-side: the extraction engine reads OpenCode messages, uses a regex pre-filter for candidate selection, batches candidates to the synthesis LLM, and creates observations from extracted behaviour rules. The API scheduler runs extraction → synthesis every 15 minutes (configurable via `SYNTHESIS_INTERVAL_MS`). The extension's `resource-sync.ts` plugin separately reconciles disk and API state on `session.created` and throttled `session.idle` events.

> The system **learns from behaviour, not implementation.** Observations track user preferences, corrections, and patterns — not what code was written.

> **Runtime security and builds:** The email watcher can authenticate to the API from a protected token file, so supervised services can run with a cleared environment. Container startup builds the API from the current TypeScript source in the builder stage; it does not rely on partially tracked `dist/` output. Never include credential values in configuration, logs, or diagnostics.

> **Mail durability:** The canonical container database is `/app/.ingenium/data` on the `ingenium-data` named volume. Image rebuilds preserve this volume. Keep the same Compose project name and never use `docker compose down -v` for routine restarts; project-name drift can select a new empty volume. Mail accounts are global shared resources, and encrypted credentials remain usable only when the original `INGENIUM_EMAIL_ENCRYPTION_KEY_FILE` continuity is preserved.

> **Phase 4E credential safety:** OAuth application client secrets are
> vault-backed, global-only, and exposed only as masked metadata. After unseal,
> both supported legacy OAuth secrets are reconciled for the sole active global
> project; encrypted copy creation and decrypt/verification precede source
> removal. `preserve`, non-empty `replace`, and explicit `clear` are supported;
> the dashboard requires confirmation before clearing. Conflicts, source
> failures, and duplicate active-global states fail closed without overwriting
> or deleting the source. OAuth callback diagnostics are redacted.

## Quick Start

```bash
# Clone and start all services
git clone https://github.com/jtmb/ingenium.git
cd ingenium
# Create separate protected installation, OpenCode-proxy, and email-key files.
./scripts/bootstrap-local-secrets.sh
export IMAGE_REVISION="$(git rev-parse HEAD)"
docker compose --profile compatibility up --build
```

Use the same Compose project name for every lifecycle command, for example
`docker compose --profile compatibility -p ingenium up --build -d` and
`docker compose --profile compatibility -p ingenium restart`. Do not create a second
`data.db` file or recreate mail accounts after a
rebuild until the original named volume has been confirmed. See [Deployment](docs/operations/deployment.md), [Mail Usage](docs/usage/mail.md), and [Backup & Restore](docs/operations/backup-restore.md) for recovery and WAL-safe backup guidance.

The installation token is never written to tracked configuration or OpenCode.
Compose mounts its owner-only host file read-only; external OpenCode MCP uses a
separately issued scoped credential. Do not print or commit either value.

**OpenCode global MCP config** — Add to `~/.config/opencode/opencode.jsonc` to make Ingenium available across all your projects:

```jsonc
{
  "mcp": {
    "ingenium": {
      "type": "local",
      "command": ["npx", "-y", "@ingenium/extension"],
      "enabled": true,
      "environment": {
        "INGENIUM_API_URL": "http://localhost:4097/api/v1",
        "INGENIUM_MCP_CREDENTIAL": "{file:.opencode/.ingenium-mcp-credential}",
        "INGENIUM_MCP_CREDENTIAL_FILE": ".opencode/.ingenium-mcp-credential",
        "INGENIUM_API_TIMEOUT": "10000",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

Plugins ship inside the `@ingenium/extension` package. Reference them from your OpenCode config:

```jsonc
{
  "plugin": [
    "packages/ingenium-extension/observer.ts",
    "packages/ingenium-extension/resource-sync.ts",
    "packages/ingenium-extension/auto-observer.ts"
  ]
}
```

**Other MCP clients** — Point your client's `command` to `npx -y @ingenium/extension`. The complete catalog contains 283 baseline tools: 281 `ingenium_`-prefixed server registrations plus 2 extension tools. No HTTP port, no network configuration.

> **Local development under WSL:** OpenCode's MCP client must use a **native Linux Node.js 22** runtime, not Windows `node.exe`/npm interop. Install Node.js 22 with `nvm` or your distribution package manager and ensure its `node` and `playwright-mcp` executables are available on the MCP process `PATH`.
>
> **Restart required:** After modifying MCP server settings in your local `opencode.json`, you must restart OpenCode for the changes to take effect.

**Open the dashboard** — Navigate to `http://localhost:3000` in your browser. In WSL, Windows localhost forwarding reaches the local gateway on host port `3000` without an HTTP Basic Auth prompt. The API boundary on `4097` and OpenCode/VS Code upstreams on `4098`/`4099`/`4100` are not gateway ports and must remain private. Do not use this plain-HTTP local profile for LAN or remote access.

Dashboard browser calls use the same-origin API proxy; the Next.js server uses a
protected dashboard-bootstrap credential only for public bootstrap routes and
never exposes the installation bearer to browser JavaScript. Authenticated API
calls use the browser session. Direct
loopback API traffic uses the authenticated `127.0.0.1:4097` bearer boundary,
which forwards to private Express port `4096` (`401` missing/malformed,
`403` wrong). Dashboard mutations also require the same-origin `Origin` and
`X-Ingenium-UI: dashboard` CSRF contract. The OAuth listener on
`127.0.0.1:1455` permits only `GET /auth/callback`; all other paths are
rejected. API health is a credential-free liveness surface; management routes
remain authenticated, and container health probes use a clean environment
without receiving the installation bearer. See [API Authentication](docs/security/api-authentication.md) for
rotation, token-file lifecycle, and the public-JWT incident release hold.

> **Gateway boundary:** Do not browse to or publish ports 4098/4099/4100. They remain private upstream listeners behind the local port-3000 gateway. OpenCode cannot be served under a dashboard subpath because its root-relative assets and WebSockets require a root origin.

> **Gateway configuration:** `NEXT_PUBLIC_OPENCODE_WEB_URL` and `NEXT_PUBLIC_OPENCODE_CLI_URL` are public browser settings embedded during `docker compose --profile compatibility build`, not runtime-only settings. The default local root origins do not use HTTP Basic Auth. Set both to operator-managed authenticated TLS root origins before rebuilding for remote access. `OPENCODE_SERVER_PASSWORD_FILE` is the required protected server-side credential file in Compose; the inline `OPENCODE_SERVER_PASSWORD` is only a local-development fallback.

> **Windows and remote access:** `scripts/windows-loopback-transport.ps1` is a non-mutating verifier only; it does not create port forwarding, listeners, or firewall rules. Windows secure transport still requires explicit operator setup. Do not claim automatic Windows access is solved. LAN or remote access requires an operator-managed authenticated TLS profile with dedicated root HTTPS origins, configured at build time; there is no subpath fallback.

## Architecture

### Six-Workspace Monorepo

```
ingenium/
├── packages/
│   ├── ingenium-core/        # Shared library: SQLite WAL + FTS5, Zod schemas, tool modules, pipeline events
│   ├── ingenium-email/       # IMAP/SMTP email client (imapflow, nodemailer, mailparser) with OAuth2
│   └── ingenium-extension/   # Client-side npm package: MCP stdio server, plugins (observer, resource-sync, auto-observer)
├── services/
│   ├── ingenium-api/         # Private Express REST API on :4096 behind the authenticated :4097 boundary. Sole database authority.
│   ├── ingenium-server/      # MCP stdio server — 281 prefixed registrations. Calls API via HTTP. Zero DB access.
│   └── ingenium-dashboard/   # Next.js 16 App Router frontend. Calls API via HTTP. Zero DB access.
├── seed/
│   ├── skills/               # Canonical skill sources in split-skill format
│   └── plugins/              # Seed plugin .ts files
├── .opencode/
│   ├── skills/               # Skills written to disk from DB
│   ├── plugins/              # Plugin .ts files synced from DB
│   ├── agents/               # Agent profiles by category
│   └── commands/             # OpenCode custom commands
├── docs/                     # Documentation (concepts, configure, develop, operations, reference, security, usage)
├── docker-compose.yml
└── Dockerfile
```

### Data Paths

```
  HOST (OpenCode)                     DOCKER CONTAINER
  ─────────────                       ────────────────

  Browser ──HTTP──►  Dashboard (:3000) ──HTTP──┐
                                                ▼
  MCP Client ──stdio──► MCP Server ──HTTP──► API (:4097)
  (OpenCode, Cline,                              │
   Claude Desktop)                     ┌─────────┴──────────┐
                                       ▼                    ▼
                                  SQLite (WAL+FTS5)    Providers (LLM)
                                       ▲
                                  ┌────┴────┐
                             Extraction    Email
                             Engine        Engine
```

- **Browser → Dashboard → API → Core/Email → SQLite/Providers**: All frontend data flows through the API.
- **MCP Client → stdio Server → API**: The MCP server (`ingenium-server`, part of the extension package) is a thin HTTP wrapper — zero database access. CI enforces this.
- **Only `packages/ingenium-core` and `services/ingenium-api` may import SQL libraries.** Gating CI scripts verify this constraint.

## Deployment

Single-container compatibility deployment via `docker compose --profile compatibility up --build`. Supervisord manages nine active processes:

| Process | Port (Container) | Published | Description |
|---------|-----------------|-----------|-------------|
| API boundary | `:4097` | `127.0.0.1:4097` | Authenticated loopback bearer boundary |
| Express API | private `:4096` | not published | REST gateway and sole DB authority |
| Dashboard | private `:3001` | not published | Next.js dashboard behind the local gateway |
| Nginx gateway | `:3000` | `3000:3000` | Local dashboard and root gateways; reachable from Windows through WSL localhost forwarding |
| Restore handoff | no network port | not published | Fixed Unix-socket restore-maintenance handoff |
| OpenCode internal auth proxy | private `:4101` | not published | API-only Basic-auth proxy to OpenCode Web |
| OpenCode Web | internal `:4098` | `http://opencode.localhost:3000` | Local root gateway; private upstream, do not publish 4098 |
| ttyd OpenCode CLI | internal `:4099` | `http://cli.localhost:3000` | Local root gateway; private upstream, do not publish 4099 |
| code-server | internal `:4100` | `http://vscode.localhost:3000` | VS Code root gateway; private upstream, do not publish 4100 |

Only host port `3000` is the browser-facing local gateway for the default dashboard, OpenCode, and VS Code roots. The gateway also listens on `127.0.0.1:1455` for the exact OAuth callback path and forwards it to private Express `:4096`. The supported dashboard origins are `http://localhost:3000/` and `http://127.0.0.1:3000/`; the default virtual host also supports Windows-to-WSL forwarded host headers. Nginx proxies the dashboard host plus `opencode.localhost`, `cli.localhost`, and `vscode.localhost` to their private upstreams without HTTP Basic Auth. The bearer API boundary remains on loopback `127.0.0.1:4097` for MCP clients; do not publish or forward it as a browser gateway. The dashboard does not use `/opencode-web/` or `/opencode-cli/` subpath proxies. Remote/LAN deployments are not enabled by the default Compose profile: an operator must provide an authenticated TLS operator profile protecting the dashboard and dedicated root HTTPS origins, set the public origins, then rebuild.

After changing build-time origins, gateway configuration, or image contents, run `docker compose --profile compatibility up --build -d` and verify the running gateway roots. After changing only runtime secrets, recreate/restart the service so the runtime and workspace token files are reseeded; no image rebuild is needed. Host MCP setup can run `./scripts/bootstrap-local-secrets.sh`, which creates ignored mode-0600 files and refuses mismatches. If the new deployment cannot be verified, roll back to the last known-good image and configuration rather than exposing `4096`, `4098`, `4099`, `4100`, or `4101`. Never disclose token bytes in diagnostics.

The API image follows a clean-build path: generated `dist/` directories are excluded from the Docker build context, the builder compiles the checked-in source, and the API launcher runs the resulting build. This prevents stale or partial tracked artifacts from determining which server code starts.

The MCP stdio server is not a supervisord process — it is bundled in the `@ingenium/extension` package and launched as a child process by the MCP client (OpenCode, Cline, etc.). MCP requests are forwarded over HTTP to the API.

**Key Docker details:**
- Build-time UID matching ensures write access to the workspace bind mount (`~/repos` → `/workspace`)
- Nginx runs as unprivileged `ingenium-gateway`; image and startup validation check the writable runtime paths and execute `nginx -t` as that user. Access logs are disabled, and warning-level errors use the ephemeral `/run/ingenium-gateway/nginx-error.log` file shared with Supervisor.
- Volumes: `ingenium-data` (`/app/.ingenium`), `opencode-config` (`/home/ingenium-opencode/.config`), `opencode-data` (`/home/ingenium-opencode/.local`)
- The `synthesis-engine` and `email-client` are in-process scheduled tasks in the API Express process, not supervisord processes
- The image does not grant passwordless `sudo`; runtime package installation is not a deployment capability

## Documentation

| Topic | Document |
|-------|----------|
| Architecture | [docs/concepts/architecture.md](docs/concepts/architecture.md) |
| Tech Stack | [docs/concepts/tech-stack.md](docs/concepts/tech-stack.md) |
| Conventions | [docs/concepts/conventions.md](docs/concepts/conventions.md) |
| Self-Learning Pipeline | [docs/concepts/self-learning.md](docs/concepts/self-learning.md) |
| Skill System | [docs/concepts/skill-system.md](docs/concepts/skill-system.md) |
| Environment Variables | [docs/develop/variables.md](docs/develop/variables.md) |
| Database Migrations | [docs/develop/database.md](docs/develop/database.md) |
| API Reference | [docs/develop/api.md](docs/develop/api.md) |
| Getting Started | [docs/operations/getting-started.md](docs/operations/getting-started.md) |
| Backup & Restore | [docs/operations/backup-restore.md](docs/operations/backup-restore.md) |
| Jobs | [docs/operations/jobs.md](docs/operations/jobs.md) |
| Logs | [docs/operations/logs.md](docs/operations/logs.md) |
| Agent Profiles (configure) | [docs/configure/agents.md](docs/configure/agents.md) |
| MCP Servers (configure) | [docs/configure/mcp-servers.md](docs/configure/mcp-servers.md) |
| Plugins (configure) | [docs/configure/plugins.md](docs/configure/plugins.md) |
| Projects (configure) | [docs/configure/projects.md](docs/configure/projects.md) |
| Synthesis (configure) | [docs/configure/synthesis.md](docs/configure/synthesis.md) |
| Dashboard Usage | [docs/usage/dashboard.md](docs/usage/dashboard.md) |
| Mail Usage | [docs/usage/mail.md](docs/usage/mail.md) |
| Tasks Usage | [docs/usage/tasks.md](docs/usage/tasks.md) |
| OpenCode Usage | [docs/usage/opencode.md](docs/usage/opencode.md) |
| Multi-session OpenCode | [docs/usage/multi-session.md](docs/usage/multi-session.md) |
| Docs Workspace Usage | [docs/usage/docs-workspace.md](docs/usage/docs-workspace.md) |
| Chat Usage | [docs/usage/chat.md](docs/usage/chat.md) |
| Secrets Usage | [docs/usage/secrets.md](docs/usage/secrets.md) |
| MCP Tools Reference | [docs/reference/mcp-tools.md](docs/reference/mcp-tools.md) |
| Database Migrations Reference | [docs/reference/database-migrations.md](docs/reference/database-migrations.md) |
| Docs Workspace Reference | [docs/reference/docs-workspace.md](docs/reference/docs-workspace.md) |
| Extension Architecture | [docs/concepts/architecture.md](docs/concepts/architecture.md#resource-sync-engine) |
| Dashboard Styling Guide | [services/ingenium-dashboard/STYLING-GUIDE.md](services/ingenium-dashboard/STYLING-GUIDE.md) |
| Agent Protocol | [AGENTS.md](AGENTS.md) |

## How Major Systems Work

### MCP Tool System
Built-in server tools use a single `ingenium_` prefix: `ingenium_<noun>_<verb>` (e.g., `ingenium_skill_list`, `ingenium_task_create`). Transport registrations in the MCP server are unprefixed (`skill_list`); the catalog maps them automatically to the `ingenium_` form. The two extension-registered plugin tools are `synthesize_observations` and `auto_observe_now`. The complete catalog contains 283 tools: 281 `ingenium_`-prefixed server registrations plus those 2 extension tools. It is defined in `packages/ingenium-core/lib/tools/mcp-tool-catalog.ts` and verified by a parity test that ensures every registered transport has a catalog entry and vice versa.

### Skill System
Skills live at `.opencode/skills/<name>/` in split-skill format: `SKILL.md` (rules + patterns), `metadata.json` (name, description, file type triggers, framework detection, slash commands), and `references/` (supporting files). The `file_tree` column in the DB stores a JSON map of relative paths → content for complete data round-trips. The `resource-sync.ts` plugin uses a SHA-256 hash manifest for conflict-aware bidirectional sync on `session.created` and `session.idle`.

### Self-Learning Pipeline
1. **Extraction** (server-side): The extraction engine reads OpenCode messages, applies a regex pre-filter for candidate selection, batches candidates to the synthesis LLM, and creates observations from extracted behaviour rules.
2. **Trait consolidation** (Phase 1): Observations are consolidated into 10 personality trait dimensions with a confidence model (start at 0.10–0.15, +0.15 per confirmation, cap at 0.95, display ≥0.30).
3. **Skill synthesis** (Phase 2): The synthesis LLM may propose new skills based on accumulated patterns. Proposals are governed — they enter the system as proposals requiring review, not automatic mutation.
4. **Scheduling**: The API runs extraction → synthesis every 15 minutes. Extension session events trigger resource sync separately.
5. **Cross-project synthesis**: Patterns are evaluated across all projects via `ingenium_synthesis_cross_project`.

### Email Integration
The mail engine supports Gmail/Outlook OAuth2 (auto and code modes) plus generic IMAP/SMTP. OAuth state is consumed on first use to prevent replay attacks. Noreply senders are gated before any cache lookup. The smart-reply cache uses `ON CONFLICT DO UPDATE` (never `INSERT OR REPLACE`). After 3 consecutive auth failures on a folder, the folder transitions to `error` with a re-authentication message, and service health reports `degraded`.

Mail account settings migrate from legacy project scopes to the active global
project transactionally. The migration verifies the destination before deleting
source rows, leaves collisions untouched, and skips safely when encryption-key
continuity cannot be verified. Reconnect is preferred over account deletion.
Provider errors are reduced to safe stable codes/messages before responses or
logs; raw provider URLs, headers, bodies, and credential-bearing messages are
never retained.

### Docs & RAG
The documentation workspace provides spaces, pages with version history, templates, comments, and trash with purge. Full-text search uses FTS5 and BM25 ranking — the system also stores deterministic 384-dimensional character-trigram vector embeddings for hybrid BM25/vector scoring, but the exposed REST search and Q&A retrieval use BM25. The Q&A system retrieves document chunks by BM25 score, cites source passages, and answers from those passages without generative hallucination.

### Project Identity
Ingenium uses a two-project identity model:
- **`global-default`** (`is_global=1`): The container's own OpenCode session, created at startup.
- **External sessions**: Named after their repo worktree (e.g., `gh-llm-bootstrap`). The `INGENIUM_PROJECT` env var controls which project the extension writes to. Never defaults to `global-default` in code — the resolver explicitly throws if it cannot determine a valid project name.

## Development

Ingenium runs in Docker for all environments. Start the compatibility profile with:

```bash
export IMAGE_REVISION="$(git rev-parse HEAD)"
docker compose --profile compatibility up --build
```

Run tests and checks inside the running container:

```bash
docker compose --profile compatibility exec ingenium npm test          # All tests
docker compose --profile compatibility exec ingenium npm run typecheck # Type-check across workspaces
docker compose --profile compatibility exec ingenium npm run lint      # Lint
```

Individual workspace tests:

```bash
npm run test --workspace=packages/ingenium-core          # Core unit tests (vitest)
npm run test --workspace=packages/ingenium-extension     # Extension tests (vitest)
npm run typecheck --workspace=packages/ingenium-extension # Extension type check (tsc --noEmit)
npx playwright test --config=tests/playwright.config.ts                 # Default isolated fixture E2E (production mode)
npx tsx tests/test-artifact-retention.ts preview                        # Read-only telemetry-retention preview
```

The default E2E run owns an isolated temporary database/project, production
API/dashboard processes, a chat fixture, and a per-run high-port block. Phase
5E validates a run manifest and retained stopping/telemetry evidence, uses
allowlisted child environments, keeps the API test bearer on the API
process/readiness request only, isolates the dashboard credential in a
protected token file, verifies dynamic process/port cleanup, and runs the
strict containment audit. Manifestless stale processes require manual,
identity-checked recovery; stale or unowned artifacts are retained. Docker-backed, real-provider, live-mail, and manual visual
suites are explicit opt-in runs; a skipped or unselected suite is not a pass.
See the [Testing Guide](docs/develop/testing.md) for required
`RUN_DASHBOARD_*` flags, endpoint overrides, orphan recovery, strict audits,
dynamic-port checks, token-file isolation, and run-scoped artifact rules. Store
runner telemetry under `tests/artifacts/test-runs/<run-id>/` and screenshots
only under `tests/artifacts/visual-qa/<run-id>/` or
`tests/artifacts/manual/<date>/`.

Telemetry retention is preview-only by default. Persist an owner-only plan with
`report`; `execute` accepts only that plan plus its exact `--confirm-sha256`
digest, and `verify` checks the resulting content-free receipt. Automatic
eligibility is limited to resolved, failure-free UUID run telemetry older than
30 days with no manifest, process, open port, auxiliary file, or unsafe path.
Never run `execute` against evidence that has not been reviewed in the preview.

Validation scripts:

```bash
bash tests/test-self-improving.sh        # Self-learning pipeline tests
bash tests/enforce-no-db-leaks.sh         # CI gate — no DB access outside core/api
bash tests/test-agent-validation.sh       # Agent profile validation
bash tests/test-append-only-files.sh      # Append-only file constraint check
```

## Project Status

Ingenium is an evolving local-first developer workspace in active development. The architecture is stable (six-package monorepo, API-first, WAL-mode SQLite), and the feature set covers daily development workflows. Most features are fully functional; some areas carry specific caveats:

- **Backup restore**: Snapshot creation, integrity validation, scheduling, retention, and download are implemented. RESTORE-100 validates and stages a plan; RESTORE-101 separately authorizes and queues the fixed root-only `restore-maintenance` executor through the Unix-socket Supervisor handoff. API/MCP never apply snapshot bytes directly.
- **RAG**: Uses FTS5/BM25 full-text search with citation-based Q&A. Stores deterministic 384-dimensional character-trigram embeddings with hybrid BM25/vector scoring internally; exposed retrieval uses BM25.
- **Jobs**: Cron and manual execution with real-time log streaming. Trusted-event delivery is implemented for the three Context maintenance events, with exact same-project matching, five bounded attempts using 30/60/120/300/600-second backoffs, and terminal dead-lettering.
- **Skill synthesis**: The pipeline can propose new skills from accumulated patterns; proposals are governed (reviewed before adoption), not automatically applied.
- **Email**: Office 365/Outlook OAuth2 is supported alongside Gmail and generic IMAP/SMTP. Calendar, contacts, and OneDrive integration are not part of the mail feature.
- **Observations**: Extractions run automatically on the server side. Manual `ingenium_observe` calls are only needed for exceptional cases.

See the [documentation](#documentation) map above for in-depth guides on each subsystem.
