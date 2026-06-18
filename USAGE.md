# USAGE.md — How to Apply and Maintain AI Rules

This is your handbook for working with the layered agent instruction system. When you think *"I need to add a rule, where does it go?"* — start here.

---

## Quick-Start: Set Up the Hook (do this once)

This repo is consumed as a hook. Configure it once in your VS Code Copilot user settings, and every project auto-bootstraps.

Add this to your VS Code Copilot user settings (`github.copilot.chat.agent.hooks`):

```json
{
  "SessionStart": [
    {
      "command": "if [ ! -f AGENTS.md ]; then bash <(curl -fsSL https://raw.githubusercontent.com/brajam/gh-llm-bootstrap/main/.github/scripts/hook-bootstrap.sh); fi",
      "timeout": 30
    }
  ]
}
```

Now open any project, start a Copilot chat, and the hook auto-boostraps it.

**What you get (in every project):**
- `AGENTS.md` — core conventions (docs, comments, tests, DRY)
- `.github/instructions/always-read-agents.instructions.md` — forces AI to read AGENTS.md before every code change
- `.github/instructions/{framework}.instructions.md` — framework-specific rules (auto-detected)
- `.github/instructions/generic.instructions.md` — fallback for any file not covered
- `docs/` — pre-seeded documentation templates (ARCHITECTURE.md, TECH-STACK.md, CONVENTIONS.md)
- `USAGE.md` — this file

---

## Quick-Start: Manual Bootstrap (no hooks)

If you can't use hooks, bootstrap manually:

```bash
# One-liner — clone and bootstrap in one go
git clone --depth 1 https://github.com/brajam/gh-llm-bootstrap.git && \
  ./gh-llm-bootstrap/.github/scripts/bootstrap.sh --framework python --project-name my-backend /path/to/project

# Or interactive mode
./gh-llm-bootstrap/.github/scripts/bootstrap.sh /path/to/project
```

For an existing project with code already:

```bash
# Auto-detect framework and bootstrap non-interactively
gh-llm-bootstrap/.github/scripts/bootstrap.sh --auto --framework python /path/to/existing-project
```

Pro tip: `.github/scripts/hook-bootstrap.sh` handles the auto-detection for you even in manual mode:

```bash
bash gh-llm-bootstrap/.github/scripts/hook-bootstrap.sh --framework nextjs
```

---

## Decision Tree: Where Do I Put This Rule?

Use this flowchart to determine which file type a new rule belongs in.

```mermaid
graph TD
    START[I need to add a rule...] --> Q1{Applies to ALL code, ALL the time?}
    Q1 -->|Yes| AGENTS[AGENTS.md]
    Q1 -->|No| Q2{Applies to specific FILE PATTERNS?}
    Q2 -->|Yes| INSTR[".github/instructions/{name}.instructions.md\nUse applyTo glob"]
    Q2 -->|No| Q3{Applies to a specific TASK?}
    Q3 -->|Yes| PROMPT[".github/prompts/{name}.prompt.md\nInvocable via /"]
    Q3 -->|No| Q4{Must be ENFORCED deterministically?}
    Q4 -->|Yes| HOOK[".github/hooks/{name}.json\nRuns at agent lifecycle events"]
    Q4 -->|No| Q5{Multi-step WORKFLOW with assets?}
    Q5 -->|Yes| SKILL[".github/skills/{name}/SKILL.md\nBundles scripts + references"]
    Q5 -->|No| Q6{Specialized agent PERSONA?}
    Q6 -->|Yes| AGENT[".github/agents/{name}.agent.md\nRestricted tools + behaviors"]
    Q6 -->|No| RECONSIDER[Reconsider — maybe it doesn't need an AI rule]
```

### Quick Reference Table

| Intent | File Type | Location | Has Frontmatter? |
|--------|-----------|----------|------------------|
| "All code must have comments" | Core rule | `AGENTS.md` | No |
| "Python files must use type hints" | Framework instruction | `.github/instructions/python.instructions.md` | Yes (`applyTo`) |
| "Generate test cases for this file" | Prompt | `.github/prompts/gen-tests.prompt.md` | Yes (`description`) |
| "Block `rm -rf` without approval" | Hook | `.github/hooks/pre-tool-use.json` | N/A (JSON) |
| "Full database migration workflow" | Skill | `.github/skills/db-migrate/SKILL.md` | Yes (`name`, `description`) |
| "Code review specialist" | Agent | `.github/agents/code-reviewer.agent.md` | Yes (`description`, `tools`) |

