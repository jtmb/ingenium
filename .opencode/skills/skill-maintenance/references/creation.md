---
title: "Skill Creation — Scope, Naming, Directory Structure, Frontmatter, Content, Templates"
impact: HIGH
impactDescription: "Ensures new skills follow the correct structure and naming conventions"
tags: [creation, naming, frontmatter, template, split-skill]
---

## Skill Creation

### Step A — Determine Scope

| Scope Type | Description | Example |
|------------|-------------|---------|
| **Single domain** | One framework, tool, or platform | `postgresql-optimization`, `shell-scripts` |
| **Cross-cutting** | Applies across many domains | `debugging-patterns`, `error-interpretation` |
| **Task-specific** | One workflow or process | `create-readme`, `mcp-tooling` |
| **Meta** | Teaches how to create/manage other skills | `skill-maintenance` |

### Step B — Name Selection

1. **Gerund form preferred**: `analyzing-spreadsheets`, `deploying-services`
2. **Lowercase + hyphens only**: `analyzing-spreadsheets` ✅, `AnalyzingSpreadsheets` ❌
3. **Descriptive, not generic**: `deploying-aws-lambda` better than `deploy`
4. **Unique across the catalog**: Check SKILL-INDEX.md for conflicts
5. **Short but specific**: 1-4 hyphenated segments preferred

### Step C — Directory Structure

**Monolithic** (small skills, <300 lines, single topic):
```
.opencode/skills/<name>/
  SKILL.md                # Required — all content inline
```

**Split** (large or multi-topic):
```
.opencode/skills/<name>/
  SKILL.md                # Required — index with HARD RULEs + ToC
  metadata.json           # Optional — frontmatter fields as JSON
  references/             # Sub-skill files
    topic-one.md
    topic-two.md
```

Choose monolithic for <300 lines / single topic. Choose split when content would exceed 500 lines or covers multiple distinct subtopics.

### Step D — Frontmatter

```yaml
---
name: analyzing-spreadsheets        # Must match directory name
description: "Process and analyze spreadsheet files (.csv, .xlsx) — data cleaning, formula extraction, pivot table generation. Use when the user uploads a CSV/XLSX file or says 'analyze this spreadsheet'."
---
```

| Field | Required | Format |
|-------|----------|--------|
| `name` | ✅ | `^[a-z0-9]+(-[a-z0-9]+)*$` |
| `description` | ✅ | 1-1024 chars, includes trigger keywords |
| `license` | ❌ | String |
| `compatibility` | ❌ | String |
| `metadata` | ❌ | Map |

### Step E — Content Structure

**Monolithic SKILL.md:**
1. Title → When to Use → 🔴 HARD RULEs → Body → Cross-References

**Split SKILL.md (index):**
1. Frontmatter → When to Use → 🔴 HARD RULEs → Table of Contents → Cross-References

**Reference file structure** (each `references/*.md`):
```markdown
---
title: "Descriptive Title"
impact: HIGH|MEDIUM|LOW
impactDescription: "What enforcing this prevents"
tags: [keyword, keyword]
---

## Descriptive Title

**Pattern intent:** why this matters (1-2 sentences)

### Shapes to recognize (for anti-patterns) or regular prose

### Incorrect / Correct code examples
```

### Templates

**Monolithic template:**
```markdown
---
name: {skill-name}
description: "{Action} {domain} — {specific capabilities}. Use when {trigger scenarios}."
---

# {Title}

## When to Use

- "User says this trigger phrase"
- "User mentions this scenario"

## 🔴 HARD RULEs

### 🔴 {Rule Title}

{Description of the non-negotiable rule.}

## {Section 1}

{Content starts directly. No preamble.}

## Cross-References

- **`<related-skill>`** — {why related}
```

**Split-skill template (SKILL.md):**
```markdown
---
name: {skill-name}
description: "{Action} {domain} — {specific capabilities}. Use when {trigger scenarios}."
---

# {Title}

> This skill uses a split-skill architecture. The index below lists all 🔴 HARD RULEs, followed by a Table of Contents linking to reference files.

## When to Use

- {Trigger phrases}

## 🔴 HARD RULEs

### 🔴 {Rule Title}

{Non-negotiable rules that must load every session.}

## Reference Files

| File | Content |
|------|---------|
| [`references/topic-one.md`](references/topic-one.md) | {One-line description} |
| [`references/topic-two.md`](references/topic-two.md) | {One-line description} |

## Cross-References
```

**Split-skill template (reference file):**
```markdown
---
title: "Descriptive Title"
impact: HIGH|MEDIUM|LOW
impactDescription: "What enforcing this prevents"
tags: [keyword, keyword]
---

## Descriptive Title

**Pattern intent:** why this matters (1-2 sentences)

### Shapes to recognize

- {Pattern that appears incorrect}
- {Another pattern}

**Incorrect:**
```language
{code violating the rule}
```

**Correct:**
```language
{code following the rule}
```
```

### Content Rules

- Use fully qualified MCP tool names
- Keep consistent terminology throughout
- Cross-reference related skills at the end
- Format HARD RULEs with 🔴 prefix
