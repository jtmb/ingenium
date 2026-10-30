# Original Core bootstrap failure custody and actual-source tests

The custody patch is now installed in Root's ACTUAL db.ts. The current test
proposal reads that current file and extracts its declarations and methods via
the TypeScript AST. It does not import `proposal.mjs`, patch a prior preimage,
or use the saved snippets as tested method bodies. Confirmed current SHA256:
`45c69beab1af986b856a9050b47b0123b2e1e7dd39da8bca5d9e2c20113f7b64`.

Root's canonical test copy mapping (two existing-dependency test files only):

| Owned docs source | Canonical target proposal |
| --- | --- |
| bootstrap-failure.test.mjs | packages/ingenium-core/tests/bootstrap-failure.test.mjs |
| actual-bootstrap-source.mjs | packages/ingenium-core/tests/actual-bootstrap-source.mjs |

Both stay adjacent. The canonical test defaults APP to its repository root;
the docs copy requires explicit `VEYRA_SOURCE_APP`. The extraction helper reads
only current db.ts and requires exactly one actual declaration for each named
singleton/state variable, state type and helper/function. Missing, ambiguous or
unparseable actual source refuses execution. It reports the actual source hash
in the TAP result without hardcoding a production-file hash into the canonical
test, so subsequent legitimate edits are tested as current code. Constructor,
filesystem, guard and close faults remain explicit synthetic fixtures. Only the
pending-write counter is seeded to seven after its actual declaration is
extracted, to verify failure cannot falsely reset it.

Current results: **27/27 actual-source extracted checks PASS**; complete CURRENT
actual db.ts strict/noUncheckedIndexedAccess/noEmit PASS. Regenerate using the
existing task output root and existing APP dependencies:

```sh
export TEMP="$COORD" TMP="$COORD" TMPDIR="$COORD" NODE_DISABLE_COMPILE_CACHE=1
export VEYRA_SOURCE_APP="$APP"
SRC="$OWN/docs/workstreams/rust-api/bootstrap-failure"
/home/brajam/.local/bin/node "$SRC/bootstrap-failure.test.mjs"
/home/brajam/.local/bin/node "$SRC/check-actual-types.mjs"
```

No actual shared source, database file, build or physical workload was changed.
The same coordination root retains `bootstrap-actual-current.tap` and
`bootstrap-actual-current-types.tap` for Root's canonical test import/review.
Their exact sizes/hashes and remaining consumer are appended under
`canonicalCurrentExtraction` in `bootstrap-failure-receipt.json`. This follow-on
removed zero bytes. All previous source/failure/protected evidence remains.
The real persisted startup/guard-failure retry, native close/WAL/holder tests,
actual root restore handoff and full integration qualifier remain OPEN.

## Preserved original proposal checkpoint (08cb7644)

The following records the earlier uninstalled-proposal evidence. Its
`proposal.mjs` and `check-types.mjs` deliberately refuse the now-changed old
preimage. Use `check-actual-types.mjs` and the current test above against the
installed source; do not force the old preimage guard or reapply the patch.

Docs-only patch for the ACTUAL existing `packages/ingenium-core/lib/db.ts`.
No second writer, database, migration or production test factory. Root owns
canonical integration and full startup/restore qualification.

Observed integration HEAD `95161a99d216af6461b4ed240931d3a0fa47ad8f`;
exact actual db.ts preimage SHA256
`935061fb2e140e0f72da6854d4ae813c957e2aabe61e3c5377ab13f01ade9e31`;
proposed postimage SHA256
`45c69beab1af986b856a9050b47b0123b2e1e7dd39da8bca5d9e2c20113f7b64`.
`proposal.mjs` refuses a different preimage; re-review changes instead of forcing
the patch. `bootstrap-custody.patch` has standard three-line context and passed
read-only `git apply --check` against that actual source.

