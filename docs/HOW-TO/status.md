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

## Application Services

The status page now also displays **Application Services** cards (below the supervisord process cards). These represent application-level health checks that cannot be determined from supervisord process state alone.

### email-client

| State | Condition |
|-------|-----------|
| **healthy** | Engine running, heartbeat < 120s old, 1+ accounts connected |
| **degraded** | Engine running but heartbeat stale (> 120s) |
| **idle** | Engine running, no accounts configured |
| **stopped** | Engine not running |
| **error** | `getEngineStatus()` threw an exception |

The heartbeat is updated on every sync engine loop tick (even on error ticks). If the engine is alive but stuck in an IMAP operation, the heartbeat stops updating and the degraded state fires after 120s.

### synthesis-engine

| State | Condition |
|-------|-----------|
| **healthy** | Last run within 1.5× the configured interval |
| **degraded** | Last run within 3× the configured interval |
| **error** | Last run beyond 3× the configured interval (may be stuck) |
| **disabled** | `synthesis_interval_ms` = 0 |
| **starting** | No runs recorded yet |

The interval defaults to 900000ms (15 min). The check falls back to `pipeline_events` if `synthesis.getSynthesisStatus()` is unavailable.

### Overall Health

The overall health banner considers both supervisord services AND application services. If any application reports "error" or "stopped", the overall banner downgrades from "healthy" to "degraded". The banner shows the combined count of degraded components.

## Code Location
- Page: `services/ingenium-dashboard/src/app/status/page.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.status`
- API route: `services/ingenium-api/lib/routes/services.ts` — `GET /api/v1/services/status`
- Health check implementations: `getEmailClientStatus()` and `getSynthesisStatus()` in services.ts

## Related Docs
- [logs.md](./logs.md) — Structured logging and event viewer
