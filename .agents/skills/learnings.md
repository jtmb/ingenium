## 2026-07-04 — Thread bootstrap + OpenCode doc compliance

- **Thread bootstrap** — Updated `.vscode/mcp.json` `THREAD_DEFAULT_SESSION` from `"default"` to `"gh-llm-bootstrap"`. Created root `opencode.json` with `mcp.thread` entry. Verified server reachable.
- **OpenCode compliance** — Refactored `AGENTS.md` to follow OpenCode docs recommendation ([rules → Manual Instructions in AGENTS.md](https://opencode.ai/docs/rules/#manual-instructions-in-agentsmd)):
  - Moved detailed skill catalog to `.agents/SKILL-CATALOG.md`
  - AGENTS.md is now concise with core protocol + lazy-load `@` references
  - Mirror updated in `deploy/`
- **Token regeneration** — Old pre-generated `THREAD_API_TOKEN` was invalidated by a Thread server restart (changed `THREAD_AUTH_SECRET_KEY`). Generated a fresh no-expiry API token from within the container via `create_token('admin', expiry_seconds=0)`. Updated in both `.vscode/mcp.json` and `opencode.json`.

## 2026-07-04 — Full documentation audit after skills/ merge

- **Before**: `b0c9318` (snapshot before fixes)
- **After**: `bfee2c9`
- **Fixed**: 16 discrepancies found and fixed
  - **SKILL-INDEX.md**: All 20+ stale `.agents/instructions/` and `.agents/tools/` paths updated to `.agents/skills/`. Removed separate instructions/tools sections. Updated total count and table structure.
  - **README.md**: Badge count 43→45. Removed all references to `.agents/instructions/` and `.agents/tools/` directories. Merged task/tool skill tables into single list. Updated mermaid diagram labels.
  - **AGENTS.md**: Removed `.agents/instructions/` and `.agents/tools/` references from common foundation, session checklist, skill system instructions, and directory tree. Updated to reflect single `.agents/skills/` structure.
  - **USAGE.md**: Updated decision tree locations, directory tree, task/tool creation guides, and count references. Removed instructions/tools path distinctions.
  - **opencode.json**: Updated `instructions` glob from `[".agents/instructions/*/SKILL.md", ".agents/tools/*/SKILL.md"]` to `[".agents/skills/*/SKILL.md"]`.
  - **Deploy mirror**: All deploy files synced to match source changes.
- **All source/docs in sync**: 45 skills, frontmatter valid, hooks valid JSON, deploy mirrors match.
