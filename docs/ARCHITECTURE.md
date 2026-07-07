# Architecture

## Data Flow

```
Dashboard → HTTP → API → Core → SQLite
MCP Server → HTTP → API → Core → SQLite
```

- `ingenium-api` is the **sole database authority**. No other service imports `ingenium-core` or any SQL library.
- `ingenium-server` runs as an MCP stdio transport for OpenCode. It talks to the API over HTTP.
- `ingenium-dashboard` is a Next.js 16 frontend. It talks to the API over HTTP.
