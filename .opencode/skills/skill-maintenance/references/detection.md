---
title: "Detection — Finding Skill Candidates Through 6 Signals"
impact: HIGH
impactDescription: "Prevents skill gaps from going unnoticed as the codebase evolves"
tags: [detection, signals, coverage, gaps]
---

## Detection: Finding Skill Candidates

Before every coding session — and whenever you touch a new area — scan for these signals. When you find one, act immediately.

### Signal 1 — New Framework or Dependency

**Trigger:** A `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, or `Gemfile` contains a dependency not covered by any existing skill.

| If you see | Create a skill for |
|------------|-------------------|
| `express`, `fastify`, `hono` | Node.js server conventions |
| `django`, `flask`, `fastapi` | That framework's conventions |
| `prisma`, `drizzle`, `sqlalchemy` | ORM conventions |
| `graphql`, `apollo`, `relay` | GraphQL conventions |
| `tailwindcss`, `sass`, `styled-components` | Styling conventions |
| `vitest`, `playwright`, `cypress` | Testing conventions |
| `terraform`, `pulumi` | IaC conventions |
| `storybook` | Component documentation conventions |
| `github-actions`, `circleci` | CI/CD conventions |
| `nx`, `turborepo`, `lerna` | Monorepo tooling conventions |
| New `.proto` files | gRPC/Protobuf conventions |

### Signal 2 — Repeated Conventions Without a Skill

**Trigger:** Across multiple files, you see the same pattern that isn't documented in a skill.

- Three or more files follow the same naming pattern or structure
- Consistent error handling that differs from the framework default
- A directory structure that repeats across features
- Comments that say "remember to..." or "always..." (unwritten conventions)
- PR review comments that repeat the same feedback
- CI pipeline steps that enforce project-specific checks

### Signal 3 — Missing Coverage

**Trigger:** A file type or directory has no applicable skill.

- `**/*.graphql` or `**/*.proto` or `**/*.tf` files exist → skill for that domain
- `**/migrations/` directory → migration-specific skill
- `**/test/` or `**/__tests__/` with patterns → test conventions skill
- `**/i18n/` or `**/locales/` → internationalization skill

### Signal 4 — Deprecated or Drifted Content

**Trigger:** An existing skill says something that's no longer true.

- Skill references a package version that's been bumped
- Skill references a file path that no longer exists
- Skill mentions a command that fails
- Build/lint/test commands in the skill differ from what CI actually runs

### Signal 5 — Unlogged Changes

**Trigger:** Files changed in agents, hooks, plugins, deploy, or config but no corresponding entry was added to learnings.md.

- `git diff --name-only HEAD~1` shows agent/hook/plugin changes but no learnings entry
- Commits mention "agent", "plugin", "config" but don't touch learnings.md

### Signal 6 — Documentation Drift

**Trigger:** The project's documentation is out of sync with the actual file structure.

- Agent files changed but `docs/configure/agents.md` hasn't been updated
- Skills changed but skill count in docs hasn't been updated
- Hook files changed but architecture diagram is stale
