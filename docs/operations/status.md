---
title: Status
description: Service status page — supervisord process states, application health, and real-time monitoring.
---

# HOW-TO: Status

## What It Does
Service status page showing real-time process and application health. In the
production control-plane profile it displays the five required Supervisor
processes—`ingenium-api`, `ingenium-api-boundary`, `ingenium-dashboard`,
`ingenium-gateway`, and `restore-handoff`—alongside the optional
`restore-maintenance` process and in-process application services.

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
| **healthy** | A configured account has an engine heartbeat < 120s old |
| **degraded** | A configured account's engine heartbeat is stale (> 120s), or every active account has all folders in error |
| **idle** | No accounts are configured; email is optional and does not affect aggregate health |
| **starting** | A configured account's engine is awaiting its first heartbeat |
| **stopped** | A configured account's engine is not running |

### synthesis-engine

| State | Condition |
|-------|-----------|
| **healthy** | Last run within 1.5× the configured interval |
| **degraded** | Last run within 3× the configured interval |
| **error** | Last run beyond 3× the configured interval |
| **disabled** | `synthesis_interval_ms` = 0 |

### Overall Health

The aggregate health result combines the supervisord process result with application health, but only required application entries can add an application issue. Any required application state other than `healthy` (`degraded`, `error`, `starting`, or `stopped`) downgrades an otherwise healthy process result to **degraded**. If supervisord has no running processes, the result remains **down**; an application issue does not turn a process-level `down` result into a different state.

For operational interpretation, a required application has these failure states:

| State | Meaning | Aggregate effect |
|-------|---------|------------------|
| `degraded` | The application is running but a health signal is impaired or stale | Downgrades an otherwise healthy aggregate to **degraded** |
| `unhealthy` | The application failed its health check | Downgrades an otherwise healthy aggregate to **degraded** |
| `stopped` | The application is not running | Downgrades an otherwise healthy aggregate to **degraded** |

The dashboard accepts `unhealthy` as the terminal health-check label. The current API producer uses `error` for equivalent internal application failures; treat that state the same as `unhealthy` when triaging. `starting` is also non-healthy while a required application awaits its first usable health signal.

The status page also reconciles a stale optimistic aggregate from the API in
the browser: if the API reports `healthy` while a required process is not
`running` or a required application is not `healthy`, the page displays
**degraded** and counts those components. Optional services are excluded from
that reconciliation, so an unconfigured email client remains **idle** without
making the banner degraded. The dashboard health strip applies the same
required-versus-optional rule when summarising its service list.

Requiredness is state-dependent:

- **Email** is optional until an account is configured. With no accounts it reports `idle`, which is expected and cannot degrade aggregate health. After configuration, the email engine is required: `starting`, `stopped`, `degraded`, `unhealthy`/`error`, or another non-`healthy` state does degrade health. Do not treat unconfigured email `idle` as a failure.
- **Synthesis** is required while its interval is enabled. No completed run yet is reported as healthy; stale or failed runs degrade/error the aggregate. Setting `synthesis_interval_ms` to `0` reports `disabled` and makes it optional.
- **Docs** and **Tasks** are always optional. Their `idle` or `error` states are informational and do not degrade aggregate health.

## Aggregate status and detail views

`GET /api/v1/services/status` is the aggregate view: it returns supervisord
processes, in-process application health, and the overall `healthy`, `degraded`,
or `down` result. Selecting a process card opens its process-detail view, while
selecting an application card opens application detail with the relevant engine
or statistics payload; detail data does not replace the aggregate health result.

Production reads Supervisor XML-RPC through the private
`/run/ingenium-supervisor/supervisor.sock` Unix socket. The production
configuration has no TCP Supervisor listener, including no TCP `9001` listener.
Local development may set `SUPERVISOR_SERVER_URL` to an explicit loopback HTTP
endpoint. The on-demand `restore-maintenance` program is optional, so its normal
`STOPPED`/not-started state does not degrade aggregate health. `email-client` and
`synthesis-engine` remain separate in-process application entries, not Supervisor
processes. Compatibility mode may expose additional OpenCode, CLI, and VS Code
process cards.

Unknown process names return `404 PROCESS_NOT_FOUND`. If Supervisor cannot
answer a process or log request, the API returns `502 SUPERVISOR_UNAVAILABLE`
with a safe message. Process detail also exposes the bounded log view used by
the status overlay; application detail is available for email, synthesis, Docs,
and Tasks.

## Code Location
- Page: `services/ingenium-dashboard/src/app/status/page.tsx`
- Health strip: `services/ingenium-dashboard/src/app/components/HealthStrip.tsx`
- API route: `services/ingenium-api/lib/routes/services.ts`

## Verification

The dashboard component tests cover stale `healthy` aggregates with a stopped
required process or degraded required application, and verify that optional
idle email remains out of the degraded count:

```bash
npm test --workspace=services/ingenium-dashboard -- status-health.test.tsx
```

## Related Docs
- [Logs](logs.md) — Structured logging and event viewer
