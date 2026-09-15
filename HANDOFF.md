# Ingenium Rollout Handoff — 2026-09-14

> **Transfer requested:** 2026-09-14. The current old-computer orchestrator
> must commit only `HANDOFF.md` and non-force push the current branch now. The
> new computer fetches that pushed commit. This handoff/transfer work changes no
> source or runtime; no delegation/spawn, other-file edit, Docs Workspace
> mutation, recovery/runtime/deployment command, or further rollout work is
> part of this correction.

## Scope and terminal boundary

- **IN_SCOPE:** this file, `HANDOFF.md`, only.
- **OUT_OF_SCOPE:** every other file or action, including source/test changes,
  Docs Workspace operations, runtime or deployment operations, recovery,
  and delegation/spawn. The single-file handoff commit and non-force push are
  the required transfer checkpoint, not a source or runtime change.
- **Changed file:** `HANDOFF.md` only. No `docs/**/*.md` canonical document is
  directly affected; this root handoff is the explicitly user-requested
  transfer artifact.
- **Deployment owner:** `N/A` for this handoff-only turn.
- **Verification:** Markdown/readback/link-path sanity only; no source/runtime
  tests.
- **This turn's STOP_CONDITION:** the final draft is present at the requested
  path and one readback self-check confirms its path, content, repository-link
  paths, and no-secret safety. This does **not** complete the rollout.
- The commit containing only `HANDOFF.md` is the transfer checkpoint. It will
  be newer than `f6fbb3802f88c9435b74ce2ecb73c445a31aaf16`, while
  `f6fbb3802f88c9435b74ce2ecb73c445a31aaf16` remains the last
  source/runtime-impacting commit.
- The one documentation audit for this handoff is final and must not be rerun.

## Authority and required startup

Before continuing on another computer, read the repository authority and the
full execution board:

- [`AGENTS.md`](AGENTS.md)
- [`ingenium-orchestrator.md`](.opencode/agents/primary/ingenium-orchestrator.md)
- [`docs/reference/ROADMAP.md`](docs/reference/ROADMAP.md)

Load all required skills before acting: `development-conventions`,
`devops-conventions`, `skill-maintenance`, `mcp-tooling`, `documentation`,
`security-audit`, `self-learning`, `database-conventions`, and `ponytail`.
Repository skill references include [`development-conventions`](.opencode/skills/development-conventions/SKILL.md),
[`documentation`](.opencode/skills/documentation/SKILL.md),
[`mcp-tooling`](.opencode/skills/mcp-tooling/SKILL.md),
[`security-audit`](.opencode/skills/security-audit/SKILL.md),
[`self-learning`](.opencode/skills/self-learning/SKILL.md),
[`database-conventions`](.opencode/skills/database-conventions/SKILL.md),
and [`ponytail`](packages/ingenium-extension/ponytail/skills/ponytail/SKILL.md).
The configured `devops-conventions` and `skill-maintenance` skills are also
required; do not substitute a missing or stale local copy.

The coordinator never edits source. Preserve the append-only roadmap and
master `TodoWrite`; do not delete, renumber, replace, or silently close prior
Todos. Every new task or phase needs a strict contract naming `IN_SCOPE`,
`OUT_OF_SCOPE`, acceptance criteria, `STOP_CONDITION`, verification plan,
deployment owner where applicable, and escalation rule. Preserve stable IDs,
unknown outcomes, first failures, exclusive writer territories, and the
source-test/deployed/model-session evidence boundary. Never infer
`global-default` for a missing project.

[`ROADMAP.md`](docs/reference/ROADMAP.md) remains authoritative and append-only;
it is not superseded. It contains historical/current-looking `b839e480` and
dirty-`opencode.json` markers that are inconsistent with the actual clean
`f6fbb380` Git state. Treat those entries as unreconciled/stale evidence, not
as a reason to rewrite the board. Trust the actual fetched Git state for source
identity, and require the fresh agent to append a reconciliation before any
completion claim.

## Repository transfer baseline

The following is the recorded state **before the HANDOFF commit**:

