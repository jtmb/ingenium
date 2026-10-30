# Attached-call assistant speech parent: bounded design for Core134

PROPOSAL ONLY. Root semantic review, original constructor/raw reader, migration,
Core/API integration and actual acceptance are required before activation.
No runtime/build/model/CU, fabricated completed operation or shared write occurred.

## Grounding and blockers

VoiceService.submit currently reserves voice-agent-turn, then settles completed
using result.retirementProof; synthesize/speechSequence require agentCompleted and
exact resultText. Owned sequences require agentOperationId. Core reserve checks
the parent is a terminal/completed voice-agent-turn with result_fingerprint.
Core128 parent_operation_id has a real FK to veyra_voice_operations. A source UUID
in a second table cannot simply replace that parent or pass an OR lookup. Hosted
resource authority refuses voice-agent originals; attachment never owns their
physical retirement. Do not relax those old guards, fake a completed parent or
treat lack of an agent proof as permission to retire it.

Attachment.speakObserved currently retains session.text.ended event.text in a
16-entry map, then passes that text/source DTO to speech.speak. This is insufficient
for the requested fixed original observation constructor. Selected authenticated
SSE is a wakeup/selector; new owner must itself read actual selected engine bytes.
No browser DTO/event/hash, positive callback or arbitrary read port can mint one.

opencodeClient.getSessionMessage actually GETs /api/session/{id}/message/{id} after
getV2Session. But mapV2Message derives text/reasoning part IDs when v2 omits ids,
and unconditionally appends step-finish with completed-or-created time. Neither
synthetic part ID nor step-finish establishes native part identity/completion.
V2 content text parts have optional native id and real content-array index.
Current exported method loses raw index/type/provenance and does not expose a
bounded original raw-body snapshot. A new INTERNAL bounded raw reader is required;
do not guess a part identity or use mapped completion to bypass this blocker.

ManagedCpuSupervisor shares a same-scope control across up to16session IDs.
Scope/control equality alone is not an active attachment incarnation check.
Its reserveCpu hashes `synthesize\0` plus JSON({requestId:operationId,text,voice}).
ManagedCpuSpeech first redacts, then CR-normalizes and segments. Raw observation
SHA/range, derived segment SHA, and CPU input SHA are distinct facts.

## Minimal parent topology authorized for proposal by Root

Leave Core128 SQL and all historical original JSON/hash bytes unchanged. New TTS
originals ONLY may carry the optional explicit AssistantSpeechSourceTag, validated
as a closed version1 shape. New source-backed TTS has parentOperationId NON-NULL
and equal to controlOperationId, pointing to its genuine already-running original
voice-cpu-supervisor. This fulfills the existing real FK without an agent row.
That control is speech-resource parent, never a completed-agent surrogate.

Core134 source rows have an FK to THAT control operation, not to an invented agent.
New source branch requires kind TTS, synthesize CPU identity, matching running
control, original owner/boot/profile and existing admission/epoch/deadline checks,
same nine-axis scope, active private call/generation and exact derived input.
Legacy originals with NO tag retain the exact prior voice-agent parent guard.
Steer/queue/STT/agent/control cannot carry the tag or use its source branch.
Malformed/null/unknown-version tags refuse, never fall back to legacy parsing.

## Original observation construction

Fixed module-owned observe(context,originalActiveCall,messageId,signal) resolves
the real call WeakMap, authenticated selected private chat, runtime placement and
live original control; verifies current private-content/project read/speech rights
and call/turn generation. It uses the ORIGINAL selected transport/credentials and
directory, not a caller URL/runtime object. Revalidate after every async read and
before durable record/admission. Do not perform mutations, model switches or runs.

Internal raw reader must bound actual response bytes BEFORE JSON parsing (1MiB),
parts256, role assistant, exact raw message/session/selected agent and directory.
Missing/mismatching identity, malformed UTF8, error/nonconversation/unknown shape,
reasoning/tool/file/system/user data all refuse. Use actual native part id when
present, otherwise RECORD content index plus raw payload/snapshot hashes as an
explicit observation locator; never label an invented ID a native part ID.
No finish/time/event field is required or interpreted as agent/goal completion.
Meaning is only: these authorized plaintext bytes were observed at this instant.

Source text is exact UTF8 scalar-aligned range of raw assistant TEXT content,
max32000 scalars/128000B. Fixed owner derives ranges; caller supplies no offsets.
For appended observations, check previous raw prefix SHA before accepting only
new nonoverlapping bytes. Changed/truncated prefixes refuse; no rewritten prefix
is read aloud as if it were an append. Record part index/native optional id,
raw payload SHA, whole-part snapshot SHA/bytes, prefix SHA, range SHA/start/end.
Text stays in a bounded private original WeakMap and is discarded after its last
actual speech consumer joins; durable records contain no text/transcript/audio.

