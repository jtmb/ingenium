# Current-agent original execution boundary

No genuine current-agent settlement producer was implemented by this audit.
The inspected Native and hosted APIs do not expose the original upstream agent
execution join. Real provider-request cleanup is reusable but narrower. An
unavailable adapter, a mock observer or an HTTP-idle receipt cannot close this
feature. The full original Voice and parent release goals remain open.

Root subsequently selected ordinary **current-agent calls as attachments** to
the existing work/chat/goal owner. That path does not own agent execution and
does not need to retire it. Its speech and authenticated event subscription
have their own real cleanup; durable message delivery stays in the same chat
queue. The missing execution producer documented here must not disable that
attachment. Explicit agent cancellation stays a separate pending/unknown
operation of the original agent owner. The owned-agent-turn path and generation
interruption still require the genuine boundaries described below.

`source-facts.json` records exact bytes/hashes and line anchors of inspected
preimages; no Native/API preimage was changed. `acceptance-cases.json` records
the still-required positive runtime and failure tests. It contains no passing
fixture claims. Source/metadata inspection does not qualify a runtime.

## Actual owners and limits

| Existing constructor | Real retained authority | Missing authority for this feature |
| --- | --- | --- |
| `ModelWorkOwner::reserve` | Model observation/lifecycle command and original blocking workers | Its `ModelWorkIntent` has Observe/Command; this is not the selected chat's agent loop or tool executor. Adding an unrelated model command would create different work. |
| `ProviderQueue::enroll/claim` | Original ingress, fixed grant/payload, spent call IDs and the existing dispatch book | Does not construct canonical selected-agent context or own the upstream execution that generated requests. |
| `ProviderAcquisition::claim_once` | Current durable grant, Native engine candidate, model residency and provider-attempt journal | Existing task claims require the real engine candidate and registered task; a forged grant is not a Voice admission. |
| `TransportSupervisor::start` and `retirement::joined` | Consumed exact claim, retained driver/relay tasks, original request socket/native retirement barrier | Provider completion cannot join subsequent agent parsing, tools, background jobs or finalizers. The generic purpose is sealed to TaskPurpose and MemoryPurpose. |
| `TaskRequestRetirement::join/check_current` | Closed task provider ingress and exact captured acquisitions | Closing request ingress is not an upstream tool-scope census or runner join. |
| `TaskActivity::terminal::continuation_ready` | Original terminal consumer, readers, requests and local scheduling workers | Relies on terminal observation of the remote engine; it does not obtain the engine's execution fiber. |
| `NativeEngineOwner` / retained tree exit | Original persistent serve process and version probe, engine epoch and whole launch trees | No per-turn process/tree is launched here. Whole-engine stop would violate the current scope. |
| `LiveRuntime::prompt_scoped_checked_local` | Exact session/model/project prompt journal and admission identity | `ActiveTurn` stores timestamp baseline/admission metadata. Its interruption terminal check uses session idle and message reconciliation, not an agent join. |
| Native retained follow-up/control objects | Immutable selected original, one-shot sends, exact current checks and retained observations | They use the same public HTTP control and history endpoints. Their reader join is local response cleanup. |
| Native terminal/process-job owners | Real owned shell/process tree and local output/worker lifetimes | No Veyra-owned outer loop currently dispatches the entire selected registry. Upstream plugin transforms can wrap real tool executors, as detailed below; human terminals alone do not supply the registry. |

`TaskToolsObservation.loaded_baseline` is explicitly absent in the retained
tool observation implementation. The saved-task context/tool APIs observe
engine context, slash commands and instruction edits; they do not export a
complete rendered current-agent baseline plus a transferable tool executor.
This is a limitation of those Native observation endpoints, not a claim that
upstream plugin hooks cannot capture rendered per-request context.
The permission rules/fingerprints are useful current-owner checks, not a way
to reconstruct all tools or substitute authorization semantics.

The earlier thirteen uncommitted Native draft files are a managed CPU speech
worker proposal: profile, STT/TTS transport, journal, channel, process tree and
Job support. Their retained provenance expressly says unapplied/uncompiled.
They contain no current-agent original producer and were preserved byte for
byte. No stale generated Native patch was applied.

