# Original scoped Web files — native source proposal

Owner: existing Projects and execution chat/checkout; no new worker, checkout, schema, runtime, build, dependency or drive. Root alone applies shared Native changes. Work1 owns the private proxy, retained OwnedEngine/session lease, allocation7 journal, exact raw request and span transformation. This is a bounded constructor slice, not whole Web acceptance.

## Concrete interface

The existing public `opencode::attachments` reexports:

```rust
resolve_local_web_files(
    binding: &LocalWorkspaceBinding,
    session: &EngineSession,
    operation_id: &str,
    original_input_sha256: &str,
    full_prompt: &serde_json::Value,
    current: &dyn Fn() -> Result<(), String>,
) -> Result<NativeWebFilesOriginal, String>
```

No positive constructor, Deserialize, Clone or Debug exists for the opaque capture or its immutable replacements. `check_current(binding, session_id, operation_id, input_sha256, current)` rechecks the original binding and actual registry callback. `replacements()` exposes getters for `/files/N/uri`, original URI, captured effective data URI and optional fallback basename. `contains_image()` is based on actual sniffed bytes. `journal_original()` is an original-writer-only projection of owner/session/operation/input hash, full-source bytes/hash/identity, selected-effective hash, original/effective URI and selection. It is never a renderer response or live authority after restart.

**Required caller contract:** Work1 resolves and checks under the SAME actual retained OwnedEngine lock, reobserving original registration/process/environment/credential revision plus the saved actual engine session and model/agent. `current` must use the original ProjectStore with nonblocking lock order to verify current binding AND `require_local_session`; a supplied JSON session or positive callback is not sufficient. The resolver checks the session directory/project fields against that live caller observation; it does not acquire or invent an engine. Repeat the lease/current check at the single send. Work1 rejects captured images when that retained model lacks vision; the old original-data-URI-only vision check does not cover file:// images.

Work1 persists the exact original complete raw body and this capture mapping in allocation7 before dispatch, then patches only the exact bound file URI string spans and Root-approved missing-name insertion. It checks original_uri equality at each pointer and binds the full effective raw payload/hash in the same durable original. No full-prompt reserialization is supplied here. A missing original name maps to the captured basename, matching the pinned file branch; explicit names, descriptions, mentions, comments, metadata, parts and unknown future content retain their original bytes. Inline original data maps to itself after actual decoder/sniff/bound validation. Metadata/comments paths do not become filesystem authority; only explicit files[] URI entries enter this constructor. Root/Work1 must qualify any separate path-bearing route or plugin interpretation.

## Actual reads and race boundary

Windows uses the existing original PrivateRootCustody (its complete ancestor chain pins the actual local root), checks the actual reopened root volume/file ID against the saved original, and holds each no-reparse directory/file handle with read sharing only through bounded source capture. It rejects reparse points, non-disk handles, alternate streams, remote/UNC roots, foreign volumes, wrong kinds and multiply linked files; source handle size/identity/time must remain stable. Source bytes come from that final held handle, never from a later pathname open. All handles close after immutable byte capture; later engine consumption uses the captured inline bytes. Windows runtime/close/containment qualification remains Root-owned.

WSL uses the existing selected recorded distro/user bounded original helper transport with actual binding installation/workspace/proof and a combined current-registry/installation guard checked before spawn and stdin release, not Windows file access, HOME guessing or a new process owner. The original helper verifies installation/workspace and actual root uid/machine/filesystem/inode before the new action. The action opens each component descriptor-relative with NOFOLLOW, checks actual euid/device/mount ID, rejects multiply linked/nonregular/FIFO inputs and reads bounded bytes from the actual final fd. Before/after inode/size/time checks refuse a changed capture; no filesystem-wide atomic snapshot or CAS is claimed. Descriptors close in finally; existing transport requires actual child exit/pipe completion before accepting bytes and retains uncertain originals on failure. Work1 current checks bracket capture. Because only captured bytes are dispatched, replacing a pathname afterward cannot redirect the engine read.

