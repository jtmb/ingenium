# docs/ — Project Documentation Database

This directory is the project's knowledge base. It is maintained by both humans and the AI. Every code change should update the relevant doc.

## How the AI Uses These Docs

- On startup, the AI scans this index to understand what documentation exists
- When making changes, it reads the relevant docs and updates them
- New docs are created when no existing doc covers a topic

## Docs Map

| Doc | Covers | When to Update |
|-----|--------|---------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Project structure, key components, data flow, communication patterns | New components, refactored structure, changed data flow |
| [TECH-STACK.md](./TECH-STACK.md) | Languages, frameworks, key dependencies, versions, rationale | New dependencies, version upgrades, replaced libraries |
| [CONVENTIONS.md](./CONVENTIONS.md) | Naming patterns, file organization, error handling, logging, git practices | New conventions, changed patterns |

## Adding a New Doc

1. Create `docs/{topic}.md` with a clear title and sections
2. Add an entry to this index (the table above)
3. The AI will auto-discover it on next interaction

## Doc Format

- Start with a `# Title` — descriptive and specific
- Use clear section headings (`## Section Name`)
- Link to other docs when referencing them
- Include code examples where helpful
- Keep Markdown clean — other LLMs will parse this
