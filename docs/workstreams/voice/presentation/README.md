# Native current-agent call presentation

Presentation-only proposal against exact Native tree
`4e8e29436cfe42c81cc6401599cf8d224357a928`. Root applied the preceding continuous
voice delta and centrally passed79 APP cases / Native React noEmit. That evidence
belongs to the preceding integrated source; this new presentation still needs
Root review, React qualification and actual render/audio acceptance.

The protected `voice-start` / `voice-active` image pixels were inspected directly.
Their design cues are a sparse dark canvas, a small blue launch button, a blue orb
above a compact control bar, and restrained typography. The proposed CSS uses
Veyra blue and existing canvas/text/control variables. No screenshot/account text
was copied, no image assets or source copies were generated, and no control or
device session was acquired. The orb is static decoration, with no simulated
waveform, amplitude, timer, speech motion or audio capability.

The primary view says **Current agent · Live conversation · this chat**. Existing
dictation/read-aloud controls remain their separate mounted `SpeechControls`
child. The existing chat composer remains the text input; this proposal creates
no new text dispatch path or simulated call. Explicit send consent, read-reply
checkbox, exact voice selector and unchanged start guard remain visible before
start. The concise Mic / End / Interrupt buttons invoke the original handlers,
with their original accessible names and disabled expressions. Check-original,
local playback stop, blockers, and explicit capture export/discard remain visible
outside the technical disclosure. The original session/provenance/limits live in
the existing `AttentionDetails`, forced open for uncertain/recovery state. The
actual transcript has its own accessible disclosure with the original text/audio
recovery actions. The parent attention booleans, compact expansion and audio lease
remain unchanged, so activity/recovery cannot be hidden by the outer toggle.

`call-presentation.mjs` owns only read-only labels. It uses existing service,
active-original utterance, local microphone/playback and recovery observations:

| Observed state | Visible label |
|---|---|
| No local microphone observation | Microphone off |
| Local microphone watching / recording | Listening / Listening to you |
| Original active utterance transcribing | Transcribing |
| Original admission / awaiting reply | Thinking |
| Original synthesizing | Preparing voice reply |
| Original audio ready, no local playback | Playback waiting |
| Local playback observed | Speaking |
| Original control pending | Stopping voice activity |
| Unknown original / retained capture | Check original / Recording retained |
| Disconnected / admission unavailable | Service disconnected / Voice admission paused |

Service `listening` alone never means the microphone is on. Service `speaking`
alone never means audio is playing. A disconnect/pause with the microphone still
observed on says **Microphone release pending**. No state says connected, ready
or qualified merely because configuration is available. Native Voice currently
exposes no tool-event projection, so this patch invents no tool activity indicator.

## Exact proposal and verification

`generate_presentation.py` reads exact blobs through per-call Git safe-directory
configuration and writes only `native-presentation.patch` / `native-provenance.json`
here. It refuses changed anchors, never writes the shared checkout, and records
before/after SHA256 for all seven targets:

- Existing `VoiceChat.tsx` and `VoiceWorkspace.tsx` presentation markup/imports.
- Owned `VoiceCall.css`, pure `call-presentation.mjs` and its declaration.
- Existing `VoiceWorkspace.test.tsx`: fixture/expected GET count is corrected to3
  because the accepted continuous source already added `/v1/voice/status`.
- Four new `VoiceCall.test.tsx` component cases, delivered unrun for Root's lease.

Dependency-free Node tests cover27 phase/negative/precedence cases. Five Python
source tests prove the full VoiceChat effect/handler prefix and VoiceWorkspace
lease prefix are byte-preserved (apart from declared imports), and every inline
click/change/disabled expression survives exactly. They also check no media/motion
asset or non-presentation domain entered the delta. These checks establish source
preservation and label behavior, not browser layout, component rendering or audio.

Regenerate/check with the existing voice coordination TEMP/TMP/TMPDIR and Python
`-B` / `PYTHONDONTWRITEBYTECODE=1`:

```text
python -B generate_presentation.py
python -B test_source_preservation.py
node presentation.test.mjs
```

Root must review/apply the seven targets together, type-check and run the proposed
component/source tests, then inspect the actual native view at desktop/mobile
widths and exercise actual current-agent call, dictation, consent, listening /
thinking / playback / interruption / original recovery. No build, dependency
installation, dev server, browser/control, device, model or GPU action ran here.

## Ownership and cleanup

Owner chat: `01a18935-1617-7d31-8e56-f77df7b6c756`. Sole existing task output root:
`/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845`, the same
authorized C-backed Ubuntu storage and20 GiB ceiling. Durable proposal source and
tests live only in this owned directory; minimal current check evidence lives only
in `coordination/voice/presentation-checks.log`. No scratch/cache/dependency/build/
model/audio fixture tree was created. Removed paths: none; measured removed bytes:0.
Generated patch/provenance retain a concrete consumer: Root's exact review/apply/
qualification, ending at the independently reproducible integrated checkpoint.
Prior originals, frozen packaging/index, Stratus, models/data, unique failure
evidence and all cleanup-refused paths remain protected. No Windows/Linux disk
recovery or VHDX compaction is claimed.
