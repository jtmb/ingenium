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
| [🔴 Orchestration Policy](#-orchestration-policy--6-active--3-writer-phase-scheduler) | 6-active/3-writer concurrency, writer tiers, phase declarations |
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

**12 agents total: 2 primary + 10 subagents.** Each agent has defined skill permissions that control which conventions and patterns it may reference. The hidden `ingenium-llm-broker` is a system-internal agent reserved for the LLM broker (never invoked directly, not listed as modeled). The `browser-agent` handles web automation and self-healing site interaction.

> **Model configuration**: Agent model mappings are defined centrally in `opencode.json` under the `"agent"` key. Markdown agent profiles intentionally omit the `model:` field — the root config is the sole source of runtime model assignment. See [`opencode.json`](./opencode.json).

| Agent | Type | Mode | Skills Allowed |
|-------|------|------|----------------|
| **ingenium-orchestrator** | Primary | Coordination — delegates to subagents, never writes code directly | `development-conventions`, `devops-conventions`, `engineering-workflow`, `local-models`, `skill-maintenance`, `mcp-tooling`, `documentation`, `security-audit`, `self-learning`, `database-conventions` |
| **ingenium-chat** | Primary | Chat (read-only, `hidden: true`) | — |
| **ingenium-explore** | Subagent | Research and exploration | `local-models` |
| **ingenium-scout** | Subagent | Research + Docs RAG | `local-models` |
| **ingenium-qa-vision** | Subagent | Visual QA (Playwright screenshots at 1440x900, 390x844); no Bash, no writes | `development-conventions`, `devops-conventions`, `engineering-workflow`, `mcp-tooling` |
| **ingenium-software-engineer-fast** | Subagent | Writer tier — routine isolated work, single-package scope | `development-conventions`, `devops-conventions`, `engineering-workflow`, `mcp-tooling`, `local-models`, `skill-maintenance`, `database-conventions` |
| **ingenium-software-engineer-premium** | Subagent | Writer tier — critical and complex cross-cutting work (auth, migrations, Docker, multi-service, high-risk) | `development-conventions`, `devops-conventions`, `engineering-workflow`, `mcp-tooling`, `local-models`, `skill-maintenance`, `database-conventions` |
| **ingenium-qa** | Subagent | Targeted, read-only QA — one declared verification pass with scope-classified findings | `development-conventions`, `devops-conventions`, `engineering-workflow`, `local-models`, `mcp-tooling`, `documentation`, `security-audit`, `database-conventions` |
| **ingenium-docs** | Subagent | **Writer** — repository documentation and explicitly requested Docs Workspace updates | `development-conventions`, `engineering-workflow`, `local-models`, `mcp-tooling`, `skill-maintenance`, `documentation` |
| **ingenium-security-auditor** | Subagent | Bounded current-diff/dependency review; one history scan only for a confirmed secret or critical explicit trigger | `development-conventions`, `devops-conventions`, `engineering-workflow`, `mcp-tooling`, `security-audit`, `local-models`, `database-conventions` |
| **browser-agent** | Subagent | **Writer** — web automation and self-healing site interaction | `mcp-tooling`, `engineering-workflow` |
| **ingenium-llm-broker** | Subagent | System-internal LLM broker (`enabled: true`, `hidden: true`), immutable, wildcard-denied with no tool allowances | — |

> Full agent profiles at `.opencode/agents/`. Skill permissions defined per-agent in their YAML frontmatter. Archived profiles at `.opencode/archive/agents/`.
>
> > **Note on `ingenium-chat`**: A legacy root-level duplicate at `.opencode/agents/ingenium-chat.md` exists alongside the canonical `.opencode/agents/chat/ingenium-chat.md`. This is a **compatibility mirror** — both files represent the same logical agent. The root duplicate is preserved for backward compatibility and does **not** count as a separate agent in the 12-agent total.

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

- **Auto mode (default)**: OpenCode opens a local HTTP listener on `localhost:1455`. The host `127.0.0.1:1455` reaches the Nginx callback listener, which forwards only the exact `GET /auth/callback` path to private Express `4096`. The auth middleware explicitly allowlists that method/path without a bearer token; Express validates the state, forwards the callback to OpenCode's internal listener, and renders an "Authorization received" page. State is consumed on first use to prevent replay.
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
| Settings (overlay) | Full-screen overlay via gear icon. 14 functional tabs (General, Projects, Skills, Tasks, Jobs, Plugins, Mail, Agents, MCP, Config, Observations, Personality, Providers, Logs), deep-link: `?settings=<tab>`. Auto-selects tab matching current page. The **Providers** tab (aliased to PipelinePanel) features native-provider cards with Connect/Disconnect, an OAuth connect dialog with auto/code modes, and separate Primary/Secondary synthesis provider selectors. |

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

## 🔴 Orchestration Policy — 6-Active / 3-Writer Phase Scheduler

The orchestrator follows a **behavioral** concurrency policy for parallel subagent execution. This is **not an OpenCode configuration field** — it is a documented scheduling discipline enforced by the orchestrator's own delegation logic in `@ingenium-orchestrator`.

### Autonomous Verification and Interactive-Decision Boundary

**🔴 Open-roadmap turn rule:** While any roadmap task or `TodoWrite` item remains open, the orchestrator must not emit a normal final/progress response, end a turn as a status update, or require a user reprompt. It must immediately dispatch the next declared phase. Token/turn pressure, partial agent completion, and unverified source changes are never terminal reasons. Only `PASS`, `ESCALATE_USER`, an explicit user-requested `STOP`, or an explicit user-requested `CANCELLED` may end a turn.

Orchestration executes declared scoped tests, standard verification, in-scope source fixes, and any declared deployment autonomously. It never asks the user for permission to test, diagnose, fix, retry, package, scan, configure, run, or deploy work that is already within the declared user scope. A compile, test, package, scanner, configuration, or runtime defect with a concrete reproducible root cause is remediated and reverified automatically; a failed check alone never escalates.

Only Plan mode may use interactive decision questions. Orchestration never invokes the `question` tool. Return `ESCALATE_USER` in the normal response only when a required external credential or access remains unavailable after the attempted configured path; a destructive or irreversible operation lacks authorization; a mutually exclusive product decision is required; the user requirement is genuinely ambiguous; or bounded diagnosis cannot establish a reproducible root cause.

QA and security each report scope-classified findings once per implementation wave. They have no task-delegation authority, cannot spawn the other, and cannot reopen a closed task. After a writer fixes an in-scope reviewer blocker, run only the minimum targeted regression for that root cause. Do not rerun QA or security unless the source change in that review boundary requires the reviewer’s originally declared check; never create a recursive reviewer handoff.

### Concurrency Limits

| Limit | Value | Scope |
|-------|-------|-------|
| **Active subagents per phase** | 6 | Total simultaneous subagents (writers + read-only) in a single orchestration phase |
| **Concurrent writers per wave** | 3 | Subagents with `edit: allow` or `write: allow` permissions |
| **Remaining capacity** | 3 | Available to non-writer agents (explore, scout, QA, vision, security) |
| **Write territory overlap** | 0 | No two writers may touch the same file/directory path concurrently |

### Writer Tiers and Routing

All agents with `edit: allow` or `write: allow` count toward the three-writer limit. In this topology, the writer-capable agents are `@ingenium-software-engineer-fast`, `@ingenium-software-engineer-premium`, `@ingenium-docs`, and `@browser-agent`. `@ingenium-orchestrator` is not a writer because its edit/write permissions are denied.

The non-writer agents are `@ingenium-explore`, `@ingenium-scout`, `@ingenium-qa`, `@ingenium-qa-vision`, and `@ingenium-security-auditor`; they count toward the six-active limit only.

| Tier | Model Profile | When to route |
|------|---------------|---------------|
| **Fast** | `ingenium-software-engineer-fast` | Routine isolated work: bug fixes, simple refactors, test authoring, single-package scope |
| **Premium** | `ingenium-software-engineer-premium` | 🔴 **First choice for critical and complex work**: auth/secrets/permissions; migrations/data integrity; Docker/runtime outages; multi-service contracts; cross-package refactors; persistent high-risk failures; multi-file refactoring; architectural changes; performance-critical code. |
| **Docs** | `ingenium-docs` | Documentation and skill-system updates; dispatchable writer for documentation territories |
| **Browser** | `browser-agent` | Browser automation and self-healing site interaction; dispatchable writer for browser-owned territories |

**Writer accounting is permission-derived, not task-type-derived.** Docs and Browser remain writers even when their work is documentation or browser automation rather than application code, and both count toward the maximum of three writers. Browser is dispatchable through the orchestrator like the other writer agents.

### Valid Phase Example

The following implementation phase is within both limits: **5 active, 3 permission-derived writers**. QA and visual gates run later, after their applicable implementation work is final.

```text
Phase: "Dashboard implementation, direct docs, and browser work"
  @ingenium-software-engineer-fast → dashboard/components/ (writer)
  @ingenium-docs                   → docs/              (writer)
  @browser-agent                   → browser recipes/   (writer)
  @ingenium-explore                → search patterns    (non-writer)
  @ingenium-scout                  → retrieve context   (non-writer)
```

No phase may dispatch more than six active subagents or three agents whose permission block grants `edit: allow` or `write: allow`; overlapping writer territories must be serialized.

### Phase Declaration Protocol

Every task and phase MUST declare before dispatch:

1. **IN_SCOPE** — permitted files, behavior, and remediation
2. **OUT_OF_SCOPE** — excluded work; valid excluded findings are never auto-dispatched
3. **Acceptance criteria** — observable pass conditions
4. **STOP_CONDITION** — `PASS`, `ESCALATE_USER`, `STOP`, or `CANCELLED`
5. **Verification plan** — targeted checks, deployment/acceptance steps, bounded diagnosis limit for an unreproduced failure, and the root-cause/proving-regression link for each remediation
6. **Escalation rule** — evidence for one of the five permitted `ESCALATE_USER` conditions only
7. **Active count** — total subagents to spawn (max 6)
8. **Writer count** — total writers (max 3)
9. **Exclusive territories** — file/directory ownership per writer; zero overlap
10. **Dependencies** — serialization order for writers sharing territories across waves
11. **Verification owner and checks** — targeted owner and checks for source fix → targeted test → deploy → acceptance

Classify every finding as **BLOCKING**, **FOLLOW_UP**, or **INFORMATIONAL**. A finding is **BLOCKING** only when it is in the user scope and fails acceptance criteria or is immediately exploitable changed code. Only an in-scope BLOCKING finding may reopen implementation. FOLLOW_UP findings are reported separately and never auto-dispatched. Every remediation must name and address the current reproducible root cause, then run the minimum targeted regression; a second failed check alone is never an escalation condition.

**STOP** and **CANCELLED** are terminal only when explicitly requested: spawn no new agents and run no QA, Docs, security review, visual gate, or sweep, while preserving resumable state, evidence, and skipped work. A remediation request is never reinterpreted as terminal. Conflicting writers (touching the same file) MUST be serialized across waves — never dispatched simultaneously.

### 🔴 Autonomous Roadmap Completion Contract

Roadmap execution continues autonomously until every scoped roadmap task has evidence-backed completion or one of the five narrow escalation conditions is proven. Never report completion from source tests alone. Runtime-impacting changes require a deployment owner and deployment wave; the owner must rebuild and restart the current merged source, then health-check actual routes. Visual/UI gates and full acceptance are mandatory before terminal success. QA/security run once per declared boundary; writer fixes trigger only targeted rechecks and never recursive reviewer loops. Before the final response, reconcile roadmap markers and `TodoWrite` with evidence-backed state.

### Bounded QA, Documentation, and Visual Gates

QA runs targeted checks **once** after an implementation wave and does not trigger QA, Docs, or remediation work. Security is likewise a reporting-only bounded reviewer. `@ingenium-qa` is the single owner of a declared full E2E/container suite; the orchestrator schedules it but does not duplicate it. Neither QA nor security can delegate, spawn the other, or reopen a closed task. After a writer fixes a reviewer-reported in-scope blocker, the orchestrator runs the minimum targeted regression and reruns the original reviewer check only when that fix changes its declared review boundary. Docs runs only for directly affected canonical documentation or an explicit user request, and Docs work never triggers QA/Docs work.

UI work receives one changed-route visual gate after the final UI change for the route, and one passive full-site desktop/mobile sweep per user-requested UI batch, at 1440x900 and 390x844. A visual failure with a reproducible in-scope root cause receives causal source remediation and the smallest route recheck that proves it; the recheck alone never returns **ESCALATE_USER**. Docs-only and non-UI changes never open or reopen visual gates. PASS evidence includes screenshot, accessibility, network/console, and browser-cleanup confirmation.

All screenshots from visual QA gates must be saved under `tests/artifacts/visual-qa/<run-id>/` (e.g., `tests/artifacts/visual-qa/run-20260719/homepage-desktop.png`). See [mcp-tooling skill](../.opencode/skills/mcp-tooling/SKILL.md) for the complete screenshot storage convention.

### Restart Required for New Agent Profiles

Adding a new agent profile (`.opencode/agents/*.md`) requires restarting OpenCode before the auto-discovered agent becomes invocable by `@` mention.

After an OpenCode restart, invoke `@ingenium-qa-vision` on a known non-sensitive dashboard state. A **BLOCKED** result means stop and reconfigure the visual-QA path; it is not a pass.

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

**Single-container via `docker compose up --build`.** Six supervisord processes: API boundary (:4097), private Express API (:4096), Dashboard (:3000), Nginx gateway (:3000/:1455), opencode-web (:4098), and ttyd-opencode (:4099).

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
| `3000` | Dashboard + root gateways | WSL-forwardable local gateway; dashboard, Web, and CLI roots do not use HTTP Basic Auth |
| `127.0.0.1:4097` | API | Host-loopback bearer boundary for MCP clients; not the browser gateway |
| internal `4098` | OpenCode Web | Private container upstream; access only through authenticated `opencode.localhost:3000` root |
| internal `4099` | ttyd-opencode | Private container upstream; access only through authenticated `cli.localhost:3000` root |
| `127.0.0.1:1455` | OAuth callback proxy | Host `127.0.0.1:1455` → Nginx listener → private Express `:4096`. Only exact unauthenticated `GET /auth/callback` is allowed; the API validates and forwards the callback |

> 🔴 Dockerfile `EXPOSE` covers ports 3000, 4097, and 1455. OpenCode ports 4098 and 4099 remain private container listeners.

### Key Docker Notes

- **Volumes**: `ingenium-data` (/app/.ingenium), `opencode-config`, `opencode-data`. Workspace bind-mount: `~/repos` → `/workspace`.
- **Native-module libc parity**: Docker builder and runtime both use glibc-based `node:22-slim`; the runtime image verifies that copied native modules such as `better-sqlite3` load successfully. Do not mix an Alpine/musl builder with this runtime.
- **Nginx runtime paths and validation**: Nginx runs unprivileged as `appuser`; the image and entrypoint validate writable runtime paths and run `nginx -t` as `appuser`. Startup recreates the owner-only PID, lock, temporary, and error-log paths under ephemeral `/run/ingenium-gateway`; access logs are disabled and warning-level errors use the Supervisor-readable `nginx-error.log` file.
- **OpenCode Web/CLI**: Dashboard `/opencode` page has dual-mode iframes (Web: :4098, CLI: ttyd :4099). Glass tab toggle with `Ctrl+Shift+\``. Mode persisted in `localStorage`. The `sandbox` attribute has been removed from OpenCode iframes (trusted first-party content on separate origins).
- **OpenCode Access**: The Dashboard iframe connects to OpenCode Web via a URL derived at runtime by `runtime-urls.ts` using a **two-tier embedding model**. The old same-origin proxy rewrites (`/opencode-web/`, `/opencode-cli/`) have been **removed** — OpenCode v1.18.3+ serves root-relative assets and cannot be proxied under a sub-path:
  - **Loopback HTTP**: the dashboard accepts `http://localhost:3000/` and `http://127.0.0.1:3000/`; authenticated OpenCode roots are `http://opencode.localhost:3000/` (Web) and `http://cli.localhost:3000/` (CLI). Unexpected dashboard Host headers are rejected.
  - **Gateway separation**: dashboard and OpenCode traffic use independent Nginx `30r/s`, burst-60 buckets; assets and upgrade handshakes do not consume the dynamic OpenCode bucket. Direct IPv6 loopback dashboard navigation (`::1`/`[::1]`) is canonicalized with `308` to `localhost` so the CSP origin remains valid.
  - **Private upstream boundary**: OpenCode Web/ttyd ports `4098`/`4099` are container-internal only. The gateway strips browser authorization, identity, and proxy-chain headers, injects ttyd's fixed internal identity, and owns the loopback-only iframe CSP.
  - **Remote HTTPS**: requires explicit `NEXT_PUBLIC_OPENCODE_WEB_URL` / `NEXT_PUBLIC_OPENCODE_CLI_URL` pointing to a dedicated root HTTPS origin (e.g., `https://opencode.example.com/`). Only root HTTPS origins are accepted — relative same-origin paths are no longer supported.
  - **Unsupported LAN HTTP**: `getOpenCodeAvailability()` returns `"unavailable"`. The iframe shows explicit guidance: "OpenCode serves root-relative assets and cannot be proxied under a shared origin" with a fallback "Open OpenCode in a new tab" button.
  - The `sandbox` attribute has been **removed** from all OpenCode iframes (trusted first-party content; separate origin provides isolation). The `allow="clipboard-write"` Permissions Policy is retained.
  - The browser-facing process overrides `OPENCODE_SERVER_PASSWORD` to empty. The local Windows↔WSL gateway does not use browser credentials; ports 4098 and 4099 remain private container listeners. `OPENCODE_SERVER_PASSWORD` remains required for the API proxy guard and is never exposed to the browser.
- 🔴 **`synthesis-engine` and `email-client` are NOT supervisord processes.** They are in-process scheduled tasks in the API Express process. See [`services/ingenium-api/lib/routes/services.ts`](./services/ingenium-api/lib/routes/services.ts).
- 🔴 **Docker git**: `git` package installed for OpenCode repo creation.

---

## Testing

The default Playwright command is the deterministic Phase 5E fixture E2E run:
it starts production-mode API/dashboard processes and the chat fixture with a
run-owned temporary DB/project, validated manifest, and isolated high-port
block. Phase 5E also requires allowlisted child environments, API-only test
mode/bearer propagation (no bearer to dashboard or fixture), dashboard
server-only token-file isolation, retained stopping manifests and telemetry
for failed teardown, dynamic-port cleanup, and safe stale-artifact handling.
Manifestless stale processes are a manual recovery case: verify process
identity and ports before terminating anything, and retain unowned evidence.
It does not select
Docker, real-provider, mail, or manual visual suites. Those suites require
explicit opt-in and must never be treated as successful when skipped or
unselected. Full guidance is in
[docs/develop/testing.md](docs/develop/testing.md).

```bash
bash tests/test-self-improving.sh        # All 4 detection pipeline tests
bash tests/test-self-improving.sh -v     # Verbose output
bash tests/enforce-no-db-leaks.sh        # CI gate: verify no DB access leaks
bash tests/test-agent-validation.sh      # Agent validation checks (12 active agents)
bash tests/test-append-only-files.sh     # Verify append-only file constraints

npm run test --workspace=packages/ingenium-core          # Unit tests
npm run test --workspace=packages/ingenium-extension     # Extension package tests (vitest)
npm run typecheck --workspace=packages/ingenium-extension # Extension type checking (tsc --noEmit)
npx playwright test --config=tests/playwright.config.ts                             # Default fixture E2E (production mode)
npm test                                                  # All tests
```

Explicit suites:

```bash
RUN_DASHBOARD_DOCKER=1 npx playwright test --config=tests/playwright.docker.config.ts
RUN_DASHBOARD_PROVIDER=1 npx playwright test --config=tests/playwright.real-provider.config.ts
RUN_DASHBOARD_MAIL=1 npx playwright test --config=tests/playwright.mail.config.ts
RUN_DASHBOARD_MANUAL=1 npx playwright test --config=tests/playwright.manual.config.ts
```

Use `INGENIUM_E2E_API_PORT`, `INGENIUM_E2E_DASH_PORT`, and
`INGENIUM_E2E_FIXTURE_PORT` only for distinct isolated fixture ports;
`INGENIUM_E2E_DASHBOARD_URL`, `INGENIUM_E2E_API_URL`,
`INGENIUM_E2E_OPENCODE_WEB_URL`, `INGENIUM_E2E_CLI_URL`,
`OPENCODE_SERVER_URL`, and `INGENIUM_API_TOKEN` override external-suite
endpoints/authentication. `INGENIUM_E2E_SKIP_BUILD=1` skips only an already
completed build; it does not switch the fixture run out of production mode.
After runs, verify manifest-owned cleanup, retained recovery evidence, orphan
processes/ports, temporary directories, active handles, and RSS. Use
`npx tsx tests/suite-containment-audit.ts --strict`; strict mode is the required
gate and must inspect dynamic ports from the manifest/retained telemetry. The
canonical runner evidence root is `tests/artifacts/test-runs/<run-id>/`.
Screenshots must be run-scoped and stored below
`tests/artifacts/visual-qa/<run-id>/` or `tests/artifacts/manual/<date>/`, never
at the repository root. Missing, malformed, active, or unowned stale
artifacts must be retained and investigated, not removed with broad globs.

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

## Documentation Authority Policy

Repository Markdown under `docs/**/*.md` is the normal documentation authority.
Repository sync projects those files into the Ingenium Docs Workspace; agents should
update repository docs rather than silently mutating Workspace pages. Direct Docs
Workspace mutation is permitted only when the user explicitly requests it or the
documented repository-sync process. Automatic Workspace writes, post-change context
saves, and session transcript exports are not required and must not be performed by
default.

## Commands

Commands are captured in the DB alongside skills, agents, and plugins:

| Command | File | Purpose |
|---------|------|---------|
| `/synthesize` | `.opencode/commands/synthesize.md` | Trigger synthesis pipeline to process pending observations |
| `/sync-skills` | `.opencode/commands/sync-skills.md` | Bidirectional disk↔DB skill sync |
| `/init-project` | `.opencode/commands/init-project.md` | Preview or apply repository-authoritative docs, skills, agents, and plugins sync; supports `--docs-only` |
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
| 8 | Email `folder` value unchanged through call chain | [Email HARD RULEs](#-email--data-integrity-hard-rules) |
| 9 | Noreply-sender gate before cache lookup/generation | [Email HARD RULEs](#-email--data-integrity-hard-rules) |
| 10 | Never fall back to `reasoning_content`; use `max_tokens: 8192` | [Email HARD RULEs](#-email--data-integrity-hard-rules) |
| 11 | `ON CONFLICT DO UPDATE`, never `INSERT OR REPLACE` | [Email HARD RULEs](#-email--data-integrity-hard-rules) |
| 12 | Never hand-write RFC 2822 address-parsing regexes | [Email HARD RULEs](#-email--data-integrity-hard-rules) |
| 13 | Zod schemas are NOT runtime enforcement; SQL CHECK is the gate | [Email HARD RULEs](#-email--data-integrity-hard-rules) |
| 14 | Observe user behavior, NOT implementation details | [Self-Learning Pipeline](#self-learning-pipeline) |
| 15 | `synthesis-engine`/`email-client` are NOT supervisord processes | [Docker](#key-docker-notes) |
| 16 | Plugin lifecycle MUST sync disk + `opencode.json` plugin array | [Plugin Conventions](#plugin--skill-conventions) |
| 17 | Auto-observer registered in DB + both opencode configs | [Plugin Conventions](#plugin--skill-conventions) |
| 18 | Agent model mappings live in `opencode.json` — not in Markdown profile frontmatter | [Agent Table](#agent-table) |
| 19 | Never exceed 6 active subagents or 3 concurrent writers per phase; serialize conflicting writers | [Orchestration Policy](#-orchestration-policy--6-active--3-writer-phase-scheduler) |
| 20 | Declare phase (active count, writers, territories, dependencies, verification) before dispatch | [Orchestration Policy](#-orchestration-policy--6-active--3-writer-phase-scheduler) |
| 21 | Restart OpenCode for newly-added agent profiles to become invocable | [Orchestration Policy](#-orchestration-policy--6-active--3-writer-phase-scheduler) |
| 22 | Restart OpenCode when sync engine reports plugin/config changes | [Plugin Conventions](#plugin--skill-conventions) |
| 23 | Declare task scope, acceptance, stop condition, causal verification plan, and permitted escalation before dispatch | [Orchestration Policy](#-orchestration-policy--6-active--3-writer-phase-scheduler) |
| 24 | Remediate reproducible in-scope root causes automatically; only the five escalation conditions return ESCALATE_USER | [Orchestration Policy](#-orchestration-policy--6-active--3-writer-phase-scheduler) |
| 25 | STOP/CANCELLED is terminal; preserve evidence and report skipped work | [Orchestration Policy](#-orchestration-policy--6-active--3-writer-phase-scheduler) |

---

## Environment Variables

**Canonical reference**: [docs/VARIABLES.md](docs/VARIABLES.md) — lists all variables with defaults, consumers, and descriptions. CI enforces that every `process.env` reference has a doc entry.

---

## 🔴 Bounded QA and Documentation Workflow

After an implementation wave, invoke `@ingenium-qa` once for the task contract's targeted checks. Invoke `@ingenium-docs` only when canonical documentation is directly affected or the user explicitly requested it. QA and Docs never recursively trigger QA/Docs work.

The task contract requires causal remediation rather than a fixed retry limit: name the current reproducible root cause, fix it within scope, and run the minimum targeted regression. Continue declared source fix → targeted test → deploy → acceptance steps automatically. STOP/CANCELLED skips all remaining QA, Docs, security, and visual work while preserving evidence.

See [`ingenium-orchestrator.md`](./.opencode/agents/primary/ingenium-orchestrator.md) for the complete finite task contract.

---

## Agent Profiles

Full agent profile definitions: `.opencode/agents/<category>/<name>.md`
Archived profiles (historical reference): `.opencode/archive/agents/<category>/<name>.md`

> 💡 Adding a new Markdown agent profile requires an OpenCode restart for the agent to become invocable via `@mention`. Agent metadata (model, enabled status, and persisted frontmatter such as `hidden`) is managed via the Dashboard `/agents` page or `ingenium_agent_*` MCP tools. Runtime model/disable state is projected to `opencode.json`; persisted frontmatter metadata is restored during agent disk sync and enable/disable lifecycle writes. The model field is intentionally stripped from Markdown profiles on write — see `packages/ingenium-core/lib/tools/agents.ts`.
