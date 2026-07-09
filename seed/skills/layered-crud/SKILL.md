# Layered CRUD Architecture

## Overview

The Ingenium monorepo uses a consistent 4-layer architecture for every feature. This skill documents how to add a new entity type with full CRUD.

## Layers

| Layer | Directory | Responsibility |
|-------|-----------|---------------|
| Core | packages/ingenium-core/lib/tools/ | SQLite queries, Zod schemas, business logic |
| API | services/ingenium-api/lib/routes/ | Express REST endpoints, validation, error handling |
| MCP | services/ingenium-server/lib/tools/ + scripts/ | Thin HTTP passthrough handlers + registration in mcp-server.ts |
| Dashboard | services/ingenium-dashboard/src/lib/ + app/ | API client methods + React page components |

## Implementation Order

1. **Core**: Define Zod schema → Add tool functions (list, get, create, update, delete) → Export from index.ts
2. **API**: Add router with routes → Import core → Wire handlers → Mount in api-server.ts
3. **MCP**: Add handler functions calling API → Import + register in mcp-server.ts
4. **Dashboard**: Add API client methods → Build React page with CRUD UI

## 🔴 HARD RULE

Every new feature MUST be implemented across all 4 layers. Do NOT skip layers. Each layer is independently testable and buildable.
