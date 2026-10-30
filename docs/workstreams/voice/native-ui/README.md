# Native voice frontend integration

Actual frontend source is authored in the coordinator-reassigned
`parallel/native-packaging` checkout, branch
`codex/veyra-parallel-native-packaging`, base
`61c99f8e649da85b600fccec93236b5d6b07f78b`. The exact patch in this directory
contains only the three assigned workbench voice components and four new
`features/voice-ui` helper/test files. Native Git staging/index/commits are
untouched. Three preexisting staged packaging files and their raw working bytes
are protected, with the exact index/working hashes checked before packaging.
The writer transfer is `coordination/native-voice-ui-writer-transfer.json`.

## Behavior and preserved owners

`VoiceWorkspace` accepts optional `compact`, default `false`. The coordinator can
opt its existing shared Workbench mount into `compact`; this worker does not edit
Workbench. In compact mode, idle options begin collapsed behind the explicit
Voice options button. Both actual children remain mounted. Each emits only a
read-only boolean derived from its real recording/listening/playback/preparation,
pending original, transcript, uncertain, error and recovery state. The existing
audio lease's occupied flag also keeps options visible.
The presentation signal is delivered in a layout effect before paint, including
on initial hydration of a retained original; operational effects/timers are unchanged.
No DOM inference, request ledger, transcript owner, new lease or operational timer is introduced.
The outer button cannot collapse attention. Each child details control also
refuses collapse while its real stop/recovery controls need presentation. Existing
policies for scope/current fences, original UUID storage, observer polling,
microphone permission, stop/control admission, cancellation and playback remain
with the original components and native service owners.

The helper reads backend-specific status from the existing native
`/v1/speech/status`. `owned-http-cpu` requires explicit `available:true`, configured
inputs/outputs, bounded valid limits, advertised voice IDs and a default included
in that catalog. Missing/malformed CPU status or unknown backend never falls back
to local processing. `qualified:false` is preserved as acceptance evidence; this
UI does not manufacture ready or qualified claims.

CPU recordings accept the complete canonical WAV only within the advertised
250 ms–15 s envelope (stricter advertised bounds are respected). Reply synthesis
accepts the complete trimmed reply within at most600 Unicode scalars and2400
UTF-8 bytes; malformed scalar/control input is refused. No CPU text prefix or
audio chunk is submitted. Dictation reaching its CPU wall-clock ceiling discards
the complete unsubmitted recording; Stop and transcribe can explicitly submit a
shorter valid recording. Continuous VAD refuses the complete turn if a full frame
would cross its ceiling, or if the ceiling is reached before the existing700 ms
silence boundary. The existing150 ms onset,700 ms silence,150 ms refractory and
request polling intervals remain unchanged. The existing local-process60 s/20 s
capture, boundary tolerance, voice behavior and first2000-character reply preview
remain separate and unchanged for normally configured local use.

Canonicalization/VAD preparation failures are known local refusals, before
allocating/saving an utterance UUID or dispatching its POST. They do not create
an uncertain operation. Any already-admitted session or barge/stop control stays
retained; transport/service outcomes after dispatch still use original uncertain
recovery and are never replayed. No reclassification of an actual unknown outcome
as a harmless refusal is introduced.

CPU voice selection always preserves an explicit original ID. An unsupported
`af_sarah` is shown/refused, never replaced. For a new read-replies session with
no explicit choice, the validated `configured_default_voice` is included as that
exact ID in the original start body. Its returned original voice must confirm
before listening begins. Existing sessions display and validate their actual
native `SessionView.voice`; missing/null does not infer a new default, and Stop
and Check remain available. The UI does not persist or invent another voice
configuration receipt. Native engine/model/effort/tools/permissions and working
session/execution identity are untouched.

## Sequential coordinator integration and checks

1. Integrate the reviewed `native-consumer` Rust/owner proposal first. The frontend
   patch is based on the exact component preimages in `provenance.json`; refuse
   drift instead of replacing another writer's changes. Apply
   `native-voice-ui.patch` in the intended native integration checkout, not by
   changing the protected staged packaging index in the worker checkout.
2. Add native `SessionView.voice` from the existing immutable `Record.voice`, as
   agreed by the coordinator. Preserve omitted/null old values, and expose the
   same original value on start/read responses. No transport/platform/contract
   writer change is made by this frontend worker. Missing support remains an
   explicit recovery refusal, not a fabricated old default.
3. Add `compact` to the existing shared Workbench `VoiceWorkspace` mount if the
   compact layout is desired. Its default-false behavior supports older callers.
   Keep existing shared request functions, owner/current fences and composer
   lease binding; do not remount/unmount children when collapsing options.
4. Schedule the two model-free Vitest sources with central leased dependencies:
   `apps/web/src/features/voice-ui/capabilities.test.ts` and
   `apps/web/src/features/voice-ui/VoiceWorkspace.test.tsx`. Fifteen source cases
   cover strict CPU limits/catalog/default, Unicode/UTF8 and complete duration
   refusal, legacy behavior, real child receipt attention, forced stop/recovery
   visibility, no remount, no-POST oversized text, unsupported/missing original
   voices and malformed retained storage. These sources do not acquire devices,
   load models or run inference. **The worker has not executed these tests.**
5. Run native web typecheck/build and actual browser interaction/visual checks at
   normal/compact widths and keyboard/scaling/theme conditions. The boolean
   presentation contract is source evidence until those checks pass. Central
   native speech/backend composition must also reject overlong server-produced
   continuous replies without silent text truncation; the browser cannot inspect
   a reply before the native engine creates it.

Worker evidence is source review, exact fixed-base patch/pre/postimage hashes,
protected raw index/packaging preservation and text whitespace checks. Native
Rust/type/React/browser execution, real audio/devices/VAD/echo/barge-in/latency,
assets, platform parity, visual and all original release acceptance stay with
the coordinator. No runtime/device/build/download/Computer Use work was invoked.

## Regeneration and cleanup

Run Windows Python/Git from the existing authorized C-backed task root, with
`PYTHONDONTWRITEBYTECODE=1`, and `TEMP`, `TMP`, `TMPDIR` set to that phase's existing
`coordination/voice`. No temporary files or dependencies are required:

```text
python -B docs/workstreams/voice/native-ui/make_patch.py <native-packaging-checkout> <coordination/voice/native-ui-preflight.json>
```

The recipe uses read-only `git show` and exact source bytes with optional Git locks
disabled, verifies the original base/branch and protected index/packaging hashes,
and writes only this exact patch and manifest. Native source remains uncommitted
and unstaged for the coordinator's integration consumer. APP documentation is a
separate owned checkpoint. No scratch, cache, dependencies, compiled output,
audio or fixture files were created. Retain the seven source/helper/test files
and minimal patch/recipe/manifest until the coordinator accepts integration;
retire reproducible proposal derivatives after that consumer closes. No deleted
bytes or Windows disk recovery is claimed. The existing native index/staged
packaging data are protected inputs, not cleanup targets.