---

## Directory Structure Reference

```
your-project/
├── AGENTS.md                                    ← Core conventions (framework-agnostic, always loaded)
├── USAGE.md                                     ← This file — how to use and maintain rules
├── README.md                                    ← Project overview (hand-written)
├── docs/                                        ← Pre-seeded documentation database
│   ├── README.md                                ←   Index of all docs (AI-discoverable)
│   ├── ARCHITECTURE.md                          ←   Project structure & data flow
│   ├── TECH-STACK.md                            ←   Dependencies & version decisions
│   └── CONVENTIONS.md                           ←   Naming, patterns, file organization
├── .github/
│   ├── instructions/                            ← File-scoped rules (applyTo globs)
│   │   ├── always-read-agents.instructions.md   ←   Forces AGENTS.md re-read before every change
│   │   ├── nextjs.instructions.md               ←   Next.js/TypeScript conventions
│   │   ├── python.instructions.md               ←   Python conventions
│   │   ├── go.instructions.md                   ←   Go conventions
│   │   ├── rust.instructions.md                 ←   Rust conventions
│   │   ├── generic.instructions.md              ←   Fallback for any file type
│   │   └── {project-name}.instructions.md       ←   Your project-specific rules
│   ├── prompts/                                 ← Task templates (invocable via /)
│   │   ├── repo-context.prompt.md               ←   System identity & docs map
│   │   └── generate-docs.prompt.md              ←   Fill docs/ from codebase scan
│   ├── hooks/                                   ← Deterministic enforcement (JSON)
│   │   ├── pre-tool-use.json                    ←   Validate before tool calls
│   │   └── post-tool-use.json                   ←   Auto-lint after file edits
│   ├── skills/                                  ← Multi-step workflows with assets
│   │   └── {skill-name}/
│   │       └── SKILL.md                         ←   Skill body + reference links
│   ├── agents/                                  ← Custom agent personas
│   │   └── {agent-name}.agent.md                ←   Agent with restricted tools
│   └── workflows/                               ← CI enforcement
│       └── ci.yml                               ←   Lint, test, build on push/PR
```

---

## Step-by-Step Guides

### Add a New Framework Overlay

Adding support for a new language or framework (e.g., Ruby, Elixir, Zig):

1. **Create the instruction file** at `.github/instructions/{framework}.instructions.md`:
   ```yaml
   ---
   description: "Use when working with {Framework} files. Covers conventions, build commands, and testing."
   applyTo: "**/*.{extensions}"
   ---
   # {Framework} Conventions
   ...
   ```

2. **Add the framework** to the table in this `USAGE.md` (Framework Support Table section at bottom).

3. **Update `bootstrap.sh`** — add the framework to the `--framework` flag's accepted values.

4. **Update `docs/TECH-STACK.md`** if relevant.

5. **Test**: `./bootstrap.sh --dry-run --framework {name} /tmp/test` — verify the correct files are selected.

6. **Create a `.github/instructions/{name}.instructions.md`** in the bootstrap repo. List it in this USAGE.md.

### Add a Project-Specific Rule

When your project has a rule that isn't framework-generic (e.g., "never import X in Y layer"):

1. **Identify the right primitive** using the decision tree above.

2. **Create the file** in the correct `.github/` subdirectory with proper frontmatter:
   - Instructions: `description` + `applyTo` (scope tightly!)
   - Prompts: `description` (keyword-rich for discovery)
   - Skills: `name` (must match folder) + `description`
   - Agents: `description` + `tools`
   - Hooks: valid JSON with `type: "command"`

3. **Scope `applyTo` tightly** — prefer `"src/api/**/*.ts"` over `"**"`. Broad globs burn context and may conflict with other rules.

4. **Add to the docs map** — if the rule is significant, add an entry in `docs/ARCHITECTURE.md` or `docs/CONVENTIONS.md`.

5. **Validate frontmatter** — YAML between `---` markers, no unescaped colons, tabs instead of spaces. Silent failures happen with bad frontmatter.

### Modify Core Rules

When you need to change a rule in `AGENTS.md`:

1. **Read `AGENTS.md`** — understand the current rule set.

2. **Check all framework overlays** for conflicts. A change to the "test before done" core rule should not contradict a framework overlay's test command.

