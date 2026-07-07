# Ingenium MCP Server v1 — API as Sole Data Authority

## Orchestrator Instructions

| Phase | Step | Subagent | Task | Blocked by |
|-------|------|----------|------|------------|
| 1 | 1 | @ingenium-software-engineer | Scaffold monorepo root: package.json (workspaces), tsconfig.base.json, docker-compose.yml, docs/ | — |
| 1 | 2 | @ingenium-software-engineer | Scaffold `packages/ingenium-core/`: strict tsconfig, db.ts, schema.ts, all 7 tool modules, migrations, seed, logger | — |
| 1 | 3 | @ingenium-software-engineer | Scaffold `services/ingenium-api/`: Express server, all 7 route files, all middleware, config | — |
| 1 | 4 | @ingenium-software-engineer | Scaffold `services/ingenium-server/`: MCP stdio server, HTTP client, 7 thin tool wrappers, proxy engine | — |
| 1 | 5 | @ingenium-software-engineer | Scaffold `services/ingenium-dashboard/`: Next.js 16 App Router, 6 pages, api.ts client, hooks, ui components | — |
| 2 | 6 | @ingenium-software-engineer | `ingenium-api/`: implement all REST endpoints — 7 resource groups, ~20 endpoints. Wire to core tools. | Phase 1 |
| 2 | 7 | @ingenium-software-engineer | `ingenium-server/`: implement all MCP tools as HTTP wrappers. Wire proxy for child servers. | Phase 1 |
| 2 | 8 | @ingenium-software-engineer | `ingenium-dashboard/`: implement all 6 pages with full UI. Connect api.ts to live endpoints. | Phase 1 |
| 3 | 9 | @ingenium-software-engineer | Update `project-structure/SKILL.md` — API-as-authority monorepo pattern | Phase 2 |
| 3 | 10 | @ingenium-software-engineer | Update `api-design/SKILL.md` — sole data authority HARD RULE | Phase 2 |
| 3 | 11 | @ingenium-software-engineer | Update `nextjs-conventions/SKILL.md` — API-first frontend HARD RULE | Phase 2 |
| 3 | 12 | @ingenium-software-engineer | Update `update-skills/SKILL.md` — add core/api/server/dashboard detection signals | Phase 2 |
| 3 | 13 | @ingenium-software-engineer | Create `tests/enforce-no-db-leaks.sh` — CI gate for DB access isolation | Phase 2 |
| 4 | 14 | @ingenium-qa | Review all 4 packages + skill updates (5-lens) | Phase 3 |
| 4 | 15 | bash | `npm test`, `tsc --noEmit`, `next lint` across all packages. Run enforce-no-db-leaks.sh | Phase 3 |
| 4 | 16 | @ingenium-docs | Generate root + per-service docs. Update docs/agents.md | Phase 3 |
| 5 | 17 | @ingenium-software-engineer | Wire into opencode.json: replace kaban+thread MCP with single ingenium entry | Phase 4 |
| 5 | 18 | @ingenium-docs | Append learnings.md | Phase 4 |

## Verification

```bash
bash tests/enforce-no-db-leaks.sh
cd packages/ingenium-core && npx tsc --noEmit
cd services/ingenium-api && npx tsc --noEmit
cd services/ingenium-server && npx tsc --noEmit
cd services/ingenium-dashboard && npx tsc --noEmit
bash tests/test-agent-validation.sh
```