No `TaskRunner` identifier was found in the inspected Native `apps`/`crates`
source or actual API library/packages (excluding unrelated email task work).
This finding is scoped to those inspected roots, not a whole-machine absence
claim. If Root has a different actual runner source, its constructor and owner
must be inspected before assuming it supplies this capability.

## Standalone and plugin alternatives

Pinned OpenCode 2.0.11 commit
`9eb6902aaf3c35ce985b67c605a775992249066b` has a real
[`run --standalone` path](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/cli/src/services/server-connection.ts#L18).
Its [standalone constructor](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/cli/src/services/standalone.ts#L14)
starts a fresh server with a private lease. An owned containing tree could give
that new execution a physical boundary after actual platform qualification.
It does not transfer the current persistent server's active execution.

The [stock noninteractive CLI](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/cli/src/run/noninteractive.ts#L123)
rejects permission requests unless configured to accept them automatically, and
cancels forms. It cannot preserve the requested interactive authorization flow.
The [session selector](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/cli/src/run/run.ts#L77)
selects state in its target server; it does not adopt the original running scope.
An attached CLI's process exit only joins the client. A new standalone server
would additionally require exclusive canonical-session ownership, fresh-state
handoff, all permission/form callbacks, full selected configuration and a
single-writer persistence contract. Native private storage currently has an
exclusive owner lock. Copying its state or running a second unsynchronized
server is not a supported handoff. No standalone process was launched.

The installed plugin 2.0.11 SessionDomain exposes selected SessionApi operations
and hooks, including ordinary interrupt/wait. It does not expose the private
coordinator's retained execution fiber/post-finalizer done barrier. The Native
metadata plugin hooks outbound model requests; that is request attribution,
not upstream execution ownership. A terminal event happens inside upstream
cleanup and cannot be relabeled as its subsequent final done join.

## Actual plugin wrapping authority

The pinned plugin API has **real executor wrapping**, not merely events:

- `tool.transform(callback)` receives a ToolEditor. Its `update(id, update)`
  allows replacing the existing `execute`. The Effect API returns the original
  Tool.Info execute Effect; a wrapper can retain and await that exact effect
  including its finalizers. The Promise adapter captures a plugin context and
  converts the original Effect to a Promise. Its ToolContext has session, agent,
  assistant-message and call IDs plus progress; it has no cancellation signal.
  Prefer the Effect form for preserving the original structured interruption.
- `session.hook('context', callback)` receives selected agent/model and actual
  rendered system/messages/options/tool schemas. A callback can capture those
  existing values without inventing a baseline or changing models. It is a
  per-request mutation callback, with no next/around-turn continuation, original
  execution ID, outer fiber, post-finalizer join or child-scope capability.
- `aisdk.hook('language', callback)` can replace the actual LanguageModelV3.
  Wrapping `doStream` must retain its original Promise **and** response stream
  reader/drain/cancel joins. Resolving doStream is only response acquisition.
  The language is cached by model/settings and lacks session/turn identity.
  This path is restricted to AI SDK providers; it is not proof that every native
  provider is wrapped. Provider metadata transforms edit definitions, not the
  original request execution. Session HTTP hooks mutate Request/Response values;
  they do not export the caller's original fetch or outer turn join.

Pinned [tool execution](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/core/src/tool/runtime.ts#L24)
awaits the selected executor and converts foreign typed failures to Tool.Error.
It preserves interrupts as interrupts. This makes a returned original tool
Effect useful evidence for that tool call, not for all work it may start.

In particular, the [subagent tool](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/core/src/tool/plugin/subagent.ts#L200)
can schedule a background child and return immediately. An executor wrapper
joins that scheduling tool, not the child's execution. The runner's scoped tool
fibers are real but private; the plugin does not receive their handles or the
outer coordinator's final done barrier. Coalesced prompts/successors also cannot
be separated using session ID alone. A closed map of wrapper calls is not a
closed census of the original turn's effects.

[Hook registration](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/core/src/plugin/hooks.ts#L60)
attaches disposal to the plugin scope. Callbacks run sequentially and are awaited;
only the before-tool hook declares a Tool.Error failure channel. Throwing a defect
from a session mutation callback is not a supported turn-cancel constructor.
[State transforms](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/core/src/state.ts#L18)
are rebuilt in registration order and disappear on scope closure. Later transforms
can replace earlier executors. A previously captured snapshot may retain its old
wrapper while a new snapshot has a different executor; both need actual custody.

The [plugin failure path](https://github.com/anomalyco/opencode/blob/9eb6902aaf3c35ce985b67c605a775992249066b/packages/core/src/plugin.ts#L182)
removes a failed transform and refreshes state before scheduling cleanup of its
scope. Thus an optional plugin gate is not a permanent effect fence. Marking
its local gate closed during unload cannot fence later calls through newly
unwrapped tools, and a cleanup callback cannot join an unavailable outer original.
The Promise adapter also does not add original tool cancellation authority by
wrapping a Promise. No plugin was installed, registered or executed here.

These are viable **partial** constructors for actual tool wrapping and context
capture. They could preserve selected tools/context inside the current engine.
They do not supply a complete original-turn producer. Before enabling them as a
retirement source, Root needs the exact original busy-period admission/join and
background-child census plus a mandatory fence that survives reload, disable,
transform failure and unload. No supported plugin signature supplies that outer
authority. An event-triggered zero-counter snapshot is not an implementation.

## Concrete minimum shared implementation decision

Root must choose and implement one real execution authority. Neither choice is
enabled by these documents, and no new queue, Run or chat is proposed.

1. **Existing engine authority:** obtain a supported, original-at-admission
   capability from the actual selected engine: exact admission/inbox mapping,
   original-specific cancel, post-finalizer original join and closed child/tool
   census. Preserve coalesced-input and successor boundaries. The pinned public
   API/plugin surface does not provide it. Adding a field to its current public
   request does not implement it. A broader supported ABI/engine architecture
   decision is necessary; upstream edits remain outside this worker's scope.
2. **Veyra-owned turn:** extend the *same existing* canonical chat/goal admission
   to retain a private original turn object before effects. It must capture the
   exact selected agent/provider/model/variant/configuration; authoritative full
   context, sources and memory; workspace/execution; tool registry and user/Core
   policy. Existing rendered-context hooks/tool executor transforms are potential
   input constructors, not serialized authority. Extend the sealed transport purpose/candidate/claim through the same
   ProviderQueue dispatch book, reusing the actual request/socket/relay retirement.
   Do not forge TaskPurpose engine claims or treat MemoryPurpose as chat.
   Implement the real per-turn agent loop, a closed per-tool enrollment census
   and concrete dispatchers for *every selected tool*, with existing approval
   and canonical persistence owners. Cancellation signals the original turn
   and children; original joins precede output publication, Core retirement and
   next-turn admission. Existing shell owners can cover only their actual tool
   subset. Missing context/tool authority cannot be solved with a new anonymous
   model call or by silently disabling selected tools.

The smallest honest first shared slice for option2 is the **canonical existing
chat-queue admission + full context/tool capability capture and sealed provider
purpose/claim**, with no effects until all capabilities exist. That is a real
shared constructor addition, not a Voice-only adapter. The next slice owns the
actual model/tool loop and original joins. Until both exist, there is no producer
for `CurrentAgentVoiceAdapter.observeTurn/observeControl` and no working voice
call acceptance claim. Existing Core proof verification stays authoritative;
no serialized flags or injectable positive observer can replace its producer.

## Validation and reconciliation

Only finite read-only source/metadata inspection and JSON/whitespace checks were
performed. No interpreter/model/build/helper/runtime/device/CU or privileged
process/cgroup/mount was started; no database/profile/upstream/Stratus/shared
source was changed. No source implementation test was run because no supported
execution producer could be implemented within the inspected current interfaces.
The exact acceptance cases remain pending, including actual tools and canonical
persistence; passing CPU speech/kernel cases is separate evidence.

This bounded docs set stays inside the existing registered task root and its
65,536-byte source allowance. No dependencies, cache, build, scratch or runtime
trees were generated. Removed paths: none; removed bytes:0. Only minimal source
facts, architecture decision and acceptance cases are retained for Root's concrete
executor implementation and review. No disk recovery is claimed.
