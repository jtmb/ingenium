# Request memory integration

Implements coordinator `docs/contracts/veyra-request-integration-v1.md` within the memory writer territory. `createRequestMemorySession(request,selected,internal?)` composes the real core session, shared `revalidateRequestIdentity`, Projects execution/chat resolvers, existing authorization and existing CSRF/origin middleware. It creates no credential parser, journal, database, scheduler, model selection or runtime.

## Authority and purpose

- Every scope/policy operation revalidates the original current user/service identity and real execution axes. Revoked/changed identities and insufficient existing project/org permissions deny. Browser unsafe operations reuse the existing CSRF/origin middleware with the fresh verified principal; the original request is not mutated. No grant cache or activity touch is added.
- Public composition permits read/read-source and authorized policy/forget operations only. Write operations require an unsafe HTTP verb and current middleware approval. Generate, backup and restore are denied by this public request port even for broad owner credentials. Internal jobs/operators retain their separate existing core/queue/maintenance owner.
- Extra owner/org/hash/purpose/idle-policy fields are not authority. Selection remains the frozen project/workspace/runtime lookup. All engine chat IDs remain unchanged; Context conversation IDs are distinct source facts.
- The additive `permission` field reaches `MemoryApiPorts.resolveChatBinding`. Only `read-source` selects the trusted Projects fourth purpose `history`; all other operations select `active`. Thus qualified archived source may remain readable, but archived current-chat controls/generation stay denied. Explicit exclusions and forget/suppressions still dominate. No body-provided history purpose is accepted.
- Only the frozen `RequestExecutionError` instances **and** recognized codes translate to INVALID_INPUT/FORBIDDEN/MEMORY_ADAPTER_UNAVAILABLE. Unexpected classes/codes propagate as real failures; no catch-all downgrade or permissive fallback exists.

## Source facts

`contextMemorySourceState` uses the supplied existing API connection. It verifies the private owner/org/project, exact runtime/engine session, source message identity/content hash and canonical Context metadata. Completed input requires the existing `persistContextChatTurn` provenance/idempotency keys, a matching terminal assistant checkpoint covering the current message count, and valid server timestamps. Appended pending content, incomplete/wrong-source checkpoints, wrong owners/sessions and changed hashes cannot qualify.

Known runtime activity uses current scoped runtime state/security epoch, connection/generation counters, a terminal `generation_finished` event/revision and canonical last-authenticated activity timestamps. An idle label alone is insufficient. The latest applicable timestamp across source, terminal message/checkpoint and runtime activity/event establishes the idle boundary. Missing native/compatibility activity facts cannot qualify generation. Missing activity evidence alone does not make an otherwise complete immutable source unreadable.

Existing source/content suppressions exclude forgotten material. Existing Context archive history blocks generation and changes the eligibility version across archive/unarchive, without treating archive as source deletion or uncertainty. A previously admitted candidate cannot regain permission merely by archive/unarchive cycling.

## Approved idle-policy seam