3. **Make the change** to `AGENTS.md`.

4. **Update any affected framework overlays** — if you changed a generalized concept, ensure each overlay still makes sense.

5. **Update `docs/CONVENTIONS.md`** if the change affects project conventions.

6. **Run verification**: check that the new rule doesn't create impossible requirements when combined with an overlay.

### Add a New Prompt or Skill

1. **Prompt** (single task, no assets):
   ```markdown
   ---
   description: "Generate X from Y. Use when..."
   ---
   # Task Name
   Instructions for the AI...
   ```
   Place in `.github/prompts/{name}.prompt.md`. Test by typing `/` in VS Code chat.

2. **Skill** (multi-step, has scripts/templates):
   ```
   .github/skills/{skill-name}/
   ├── SKILL.md           ← name must match folder
   ├── scripts/           ← executable code
   └── references/        ← docs loaded as needed
   ```
   The `SKILL.md` `name` field MUST match the folder name. Test by typing `/` in chat.

---

## Common Pitfalls

| Pitfall | Why It Happens | Fix |
|---------|---------------|-----|
| **`applyTo: "**"` on narrow rules** | Defaulting to "all files" out of caution | Use specific globs: `**/*.py`, `src/api/**` |
| **YAML frontmatter silent failure** | Unescaped colons, tabs, missing `---` fences | Always quote descriptions with colons; use spaces not tabs |
| **Mixing concerns in one file** | "I'll just add this here..." | One concern per file — separate testing rules from styling rules |
| **Contradictory rules** | Core says "run tests", overlay says "skip tests in CI" | Check all layers when adding any rule |
| **Forgetting `description`** | Instructions load by `applyTo` so description seems optional | Description is the discovery surface for on-demand loading — always include it |
| **`name` mismatch in SKILL.md** | Renamed folder but not `name` field | `name` must match folder exactly; mismatch = skill won't load |
| **Duplicating docs in instructions** | Copying README content into instruction files | Link to docs instead: `See docs/TESTING.md for conventions` |
| **Too many tools on agents** | "Just in case" tool assignment | Only assign tools the agent's role actually needs — excess dilutes focus |

---

## Monorepo Setup

For repositories with multiple languages/frameworks (e.g., Next.js frontend + Python backend):

```
monorepo/
├── AGENTS.md                                    ← Generic core rules only
├── frontend/
│   └── AGENTS.md                                ← (optional) frontend-specific additions
├── backend/
│   └── AGENTS.md                                ← (optional) backend-specific additions
├── .github/
│   └── instructions/
│       ├── always-read-agents.instructions.md   ← applyTo: "**" (whole repo)
│       ├── nextjs.instructions.md               ← applyTo: "frontend/**/*.{tsx,ts}"
│       ├── python.instructions.md               ← applyTo: "backend/**/*.py"
│       └── generic.instructions.md              ← applyTo: "**" (fallback)
```

Key: tighten `applyTo` paths to the relevant directory so Python rules don't fire on the frontend and Next.js rules don't fire on the backend.

---

## User-Level vs Project-Level Rules

| Scope | Location | Use For |
|-------|----------|---------|
| **Project** (team-shared) | `.github/` in the repo | Rules everyone on the team should follow |
| **User** (personal) | `{{VSCODE_USER_PROMPTS_FOLDER}}/` | Personal preferences that roam across all your projects |

User-level examples: "I prefer single quotes", "Always use async/await over .then()", "Never suggest class components in React". These belong in your user profile, not in every project's `.github/`.

---

## Framework Support Table

| Framework | File | `applyTo` | Build Command | Test Command | Lint Command |
|-----------|------|-----------|---------------|--------------|--------------|
| Next.js | `nextjs.instructions.md` | `**/*.{tsx,ts,jsx,js,css}` | `next build` | `npm test` | `next lint` |
| Python | `python.instructions.md` | `**/*.py` | — | `pytest` | `ruff check` |
| Go | `go.instructions.md` | `**/*.go` | `go build ./...` | `go test ./...` | `golangci-lint run` |
| Rust | `rust.instructions.md` | `**/*.rs` | `cargo build` | `cargo test` | `cargo clippy -- -D warnings` |
| Generic | `generic.instructions.md` | `**` | Project-specific | Project-specific | Project-specific |

To contribute a new framework, see "Add a New Framework Overlay" above.
