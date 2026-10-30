# Lossless bounded continuous voice

This is a review-only Native delta plus owned APP implementation. It keeps the
existing Voice session, original utterance UUID, exact model/agent scope, sole
transcript writer and original engine admission. It does not qualify real audio.

## Source behavior

The APP `segments.mjs` partitions exact UTF-8 speech source or normalized PCM
without overlap, padding or dropped tails. ASR partitions remain 250 ms–15 s;
a short final tail is balanced with its predecessor. Text partitions default to
160 Unicode scalars / 640 UTF-8 bytes, below the unchanged worker ceiling of
600 scalars / 2400 bytes. The actual returned WAV must still pass the existing
15-second output validator. A rejected/unknown child is never resized or replayed.

`SpeechWorker.synthesizeSequence` redacts the **whole** reply before partitioning,
retains the original and derived-source digests, and uses the existing injected
operation owner to reserve each child before dispatch. CR→LF is an explicit
spoken-source projection; the stored original reply is unchanged. Source offsets
refer to the derived spoken source, since the injected redactor has no offset map.
`VoiceSession` submits one original prompt, retains the full raw reply, and advances
the sequence only after the existing playback promise resolves. Cancellation and
reconnect fence the original generation. No generated audio or prompt is replayed.

The optional direct APP sequence port is implemented and tested through the real
session/service/worker adapters with inert transport/model/ledger fixtures. The
legacy APP HTTP one-shot route remains one-shot: oversized text is refused before
effects instead of clipped. No streaming HTTP claim/ACK authority is fabricated.
The concrete Native proposal supplies the long-turn browser/service composition.

APP capture overflow retains the complete crossing PCM frame, stops the microphone,
and emits no partial utterance. The panel exposes explicit export/discard recovery.
Confirmed unsubmitted capture also survives a local pause while this view remains
open. Normal silence-separated utterances rearm as before. The exports are explicit
binary source formats (one JSON header line followed by original PCM16LE bytes, or
Native original Float32 frame buffers with lengths/sample rate), not model fixtures.
Closing the view loses unsubmitted browser-only source; the UI says this explicitly.

## Native proposal and exact preimages

`generate_native.py` reads only Git blobs from tree
`a04ab38bd0e0c7b96f40689733cad3f2332b9a0b` and emits
`native-continuous.patch` / `native-provenance.json` in this directory. It refuses
unexpected transformation anchors. It never edits the shared Native checkout.
Run with Python `-B` and the already declared voice coordination TEMP/TMP/TMPDIR;
no dependencies, source snapshot, build directory or cache is needed.

All six target files must be reviewed together:

- `crates/adapters/src/voice.rs`: existing private original owns capture and child
  descriptors, full reply, one engine admission, serial bounded child operations,
  exact playback claim/ended acknowledgement and cancellation of every child.
- `crates/adapters/src/voice/segments.rs`: pure exact partitions and two source tests.
- `crates/adapters/src/voice/continuous_tests.rs`: five actual in-memory Voice owner
  tests; engine/model/filesystem effects panic or are replaced by receipt hooks.
- `crates/adapters/src/voice/privacy.rs`: all child IDs join existing deletion and
  cross-chat ownership checks; private original audio is cleared with its record.
- `apps/service/src/routes/voice.rs`: negotiated aggregate capability and exact
  original-child claim/played route under the existing router/owner.
- `apps/web/src/features/workbench/VoiceChat.tsx`: our Native React consumer,
  negotiated aggregate capture, full crossing-frame recovery/export/discard,
  source-waveform digest validation, durable claim before playback, exact ended
  acknowledgement, and no automatic playback after reconnect.

The Native record retains the full canonical original WAV and exact raw reply.
One logical capture is at most 60 s, but each Speech ASR call is still at most15 s.
The existing record cap becomes8 MiB and admission reserves512 KiB for reply/child
metadata before effects. The JSON route limit becomes3 MiB for a maximum2.56 MiB
base64 capture. Existing records are compatible via serde defaults. Full originals
are never evicted to admit another turn; quota refusal requires original recovery.
This resource change needs coordinator review, and every outer HTTP/proxy body
limit must permit the same bounded body. It does not widen neural worker limits.

The current child WAV is retained until its exact browser ended receipt is durable
or original cancellation is proven. Audio capacity refuses new data instead of
evicting unresolved waveforms. Failed acknowledgement persistence rolls back the
in-memory optimistic state, so it cannot advance the next inference. A120-second
playback wait expiring leaves an uncertain original and retained source; it never
fabricates playback completion. A claim is not an ended acknowledgement.

## Verification and remaining gates

The dependency-free Node suites pass79/79 (10 continuous,29 session,7 transport,
13 current-agent,6 browser,4 work-admission,10 CPU ownership). They exercise ordinary
repeated utterances, long/Unicode/whitespace replies, exact boundary/tiny-tail PCM,
whole-source redaction, playback backpressure, cancellation, reconnect, ledger
refusal, retained crossing frames and explicit recovery. No real neural output,
device, service, socket, GPU, download, build or installation ran.

The native Rust source tests are delivered **unrun**, and React has not been
type-checked or rendered by this worker. Coordinator must apply/review the exact
delta, run focused Rust/React checks in its resource lease, and test actual CPU
supervisor/operation retention, browser playback/echo/VAD/barge-in, multi-child
reconnect/cancellation, quota/body limits, private persistence/deletion, Windows
and Linux, screenshot/workflow acceptance and the unchanged full release gates.
The APP child-ledger composition also needs the coordinator's actual ledger port;
the inert fixture is not a production reservation or retirement proof.

## Provenance, storage and cleanup

This extends the existing read-only Stratus-derived segmentation, normalized audio,
turn cancellation and playback concepts documented in the parent voice workstream.
Stratus sources and its GPU/live-test hold remain untouched. No upstream OpenCode
Web, shared Native source, model, credential, profile, runtime or frozen packaging
input was changed by this worker.

Owner is chat`01a18935-1617-7d31-8e56-f77df7b6c756`; the sole existing output root is
`/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845`, on its existing
C-backed Ubuntu physical storage under the original20 GiB ceiling. Source/proposal
files live only in `parallel/voice`; current minimal test evidence lives only in
`coordination/voice/continuous-node.log`. No scratch/dependency/build/cache/model/
audio fixture output was generated. Removed paths: none; removed bytes:0.
The patch/provenance are retained for exact coordinator review/application; their
last consumer ends after integration and an independently reproducible checkpoint.
Generator, pure helper, native source tests and owned APP edits are durable source.
All prior cleanup-refused paths remain protected. No Linux/Windows free-space
recovery or VHDX compaction is claimed.