The original code publishes module-global db before configuration/migrations
complete and returns it on the next getDb even after a guard throws. The patch
retains that exact opened original privately while opening, but only publishes
it through getDb after original configuration and runMigrations return. All
non-ready states refuse both cached return and a new constructor. Configuration
or migration failure closes/checks that original; only normal return from its
close AND `original.open===false` AND unchanged singleton identity clear the
cache/state. A thrown close, still-open original, unknown state or state getter
failure preserves the original and refusal latch. Maintenance/test reset can
retry exact close, clearing the latch/counter only after positive confirmation.
Reentry while opening/closing cannot return a handle, open another connection,
or close an active opening original. The initial bootstrap failure remains the
latched cause when close also fails; the caller receives both failures.

The existing root-only restore-maintenance predicate is unchanged byte-for-byte:
only mode `execute` AND an actual getuid function returning zero skip ordinary
migrations. Its existing comment and ordinary startup call semantics are kept;
the call now uses the same retained local original. No alternate executor or
relaxed guard is introduced. `resetDbForTest` itself is unchanged and still
delegates to maintenance close. The normal empty reset remains idempotent.

Validation: **27/27** extracted actual-method checks pass in one Node process.
Actual methods come from the hash-pinned module plus these exact proposal
snippets, with explicitly synthetic constructor/config/guard/close/UID/filesystem
fault ports ONLY in the in-memory test harness. The production patch contains
no injectable constructor or fault factory. One check uses the existing locked
better-sqlite3 with `:memory:` only, an 8MiB cache budget and a bounded synthetic
guard table: guard failure closes the original, a fresh connection reruns the
guard, and both originals are confirmed closed at their last consumer. The
test never calls actual getDb or full migrations against a disk database.
All exact configuration steps, constructor failure, guard failure, four close
faults with both reset paths, cached refusal, retry, reentry and root restore
gate combinations are covered. Full actual db.ts with this patch also passes
strict/noUncheckedIndexedAccess/noEmit in memory against existing dependencies.

Original pre-import reproduction used explicit APP/OWN and the SAME authorized coordination
root, no install/build/cache/database file:

```sh
export TEMP="$COORD" TMP="$COORD" TMPDIR="$COORD" NODE_DISABLE_COMPILE_CACHE=1
export VEYRA_SOURCE_APP="$APP"
SRC="$OWN/docs/workstreams/rust-api/bootstrap-failure"
/home/brajam/.local/bin/node "$SRC/proposal.mjs" --write
/home/brajam/.local/bin/node "$SRC/bootstrap-failure.test.mjs"
/home/brajam/.local/bin/node "$SRC/check-types.mjs"
git -C "$APP" apply --check "$SRC/bootstrap-custody.patch"
```

The single task coordination root remains
`/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/veyra-phase-1/coordination/rust-api`,
on the existing authorized C-backed Ubuntu VHDX. Exact inventory/hashes live in
`bootstrap-failure-receipt.json` there. Cleanup removed **7062 bytes** of the
superseded 26-case success prefix/repeated warning from
`bootstrap-failure-final.tap`; final 27-case result retains 6940 bytes for Root
review. `bootstrap-failure-types.tap` retains 91 bytes for Root review.
`bootstrap-failure.tap` retains 40295 bytes of the unique initial harness failure
(top-level return was passed to TypeScript stripping; the harness was corrected
to append the Function-body return after stripping). Earlier c649/failure and
protected exceptions remain untouched. No DB/build/cache/dependency/runtime
artifact was created; no Windows disk recovery is claimed.

Physical acceptance remains OPEN: actual full Core startup on a disk fixture,
real migration/guard failure on that original persisted DB and clean retry,
real native close failure/lock holders/WAL contention, and the actual root
restore executor handoff/process gate. A constructor that throws before
returning supplies no JS Database original to retain; the synthetic test proves
no cached JS handle escapes, not absence of a native constructor leak. Existing
callers already holding a ready connection are not revoked by a later failed
maintenance close. Root must qualify those physical lifecycles and the full
Core/API integration after import. These unit/type/apply checks are not runtime
or full restore acceptance.
