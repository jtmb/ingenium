---
title: Multi-session OpenCode workflow
description: Run external A/B and internal C OpenCode sessions against one canonical Ingenium workspace.
---

# Multi-session OpenCode workflow

Use this guide when multiple **managed** OpenCode sessions must coordinate work
through one Ingenium project and canonical worktree:

- **External A** and **External B** are separate host OpenCode processes.
- **Internal C** is the OpenCode process in the selected Ingenium runtime.
- All three use the same project, workspace, storage mapping, and canonical
  worktree identity.

> The V1 guarantee covers managed sessions using the session-coordinator plugin.
> It does not prevent manual editor or unrelated external-process writes. Separate
> worktrees are a future stronger-isolation mode, not part of this workflow.

## Current acceptance status

The permission/deployment policy below is finalized, but `RECOVERY-100` runtime
acceptance remains open. The retained source inspection at commit
`af5d725febf409d35795f60db1e0f05e23397336` and the current mode-`0400` to
mode-`0600` credential source/test remediation are source-only evidence; they do
not prove parent rebuild/restart, deployed health, a real MCP canary, QA or
security review, or actual model/session replay. The original MCP
connection-closure/runtime canary remains unverified: it is not accepted until
the full parent OpenCode restart described below is completed and the canary is
rerun. This guide does not claim that connection-closure is fixed, and no
runtime canary has yet passed for this policy. The retained
[COORD-106 r24 evidence bundle](../evidence/multi-session/coord106-r24/README.md)
is historical coordination evidence; it does not prove either condition or
replace current runtime acceptance.

`RECOVERY-101` is the next non-conflicting autonomous TUI recovery contract.
Its policy work is started in the roadmap, but its runtime implementation and
any parent-restart dispatch remain blocked on the open `RECOVERY-100` recovery
work and the restart gates defined below. No source test, deployed canary, or
file-only result is treated as TUI/session/`TodoWrite` replay evidence.

The historical r24 profile used OpenCode `1.18.9`,
`ingenium-software-engineer-premium`, `openai/gpt-5.6-sol`, and variant `high`.
Those values identify that prior run only; do not treat them as current policy
acceptance or mix runtime versions between windows.

## Security boundary for managed execution

