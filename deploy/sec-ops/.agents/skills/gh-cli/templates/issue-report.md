# Issue Report

<!--
  Fill out all sections that apply. Use {placeholders} as guides.
  The goal: someone else can diagnose and fix this without asking follow-up questions.
-->

## Summary

{One-line description of what broke}

## Type

- [ ] **Bug** — Something is broken or behaving unexpectedly
- [ ] **Feature** — New capability or enhancement request
- [ ] **Task** — Chore, refactor, documentation, or operational work

## Environment

| Field | Value |
|-------|-------|
| Version / release | `{version-tag-or-commit-hash}` |
| Uptime | {uptime-if-service-bug} |
| Total entries / records count | {count} |
| Server stats (CPU/MEM/DISK) | {server-stats-if-available} |
| OS / architecture | {os-and-arch} |
| Client / tool | {curl / MCP bridge / SDK / other} |
| Client version | {client-version-if-applicable} |
| Deployment | {local / staging / production / CI} |

## Steps to Reproduce

1. {Step one}
2. {Step two}
3. {Step three}

```bash
# Exact command(s) to reproduce the issue
{command-to-reproduce}
```

## Expected Behavior

{What should happen when the steps above are followed}

## Actual Behavior

{What actually happened instead}

```
{error-message / stack-trace / status-code}
```

- **HTTP Status**: {200 / 400 / 500 / etc.} (if applicable)
- **Request ID / Trace ID**: `{request-id-if-available}` (if applicable)

## Debugging Data

<!-- Provide any data that helps triangulate the root cause -->

| Item | Details |
|------|---------|
| Failing query / mutation | `{query-or-mutation}` |
| Request ID(s) | `{request-id}` |
| Working query (contrast) | `{working-query-if-applicable}` |
| Server stats at failure | {cpu-mem-disk-io-at-time-of-failure} |
| Relevant logs | <!-- Paste or link to logs --> |
| Screenshots | <!-- Attach screenshots if UI-related --> |

```json
// Additional raw response / payload data (if applicable)
{paste-json-or-other-raw-data}
```

## Impact

- {Workflow or tool affected}
- {Users or systems affected}
- {Frequency or severity of the issue}

## Workaround

{Is there a temporary fix or mitigation? Describe it here. If none, state "None known."}

## Additional Context

<!-- Anything else that might help — recent changes, related issues, relevant links -->

- {Related issue #123}
- {PR that introduced the change}
- {Link to relevant docs or code}
