# Tech Stack

## Languages

| Language | Used for | Why |
|----------|----------|-----|
| **Bash** (5.x+) | Bootstrap scripts, test suite | Universal availability, no runtime deps, POSIX-compatible |
| **TypeScript** | OpenCode lifecycle plugins (`.opencode/plugins/*.ts`) | Type-safe plugin development with strict compiler flags; compiled to JS for runtime |
| **Markdown** | All skill bodies (SKILL.md), all documentation | Universal format, AI-native, rendered as Markdown |
| **YAML** | Skill frontmatter (`name`, `description`) | Human-readable, strict syntax prevents silent failures |
| **JSON** | Hooks (`session-start.json`, `pre-tool-use.json`, `post-tool-use.json`) | Deterministic, machine-enforced |
| **Mermaid** | Architecture & flow diagrams in README.md and docs | Renders on GitHub without external deps |
| **Bash** (orchestrator use) | Git operations, verification, file moves — strict subagent delegation | Orchestrator NEVER writes code. Bash use limited to `git add/commit/push`, `cp/mv/rm`, `npm run`, verify-only commands |

## Frameworks

**None.** The project intentionally has zero framework dependencies. It operates as pure files — Markdown + YAML + Bash — so it can bootstrap into any target project regardless of its tech stack.

## Key Dependencies

| Dependency | Version | Purpose | Why |
|-----------|---------|---------|-----|
| **bash** | ≥5.0 | Script execution | `inherit_errexit` (default ON in 5.x) needed for test suite |
| **git** | any | Version control | Commit hashes for learnings.md changelog |
| **TypeScript / tsc** | ≥5.x (via `@opencode-ai/plugin`) | Plugin compilation | Strict type safety for OpenCode lifecycle hooks |
| **Node.js / npm** | ≥18.x | Plugin package management | Required for `npm install` and `tsc` in plugin directory |
| **find** | any | Test suite file enumeration | Standard POSIX utility |
| **grep** | any | Pattern matching in tests | Standard POSIX utility |
| **sed** | any | Text processing | Standard POSIX utility |

The `package.json` at the project root contains entries like `solidjs`, `astro`, `pino`, and `bullmq` — but these are **never installed**. They exist solely to provide a dependency list that the `test-self-improving.sh` gap detection (Signal 1) can validate against. The test asserts that these deps correctly trigger "NO matching skill" detection.

## Development Tools

| Tool | Used for |
|------|----------|
| **TypeScript Compiler (`tsc`)** | Compiling `.opencode/plugins/*.ts` to JavaScript with strict checks |
| **Node.js / npm** | Installing `@opencode-ai/plugin` SDK and running `tsc` |
| **shellcheck** (optional) | Linting bootstrap and test scripts |
| **git** | Version control, conventional commits |
| **Any editor with AI support** | The skill system targets any AI coding assistant that supports the `.agents/` convention (OpenCode, Cline, Claude, and others) |

## Infrastructure

None. This is a file-based toolkit. There is no server, no database, no deployment infrastructure.

## Version Policy

- **Bash**: Must be ≥5.0 for `inherit_errexit` behavior. Earlier versions will fail tests silently.
- **git**: Any version supporting conventional commits.
- **TypeScript**: Must be compatible with `@opencode-ai/plugin` SDK types (currently `1.x`).
- **Node.js**: Must be ≥18.x for ESM module support in plugin directory.
- **No pinned versions for runtime** — the project's core (Markdown + YAML + Bash) has zero runtime dependencies to pin. `package.json` at root is a test fixture, not an install manifest. Plugin `package.json` in `.opencode/plugins/` does pin `@opencode-ai/plugin`.

## Agent Pipeline Models

| Agent | Model | Purpose |
|-------|-------|---------|
| @ingenium-scrum | DeepSeek V4 Pro | Sprint planning, kaban board population — read-only. Spawns explore + scout for analysis |
| @ingenium-orchestrator | DeepSeek V4 Flash | Coordination — NEVER writes code directly. Full 5-layer enforcement: always-visible primer in opencode.json, Pre-Action Gate, Anti-Patterns table, Periodic Self-Audit, post-tool-use hook |
| @ingenium-software-engineer | DeepSeek V4 Flash (Zen free) | **All code implementation** — read/write. Writes production code, self-verifies |
| @ingenium-qa | DeepSeek V4 Flash (Zen free) | Code review + test authoring. Write-only (tests). Does NOT write production code |
| @ingenium-docs | DeepSeek V4 Flash (Zen free) | Documentation + skill management. Write-only (docs) |
| @ingenium-explore | DeepSeek V4 Flash | Codebase search — read-only. grep, glob, file discovery |
| @ingenium-scout | qwopus 3.5 9B Coder (LM Studio) | Thread/RAG context — read-only. Persistent memory across sessions |
| @ingenium-security-auditor | DeepSeek V4 Flash | Security audit — bash + read-only. Git history leak scanning |

## Key Integrations

| Integration | Purpose | Configured by |
|-------------|---------|---------------|
| **Thread MCP** | Persistent memory via local MCP server | `opencode.json` `mcp.thread` |
| **LM Studio** | Local model inference for `ingenium-scout` (qwopus) | `~/.config/opencode/opencode.jsonc` provider config |
| **OpenCode Zen** | Free-tier model pool for execution subagents | `opencode.json` model assignments |
| **DeepSeek API** | Paid model pool for planner + orchestrator + explore + security-auditor | `opencode.json` model assignments |


