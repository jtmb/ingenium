# Native CPU speech consumer proposal

Source proposal only. Native source is read-only; this directory contains the exact
patch and module for coordinator review/application. No runtime, neural module,
audio device, listener, dependency install, native build or UI change was activated.
The native baseline is `268962e20bef8c246fce332241c08c00c1fc2317`.

## Existing authority and resulting behavior

The service's existing `/v1/speech` routes remain the only public speech entry.
`Speech` retains its canonical non-nil request UUID, kind/input digest, private
receipt, publication token and original helper. The same UUID is passed as
`X-Request-ID` for transcription or `requestId` for synthesis/cancel. There is no
second operation history, transcript owner, agent loop or model selector.

`VoiceWorkspace` retains its audio lease and current Work fence. Native `Voice`
retains ASR/TTS IDs, voice session, exact engine turn and control IDs. Native
`live_agent::voice` retains the original service/project/environment/session,
provider/model/variant/agent/settings revision and lifecycle admission/observation
and interruption. Existing tool, permission, steering, residency and persisted
terminal-event rules are untouched. Gateway owner checks remain unchanged.

The optional adapter accepts only explicitly selected `owned-http-cpu`, matching
Veyra service/protocol/instance and `cpu-onnx` readiness, plus an explicit default
advertised by the worker. Absent selection preserves the local-process backend;
invalid or unavailable selections reject, without falling back. Health readiness
does not set native acceptance `qualified:true`. Every response is bounded and
redirects, environment proxies and nonliteral-loopback URLs are refused.

The worker's authenticated original synchronous handler exits `_job` (clears its
job and releases its inference lock) before returning a successful result or a
recognized terminal error. The proposal waits for that original response. A
cancel ACK only requests cooperative invalidation and does not settle anything.
Transport loss, malformed/unknown response, disconnected task channel or unknown
worker error yields `RemoteUncertain`, handled before the generic cancel flag.
Unknown outcomes retain a native uncertain receipt and block new admission and
successful retirement even after the HTTP helper joins. The owner checks both
the in-memory latch and private running/uncertain remote receipts across restart;
changing backend configuration does not clear quarantine. Receipt-retention
failure also leaves the uncertain view blocked. Existing privacy deletion rejects
uncertain receipts. No replay, timer/idle inference or manual-clear bypass exists.

Known local helper execution, owned Windows job termination and positive join
rules remain unchanged. `Speech::stop_until` checks quarantine after polling
helpers as well as before, closing the join/uncertainty observation race.

## Smallest coordinator composition decisions

1. Review/apply `native-cpu-http.patch` to the native baseline only after checking
   `provenance.json` preimage hashes; it changes `speech.rs`, adds
   `speech/http_worker.rs`, and rewires only status callsites in the existing
   adapter Voice and service speech/voice routes. Status comes from the same
   captured Speech owner as execution, never a fresh environment selection;
   service status health I/O runs on `spawn_blocking`. Existing `ureq` 2.12.1
   JSON support is reused; no new
   Cargo dependency or public error enum is introduced. Run native formatting,
   compilation and Rust unit/retirement/privacy tests under the central lease.
   Eight Rust tests per platform are proposed, **not executed here**. Exact application is
   verified by `git apply --check`, which does not compile Rust.
2. In the existing native configuration/composition authority, explicitly set
   `VEYRA_SPEECH_BACKEND=owned-http-cpu`, `VEYRA_SPEECH_HTTP_URL` (only
   `http://127.0.0.1:<port>`), `VEYRA_SPEECH_HTTP_TOKEN_FILE` (private absolute,
   regular non-reparse file), `VEYRA_SPEECH_HTTP_INSTANCE` and
   `VEYRA_SPEECH_HTTP_DEFAULT_VOICE`. Keep process environment immutable for the
   lifetime of the owner. The selected configuration is captured once; later
   environment mutations cannot change the owner's advertised backend/default.
   The proposal supplies custody checks only for native Windows: local
   disk paths, retained non-reparse ancestor guards, existing owner-only parent
   and leaf ACLs, one non-delete-pending plain leaf with exactly one link,
   write/delete-denying sharing, at most 259 bytes read through that one handle,
   and equal before/after file identity/size/metadata and observed byte length.
   It reuses `windows_acl::verify_owner_only` and `windows_file_metadata::inspect`;
   no ACL is changed. Ancestor sharing follows the existing launch-config
   `capture_provision_parent` custody pattern and denies new write/delete handles
   until the bounded read ends; a conflicting existing handle refuses the read,
   without stopping its workload. All retained ancestor metadata is rechecked.
   Missing protection, changed identity/size, reparse/ADS path,
   hardlinks, oversize/invalid token or unsupported platform returns unconfigured,
   without token bytes in errors/debug/provenance. Native Linux CPU HTTP
   composition needs a separately qualified custody implementation; the Linux
   worker itself remains separate source. The worker must independently own dedicated exact-hash
   CPU assets, Python 3.12 dependencies and bounded scratch. Do not reuse Stratus
   credentials/services/assets. No credentials or personal paths belong in UI.
