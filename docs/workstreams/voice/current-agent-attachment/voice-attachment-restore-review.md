# Metadata-only attachment restore proposal

Root-owned integration and execution required. This worker ran no tests, builds,
models, interpreter modules, maintenance operations or database processes.
Body syntax was compiled without execution in the tool orchestration V8 only.

## Integration

Copy voice-attachment-restore.mjs/.d.mts into original Core lib/tools.
voice-attachment-restore-splices.json specifies exactly three backups.ts spans:
capsule type plus static import/validator export, capture field, and merge before other ledger
merges inside the existing execTransaction. Static import is legal at top-level
after the type declaration; Root may move it to the ordinary import block with
its own reviewed postimage. No second database or transaction owner is introduced.
The original Core writer must have migrated and verified Core132 before use.

Envelope is {version:1,count,entries,sha256}; count is exact and hash-covered.
Rows contain only immutable nine-axis scope JSON/hash, request/kind/input hash,
original message ID, intent/ACK/unknown/revision/timestamps and ACK kind/hash.
Scope JSON has exact keys/order; all hashes, canonical contents, ACK derivation,
kind/state combinations, safe timestamps, row counts and serialized bytes are
validated. There is no transcript/audio, queue, Run, principal, model grant or
agent settlement proof. Existing dispatch authority is never reconstructed.

The helper pins the exact original Core132 sqlite_master table and five trigger
definitions (line endings/final semicolon normalized only). Missing, older,
partial or drifted schema refuses. Update pinned definitions only with reviewed
original Core migration changes, not permissive schema fallbacks.

## Merge rules

Capture counts/estimates bytes before reading bounded rows. Limits:16384 global,
4096 per scope,8MiB complete ledger. The aggregate read estimate includes256B
per row overhead; near-capacity valid tables may conservatively refuse capture.
Refusal preserves originals; it never evicts or spends a new request.

Merge requires the caller's original open Core transaction, validates both sides,
preflights the complete union and every conflict/capacity check before writing,
then uses a nested savepoint so a caught write failure cannot commit half a merge.
No INSERT OR REPLACE/IGNORE, deletes, terminal reset or new execution is used.

Identity conflicts (including immutable created_at) refuse. Matching terminal
ACKs/unknown are retained. Different valid ACKs or ACK versus unknown refuse;
neither is silently discarded/promoted. A terminal original dominates an older
intent. Every intent left in the union, including restored-only rows, becomes
unknown/revision2. Timestamps stay monotonic. Repeating the merge is idempotent.
The receipt is storage counts only. All rows remain spent for delivery reserve.

## Older snapshot and legacy journal policy

A current signed snapshot predating later delivery rows IS supported: the live
capsule restores those rows, preserves snapshot-only rows and seals abandoned
intents. Root's genuine signed Core regression is the required acceptance proof.

An old snapshot predating table132 requires the ORIGINAL Core migrator before
merge. The helper never creates a partial substitute table. An old capsule/journal
missing voiceAttachmentDeliveries is NOT accepted as an empty ledger. Optional
TypeScript field permits parsing old journals, not resuming them without proof.

New restore capture already occurs before swap in restore-maintenance.ts and
will refuse missing schema/invalid metadata then. The three Core splices alone
do not close legacy incomplete-journal recovery: recover()
rolls original components back before calling recoverRestoreExecutionCapsule.
readJournal currently checks HMAC, not this metadata ledger. The additional exact
voice-attachment-maintenance-splices.json proposal supplies two caller spans:
writeJournal validates captured metadata and the COMPLETE serialized16MiB cap
before atomicWrite; readJournal validates only AFTER original HMAC verification
and BEFORE returning to recover's rollbackComponent/sidecar/metadata/cleanup
paths. This also prevents terminal legacy journals being archived on an assumed
empty ledger. Validity grants no restore authorization. The existing16MiB cap
must cover the complete journal;
voice8MiB plus other memory ledgers may collectively exceed that cap. Per-ledger
capacity is not proof the whole journal fits. Do not enlarge limits silently.

Safe legacy upgrade must bind the HMAC-verified original run/journal to the
retained original rollback database through the existing physical file owner,
quiesce writers, migrate THAT original through the original Core migrator,
capture its actual delivery ledger and atomically re-sign the upgraded journal
before proceeding. Do not capture an arbitrary current/restored snapshot DB or
infer emptiness from version/absence alone. If original source authority cannot
be established, retain journal, originals and locks for explicit maintenance
reconciliation; do not swap, resume users, delete evidence or fabricate emptiness.
No generic callback/proof boolean, new source selector or automatic fallback is
provided here. Root owns importing these caller splices, original-owner safe
legacy upgrade, and live restore acceptance. Keep the legacy preservation gate
open until actually implemented and verified; refusal retains original evidence.

## Verification and retention

20 authored model-free SQLite cases (10 for each recursive_triggers=0/1) cover
old-snapshot replay prevention, union/terminal retention, immutable conflicts,
valid ACK conflicts, unknown/ACK conflicts, missing capsules/transactions/schema,
strict canonical/hash/count/metadata limits, union cap and schema drift. The
test adapter represents only a real in-memory SQLite connection/transaction;
no fake authorization, model or execution ports exist. Root command:
`node --test voice-attachment-restore.test.mjs` from this proposal directory.
This is an in-memory helper harness, not signed-restore acceptance or runtime
qualification. Root's actual Core regression and strict build remain required.

Retain these minimal reviewed sources, hashes and splice recipe for Root's
remaining actual Core/maintenance consumers. No bulk/cache/temp outputs were
created; removed paths0/bytes0. Existing13Native drafts remain protected. Existing
typed/synthesis behavior/global inactive admission fence are untouched. Full
call routing, durable selection ownership, audio and legacy restore gates stay
open. Do not infer full goal completion from this source checkpoint.
