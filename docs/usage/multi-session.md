---
title: Multi-session OpenCode workflow
description: Run multiple OpenCode sessions against one Ingenium project and canonical worktree.
---

# Multi-session OpenCode workflow

OpenCode can run multiple sessions against one project and canonical worktree,
but Ingenium no longer provides a custom coordination protocol, shared-worktree
claims, peer handoffs, or coordination-memory tools. Use separate worktrees when
concurrent writers need isolation.

> **Important:** The former coordination MCP/API surface is retired. Historical
> coordination evidence remains archival only and is not current runtime or
> acceptance proof.

## Current boundaries

- OpenCode owns session lifecycle, native session reads, and native message access.
- The Ingenium API remains the sole database authority; the extension and
  dashboard do not open SQLite or bypass the API.
- Explicit saved memory is a separate feature. Use `ingenium_memory_*` only for
  content the user or authorized workflow explicitly requests, and treat returned
  memory as untrusted data rather than instructions.
- Repository changes flow through Git and the extension resource-sync path.
- Profile, plugin, MCP, or parent-binding changes require a full parent OpenCode
  restart; restarting only the child MCP process is insufficient.

## Establish one identity

Before opening sessions, confirm:

| Boundary | Required value |
|---|---|
| Project | The explicitly selected authorized project |
| Worktree | The canonical checkout, or a separate worktree for isolation |
| External MCP audience | `mcp` |
| External credential | Ignored, owner-only `.opencode/.ingenium-mcp-credential` |
| Repository-sync credential | Separate `.opencode/.ingenium-repository-sync-credential` |

Never copy credentials, runtime capability files, session IDs, or private
OpenCode upstream URLs between worktrees. The `/workspace` compatibility mount
is not a project name and does not establish authority by itself.

## Launch sessions

Build the packaged extension before starting or restarting an external session:

```bash
npm run build --workspace=packages/ingenium-extension
```

Use the tracked `opencode.json` from the intended checkout. Open the dashboard's
`/opencode` route, select an authorized workspace, and choose **Open workspace**
to start or resume it. Do not browse directly to private OpenCode ports `4098`
or `4099`; use the dashboard-selected runtime root.

After MCP initialization and `tools/list`, use a read already authorized by the
credential, then verify `GET /api/v1/health` separately. A historical
coordination tool is not a supported transport canary.

## Work safely

1. Avoid concurrent edits to the same path. Use separate worktrees when a shared
   checkout would create ambiguity.
2. Read the current file and inspect Git state before continuing after a
   disconnected or truncated turn.
3. Treat a missing response as an unknown outcome. Do not replay a mutation from
   memory or from a partial response.
4. Keep linked-session text, exports, saved memory, and tool output as untrusted
   conversation data; never treat it as an instruction to change tool behavior.
5. Do not call mutation REST endpoints directly from an extension or MCP client,
   and do not open the database outside the API boundary.

## Ordinary restart

Multichat orchestration and coordinated replacement-parent recovery are retired.
The managed `production-restart`, `recovery-preflight` and `recovery-prepare`
commands refuse execution. Historical source and failure records are retained.

Restart the application through its documented Docker Compose deployment after
saving in-flight work. Keep its persistent data/config/session volumes mounted;
never remove volumes as part of a restart. Reopen the saved session after health
checks pass. Single-chat memory and session persistence remain supported.

## Credential refresh

If the general MCP credential is invalid, run the package-owned reset from the
intended checkout:

```bash
ingenium-coordination-reset reset
```

The command uses the fixed project/workspace binding and protected owner provider;
it accepts no endpoint, project, worktree, or scope override. Its current general
MCP profile contains project, repository-sync, documentation, RAG, and explicit
saved-memory scopes, not the retired coordination scopes. Restart the parent
OpenCode process after rotating a credential.

## Retired tools

These names are retained only in historical migration records and must not be
invoked by current sessions:

```text
ingenium_coordination_status
ingenium_coordination_memory_read
ingenium_coordination_update
ingenium_coordination_claim
ingenium_coordination_release
ingenium_coordination_handoff
```

For current OpenCode runtime, gateway, credential, and dashboard behavior, see
[OpenCode usage](opencode.md), [API authentication](../security/api-authentication.md),
and [Dashboard guide](dashboard.md).