| Field | Recorded value |
|---|---|
| Project | `ingenium` |
| Workspace | `shared-memory-ingenium` |
| Canonical old-computer worktree | `/home/brajam/repos/ingenium` |
| Branch | `context-upload-hardening-opencode-1.18.9` |
| Clean base HEAD | `f6fbb3802f88c9435b74ce2ecb73c445a31aaf16` |
| Working-tree state before this file | clean |
| Relation to origin at the audit time | synchronized `0/0`; not ahead by 2 |
| Last source/runtime-impacting commit | `f6fbb3802f88c9435b74ce2ecb73c445a31aaf16` |

After this file is created, the only intended dirty path is `HANDOFF.md`. No
other path is authorized. The current old-computer orchestrator must make the
newer single-file HANDOFF commit and non-force push of the current branch; the
new computer then fetches that pushed commit. The newer documentation commit
must not be mistaken for a source or runtime change: the source/runtime base
stays at `f6fbb380`.

## Adopted continuation agent mapping

Use this adopted mapping for continuation, subject to a fresh read-only check
of the new computer's authoritative root map and profile grants:

| Role | Model / variant |
|---|---|
| `ingenium-explore` | `openai/gpt-5.6-luna` / `max` |
| `ingenium-software-engineer-fast` | `openai/gpt-5.6-luna` / `max` |
| `ingenium-software-engineer-premium` | `openai/gpt-5.6-sol` / `xhigh` |
| `ingenium-recovery-engineer` | `openai/gpt-5.6-sol` / `xhigh` |
| `ingenium-orchestrator` | `openai/gpt-5.6-sol` / `xhigh` |
| `ingenium-security-auditor` | `openai/gpt-6-astra` / `max` |

`browser-agent` is removed. Never route it, mention it as active, or substitute
it, including for website retrieval.

## Historical old-computer process and session identity

Every identity in this section is **historical old-computer metadata**. None
may be reused or treated as proof on the new computer.

| Identity field | Historical value |
|---|---|
| Parent PID | `8618` |
| Parent start ticks | `12122` |
| Parent executable | `/home/brajam/.opencode/bin/opencode` |
| Root session | `ses_f9bb821c0ffeUa4loCXV7iXDf0` |
| Old PID check | PID `2046336` was absent |
| Enrollment | legacy unenrolled; no nonce |

The transfer marker bound the following content-free identity tuple: session
`ses_f9bb821c0ffeUa4loCXV7iXDf0`, PID `8618`, start ticks `12122`, source
`f6fbb3802f88c9435b74ce2ecb73c445a31aaf16`, project `ingenium`, API project ID
`b4c1feae-1bf3-4c69-a171-c6dea5a96d92`, workspace
`shared-memory-ingenium`, canonical worktree `/home/brajam/repos/ingenium`, and
storage mapping hash
`7f974be496b11344a6cf803cf224260dd16117841c32f8633ba3943fd7bea31d`.

These values **must not** be reused on a new computer. Obtain a fresh
canonical worktree, session, PID, start ticks, storage mapping, enrollment,
nonce, claims/fence, and typed handoff, all bound to the actual new project
and workspace.

### Project-ID namespace distinction

- The observed OpenCode session `project_id` was
  `ce0bd83b12c1bacf4e4f3a0510376e9bf47559c2`.
- The Ingenium API project ID and transfer marker value is
  `b4c1feae-1bf3-4c69-a171-c6dea5a96d92`.
- These are different namespaces. The current source does not compare them in
  the SQL binding path.

## Historical old-computer deployment evidence

> **Historical only.** The following proves the old-computer f6 deployment
> boundary as recorded there. It proves nothing about a deployment, process,
> route, MCP session, or model session on the new computer.

