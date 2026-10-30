# Existing runner settlement seam proposal

This is an **unapplied source proposal** for the coordinator. Shared `services/ingenium-api/lib/job-runner.ts` is unchanged. The full Dot/Veyra goal remains open.

## Apply and reproduce

The exact preimage SHA-256, patch SHA-256 and helper SHA-256 are in `settlement-proposal.json`. The worker original and coordinator runner matched preimage `d88145f2402c91c591d28a46d1a75ba00a290d8f5c8478968c0619daa49680c4` at inspection. Root must recheck its current file before applying:

```sh
sha256sum services/ingenium-api/lib/job-runner.ts
git apply --unidiff-zero --check docs/workstreams/dot/job-runner-settlement.patch
/home/brajam/.local/bin/node --test docs/workstreams/dot/settlement-proposal.cpu.mjs
# Coordinator only, after review within its shared-writer scope:
git apply --unidiff-zero docs/workstreams/dot/job-runner-settlement.patch
```

The proposal test expects the unchanged preimage, reconstructs the patch **only in memory**, and runs the proposed export together with the existing identity/group verifier. Run it before applying the patch. After application, the same cases must be ported into the central runner lifecycle suite; its preimage guard intentionally refuses to silently test a changed runner. `settlement-seam.proposal.ts` is the exact helper excerpt for review; the test verifies its hash against the helper extracted from the patch. The patch uses valid zero-context unified hunks to avoid whitespace-only context lines in the saved artifact; use the explicit `--unidiff-zero` flag after verifying the pinned preimage. The authoritative complete edit is `job-runner-settlement.patch`.

## Evidence gap and minimal lifecycle changes

Currently `runProjects` disappears on leader finalization, and successful `verifyOwnedGroupTeardown` deletes the only owned-group record. An absent map entry therefore cannot distinguish proven retirement from a restart, missing initial ownership, or unavailable inspection. A terminal core JobRun status cannot make that distinction either.

The patch extends the **existing** `OwnedDetachedRun` record with captured `projectId`, `jobId`, and an optional positive `retiredAt` marker. Both live spawn and existing trusted recovery capture the actual project/job. Only the existing complete empty-group verifier, or the existing signal path after the same verifier returns empty, writes retirement. There is no second registry, process scanner, database schema, persisted receipt, scheduler or recovery timer.

A retired record retains the captured leader/process-group/session/start/executable/nonce identity and exact project/run/job binding; descendant maps and diagnostic history are cleared. Existing pending getters, signal/recovery callbacks and ambiguity checks use `pendingDetachedRun`, preserving their former behavior when verified teardown removed an entry. Retired groups cannot be signalled again, re-cleaned through stale verifier continuations, or scheduled for group recovery. The testing diagnostic remains a diagnostic; the production export does not call it or infer authority from its events.

Retention trims old eligible positive receipts to 256 in the same existing map. Lifecycle-pending receipts are protected until a later retirement can trim them; unresolved ownership is never evicted. No additional timer is introduced. Eviction and controller restart produce **unknown**, not settled. This deliberately does not solve durable platform restart proof or authorize another scanner/store.

## Production export contract

`inspectOwnedJobRun(projectId, runId)` returns only `{state, reason}`. Callers must independently authorize the request and qualify the execution placement before calling it. It compares the captured project/run/job against the actual core run and checks conflicting `runProjects` ownership. It exposes no nonce, process metadata, credentials or diagnostic history.

- **active**: the existing group verifier currently proves trusted live members. A missing leader handle with validated descendants still cannot become settled.
- **settled**: a positive existing-owner retirement receipt exists and all existing child-close, group-recovery and escalation/termination lifecycle gates have cleared.
- **unknown**: missing capture/receipt, foreign or replaced binding, missing initial leader identity, unreadable/recycled/foreign members, empty read-side observation without owner retirement, pending escalation, receipt eviction, unsupported platform, or controller restart without retained evidence.

The export reads the existing ownership verifier; it does not initiate cancellation, retire a group, delete vault files, or infer permission. Missing `runningProcesses`, successful `killRunProcess`, optimistic DB cancellation and leader close alone are never positive settlement proof.

For Dot's qualified runner adapter, map `inspection.state` directly to its active/settled/unknown contract only after independently confirming execution placement. Do not manufacture settled from any reason code or a terminal DB row. Read-side group revalidation updates the same existing observations/diagnostics as the current runner; it adds no process scanner or process-control action.

## Validation and remaining gates

14/14 dependency-free model-free tests pass, zero skips. The test applies the actual unified diff in memory, parses the whole proposed TypeScript with Node's built-in stripper, and executes the exact proposed functions plus the existing identity verifier against closed fake ownership maps and inspector data. It never imports the runner, starts a process/timer, sends a signal, accesses a live DB, builds, installs or loads a model.

Cases cover missing map plus cancelled DB, live descendants after leader disappearance, unavailable initial leader, unreadable/foreign/recycled identity, every escalation owner, empty read-side observation, positive retirement behind every lifecycle gate, compact exact ownership, stale continuations, foreign/replaced run/job/project, restart unknown, trusted existing recovery, and bounded eligible retention with protected pending evidence.

Root must still review/apply the proposal, run integrated API types and the full existing runner lifecycle suite, and test actual owned process-group cancellation/descendant teardown and restart behavior on the qualified platform. The model tests do not exercise real asynchronous close/escalation scheduling or establish kernel/process acceptance. A process that escaped the existing owned-group authority is outside the new export's proof; the proposal adds no authority beyond the existing verifier.

## Output ownership and cleanup

Owner: Dot worker `01a18935-103f-7432-98b0-cd2c51f8c8ab`. All proposal source remains beneath the existing authorized C-backed WSL task root `/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845`, in this checkout's `docs/workstreams/dot`. No new output root, dependency, build, cache, temp, process fixture or log file was created. The patch, helper excerpt, test, manifest and this note are durable source for coordinator review/integration; their consumer ends when the proposal is integrated or superseded in version control. No disposable output paths or removed bytes exist for this follow-on. No Linux or Windows disk recovery is claimed. Protected source, locks, runtime/vault data and central test fixtures are untouched.
