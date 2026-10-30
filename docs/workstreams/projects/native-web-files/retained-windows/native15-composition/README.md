# Frozen Native15 retained-read composition

Reviewed Work1 commit094c34e39b7ba62e7e3d3e45cd1e77d4432d48ed, exact native15 manifest/postimage hashes. This is a minimal source/signature proposal for Root integration; no shared source, schema, build, runtime or new worker. It preserves the same output root and full Web/phase gates.

## Exact helper delta

locked-helper.patch targets the canonical windows_read.rs introduced by Projects73fc7184. Its pre/postimage hashes and all reviewed Native15 source hashes are in inputs.json. The canonical file one directory above under sources/ is updated in place. This helper now REQUIRES Native15 inspect_local_web_prompt_locked; it is not standalone73fc source.

Public hold/check/visit wrappers acquire the engine once. Their new pub(super) hold_local_windows_web_read_locked, check_local_windows_web_read_locked and visit_local_windows_read_sources_locked accept the actual &OwnedEngine already locked by Native15 submit/dispatch. Call those locked variants inside the ONE lock; calling public wrappers there would deadlock. The source acquisition retains actual binding/session/model/agent/current/file checks and existing byte bounds.

Root must merge the five constructor loader/retirement deltas with Native15. web_original.rs and desktop_runtime.rs have overlapping export/header preimages: use Native15 postimages plus constructor module/type additions; do not overwrite either file with an ancestor. local_execution.rs/local_custody.rs/attachments/web_files.rs loader edits remain separately exact-hash reviewed from73fc. No broad source snapshot or copied build is supplied.

## Minimal proposed type and signature changes

These signatures are recommendations for the actual owners, not fictitious compiled implementations or new authority constructors:

```rust
// Move-only; both variants carry a genuine actual constructor original.
enum NativeWebFileInputs {
    Snapshot(NativeWebFilesOriginal),
    RetainedWindows(NativeWindowsWebRead),
}

// Preserve existing real ProjectStore reservation, with enum third argument.
// Caller still holds actual serial/ModelWork and same OwnedEngine lock.
submit_local_web_prompt_original<F>(..., reserve: F)
where F: FnOnce(NativeWebOriginal, EffectiveWebBody, NativeWebFileInputs)
    -> Result<NativeWebReservation, String>;

// Actual original completion slot, retained BEFORE HTTP and filled only by
// actual private transport; no Deserialize/public field/DTO constructors.
struct NativeWebRequestOwner;

// Same actual writer returns this only after exact ACK+settlement commit.
// It binds the SAME opaque owner/outcome identity, operation/input and ACK hash.
struct NativeWebPublished;
acknowledge_native_web_prompt(...) -> Result<NativeWebPublished, StoreError>;
```

NativeWebDispatch must move the enum and the genuine retained request-owner reference from the reservation/fence into dispatch. NativeWindowsWebRead must then move into that request owner BEFORE any send attempt or fallible post-send step. It must not live only in a local files_original variable. The pending registry holds the same owner through actual response capture, durable ACK publication AND exact checked closure. Arc clones retain that same object; copied JSON cannot reconstruct it.

Windows uses an identity EffectiveWebBody minted from genuine retained read + NativeWebOriginal: exact raw bytes unchanged, original/effective hash equal, empty transformations. The private writer verifies that genuine variant against current binding/session and exact original, and records captured source BLOBs from the zero-copy evidence visitor. Do not pass a Windows identity proof through materialize_resolved_web_files, which decodes effective URI base64 and assumes a snapshot. dispatch_locked must branch on the proof enum; original Windows file URIs are legal ONLY while that exact guard remains held. WSL keeps the actual snapshot/explicit transformation path and its open semantic gates.

## Required response ownership fixes found in frozen source

The current positive flow returns LocalWebPromptOutcome and then enrolls it inside the blocking worker. That is too late for internal early exits:

- After send_original_web_prompt_once returns, PromptRecord persistence and active_turns locking can fail before outcome construction.
- Current-engine/file/credential checks can revoke and return Err after a real response was received, before WebPending.enroll sees it.
- A transport Err becomes a plain RuntimeError before any outcome exists. The Windows carrier inventory would keep handles, but the only full/partial response object can still be lost.
- local_web_transport read_to_end errors and oversize responses drop the partially filled body Vec before returning EngineError.

Required smallest ownership change: retain an opaque request/completion slot in Runtime.web BEFORE invoking HTTP. Bind it to the genuine move-only dispatch and attach its read guard before begin_send. Actual response reading fills that retained slot directly, so panic/disconnect/read error retains exact observed header/body bytes as UNKNOWN rather than dropping a stack Vec. Seal a full outcome immediately at actual transport completion, before all fallible persistence/current checks. A partial/oversized/malformed200 is not a publishable full ACK. No current-path check, callback result, generic HTTP return or DTO may manufacture a join witness.

Full ACK publication must return a sealed private NativeWebPublished witness bound to the same owner/outcome and exact raw ACK BLOB+minimal settlement transaction. The current Result<()> and flush is_ok/remove behavior are insufficient for releasing a retained read: successful recording of an uncertain-status response does not establish materialization. Check the genuine joined/materialized outcome and consume the typed publication witness once, then checked-close exact originals. Remove a pending owner only AFTER publication and required closure succeed. Writer failure, failed current checks, partial transport, missing join, or close uncertainty retain the same owner and block donor retirement. No release at send() return.

The alternative release path needs an actual original engine-tree/transport retirement witness minted by the real retained engine owner after its existing complete stop/close protocol. monitor_stop AtomicBool signals revocation, not tree closure. Primary exit, a stopped flag or a copied descriptor is not enough. This witness remains Root native-owner work; no dummy proof type or callback is supplied.

A retention-only publication review is also needed: frozen acknowledge_native_web_prompt calls current check_local_owner/require_local_session. Revocation after a genuine response can permanently refuse completion recording. Do not waive fresh-execution scope checks; Root must deliberately separate append-only completion retention against the immutable original row from authority to start fresh work. Until then the exact outcome and handles remain protected.

## Review recipe and evidence limits

```sh
python3 docs/workstreams/projects/native-web-files/retained-windows/native15-composition/review-frozen.py --repository <owned-projects-repository> --receipt <existing-coordination>/native15-composition.json
```

The recipe reads immutable Git objects at094c34e and73fc7184, verifies five exact source postimages plus the frozen110107-byte delta/manifest hashes, identifies seven concrete fallible ordering sites, and applies locked-helper.patch in memory to its exact73fc helper preimage. It does not materialize a source tree or mutate any shared/index state. This is source ordering/delta evidence, NOT behavioral Rust tests or runtime qualification. Root still owns actual source composition, compilation and all joined publication/retirement counterexamples.

Required real counterexamples include full ACK followed by prompt-journal failure, post-ACK revocation, worker disconnect/panic before outcome return, partial body/error/oversize, duplicate publication, uncertain-status publication, unknown checked-close, and actual original-tree retirement. In each case exact observed bytes and the same guard stay retained until a genuine permitted settlement; no model/request replay or fake source success.

No scratch/fixture/build/dependency/cache output was generated. Removed paths:none/0bytes. Only canonical source delta, reviewed hashes/contracts/recipe and the minimal in-place coordination receipt remain for Root application/review; no Windows disk recovery is claimed. The broader constructor/WSL/directory/UNC/fullWeb/phase acceptance gates remain open.
