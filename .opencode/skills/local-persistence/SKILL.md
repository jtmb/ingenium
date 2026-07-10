---
name: local-persistence
description: "Ensure skills and observations are persisted to local .opencode/skills/ — load from DB and write to disk after every mutation."
alwaysApply: true
tags: ["local", "sync", "persistence", "hard-rule"]
---

# Local Persistence

## 🔴 HARD RULE — Skill Sync After Mutation

After calling `ingenium_skill_create`, `ingenium_skill_update`, or `ingenium_skill_enable`:

1. Call `ingenium_skill_load(project, name)` to get the full skill object
2. Write `.opencode/skills/<name>/SKILL.md` with YAML frontmatter + content body
3. Write `.opencode/skills/<name>/metadata.json` with `{name, description, tags, alwaysApply}`
4. If `file_tree` is not null, write each reference file
5. Update `.opencode/SKILL-INDEX.md` if the skill was added or removed

## 🔴 HARD RULE — Observation Fallback

After each `ingenium_observe` call:

- If the response contains an error (`error.code` or `fetch failed`):
  Append the observation to `.opencode/skills/observations.md` in this format:
  ```
  - observation_type: <type>
    importance: <importance>
    content: "<content>"
  ```
  The observer plugin imports from `observations.md` on the next session start.

## Why

MCP tools execute on the server and write to the server's filesystem. These rules ensure every mutation is also persisted to the local client's `.opencode/skills/` so OpenCode can load skills from disk in subsequent sessions.
