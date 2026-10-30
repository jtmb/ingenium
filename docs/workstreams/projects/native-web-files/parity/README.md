# Pinned file compatibility follow-on

This uses the same task, checkout and declared storage root. It adds pure MIME/range/provider-projection facts and exact oracle vectors. No active source/wire/WSL/journal/count/batch bound or resolver behavior changes. Root alone applies shared source and owns allocation7. Whole Web compatibility remains open.

## Apply and verify

The single exact preimage edit declares opencode::attachments::web_file_compat. Root copies the two new canonical files (Rust and golden JSON) to corresponding original paths and applies integration.patch. The generator refuses preimage drift. Other recorded Native files are context, not edited preimages.

```sh
python3 docs/workstreams/projects/native-web-files/parity/prepare-proposal.py --native-source-root <shared-native>
node docs/workstreams/projects/native-web-files/parity/test-parity.mjs --receipt <existing-coordination>/native-web-parity.json
# Golden regeneration only: append --write-fixtures.
# Root resource-leased build, not run by worker:
# cargo test -p veyra-adapters opencode::attachments::web_file_compat::tests
```

The40-case test fetches exact committed sources, verifies expected byte counts/SHA, and executes the actual pure MIME detector, selection expression and provider projection helpers in memory. It retains no downloaded source tree/cache/dependencies. Four Rust unit cases consume those golden vectors and resource arithmetic; Root still must compile/run them. No engine, model or native backend was invoked. Exact upstream hashes are in inputs.json.

## Implemented exact pure behavior

Pinned [Mime.detect](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/core/src/mime.ts) recognizes PNG/JPEG/GIF/BMP/PDF/WebP/AVIF/AVIS, then text/octet-stream. Text excludes NUL, allows30% selected control bytes, and uses fatal UTF8 with stream:true. An otherwise valid incomplete final UTF8 sequence is accepted; complete strict Rust UTF8 is not equivalent. The pure Rust detector ports that fact and the threshold without overflow.

The actual [materializer](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/core/src/session/prompt.ts) applies ranges only for text/plain: decode UTF8, split newline, slice(start-1,end), join newline. The pure selected-byte function preserves CR/trailing-empty behavior. A selected incomplete tail becomes replacement text; without a range original bytes remain exact. Keep source/effective hashes distinct.

The [provider projector](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/core/src/session/runner/to-llm-message.ts) directly emits PNG/JPEG/GIF/WebP/PDF media after image normalization; BMP/AVIF/octet-stream are ignored if normalization leaves that MIME. The pure projection classification makes this explicit. Detection does not prove actual image normalizer/model/provider support; never synthesize replacement content or claim ignored bytes reached a model.

Activation requires Root to replace the current four-MIME decoder/sniff path deliberately, retain actual model checks, and qualify pinned decoding/normalization/result behavior. This module does not silently broaden the current constructor.

## Resource contract that must activate coherently

Upstream has20MiB per attachment, an unbounded files array and concurrency8 materialization. A bounded native count/batch/aggregate policy need not accept that unbounded array, but must describe its own limits honestly.

20MiB is20,971,520 source bytes and27,962,028 base64 bytes. Existing16MiB request and24MiB WSL output cannot carry it. Suggested32MiB wire and dedicated32MiB file-action WSL output would carry one file plus bounded metadata, but source/batch/raw/effective/ack/journal/full-memory guards must activate together. Other WSL actions must keep their old bounds. No limit is raised here.

Root decided allocation7 uses the SAME SQLite writer: exact original/effective/ack wire BLOBs and actual source/effective content with verified SHA/length, dedup and ONE64MiB retained aggregate. Maps reference actual content, not duplicate base64/data URIs. Existing numeric-JSON body_bytes serialization allocates a serde_json::Value per octet; Root must remove it and measure real copies before enlarging bodies. No new DB/writer or hash-only content grant is proposed.

Crucially, pinned [prompt success](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/protocol/src/groups/session.ts) returns full SessionInbox.User with materialized attachments. Source + effective wire + distinct ack for a general20MiB file need at least76,895,576 bytes, already beyond64MiB before original URI body/metadata. Full-document raw/effective dedup does not dedup a different ack document.

