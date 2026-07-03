---
name: update-skills
description: "Create, update, and retire skills as projects evolve. Detects patterns (new frameworks, repeated conventions, missing coverage) and creates new skills autonomously. Covers both target-project skill management and bootstrap repo maintenance. Use when the codebase has grown new patterns, added dependencies, or when conventions have drifted."
---

# Update Skills — AI-Driven Skill Management

## What This Skill Covers

Skills are living documents — they should grow and change as the project grows. This skill teaches you how to **detect** when a project needs new or updated skills, **create** them with proper structure, and **retire** ones that are no longer relevant.

It covers two audiences:
- **Project developers** — managing skills in `.agents/skills/` as your project evolves
- **Bootstrap maintainers** — maintaining the source skills in `.agents/skills/`

## When to Use

- After adding a new framework, library, or tool to a project
- When you notice the same convention being repeated across files without a skill
- When an existing skill's instructions are outdated or wrong
- When a framework version bump changes conventions
- When a pattern (testing strategy, API pattern, file layout) has solidified and should be codified

---

# Part 1: Managing Skills in Your Project

Skills live at `.agents/skills/{name}/SKILL.md` in your project. They're invoked by name in VS Code Copilot chat (e.g., `/my-project-conventions`). Each skill has:

```yaml
---
name: {must-match-folder-name}
description: "What this covers and when to use it. Be keyword-rich for AI discovery."
---
# Skill Title

## When to Use
...
```

## Detection: Finding Skill Candidates

Before every coding session — and whenever you touch a new area of a project — scan for these signals. When you find one, **create the skill immediately** — no need to ask. The agent audits, fixes, and creates autonomously.

### Signal 1 — New Framework or Dependency

