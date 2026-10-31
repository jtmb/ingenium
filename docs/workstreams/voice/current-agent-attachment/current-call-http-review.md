Docs-only, not mounted/compiled/executed. Copy five source files current-call-http.ts,
current-call-http-protocol.mjs/.d.mts,current-call-consumer.mjs/.d.mts to
services/ingenium-api/lib/voice-v2/. Root adds captureOriginalCurrentCallBody to
ORIGINAL defaultJsonParser verify alongside existing hook, then mounts zero-arg
createCurrentAgentCallRouter ONCE at /api/v1/voice/current-calls AFTER actual
auth/CSRF/authorization. No second parser, Native alias or policy expansion.

POST JSON: /begin=five HostedVoiceSelection fields;
/:attachmentId/{inspect,events,barge,end}={}; /plan={messageId}; /prepare={planId};
/execute={preparedId}. Aliases are selectors for private originals, never proof.
Actual cookie/session/CSRF and fresh scope/source grants gate operations/writes.
One retained pump/read; four consumers,32frames/64KiB each,16KiB/frame. Disconnect
joins exact local waiter; reconnect future-only with gap/resync, no replay. Overflow
detaches exact consumer. End joins actual call/pump/consumers, retaining failures.
prepare selects next unused segment; no retry/play. Await actual typed execute;
validateWav is consistency only. No fixture proves CPU/audio/retirement.

31 unrun pure/negative controls: node --test current-call-http.test.mjs here.
Browser extraction has NEGATIVE-only fixtures. Root must compile and test raw-hook,
mount/auth, pump/barge/End races, unknown joins, revoke/backpressure/reconnect,
Core134 and UI/audio. Failed/fencing states may reject new grants; no bypass.
Private deadline still owns cleanup. Negative-auth End API remains Root's decision.
No shared/runtime/model/device/CU/network effect; removed0paths/0B. Same owned root.
