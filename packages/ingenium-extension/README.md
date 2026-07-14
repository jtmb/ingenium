# @ingenium/extension

Client-side OpenCode package for connecting to the Ingenium MCP Server.

**Installation:** `npx -y @ingenium/extension`

**Package name:** `@ingenium/extension`

**Shipped plugins:**
- **observer.ts** — Session event handling, observation import, synthesis trigger
- **skill-sync.ts** — Bidirectional skill sync from API to local `.opencode/skills/`
- **auto-observer.ts** — Thin trigger (~62 lines) that POSTs to `/api/v1/extraction/run` on session idle

**MCP server:** `dist/scripts/mcp-server.js` — stdio server with 73 tools.
