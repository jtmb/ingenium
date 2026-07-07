# Conventions

## DB Isolation
- Only `packages/ingenium-core` and `services/ingenium-api` may import SQL libraries
- CI enforces: `grep -r "better-sqlite3\|\.db\|sqlite" services/ingenium-server/` must return empty

## API-First Frontend
- Dashboard imports ZERO core/server code. All data via HTTP to API.
