# AGENTS.md — Ingenium MCP Server Agent Protocol

This is the **Agent Protocol** for the Ingenium MCP Server. Skills live at `.opencode/skills/<name>/` with a split-skill format (SKILL.md + metadata.json + references/).

> 🔴 **Security**: Never commit `THREAD_API_TOKEN` to source. Use `<YOUR_THREAD_API_TOKEN>` placeholder in `opencode.json`.

> 🔴 **Never state a fact without verifying against source files.** If you claim "X uses Y", you must have READ the file containing X. If you claim "Z imports W", you must have GREP'd for the import. If you cannot verify in one read or grep, say "I'm not sure — let me check" instead of guessing confidently.

> **Dashboard**: Skills, plugins, agents, projects, and commands can be managed through the Ingenium Dashboard at [http://localhost:3000](http://localhost:3000).

---

## Quick Reference

| Section | Description |
|---------|-------------|
| [🔴 HARD RULEs](#-hard-rules-summary) | Non-negotiable rules |
| [Repository Structure](#repository-structure) | Package and service layout |
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
├── ingenium-server/      # MCP stdio server with 210 tools. HTTP to API. Zero DB access.
└── ingenium-dashboard/   # Next.js 16 App Router frontend (17 primary routes + Settings overlay). HTTP to API. Zero DB access.
```

**API-First Architecture:** Dashboard and server import ZERO core/server code. All data flows through the API layer.

## Agent Table

**11 agents total: 1 primary + 10 subagents.** Each agent has defined skill permissions that control which conventions and patterns it may reference.

| Agent | Type | Model | Skills Allowed |
|-------|------|-------|----------------|
| **ingenium-orchestrator** | Primary | `deepseek/deepseek-v4-pro` | `development-conventions`, `devops-conventions`, `engineering-workflow`, `local-models`, `skill-maintenance`, `mcp-tooling`, `documentation`, `security-audit`, `self-learning`, `database-conventions` |
| **ingenium-explore** | Subagent | `deepseek/deepseek-v4-flash` | `local-models` |
| **ingenium-scout** | Subagent | `deepseek/deepseek-v4-flash` | `local-models` |
| **ingenium-prompt-engineer** | Subagent | `deepseek/deepseek-v4-pro` | — |
| **vision-bridge** | Subagent | `lmstudio/qwen/qwen3.5-9b` | `local-models` |
| **ingenium-software-engineer-fast** | Subagent | `deepseek/deepseek-v4-flash` | `development-conventions`, `devops-conventions`, `engineering-workflow`, `mcp-tooling`, `documentation`, `local-models`, `skill-maintenance`, `database-conventions` |
| **ingenium-software-engineer-premium** | Subagent | `deepseek/deepseek-v4-pro` | `development-conventions`, `devops-conventions`, `engineering-workflow`, `mcp-tooling`, `documentation`, `local-models`, `skill-maintenance`, `database-conventions` |
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

### Dashboard Pages

The Ingenium Dashboard (http://localhost:3000) provides 17 primary routes plus the Settings overlay (18 user-facing views):

| Page | Purpose |
|------|---------|
| `/` | Home — operational dashboard with live metrics via `/api/v1/dashboard/summary` |
| `/opencode` | Embedded OpenCode with Web/CLI dual-mode (glass tab toggle, Ctrl+Shift+`) |
| `/projects` | Project management (create, rename, archive, restore) |
| `/skills` | Skills grid with detail overlay, syntax highlighting |
| `/docs` | Documentation workspace (spaces, editor, search, templates, history, trash) |
| `/jobs` | Job queue and background task monitoring |
| `/logs` | Structured logging and event viewer |
| `/mail` | 3-pane email client (FolderSidebar, EmailList, EmailReader), AccountSetup when no accounts configured |
| `/status` | Service status — supervisord process states, uptime, restart counts |
| `/tasks` | Kanban board (todo → in_progress → review → done) |
| `/plugins` | Plugin lifecycle (enable, disable, configure) |
| `/agents` | Agent profiles (model, mode, enable/disable) |
| `/mcp-servers` | MCP servers + Tool Manager (212 catalog tools, 24 categories, search, category filter) |
| `/config` | OpenCode config editor (Project/Global tabs, sync from disk, save) |
| `/observations` | Self-learning observations with FTS5 search + type/status filters |
| `/personality` | Personality traits with confidence bars, enable/disable |
| `/pipeline` | Git-workflow-style timeline of pipeline events (3s poll, filters, +N collapse) |
| Settings (overlay) | Full-screen overlay via gear icon. 14 tabs, deep-link: `?settings=<tab>`. Auto-selects tab matching current page. |

> **Nav bar layout**: Settings gear far-right. **ProjectDropdown** (folder icon) to its left for project switching — disabled on `/mail` and `/opencode`. The dashboard talks to the API layer only — zero direct DB access.

### Project Identity Model

Ingenium uses a **two-project identity model**:

- **Server/public project** (`global-default`, `is_global=1`) — The container's own OpenCode session. Created automatically by `scripts/docker-entrypoint.sh`.
- **External sessions** — Named after their repo worktree (e.g., `gh-llm-bootstrap`). The `INGENIUM_PROJECT` env var controls which project the extension plugins write to.

**Key rule**: Use `global-default` for shared resources from within the container. For external sessions, `INGENIUM_PROJECT` in the MCP server config determines the target. See [docs/VARIABLES.md](docs/VARIABLES.md).

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
| `4097` | API | Express REST gateway (sole DB authority) |
| `127.0.0.1:4098` | OpenCode Web | OpenCode web server (host loopback only) |
| `127.0.0.1:4099` | ttyd-opencode | OpenCode CLI terminal via ttyd (host loopback only) |

> 🔴 Dockerfile `EXPOSE` covers ports 3000, 4097, 4098, 4099.

### Key Docker Notes

- **Volumes**: `ingenium-data` (/app/.ingenium), `opencode-config`, `opencode-data`. Workspace bind-mount: `~/repos` → `/workspace`.
- **OpenCode Web/CLI**: Dashboard `/opencode` page has dual-mode iframes (Web: :4098, CLI: ttyd :4099). Glass tab toggle with `Ctrl+Shift+\``. Mode persisted in `localStorage`.
- **Direct terminal attachment**: `opencode attach http://localhost:4098 --dir /workspace`
- **OpenCode Access**: The Dashboard iframe connects directly to OpenCode Web at `http://localhost:4098/`. OpenCode Web enforces HTTP Basic Auth via the `OPENCODE_SERVER_PASSWORD` environment variable. The browser's native auth prompt handles credentials — no custom proxy middleware needed.
- 🔴 **`synthesis-engine` and `email-client` are NOT supervisord processes.** They are in-process scheduled tasks in the API Express process. See [`services/ingenium-api/lib/routes/services.ts`](./services/ingenium-api/lib/routes/services.ts).
- 🔴 **Docker sudo**: `appuser` has passwordless sudo for package installs.
- 🔴 **Docker git**: `git` package installed for OpenCode repo creation.

---

## Testing

```bash
bash tests/test-self-improving.sh        # All 4 detection pipeline tests
bash tests/test-self-improving.sh -v     # Verbose output
bash tests/enforce-no-db-leaks.sh        # CI gate: verify no DB access leaks
bash tests/test-agent-validation.sh      # Agent validation checks (11 agents)
bash tests/test-append-only-files.sh     # Verify append-only file constraints

npm run test --workspace=packages/ingenium-core          # Unit tests
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
- LLM synthesis backup provider: configured in Settings → Synthesis LLM
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
- **Skill file_tree Format**: DB `file_tree` column stores JSON map of paths → content. `writeSkillToDisk()` writes SKILL.md + metadata.json + all files.
- **Dashboard Styling**: Every service with a frontend must have a `STYLING-GUIDE.md`. All `<select>` elements use `hover:bg-gray-50 cursor-pointer`. See [docs/CONVENTIONS.md](docs/CONVENTIONS.md).
- 🔴 **Auto-observer auto-registration**: Must be registered in DB plugins table + both opencode configs (project + global).

---

## 🔴 HARD RULEs Summary

For quick reference, here are the non-negotiable rules from above:

| # | Rule | Section |
|---|------|---------|
| 1 | Never commit `THREAD_API_TOKEN` | Header |
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
