---
title: Status
description: Service status page — supervisord process states, application health, and real-time monitoring.
---

# HOW-TO: Status

## What It Does
Service status page showing real-time process and application health. Displays supervisord-managed process states (API, Dashboard, opencode-web, ttyd-opencode) alongside in-process application services (email-client, synthesis-engine).

## How to Use
1. Navigate to `/status` from the dashboard nav bar
2. Each process card shows:
   - **Process name** — API, Dashboard, opencode-web
   - **Status badge** — Running (green), Starting (yellow), Stopped (red)
   - **Uptime** — how long the process has been running
   - **Restart count** — number of automatic restarts by supervisord

## Application Services

The status page also displays **Application Services** cards for application-level health checks.

### email-client

| State | Condition |
|-------|-----------|
| **healthy** | Engine running, heartbeat < 120s old, 1+ accounts connected |
| **degraded** | Engine running but heartbeat stale (> 120s) |
| **idle** | Engine running, no accounts configured |
| **stopped** | Engine not running |

### synthesis-engine

| State | Condition |
|-------|-----------|
| **healthy** | Last run within 1.5× the configured interval |
| **degraded** | Last run within 3× the configured interval |
| **error** | Last run beyond 3× the configured interval |
| **disabled** | `synthesis_interval_ms` = 0 |

### Overall Health

The overall health banner considers both supervisord services AND application services. If any application reports "error" or "stopped", the overall banner downgrades to "degraded".

## Code Location
- Page: `services/ingenium-dashboard/src/app/status/page.tsx`
- API route: `services/ingenium-api/lib/routes/services.ts`

## Related Docs
- [Logs](logs.md) — Structured logging and event viewer