| Evidence | Historical value/result |
|---|---|
| Container | `45cd10670697201a92b2ef5e9da9e854496af838eaaa53e8b1f344601453ecce` |
| Image | `sha256:8422f0a1b73b573b06e8f3a9b0c1d539a1c7694a19a72b97c467197eb9327c4c` |
| OCI revision/source | exact f6; `https://github.com/jtmb/ingenium` |
| Runtime | healthy; nine required Supervisor processes running |
| Routes | API, dashboard, Web, and CLI `200`; VS Code `302` |
| MCP | initialize, tools list `42`, and `project_detail` passed |
| Parent | preserved |
| Host receipt | `/home/brajam/.local/state/ingenium-build-install-7e35b6ff-a3d0-4c98-b7bb-4c0ae6833943.json` |
| Receipt SHA-256 | `ccc1683e078a608b09676c856705d2d329820efba3dcf261c08557e86811d355` |
| Launcher hash: build | `c8873a5cb9162118570b03734fddce8ee57221d220db4d751facdce8a0fdad0a` |
| Launcher hash: OpenCode | `0aa788efc8861754c0a6111d5187b1ddb896cefeae0f1688a3bacda9af77a623` |
| Launcher mode | `0500` |
| Rollback tag | `ingenium-ingenium:rollback-3a5d081d62da8497955a629c58bbd832fc7f3fd9` |
| Rollback image | `sha256:cee650e2fa7506ad8e9a5f2d04d7c53b36f8075ef89f9aab6acec3d0acdef3f6` |

No row above is new-computer deployment proof. Do not reuse the old container,
image, receipt, launcher identity, parent, or runtime result as a fresh gate.

## Source commit chain and f6 boundary

The relevant source history, oldest to newest, is:

| Commit | Purpose |
|---|---|
| `766f3626` | automatic legacy-parent replacement bootstrap |
| `ea396007` | exact session binding and non-destructive overflow quarantine |
| `e9c04392` | bootstrap-only revoked credential replacement |
| `1e7ebc8d` | attested mutation-free recovery-preflight command |
| `3ff7f63b` | bounded legacy capture removing the 97.8 MB export |
| `2f81ed11` | split Todo-owner/current-assistant joins and exit propagation |
| `3a5d081d` | one bounded `429` retry |
| `f6fbb380` | recovery retry cap aligned to the API fixed 60-second window |

### f6 source proof

Only [`recovery-bootstrap.js`](packages/ingenium-extension/scripts/recovery-bootstrap.js)
and [`recovery-pre-admission.test.ts`](packages/ingenium-extension/recovery-pre-admission.test.ts)
changed for f6. Retained focused evidence is:

- recovery test: `155` passed;
- extension typecheck: passed;
- Node syntax check: passed;
- Git diff check: passed.

The f6 behavior accepts one delta `Retry-After` retry for `27` or `60` seconds,
rejects `61`, malformed values, non-`429` responses, and a second `429`, and
keeps the request and credential identity unchanged across the retry. This is
source/test proof only; it is not new-computer deployment or model/session
proof.

## Recovery-preflight timeline

1. **Before f6, historical live observation:**
   `/api/v1/auth/preflight` returned `429` with `Retry-After: 27`, limit `100`,
   and remaining `0`. The old cap of `2` caused rejection.
2. **After f6, historical exact installed-preflight run:** it executed once,
   exited `0`, emitted empty stderr, performed no retry, and reported
   `mutationFree: true`. Its generic manifest still reported status
   `rejected`, `admissible: false`, decision `reject`, `nextOperation: null`,
   and all identity sections `null`.

Do not rerun that preflight without a causal change. The preflight task ID is
`ses_f5e7cb993ffeg1dFIR4UA5krDZ`.

## Diagnostics and unresolved capture cause

### Staged diagnostic

Task `ses_f5e7809d9ffeuNr3R6gkuBTGlH` recorded an ancestry pass with PID/start
hash
`4026ea76785e05e1daa63d7b71edfc029d0992666a411aa905d28fab810adfa4`.
Its custom harness reported an empty record set with hash
`4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`.
The error/function name emitted by that harness was not in current source; do
not treat it as a current emitted-code diagnosis.

### Predicate matrix

Task `ses_f5e621d4fffefq1zKP860hExBq` later exercised the exact SQL
WHERE/JOIN chain and yielded one row. The latest assistant
working/orchestrator/model/provider was valid; the completed Todo owner had
the exact pending marker and handoff. There is no zeroing SQL predicate.

### Static current-source trace

Task `ses_f5e56152bffeAAHHb4Z7LUaAhs` traced the current source:

