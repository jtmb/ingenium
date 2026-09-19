# Ingenium Rollout Handoff — 2026-09-16

## Terminal state

Work stopped at the user's explicit request. Do not infer completion.

- Do not restart or signal the host OpenCode parent.
- Do not replay an interrupted task, reset, outbox record, or Docker action
  without first reconciling its current state.
- Do not print, commit, or copy credential values.
- Read [`AGENTS.md`](AGENTS.md), the active
  [`ingenium-orchestrator` profile](.opencode/agents/primary/ingenium-orchestrator.md),
  and the relevant current section of
  [`docs/reference/ROADMAP.md`](docs/reference/ROADMAP.md) before resuming.

## Repository state

| Field | Value |
|---|---|
| Project | `ingenium` |
| Canonical worktree | `/home/brajam/repos/ingenium` |
| Branch | `context-upload-hardening-opencode-1.18.9` |
| Last pushed pre-handoff commit | `452fab4ea8ba6aee57413ab53270c7584c974f21` |
| Previous evidence/config commit | `88182df2a8ca8e338e1bccf2f03069a19f19154b` |
| Earlier orchestration source commit | `f9c7287382ca9e677b17eb1f8283474aa3b29587` |

The branch was synchronized at `452fab4e` before later uncommitted work began.

### Task-owned uncommitted paths

- `packages/ingenium-extension/coordination-reset.ts`
- `packages/ingenium-extension/coordination-reset.test.ts`
- `opencode.json`
- `HANDOFF.md`

The first three paths contain an unfinished host-workspace binding change:

- root `opencode.json` uses workspace `shared-memory-ingenium`;
- coordination reset reads the workspace ID from canonical root config rather
  than hardcoding `shared-memory-ingenium` for credential issuance, prior
  matching, response validation, and preflight headers;
- a focused regression covers configured workspace propagation;
- a later scope fix moved the validated workspace ID outside the local `try`
  block.

These latest changes are **unverified and uncommitted**. Do not claim that they
compile or pass tests.

### Unrelated dirty paths

Do not stage, modify, or commit these as part of this rollout:

- `.opencode/package.json`
- `.opencode/package-lock.json`
- `packages/ingenium-extension/mcp-launcher.test.ts`

## Verified completed work

### Direct-first orchestration rollout

The pushed rollout implements and documents:

- direct execution with zero subagents when authorized and efficient;
- useful delegated teams of 2–6 assignments, with 3 preferred and no filler;
- a maximum of 6 active children per parent;
- dependency-ready, non-overlapping writer territories;
- honest synchronous execution unless runtime background capability and
  correlated results are both present;
- conditional QA, documentation, security, deployment, visual, and recovery
  gates.

Retained verification before the later recovery work included:

- core coordination tests: `52/52`;
- extension coordinator tests: `92/92`;
- affected typechecks;
- scheduler policy validation;
- full agent/documentation-config validation.

### Owner-recovery helper

Commit `452fab4e` changed the development owner-recovery helper to select the
unique active organization owner instead of hardcoding
`bootstrap-admin@localhost`. It deduplicates by user ID, fails closed unless
exactly one owner exists, preserves the actual email, rejects environment-file
injection, and uses a replacement callback so `$` sequences remain literal.

Evidence:

- focused helper tests: `3/3` passed;
- QA found one replacement-token blocker;
- the blocker was remediated with the named focused regression;
- the security report found no BLOCKING security issue;
- no reviewer was rerun after remediation.

## Runtime and capability evidence

Before the final cleanup attempt, the compatibility runtime had been rebuilt
and was healthy.

- Image: `sha256:bce5bfcc527c129518cd5bdb1adef6db2142f261bf10a8ccc05205a56f01b573`
- API: `200`
- Dashboard/login: `200`
- OpenCode Web: `200`
- CLI/ttyd: `200`
- VS Code: `302` then `200`
- OAuth callback without state: expected `400`
- MCP initialize/tools-list: passed with `42` visible tools
- `project_detail`: visible

Authenticated `GET /experimental/capabilities` returned:

```text
backgroundSubagents: false
```

No background canary was admitted. Synchronous Task remained the only
supported execution mode.

## Docker cleanup outcome

The final Docker cleanup Task was cancelled before it returned evidence.
Container-removal outcome is **unknown**.

Stable signature:

| Field | Value |
|---|---|
| Code | `TASK_CANCELLED` |
| Tool family | existing Premium Task / Docker Compose cleanup |
| First path | exact Compose project `ingenium` cleanup |
| Attempt | one cancelled call |
| New evidence | no result returned |
| Owner | receiving orchestrator |
| Next work | read-only Docker/Compose label inventory before any further removal |

Do not assume containers were removed. If cleanup is resumed, first inventory
exact Compose ownership, then remove only remaining `ingenium` project
containers with `docker compose down --remove-orphans`. Preserve volumes,
images, build cache, `.env`, protected credentials, and unrelated containers.

## Credential and recovery state

### Owner recovery

The corrected helper ran once from committed source `452fab4e` and returned
recovery `204`. It installed the recovered active owner's login fields into the
ignored owner-owned `.env` file.

- `.env` mode: `0600`
- `.env` currently contains protected owner login fields as the sole
  recoverable owner access.
