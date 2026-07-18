# AGENTS.md — Ingenium MCP Server Agent Protocol

This is the **Agent Protocol** for the Ingenium MCP Server. Skills live at `.opencode/skills/<name>/` with a split-skill format (SKILL.md + metadata.json + references/).

> 🔴 **Security**: Never commit API tokens to source. Use placeholder values in config files.

> 🔴 **Never state a fact without verifying against source files.** If you claim "X uses Y", you must have READ the file containing X. If you claim "Z imports W", you must have GREP'd for the import. If you cannot verify in one read or grep, say "I'm not sure — let me check" instead of guessing confidently.

> **Dashboard**: Skills, plugins, agents, projects, and commands can be managed through the Ingenium Dashboard at [http://localhost:3000](http://localhost:3000).

---

## Quick Reference

| Section | Description |
|---------|-------------|
| [🔴 HARD RULEs](#-hard-rules-summary) | Non-negotiable rules |
| [Repository Structure](#repository-structure) | Package and service layout |
| [🔴 Orchestration Policy](#-orchestration-policy--12-active--6-writer-phase-scheduler) | 12-active/6-writer concurrency, writer tiers, phase declarations |
| [Database Isolation](#-mandatory--database-isolation) | DB access boundaries |
| [Docker Deployment](#docker-deployment) | Ports, volumes, health |
| [Testing](#testing) | Test commands |
| [Documentation Map](#documentation-map) | Where to find detailed docs |

## Documentation Map

| Topic | Canonical Document |
|-------|-------------------|
| Getting Started | [docs/operations/getting-started.md](docs/operations/getting-started.md) |
| Architecture | [docs/concepts/architecture.md](docs/concepts/architecture.md) |
| Tech Stack | [docs/concepts/tech-stack.md](docs/concepts/tech-stack.md) |
| Conventions | [docs/concepts/conventions.md](docs/concepts/conventions.md) |
| Environment Variables | [docs/develop/variables.md](docs/develop/variables.md) |
| Database Migrations | [docs/develop/database.md](docs/develop/database.md) |
| Self-Learning Pipeline | [docs/concepts/self-learning.md](docs/concepts/self-learning.md) |
| Skill System | [docs/concepts/skill-system.md](docs/concepts/skill-system.md) |
| Security | [docs/security/index.md](docs/security/index.md) |
| Usage Guides | [docs/usage/index.md](docs/usage/index.md) |
| Configuration Guides | [docs/configure/index.md](docs/configure/index.md) |
| Operations Guides | [docs/operations/index.md](docs/operations/index.md) |
| Development Reference | [docs/develop/index.md](docs/develop/index.md) |
| Reference Docs | [docs/reference/index.md](docs/reference/index.md) |
| API Reference | [docs/develop/api.md](docs/develop/api.md) |
| MCP Tools Reference | [docs/reference/mcp-tools.md](docs/reference/mcp-tools.md) |
| Docs Workspace | [docs/reference/docs-workspace.md](docs/reference/docs-workspace.md) |
| Context Memory | [docs/concepts/architecture.md](docs/concepts/architecture.md#context-memory-architecture-phase-3) |
| RAG Indexing | [docs/concepts/architecture.md](docs/concepts/architecture.md#rag-indexing-architecture-phase-3) |

---

## 🔴 MANDATORY — Load Skills Before Acting

**Before writing code, running a command, or responding to any request, you MUST load matching skills.** Skills contain 🔴 HARD RULEs that override everything else.

### Session Startup
1. **Match skills** — Check the catalog against the request and files you might edit
2. **Load matching skills** — Read `.opencode/skills/<name>/SKILL.md` for each match
3. **Note 🔴 HARD RULEs** — These take priority over everything else
4. **Run `/repo-context`** for project identity

### Pre-Flight Check

| You're about to... | Check this skill |
|-------------------|-----------------|
| Edit a source file | `development-conventions` (framework conventions) |
| Run a terminal command | `local-models` — **no `&`, no infinite-wait** |
| Create a new file/service | `development-conventions` (project structure patterns) |
| Write/run tests | `development-conventions` (testing patterns) |
| Edit Docker/K8s | `devops-conventions` (container/kubernetes conventions) |
| Edit shell scripts | `devops-conventions` (CLI toolkit conventions) |

### 🔴 MANDATORY Skills (load before ANY action)

`development-conventions` `devops-conventions` `engineering-workflow` `local-models` `mcp-tooling` `skill-maintenance`

> 💡 Skills are synced between the DB and `.opencode/skills/` via the `/sync-skills` command or scheduled sync.

### 🔴 MANDATORY — Self-Improvement

After ANY code change, you MUST run:

| Command | Action |
|---------|--------|
| `/synthesize` | Triggers synthesis pipeline to process pending observations into traits + skills |
| `/sync-skills` | Bidirectional disk↔DB skill sync |
| `ingenium_observe` | Log observations about changes (manual only for exceptional cases — extraction is automatic) |

> 🔴 **Observation is now automatic** via the server-side extraction engine. The client-side auto-observer plugin is only a thin trigger (`POST /api/v1/extraction/run`). Manual `ingenium_observe` calls should only be used for exceptional cases. See [docs/self-learning-pipeline.md](docs/self-learning-pipeline.md).

---

## Repository Structure

**Monorepo with 6 packages:**

```
packages/
├── ingenium-core/        # Shared library: SQLite WAL + FTS5, Zod schemas (DB access allowed)
├── ingenium-email/       # IMAP/SMTP email client + OAuth2. No DB access.
└── ingenium-extension/   # Client-side package — MCP server, plugins. Installable: npx -y @ingenium/extension.

services/
├── ingenium-api/         # Express REST API on :4097. Sole DB authority.
├── ingenium-server/      # MCP stdio server with 243 tools. HTTP to API. Zero DB access.
└── ingenium-dashboard/   # Next.js 16 App Router frontend (20 primary routes + Settings overlay). HTTP to API. Zero DB access.
```

**API-First Architecture:** Dashboard and server import ZERO core/server code. All data flows through the API layer.

## Agent Table

**13 agents total: 2 primary + 11 subagents.** Each agent has defined skill permissions that control which conventions and patterns it may reference.

| Agent | Type | Model | Skills Allowed |
|-------|------|-------|----------------|
| **ingenium-orchestrator** | Primary | `deepseek/deepseek-v4-pro` | `development-conventions`, `devops-conventions`, `engineering-workflow`, `local-models`, `skill-maintenance`, `mcp-tooling`, `documentation`, `security-audit`, `self-learning`, `database-conventions` |
| **ingenium-chat** | Primary | `deepseek/deepseek-v4-flash` | — |
| **ingenium-explore** | Subagent | `deepseek/deepseek-v4-flash` | `local-models` |
| **ingenium-scout** | Subagent | `deepseek/deepseek-v4-flash` | `local-models` |
| **ingenium-prompt-engineer** | Subagent | `deepseek/deepseek-v4-pro` | — |
| **vision-bridge** | Subagent | `qwen/qwen3.5-9b` | `local-models` |
| **ingenium-software-engineer-fast** | Subagent | `deepseek/deepseek-v4-flash` | `development-conventions`, `devops-conventions`, `engineering-workflow`, `mcp-tooling`, `documentation`, `local-models`, `skill-maintenance`, `database-conventions` |
| **ingenium-software-engineer-premium** | Subagent | `deepseek/deepseek-v4-pro` | `development-conventions`, `devops-conventions`, `engineering-workflow`, `mcp-tooling`, `documentation`, `local-models`, `skill-maintenance`, `database-conventions` |
| **ingenium-software-engineer-terra** | Subagent | `openai/gpt-5.6-terra` | `development-conventions`, `devops-conventions`, `engineering-workflow`, `mcp-tooling`, `documentation`, `local-models`, `skill-maintenance`, `database-conventions` |
| **ingenium-qa** | Subagent | `deepseek/deepseek-v4-flash` | `development-conventions`, `devops-conventions`, `engineering-workflow`, `local-models`, `mcp-tooling`, `documentation`, `security-audit`, `database-conventions` |
| **ingenium-docs** | Subagent | `deepseek/deepseek-v4-flash` | `development-conventions`, `engineering-workflow`, `local-models`, `mcp-tooling`, `skill-maintenance`, `documentation` |
| **ingenium-security-auditor** | Subagent | `deepseek/deepseek-v4-flash` | `development-conventions`, `devops-conventions`, `engineering-workflow`, `mcp-tooling`, `security-audit`, `local-models`, `database-conventions` |
| **browser-agent** | Subagent | `opencode/deepseek-v4-flash-free` | `mcp-tooling`, `engineering-workflow` |

> Full agent profiles at `.opencode/agents/`. Skill permissions defined per-agent in their YAML frontmatter. `browser-agent-errors.md` lives at `.opencode/agents/browser-agent-errors.md`.

### MCP Tool Naming Convention

All Ingenium MCP tools use a **single `ingenium_` prefix**:

| Scope | Pattern | Example |
|-------|---------|---------|
| Transport name | Unprefixed (server key only) | `ingenium` (server name in `opencode.json`) |
| Catalog name | `ingenium_`-prefixed | `ingenium_skill_list` |
| Exposed tool name | `ingenium_<noun>_<verb>` | `ingenium_task_create` |

The full pattern is `ingenium_<noun>_<verb>` (e.g., `ingenium_skill_list`, `ingenium_task_create`). The prefix appears exactly once — never `ingenium_ingenium_`. See [docs/reference/mcp-tools.md](docs/reference/mcp-tools.md) for the complete catalog.

### OAuth Callback Semantics

Native OpenCode provider integrations use two OAuth modes:

- **Auto mode (default)**: OpenCode opens a local HTTP listener on `localhost:1455`. The API registers `GET /auth/callback` as a public endpoint (before auth middleware). The Docker Compose file maps `127.0.0.1:1455` to container port `4097` (the API). When OpenCode issues a redirect to `http://localhost:1455/auth/callback`, it reaches the API, which validates the state, forward-forwards the callback to OpenCode's internal listener, and renders an "Authorization received" page. State is consumed on first use to prevent replay.
- **Code mode**: The API receives the OAuth code, completes the attempt via the OpenCode client, and renders an "Authorization complete" page.

> 🔴 Both modes consume the state parameter (`pendingOAuthAttempts` Map) before forwarding or exchanging, preventing redirect replay. Malformed states (too long, containing control characters) are rejected with 400.

### Dashboard Pages

The Ingenium Dashboard (http://localhost:3000) provides 20 primary routes plus the Settings overlay (21 user-facing views):

| Page | Purpose |
|------|---------|
| `/` | Home — operational dashboard with live metrics via `/api/v1/dashboard/summary` |
| `/chat` | Ingenium Chat — standalone conversational agent interface |
| `/opencode` | Embedded OpenCode Web/CLI iframes (no native chat) |
| `/projects` | Project management (create, rename, archive, restore) |
| `/skills` | Skills grid with detail overlay, syntax highlighting |
| `/docs` | Documentation workspace (spaces, editor, search, templates, history, trash) |
| `/secrets` | Encrypted secrets vault (scrypt key derivation, AES-256-GCM, full audit trail) |
| `/backups` | Backup & restore management (create snapshots, schedule, restore preview/execute) |
| `/jobs` | Job queue and background task monitoring |
| `/logs` | Structured logging and event viewer |
| `/mail` | 3-pane email client (FolderSidebar, EmailList, EmailReader), AccountSetup when no accounts configured |
| `/status` | Service status — supervisord process states, uptime, restart counts |
| `/tasks` | Kanban board (todo → in_progress → review → done) |
| `/plugins` | Plugin lifecycle (enable, disable, configure) |
| `/agents` | Agent profiles (model, mode, enable/disable) |
| `/mcp-servers` | MCP servers + Tool Manager (245 catalog tools, 28 categories, search, category filter) |
| `/config` | OpenCode config editor (Project/Global tabs, sync from disk, save) |
| `/observations` | Self-learning observations with FTS5 search + type/status filters |
| `/personality` | Personality traits with confidence bars, enable/disable |
| `/pipeline` | Git-workflow-style timeline of pipeline events (3s poll, filters, +N collapse) |
| Settings (overlay) | Full-screen overlay via gear icon. 6 functional tabs (General, Projects, Skills, Tasks, Jobs, Plugins, Mail, Agents, MCP, Config, Observations, Personality, Providers, Logs), deep-link: `?settings=<tab>`. Auto-selects tab matching current page. The **Providers** tab (aliased to PipelinePanel) features native-provider cards with Connect/Disconnect, an OAuth connect dialog with auto/code modes, and separate Primary/Secondary synthesis provider selectors. |

> **Nav bar layout**: Settings gear far-right. **ProjectDropdown** (folder icon) to its left for project switching — disabled on `/mail` and `/opencode`. Chat link added to the Workspace group alongside OpenCode. The dashboard talks to the API layer only — zero direct DB access.

### Project Identity Model

Ingenium uses a **two-project identity model**:

- **Server/public project** (`global-default`, `is_global=1`) — The container's own OpenCode session. Created automatically at startup — by `scripts/docker-entrypoint.sh` in Docker, or by `ensureGlobalProject()` in the API server for local development.
- **External sessions** — Named after their repo worktree (e.g., `gh-llm-bootstrap`). The `INGENIUM_PROJECT` env var controls which project the extension plugins write to.

#### External Worktree Project Initialization

When the extension loads (`@ingenium/extension`), `ensureExtensionProject()` in `project-resolver.ts` runs:

1. **Resolves the project name** — `INGENIUM_PROJECT` env var takes priority; falls back to worktree directory basename; throws if worktree is `/workspace` (the container mount — the user must set `INGENIUM_PROJECT` explicitly)
2. **Provisions the project** — Creates it via API if it does not exist (idempotent 409 on duplicates)
3. **Returns the project name** — Used for all subsequent API calls for that session

#### Project-Name Safety

All project names pass through `isValidProjectName()` (also defined as `isSafeName()` in the extension for DB-isolation boundary):

| Check | Rejected |
|-------|----------|
| Empty or whitespace-only | `""`, `" "` |
| Exceeds 64 characters | `"a".repeat(65)` |
| Dot segments | `"."`, `".."` |
| Path separators | `"a/b"`, `"a\\b"` |
| Control characters | `"a\u0000b"` |
| Worktree is `/workspace` | Throws — must set `INGENIUM_PROJECT` |

> 🔴 **Never defaults to `global-default` in code.** The resolver explicitly throws if it cannot determine a valid project name, preventing cross-project data pollution. The Docker entrypoint sets `INGENIUM_PROJECT=global-default` explicitly for the container's session.

**Key rule**: Use `global-default` for shared resources from within the container. For external sessions, `INGENIUM_PROJECT` in the MCP server config determines the target. See [docs/VARIABLES.md](docs/VARIABLES.md).

#### Safe Purge (Child Row Protection)

When a project has FK-constrained child rows (tasks, skills, observations, etc.), `DELETE /api/v1/projects/:name/purge` returns **HTTP 409** with `PROJECT_HAS_CHILDREN` and a `childTables` array instead of silently failing or cascading. The core `deleteProject()` function probes every non-system table with a `project_id` column before deleting — if any has rows referencing the project, the deletion is refused with a typed `{ status: "has_children", childTables }` result. Summary purge (`POST /api/v1/projects/purge`) deletes only fully-orphaned projects that have exceeded the retention period.

#### DB-Only Workspace Migration

A historical artifact (`/workspace` project from the container mount) is migrated via `ingenium_project_migrate_workspace` (MCP tool) or `POST /api/v1/projects/migrate-workspace` (API endpoint):

- **DB-only** — Never reads, renames, or deletes the `/workspace` filesystem path
- **Validated** — Requires exactly 10 source skills, SHA-256 hash verification, zero remaining child rows, clean foreign key check
- **Dry-run first** — Send `dryRun: true` for pre-flight validation without mutation
- **Audit trail** — Results recorded in `project_migration_manifests` table (migration 049)
- **Transactional** — Wrapped in `execTransaction()`; any guard failure rolls back fully
- **Collision handling** — Skills with names conflicting in `global-default` are renamed with a `migrated-<sha256[:16]>` suffix and a lineage record is created

> **Migration code vs. runtime execution**: The `migrateWorkspaceProject()` implementation lives in `packages/ingenium-core/lib/tools/projects.ts` and performs actual DB migration when invoked via the API or MCP tool. Unit tests in `packages/ingenium-core/tests/projects.test.ts` exercise the same function but use `resetDbForTest()` and isolated `mkdtempSync()` temp directories — they never read, write, or mutate the production database or any real filesystem path. This separation ensures migration logic is validated without risk to live data.

---

## 🔴 Orchestration Policy — 12-Active / 6-Writer Phase Scheduler

The orchestrator follows a **behavioral** concurrency policy for parallel subagent execution. This is **not an OpenCode configuration field** — it is a documented scheduling discipline enforced by the orchestrator's own delegation logic in `@ingenium-orchestrator`.

### Concurrency Limits

| Limit | Value | Scope |
|-------|-------|-------|
| **Active subagents per phase** | 12 | Total simultaneous subagents (writers + read-only) in a single orchestration phase |
| **Concurrent writers per wave** | 6 | Subagents with `edit: allow` or `write: allow` permissions |
| **Remaining capacity** | 6 | Reserved for read-only agents (explore, QA, docs, security, browser, scout, vision) |
| **Write territory overlap** | 0 | No two writers may touch the same file/directory path concurrently |

### Writer Tiers and Routing

| Tier | Model | When to route |
|------|-------|---------------|
| **Fast** | `deepseek/deepseek-v4-flash` | Routine isolated work: bug fixes, simple refactors, test authoring, single-package scope |
| **Premium** | `deepseek/deepseek-v4-pro` | Complex architecture-wide / cross-cutting work: multi-file refactoring, architectural changes, performance-critical code |
| **Terra** | `openai/gpt-5.6-terra` | 🔴 **First choice for critical work**: auth/secrets/permissions; migrations/data integrity; Docker/runtime outages; multi-service contracts; cross-package refactors; persistent high-risk failures. Higher reasoning throughput via GPT-5.6 Terra OAuth. |

### Phase Declaration Protocol

Every orchestration phase MUST declare before dispatch:

1. **Active count** — total subagents to spawn (max 12)
2. **Writer count** — total writers among them (max 6)
3. **Exclusive territories** — file/directory ownership per writer; zero overlap
4. **Dependencies** — serialization order for writers sharing territories across waves
5. **Verification owners** — which QA/docs agent reviews which writer's output

Conflicting writers (touching the same file) MUST be serialized across waves — never dispatched simultaneously.

### Restart Required for New Agent Profiles

Adding a new agent profile (`.opencode/agents/*.md`) requires restarting OpenCode before the agent becomes invocable by `@` mention. The agent must also be registered in the `opencode.json` agents array.

> See the [orchestrator agent profile](./.opencode/agents/primary/ingenium-orchestrator.md) for the full policy specification, dispatch examples, and collision resolution rules.

---

## 🔴 MANDATORY — Database Isolation

**Only `packages/ingenium-core` and `services/ingenium-api` may import SQL libraries.** CI enforces this:

```bash
grep -r "better-sqlite3\|\.db\|sqlite" services/ingenium-server/  # must return empty
grep -r "better-sqlite3\|\.db\|sqlite" services/ingenium-dashboard/  # must return empty
```

Move any DB logic to the API layer immediately.

### Database Migrations

Migrations live at `packages/ingenium-core/data/migrations/` as numbered `.sql` files. Full migration table, anti-corruption guard, and repair instructions: [docs/reference/database-migrations.md](docs/reference/database-migrations.md).

### 🔴 WAL Safety — checkpointAfterWrite Outside Transaction

`checkpointAfterWrite()` must never be called **inside** `execTransaction()`. Calling checkpoint inside a transaction causes `SQLITE_LOCKED`.

```typescript
const result = execTransaction(() => {
  db.prepare("UPDATE ...").run(...);
  return value;
});
checkpointAfterWrite();  // ← ALWAYS outside, after the transaction commits
return result;
```

> 🔴 If you see `SQLITE_LOCKED` errors, check whether `checkpointAfterWrite()` is inside an `execTransaction()` callback.

### 🔴 Email FK Defensive Pattern — Parent-Existence Check

Any upsert into a FK-constrained child table must check for the parent row **before** inserting (prevents concurrent-deletion corruption):

```typescript
const parent = db.prepare(
  "SELECT 1 FROM email_cache WHERE account_id = ? AND folder = ? AND uid = ?",
).get(accountId, folder, uid);
if (!parent) return; // parent removed — skip silently
```

### 🔴 Email & Data Integrity HARD RULEs

- 🔴 **`folder` value must be threaded through unchanged from `email.folder`.** Defaulting to `"INBOX"` causes 100% cache miss.
- 🔴 **Noreply-sender gate** — Before any cache lookup or generation, check `from_addr` and `from_name` against `/no[-_.]?reply|do[-_.]?not[-_.]?reply/i`. Return `{ suggestions: [], source: "noreply" }` immediately.
- 🔴 **Reasoning model compatibility** — Never fall back to `reasoning_content`. Use `max_tokens: 8192`; if `content` is empty, return `[]` or `""`.
- 🔴 **Smart-reply cache persistence** — Use `ON CONFLICT(account_id, folder, uid) DO UPDATE SET ...`, never `INSERT OR REPLACE` (which cascades to delete child rows).
- 🔴 **Never hand-write RFC 2822 address-parsing regexes** — Always use a tested library (`mailparser`, `addressparser`, `simpleParser`).
- 🔴 **Zod schemas are NOT runtime enforcement gates** — SQL CHECK constraints are the actual gate. Client-side validation or `try/catch` for `SQLITE_CONSTRAINT` is required.

**Mail Engine**: The sync engine now includes an auth error circuit breaker. After 3 consecutive authentication failures on a folder, the folder state transitions to `error` with a re-authentication message, and the service health reports `degraded`. Gmail DRAFT and All Mail (Archive) labels are now supported.

---

## Docker Deployment

**Single-container via `docker compose up --build`.** Four supervisord processes: API (:4097), Dashboard (:3000), opencode-web (:4098), ttyd-opencode (:4099).

### Start/Stop Commands

```bash
docker compose up --build    # Start all services
docker compose down          # Stop all services
docker compose logs -f       # View logs
docker compose exec ingenium npm run test   # Execute inside container
```

### Port Mappings

| Host Port | Service | Description |
|-----------|---------|-------------|
| `3000` | Dashboard | Next.js frontend (http://localhost:3000) |
| `127.0.0.1:4097` | API | Express REST gateway (sole DB authority — dashboard uses same-origin proxy) |
| `127.0.0.1:4098` | OpenCode Web | OpenCode web server (host loopback only) |
| `127.0.0.1:4099` | ttyd-opencode | OpenCode CLI terminal via ttyd (host loopback only) |
| `127.0.0.1:1455` | OAuth callback proxy | Host `127.0.0.1:1455` → container `:4097` (API). OpenCode redirects OAuth here; API validates and forwards callback |

> 🔴 Dockerfile `EXPOSE` covers ports 3000, 4097, 4098, 4099, 1455.

### Key Docker Notes

- **Volumes**: `ingenium-data` (/app/.ingenium), `opencode-config`, `opencode-data`. Workspace bind-mount: `~/repos` → `/workspace`.
- **OpenCode Web/CLI**: Dashboard `/opencode` page has dual-mode iframes (Web: :4098, CLI: ttyd :4099). Glass tab toggle with `Ctrl+Shift+\``. Mode persisted in `localStorage`.
- **Direct terminal attachment**: `opencode attach http://localhost:4098 --dir /workspace`
- **OpenCode Access**: The Dashboard iframe connects to OpenCode Web via a URL derived at runtime by `runtime-urls.ts`: loopback HTTP (localhost/127.0.0.1/::1) uses the direct port (`http://localhost:4098/`); LAN HTTP (e.g., `http://192.168.1.50:3000/`) and all HTTPS use a same-origin reverse-proxy path (`/opencode-web/` for Web mode, `/opencode-cli/` for CLI mode) to avoid mixed-content errors. An environment override (`NEXT_PUBLIC_OPENCODE_WEB_URL` / `NEXT_PUBLIC_OPENCODE_CLI_URL`) is available for custom deployments — only relative same-origin paths are accepted; direct service origins are deliberately unsupported. The browser-facing process overrides `OPENCODE_SERVER_PASSWORD` to empty so the iframe never opens a native login prompt. Compose publishes ports 4098 and 4099 to host loopback only (`127.0.0.1`). The root `OPENCODE_SERVER_PASSWORD` remains required for the API proxy guard and is never exposed to the browser.
- 🔴 **`synthesis-engine` and `email-client` are NOT supervisord processes.** They are in-process scheduled tasks in the API Express process. See [`services/ingenium-api/lib/routes/services.ts`](./services/ingenium-api/lib/routes/services.ts).
- 🔴 **Docker sudo**: `appuser` has passwordless sudo for package installs.
- 🔴 **Docker git**: `git` package installed for OpenCode repo creation.

---

## Testing

```bash
bash tests/test-self-improving.sh        # All 4 detection pipeline tests
bash tests/test-self-improving.sh -v     # Verbose output
bash tests/enforce-no-db-leaks.sh        # CI gate: verify no DB access leaks
bash tests/test-agent-validation.sh      # Agent validation checks (13 agents)
bash tests/test-append-only-files.sh     # Verify append-only file constraints

npm run test --workspace=packages/ingenium-core          # Unit tests
npm run test --workspace=packages/ingenium-extension     # Extension package tests (vitest)
npm run typecheck --workspace=packages/ingenium-extension # Extension type checking (tsc --noEmit)
npx playwright test --config=tests/playwright.config.ts tests/ingenium-dashboard/   # E2E dashboard
npm test                                                  # All tests
```

---

## Self-Learning Pipeline

The self-learning pipeline captures observations about user behavior, consolidates them into personality traits, and synthesizes skills. Observation detection runs **server-side** via the extraction engine (`extraction.ts`) reading OpenCode messages.

> 🔴 **Observe user behavior, NOT implementation.** Observations track user preferences, corrections, and patterns — not what code was written. Implementation activity belongs in pipeline events and git commits. Observation is automatic via the server-side extraction engine; manual `ingenium_observe` calls are only for exceptional cases.

**Full pipeline reference**: [docs/self-learning-pipeline.md](docs/self-learning-pipeline.md) — covers extraction engine, trait consolidation (Phase 1), skill synthesis (Phase 2), confidence model, pipeline observability timeline, and all observation/trait types.

**Key sections**:
- Observation types: `correction`, `preference`, `pattern`, `insight`, `feedback`, `behavior`, `terminology`, `workflow`, `error`, `goal`
- Confidence model: traits start at 0.10–0.15, gain +0.15 per confirmation, cap at 0.95, display threshold ≥0.30
- Scheduled maintenance: extraction → synthesis every 15 minutes (configurable via `SYNTHESIS_INTERVAL_MS`); extension session events run resource sync separately
- LLM providers: managed as repeatable OpenCode-compatible blocks in Settings → Providers; one primary and one backup role feed synthesis
- Cross-project synthesis: evaluates patterns across all projects, `ingenium_synthesis_cross_project` tool

---

## Commands

Commands are captured in the DB alongside skills, agents, and plugins:

| Command | File | Purpose |
|---------|------|---------|
| `/synthesize` | `.opencode/commands/synthesize.md` | Trigger synthesis pipeline to process pending observations |
| `/sync-skills` | `.opencode/commands/sync-skills.md` | Bidirectional disk↔DB skill sync |
| `/init-project` | `.opencode/commands/init-project.md` | Initialize a new project with skills, agents, plugins |
| `/repo-context` | `.opencode/commands/repo-context.md` | Load project identity — reads `.opencode.json`, identifies workspace, and loads relevant context files |

**Commands MCP Tools:** `ingenium_command_list`, `ingenium_command_get`, `ingenium_command_create`, `ingenium_command_update`, `ingenium_command_delete`

---

## Config Management

The `configs` table stores `opencode.json` (project-level) and `opencode.jsonc` (global) content in the DB. Dashboard `/config` page provides a tabbed editor with sync-from-disk and save.

- **Global config path**: `/home/appuser/.config/opencode/` (override via `INGENIUM_GLOBAL_CONFIG_PATH`)
- **Config MCP tools**: `ingenium_config_get`, `ingenium_config_set`, `ingenium_config_sync`

For API endpoints and detailed MCP tool reference, see [docs/HOW-TO/settings.md](docs/HOW-TO/settings.md) and [docs/HOW-TO/mcp-tools.md](docs/HOW-TO/mcp-tools.md).

---

## Plugin & Skill Conventions

- **Plugin Auto-Config Sync**: Every plugin lifecycle operation MUST sync `.opencode/plugins/<file>.ts` on disk AND `opencode.json`'s `plugin` array.
- **Plugin Source Auto-Populate**: If `sourceContent` is empty at creation, the API reads the file from disk. See [docs/HOW-TO/plugins.md](docs/HOW-TO/plugins.md).
- **🔴 Skill Sync Pattern**: Skills sync via the **Resource Sync Engine** (`packages/ingenium-extension/resource-sync.ts`) with SHA-256 hash manifest for conflict-aware bidirectional sync on `session.created` and `session.idle`. See [docs/HOW-TO/skills.md](docs/HOW-TO/skills.md).
- **🔴 Plugin/Config Restart Requirement**: When the sync engine detects changes to plugins or config (opencode.json), `restartRequired: true` is returned. OpenCode must be restarted for plugin array or config content changes to take effect. Skills, agents, and commands do not require a restart.
- **Skill file_tree Format**: DB `file_tree` column stores JSON map of paths → content. `writeSkillToDisk()` writes SKILL.md + metadata.json + all files.
- **Dashboard Styling**: Every service with a frontend must have a `STYLING-GUIDE.md`. All `<select>` elements use `hover:bg-gray-50 cursor-pointer`. See [docs/CONVENTIONS.md](docs/CONVENTIONS.md).
- 🔴 **Auto-observer auto-registration**: Must be registered in DB plugins table + both opencode configs (project + global).

---

## 🔴 HARD RULEs Summary

For quick reference, here are the non-negotiable rules from above:

| # | Rule | Section |
|---|------|---------|
| 1 | Never commit API tokens to source | Header |
| 2 | Verify every claim against source files | Header |
| 3 | Load matching skills before any action | [Load Skills](#-mandatory--load-skills-before-acting) |
| 4 | Run `/synthesize` + `/sync-skills` + `ingenium_observe` after code changes | [Self-Improvement](#-mandatory--self-improvement) |
| 5 | Only `core` and `api` packages may import SQL libraries | [Database Isolation](#-mandatory--database-isolation) |
| 6 | `checkpointAfterWrite()` must be OUTSIDE `execTransaction()` | [WAL Safety](#-wal-safety--checkpointafterwrite-outside-transaction) |
| 7 | Parent-existence check before FK-constrained child table upserts | [Email FK Pattern](#-email-fk-defensive-pattern--parent-existence-check) |
| 8 | Thread `folder` value unchanged through call chain | [Email HARD RULEs](#-email--data-integrity-hard-rules) |
| 9 | Noreply-sender gate before cache lookup/generation | [Email HARD RULEs](#-email--data-integrity-hard-rules) |
| 10 | Never fall back to `reasoning_content`; use `max_tokens: 8192` | [Email HARD RULEs](#-email--data-integrity-hard-rules) |
| 11 | `ON CONFLICT DO UPDATE`, never `INSERT OR REPLACE` | [Email HARD RULEs](#-email--data-integrity-hard-rules) |
| 12 | Never hand-write RFC 2822 address-parsing regexes | [Email HARD RULEs](#-email--data-integrity-hard-rules) |
| 13 | Zod schemas are NOT runtime enforcement; SQL CHECK is the gate | [Email HARD RULEs](#-email--data-integrity-hard-rules) |
| 14 | Observe user behavior, NOT implementation details | [Self-Learning Pipeline](#self-learning-pipeline) |
| 15 | `synthesis-engine`/`email-client` are NOT supervisord processes | [Docker](#key-docker-notes) |
| 16 | Plugin lifecycle MUST sync disk + `opencode.json` plugin array | [Plugin Conventions](#plugin--skill-conventions) |
| 17 | Auto-observer registered in DB + both opencode configs | [Plugin Conventions](#plugin--skill-conventions) |
| 18 | Orchestration policy is behavioral — not an OpenCode config concurrency field | [Orchestration Policy](#-orchestration-policy--12-active--6-writer-phase-scheduler) |
| 19 | Never exceed 12 active subagents or 6 concurrent writers per phase; serialize conflicting writers | [Orchestration Policy](#-orchestration-policy--12-active--6-writer-phase-scheduler) |
| 20 | Declare phase (active count, writers, territories, dependencies, verification) before dispatch | [Orchestration Policy](#-orchestration-policy--12-active--6-writer-phase-scheduler) |
| 21 | Terra is first choice for critical work (auth, migrations, Docker, multi-service, cross-package, high-risk) | [Orchestration Policy](#-orchestration-policy--12-active--6-writer-phase-scheduler) |
| 22 | Restart OpenCode for newly-added agent profiles to become invocable | [Orchestration Policy](#-orchestration-policy--12-active--6-writer-phase-scheduler) |
| 23 | Restart OpenCode when sync engine reports plugin/config changes | [Plugin Conventions](#plugin--skill-conventions) |

---

## Environment Variables

**Canonical reference**: [docs/VARIABLES.md](docs/VARIABLES.md) — lists all variables with defaults, consumers, and descriptions. CI enforces that every `process.env` reference has a doc entry.

---

## 🔴 QA-First Workflow

After every subagent task that modifies files:
1. **Spawn `@ingenium-qa`** — Review changes, run tests, verify quality
2. **Spawn `@ingenium-docs`** — Update affected documentation (AGENTS.md, SKILL-INDEX.md)
3. **Task not done until QA passes and docs are updated**

See [`ingenium-orchestrator.md`](./.opencode/agents/primary/ingenium-orchestrator.md) for the full Definition of Done process.