Root must either reserve conservative actual normalized ack space and refuse unsupported combinations BEFORE send (explicit bounded acceptance), or authorize/qualify exact chunk/subrange reconstruction or lossless compressed BLOB representation in that same writer. The latter is not yet authorized here. Every representation needs exact wire SHA/length/integrity/accounting and unknown-outcome retention. A post-send oversized ack is retained unknown, never truncated or called successful.

Named simultaneous arrays can include original32MiB + parsed-original32 + effective32 + source20 + effectiveURI28 + selected20 + WSLstdout32 + WSLparsed28 + WSLdecoded20 + ack32 =276MiB, before Work1 clones, SQLite transaction buffers and allocator overhead. This is a conservative source-derived inventory, not a measured peak. A512MiB envelope is not proven by this arithmetic. Pure resource helpers calculate checked sizes only; they grant no allocation/admission authority.

## Directory semantics and exact missing engine owner

The original file branch enumerates a complete directory listing: filter file/directory, directories first, same-kind JS localeCompare, directory native path.sep suffix. It persists application/x-directory and original URI source. An actual backend must enumerate via retained directory custody, bound a COMPLETE result, preserve names/encoding/native separator and actual engine locale ordering. No truncation or empty-list stand-in is valid.

Data input redetects MIME, so declared application/x-directory is ignored and listing bytes become text/plain. Executing the actual projector confirms Attached directory becomes Attached file and source metadata changes. File media also loses its URI path header; inline-image mentions can deduplicate where URI sources do not. Allocation7 provenance alone does not restore stored user payload or model projection.

Root requested registered Tool/session.context investigation. Exact public source establishes:

- [Tool.transform](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/plugin/src/effect/tool.ts) edits tool definitions. SessionPrompt invokes FSUtil directly for file attachments, not a registered read tool.
- [session.prompt](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/core/src/session/prompt.ts) runs BEFORE materialization. PromptInput exposes URI/name/description/mention, not pre-materialized MIME/data/source or an owned FD.
- [session.context](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/plugin/src/effect/session.ts) mutates projected model messages/tools/settings, not the earlier read or stored user payload. A later rewrite cannot prevent that earlier pathname read or establish original stored source/MIME.
- [Hook registrations](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/core/src/plugin/hooks.ts) dispose with plugin scope. Callback presence is not retained engine authority. Actual Native require_local_engine also rejects nonempty configured plugin launches; a mandatory plugin needs deliberate original launch/lifetime/fail-closed qualification.

No investigated public hook supplies a retained FD/byte-source override at internal SessionPrompt materialization. Keeping the original pathname while holding/rechecking it leaves TOCTOU. A proc/helper/fd URI would change source URI and additionally need an actual retained process/FD transfer/lifetime owner. Tool transformation or after-the-fact context rewriting does not solve the earlier materialization boundary. No upstream engine edit or synthetic Project is proposed.

Remaining concrete owner: a mandatory same-engine materialization/FS provider before that internal read, OR an explicitly accepted semantic transformation with complete stored-source/model reconciliation. Do not treat the current recorded inline transformation as complete unchanged Web parity. These are investigated missing contracts, not an always-deny implementation offered as finished.

## Windows network-path contract

Current original private custody validates local HarddiskVolume roots and rejects remote/UNC. Widening the URI parser cannot create a network-root owner. UNC needs original-writer registration of actual server/share/filesystem/file identity and original OS credentials, held ancestor/file opens with reparse/reconnect/failover/share-delete/hardlink rules, bounded capture plus uncertain-close retention, and explicit restart/revocation behavior. No local remapping, synthetic Project or guessed network credential is authorized. The owner remains missing; no network connection or credentials were used.

## Cleanup and acceptance

No filesystem fixture directory or downloaded source tree was created. Source/patch/generator/goldens/test and one minimal existing coordination/projects/native-web-parity.json receipt remain for Root review/application. Removed paths:none; removed bytes:0; no Windows recovery. Prior real-helper cleanup is retained in its original receipt, not duplicated. No build/dependency/cache/model/engine/WSL workload occurred. Root still owns Rust build/unit checks, allocation7 acknowledgment/resource decisions, engine/backend owners, full workflow/runtime acceptance and the full phase goal.
