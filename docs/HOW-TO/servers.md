# HOW-TO: Servers

## What It Does
Manages MCP server configurations. Each server has a name and a launch command. Servers can be started and stopped through the proxy engine.

## How to Use
1. Navigate to `/servers` from the dashboard nav bar
2. Type a server name in the first input field
3. Type the launch command in the second input field (e.g. `kaban mcp`)
4. Click **Add Server** to register it
5. Each server shows its name, command, and status badge (Stopped/Running)

## API Endpoints
- `GET /api/v1/servers?project=<name>` — list servers
- `POST /api/v1/servers?project=<name>` — add server (body: `{ name, command, args?, env? }`)
- `POST /api/v1/servers/:name/start?project=<name>` — start server
- `POST /api/v1/servers/:name/stop?project=<name>` — stop server
- `DELETE /api/v1/servers/:name?project=<name>` — remove server configuration

## Code Location
- Page: `services/ingenium-dashboard/src/app/servers/page.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.servers`
- Route: `services/ingenium-api/lib/routes/servers.ts`
- Core: `packages/ingenium-core/lib/tools/servers.ts`

## Related Docs
- STYLING-GUIDE.md — form and status badge styling
