---
title: Usage Telemetry
description: Project-scoped usage totals, advisory thresholds and attention, freshness, filtering, mappings, quarantine, and export.
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

## Advisory thresholds

USAGE-100 adds one project-scoped threshold row over the existing usage ledger.
It can contain nullable thresholds for request count, total tokens,
provider-reported cost amount, cache-read tokens, and cache-write tokens. The
row uses optimistic CAS: `PUT` replaces all five fields and requires the current
`expected_revision`; a stale revision returns `409`.

Evaluation is read-only and caller-selected. Supply both inclusive `from` and
exclusive `to` UTC ISO timestamps, or omit both for an explicit all-history
aggregate. There is no implicit day, month, or billing period. Each metric keeps
its reported subtotal and availability: a known zero is distinct from a partial
subtotal or unavailable value. A configured metric evaluates as `below`,
`equal`, or `above`; a null threshold is `disabled`, and non-`known` data is
`unknown` rather than zero. `reportedCostAmount` is only the provider-reported
numeric amount; Ingenium does not infer currency, pricing, or billing.

Threshold results are advisory only. They do not block, throttle, or route
requests, and they do not modify telemetry, mappings, or scheduler sync state.
All operations require the normal bearer-authenticated, project-scoped API
boundary; foreign or missing projects are rejected.

## Attention lifecycle

Attention reconciliation evaluates the five fixed all-history conditions: request
count, total tokens, provider-reported cost amount, cache-read tokens, and
cache-write tokens. An `unknown` condition is active with `info` severity,
`equal` is active with `warning`, and `above` is active with `critical`.
`disabled` and `below` resolve an existing item and do not create one.

Each project and condition has one durable item. Unchanged evaluations do not
produce a transition event. A change to evaluation state, severity, freshness,
or threshold revision records a transition and clears an acknowledgement;
resolution preserves an acknowledgement, while reopening clears it. The
attention API returns only bounded condition, lifecycle, availability, and
freshness metadata—never provider, source, prompt, message, payload, or
credential data.

`POST /api/v1/usage/attention/evaluate` has no range or payload options: it
reconciles the fixed all-history conditions. `GET /api/v1/usage/attention`
lists active items by default with cursor pagination (maximum 100); set
`include_resolved=true` to include resolved items. Acknowledgement is an
optimistic-CAS update through `POST /api/v1/usage/attention/:id/acknowledge`
with `{ "expected_revision": number }`; replaying the same acknowledgement is
safe and acknowledgement never resolves an item. The API scheduler runs the
same reconciliation for every mapped project on the `USAGE_SYNC_INTERVAL_MS`
cadence (five minutes by default), after the bounded metadata-only usage sync;
failed or no-new-data cycles still reconcile freshness. Setting the interval
to `0` disables both scheduled usage sync and attention evaluation. These
routes are bearer-authenticated and project-scoped; the contract has no MCP
tool and never enforces a threshold on request execution.

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

The **Usage advisories** panel adds the project threshold editor and attention
lifecycle without changing telemetry collection. Threshold edits replace all five
fields with optimistic CAS; a conflict reloads the saved values while retaining
the local draft for review. Blank fields are `Disabled`, reported cost is an
amount only with no currency or conversion, and advisory results never block,
throttle, or route requests.

Selected-range evaluation uses the currently selected UTC range (`from`
inclusive, `to` exclusive). Attention is evaluated separately over all history:
the panel can show active items or include resolved items, evaluate attention,
acknowledge an item, and load more attention pages. Usage events also provide
load-more paging. The UI distinguishes known zero from unknown, partial, and
unavailable/not-reported values and labels freshness rather than filling missing
data with zeroes. Switching projects resets usage filters, telemetry, advisory
evaluation, attention, and export state.

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
| `GET /api/v1/usage/thresholds` | Read this project's threshold row |
| `PUT /api/v1/usage/thresholds` | CAS-replace all five threshold fields |
| `GET /api/v1/usage/thresholds/evaluate` | Read-only threshold evaluation for an explicit UTC range or all history |
| `GET /api/v1/usage/attention` | List active attention items (or resolved items when requested) |
| `POST /api/v1/usage/attention/evaluate` | Reconcile the fixed all-history attention conditions |
| `POST /api/v1/usage/attention/:id/acknowledge` | CAS-acknowledge one attention item |

See [the API reference](../develop/api.md#usage-telemetry) for query limits
and error responses.
