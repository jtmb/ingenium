# Current-agent call attachment source proposal

The call attaches to the existing authenticated chat/working-agent owner. Its
canonical conversation, source/memory, agent/provider/model/variant, workspace,
permissions, tools, queue and goal stay with that owner. The call owns speech
and its authenticated subscription. Barge-in stops/joins speech; End call also
joins the subscription. Work continues. There is no second chat, Run, agent
loop, model quota or agent-retirement proof.

This is concrete source for Root review/application, not applied or qualified
runtime. Ordinary attachment availability does not require upstream execution
settlement. Existing CurrentAgentVoiceAdapter/Core owned-agent-turn guards stay
intact. The separate current-agent-original audit concerns that narrower path.

## Application and fixed constructors

- attachment.mjs: API voice-v2 attachment lifecycle, actual stream acquisition,
  reader/pump joins, message/control and speech presentation.
- hosted-owner.mjs: API adapter to actual request-context helpers, exported
  opencode-client request function/streamEvents, same Core receipts and original
  agent-control owner. No positive execution observer/proof constructor.
- request-context.additions.ts: append to actual request-context.ts. Reuses its
  existing private WeakMap and imports. Exact preimage and proposed postimage
  hashes are in receipt.json; Root must compare before applying.
- 132_voice_attachment_deliveries.sql: Root-reserved SQL132 in the SAME Core
  migration/database writer. No additional database or scheduler.
- delivery-owner.mjs: Core factory with actual getDb and synchronous private
  assertHostedVoiceAttachment. Export through existing Core package.
- Three test files: 8 attachment +5 SQLite owner +4 hosted adapter cases;
  originally authored; Root reports17/17 PASS. Follow-on cases are described in
  selected-state-review.md; this worker executed none. Fixtures are not acceptance evidence.

Root wires actual private context helpers, Core delivery owner, exported request
and opencodeClient.streamEvents into hosted-owner; then constructs attachment
with that private context/scope, callId, call-scoped speech owner and event sink.
Constructor ports/browser scope are not authority; no singleton is started here.

The private context revalidates principal, canonical source, deadline, scope and
actual runtime/selected session. READ protects events/speech; project+content
WRITE protects messages/control. Configuration hashing is selection metadata,
not execution proof. See selected-state-review.md for the concrete shared fence,
its uncovered writers, and actual auth/source/concurrency qualification gates.

## SAME queue and durable receipts

Pinned prompt input supports caller id (existing client messageID mapping).
hosted-owner uses the same-session /prompt inbox with id/text/delivery:queue|steer,
without model/agent/system/tool overrides. ACK must echo ID/session/delivery.
Root must reuse any additional canonical typed-message/source/memory preparation;
the existing engine stays transcript writer. Legacy formatter omits delivery.

SQL132 records immutable caller request ID, kind, full nine-axis scope JSON/hash,
input hash and original message ID. It contains no plaintext text/audio or
Run/chat/quota/retirement fields. Input hash binds text/delivery/configuration.
Same Core writer records intent before send; a private handle claims once.
Actual ACK gives metadata ack; failure/mismatch gives unknown. An abandoned
intent after restart reads unknown/spent. Never replay it, even unchanged.
Changed hash/message identity conflicts; terminal metadata cannot reopen.
4096 receipts per full scope bounds growth. Preserve spent identities rather
than deleting them to retry. Root registers/validates SQL132 through its existing
migration system and tests actual same-writer/restart behavior. No migration ran.

Explicit Cancel agent requires actual authenticated human intent, fresh WRITE
and original agent control capture/dispatch. That owner supplies the REAL original
message identity; no invented HTTP control ID or idle-based reconstruction.
Its ACK stays pending, unknown stays unknown; original work owner retains
settlement. Missing cancel capture affects only that explicit action, not ordinary
call attachment. End/barge-in never invokes agent control or releases quota.

## Owned resources and UI integration

Subscription retains original open Promise before fetch, exact reader and pump.
End/reconnect abort acquisition, cancel reader and positively join originals,
including pending headers and callback delivery. No timeout-to-success. Body
cancellation failure retains cleanup-unknown. Every emitted event revalidates
read/source/runtime/selection and matches exact selected session; explicitly
mismatched locations and global/unrelated events are dropped. Frames/chunks
are bounded256KiB; dedup2048 IDs; speakable selected text16 entries. Cursor
advances only after sink delivery. Reconnect never resends messages.

Speech port transcribe/speak/cancelOwned is the actual call-scoped managed
STT/TTS/audio owner, retaining its own CPU jobs/helper/witness/device handles.
Completion/cancellation must await real originals, not timers/booleans or whole
shared-runtime kill. Preserve other calls. Speech authorization is generation
fenced after awaits before CPU dispatch. TTS accepts only actual observed
selected assistant text. Root uses existing qualified chunking and call-scoped
CPU operations; never fabricate a retired agent parent or voice-agent-turn.

Route/UI agent-call mode through this attachment, not existing VoiceService.submit
or VoiceSession owned-agent completion logic. Display attachment/agent/model,
message pending/delivered/unknown separately from actual tool/permission activity.
Permission/forms keep existing canonical UI/owner without autoanswer. Barge-in
and End join only call speech/subscription; Cancel agent is a distinct action.
Event succeeded/idle is display metadata, never proof. Conversational voice can
also attach to the same chat; automatic generation interruption separately needs
its genuine original owner/plugin boundary. Preserve all full-agent guards.

## Validation and reconciliation

Root-only command from this directory with original task-scoped TEMP/TMP/TMPDIR
and Node caches disabled:

    node --test attachment.test.mjs hosted-owner.test.mjs delivery-owner.test.mjs selected-state-admission.test.mjs

The follow-on has29 authored tests, not run by this worker. SQLite fixture is in-memory; Root also tests
its actual writer, auth/source/queue/selection races, stream joins, durable
restart, CPU cleanup, UI and attended audio. Static body parse does not qualify
module imports, TypeScript, SQL or runtime. No worker build/interpreter/model/
runtime/device/CU/shared-write/database effect or bulk/cache/temp output occurred.
Removed paths:none; bytes:0. Minimal source/receipt retained for Root integration;
no disk recovery claimed.