**Trigger:** A `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, or `Gemfile` contains a dependency not covered by any existing skill.

| If you see | Create a skill for |
|------------|-------------------|
| `express`, `fastify`, `hono` | Node.js server conventions |
| `django`, `flask`, `fastapi` (new) | That framework's conventions |
| `prisma`, `drizzle`, `sqlalchemy` | ORM conventions |
| `graphql`, `apollo`, `relay` | GraphQL conventions |
| `tailwindcss`, `sass`, `styled-components` | Styling conventions |
| `vitest`, `playwright`, `cypress` | Testing conventions |
| `terraform`, `pulumi` | IaC conventions |
| `docker-compose` with new services | Service-specific container conventions |
| `storybook` | Component documentation conventions |
| `eslint`, `prettier` (custom config) | Linting/formatting conventions |
| `github-actions`, `circleci` | CI/CD conventions |
| `nx`, `turborepo`, `lerna` | Monorepo tooling conventions (build orchestration) |
| New `.proto` files | gRPC/Protobuf conventions |
| Multiple services in one repo, `services/` or `packages/` dirs | `project-structure` skill — monorepo layout, service layering, boundaries |

### Signal 2 — Repeated Conventions Without a Skill

**Trigger:** Across multiple files, you see the same pattern that isn't documented in a skill.

**Detection checklist:**
- Three or more files follow the same naming pattern (e.g., `use*` hooks, `*Service` classes, `*Repository` interfaces)
- Consistent error handling that differs from the framework default
- A directory structure that repeats (e.g., every feature has `components/`, `hooks/`, `tests/`)
- Comments that say "remember to..." or "always..." (these are unwritten conventions)
- PR review comments that repeat the same feedback
- A `CONTRIBUTING.md` or wiki page with rules not in any skill
- `eslintrc`, `.prettierrc`, `pyproject.toml [tool.ruff]` — every customized rule is a convention worth documenting
- CI pipeline steps that enforce project-specific checks
- `.env.example` or config files with project-specific environment variables

### Signal 3 — Missing Coverage

**Trigger:** A file type or directory has no applicable skill.

**Detection checklist:**
- `**/*.graphql` or `**/*.gql` files exist → no GraphQL skill
- `**/*.proto` files exist → no Protobuf skill
- `**/*.tf` files exist → no Terraform skill
- `**/*.yml` in `.agents/workflows/` → no CI skill
- `**/*.mdx` files → no MDX/docs skill
- `**/migrations/` directory → no migration-specific skill
- `**/scripts/` directory with `.sh`/`.py`/`.ts` → no script conventions
- `**/test/` or `**/__tests__/` with patterns → no test conventions skill
- `**/i18n/` or `**/locales/` → no internationalization skill
- `**/*.env*` files → no environment config skill

### Signal 4 — Deprecated or Drifted Content

**Trigger:** An existing skill says something that's no longer true.

**Detection checklist:**
- Skill references a package version that's been bumped (e.g., "use React 18 patterns" but `package.json` has React 19)
- Skill says "use X" but the codebase has migrated to Y
- Skill references a file path that no longer exists
- Skill mentions a command that fails (`npx outdated-script` → error)
- A skill hasn't been updated in months but the codebase is active
- Build/lint/test commands in the skill differ from what CI actually runs

## Creation: Writing a New Skill

When you've identified a candidate, create it immediately. No approval needed.

### Step 1 — Choose the Name

The folder name **must** match the `name` field. Rules:
- **Framework skills:** `{framework}-conventions` (e.g., `django-conventions`, `express-conventions`)
- **Domain skills:** `{domain}` (e.g., `graphql`, `i18n`, `storybook`)
- **Project-specific:** `{project}-{area}` (e.g., `myapp-auth`, `myapp-testing`)
- **Kebab-case only.** No underscores, no uppercase.

### Step 2 — Write the SKILL.md

Template:

```markdown
---
name: {skill-name}
description: "{One sentence: what this covers and when to use it. Include framework names, file types, and trigger keywords.}"
---

# {Skill Title}

## When to Use

- list specific triggers: file types, directories, tasks
- be explicit so the AI knows exactly when to invoke this skill

## {Topic 1} — {Mandatory/Optional}

Convention content here. Use these patterns:
- **Bold rules** for mandatory conventions
- Code blocks for commands and examples
- Tables for comparisons and references
- Checklists for multi-step procedures

## {Topic 2}

...

## Testing & Verification

How to verify these conventions are followed:
- Which lint rules enforce this?
- Which test patterns validate this?
- Which CI step catches violations?
```

### Step 3 — Add Scripts (If Needed)

If the skill needs executable code, create `scripts/`:

```
.agents/skills/{skill-name}/
├── SKILL.md
└── scripts/
    └── check-conventions.sh   ← executable, validates conventions
```

### Step 4 — Add References (If Needed)

For skills that need external docs loaded on demand:

```
.agents/skills/{skill-name}/
├── SKILL.md
└── references/
    └── api-reference.md       ← detailed API docs, loaded when needed
```

### Tests Go in `tests/`, Not in Skills or Deploy

Tests for the skill system itself — validation scripts, audit helpers, self-improving pipeline tests — belong in `tests/` at the project root, alongside `docs/`. They should **never** be placed in:

- `deploy/.agents/` — deploy is a clean slate of skills only; no scripts, hooks, or tests
- Individual skill directories — skills are documentation, not test harnesses

**If `tests/` doesn't exist, create it.** The `useful-tests` skill covers testing conventions; any test script added to `tests/` should follow those patterns.

### Step 5 — Commit, Then Log to learnings.md

**Always commit changes before logging.** This ensures every learnings entry has a verifiable commit hash.

1. **Commit all changes** with a descriptive message:
   ```bash
   git add -A
   git commit -m "skill({name}): {brief description of what changed}"
   ```

2. **Capture the commit hash:**
   ```bash
   git rev-parse --short HEAD
   ```

3. **Append to `.agents/skills/learnings.md`** with the commit link:

```markdown
## YYYY-MM-DD — {skill-name}

- **Commit**: `{short-hash}`
- **Added/Updated**: `{skill-name}` skill — {one-line description}
- **Source**: {what triggered this — new dependency, repeated pattern, missing coverage, stale content}
- **Category**: {Always-Included / Task / Framework}
```

This creates a changelog where every entry is traceable to a specific commit.

### Step 6 — Validate

```bash
# Check name matches folder
SKILL_DIR=".agents/skills/my-skill"
grep "^name:" "$SKILL_DIR/SKILL.md" | grep -q "$(basename $SKILL_DIR)" && echo "OK" || echo "NAME MISMATCH"

# Check frontmatter fences
head -1 "$SKILL_DIR/SKILL.md" | grep -q "^---$" && echo "OK" || echo "MISSING OPENING FENCE"
```

## Update: Refreshing an Existing Skill

When a skill is outdated:

1. **Read the skill** fully — understand what it currently says
2. **Read the codebase** — find the files the skill covers, check current patterns
3. **Diff the changes** — what's different between skill and reality?
4. **Update the skill** — fix outdated commands, versions, paths, and conventions
5. **Check for cascading updates** — if this skill says "see also X", check X too
6. **Update docs** — if `docs/CONVENTIONS.md` references this skill, update it in the same turn
7. **Test** — invoke the skill in VS Code chat and verify it gives correct guidance

## Retire: Removing a Stale Skill

When a skill is no longer relevant:

1. **Verify it's truly unused** — grep the codebase for the pattern it covers
2. **Check for references** — does any other skill or doc link to it?
3. **Delete the directory** — `rm -rf .agents/skills/{name}/`
4. **Update docs** — remove references from `docs/` and skill listings
5. **Update bootstrap.sh** — if this was a framework overlay, remove from the FILES array

---

# Part 2: Maintaining the Bootstrap Repo

This section is for maintainers of the `gh-llm-bootstrap` repo itself. Source skills live at `.agents/skills/` and are copied to `.agents/skills/` in target projects by `bootstrap.sh`.

## The Skill Architecture

Before making any change, understand which layer you're touching:

1. **Core** (`generic-conventions/SKILL.md`) — affects ALL projects. Change with caution.
2. **Framework skills** (`.agents/skills/{fw}-conventions/SKILL.md`) — copied when `--framework {fw}` is selected.
3. **Cross-cutting skills** (`.agents/skills/{domain}/SKILL.md`) — Containers, Shell, SQL, API Design, Kubernetes, TypeScript. Copied to all targets.
4. **Core skills** (`generic-conventions`) — always copied.
5. **Task skills** (`generate-docs`, `repo-context`, `write-docs`, `update-skills`) — optional. Invocable via `/` in VS Code chat.
6. **Enforcement** (`.agents/hooks/`) — deterministic lifecycle hooks.
7. **CI** (`.agents/workflows/ci.yml`) — matrix CI for lint/build/test.

## Procedure: Add a New Framework Skill

1. Read `USAGE.md` → "Add a New Framework Skill" for the checklist
2. Create `.agents/skills/{framework}-conventions/SKILL.md`:
   - `name`: `{framework}-conventions`
   - `description`: keyword-rich, "Use when..." pattern
   - Body: build/test commands, directory conventions, language idioms
3. Add the framework to the table in `USAGE.md`
4. Add the skill to `.agents/scripts/bootstrap.sh` in the `case "$FRAMEWORK"` block
5. Update `docs/TECH-STACK.md` if relevant
6. Test: `./.agents/scripts/bootstrap.sh --dry-run --framework {name} /tmp/test`

## Procedure: Modify Core Rules

1. Read `generic-conventions/SKILL.md` fully — understand all current rules
2. Read all framework skills — check for conflicts with your change
3. Make the change to `generic-conventions/SKILL.md`
4. Update any framework skills that reference the changed rule
5. Update `docs/CONVENTIONS.md` if conventions changed
6. Run `./.agents/scripts/bootstrap.sh --dry-run` for each framework

## Procedure: Fix a Skill File

1. Check frontmatter: `---` fences, `name` matches folder, `description` is keyword-rich
2. Check body: clear "When to Use" section, one concern per skill, no duplicated docs content
3. Test: invoke the skill by name in VS Code chat

## File Dependencies Map

```
.agents/skills/generic-conventions/SKILL.md
  └── The definitive core rules (replaces the old monolithic AGENTS.md)
  ├── docs/ (always updated alongside code)
  ├── USAGE.md (references skill system)
  └── .agents/skills/generic-conventions/SKILL.md (loads core rules before every code change)

.agents/skills/{fw}-conventions/SKILL.md
  └── References generic-conventions, extends with framework-specific rules

.agents/skills/containers/SKILL.md → Dockerfile, Containerfile, docker-compose, .dockerignore
.agents/skills/shell-scripts/SKILL.md → .sh/.bash files
.agents/skills/sql-database/SKILL.md → .sql files, migrations
.agents/skills/api-design/SKILL.md → route/handler/api/controller files
.agents/skills/kubernetes/SKILL.md → k8s/helm/chart YAML files
.agents/skills/typescript-standalone/SKILL.md → .ts/.tsx files (non-Next.js)

.agents/skills/repo-context/SKILL.md → task: project identity and context
.agents/skills/generate-docs/SKILL.md → task: populate docs/ from codebase
.agents/skills/write-docs/SKILL.md → task: write READMEs, API docs, ADRs
.agents/skills/update-skills/SKILL.md → task: create, update, retire skills

.agents/hooks/ → lifecycle enforcement
.agents/scripts/bootstrap.sh → copies skills into target projects
.agents/scripts/hook-bootstrap.sh → auto-detect + bootstrap on session start
```

## Anti-Patterns to Watch For

- **Missing `name` or `description` frontmatter** — skill won't load or be discoverable
- **YAML frontmatter silent failures** — unescaped colons, tabs instead of spaces, missing `---` fences
- **Mixing concerns** — one skill for both testing AND styling AND API design
- **Contradictory rules** — core says "run tests", skill says "skip tests" without explanation
- **`name` mismatch** — `name` in frontmatter must match the folder name exactly
- **Duplicating docs in skills** — link to docs instead: `See docs/TESTING.md for conventions`
- **Creating skills without scanning first** — always run the detection checklist before creating; don't create skills for patterns that don't exist
- **Too many skills** — each skill costs context. If two skills overlap 80%, merge them
- **Skills that are just docs** — if a skill only links to docs, it should just be a docs entry