- Never print, commit, copy into chat, or delete those fields until an encrypted
  provider or another verified protected replacement exists.
- The recovered owner is not the provider-fixed
  `bootstrap-admin@localhost` account.

### Host MCP reset

One explicit-secret `ingenium-coordination-reset reset` ran after owner
recovery and failed conclusively at `credential_issue`. It was not retried.

Confirmed root cause:

| Binding | Value |
|---|---|
| Existing workspace ID | `shared-memory-ingenium` |
| Existing storage path | `/home/brajam/repos/ingenium` |
| Existing status | `authorized` |
| Existing runtime | one runtime, state `READY` |
| Requested host worktree | `/home/james/repos/ingenium` |

The API rejected reuse of one workspace ID for two exact storage mappings.
`packages/ingenium-core/lib/tools/mcp-credentials.ts` rejects that mismatch,
the API converts it to `422 VALIDATION_ERROR`, and coordination reset reports
`credential_issue`.

Current credential metadata:

- `.opencode/.ingenium-mcp-credential`: absent
- `.opencode/.ingenium-coordination-owner-provider.json`: absent
- reset lock: absent
- last known outbox: `34` valid authentication failures, zero ambiguous
- no manual outbox replay occurred

## Interrupted build state

The extension build-output repair Task was interrupted. Its outcome is unknown.

Before the latest scope correction, verification reported:

- focused coordination-reset test: failed because `workspaceId` was out of
  scope;
- extension typecheck: failed for the same cause;
- extension build: rejected the existing `dist` directory because it was not
  owner-controlled;
- agent/documentation-config validation: passed;
- `git diff --check`: passed.

The source scope error was then corrected, but no tests or build were run after
that correction. The interrupted build Task may have inspected or changed
generated `packages/ingenium-extension/dist`; do not assume its current state.

Stable signature:

| Field | Value |
|---|---|
| Code | `TOOL_EXECUTION_INTERRUPTED` |
| Tool family | existing Premium Task / extension build |
| First path | generated `packages/ingenium-extension/dist` ownership repair |
| Attempt | one interrupted call |
| New evidence | no result returned |
| Owner | receiving orchestrator |
| Next work | inspect Git and generated-output metadata before any clean/build replay |

## Parent recovery boundary

Last known host parent metadata:

- PID: `166234`
- Start time: `Tue Sep 15 22:44:06 2026`
- Parent was not signalled or restarted.
- Parent still has its previously loaded configuration.

No fresh replacement-first recovery admission was completed. Restart remains
forbidden until current retained proof establishes all of:

- exact project/workspace/worktree/storage binding;
- fresh nonce and enrollment;
- durable typed handoff;
- external supervisor ownership and health;
- replacement health on current merged source;
- reconnect and full Todo replay;
- rollback or explicitly authorized adoption;
- newer fence/incarnation and split-brain rejection.

## Exact resume order

1. Read this file, [`AGENTS.md`](AGENTS.md), the active orchestrator profile,
   and the relevant current roadmap section.
2. Reconcile `TodoWrite` with this stopped state. Do not replace the existing
   roadmap/Todo scope.
3. Read-only inspect:
   - Git status/diff/log;
   - the three task-owned uncommitted paths;
   - generated extension `dist` ownership/tracked/ignored state;
   - exact Docker/Compose container ownership;
   - host MCP target/provider/reset-lock metadata;
   - parent PID/start identity;
   - outbox count/status without replay.
4. If containers remain and cleanup is still requested, remove only exact
   `ingenium` project containers. Do not remove volumes or images.
5. Run the directly affected coordination-reset test and extension typecheck.
6. If `dist` is wholly ignored/generated and unsafe, use the package-supported
   clean path or remove only that generated directory, then rebuild the
   extension as the current owner. Never recursively change source ownership.
7. Confirm the built reset artifact propagates the configured host workspace.
8. Run the declared bounded QA and current-diff security reports for the
   workspace-binding change. Do not rerun earlier helper reviewers.
9. If checks pass, commit and push only:
   - `packages/ingenium-extension/coordination-reset.ts`
   - `packages/ingenium-extension/coordination-reset.test.ts`
   - `opencode.json`
10. The prior reset failure was conclusive. A new reset is permitted only after
    the workspace source/config fix is verified and built. Consume the protected
    `.env` owner login through a mode-`0600` descriptor/file without output.
11. Verify the resulting host MCP credential, initialize/list tools, then call
    only read-only coordination status and typed-memory interfaces.
12. Run a fresh mutation-free replacement-first recovery preflight. Do not
    signal the parent unless every admission field passes.
13. Append current operational evidence to
    [`docs/reference/ROADMAP.md`](docs/reference/ROADMAP.md), run only the
    declared minimum validation, then commit and push the evidence boundary.

## Evidence boundaries

- Source tests prove checked source behavior only.
- Built artifacts prove package output only.
- Deployed route/MCP checks prove the running container only.
- Recovery preflight proves admission fields only; it does not authorize a
  restart.
- Actual replacement/session/Todo replay is still absent.

No credential value, token, password, encrypted blob, transcript, reasoning,
or protected outbox payload is included in this handoff.
