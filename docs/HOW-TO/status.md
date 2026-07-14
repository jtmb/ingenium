# HOW-TO: Status

## What It Does
Service status page showing real-time supervisord process states. Displays uptime, restart counts, and current status for all 4 container processes: API, Dashboard, opencode-server, and opencode-iframe.

## How to Use
1. Navigate to `/status` from the dashboard nav bar
2. Each process card shows:
   - **Process name** — API, Dashboard, opencode-server, opencode-iframe
   - **Status badge** — Running (green), Starting (yellow), Stopped (red)
   - **Uptime** — how long the process has been running
   - **Restart count** — number of automatic restarts by supervisord
3. The page auto-refreshes every few seconds for near-real-time monitoring
4. Status updates are driven by the supervisord event listener

## Code Location
- Page: `services/ingenium-dashboard/src/app/status/page.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.status`

## Related Docs
- [logs.md](./logs.md) — Structured logging and event viewer
