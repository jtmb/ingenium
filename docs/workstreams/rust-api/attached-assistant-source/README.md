# Core134 attached-assistant source proposal

Owned docs-only source for the existing Node Core Voice writer. This does not
install a second writer or enable attached speech in the API. Root owns the
canonical migration, fixed private inspectors and final wiring/acceptance.

Files:

- `voice-assistant-source.ts`: private per-segment WeakMap claims, real original
  plan/dispatch inspectors, linked reserve, once-only spend, later CPU live gate,
  original-call negative fence, durable uncertainty and bounded handle retention.
- `134_voice_assistant_sources.sql`: bounded immutable source metadata; no text,
  no agent-result placeholders; deferred actual CPU FK; monotonic spend/fence and
  duplicate/REPLACE guards even when recursive triggers are disabled.
- `owner-splices.md`: actual current owner/hash anchors and minimal Core,
  request-context, supervisor and startup/restore splices. Recipe snippets are
  deliberately not represented as a tested canonical patch.
- `assistant-source.test.mjs`: 60 source-owner/SQLite checks, one Node process,
  existing locked better-sqlite3, `:memory:` only, 8MiB SQLite page-cache budget,
  each fixture database below 64MiB. Synthetic authorization, original plan and
  CPU ports are test fixtures only. Actual production API/resource authority,
  CPU helper, auth lifecycle and effect ordering remain unqualified here.
- `check-types.mjs`: strict/noUncheckedIndexedAccess/noEmit, virtual source path
  against actual existing Core types. No compiler files/dependency copies.

Regeneration uses existing APP dependencies, no install/build/getDb/process
control/model/runtime. Declare the already authorized physical output root in
`COORD`; source and APP must be explicit existing owned locations:

```sh
export TEMP="$COORD" TMP="$COORD" TMPDIR="$COORD" NODE_DISABLE_COMPILE_CACHE=1
export VEYRA_SOURCE_APP="$APP"
/home/brajam/.local/bin/node --experimental-vm-modules "$OWN/docs/workstreams/rust-api/attached-assistant-source/assistant-source.test.mjs"
/home/brajam/.local/bin/node "$OWN/docs/workstreams/rust-api/attached-assistant-source/check-types.mjs"
```

Observed result: 60/60 pass; strict source type check passes after adding the
required missing-segment guard. No disk database, build, cache, dependency or
runtime artifact was created. Existing refused/protected artifacts untouched.

Current generated inventory is reconciled in the sole coordination-root
`assistant-source134-receipt.json`. Removed: **0 bytes**. Final TAP (5966 bytes)
is retained for Root review, and the minimal initial type diagnostic plus pass
(2187 bytes) is retained as unique correction evidence. The superseded initial
TAP (3670 bytes) is retained because its active-reference safety check failed:
`fuser -v -- PATH` returned status 1, “No process specification given” and usage.
It was not deleted or retried through another path/tool. No Windows disk
recovery is claimed. These sizes describe this bounded follow-on only; older
protected exceptions stay governed by their original receipts.

Remaining acceptance: Root must mount and test the genuine request-context and
supervisor inspectors, actual reserve transaction composition, generic reserve
unchanged parent check, claimDispatch and retain-running/cached-ACK gates,
pre-effect spend ordering, barge/End negative fence and startup/restore hook.
No output metadata DTO or hash becomes source authority. Never rehydrate or
adopt private handles from JSON, create fake completed-agent rows, replay an
unknown effect, or infer settlement of the attached agent/goal queue.

The follow-on UPDATE collision guard fixes a gap in c649: with recursive
triggers disabled, UPDATE OR REPLACE could bind a reserved source to a different
source's existing unique CPU operation and delete that original. The explicit
BEFORE UPDATE guard now checks all four unique identities against OTHER rows,
excluding OLD, and raises ABORT before conflict resolution. The matrix covers
UPDATE / UPDATE OR IGNORE / UPDATE OR REPLACE with recursive_triggers=0/1 for
claim ID, call-instance/source/segment, nonnull CPU operation and nonnull dispatch
ID. All refusals compare both complete row snapshots byte-for-byte. Six positive
controls exercise noncolliding link, spend and fence with the same UPDATE forms
and trigger settings. One isolated test drops only the new guard and reproduces
the old row deletion; that change exists only in its disposable in-memory DB.
The 29-case c649 checkpoint and its earlier failure evidence remain preserved.
New `assistant-source134-update-guard.tap` and
`assistant-source134-update-guard-types.tap` stay in the SAME coordination root
for Root's review; exact sizes/hashes and remaining consumers are recorded in
the existing receipt. No canonical files or physical workloads were touched.
