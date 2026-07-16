---
title: Logs
description: Structured logging and event viewer — system logs from all services with source and level filters.
---

# HOW-TO: Logs

## What It Does
Structured logging and event viewer. Shows system logs from all services with source and level filters for debugging and monitoring.

## How to Use
1. Navigate to `/logs` from the dashboard nav bar
2. Use the **Source** dropdown to filter by log source (scheduler, API, auto-observer, etc.)
3. Use the **Level** dropdown to filter by severity (error, warn, info, debug)
4. Use the **Time range** picker to narrow by date
5. Click any log entry to expand and view full details

## MCP Tools

| Tool | Purpose |
|------|---------|
| `ingenium_logs_list` | Show recent system logs (filter by source, level, or time) |
| `ingenium_logs_sources` | List available log sources |

## Code Location
- Page: `services/ingenium-dashboard/src/app/logs/page.tsx`
- API client: `services/ingenium-dashboard/src/lib/api.ts` → `api.logs`

## Related Docs
- [Jobs](jobs.md) — Job queue and background task monitoring
