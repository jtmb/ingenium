# AGENTS.md — Skill System Index

This project uses a **skill-based AI conventions system**. All rules live in `.agents/skills/`, not in this file.

**Start here:** check `.agents/skills/` for applicable conventions. For a full catalog, use `/help`.

## Your Job — Grow the Skill System

You are not just following conventions — you are **maintaining and growing** them. This project is self-improving. After every code change:

- **Write tests** — every change must have at least one meaningful test. See `useful-tests`.
- **Update docs** — `docs/` must stay in sync with the codebase. See `write-docs`.
- **Detect gaps** — if you see a repeated pattern, missing framework, or missing file-type coverage, invoke `update-skills` to create a new skill.
- **Audit consistency** — after adding or removing skills, invoke `audit-skills` to cross-reference all docs, diagrams, and indexes.