- `captureCurrentRecoveryPreAdmission`: lines `1653–1680` in
  [`recovery-bootstrap.js`](packages/ingenium-extension/scripts/recovery-bootstrap.js);
- `discoverLegacyRecoverySession`: lines `1519–1585` in the same file;
- generic caller failure: lines `2044–2049` in the same file.

The query has no `project_id` predicate. Post-query failure conditions include
schema/parser failure, directory mismatch, Todo marker failure, exact-one
cardinality failure, parent-session failure, process-identity failure, and
mandatory two-query byte-equality failure; all exceptions collapse to `null`.
The most credible unresolved current-source cause is a two-pass
snapshot/process/timing mismatch or a later capture/admission condition, not a
permanent SQL predicate or the `429` rate limit.

### Interrupted exact capture-seam task

The exact current-source capture-seam task was interrupted by the transfer
request and returned `Task cancelled`; it has no task ID or result. Its prompt
was read-only and made no source or runtime mutation. Treat the outcome as
unknown and reconcile it before any replay.

## Stable failure signatures

These signatures are content-free and retain the first failure. A same
signature with no new evidence forbids repeat research.

| Code | Tool/session boundary | Attempts | Next work |
|---|---|---|---|
| `RECOVERY_PREPARATION_CAPTURE_UNAVAILABLE` | current recovery bootstrap; root session; current pre-admission | managed preflight, custom staged harness, predicate matrix, and static trace | exact current-source capture reconciliation |
| `TASK_CANCELLED` | task / unknown child; first path `exact-current-source-capture`; no result or task ID | no replay | fresh agent owner reconciles the outcome before capture replay |

Do not hide an unknown, partial, cancelled, or transport-aborted result behind
`PASS`, and do not retry the same tool family merely with changed arguments,
project, or query.

## Recovery safety contract

- Replacement-first only: never signal, stop, retire, or otherwise dispose of
  the old/current parent first.
- The parent recovery/relaunch cancellation recorded in the 2026-09-13
  `ROADMAP.md` checkpoint remains authoritative. This transfer request
  authorizes only the handoff commit/push; it does not supersede that
  cancellation. On the new computer, resume recovery, relaunch, restart,
  preparation, or parent signaling only after a later explicit user
  authorization. Until then, keep recovery frozen and limit work to permitted
  read-only reconciliation.
- Preflight is read-only and never authorizes a restart. `recovery-prepare`
  requires an admitted manifest.
- Restart proof requires **all** of: fresh nonce/enrollment; durable typed
  handoff; independently attested external supervisor ownership; replacement
  health on the current source; reconnect/resume; rollback/adoption; and a
  newer fence with split-brain rejection.
- No bootstrap cycle is valid. A changed installer, profile, command, plugin,
  or instruction cannot be its own sole verifier, authorizer, or restart path.
- Do not mutate the database directly or call mutation REST endpoints. Use the
  authorized Git → extension resource-sync → MCP → authenticated API boundary.
- Never replay an operation with an unknown outcome.

Only the standard five escalation conditions are allowed: configured external
credential/access remains unavailable after the configured path is attempted;
a destructive or irreversible action lacks authorization; a mutually exclusive
product decision is required; the requirement is genuinely ambiguous; or
bounded diagnosis cannot establish a reproducible root cause. An ordinary
failed check, internal denial, stale historical proof, or open runtime gate is
not escalation by itself.

## Protected state metadata

This section records metadata only; it does not reproduce protected outbox
records, payloads, transcripts, or dispositions.

- Last validated logical outbox count: `202` records.
- Later read-only filesystem entry count: `226`; this is not equivalent to the
  logical-record count and neither count authorizes replay or mutation.
- Both counts are historical metadata requiring fresh read-only reconciliation
  on the new computer.
- Identityless overflow aggregate: count `11617`; `ambiguousCount: 1`.
- Fenced quarantine key:
  `098781a9c6484288bd5f9d9a0cba6b049d3c8a2f15b023b56d5ccc08237bafd0`.
- Fenced record SHA-256:
  `28982c8f4916169e1fc3a046bb87155488b3bbde07264850429849fc5ad30dbb`.

