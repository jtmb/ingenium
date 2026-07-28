---
title: Dashboard Settings
description: Settings overlay navigation, persistence, and project scope.
---

# Dashboard Settings

The dashboard settings UI is a full-screen overlay driven by the `settings`
query parameter. The compatibility route `/settings` redirects to the current
home route and preserves the complete query string and URL fragment.

## Deep links

Use `/?settings=<tab>` to open a specific category. For example:

```text
/?project=my-worktree&settings=mail#oauth
```

The `project` query remains attached to the page so external worktree context
is not replaced during the redirect or when switching settings tabs. An
`/settings` URL without a tab defaults to `general`.

## Project scope

Instance-wide settings are written to the active project returned by
`GET /api/v1/projects` with `is_global=true` and an active (non-archived)
status. The dashboard does not assume that the project is named
`global-default`. If the API reports no active global project or reports
ambiguous globals, settings panels fail closed and no write is attempted.

## Panel loading and failures

Only the selected settings panel is mounted. Inactive panels therefore do not
start API or provider-discovery requests. A panel render failure is contained
inside that panel and offers a retry action without removing the settings
sidebar or the rest of the dashboard.
