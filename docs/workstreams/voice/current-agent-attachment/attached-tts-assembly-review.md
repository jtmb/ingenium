Source-only follow-on d03f95fc; not applied/compiled/tested/runtime-qualified.
Replace the unavailable prepare function with this addition inside actual
request-context.ts. In barge-in insert fenceAttachedTts(call,'BARGE_IN') immediately
BEFORE call.state='fencing'; in End insert fenceAttachedTts(call,'END') immediately
BEFORE call.state='ending'. Keep existing increment/abort/dispose/joins afterward.
Core fence inspects current generation: fencing AFTER increment wrongly tombstones
the resumed generation. Fence/cancel errors retain call.failure and originals;
existing joins then fail closed before releasing lease or claiming completion.

Fresh request grants and private text only. Real source->CPU->spend before
execute; preserve segment order, never retry spent/unknown. Tokens stay private.
Enrolled execution AND cleanup are joined even if the effect never starts.
No agent retirement/cancel/queue mutation.

Root must test forged/cross-call/request/plan, policy/profile/source/auth changes,
claim/reserve/spend errors, spend ACK-loss, cancellation before/inside execute,
generation fencing order, no doubled segment and failed cancel/retirement joins.
No tests ran. No mount/activation. Genuine session/protected profile/approval
remain required; bearer unavailable. Core134/runtime/audio/UI gates remain open.
Retained only unique proposal, removed0paths/0B; same root/budget; no cache/temp.
