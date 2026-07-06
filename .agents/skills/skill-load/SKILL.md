---
name: skill-load
description: "🔴 MANDATORY FIRST COMMAND — Inject the skill-system payload. Tells the model to read AGENTS.md and load all applicable skills from .agents/skills/ before ANY action. Use as the first message in every session: '/skill-load'. This IS the payload."
---

# /skill-load — Skill System Bootstrap Payload

## 🔴 This IS the payload. You are reading it because the user invoked `/skill-load`.

You are an AI coding assistant. Your FIRST responsibility — before writing ANY code, running ANY command, or responding to ANY request — is to load the skill system.

## 🔴 Mandatory Protocol (execute in order)

### Step 1: Read AGENTS.md

Read the file `AGENTS.md` at the project root. It contains:

- The **Session Startup Checklist** — 4 steps you MUST complete
- The **Pre-Flight Check** — maps every action type to its required skill
- The **🔴 Local Model Mandatory Skills** — non-negotiable skills for local models
- The **Skill Quick-Reference** — full catalog of 44+ skills organized by category
- The **Self-Improvement** rules — update skills, audit, log to learnings

**Read it now.** Do not proceed until you have read AGENTS.md.

### Step 2: Match skills to the user's request

Using the Skill Quick-Reference table in AGENTS.md:

1. Identify which framework skills match files you'll edit (`.py` → `python-conventions`, `.go` → `go-conventions`, etc.)
2. Identify which domain skills match the task type (terminal commands → `local-models`, tests → `useful-tests`, etc.)
3. Check the 🔴 Mandatory Skills section in AGENTS.md — every skill listed there is non-negotiable, load them all
4. Identify which task skills are relevant (`/help` for catalog, `/repo-context` for project identity)

### Step 3: Load every matching skill

Read the full SKILL.md for EVERY skill that matches:

```
.agents/skills/<skill-name>/SKILL.md
```

**Do not skip this.** Each skill contains 🔴 HARD RULEs that override everything else. Ignoring them produces broken code, hung terminals, and security issues.

### Step 4: Note the 🔴 HARD RULEs

As you load each skill, extract every 🔴 HARD RULE. These are non-negotiable. Examples:

- `local-models`: Never use `&` in terminal commands. Never run infinite-wait commands.
- `shell-scripts`: Always use `set -euo pipefail`. Always quote variables.
- `generic-conventions`: Update docs in the same turn as code changes.

### Step 5: Confirm and proceed

After loading all matching skills, briefly state which skills apply and why. Then proceed with the user's request — following every loaded skill's rules.

---

## Why this exists

Local AI models cannot auto-load skills from the filesystem. They don't read AGENTS.md unless commanded to. This payload bridges that gap: when the user types `/skill-load` as their first message, this content is injected into the prompt, and the model has no choice but to follow the numbered protocol.

**Without `/skill-load`**: Model skips AGENTS.md → falls through to `generic-conventions` → ignores 42 other skills → produces wrong code, hangs terminals, creates security holes.

**With `/skill-load`**: Model reads AGENTS.md → matches all applicable skills → loads them → follows HARD RULEs → produces correct, safe, convention-compliant code.

---

## 🔴 Anti-Skip Rule

You are reading this because `/skill-load` was invoked. You CANNOT claim you "already know" AGENTS.md or the skills. You MUST execute the 5-step protocol. Even if you've read AGENTS.md before, re-read it — skills may have changed (check `.agents/skills/learnings.md` for recent changes).
