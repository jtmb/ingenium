# Monotonic no-create admission proof

Bounded delta after `664379c9`. This closes only a provably **pre-material, pre-create** original run. Accepted material requests, ambiguous material/create/start acknowledgements, legacy/untracked provenance and reconstructed open rows remain unknown with quota retained. It does not use a missing container, PID, idle engine, diagnostic or cached terminal status as proof.

## Actual Core fence

A new Core126 row explicitly starts `effect_fence='open-v1'`. The schema default is `untracked`, so restored/legacy rows are never silently backfilled as proof. Each new admission also binds an opaque current-owner incarnation identifier inside its immutable admission/spec. New material/effects and no-create closure require that original issuer. Reconstructed open rows cannot be closed or newly materialized. This identifier is provenance, not a new credential, principal, writer, scheduler or external store.

`launchMaterial` now commits `material-admitted-v1` **before its first await or credential work**. If qualification fails, the response is lost, or material later becomes ambiguous, that marker remains and no-create proof is forbidden even when no token/container is present. Success still returns the updated canonical admission. The create intent CAS changes the same fence to `create-admitted-v1` before Docker may create anything. The original manager still requires accepted intent before Docker; no replay, replacement or automatic adoption is added.

SQL triggers enforce one-way transitions, reject old writers that attempt create without the marker, block credentials without material admission, and prohibit later material/container fields on a closed no-create row. The trigger uses explicit COALESCE to reject SQL NULL/malformed proof logic rather than accepting three-valued unknown predicates.

## Atomic closure and quota

The private `no-create-close` operation checks the exact original run identity, original attempt/spec/revision, current private manager enrollment and same owner incarnation. In one original Core transaction it verifies: open-v1 provenance; prepared/cancel-requested phase; no material admission/consumption; no credential or sidecar row; no container, result or previous proof; and an original running/queued run. It atomically closes the fence and publishes a `core-no-create-effect-v1` proof bound to run/attempt/spec/immutable run identity and the closing revision.

That same transaction cancels an explicitly cancelled original run, or records failed-before-execution for an explicit private abort. It never records model success. A terminal-write failure rolls back the proof/fence and quota release together. A closure winning the CAS rejects every later material/create request. A material admission winning first blocks closure permanently. No new original run or attempt is allocated.

The manager reads the fresh Core proof after closure and after reconstruction. It does not issue Docker inspection, wait, stop or delete calls for this proof kind. Existing container retirement remains a different proof kind and still requires a positive original-daemon wait join. Null-container Docker proof cannot substitute for no-create authority.

After the original Dot operation consumes the terminal outcome, cleanup reports the no-create settlement rather than `removed`. No container deletion timestamp or removed bytes are claimed. Existing admitted/uncertain work keeps its original ownership evidence and quota.

## Restart and restore scope

A closed proof can be read by a reconstructed controller because its irreversible fence prevents subsequent effect admission. An open row from a previous incarnation is conservatively unknown, even if its SQL fields appear empty. The proof's history also requires Root's actual restore protocol: quiesce old handlers and remote managed effects, close/replace the original DB, and reconstitute the owner for every restore. In-place table rollback without replacing/resetting the owner is not a valid proof domain. Restored pending original runs must not be reinterpreted as fresh claims when an earlier snapshot lacks execution metadata.

Root reported implementing the independent managed-child restore barrier before claim and again after stopDbUsers/before closing the original DB, with actual helper/SQLite tests and r4 types passing. Those are Root's separate receipts, not this worker's live/platform evidence. This delta does not bypass the restore barrier or turn an external rollback into a no-create proof.

## Typing and integration

`044db4b0` supplied seven concrete .d.mts contracts without blanket any declarations. Root imported/applied them, repaired the manager closed-body input validation and reported actual API/Core noEmit PASS r3/r4. This delta adds the actual no-create method and issuer field to those contracts. Root's model validation/--model fix is preserved: the no-create patch does not touch managed-job-child, runtime-job-child, runtime-manager body validation, api-server or Auth middleware.

`core126-no-create.patch` is a minimal exact-preimage delta against Root's current applied modules and registered source migration126. All writes remain in this owned docs tree; Root alone applies shared source/migration changes and updates schema/trigger/backup checks. Apply with the recorded preimages and `git apply --unidiff-zero --check`; do not stack obsolete full manager bundles over Root's current source.

Tests use real in-memory SQLite, actual existing Core grant/runtime/auth/token/hash/parser code, isolated fixture encryption/profile/image facts and fake Docker effects. New cases cover closure, cancellation with zero Docker calls, late material/create refusal, pre-await admission, all ambiguous acknowledgements, untracked rows, SQL NULL/old-writer attacks, rollback, reconstructed open/closed provenance and wrong manager/attempt/spec/revision. No disk DB, key, model, process fixture, service or Docker object is created.

## Storage/cleanup

Owner remains Dot `01a18935-103f-7432-98b0-cd2c51f8c8ab`; all source/patch/test receipts remain beneath the existing authorized C-backed WSL root in docs/workstreams/dot. No disposable outputs or dependencies/build/cache/temp/log trees were created. Removed paths/bytes: none/0; no disk recovery claimed. Durable source is retained for Root review/apply/testing and version-controlled supersession. Existing runtime/model/vault data, original failure evidence and central fixtures are untouched. Full feature/phase/live acceptance stays open.
