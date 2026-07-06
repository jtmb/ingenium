---
name: create-skills
description: "Teach an AI agent how to create new OpenCode skills — directory setup, frontmatter rules, content structure, registration in catalogs, and validation testing. Use when the user says 'create a skill', 'make a skill', 'add a skill', 'new skill', when skill coverage gaps are detected, or when a new framework/tool needs conventions codified."
---

# Creating Skills for OpenCode — Meta-Skill

This skill teaches an AI agent (or human) **how to create new skills** in the OpenCode skill system. It covers the full lifecycle: scoping, naming, writing frontmatter and content, registering in catalogs, and validating.

## When to Use

Invoke this skill when any of the following triggers match:

- User says "create a skill", "make a skill", "add a skill", "new skill", "I need a skill for..."
- User says "codify this convention", "write a skill for...", "skillify this"
- A pattern or convention has been repeated across a project without a skill
- A new framework, library, or tool has been added to the project
- An existing skill's instructions are outdated or missing coverage
- You detect gaps during a session (e.g., repeated ad-hoc instructions that should be in a skill)
- The `/update-skills` or `/audit-skills` commands flag missing coverage
- Running tests (`test-self-improving.sh`) report skill count inconsistencies or missing skills

## 🔴 HARD RULEs

These rules override everything else. They are not optional.

### 🔴 Name Must Match Directory Name

**The frontmatter `name` field MUST exactly match the directory name** containing the SKILL.md. If the directory is `.agents/skills/analyzing-spreadsheets/`, then `name: analyzing-spreadsheets`. If they differ, OpenCode will not find the skill.

### 🔴 No Nested Category Folders

OpenCode searches `skills/*/SKILL.md` — a **single-level glob**. Do NOT create subdirectories like `skills/domain/database/SKILL.md`. Every skill directory must be a direct child of `skills/`. Allowed: `skills/analyzing-spreadsheets/SKILL.md`. Forbidden: `skills/domain/analyzing-spreadsheets/SKILL.md`.

### 🔴 SKILL.md Must Be ALL CAPS

**The filename must be `SKILL.md`** — all uppercase, no lowercase, no `skill.md` or `Skill.md`. OpenCode's file discovery is case-sensitive.

### 🔴 Frontmatter: `name` and `description` Are Required

Every SKILL.md must have at least these two frontmatter fields:
- `name` — lowercase alphanumeric + hyphens, regex: `^[a-z0-9]+(-[a-z0-9]+)*$`
- `description` — 1-1024 chars, specific + actionable + includes trigger keywords

OpenCode recognizes only these 5 optional fields total: `name`, `description`, `license`, `compatibility`, `metadata`. Do not add custom frontmatter fields.

### 🔴 Keep Under 500 Lines

Total SKILL.md content (including frontmatter) MUST stay under 500 lines. Use **progressive disclosure** — put the most important information first, and move deep details to separate files in the same directory (e.g., `scripts/`, `examples/`, `reference/`).

### 🔴 Permission Must Not Be `deny` for Active Skills

Check `opencode.json` to ensure the skill's permission is not set to `deny`. Values: `allow` (loads immediately), `deny` (hidden — never creates this), `ask` (prompts user). A skill with `name: deny` will be invisible to the agent.

## Anatomy of a Skill

Every skill has two parts:

### Part 1: Frontmatter (YAML between `---` delimiters)

```yaml
---
name: analyzing-spreadsheets
description: "Process and analyze spreadsheet files (.csv, .xlsx) — data cleaning, formula extraction, pivot table generation. Use when the user uploads a CSV/XLSX file or says 'analyze this spreadsheet', 'clean this data', 'generate a pivot table'."
---
```

**Frontmatter field reference:**

