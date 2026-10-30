# Veyra Dot and automation integration slice

Status: implemented source slice, pending coordinator integration/acceptance. This does not close F46/F47/F48, a delivery phase or the full release goal. The existing 74 dispositions, 47 visual baselines, 20 Settings categories and 11 Windows rows remain intact.

## Behavior

Dot stores inspectable suggestions separately from explicitly approved follow-ups. Each suggestion carries source provenance, exact owner/org/project/conversation/execution scope, capabilities, expiry and a compare-and-swap revision. Approval binds an already authorized task template with the same prompt and scope. A suggestion does not create a job or start work. `collectProactiveSuggestions` consumes explicitly enabled, scope-authorized API source adapters; it checks authorization before discovery, rechecks source/memory policy, and persists a stable source identity. Repeated events and service reconstruction reuse the suggestion, including its dismissed state. Changed content for an unchanged source revision is a conflict. It starts no timer, model call or extraction. One live follow-up owns a job; no existing template is silently enabled, changed or broadened.

The workspace component shows suggestions, review/schedule controls, follow-ups, pause/resume/cancel, operation history, the existing event queue and internal notifications. It takes authenticated initial data and Server Actions from its host. It remounts on exact scope change and requires status refresh after a transport-unknown mutation. The component is not wired to a route in this branch; no empty fixture is presented as live production data.

Schedules support once at canonical UTC time, fixed UTC intervals, and daily/weekday calendar times with explicit timezone and fold choice (first, second or both). Nonexistent spring-forward wall times have no occurrence. Policies skip overdue runs, coalesce to latest, or catch up one occurrence per existing singleton scheduler tick. Known core capacity rejection keeps the occurrence/cursor and can be re-admitted; unknown outcomes, authorization failures, changed bindings and already-claimed occurrences never blindly replay. A window over eight days or over 100 due occurrences fails without changing its cursor: the explicit “Skip missed runs” action records the entire skipped range and advances only after current revision/authorization checks. It preserves active runs and pause state. Pause retains the cursor and resumes under the chosen missed-run policy.

Cancellation persists intent before calling the existing owned-run cancellation path. A request remains pending while the runner is active or its outcome is unknown. Reconstructing the service reconciles the original run identity; it never invents a replacement run. Existing startup recovery remains responsible for actual processes and interrupted runs.

Notifications are persisted internal inbox entries, deduplicated by operation identity. Successful unchanged heartbeats stay quiet; meaningful changes, failures, blocked execution and unknown outcomes follow the selected notification policy. Reading an inbox entry persists its read state. There is no external notification transport or messaging permission grant in Dot.

## Source map

- `packages/veyra-automation/contracts.d.ts`: type-only adapter proposal; no package install, runtime module or competing shared-contract authority.
- `services/ingenium-api/lib/dot-v2/schedule.ts`: pure due-occurrence policy, no timer.
- `repository.ts` and `schema.sql`: injected API connection/transaction and coordinator migration input. The module never opens a production database.
- `service.ts`: authenticated lifecycle, CAS, source-idempotent admission, explicit missed-run recovery, cancellation recovery and notifications.
- `proactive.ts`: opt-in scoped source consumer with authorization before discovery; no added scheduler or queue.
- `core-binding.ts`: actual core API ports, atomic claim/operation transaction and post-commit launch; see [core-binding.md](core-binding.md) and its coordinator-only scheduler/checkpoint patch.
- `existing-jobs.ts`: existing `jobs.startJobRun(...,"cron",...)` adapter; no process launcher or second queue.
- `commands.ts`, `router.ts`: command/error boundary and injectable Express router, not mounted here.
- `services/ingenium-dashboard/src/app/components/dot-v2/`: workspace and pure view model. No shared shell/context/CSS changes.

No new production environment variables, dependencies, compiler outputs, manifests or lockfile changes are introduced. The optional test-only `VEYRA_DOT_TEST_EXPRESS` points at an existing lock-compatible Express entrypoint for in-process router checks; it does not install, copy or mutate dependencies. The pure test command is below. No API runtime, model, GPU, microphone, desktop or cluster job is started.

## Verification

From this exact checkout with Node 22.23.1:

```sh
export TEMP=/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/veyra-phase-1/coordination/dot
export TMP="$TEMP" TMPDIR="$TEMP"
# Optional read-only existing Express for socket-disabled router checks:
export VEYRA_DOT_TEST_EXPRESS=/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/prd-ui-fixes/node_modules/express/index.js
node --experimental-strip-types --loader ./services/ingenium-api/tests/veyra-dot-loader.mjs --test services/ingenium-api/tests/veyra-dot-*.cpu.mjs services/ingenium-dashboard/tests/veyra-dot-*.cpu.mjs
```

Tests exercise real in-memory SQLite transactions, actual Express dispatch with listening/connect disabled, injected core savepoint/claim/launch contracts, DST in Toronto and Lord Howe, missed-run policy/bounds, approval and scope isolation, memory revocation, job revisions/capabilities, persisted cancellation intent, unknown outcomes, notification deduplication/read state, pause/resume, capacity rejection and atomic rollback. A disk reopen fixture runs only when every process descriptor can be inspected before generation; otherwise it reports a cleanup-safety skip and creates no artifact. This is CPU/source evidence, not real runner, HTTP, visual or release acceptance.

Initial run: five schedule tests passed; service import failed because strip-only Node cannot transform TypeScript parameter properties. Explicit erasable fields repaired it. Next runs passed 11/11 then 22/22 tests. The latter closed/reopened a real test SQLite file; it was removed at 20,480 measured bytes. Subsequent tests strengthen cleanup preflight; current exact results live in `evidence.json` and the assigned coordination status.

## Required integration

Follow [integration.md](integration.md). The coordinator alone allocates migration numbering, mounts routers, binds existing auth/session/CSRF/policy, changes scheduler selection, compiles the merged source and performs visual/native/cluster acceptance. Projectless execution is deliberately unavailable in the current core-job adapter; never map it to a synthetic global project. Scheduling remains inactive until those bindings pass.

Request composition and remaining owner contracts: [request-binding.md](request-binding.md).