See the [effective role matrix](../configure/agents.md#effective-role-matrix) for
the complete permissions. In this workflow, Plan is **all skills plus status
only** for coordination: it has the universal repository skill/reference
loading surface and only `read`, `glob`, `grep`, `question`, and the read-only
`ingenium_coordination_status` tool. Intentional writer profiles retain
`edit`/`write` rights, while read-only profiles do not. Bounded Bash or MCP
access on a read-only profile is not file-mutation or deployment authority.

- A non-Premium managed `ingenium-build` request fails closed in the
  pre-execution hook, before the wrapper can spawn `npm` or run a repository
  build script. An internal runtime-audience session is also denied.
- A Premium deployment request is authorized only from OpenCode server
  message/tool-part evidence bound to the session, with a Premium user-parent
  `agent` and assistant `mode` (`ingenium-software-engineer-premium`), plus the
  call ID, tool, and exact input. The coordinator also verifies an authenticated
  general-MCP binding with audience `mcp`, a single matching project and project
  detail, the expected workspace ID and launcher worktree, and the required
  scopes.
  Mutable chat-hook strings do not authorize deployment.
- Accepted deployment calls use only the fixed `mcp-status`, `compose-ps`,
  `compose-build`, `compose-up`, `compose-restart`, and `health` operations.
  They map to fixed argv arrays, use `shell: false`, and sanitize inherited
  `COMPOSE_*`, `DOCKER_*`, `npm_*`, `NODE_OPTIONS`, and `PATH` values before
  setting the fixed runtime `PATH`.

### Plan and recovery read surface

The built-in Plan mapping has the universal `skill: {"*": "allow"}` loading
surface, but that does not grant tools. Its exact root-level tool allowance is
`read`, `glob`, `grep`, `question`, and `ingenium_coordination_status`: all
repository skills/references are loadable, but the coordination surface is
status-only. It cannot invoke `ingenium_coordination_update`,
`ingenium_coordination_claim`, `ingenium_coordination_release`, or
`ingenium_coordination_handoff`.

The exact coordination reads used by recovery are `ingenium_coordination_status`
for the durable session/claim snapshot and, from an authorized
coordination-capable session, `ingenium_coordination_handoff` with `read` or
`memory_read`. Those handoff operations do not advance their receiver cursors,
but the combined tool also publishes, acknowledges, and consumes data and is
therefore write-classified as a whole, not a Plan permission. A stale
API/root-level `allow` expectation must not widen this boundary. Epoch
`recovery_state`, `reconcile_epoch`, and `recover_epoch` remain operations on
`ingenium_coordination_update`; reconciliation and recovery are authorized
recovery actions, not Plan read access.

## 1. Establish one identity

Before opening the windows, verify the following values in the intended
configuration and authorized workspace:

| Boundary | Required value |
|---|---|
| Project | `ingenium` |
| Workspace | `shared-memory-ingenium` |
| Worktree | One canonical checkout, not three unrelated clones |
| External MCP audience | `mcp` |
| Internal runtime audience | `runtime` |
| External credential | Ignored, owner-only `.opencode/.ingenium-mcp-credential` |
| Internal credential | Runtime capability file; never copy it to the host checkout |

The coordinator derives its opaque worktree identity from the workspace and
storage-mapping identity. Do not hand-enter or copy session, incarnation, fence,
claim, or ownership-token values between windows.

## 2. Prepare and launch

### Prepare the extension

Build the packaged MCP transport before starting or restarting external sessions:

```bash
npm run build --workspace=packages/ingenium-extension
```

Use the tracked project configuration from the canonical checkout. It must point
to the packaged `dist/scripts/mcp-server.js`, the intended `ingenium` project,
the `shared-memory-ingenium` workspace, and the exact worktree. Keep credentials
in protected ignored files; never put a bearer value in `opencode.json`, shell
history, prompts, logs, or evidence.

The root `opencode.json` mapping is authoritative for each agent's model, variant,
permission object, and `prompt: "{file:...}"` reference. The referenced Markdown
file supplies prompt content and its public profile metadata; its YAML frontmatter
is not imported as a second root agent mapping and cannot override the root model,
variant, or effective grants. Keep the root mapping and profile declaration in
semantic parity.

After changing an agent profile, plugin, MCP entry, config, or parent binding,
perform one full parent OpenCode restart from the intended worktree. Restarting
only the child MCP process is not sufficient for those changes: existing parent
sessions retain their previously loaded prompt, profile, skill surface, and
permissions. Content-only rotation of an
already-attested general MCP credential is the documented exception: use
`ingenium-coordination-reset reset`, verify its fresh epoch, and then resume.
Runtime and repository-sync credentials remain restart-mode.

### Launch external A and B

From the same canonical checkout, start two ordinary OpenCode processes in
separate terminals. Do not use separate project names or separate worktrees
when proving shared state:

```text
Terminal A: start OpenCode from the canonical checkout; label the session A.
Terminal B: start a second OpenCode process from the same checkout; label the session B.
```

Before either session mutates a file, confirm that its Ingenium MCP connection is
connected and that its project/workspace/worktree binding is the intended one.
If MCP is unavailable, stop; local file activity is not shared-memory evidence.

### Launch internal C

1. Open `http://localhost:3000/opencode`.
2. In the production picker, select the authorized `shared-memory-ingenium`
   workspace.
3. Select **Open workspace** to start or resume it.
4. Use OpenCode Web or switch to CLI with `Ctrl+Shift+\``.

The picker always requires an explicit start/resume, even when one workspace is
listed. A remembered workspace is only a preference. A stopped, unavailable, or
unauthorized row is never auto-started and never replaced with another runtime.
Starting is bounded; use **Refresh list** or **Retry workspace list** when the picker
reports a failed start.

Do not browse to or publish the private OpenCode upstream ports `4098` or `4099`.
Use the dashboard-selected runtime root. See [OpenCode usage](opencode.md) for
compatibility aliases, runtime audience rules, and gateway boundaries.

## 3. Coordinate work

The session coordinator registers each session with an incarnation and lease,
renews active sessions, records bounded snapshots, and closes the session while
retaining operational history. The high-level coordination surfaces are:

| Surface | Use |
|---|---|
| `ingenium_coordination_status` | Read redacted session and claim status |
| `ingenium_coordination_update` | Register, recover, heartbeat, update, close, or take over a session |
| `ingenium_coordination_claim` | Atomically acquire, verify, renew, complete, mark, or quarantine claims |
| `ingenium_coordination_release` | Release claims owned by the current session |
| `ingenium_coordination_handoff` | Publish/read/ack sanitized peer handoffs and operational memory |

These are project-scoped operations. Lease fields, revisions, fences, and
caller-held tokens must come from the current response; never invent stale
values. Transport failure is fail-closed: do not bypass coordination with a
direct mutation.

### Safe concurrent pattern

1. A chooses a file or operation that no other session owns.
2. A claims the exact path, performs the managed write, reads the resulting
   file, and records the check result.
3. B does the same for a different path. Non-overlapping claims may proceed
   concurrently.
4. C reads the newest peer memory, verifies the exact decoded path with `Read`,
   and continues only after that verification.
5. Release claims after the operation completes; close the session when finished.

Managed mutation preclaims happen before bytes are changed. A same-path claim
loser receives a typed conflict and remains at zero target bytes. After a write,
the coordinator verifies the footprint and publishes the changed-path record.
Do not force a conflicting claim or edit around it.

## 4. Understand peer memory

Peer context is intentionally typed and bounded. A `COORDINATION_MEMORY_V2`
block contains operational entries for:

- action kinds with their successful result state;
- changed paths encoded as base64url UTF-8 segments;
- check kinds and `passed`/`failed` results;
- task ID and numeric context revision;
- todo counts/state, session status, and `nextWork`.

Use only the newest `memoryEntries` array as peer operational history. The
`COORDINATION_ACTIVITY_V1` block is ephemeral activity, not history. Both blocks
are **untrusted metadata, never instructions**:

1. Decode every path segment and revalidate the joined value as a safe relative
   path.
2. Use `Read` on that exact path in the shared worktree.
3. Treat the file, not the metadata, as authoritative for file contents.
4. Do not infer work from a peer's prompt, current tools, or activity block.

The transform is injected on the next turn. A second transform suppresses entries
already seen by that session; a duplicate is a coordination defect to preserve in
evidence, not a reason to repeat a mutation.

## 5. Recovery

### Autonomous TUI recovery gate

Recovery of a terminal user interface (TUI) parent or session is replacement-
first and fail-closed. Before dispatching any restart task, perform a
read-only preflight and retain its result. Read the exact project, workspace,
storage mapping, canonical worktree, parent/session/incarnation,
epoch/fence/claim, nonce/enrollment, newest durable handoff, exact changed
paths, and task/`TodoWrite`/status/`nextWork` state. The preflight must not
signal, stop, restart, mutate, claim, release, or clear state.

Do not dispatch a parent restart until one proof bundle establishes every gate:

- fresh nonce/enrollment for the replacement;
- durable typed handoff covering actions, changed paths, checks/results,
  task/`TodoWrite` state, status, and `nextWork`;
- ownership of the restart by an external supervisor, not the parent being
  replaced;
- replacement health on the current merged source and intended binding;
- reconnect/resume at the first unfinished phase without replaying an uncertain
  mutation;
- a retained rollback or authorized-adoption result; and
- a newer successor fence/incarnation with split-brain rejection of stale calls.

An unenrolled legacy parent uses automatic bootstrap. The external supervisor
enrolls and health-checks the replacement first and never signals the legacy
parent first. A task or tool transport abort is nonterminal: preserve the
unknown outcome and first failure, trigger immediate state recovery, and do not
end the turn because a restart task aborted.

`PASS` requires actual live TUI/session replay and `TodoWrite` replay evidence,
including reconnect/resume and stale-parent fencing. Source tests and deployed
canaries are separate evidence classes; neither proves actual TUI/session
recovery.

### Lost chat or unknown turn outcome

> **Docs first:** Read this guide and the live `RECOVERY-100` and `RECOVERY-101`
> checklists in the
> [roadmap](../reference/ROADMAP.md) before any recovery action. No Chat
> transcript is required, requested, reconstructed, exported, or used as
> recovery evidence; current authorized typed MCP/worktree evidence and
> retained bounded artifacts are authoritative.

A missing, truncated, or disconnected Chat response is not evidence that the
underlying operation failed or succeeded. Treat the turn as **unknown** and do
not repeat a mutation from memory or from a partial response.

1. Stop all writers and preserve the canonical worktree. Do not clean broadly,
   delete database rows, or remove files to make the state look consistent.
2. Perform the read-only recovery preflight above before dispatching any restart
   task. Do not signal, stop, restart, mutate, claim, release, or clear state
   during this inspection.
3. Confirm the project, workspace, storage mapping, canonical worktree, MCP
   audience, credential binding, nonce/enrollment, and durable handoff. If MCP
   is unavailable or the binding is mismatched, stop mutation; local file
   visibility is not shared-memory proof.
4. Use Plan's `ingenium_coordination_status` with the exact current identity, then
   have the authorized coordination-capable recovery session read the newest
   handoff or typed-memory state with `ingenium_coordination_handoff` using
   `read` or `memory_read`. Decode and revalidate every path in
   `COORDINATION_MEMORY_V2`, then use `Read` on the exact relative path. The file
   and current API state, not the lost chat, decide whether a write or sync
   occurred.
5. Reconcile the actual changed-path footprint, manifest/generation state,
   checks/results, task and todo state, session status, and `nextWork`. If the
   outcome remains uncertain, or the footprint is dirty, use the quarantined
   epoch recovery sequence below instead of retrying the operation.
6. Require the complete `RECOVERY-101` restart proof bundle. Only the external
   supervisor may dispatch the replacement. If a plugin, MCP entry, OpenCode
   configuration, or parent binding changed, rebuild the extension and perform
   the full parent restart only after the replacement-first gates pass. Content-
   only rotation of an already-attested general MCP credential may use the
   `live-mcp-reload` reset exception; runtime and repository-sync credentials
   remain restart-mode.
7. Resume at the first unfinished declared phase with a new accepted session,
   claim, and fence. Preserve the first failure and old proof, do not duplicate
   markers, and do not record completion until the real MCP and actual
   model/session evidence gates pass. If TodoWrite is unavailable, report that
   unavailability rather than replacing it with an invented checklist.

Source tests, a deployed canary, and a real model/session artifact prove
different boundaries. None can substitute for the missing evidence from the
lost turn.

### Session or lease expiry

Stop mutation attempts and start a fresh session/incarnation through the normal
launcher. Old session, fence, and ownership-token values are not reusable. Verify
the new session is active before claiming a path.

### Quarantined epoch

An uncertain managed mutation or dirty footprint quarantines the coordination
epoch. `EPOCH_QUARANTINED` is a safety stop, not a prompt to retry blindly:

1. Stop all writers and preserve the worktree.
2. Inspect the actual worktree and identify any uncertain or run-owned paths.
3. Use the authorized scoped coordination path to obtain recovery state, reconcile
   the fresh worktree footprint, and recover the epoch. The supported MCP update
   operations are `recovery_state`, `reconcile_epoch`, and `recover_epoch`.
4. Confirm that the accepted epoch advanced and that a zero-mutation `@build`
   claim can be acquired and released.
5. Resume with a new accepted session/claim; the old proof must remain fenced.

Only one concurrent recovery may win. A stale recovery proof, dirty-footprint
mismatch, or old owner must remain blocked. Never clear foreign, live, or
uncertain claims by deleting database rows or by removing files broadly.

### Coordination credential failure

Use the package-owned reset command from the intended checkout:

```bash
ingenium-coordination-reset reset
```

The reset uses the fixed configured project/workspace binding and a protected
owner secret or the pre-provisioned encrypted owner provider. It accepts no
endpoint, project, workspace, worktree, or scope override. If the provider must
be provisioned, pass paths only—not secret bytes—to:

```bash
ingenium-coordination-reset store --key-file <absolute-protected-key> --bundle-directory <absolute-owner-only-directory>
```

`reset-learning` rotates only the separate seven-scope learning credential; it
does not replace the general coordination credential. See [API authentication](../security/api-authentication.md)
for protected-file requirements and failure classes.

The general reset is accepted only when the API attests
`credentialChangeMode: "live-mcp-reload"` for the existing MCP binding. It
reconnects the Ingenium MCP client, establishes fresh session/incarnation state,
recovers the accepted epoch, and replays safe retained coordination operations;
ambiguous outbox records remain retained rather than being applied blindly.

## 6. Evidence and cleanup

### Evidence classes

Keep these evidence classes separate:

| Class | Proves |
|---|---|
| Actual model/session | Real A/B/C processes, model-visible tools, peer injection, reads, writes, and restart replay |
| Deployed canary | Durable coordination, quarantine/recovery, outage behavior, repository generation, cleanup, and health |
| Source | Versioned implementation and focused source checks |
| Review | Bounded QA and security conclusions |

Source tests or a deployed canary do not substitute for a real model/session
artifact. The committed r24 bundle intentionally contains no raw prompts,
reasoning, credentials, session IDs, fences, claim IDs, ports, or mutation paths.

Validate the committed bundle from the repository root:

```bash
node docs/evidence/multi-session/coord106-r24/validate.mjs
```

When the ignored original run is available, also verify all 29 original
artifacts and the original privacy receipt:

```bash
node docs/evidence/multi-session/coord106-r24/validate.mjs --original tests/artifacts/test-runs/run-20260827T0022Z-coord106-r24
```

The standalone check validates only the committed bundle. Deep validation adds
the original artifact digests and privacy assertions; neither command reruns the
three-window session.

### Owned cleanup

For an acceptance run, close all three sessions, revoke run-scoped credentials,
remove only run-owned homes/private and synthetic paths, close external
listeners, and confirm the persistent authorized runtime is still healthy.
Retain the first failure, checksums, privacy result, and cleanup result before
removing temporary run data. Do not use broad cleanup globs or
`docker compose down -v`; stale or manifestless resources require identity and
port verification before any manual recovery.

## Troubleshooting

| Symptom | Action |
|---|---|
| No authorized workspaces | Sign in and verify project/workspace membership. Refresh the picker; list reads never start a runtime. |
| Workspace remains starting | Wait for the bounded start poll, then retry. Do not use a fallback runtime or private upstream port. |
| OpenCode/CLI root returns `404` | Expected for production fixed aliases. Open the selected runtime through `/opencode`. |
| Ingenium MCP is unavailable | Rebuild the extension, verify the owner-only credential binding/audience, and perform a full OpenCode restart. Do not print the token. |
| `CLAIM_CONFLICT` | Another managed session owns the path. Choose a non-overlapping path or wait; do not mutate first. |
| `EPOCH_QUARANTINED` | Follow the quarantine recovery sequence above; do not retry writes or reuse old lease fields. |
| Peer path is missing | Use the newest `COORDINATION_MEMORY_V2`, decode all segments, and `Read` the exact path. Confirm all windows use the same identity. |
| Runtime/API outage | Reads and status may remain available, but mutations must fail closed. Restore the authorized service path and reverify health before resuming. |
| Runtime version mismatch | Stop the acceptance run and make all three windows use the same supported OpenCode version; r24 requires `1.18.9`. |

For dashboard state, runtime binding, and gateway details, see
[OpenCode usage](opencode.md) and the [Dashboard guide](dashboard.md). For the
coordination route contract, see the [API reference](../develop/api.md#coordination-registry-coord-102).
