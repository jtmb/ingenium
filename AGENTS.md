# AGENTS.md — Ingenium MCP Server Agent Protocol

This is the **Agent Protocol** for the Ingenium MCP Server. Skills are loaded from the Ingenium SQLite database via the MCP server. Skill source files live at `seed/skills/<name>/` (canonical editing location) and are written to disk at `.opencode/skills/<name>/` with a split-skill format (SKILL.md + metadata.json + references/).

> 🔴 **Security**: Never commit `THREAD_API_TOKEN` to source. Use `<YOUR_THREAD_API_TOKEN>` placeholder in `opencode.json`.

> **Dashboard**: Skills can be managed through the Ingenium Dashboard at [http://localhost:3000](http://localhost:3000).

---

## 🔴 MANDATORY — Load Skills Before Acting

**Before writing code, running a command, or responding to any request, you MUST load matching skills.** Skills contain 🔴 HARD RULEs that override everything else.

### Session Startup
1. **Match skills** — Check the catalog against the request and files you might edit
2. **Load matching skills** — Read `.opencode/skills/<name>/SKILL.md` (or `seed/skills/<name>/SKILL.md` if not yet written) for each match
3. **Note 🔴 HARD RULEs** — These take priority over everything else
4. **Run `/repo-context`** for project identity

### Pre-Flight Check

| You're about to... | Check this skill |
|-------------------|-----------------|
| Edit a source file | Framework skill (`nextjs`, `python`, `go`, `rust`, `typescript-standalone`) |
| Run a terminal command | `local-models` — **no `&`, no infinite-wait** |
| Create a new file/service | `project-structure` |
| Write/run tests | `useful-tests` |
| Edit Docker/K8s | `containers` / `kubernetes` |
| Edit shell scripts | `shell-scripts` — `set -euo pipefail` |

### 🔴 MANDATORY Skills (load before ANY action)

`agent-checkpoints` `build-pipelines` `configuring-opencode` `containerized-agents` `customize-opencode` `debugging-patterns` `development-conventions` `devops-conventions` `github-cli` `local-models` `mcp-tooling` `skill-maintenance`

### 🔴 MANDATORY — Self-Improvement

After ANY code change, you MUST run the applicable self-improvement commands:

| Command | Action |
|---------|--------|
| `/update-skills` | Detects gaps and creates/retires skills |
| `/audit-skills` | Cross-references skills against README, mermaid, skill index |
| `/update-skill-index` | Regenerates `SKILL-INDEX.md` from all skill files |
| All changes | Log via `ingenium_observe(observation_type="preference", ...)` MCP tool with `entry_type`, tags, and content |

These are not optional. Skip none of them.

---

## Repository Structure

**Monorepo with 4 packages:**

```
packages/
└── ingenium-core/        # Shared library: SQLite WAL + FTS5, Zod schemas (DB access allowed)

services/
├── ingenium-api/         # Express REST API on :4097. Sole DB authority.
├── ingenium-server/      # MCP stdio server with 48 tools. Calls API via HTTP. Zero DB access.
└── ingenium-dashboard/   # Next.js 16 App Router frontend. Calls API via HTTP. Zero DB access.
```

**API-First Architecture:** Dashboard and server import ZERO core/server code. All data flows through the API layer.

---

## 🔴 MANDATORY — Database Isolation

**Only `packages/ingenium-core` and `services/ingenium-api` may import SQL libraries.** CI enforces this:

```bash
grep -r "better-sqlite3\|\.db\|sqlite" services/ingenium-server/  # must return empty
grep -r "better-sqlite3\|\.db\|sqlite" services/ingenium-dashboard/  # must return empty
```

Move any DB logic to the API layer immediately.

---

## Docker Deployment

**Single-container deployment via `docker compose up --build`**. The container runs **supervisord** managing three processes:

1. **API** (Express on :4097) — `express.json({ limit: "2mb" })` for large skill uploads
2. **Dashboard** (Next.js on :3000) — highlight.js syntax highlighting in Preview/Source modes
3. **opencode-server** (on :4096) — Auth-enabled OpenCode web server

### Start/Stop Commands

```bash
# Start all services (with build)
docker compose up --build

# Start without rebuild
docker compose up

# Stop all services
docker compose down

# View logs
docker compose logs -f

# Execute commands inside container
docker compose exec ingenium npm run test
docker compose exec ingenium npm run check
```

### Port Mappings

| Host Port | Service | Description |
|-----------|---------|-------------|
| `3000` | Dashboard | Next.js frontend (http://localhost:3000) |
| `4096` | OpenCode Server | Auth-enabled MCP server |
| `4097` | API | Express REST gateway (sole DB authority) |
| `4098` | OpenCode Iframe | No-auth iframe for embedded use |

### Volume Configurations

| Volume Name | Mount Path | Purpose |
|-------------|------------|---------|
| `ingenium-data` | `/app/.ingenium` | SQLite databases, learnings, tasks, projects |
| `opencode-config` | `/home/appuser/.config` | OpenCode configuration (persists across rebuilds) |
| `opencode-data` | `/home/appuser/.local` | OpenCode user data, session state |

**Workspace bind-mount:** Your local `~/repos` is mounted at `/workspace` for file editing.

### Health Check

API health check ensures services are ready:
```yaml
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://localhost:4097/api/v1/health"]
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 15s
```

---

## Testing

```bash
bash tests/test-self-improving.sh        # All 5 detection pipeline tests
bash tests/test-self-improving.sh -v     # Verbose output
bash tests/enforce-no-db-leaks.sh        # CI gate: verify no DB access leaks
tests/test-agent-validation.sh           # Agent validation checks
```

---

## Conventions

### Self-Learning Pipeline — Observations (Preferred)

The self-learning pipeline uses **observations** instead of the deprecated `ingenium_learning_log` tool. Every change that modifies skills, agents, hooks, plugins, config, or architecture should be logged via `ingenium_observe`.

**Observation types:**
- `correction` — User corrects agent behavior
- `preference` — User preference or configuration choice (most common for logging)
- `pattern` — Repeated convention or workflow
- `insight` — Novel discovery
- `feedback` — Implicit accept/reject
- `behavior` — User behavior signal
- `terminology` — Preferred language
- `workflow` — Workflow sequence
- `error` — User encountered error
- `goal` — Stated or implied goal

**How it works:**
1. Call `ingenium_observe(observation_type="preference", content="...", importance=7)` during your workflow
2. Observations are stored in the DB with status "pending"
3. The synthesis pipeline (triggered by `/synthesize` or auto on session events) processes them
4. Personality traits are created from observations
5. Skills are updated automatically

**File fallback:** If the API is down, observations append to `.opencode/skills/learnings.md`. On next session start, `importLearningsFromFile()` syncs file entries into the DB.

> 🔴 **Note:** The old `ingenium_learning_log` tool is deprecated but still functional for backward compatibility. New code should use `ingenium_observe`.

### Related Self-Learning Skill

See `.opencode/skills/self-learning/SKILL.md` for complete documentation of the self-learning pipeline, including:
- Observation types and when to use them
- Personality trait generation rules
- Synthesis pipeline architecture
- MCP tools reference

> 📖 **Full reference**: See [`self-learning-pipeline.md`](./self-learning-pipeline.md) at project root for complete documentation of the observation types, personality traits, MCP tools, API endpoints, synthesis pipeline details, and deprecation notes.

### Plugin Auto-Config Sync

Every plugin lifecycle operation (create, enable, disable, delete, update) MUST also sync:
1. `.opencode/plugins/<file>.ts` on disk
2. `opencode.json`'s `plugin` array

This prevents "disconnected config" bugs where the DB shows a plugin as enabled but OpenCode can't load it.

### Skill file_tree Format

Every skill in the DB has a `file_tree` column (JSON map of relative paths → content) for complete data round-trips:

- **Writing to disk:** `writeSkillToDisk()` writes SKILL.md + metadata.json, then every file in `file_tree`
- **Reading from disk:** `syncSkillFromDisk()` reads SKILL.md + metadata.json, walks directory tree, stores as `file_tree` JSON
- **Split-skill format on disk:** Each skill is a directory with `SKILL.md` (main content + YAML frontmatter), `metadata.json` (tags, alwaysApply), and optional `references/` directory
- **Canonical source:** Edit at `seed/skills/<name>/`, then use dashboard or `ingenium_skill_sync` to persist to DB
- **Runtime copy:** `.opencode/skills/<name>/` is auto-written from DB. Do not edit — changes will be overwritten unless synced back

### Dashboard Styling Guide

Every service with a frontend must have a `STYLING-GUIDE.md` in its service directory documenting:
- Color palette with exact values
- Typography scale
- Layout grid and spacing
- Component-level styles (nav, cards, forms)
- Immutable rules that must not be broken

### Environment Variables

| Variable | Default | Consumed By |
|----------|---------|-------------|
| `OPENCODE_SERVER_PASSWORD` | `test` | OpenCode server |
| `INGENIUM_API_URL` | `http://localhost:4097/api/v1` | ingenium-server |
| `INGENIUM_API_TIMEOUT` | `10000` | ingenium-server |
| `LOG_LEVEL` | `info` | ingenium-server |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4097/api/v1` | ingenium-dashboard |
