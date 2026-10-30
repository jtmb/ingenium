# Native local microphone mute

Bounded local-capture proposal against the exact prior presentation outputs:
Native tree`4e8e29436cfe42c81cc6401599cf8d224357a928` plus presentation patch
`4b29dacb1a5edcde8b3a4175d0983f54b5c5a477e02ad2329344e35e3777475f`.
The VoiceChat preimage is SHA256`8917e7ed36c1486b2a0a8b0fcb71184c5ec1568bfb5d7f021fca4f8f980cd9e5`,
live-checked against Root's applied presentation. Root may compose by the recorded
per-file preimage hashes; this worker never edits the shared Native checkout.

## Capture and playback fences

The old `releaseMic` increments the same generation used by the claimed reply's
ended acknowledgement, clears `watching` and releases the call. It remains the
global End/scope/disconnect/uncertain fence. Reusing it for local mute would lose
legitimate played ACKs and disable automatic playback authority.

Local mute now calls **releaseCapture** only. An independent `LocalCapture` epoch
and explicit capture intent own microphone permission, tracks and processor graph.
They own no session, turn, transcript, model, native operation, player or receipt.
Mute cancels this capture epoch, removes the processor callback, stops tracks
promptly and disconnects/closes its microphone-only graph. It preserves the full
queued or in-progress source, including an onset not yet confirmed by VAD, for
the existing explicit export/discard controls. It clears the pending capture
buffers without flushing them. Capture/frame submission also requires current
capture intent, so original polling while muted cannot submit a held recording.

Mute changes none of the original call generation, `watching` (read-reply authority),
`paused` (original-request uncertainty), active agent, player, played set, claim or
durable request identity. The entire existing claim/playback/ended-ACK code is
byte-preserved. Already claimed audio can end and acknowledge the same child while
muted or while unmute checks/permission are pending. No mute/unmute control POST,
agent abort, call end, new utterance or replay is introduced.

The existing call retains its one audio-lease token while it owns automatic reply
playback, even with actual microphone tracks stopped. This is metadata ownership,
not a retained device stream. Explicit unmute reclaims that same lease rather than
creating another audio owner. Global End and original-owner retirement retain
their prior lease/fence/recovery behavior.

## Explicit unmute

Unmute rechecks the current view/call generation and original session UUID, fresh
owner, project/chat binding, original voice/read consent, supported original voice,
fresh backend/limits and capture protocol. It refuses stopped/uncertain/unknown
originals, pending control/recovery, changed owners/capabilities, missing consent,
an unconfirmed played claim without its actual player, and retained unsubmitted
source. It uses existing GET routes only, then rechecks the same original fence
and audio lease before asking for permission. It never starts a replacement native
session or changes the selected agent/model/tools/permissions.

The mic control can mute actual capture or cancel pending permission. A stream
returned after mute/view revocation is stopped before publication. A microphone
ending unexpectedly becomes a local mute, not an agent/session interruption.
Reconnect, owner/view change and global stop cancel capture intent; no completion
of an old permission request or cleanup promise automatically reacquires it.
Original read-only polling/recovery continues while muted. A fresh explicit mic
action is always required to resume.

Cleanup is observed conservatively. A still-pending context close gates a new
explicit open. A failed track/graph/context release retains the exact failed
resource/error in the local controller, blocks replacement devices and shows
**Mic unknown / Microphone needs attention** rather than claiming the mic is off.
There is no automatic retry, fallback, forced teardown or lost failure witness.

## Source and tests

`generate_local_mute.py` imports the frozen presentation generator in memory,
applies closed anchors, and writes only the current patch/provenance here. Seven
targets are web-only: VoiceChat, the existing presentation helper/declaration,
new local-capture helper/declaration, five canonical `LocalMute.test.tsx` component
cases, and the existing retained-session action-name test update. No backend,
contracts, operation owner or schema is changed. The15 s ASR /600-scalar,2400-byte
TTS /15 s actual output bounds are unchanged.

Eighteen dependency-free Node device-fixture cases cover positive track/graph
release, explicit fresh-device unmute, pending permission/context cancellation,
owner revocation, lease refusal, permission rejection, missing/ended tracks,
source retention, cleanup gates/failure handles and an independent legitimate
played-ACK fence across capture changes. These are inert objects, not OS devices.
Seven Python source checks additionally prove the actual Native claim/ACK code,
original poll/control paths, global End fence and mutating request count remain
unchanged; local mute touches no call/claim authority and unmute uses only GETs.

The five new canonical React cases are **delivered unrun** for Root's lease. They
exercise the actual Native component with inert device/audio/HTTP boundary
fixtures: release without ending its active original; incomplete-onset retention
and explicit discard before unmute; the exact original claimed played ACK through
mute/unmute; no automatic reconnect or changed-owner reacquisition; and cancelled
permission cleanup without prompt/control/session mutation. They qualify no model,
browser hardware, audio, engine, supervisor or production operation owner.

Regeneration/checks, with the already declared coordination TEMP/TMP/TMPDIR and
`PYTHONDONTWRITEBYTECODE=1`:

```text
python -B generate_local_mute.py
python -B test_source_preservation.py
node local-capture.test.mjs
```

Root must independently review/apply exact preimages, run new React types/component
checks and existing voice regressions, then qualify actual native capture release,
claimed audio, permission races, same-owner unmute, scope/reconnect recovery,
Windows/Linux and full live audio/release gates. No builds, installs, downloads,
services, control, real devices, models or GPU actions ran in this worker.

## Ownership and cleanup

Owner: chat`01a18935-1617-7d31-8e56-f77df7b6c756`. Sole existing task root:
`/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845`, the original
authorized C-backed Ubuntu storage and20 GiB ceiling. Sources/proposal/tests live
only in this owned directory; minimal current evidence lives only in
`coordination/voice/local-mute-checks.log`. No source snapshot, copied dependency,
build/cache/temp/model/audio fixture file or actual device resource was created.
Removed paths: none; measured removed bytes:0. Patch/provenance remain required
for Root's exact review/apply/qualification until an independently reproducible
integrated checkpoint exists. Other files are durable source/tests/recipes.
All protected originals, frozen packaging files/index, data/models/Stratus and
cleanup-refused targets remain preserved. No Linux/Windows disk recovery or VHDX
compaction is claimed.
