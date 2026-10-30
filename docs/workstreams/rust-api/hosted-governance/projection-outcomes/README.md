# Original Core projection outcome follow-on

This docs-only proposal follows worker checkpoint `34351ff2d3c7795709925b48fec81246432908ea`. It changes five canonical targets in `projection-owner.patch`: the original skills projection module, hosted engine/owner, SQL125, and a small Core plan adapter. Root retains installation and shared source ownership. No migration, runtime or shared source is modified here.

`proposal.mjs` reconstructs exact preimages from frozen integration `fbafc1cd0de7e8809218d9e19cca1552ae459e64` plus the prior proposal. In particular, the skills preimage includes the earlier absent-only create helper. `preimages.json` records old/new hashes and expected absence for the new adapter. Root must review current drift and merge deliberately; this patch does not update SQL125's registration, which Root owns.

`root-strict-repairs.json` mirrors Root's three subsequent strict noUncheckedIndexedAccess fixes: explicit missing command-fields guard, const DTO mapping tuples and a guarded local read allowlist. The engine preimage includes its guard and the read adapter's repaired hash is recorded as a preserved, unchanged preimage. The patch must not revert these Root fixes. Root's reported r6 strict noEmit pass applies to its earlier integration; this follow-on still needs its own integrated strict check.

The original `writeSkillToDisk` and `removeSkillMdOnly` remain the projection owners. `withStrictSkillProjection(observer, work)` is an opt-in synchronous scope restored in `finally`; nested and async-function scopes are rejected. Legacy callers retain their original behavior. Under the hosted scope, unsafe names/directories, invalid or rejected reference paths, swallowed reference writes/post-write validation failures and swallowed unlink failures propagate as failures. Strict removal distinguishes `ENOENT` from an inaccessible file instead of trusting `existsSync(false)`.

No new journal or writer is introduced. The existing engine invokes `projectionPlan(original)` during the original admission transaction and saves its bounded content-free result as `projection_plan_json` in the same effect row. The plan binds the operation ID and exact whole-original payloadHash, actual target/source SQL identities/revisions, possible paths/actions and SHA256 digests of the selected SQL/proposal/version state. Create plans bind reviewed absence plus project/name; the new skill UUID is still assigned by the original Core insert. Rollback plans read the original version rows. Paths are a conservative union when Core may merge reference patches.

The Core execute port receives `(command, binding, actor, operationId, {plan, events})`. The original helpers run inside the existing effect transaction with a synchronous observer that permits only planned identity/revision/path/action tuples. It captures attempts, completions and failures in bounded memory, including SHA256 of actual intended write bytes. The observer performs no SQL or external I/O. On error, the existing engine rolls SQL back and then persists the captured `projection_witness_json` beside its first failure code in the SAME durable operation row. SQL125 makes the admission plan immutable with the original identity.

Limits are two skill owners, at most 2048 path/action entries per owner, 256 KiB admission plan, 8192 events, 4 KiB per event and 512 KiB total captured events. Oversized plans stop before effect execution; oversized/unplanned event streams interrupt effects and retain unknown. Evidence remains server-private; public receipts do not expose paths or draft contents. No credential or source body is stored in this evidence.

Filesystem and SQLite are not atomic. A projection may partially finish before a helper error, receipt write failure or outer transaction rollback. The durable operation remains `executing`, reads as `unknown`, and cannot replay. A crash may lose optional completion events; its immutable admission plan conservatively identifies possible changes, not completed changes. Failure-annotation persistence can also fail: the original executing row still blocks replay. This is not a crash-proof per-step filesystem audit.

Read-only recovery must use the existing current principal/project/source authorization and the original projection owner's canonical path rules. Inspect the current authorized SQL version and existing files; treat plan/events as uncertainty evidence. This proposal implements no automatic repair, resubmission or file overwrite. A later user edit survives both operation replay attempts and receipt inspection in the regression test. Any future reconciliation needs a separately reviewed policy for current SQL and user-file conflicts; an old unknown original is not authority to restore old bytes.

`actual-core-projection.test.mjs` executes the frozen original complete `skills.ts` and `skill-governance.ts` modules with the proposed changes using Node's in-memory TypeScript transform and VM modules. The proposed actual Core owner/engine are linked to real in-memory SQLite and real task-owned filesystem paths. Only original DB/auth/path dependencies and deliberate filesystem faults are injected. This is stronger than stand-in SQL projection ports, but it does not establish production Express auth, live database migrations or deployment acceptance.

Run from the existing worker checkout, with the same declared C-backed WSL coordination root for all output:

```sh
export NODE_DISABLE_COMPILE_CACHE=1
export TEMP="$OWNED_COORDINATION_ROOT" TMP="$OWNED_COORDINATION_ROOT" TMPDIR="$OWNED_COORDINATION_ROOT"
export HOSTED_PROJECTION_INTEGRATION="$EXISTING_INTEGRATION_CHECKOUT"
export HOSTED_PROJECTION_WORKER="$EXISTING_WORKER_CHECKOUT"
export HOSTED_PROJECTION_TEST_ROOT="$OWNED_COORDINATION_ROOT/projection-fixtures"
node docs/workstreams/rust-api/hosted-governance/projection-outcomes/proposal.mjs "$HOSTED_PROJECTION_INTEGRATION" "$HOSTED_PROJECTION_WORKER"
node --experimental-vm-modules --experimental-strip-types --test docs/workstreams/rust-api/hosted-governance/projection-outcomes/actual-core-projection.test.mjs
```

The 12 cases cover strict unsafe/symlink refusal, swallowed auxiliary/unlink failure, inaccessible stat, legacy compatibility, actual archive approval/rollback and merge approval, receipt failure after actual projection, outer rollback, immutable plan, unplanned path refusal, scope release and unknown recovery preserving a later user edit. Each final-run generated fixture file/link is measured and removed after SQLite handles close and an inactive-handle check; the small cleanup receipt lists exact paths and logical Linux bytes. No Windows disk recovery is claimed. Existing Windows EBUSY and policy-rejected outputs remain protected and untouched.