Coordinator froze `codex-memory-source-v1`: default6h, server-configurable integer1–48h. Policy provenance (fetched/reviewed by coordinator): [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference), [memory lifecycle](https://learn.chatgpt.com/docs/customization/memories). This threshold grants no generation opt-in, external-context permission, quota or model choice.

The optional third argument is **server-only**:

```ts
{
  eligibilityPolicy: ({ request, scope, execution, chatId, conversationId, messageId, contentHash }) => ({
    version: "codex-memory-source-v1",
    minRolloutIdleHours: approvedServerHours,
    scope: currentAuthoritativeScope,
    runtimeId: currentRuntimeId,
    admission: {
      chatId: sourceEngineSessionId,
      conversationId: sourceContextConversationId,
      state: "settled", // or the actual pending/unknown state
      revision: actualJournalRevision,
      contextRevision: actualContextRevision,
    },
  })
}
```

These values must come from the coordinator's existing installation-policy and original request/journal owner. No client payload is read for them. The frozen two-argument export remains compatible; no provider, missing owner/journal facts, unsupported policy version, invalid hour range or mismatched scope leaves idleEligible:false. Known pending admissions are active; known unknown admissions are uncertain. A settled admission must match the canonical source chat/conversation and current Context revision. The helper creates no second journal.

Eligibility also requires existing effective host generation and source-chat contribution opt-ins. Read/use and contribution remain separate: use can be off while an authorized chat contributes, and contribution can be off without deleting prior recall. Missing eligibility policy/journal evidence does **not** disable explicit-memory injection, ordinary policy controls or already-qualified readable recall.

The normalized eligibility fingerprint includes version/hours/current owner/binding/runtime and admission identity/state/revisions, plus the current archive sequence. It is rechecked before persistence. Changed policy/journal/archive facts reject stale candidates. The source-input watermark deliberately excludes this fingerprint, preserving duplicate-extraction suppression across policy changes and old unversioned source records. Receipts/tombstones/restore suppressions and explicit-memory IDs remain unchanged.

## Evidence

Dependency-free command (all temporary environment paths set inside the assigned coordination root):

```sh
node --test services/ingenium-api/lib/memory-v2/request-source.test.mjs \
  services/ingenium-api/lib/memory-v2/adapters.test.mjs \
  services/ingenium-api/tests/veyra-memory-jobs.test.mjs
```

Final result **34/34 passed**,0 skipped. It covers exact6h and1ms-early boundaries; integer range; absent/mismatched policy; actual activity and completion facts; source owner/session/hash/suppression; read/contribute separation; pending/unknown journal facts; missing-provider qualified/explicit recall; stale policy/journal/archive rejection; immutable source-input watermark; strict request decisions and frozen error mappings; archived readable source vs active controls/generation/forget; existing adapter/Jobs regressions. These are in-memory SQLite/port checks, not proof of the new shared Express/Projects composition or a model call.

Raw `tests-request-final.tap` SHA256: `fd182e5e6bc04960251f1e95ff7afeea8723820cab55352336cbc5ab546639cb`. An18/19 run caught omitted journal revision in the initial eligibility fingerprint; its exact failure/source hash is retained in `request-source-first-failure.json`. A subsequent edit introduced an unquoted SQL template and was caught before commit; `tests-request-source-archive.tap` retains that syntax failure. Both were causally repaired before the final34-check pass.

`cleanup-request-session.json` records **21094 Linux logical bytes removed** from superseded passing receipts: `tests-request-source-first.tap`4346, `tests-request-source-final.tap`8254, `tests-request-source-mapped.tap`8494 and empty `tmp/`0. Containment, inactive-handle/mount/container checks passed with no exception. Unique failure witnesses and final evidence remain for coordinator review. No dependency/build/cache/core-fixture/model/runtime output was created; no Windows free-space recovery is claimed. Protected coordinator failure fixtures/manifests were untouched.

## Coordinator follow-through

Integrate this source with the shared identity and corrected Projects engine-ID/history-purpose exports, then run API noEmit and real request/core denial/source tests centrally. Wire the approved server policy and authoritative original-journal admission facts; their absence intentionally keeps generation unavailable. Root still owns routes, response framing, original journal/restore barriers, final saved-plus-learned turn budget/injection, internal job/operator authorization and controlled Windows/WSL/Linux/runtime/visual acceptance. No public generate/restore endpoint or model activation is supplied. Full goal completion remains unproven until those gates close.

## Scope-only Settings read

`memory.scopePolicy(scope)` returns `schemaVersion`, `scopeHash`, `bindingHash`, `bindingEpoch`, `policy` and `available` without creating or resolving a chat. It uses the same `access(scope,'read')` authorization on every call and the same `policyAt(key)` store/default lookup as the existing chat policy method. It performs no write, checkpoint or default-policy insertion. No new authority, identity, store or policy default is introduced. The exported `ScopePolicy` declaration describes this result.

The public framework facade action `scope-policy` accepts GET, requires the existing `read` scope resolver and returns the normal no-store response. Body injection and extra query fields remain invalid; method mismatches return405/Allow:GET. The coordinator's real route `/api/v1/memory/lifecycle/scope-policy` owns strict HTTP query/method/actor/CSRF mapping. Existing `policy` still requires the real chat ID and returns the unchanged chat policy fields. Selected IDs remain untrusted lookups through the request adapter.

Follow-up evidence: `node --test services/ingenium-api/tests/veyra-memory-lifecycle.test.mjs services/ingenium-api/tests/veyra-memory-http.test.mjs` passed24, failed0, skipped1. The skipped pre-existing file-persistence case requires `VEYRA_MEMORY_TEST_DB`; this source-only follow-up created no file DB. New cases cover scope read before any chat; authorization before DB access; repeat revalidation; no writes/checkpoints; stored-policy parity; every scope isolation axis and projectless isolation; real-chat behavior preservation; facade authorization, method, injection and no-store guards. Raw `coordination/memory/tests-scope-policy.tap` SHA256: `f2dbe04a46616931b3412edb1477fa8b601ef7d02c0e6ebff02ba2637163d8f6`. Central actual HTTP/type checks remain coordinator-owned. Only this final test receipt and the small stage inventory were generated inside the existing owned coordination root, retained for the pending integration consumer. No scratch, dependency, compiler output or database cleanup is outstanding for this follow-up.
