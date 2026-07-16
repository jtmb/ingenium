---
name: documentation
description: "Documentation workspace, architecture conventions, and audit workflow. Use when creating, editing, organizing, searching, or auditing documentation; managing docs spaces, backlinks, tags, templates, and import/export."
alwaysApply: true
tags: ["documentation", "docs", "workspace", "audit", "architecture"]
---

# Documentation

> Unified documentation conventions — workspace operations, architecture standards, and audit workflow. Absorbed 3 legacy skills.

## When to Use

- Creating or editing documentation pages via agents
- Organizing pages into spaces and hierarchies
- Searching for documentation (always search before creating)
- Managing tags, backlinks, comments, and wikilinks
- Importing, exporting, or templating documentation
- Auditing documentation for coverage gaps, stale content, or broken links
- Reviewing documentation architecture decisions

## 🔴 HARD RULEs

### 🔴 Search Before Creating

Before creating a new page, ALWAYS search for existing pages on the same topic. Use `ingenium_docs_search` to check for duplicates. If a relevant page exists, update it instead.

### 🔴 Use Descriptive Slugs

Page slugs must be lowercase, hyphenated, and descriptive. Example: `api-authentication-guide`, not `page1` or `API_Auth`.

Bad: `My Page`, `my_page`, `api`
Good: `my-page`, `api-authentication`, `getting-started-with-docker`

### 🔴 Use Internal Wikilinks

Link to other pages using `[[page-slug]]` syntax. This auto-creates backlinks and keeps the documentation graph connected.

### 🔴 One Topic Per Page

Each page should cover one topic or concept. If a page gets too long, split it into sub-pages using the page hierarchy.

### 🔴 Audit Documentation Regularly

Run documentation audits to detect: stale content, broken wikilinks, missing cross-references, coverage gaps, and outdated architecture references. Log findings via `ingenium_observe`.

### 🔴 Place Pages in the Right Space

Engineering documentation → "Engineering" space. Personal notes → "Personal" space. Project-specific docs → link to the project.

### 🔴 Markdown Conventions

Use consistent Markdown formatting: ATX headings (`#`), fenced code blocks with language tags, reference-style links for repeated URLs. See `references/sources/docs-workspace/references/markdown-conventions.md`.

## Reference Files

### Docs Workspace
| File | Content |
|------|---------|
| [`references/sources/docs-workspace/source-index.md`](references/sources/docs-workspace/source-index.md) | Docs workspace conventions: creating, editing, organizing pages |
| [`references/sources/docs-workspace/references/`](references/sources/docs-workspace/references/) | Agent workflow, Markdown conventions |

### Documentation Architecture
| File | Content |
|------|---------|
| [`references/sources/documentation-architecture/source-index.md`](references/sources/documentation-architecture/source-index.md) | Documentation architecture guide |
| [`references/sources/documentation-architecture/references/`](references/sources/documentation-architecture/references/) | Documentation guide |

### Audit Workflow
| File | Content |
|------|---------|
| [`references/sources/documentation-audit-workflow/source-index.md`](references/sources/documentation-audit-workflow/source-index.md) | Documentation audit workflow |
| [`references/sources/documentation-audit-workflow/references/`](references/sources/documentation-audit-workflow/references/) | Consolidated reporting, hardcoded credentials, security domains |

## Cross-References

- **`@skill-maintenance`** — Skill creation, indexing, and audit procedures
- **`@development-conventions`** — Code documentation patterns (README, API docs)
- **`@self-learning`** — Observation pipeline for audit findings
