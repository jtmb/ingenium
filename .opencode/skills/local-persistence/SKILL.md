---
name: local-persistence
description: "Ensure skills and observations are persisted to local .opencode/skills/ — load from DB and write to disk after every mutation."
alwaysApply: true
tags: ["local", "sync", "persistence", "hard-rule"]
---

# Local Persistence

## Purpose
Ensures skills and observations are persisted to local `.opencode/skills/` after every mutation operation. This prevents data loss when the API is unavailable or during network issues.

**always_apply: true** — Always load this skill before any skill creation, update, enable/disable operations.

---

## 🔴 HARD RULES

### Rule 1: Persist Skills After Mutation
After calling `ingenium_skill_create`, `ingenium_skill_update`, or `ingenium_skill_enable`:

```typescript
// Load the skill from DB to local client
const skill = await ingenium_skill_load(project, name);

// Write SKILL.md and metadata.json locally using write tool
write({
  filePath: `.opencode/skills/${name}/SKILL.md`,
  content: skill.content // with YAML frontmatter preserved
});

write({
  filePath: `.opencode/skills/${name}/metadata.json`,
  content: JSON.stringify(skill.metadata, null, 2)
});
```

**Why:** The DB is the source of truth. After mutations, you must write to disk immediately for local persistence. This ensures your local workspace matches the database state even if the API goes down later.

### Rule 2: Fallback Observations File
After `ingenium_observe` errors or fails (API unavailable):

```typescript
// Write fallback observations file at .opencode/skills/observations.md
const content = `[IMPORTED] ${new Date().toISOString()} | observation failed to POST, saved locally\n`;
await write({ filePath: `.opencode/skills/observations.md`, content });
```

**Why:** If the API is down or unreachable, observations are still valuable. The Observer Plugin's `importObservationsFromFile()` will sync these file entries into the DB on next session start and mark them `[IMPORTED]`. This ensures no learning data is lost during outages.

---

## Skill Sync Pattern (Client-Side)

The client-side equivalent of server-side `writeSkillToDisk()`:

1. **Call `ingenium_skill_load`** — Pull skill content from the DB to your local MCP session
2. **Use `write` tool** — Write `SKILL.md` + `metadata.json` using the write tool with exact file paths: `.opencode/skills/<name>/`
3. **Verify persistence** — Optionally read back files to confirm they were written correctly

This pattern ensures your local workspace is always in sync with the database, even if you're working offline or the API becomes unavailable later.

---

## Workflow Integration

### Skill Mutation Pattern
```typescript
// 1. Create/update skill via MCP tool
await ingenium_skill_create(project, name, description, content);

// 2. Load from DB (MANDATORY)
const skill = await ingenium_skill_load(project, name);

// 3. Write to local disk using write tool
write({ filePath: `.opencode/skills/${name}/SKILL.md`, content: skill.content });
```

### Observation Fallback Pattern
```typescript
try {
  // Attempt to log observation via MCP tool
  await ingenium_observe(
    project, 
    "preference", 
    "User prefers concise error messages"
  );
} catch (error) {
  // API failed — write fallback file
  const content = `Error: ${error.message}\n`;
  await write({ filePath: `.opencode/skills/observations.md`, content });
  
  // Log the failure for debugging
  console.error("Observation POST failed, saved to observations.md");
}
```

---

## Related Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `ingenium_skill_load` | Get skill content from DB | After create/update/enable operations |
| `write` | Write file to disk | Persist SKILL.md + metadata.json locally |
| `read` | Read file contents | Verify persistence, debug issues |

---

## Related Documentation

- [AGENTS.md](./../AGENTS.md) — Mandatory skill sync pattern section
- [docs/HOW-TO/skills.md](./../docs/HOW-TO/skills.md) — Skill system usage guide
- `.opencode/SKILL-INDEX.md` — Full skill catalog

---

## Code Location

- MCP Tools: `services/ingenium-server/lib/tools/*.ts`
- API Routes: `services/ingenium-api/lib/routes/skills.ts`, `/api/v1/skills/*`