Retain and fence this state. Never replay, delete, abandon, or assign a
disposition without separate authorization for the exact protected state.
Relevant protected paths are:

- `.opencode/protected-runtime-index/tui-recovery/`
- `.opencode/protected-runtime-index/production-restart/state.json`
- `.opencode/protected-runtime-index/coordination-outbox/`
- `.opencode/protected-runtime-index/coordination-outbox-dispositions/`

The old-computer last inspection found no preparation, admission, rollback, or
freeze artifact. The recovery owner was not-found/inactive/dead with
`MainPID=0`. These are historical observations; re-read the paths read-only on
the new computer.

## Credential metadata

- Protected credential file: `.opencode/.ingenium-mcp-credential`, mode `0600`.
  Never print or copy its value.
- Revoked old credential ID: `3f8bd87d-b038-4109-a4b4-8e376f568f34`.
- Active replacement credential ID: `46286360-0d20-48e9-9704-5d6fa65f24ce`.
- Active replacement expiry: `2026-10-10T02:51:53.033Z`.
- T54 remains `BLOCKED_EXTERNAL_CREDENTIAL`; evidence is
  `tests/artifacts/manual/t54-protected-vault-canary-20260913T040105Z.json`.

Do not ask again for any credential already configured. No credential value,
passphrase, token, endpoint, webhook value, or protected payload belongs in a
handoff.

## Open work and Todo position

The following is the concise exhaustive open-marker inventory read from the
current append-only [`ROADMAP.md`](docs/reference/ROADMAP.md). A retained
source/test/deployment/review result is evidence only; it is not authoritative
marker closure. The receiving agent must reconcile the markers against the
fresh Git, Todo, claim, status, and outbox state and must not skip them.

