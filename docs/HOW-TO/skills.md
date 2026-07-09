# HOW-TO: Skills

## What It Does
Browses, searches, and edits AI agent skills stored in the SQLite database. Skills are markdown documents that define conventions and rules for AI agents. Each skill includes a `file_tree` column that stores auxiliary files (reference docs, examples, configs) as a JSON map of relative paths → content.

## Skill Format

Skills use a **split-skill format** on disk:

| File | Purpose |
|------|---------|
| `SKILL.md` | Main skill content with YAML frontmatter (name, description, tags) |
| `metadata.json` | Machine-readable metadata (tags array, alwaysApply boolean) |
| `references/` | Optional directory of auxiliary reference files |

### Disk Locations

- **Canonical source (editing location)**: `seed/skills/<name>/` — edit SKILL.md here
- **Runtime copy**: `.opencode/skills/<name>/` — auto-written from DB; changes here are overwritten unless synced back via `ingenium_skill_sync`
- **DB storage**: Skills table with `file_tree` column — a JSON map of relative paths → content for complete data round-trips

### file_tree Column

The `file_tree` column (TEXT, JSON) enables complete data round-trips between DB and disk:

- **`writeSkillToDisk()`** — After DB create/update, reads `file_tree` JSON and writes every file under `.opencode/skills/<name>/`. Always writes SKILL.md (with YAML frontmatter) and metadata.json.
- **`syncSkillFromDisk()`** — Reads SKILL.md, parses frontmatter, reads metadata.json, and walks the directory tree to rebuild `file_tree`. If skill doesn't exist in DB, creates it; otherwise updates.

## How to Use
1. Navigate to `/skills` from the dashboard nav bar
2. Use the search input to filter skills by name or description
3. Each skill card shows the skill name and description
4. Click a skill to view or edit its full content (using Overlay.tsx card detail overlay)

## API Endpoints
- `GET /api/v1/skills?project=<name>` — list all skills
- `GET /api/v1/skills/:name?project=<name>` — get single skill
- `POST /api/v1/skills?project=<name>` — create skill (supports `files` param for file_tree)
- `PATCH /api/v1/skills/:name?project=<name>` — update skill content (supports `files` param)
- `GET /api/v1/skills/search?project=<name>&q=<query>` — FTS5 search

### MCP Tools

| Tool | Purpose |
|------|---------|
| `ingenium_skill_list` | List all skills for a project |
| `ingenium_skill_load` | Get a single skill by name |
| `ingenium_skill_search` | Full-text search across skills |
| `ingenium_skill_create` | Create a new skill (with optional `files` for file_tree) |
| `ingenium_skill_update` | Update skill content (with optional `files` for file_tree) |
| `ingenium_skill_delete` | Delete a skill by name |
| `ingenium_skill_enable` | Enable a skill and write to disk |
| `ingenium_skill_disable` | Disable a skill and remove from disk |
| `ingenium_skill_sync` | Sync a skill from disk file to DB |

## Code Location
- Page: `services/ingenium-dashboard/src/app/skills/page.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.skills`
- Route: `services/ingenium-api/lib/routes/skills.ts`
- Core: `packages/ingenium-core/lib/tools/skills.ts`

## Related Docs
- STYLING-GUIDE.md — card grid and search input styling
- SKILL-INDEX.md — auto-maintained index of all skills
- AGENTS.md — protocol for loading skills at session startup
