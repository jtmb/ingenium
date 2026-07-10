---
description: "Sync skills between disk and DB — imports skill files from .opencode/skills/ into the DB, and writes all DB skills to disk"
---

# sync-skills

Sync skills **bidirectionally** between disk and the Ingenium database:

- **Disk → DB**: Any skill files you created or edited manually in `.opencode/skills/` are imported into the DB
- **DB → Disk**: Any skills created by the LLM synthesis pipeline are written to `.opencode/skills/` so OpenCode can load them

## Usage

```
/sync-skills
```

## What it does

1. Scans `.opencode/skills/` for directories
2. Imports any new or changed skills into the DB
3. Writes all DB skills to disk (SKILL.md + metadata.json + reference files)
4. Reports counts: synced to DB, written to disk, errors

## When to use

- After manually creating a skill file in `.opencode/skills/`
- After the synthesis pipeline created skills via LLM (check `/pipeline` for activity)
- When skills in the dashboard don't match what's on disk
- After restoring skills from backup or git

## Related

- `/synthesize` — Trigger the synthesis pipeline to create skills from observations
- `ingenium_synthesis_status` — Check pipeline stats