Lexical URI parsing only produces candidate relative components for that actual read. It grants no path permission. The URI root must match the current binding environment, with exact POSIX components or Windows case-insensitive components; traversal, ambiguous encoded separators, ADS, remote authorities and unsupported queries are refused. Mentions are retained and offsets bounded using JavaScript UTF16 text length. Full source SHA is distinct from selected effective SHA. Text selection matches the pinned UTF8 `split("\n").slice(start-1,end).join("\n")`, retaining CR and trailing-empty semantics. Image ranges are ignored as upstream does. The original URI and selection remain in the journal.

## Pinned source and explicit open compatibility work

[Prompt input schema](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/schema/src/prompt-input.ts), [mention/persisted schema](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/schema/src/prompt.ts), and [actual materializer](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/core/src/session/prompt.ts) were read at the exact pinned commit. `upstream.json` records fetched byte counts/hashes without copying a source tree.

The first constructor intentionally reuses existing real native attachment sniff/limits: 32 entries, 8MiB aggregate/image and 1MiB valid UTF8 text; supported MIME is PNG/JPEG/WebP/text. It is useful for those real inputs and is not an always-deny placeholder. Whole unchanged Web acceptance still requires:

- Upstream 20MiB per-file parity: a coordinated resource/body/journal/WSL-output limit change and full batch peak budget, real boundary tests, and model-image compatibility. Do not silently increase only one constant or truncate files. Current fixed WSL JSON output cap is 24MiB, so 20MiB base64 cannot fit it unchanged.
- Directory mentions: actual held directory enumeration on each environment, a bounded complete listing, directory-first/name locale ordering exactly matching pinned JS localeCompare, native separator suffix, application/x-directory semantics and a supported upstream effective representation. Existing sniff rejects this MIME and the upstream data branch redetects MIME, so merely relabeling listing text would lose that original semantic. Root must choose/qualify a closed transformation or same-engine materialization hook; no empty-list stand-in.
- Other binary/invalid-UTF8 formats: match upstream MIME detection/normalization and supported model handling with exact bytes; existing text sniff refuses binary/invalid UTF8. No replacement text or fake image MIME.
- UNC/network inputs: existing original private custody accepts local HarddiskVolume Windows roots, not remote shares. Qualify a real retained network-root identity/read/close backend and ownership contract before accepting such input; never remap a UNC path into the local root.
- Canonical URI/query compatibility: currently rejects unknown/duplicate/range-invalid queries, non-base64 data URLs, unsafe names and fractional/out-of-text mentions that the broad schema might accept. Test actual pinned composer Windows/POSIX encoding and custom API paths before claiming complete schema equivalence.

These are open compatibility gates, not authorization to drop requested behavior or weaken custody.

## Apply, evidence and cleanup

```sh
python3 docs/workstreams/projects/native-web-files/prepare-proposal.py --native-source-root <exact-shared-native>
# Root applies integration.patch to four exact preimages, then copies three
# canonical files under sources/ to their matching original paths.
python3 docs/workstreams/projects/native-web-files/test-files.py --fixture-root <existing-coordination>/native-web-files-fixture --receipt <existing-coordination>/native-web-files.json
```

The strict generator refuses drift; the observed Web lease source is context only and is not a fifth edit/preimage gate. Ten meaningful actual inert Linux fd tests pass, including final/ancestor symlink, hardlink, FIFO, directory, bounds, traversal, captured original inode after pathname replacement, mutation and descriptor closure. Three Rust unit cases cover platform URI/range/UTF16 semantics but have NOT been compiled or run by this worker. No Windows/selected-user WSL transport/real OwnedEngine/model invocation occurred. Root must compile the actual integrated native source and run the Rust unit and real route/transport/acceptance checks.

All paths stay in the one existing C-backed Ubuntu VHDX root in storage.json. The fixture cleanup verified exact root identity, protected source hashes, no tracked source/mount/process/fd references and regeneration before removing every fixture path plus empty root: 2,154 logical bytes; zero retained fixture exceptions. Exact removed paths/bytes are in existing coordination/projects/native-web-files.json. Logical Linux removal is not Windows free-space recovery. Canonical source/delta/generator/tests/minimal receipts remain for Root integration/review; no build/dependency/cache/scratch outputs remain.