3. Wire the existing SpeechControls/VoiceChat capture limits and text/voice
   validation to native `/speech/status` backend-specific `limits`, `voices`,
   `available` and `configured_default_voice`. CPU input is canonical 16 kHz mono
   s16le WAV, 250 ms–15 s; text is at most 600 Unicode scalars/2400 UTF-8 bytes;
   output is at most 15 s. Reject overlong input and unsupported voices before
   effects. Never truncate, chunk/replay or silently substitute. An explicitly
   stored `af_sarah` remains `af_sarah` and is rejected if not advertised. Only an
   omitted voice uses the explicitly configured HTTP default. Local-process
   defaults/limits remain separate; its installed voice catalog is unverified.
   Existing native continuous-voice status/capture currently describes 20 s and
   SpeechControls 60 s, so UI/native voice composition is a required open gate.
4. Keep the existing native audio response/playback owner; stopping playback
   does not prove worker or agent retirement. Verify native error/cancel paths
   preserve the uncertain original instead of allowing a fresh utterance.

## Unadaptable current protocol gap

The worker has no reconnectable per-request drain/status proof and its configured
instance ID is not a boot epoch. After loss of an original response, neither
health `busy:false`, process restart, cancellation ACK nor elapsed time can
reconcile that UUID. This proposal deliberately stays quarantined indefinitely;
operator restart is not recovery. A separately reviewed authoritative worker
request/boot-identity reconciliation contract is needed for availability recovery.
No activation is approved until the coordinator accepts this behavior and the
dedicated endpoint/process identity boundary. Cross-host/WSL networking is not
implicitly enabled by this loopback-only adapter; an explicit reviewed transport
composition is needed where loopback forwarding cannot preserve that boundary.

## Reproduction and evidence

Run from the owned `parallel/voice` checkout with `PYTHONDONTWRITEBYTECODE=1` and
`TEMP`, `TMP`, `TMPDIR` all set to the existing phase `coordination/voice` root:

```text
python3 docs/workstreams/voice/native-consumer/make_patch.py <read-only-native-checkout>
python3 docs/workstreams/voice/native-consumer/test_contract.py
git -C <native-checkout> apply --check <absolute-native-cpu-http.patch>
```

The generator refuses ambiguous/drifted anchors, never writes native source, and
records exact pre/postimages, inspected owner sources and worker contract hashes.
Fourteen executed dependency-free checks cover real Python Application/_job scope
exit, success, cancellation ACK while the original is still active, original
terminal cancellation, dropped response without a request-specific health proof,
overlong-audio/text and unsupported-voice refusal, patch identity/scope, hard
credential bounds/custody refusal structure, captured-owner status and no neural imports. Structural
Rust proposal assertions do not establish Rust transport execution. Actual Rust
compilation, native ACL/link/reparse/identity race qualification, HTTP fault injection against the compiled native adapter, private
endpoint/asset identity, Windows and Linux CPU inference, actual voices/audio,
VAD/echo/barge-in/latency, visual and full release acceptance remain open.

Task owner: voice chat `01a18935-1617-7d31-8e56-f77df7b6c756`. All retained
deliverables stay within this directory in the existing authorized C-backed WSL
task root. Source/patch/tests/manifest/recipe are the coordinator's concrete
consumer; retire reproducible proposal derivatives after native integration and
acceptance, keeping the minimal source/patch/receipt. No scratch, fixture files,
dependency tree, compiler output or cache is created by this proposal's checks.
No deleted bytes or Windows disk recovery is claimed.
