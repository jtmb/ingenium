---
name: configuring-opencode
description: "OpenCode agent configuration conventions — frontmatter structure, tool/skill permission lockdown patterns, @skill-name reference rules. Use when creating or auditing agent definitions, or when ensuring agent configuration follows best practices."
---

# Configuring OpenCode — Agent Conventions & Permissions

> This skill uses a split-skill architecture. The index below lists all 🔴 HARD RULEs, followed by a Table of Contents.

## When to Use

- Creating a new OpenCode agent definition
- Auditing existing agents for configuration issues
- Ensuring agents have proper permission lockdown
- Adding `@skill-name` references to agent files
- Setting up tool permissions per agent role

## 🔴 HARD RULEs

### 🔴 Every Agent MUST Use `@skill-name` References

In Required Skills sections and any inline prose that references a skill, use the `@` prefix so OpenCode can resolve the skill:

```markdown
# ✅ CORRECT — OpenCode resolves the skill reference
- **`@development-conventions`** — Code conventions, API design

# ❌ WRONG — OpenCode cannot resolve this
- **`development-conventions`** — Code conventions, API design
```

This applies to:
- Required Skills bullet lists
- Inline prose skill references (e.g., "Load `@development-conventions` for code review patterns")
- Pattern encoding tables that reference skill names
- Cross-reference sections in skills

### 🔴 Any Agent with `@development-conventions` MUST Also Have `@devops-conventions` and `@mcp-tooling`

These three skills form the minimum viable set for any agent that writes or reviews code. If `@development-conventions` is in the Required Skills list, `@devops-conventions` (CLI toolkit, Docker) and `@mcp-tooling` (browser automation) must also be present.

### 🔴 Every Agent MUST Have Explicit `permission` Block in Frontmatter

Every agent definition must include a `permission` block that explicitly allows the tools and skills it needs:

```yaml
---
permission:
  # Tool permissions
  read: allow
  edit: allow
  bash: allow
  glob: allow
  grep: allow
  skill: allow
  # Skill permissions — deny all except listed
  skill:
    "@development-conventions": allow
    "@devops-conventions": allow
    "@mcp-tooling": allow
    "*": deny
---
```

Tool permissions MUST match the agent's role:
| Role | Allowed tools |
|------|--------------|
| **Orchestrator** | read, bash (git only), task, skill, playwright_* |
| **Software engineer** | read, edit, bash, glob, grep, skill, webfetch |
| **QA / Reviewer** | read, bash (verify), skill — NO edit, NO write |
| **Security auditor** | read, grep, glob, skill — NO edit, NO write |
| **Docs** | read, edit, bash, glob, grep, skill |
| **Explore / Search** | read, glob, grep — NO edit, NO write, NO bash |
| **Researcher** | read, webfetch, websearch, skill — NO edit, NO write |

### 🔴 Default-Deny Skill Permissions

Use `"*": "deny"` as the catch-all in the `skill:` block and explicitly allow only the skills the agent needs:

```yaml
permission:
  skill:
    "development-conventions": allow
    "devops-conventions": allow
    "*": deny
```

This prevents agents from loading skills they shouldn't have access to.

## Reference Files

| File | Content |
|------|---------|
| [`references/agent-template.md`](references/agent-template.md) | Agent frontmatter template showing correct permission blocks, skill references, and structure |

## Cross-References

- **`skill-maintenance`** — For creating, auditing, and retiring skills
- **`mcp-tooling`** — Browser automation tool patterns
- **OpenCode docs** (`https://opencode.ai/docs/agents/`, `https://opencode.ai/docs/tools/`, `https://opencode.ai/docs/skills/`)
