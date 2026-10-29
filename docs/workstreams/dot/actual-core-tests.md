# Central actual-core binding tests

Source: `services/ingenium-api/tests/veyra-dot-actual-core.test.ts`. This worker writes the suite only. No actual-core suite, file-backed fixture, provider, process runner, model, server or build was started here.

## Missing shared hook and activation order

Apply/review the checkpoint guard from `core-scheduler-insertion.patch` centrally. The suite first tests the real `getDb` singleton, WAL mode, actual `execTransaction`/nested savepoints and 50 `checkpointAfterWrite` calls while a real write transaction is open. It invokes the actual SQLite pragma delegate under observation; it does not stub checkpoint behavior. Before the shared fix, that prerequisite fails at the native WAL-lock boundary. A failed prerequisite stops the suite before it constructs a `deferred-by-core-v1` adapter. The production policy remains inactive until the coordinator's actual checks pass and activation is separately wired.

No core API, database resolver or `:memory:` fallback is changed. `resolveCoreDbPath(':memory:')` resolves a physical path in current core, so the central runner must provide one fresh file fixture under the existing approved task root.

## Central fixture lease

The coordinator has accepted ownership of fixture allocation, reserve checks and measured cleanup. Before running, create exactly one unique mode-0700 directory `actual-core-test-<nonce>` immediately under:

`/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/veyra-phase-1/coordination/dot`

Create an empty, exclusive, mode-0600 `core.sqlite` and a mode-0600 `lease.json` there. The lease fields are:

```json
{
  "ownerThread": "01a188fc-d3ed-7dc2-ab95-e0eed8a793ec",
  "consumer": "veyra-dot-actual-core.test.ts",
  "database": "<exact canonical fixture directory>/core.sqlite",
  "outputRoot": "/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/veyra-phase-1/coordination/dot",
  "fresh": true
}
```

Use the central lease's fresh Windows/destination reserve and combined-ceiling checks; estimated fixture peak is at most 64 MiB, with no dependency/build tree. This is an estimate, not an allocation or permission to exceed the existing ceiling. Refuse an unsafe stage. The suite refuses nonempty files, hardlinks, symlinks, wrong ownership/modes, an unregistered path or another volume. It creates no fixture directory and never selects a production database itself. No silent `/tmp`, C:/D:/F: or `:memory:` fallback exists.

From the exact integrated coordinator checkout, set process-scoped `VEYRA_DOT_CORE_TEST_DB` to the fresh database path. Set TEMP/TMP/TMPDIR under the same assigned root and use the already retained matching Vitest dependencies. Run only:

```sh
node node_modules/vitest/vitest.mjs run \
  --config services/ingenium-api/vitest.config.ts \
  services/ingenium-api/tests/veyra-dot-actual-core.test.ts \
  --maxWorkers=1 --fileParallelism=false
```

The suite is opt-in; without `VEYRA_DOT_CORE_TEST_DB` it is skipped. Central acceptance must record zero skipped cases for this file. No worker executed this command or loaded the actual core/native dependency to produce a result.

## Meaningful coverage

- Existing core singleton connection and real WAL database, not an alternate SQLite writer.
- Genuine user, organization/project membership and automation service-principal grants using real core APIs and fixture database rows. No compatibility principal or mocked `startJobRun`/grant evaluator.
- Real `startJobRun` at an exactly primed 50-write checkpoint boundary, commit-before-launch and persisted Dot/core identities.
- Real core claim/Dot operation/cursor rollback after a deliberate operation-persistence failure at that threshold.
- Real grant denial before claim, grant revision revocation after commit and project membership revocation after commit.
- Explicit source/memory/binding/generation eligibility rechecks through injected domain ports; these domain ports are fixture policy inputs, not proof of the final cross-stream policy implementation.
- Uncertain launcher result preserves one real core run and cannot replay it.
- Closing/reopening the actual core connection retains the same durable operation, rejects the old connection and recovers without another launch.
- Actual owner/membership denial and no inferred external-message capability.

The launcher is a spy that checks the real committed core/Dot rows; it never starts an agent process. Physical process cancellation/native/WSL/cluster/device acceptance remains a coordinator gate.

## Cleanup ownership

Only the central runner creates this fixture and grants the lease. The suite closes the actual singleton, restores its process environment and prints a measured inventory plus `consumerDone:true` and `databaseClosed:true`. It does not delete a caller-supplied database. The central lease owner must then perform the declared containment/source/evidence/process/container/mount checks, remove eligible DB/WAL/SHM/lease files and the empty task-owned directory, and record exact paths/bytes. Keep only minimal test/first-failure logs and source recipes. A failed safety check protects that exact target and must be reported immediately; do not retry through another alias/tool or stop a workload. The cleanup handoff is a required stage of the already accepted central lease, not an optional user task.
