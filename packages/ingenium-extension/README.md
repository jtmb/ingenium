# @ingenium/extension

Client-side OpenCode package for connecting to the Ingenium MCP Server.

**Installation:** `npx -y @ingenium/extension`

**Package name:** `@ingenium/extension`

**Shipped plugins:**
- **observer.ts** — Session event handling, observation import, synthesis trigger
- **resource-sync.ts** — Unified SHA-256 manifest-based bidirectional sync for skills, agents, plugins, commands, and config between the API and local `.opencode/`
- **auto-observer.ts** — Thin trigger (~62 lines) that POSTs to `/api/v1/extraction/run` on session idle

**MCP server:** `dist/scripts/mcp-server.js` — stdio server with 243 tools. The package's two extension-registered tools bring the complete catalog to 245.