| Marker set | Still-open boundary |
|---|---|
| Restored items **1–23** | **1** baseline reconciliation; **2** policy/validator/continuation/activation; **3** `OPENCODE-100` planned feature; **4** reminder/coordination activation; **5** `RECOVERY-100`–`RECOVERY-102` recovery/access; **6** verifier readiness; **7** `AGENT-100` regression; **8** `R08` focused validator; **9** `R09`/compiled refresh; **10** `COORD-RESET-100` and recovery reset reconciliation; **11** `MCP-107` live cause; **12** `AGENT-100` lifecycle/activation; **13** `CLOUDFLARE-100`; **14** `PLAYWRIGHT-100` review and remaining gates; **15** `MEMORY-100`; **16** Playwright helper; **17** QA/security and broader rollout; **18** MCP docs/source boundary; **19** deployment; **20** safe recovery/continuation; **21** `MEMORY-100`/`COORD-106`; **22** `VIS-A01`/`VIS-A02`; **23** synthesis and `R23`. Item 1's consolidation and item 3's roadmap addition are only partial boundaries, not whole-feature closure. |
| Current Todos **25–41** | **25** deterministic admission; **26** reconciliation; **27–28** official-guide activation; **29** activation; **30** browser-agent removal; **31** active-reference activation; **32** failure documentation/enforcement; **33** source hook; **34** runtime acceptance; **35** profile activation; **36** Premium activation; **37** runtime enforcement; **38–41** worktree retirement, data preservation, executable verification, and safe activation. Source/static evidence does not close their remaining gates. |
| Current Todos **42–46**, `RESP-FMT-01`, `T-AUX-02` | Local documentation/session evidence is retained, but parent activation and broader rollout remain open; `T-AUX-02` still needs the native background-capability decision/proof. |
| Named roadmap contracts/gates | `BASELINE-100`, `ORCH-100`, `COORD-100`–`COORD-106`, `SKILL-100`, `MCP-107`, `AGENT-100`, `CLOUDFLARE-100`, `PLAYWRIGHT-100`, `MEMORY-100`, `RECOVERY-100`–`RECOVERY-102`, `RUN-A01`, `R08`, `R09`, `R19`, `R20`, `R21`, `R22`, `R23`, `T29`, `T35`, `T36`, and `T41` retain unresolved activation, deployment, runtime, model/session, visual, review, or finalization gates. |
| Linked Todos **47–56** | All remain `OPEN`: **47** Chat Context placement; **48** repository sync; **49** redacted Context import/archive; **50** observation/synthesis; **51** usage; **52** project-local plugin descriptions; **53** persistent managed Playwright configuration; **54** protected credentials/vault; **55** next-steps governance; **56** full acceptance/reconciliation. Evidence recorded for T52/T53 is bounded and does not close either Todo. |
| Linked/finalization Todos **57–62**, **64–65** | **57** exact export/authorized push/webhook; **58** instructional walkthrough; **59** Ponytail review; **60** final documentation audit gate in the roadmap (this handoff's one audit is already final and must not be rerun); **61** artifact-ignore audit; **62** skill maintenance; **64** final visual/product audit; **65** final MCP/recovery/acceptance audit. T58/T61 remain open despite retained evidence; T64/T65 are explicitly `OPEN`. |
| Retained later markers | `T66` and `T67` have source-validation evidence but no authoritative roadmap closure; reconcile them rather than treating accepted evidence as completion. `T63` is complete only for planning; implementation remains unadmitted. `RECOVERY-44`–`RECOVERY-58` remain historical recovery evidence and do not close the recovery boundary. |

The first unfinished recovery phase is the capture reconciliation, not another
managed-preflight replay:

1. Reconcile the cancelled exact current-source capture and identify the
   current `capture`-null cause.
2. Only after a causal change, run one preflight.
3. If the preflight is admitted, run `recovery-prepare` through the recovery
   engineer, then perform the replacement-first production restart and live
   acceptance.

The artifact-local `COORD-1` label is semantically mapped to T65 F4, not a new
canonical roadmap ID. T49/T50/T51/T54/T56/T57/T59/T60/T62 remain covered by the
inventory above; T54 remains blocked by the already-recorded external
credential condition, and its credential must not be requested again. Do not
rewrite historical rows or manufacture new IDs.

## Retained nonblocking follow-ups

These are retained context, not current blockers and not automatic dispatches:

- quarantine continuity from preparation through admission;
- unrelated short root-session Todo rows that can veto discovery;
- imperfect external OpenCode DB subprocess no-mutation evidence;
- the T49 case-variant search exclusion;
- ambient `ESBUILD_BINARY_PATH`;
- `.dockerignore` does not exclude `:memory:`;
- MCP launcher credential-path test/runtime mismatch;
- mail proof unavailable without configured accounts.

Do not turn these follow-ups into new work without an explicit, bounded
contract.

## First action on the new computer

> **Before any runtime, recovery, task replay, or mutation:** fetch and
> checkout the pushed branch containing this handoff checkpoint. Then read
> `HANDOFF.md`, [`AGENTS.md`](AGENTS.md), the
> [`ingenium-orchestrator` profile](.opencode/agents/primary/ingenium-orchestrator.md),
> all required skills, and [`docs/reference/ROADMAP.md`](docs/reference/ROADMAP.md);
> inspect Git status and recent log. Never infer `global-default`.

Continue in this exact order:

1. Check for a later explicit user authorization to resume parent
   recovery/relaunch/restart. This transfer request does not provide it. If it
   is absent, keep recovery frozen and perform only read-only reconciliation;
   do not dispatch preparation, signal a parent, or restart anything.
2. Establish the actual canonical project, workspace, worktree, API binding,
   and storage mapping on the new computer. Inspect protected state read-only.
3. Treat every old PID, session, start tick, runtime, container, image,
   receipt, nonce state, and deployment result above as historical. Obtain
   fresh process/session/PID/start identity, nonce, enrollment, storage
   mapping, claim, fence, and typed handoff.
4. Reconcile the cancelled read-only child outcome with available durable task,
   status, claim, and outbox evidence before any replay. Do not replay an
   unknown operation.
5. Preserve the master Todo and append a new exact `RECOVERY_BIND` and typed
   `RECOVERY_HANDOFF` containing the new identities and current HEAD. Do not
   replace or cancel the master record.
6. Verify supported executor/action/probe/admission rows before any dependent
   mutation. Preserve an independently working verifier and external
   supervisor; do not create a bootstrap cycle.
7. Resume the first unfinished phase: exact current-source capture
   reconciliation. Do not replay the managed preflight without a causal
   change.
8. After a reproducible causal fix, run its focused regression once, make the
   scoped source commit, deploy the current merged source, health-check actual
   routes, and then run one preflight. If admitted, use the recovery engineer
   for `recovery-prepare`, then complete replacement-first restart and live
   acceptance.
9. Keep source tests, old-computer deployment evidence, simulated artifacts,
   deployed canaries, and actual model/session proof distinct. None of the
   historical rows above proves new-computer runtime or model/session
   acceptance.

## Relevant files

Use repository-relative paths for source and policy references:

- [`AGENTS.md`](AGENTS.md)
- [`docs/reference/ROADMAP.md`](docs/reference/ROADMAP.md)
- [`opencode.json`](opencode.json)
- [`.opencode/models.md`](.opencode/models.md)
- [`packages/ingenium-extension/scripts/recovery-bootstrap.js`](packages/ingenium-extension/scripts/recovery-bootstrap.js)
- [`packages/ingenium-extension/recovery-pre-admission.test.ts`](packages/ingenium-extension/recovery-pre-admission.test.ts)
- [`packages/ingenium-extension/scripts/managed-command-wrapper.ts`](packages/ingenium-extension/scripts/managed-command-wrapper.ts)
- [`packages/ingenium-extension/managed-command-wrapper.test.ts`](packages/ingenium-extension/managed-command-wrapper.test.ts)
- [`packages/ingenium-extension/scripts/install-host-build.mjs`](packages/ingenium-extension/scripts/install-host-build.mjs)
- [`packages/ingenium-extension/install-host-build.test.ts`](packages/ingenium-extension/install-host-build.test.ts)
- [`packages/ingenium-extension/scripts/production-restart.ts`](packages/ingenium-extension/scripts/production-restart.ts)
- [`packages/ingenium-extension/coordination-outbox.ts`](packages/ingenium-extension/coordination-outbox.ts)
- [`packages/ingenium-extension/coordination-outbox.test.ts`](packages/ingenium-extension/coordination-outbox.test.ts)
- [`packages/ingenium-core/lib/tools/mcp-credentials.ts`](packages/ingenium-core/lib/tools/mcp-credentials.ts)
- [`packages/ingenium-core/tests/mcp-credentials.test.ts`](packages/ingenium-core/tests/mcp-credentials.test.ts)
- [`services/ingenium-api/lib/routes/auth-preflight.ts`](services/ingenium-api/lib/routes/auth-preflight.ts)
- [`services/ingenium-api/tests/auth-preflight.test.ts`](services/ingenium-api/tests/auth-preflight.test.ts)
- [`tests/coordination/run.ts`](tests/coordination/run.ts)
- [`tests/coordination/harness.ts`](tests/coordination/harness.ts)
- [`tests/coordination/coordination.test.ts`](tests/coordination/coordination.test.ts)

## Git and evidence references

- The HANDOFF commit must contain **only** `HANDOFF.md`.
- The current old-computer orchestrator must now make that single-file commit
  and push the current branch non-force and without amend or history rewrite.
  The new computer fetches the pushed handoff commit.
- The repository-root `:memory:` file remains in branch history since
  `99d39f0d`; do not rewrite that history without explicit authorization.
- Writer-fix task: `ses_f5eb8d453ffeMToOMy4OqMrvKR`.
- Deployment task: `ses_f5ea6cc7dffez16IJSuSRsgdIs`.
- Preflight and diagnostic task IDs are retained above; they are references,
  not permission to replay operations.

Evidence must remain honestly classified:

- **Source proof:** f6's changed-file boundary and retained focused checks.
- **Old deployed proof:** the historical container/image/receipt/route/MCP
  evidence in this handoff.
- **Model/session proof:** fresh new-computer identities, live session behavior,
  restart replay, and Todo replay; this proof is not present here.

No transcript, reasoning, raw Todo payload, protected outbox record, secret,
credential value, or webhook value is included. The commit containing this
file is the transfer checkpoint; `f6fbb380` is the last source/runtime-impacting
commit.