| Field | Required | Format | Notes |
|-------|----------|--------|-------|
| `name` | ✅ | `^[a-z0-9]+(-[a-z0-9]+)*$` | Must match directory name |
| `description` | ✅ | 1-1024 chars | "what it does" + "when to use it"; include trigger keywords |
| `license` | ❌ | String | e.g., `MIT`, `Apache-2.0` |
| `compatibility` | ❌ | String | e.g., `openCode >= 0.1.6` |
| `metadata` | ❌ | Map (string → string) | For arbitrary key-value pairs |

### Part 2: Content (markdown body after frontmatter)

Start directly with useful content. Typical structure:

```markdown
# Title — One-Line Description

## When to Use

Bullet list of trigger phrases and scenarios.

## 🔴 HARD RULEs

Non-negotiable rules that override everything else.

## [Section 1]

Progressive content. Top of the file has what's most needed first.

## [Section 2]
...

## Cross-References

Links to related skills, docs, or tools.
```

**Content rules:**
- Use fully qualified MCP tool names (e.g., `kaban_kaban_add_task`, not just `add_task`)
- Use consistent terminology throughout (don't switch between "skill" and "module" or "plugin")
- Keep code blocks short and focused — reference external scripts for long implementations
- Cross-reference other skills in this repo (`.agents/skills/<name>/SKILL.md`) when relevant

## Step-by-Step: Creating a New Skill

### Step A — Determine Scope

Before writing, classify the skill:

| Scope Type | Description | Example |
|------------|-------------|---------|
| **Single domain** | One framework, tool, or platform | `postgresql-optimization`, `shell-scripts` |
| **Cross-cutting** | Applies across many domains | `generic-conventions`, `useful-tests` |
| **Task-specific** | One workflow or process | `wsl-cleanup`, `create-readme` |
| **Meta** | Teaches how to create/manage other skills | `create-skills`, `update-skills` |

Ask: "Does this cover a single clear concern?" If yes, proceed. If it mixes unrelated topics, split it.

### Step B — Name Selection

Apply these rules in order:

1. **Gerund form preferred**: `analyzing-spreadsheets`, `processing-pdfs`, `deploying-services` (not `spreadsheet-analysis`, `pdf-processor`, `service-deployment`)
2. **Lowercase + hyphens only**: `analyzing-spreadsheets` ✅, `AnalyzingSpreadsheets` ❌, `analyzing_spreadsheets` ❌
3. **Descriptive, not generic**: `processing-csv-files` better than `csv-stuff`; `deploying-aws-lambda` better than `deploy`
4. **Unique across the catalog**: Check `.agents/SKILL-CATALOG.md` and `SKILL-INDEX.md` for conflicts
5. **Short but specific**: 1-4 hyphenated segments preferred

**Good examples from this repo:** `wsl-cleanup`, `thread-auto-context`, `code-review-checklist`, `orchestrator-primer`, `onboard-existing-repo`

**Exceptions to gerund rule:** When the gerund form is awkward or overly long, use a noun form. E.g., `error-interpretation` (not `interpreting-errors`), `api-design` (not `designing-apis`).

### Step C — Create Directory + File

```bash
mkdir -p .agents/skills/<skill-name>
```

Then create `.agents/skills/<skill-name>/SKILL.md` with the content. There must be exactly one directory per skill with a `SKILL.md` file inside.

**Directory structure rule:**
```
.agents/skills/
  create-skills/
    SKILL.md                # Required
    examples/               # Optional — progressive disclosure
    scripts/                # Optional — helper scripts
    reference/              # Optional — deep reference material
```

### Step D — Write Frontmatter

```yaml
---
name: <skill-name>                  # Must match directory name
description: "..."                  # 1-1024 chars, triggers included
---
```

**Description formula:** Action + domain + trigger keywords + "Use when..." clause.

Example breakdown:
```
"Process and analyze spreadsheet files (.csv, .xlsx) — data cleaning, formula extraction, pivot table generation. Use when the user uploads a CSV/XLSX file or says 'analyze this spreadsheet', 'clean this data', 'generate a pivot table'."
 ^-- action + domain                ^-- what it covers              ^-- trigger phrases
```

### Step E — Write Content

1. Title (`# Name — One-Line Description`)
2. **When to Use** section — bullet list of trigger phrases and scenarios
3. **🔴 HARD RULEs** section — non-negotiable rules, formatted with 🔴 prefix
4. Body content — organized by sections, progressive disclosure
5. **Cross-References** — links to related skills and docs

Content tips from this repo's best examples:
- `wsl-cleanup/SKILL.md`: Uses tables for command catalogs, risk levels, estimated impact. Excellent progressive disclosure — pre-flight → actions → full workflow.
- `orchestrator-primer/SKILL.md`: Extremely concise (34 lines). No fluff, every line is a rule. Excellent example of minimal effective content.
- `thread-auto-context/SKILL.md`: Decision trees, step-by-step bootstrap instructions with exact commands. Covers every edge case explicitly.
- `local-models/SKILL.md`: Long-form reference with anti-pattern catalog, comparison tables, and model-specific guidance. Good example of when to push details to sub-sections.

### Step F — Registration

After creating the SKILL.md file, register it in ALL of these places:

| Location | Action |
|----------|--------|
| `.agents/SKILL-CATALOG.md` | Add an entry to the appropriate table (Domain, Task, or Framework skills section) |
| `SKILL-INDEX.md` (repo root) | Add to the numbered skill list AND the appropriate category section |
| `AGENTS.md` | If the skill is mandatory or should be listed in the Pre-Flight Check table |
| `.agents/skills/learnings.md` | Log the addition with commit hash (see `generic-conventions` HARD RULE) |

**Update the skill count** — `SKILL-INDEX.md` has a "Total: N items" header. Increment it. AGENTS.md may also reference the count in text.

### Step G — Testing

Run the validation tests to ensure the new skill is properly registered:

```bash
# Main test suite — detects dependency gaps, missing coverage, skill count consistency, frontmatter validity
bash tests/test-self-improving.sh

# Agent validation — validates all agent .md files (including any agent files added/updated)
bash tests/test-agent-validation.sh

# For verbose output:
bash tests/test-self-improving.sh -v
bash tests/test-agent-validation.sh -v
```

**Fix any failures** — the tests check for:
- Skill count consistency (SKILL-INDEX.md count vs actual directory count)
- Frontmatter validity (name, description presence and format)
- Cross-reference completeness
- Agent file structural validity

## Validation Checklist

Before declaring a new skill complete, verify every item:

### Frontmatter
- [ ] `name` matches directory name exactly
- [ ] `description` is 1-1024 chars, includes trigger keywords, follows "what it does + when to use" formula
- [ ] No custom frontmatter fields beyond the 5 allowed (`name`, `description`, `license`, `compatibility`, `metadata`)

### File Structure
- [ ] File is named `SKILL.md` (ALL CAPS)
- [ ] Directory is a direct child of `skills/` (no nested category folders)
- [ ] Total file is under 500 lines
- [ ] Directory name matches regex `^[a-z0-9]+(-[a-z0-9]+)*$`

### Naming
- [ ] Gerund form preferred (exceptions for awkward cases)
- [ ] Lowercase + hyphens only
- [ ] Descriptive and specific (not generic like `tools` or `utils`)
- [ ] Unique — no conflict with existing skills in SKILL-CATALOG.md or SKILL-INDEX.md

### Content
- [ ] Starts directly with useful content (no preamble or "welcome")
- [ ] Has a "When to Use" section with trigger phrases
- [ ] Has a "🔴 HARD RULEs" section if there are non-negotiable rules
- [ ] Uses progressive disclosure — most important info first
- [ ] Uses fully qualified MCP tool names
- [ ] Uses consistent terminology throughout
- [ ] Under 500 lines total
- [ ] Cross-references related skills at the end

### Registration
- [ ] Added to `.agents/SKILL-CATALOG.md` in the correct section
- [ ] Added to `SKILL-INDEX.md` (numbered list + category sections)
- [ ] Skill count header incremented in SKILL-INDEX.md
- [ ] AGENTS.md updated if needed (mandatory skills, pre-flight check)
- [ ] Learnings entry appended to `.agents/skills/learnings.md` with commit hash

### Permission
- [ ] `opencode.json` does not have `"<skill-name>": "deny"` in the skill permissions section
- [ ] If the skill should load automatically, set `"<skill-name>": "allow"` in `opencode.json` skill permissions

### Testing
- [ ] `bash tests/test-self-improving.sh` passes
- [ ] `bash tests/test-agent-validation.sh` passes

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| OpenCode doesn't find the skill | `name` doesn't match directory name | Set frontmatter `name` to match directory name exactly |
| Skill not loading | Permission is `deny` in `opencode.json` | Change to `allow` or `ask` |
| "no frontmatter" error | File not named `SKILL.md` or frontmatter missing `---` | Rename to `SKILL.md` (ALL CAPS), add `---` delimiters |
| "invalid name" error | Name contains uppercase or underscores | Use lowercase + hyphens only: `^[a-z0-9]+(-[a-z0-9]+)*$` |
| Test failure: skill count mismatch | SKILL-INDEX.md count doesn't match actual skill directories | Update the "Total: N items" header and numbered list |
| Test failure: missing in catalog | Skill not added to SKILL-CATALOG.md | Add entry to appropriate section |
| File exceeds 500 lines | Too much detail in a single file | Move deep details to sub-files (`examples/`, `reference/`, `scripts/`) |
| Agent can't see the skill | Search path issue | Verify skill is in one of: `.opencode/skills/`, `.claude/skills/`, `.agents/skills/`, or global paths at `~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/` |

## Template

Use this template when creating a new SKILL.md. Replace placeholders in `{braces}`.

```markdown
---
name: {skill-name}
description: "{Action} {domain} — {specific capabilities}. Use when {trigger scenarios}."
---

# {Title — One-Line Description}

## When to Use

- "User says this trigger phrase"
- "User uploads a file of type X"
- "User mentions a specific scenario"

## 🔴 HARD RULEs

### 🔴 {Rule Title}

{Description of the non-negotiable rule and why it exists.}

## {Section 1 Title}

{Content starts directly. No preamble.}

{Use tables for command/option comparisons, risk levels, or configuration reference.}

## Cross-References

- **`<related-skill>`** — {why it's related}
- **`<another-skill>`** — {why it's related}
```

## Cross-References

- **`update-skills`** (`/update-skills`) — Higher-level skill management: detecting gaps, updating existing skills, retiring obsolete skills. Create skills via this skill's workflow, manage their lifecycle via `update-skills`.
- **`audit-skills`** (`/audit-skills`) — After creating a skill, run audit to verify cross-references, missing entries, and consistency across all documentation.
- **`update-skill-index`** (`/update-skill-index`) — Auto-regenerates `SKILL-INDEX.md` from all skill files. Run after creating a new skill to keep the index in sync.
- **`write-docs`** (`/write-docs`) — Updates all documentation affected by skill changes. Use after registration is complete.
- **`generic-conventions`** (`generic-conventions`) — 🔴 HARD RULE: learnings.md must be updated after EVERY skill change. Core rules for comments, DRY, error handling, and docs sync.
- **`orchestrator-primer`** — Example of a minimal, effective skill (34 lines). Every line is a rule, no fluff.
- **`wsl-cleanup`** — Example of progressive disclosure with command tables, risk levels, and a full workflow section.
- **`thread-auto-context`** — Example of a skill with decision trees, step-by-step bootstrap, and exhaustive edge-case coverage.
- **`local-models`** — Example of a long-form reference skill with anti-pattern catalogs and comparison tables (how to structure sub-sections for deep content).
- **`onboard-existing-repo`** — Example of a meta-skill that orchestrates multiple subagents.
