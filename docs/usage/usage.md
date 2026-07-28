---
title: Usage Telemetry
description: Project-scoped usage totals, freshness, filtering, mappings, quarantine, and export.
---

# Usage Telemetry

Usage telemetry is provider-neutral and project-scoped. Ingenium reads only
assistant `step-finish` parts from the OpenCode source and persists metadata:
raw provider/model IDs, nullable assistant-agent attribution, request status,
UTC timestamps, required numeric usage-token counters (including
reasoning-token counts), optional cache state, and cost state. Prompts, message
text, reasoning content, tool payloads, credentials, API tokens, and opaque
upstream payloads are not collected.

## Project mapping and quarantine

OpenCode project IDs are not Ingenium project names. Before collection, create
an explicit mapping with `PUT /api/v1/usage/mappings` using the current
Ingenium project and the OpenCode `opencodeProjectId`. A mapping owned by a
different Ingenium project is rejected with `409`.

Sessions from an unmapped OpenCode project are quarantined. They are not
assigned to `global-default`, and no usage events are written for them. After
the owner creates the mapping, run a manual sync or wait for the scheduler.

## Cost, token, and cache semantics

Values remain unknown when OpenCode does not report them. Cost availability is
`known`, `partial`, or `unavailable`; a partial value is not a billing
calculation. Cache telemetry distinguishes reported cache use, read, write,
known-zero, and unknown. It does not derive a provider hit-rate or infer a
provider cache miss. Ingenium does not infer provider billing. A replayed source
part is upserted by `(sourceInstance, sourcePartId)` rather than counted twice.

Reasoning is represented only by a non-negative numeric token counter when
reported; its content is never collected. Assistant-agent attribution comes
only from the assistant message that owns the step-finish, is not inferred from
session defaults, and remains `null` when absent.

When a message has one `step-finish`, message-level usage may be used as its
fallback. For messages with multiple step-finish parts, message-level cost and
token values (including reasoning tokens) are not redistributed across parts.

## UTC ranges, freshness, and export

API ranges use inclusive `from` and exclusive `to` UTC ISO timestamps and are
limited to 366 days. Summary responses include a complete daily UTC series and
freshness fields for the latest event, last completed sync, and last successful
sync. The default collector interval is five minutes and can be changed with
`USAGE_SYNC_INTERVAL_MS`.

Provider, model, assistant-agent, and status filters accept repeated query
parameters. Summary and daily rows expose reasoning-token availability with the
same `known`/`partial`/`unavailable` semantics as other aggregated metrics;
breakdowns retain nullable assistant-agent attribution.

CSV export is deterministic, metadata-only, and capped at 10,000 rows. When
the result is truncated, continue with `X-Export-Next-Cursor`; the response
also reports `X-Export-Truncated: true`. Export fields do not include prompts,
reasoning content, tool payloads, or credentials, but do include numeric
reasoning-token and nullable assistant-agent metadata.

## Dashboard

The `/usage` dashboard view presents totals, requests, required numeric token
input/output counters, reported cache use/read/write state, cost availability, daily UTC charts,
provider/model breakdowns, date and provider/model/status filters, freshness,
and CSV export. Missing cost or cache values must be shown as unknown/not
reported, not as zero or as an inferred provider hit/miss. Loading, empty, API failure, and export states are
separate actionable states.

The view uses the active project; it does not merge telemetry from another
Ingenium project. All supported provider/model identities are displayed from
the normalized metadata without provider-specific branding or credentials.

## API quick reference

All routes require `?project=<name>`:

| Route | Purpose |
|---|---|
| `GET /api/v1/usage/summary` | Totals, daily UTC series, and freshness |
| `GET /api/v1/usage/breakdown` | Provider/model aggregates |
| `GET /api/v1/usage/events` | Bounded event pagination |
| `GET /api/v1/usage/export` | Bounded CSV export |
| `GET /api/v1/usage/mappings` | Explicit project mappings |
| `PUT /api/v1/usage/mappings` | Create or confirm a mapping |
| `POST /api/v1/usage/sync` | Run a bounded manual sync |

See [the API reference](../develop/api.md#usage-telemetry) for query limits
and error responses.