Trusted private speech owner captures the configured redaction/normalization
policy, actual immutable voice/profile and deterministic segment plan. Derive
planHash from policy/profile/voice, sourceHash and ordered segment metadata;
derived offsets must NOT be mislabeled raw-engine offsets after redaction/CR
normalization. Max512 segments, existing per-child600scalars/2400B preserved.
It binds each exact operationId and original serialized payload digest privately.
Core assertion resolves that private retained original; copied tags/UUIDs/context
objects or generic ()=>undefined ports cannot grant production authority.

## Core134 storage and SQL invariants (Root owns final migration)

Three bounded metadata concerns must remain explicit:

1. Immutable sources: metadata in assistant-speech-source.contract.ts; source UUID
   PK, closed canonical metadata/hash (omit sourceHash before hashing), nine axes, call/turn generation, control FK
   ON DELETE RESTRICT, owner/epochs/deadline and raw observation provenance.
   Unique original range and overlap refusal per scope+call+message+part across
   generations: incrementing generation cannot replay an already spent range.
   Limits64 sources per call,16384 retained rows,8MiB metadata; fail capacity,
   never evict to make a spent source fresh. New call may explicitly reread only
   through a NEW genuine user-owned call/observation, not automatic resume.
2. Immutable plan/claims: same Core transaction as TTS reserve, source FK, exact
   planHash/voice/profile/segmentCount/index/segmentSHA/inputSHA and operation UUID.
   All segments of one source must have the SAME planHash/profile/voice/count,
   enforced on SQL insert even when indices differ; a changed plan cannot consume
   unused indices. One committed claim per source+segment, unique operation ID. Existing claim
   returns duplicate/unknown, never a new permit; changed identity/input refuses.
   An abandoned reservation is spent even when no HTTP/audio result is known.
   No claim release on barge-in/End/restart. Claiming does not settle any agent.
3. Append-only restore tombstones: no FK to possibly absent post-snapshot control
   or TTS operation; immutable source/claim identity metadata+hash only, NOT an
   executable source/owner. This is needed because active source FK cannot be
   reinserted when the old snapshot lacks its genuine control. Never seed a
   control/agent operation to satisfy a restore FK. A tombstone spends the source
   forever in its original call namespace, without granting content or TTS rights.

For all three: BEFORE INSERT collisions must RAISE(ABORT) for duplicate identity
or incompatible range/plan, including OR REPLACE/IGNORE under recursive0/1;
BEFORE UPDATE and DELETE refuse. SQL insertion of a source must verify actual
control kind/scope/owner/generation; TTS insertion must enforce explicit tagged
branch, parent=control, source exists/current metadata/hash, exact claim and no
tombstone. Legacy insert branch stays exact prior agent-parent restrictions.
SQL constraint checks reinforce storage consistency; actual private observation
authority is still mandatory. Direct DB writers do not acquire a speech handle.
No production source creation or positive authority implementation is supplied.

## Restore, cancellation, readers and recovery

Original maintenance owner quiesces and retires speech producers through existing
real CPU ownership before swapping; capture a bounded metadata-only source/claim
ledger in HMAC capsule BEFORE swap. Missing/malformed old capsule/schema requires
the already-established verified-original rollback DB upgrade gate, never empty.
Merge same-writer transaction union of restored+captured originals, refuse any
same-key identity/plan/input conflict before writes. Spend ALL restored/captured
sources as tombstones, including rows only in the snapshot; preserve full minimal
immutable provenance in tombstones even when original control FK is absent.
No restored/private observation handle, replay, new control row or auto TTS.
Old live handles must be fenced by actual maintenance call invalidation even if
the API process survives restore. UUID/hash alone never resurrects authority.

Core128 metadata readers reconstruct original_json and preserve the optional tag;
read/cas/settle/CPU retain/result/retire logic remain real original CPU operations.
privateRead/recovery retain the actual control association; source acceptance
cannot release a control lease, retention or quota. listControls/CPU tree recovery
still use supervisor kind/control IDs, never source row state. Audit any reader
that assumes every TTS parent is an agent before activation; parent may now be
an explicitly tagged real CPU control. Source/control/claim hashes are immutable.

Attachment gets separate observe-and-speak source flow, not VoiceService.submit
completion. Barge-in/End fence the original private call generation, cancel/join
only actual speech/output/subscription originals and retain spent claims. Agent
goal continues. Service legacy synthesize and completed-turn path stay guarded.
No resultFingerprint or fake agentCompleted flag is populated from observation.

## Required acceptance before Root activates

Raw-reader bounded real-response/provenance checks; forged/revoked/cross-call/
cross-generation/wrong role/part/range/agent/model cases; redaction/profile/voice/
segment/payload mismatches; immutable/overlap/dedup SQL recursive0/1; legacy exact
original bytes and guard behavior; same-transaction claims/rollback; restore old
snapshot+post-snapshot source with missing control, tombstone no replay, legacy
HMAC upgrade; genuine CPU resource admission/result/retirement unchanged; actual
audio/barge-in/End while agent work CONTINUES. No fixture substitutes full tests.

Only minimal typed splice sketch is supplied. Missing raw constructor, schema,
claims/tombstones, caller wire and actual original authority are OPEN blockers.
Root reserves134 and final migrator/semantic review. No activation implied.
