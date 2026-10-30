# SQL130 original dispatch fence review

Read-only bounded Foundation review of the original Core SQL130, registration/drift checks, unadmitted close, restart exclusion and focused fixture. No shared edits, schema application, production startup, build, process/model/runtime, Computer Use or workers were used. Exact reviewed input hashes and the output reconciliation are in the single coordination `dot-dispatch-review-receipt.json`.

## P1: INSERT OR REPLACE bypasses the persisted nonreplay fence

SQL130 SHA256 `fb94676ba942e87bbe781b2a8c4e72281181b8615620aa86e1631a65b38eb573`, lines8-10 (`dot_dispatch_initial`),104-106 (`dot_dispatch_no_delete`),134-145 (`dot_dispatch_run_identity`/`dot_dispatch_run_no_delete`).

The insertion guard runs only when the NEW operation has a managedDispatch property, while immutability of the OLD marked operation and original Run depends on DELETE/UPDATE triggers. With recursive_triggers=OFF, replacing an existing row performs a conflict deletion without running that DELETE guard. An unmarked replacement body avoids the insertion guard too. This is a connection-independent SQL invariant failure; it is not a claim of a new unauthenticated HTTP/SQL route.

Reproduced against actual SQL124/126/129/130 and the actual close owner source in an isolated in-memory fixture:

1. Close the positively marked unadmitted original operation using `closeOriginalUnadmittedDotOperation`; confirm cancelled Run and closed-unadmitted-v1.
2. `INSERT OR REPLACE` the SAME `(kind,id)` operation with its original claimed body minus managedDispatch. The retained evidence and closed marker disappear despite the DELETE trigger.
3. Update the SAME Run to running with finished_at=NULL. Its UPDATE guard no longer sees a marked operation, so it succeeds.
4. Insert the original managed execution for that Run. SQL130 no longer sees a marked operation and accepts prepared/open-v1 admission. The closed original Run has been reopened and admitted again.

An independent reproduction keeps the closed operation marker but `INSERT OR REPLACE`s the SAME job_runs row with running status. That bypasses the Run UPDATE/DELETE guards, leaves the receipt inconsistent with its Run and makes idempotent close fail. Both witnesses assert that the current defect occurs; their two passing assertions are **failure-reproduction evidence**, not acceptance tests. The script intentionally pins the reviewed SQL130 hash and stops on drift.

Add BEFORE INSERT collision guards for existing marked operation identities and their original Run identities, so REPLACE cannot discard their original evidence even with recursive triggers disabled. Preserve ordinary new/unmarked insert behavior and the existing SQL129 production/candidate invariants. Enabling recursive_triggers only on the normal API connection would leave the raw/restore connection invariant dependent on configuration; the repository already uses a connection-independent collision guard strategy for the reserved broker (db.ts4614-4618 / migration058). Add refusal coverage for both recursive trigger settings, both closed and admitted/unknown identities, and ensure original rows/bytes and the original closure survive the refused statement/transaction.

## Other reviewed edges and limits

SQL130 is additive to the existing Dot/managed ledger. Initial and retry claims bind the original scope key, job/schedule and original Run; marker transitions preserve run/operation/followup/scope/identity. Existing immutable ledger checks remain relevant. The new admission INSERT and its AFTER marker update share the original SQLite transaction; failure of the update rolls back the INSERT. The actual close checks the selected existing tuple/hash, cancels through the existing JobRun owner, then CAS-updates the Dot row in the same transaction. Its receipt contains no container or physical retirement assertion. The focused fixture covers close rollback and idempotence, old unmarked preservation, changed owner/workspace/hash/revision refusals, pending material refusal, WAIT_CAPACITY first-claim behavior and ordinary update/delete fencing. Those update/delete tests do not cover the reproduced REPLACE path.

`recoverInterruptedJobRuns` jobs.ts842-847 excludes original managed ledgers and marked Dot Runs from ordinary interrupted-run failure handling. db.ts5523 registers SQL130 and all its current triggers; db.ts5593-5598 compares their authoritative definitions alongside SQL124/126/129 and checks its schema marker. The migration is applied inside the existing Core transaction. I found no second independently demonstrated P1/P2 in those reviewed paths. Definition checks do not detect semantic defects in an authoritative trigger, so the reproduced bypass remains present even when drift checks pass.

This review does not establish actual production startup/restore acceptance, authenticated scheduler behavior, actual process placement, positive physical retirement, finite CPU/model qualification or full Veyra release acceptance. Root retains those gates. No new Run, DB writer, quota, credential authority or positive fixture constructor was introduced.

Regenerate the bounded witnesses from the existing owned checkout using existing Linux Node, DOT_FENCE_REVIEW_ROOT pointing to the existing read-only `real-gmail-ui/prd-ui-fixes`, TEMP/TMP/TMPDIR in the SAME existing `veyra-phase-1/coordination/rust-api`, and NODE_DISABLE_COMPILE_CACHE=1:

```sh
node --test docs/workstreams/rust-api/dot-dispatch-review/review-witnesses.mjs
```

The only disposable output is the small TAP plus one receipt/in-place status in that preauthorized C-backed root. All SQLite data and transformed source are in memory and closed by test cleanup. No disk fixture/cache/dependency/compiler output was created. Removed paths none; removed bytes0. The TAP and receipt are retained for Root's concrete finding review, with the minimal durable source under this owned docs prefix. Existing rejected/EBUSY targets remain protected and untouched. No Linux or Windows disk recovery is claimed.
