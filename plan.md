# Plan: Fix 4 Critical QA Findings

## Orchestrator Instructions

| Phase | Step | Subagent | Task | Blocked by |
|-------|------|----------|------|------------|
| 1 | 1 | @ingenium-software-engineer | Wire auth middleware into api-server.ts | — |
| 1 | 2 | @ingenium-software-engineer | Add FTS5 triggers for skills table in 001_init.sql | — |
| 1 | 3 | @ingenium-software-engineer | Validate plugin.file_path in plugins.ts | — |
| 1 | 4 | @ingenium-software-engineer | Add 15 core tool tests (skills, learnings, tasks) | — |
| 2 | 5 | bash | Run CI + typecheck + vitest across all packages | Phase 1 |
| 2 | 6 | @ingenium-docs | Append learnings.md | Phase 1 |

## Verification

```bash
bash tests/enforce-no-db-leaks.sh
cd packages/ingenium-core && npx vitest run && npx tsc --noEmit
cd services/ingenium-api && npx tsc --noEmit
cd services/ingenium-server && npx tsc --noEmit
cd services/ingenium-dashboard && npx tsc --noEmit
bash tests/test-agent-validation.sh
```
