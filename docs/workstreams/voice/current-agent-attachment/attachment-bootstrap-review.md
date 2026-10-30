# Exact original attachment bootstrap proposal

Owned source only, follow-on to a8babe1a. Not applied, executed, compiled or
runtime-qualified here. Root consumes source and runs its real supervisor tests.

Insert attachment-bootstrap.additions.mjs inside actual ManagedCpuSupervisor;
apply all13 exact splices to that same class; add the four method declarations
and opaque exported AttachmentScopeBootstrap from the declarations source.
Anchors are LF comparison strings; verify the recipe's raw preimage hash first.
Do not replace the whole canonical source or apply to an unrelated revision.

beginOriginalAttachmentScope returns a WeakMap-backed original immediately. It
enrolls its pending Promise before its queue can begin effects. Server generates
bootstrap session ID. The private #queueScope preserves existing openScope
serialization and rejects aborted queued starts before #open. #open installs the
exact new scope into the private bootstrap immediately after #scope creates it,
before controls/recovery/admission awaits. Existing ready reuse captures the
exact reused scope when its actual reference is added. No observer callback or
caller scope DTO can choose a retained resource.

wait returns status data only. Caller/wait cancellation aborts the original,
joins release and propagates unknown cleanup. bind requires a live original and
uses actual bindContext with exact retained ready scope; it never selects current.
After openHostedCurrentAgentCall captures its real lease, release bootstrap.
Every failure path must await release and retain its rejected original on unknown.
release aborts and joins the original opening, removes only its own exact ref,
then stops only that exact scope if no other references remain. Existing legacy
openScope/releaseSession entry points stay available with their established
selection semantics; the new call bootstrap never invokes releaseSession.

Recovery and admission were outside #open's try. The splices move them inside,
check abort after recovery/old-scope stop/admission and before reserve/spawn.
An external recovery/admission rejection may hide an outstanding effect; it is
retained as cleanupFailure, not turned into a successful no-start. A newly created
scope with no external admission/control attempt can be physically closed locally
without inventing a Core control row or no-start ledger receipt. Set the attempt
flag BEFORE reserveControl to preserve ACK-loss custody; only then may actual
retireOriginal reconcile an existing row. Retention failure preserves resource
admission instead of releasing past an unconfirmed ledger write. Launch attempted
without returned child remains unknown. No current/other scope is retired to make
cleanup pass. Root must cover actual recovery/admission cancellation, reserve ACK
loss and spawn failure in its existing genuine supervisor fixtures.

Seven authored fixtures cover scheduling/ref custody/forgery/unknown and recipe
invariants. Extracted scheduling fixture authority is synthetic and only verifies
the bootstrap code's behavior. It cannot qualify actual Core, process or CPU
ownership. Root command from owned proposal directory: node --test
attachment-bootstrap.test.mjs; then actual production strict types and supervisor
negative/cancellation tests. Worker executed none of these.

Production-only missing server inputs now have exact fixed names:
INGENIUM_VOICE_CPU_PROFILE_FILE and
INGENIUM_VOICE_CPU_RESOURCE_APPROVAL_FILE. Root startup passes their protected
files to the immutable measured loader. No generated default profile,
autoapproval, per-call override or user UI file path is permitted.

Root Core134 design names are reserveOriginalAssistantSource(context,
privatePlanHandle), spendOriginalAssistantSource(context, sourceClaim,
actualCpuOperationHandle), fenceOriginalAssistantSources(originalCall,reason).
They are not implemented here. Genuine WeakMap plan owner must consume internally;
inspection DTOs remain data. Scoped ing_ bearer stays unavailable here until its
real auth owner supplies original session binding; legacy bearer handlers remain.

Same existing declared task root/drive/source budget. No generated caches,
dependencies, compiled output, runtime, models, devices, CU or shared writes.
Removed paths none, bytes0. Unique proposal retained for Root integration.
