# Bounded public recall source availability

Fixes the public no-snapshot source read path: later unrelated incomplete Context material no longer determines availability of an earlier verified derived-memory source. This is **read availability**, not extraction eligibility. The new path always returns idleEligible:false. Generation retains its separate completed snapshot, contribution/external-context/idle and Jobs policies.

## Implemented symbols and provenance

`MemoryLifecycle.planSourceReads(scope,currentChatId,{offset?,limit?,maxSources?})` authorizes the current chat/read capability and reads at most16 active candidate memory rows with SQL LIMIT/OFFSET. It returns an opaque per-session SourceReadPlan with deduplicated persisted `{id,contentHash,chatId}` references, at most32. It respects current host/chat use controls and existing source/content/memory suppressions, without claiming engine proof. scanCount, selectedMemoryCount, deferredForSourceBudget and hasMore describe this bounded selection; they are not a global count of readable memories.

`withSourceReadPlan(scope,currentChatId,plan,syncWork)` reauthorizes and binds synchronous recall to the plan's exact unchanged row IDs, versions, content hashes and provenance. A concurrently added memory cannot expand that request into unprimed candidates. Changed/deleted/forgotten candidates fail closed. The plan cannot be forged by JSON copying or moved between lifecycle instances/scopes/bindings. Its window affects recall only; reset/forget/maintenance and existing inspection semantics are not narrowed. It creates no store or durable checkpoint.

The persisted source ref is a **Context message ID/hash**, plus the original engine chat ID. No old engine revision, terminal member or boot UUID is invented. `resolveContextPairCandidate` in opencode-context-pair.mjs resolves the current exact private Context source through canonical source metadata, adjacent user/assistant sequence, original turn/checkpoint idempotency and retained checkpoint prefix count. That supplies candidate engine IDs/content and Context IDs. It remains a candidate mapping until the backend verifies actual engine evidence.

`createCanonicalRecallSourceReader` in recall-availability.ts binds the existing original opencodeClient and withOpenCodeRuntimeTarget, using Root's current actual owner/directory/target ports. Its core is recall-availability.mjs with declarations in .d.mts:

- `reader.view`: opaque server-only RecallReadView for request-session source state.
- `await reader.prime(plan.sourceRefs)`: at most32 refs,32 direct member reads,16 source chats and8MiB accepted normalized evidence, with1MiB per record. It resolves/deduplicates candidate pairs; reads exact current user and terminal assistant IDs/content/completion; rechecks current actual owner/session around awaited calls; and validates canonical relation. A failed/missing selected source is reported in unavailableSources and omitted, not converted into proof. Unexpected errors propagate. Counts expose the actual bounded work.
- `reader.withVerifiedSources(syncWork)`: one consumed synchronous read window, closed in finally. No Promise/await may span it, and unprimed/invalidated views cannot serve sources. Explicit invalidation during an in-flight prime prevents late publication.
- `reader.invalidate()`: clears cached current verification; it is not a delivery action.

The actual source reader reuses getSession/getSessionMessage. Its bounded relation page now calls Root's **implemented getRecentMessages(chatId,32,directory)** export, one descending raw page restored to chronological normalized order. Capture in opencode-snapshot.ts also switches to that actual export. This depends on Root's shared client change; the worker does not edit the shared client or run TypeScript against a fabricated local stub. Root confirmed its client suite/noEmit and this worker inspected the real export in Root's working tree.

## Canonical relation and explicit remaining boundary

The original normalized v2 exact-message API generally omits parentID. Browser-authored Context sequence/checkpoint cannot substitute as canonical engine relation. The reader accepts one of:

1. Current actual assistant parentID equals the exact user ID when the original API provides it.
2. An explicit actual original-owner `verifyPair` port returns the matching ownerInstanceId/chatId/userId/assistantId relation; a bare true/policy boolean is not accepted.
3. The selected current exact-ID envelopes also match a contiguous user/assistant pair in the one bounded canonical recent page, including freshly computed envelope hashes. These hashes reconcile current reads; they are **not** old versions claimed to have been stored in provenance.

A historical pair outside that bounded page with no actual relation port is reported MEMORY_ENGINE_PAIR_RELATION_UNAVAILABLE. No unbounded pagination, guessed reverse cursor, persisted old revision, title/text search, new prompt journal or global whole-chat quiescence is introduced. Root must supply bounded authoritative historical relation evidence for that case if its API omits parent links. Missing/replaced/revoked owner remains unavailable; directory or session identity disagreement also fails. There is no inferred boot UUID.

Root supplied and the worker read the private authoritative original2.0.11 schema receipt at coordination/integration/running-opencode-schema-r2.json: openapi SHA2562fa254eff9933cf357e61fe918a2b4f8ccfda5e750fcb4299134f9685beab28a,249841bytes. It establishes asc/desc ordering and a single optional message type filter, not a combined user+assistant filter or32 complete pairs. Root's getRecentMessages rejects overfilled raw pages and never follows cursors. The worker inspected that concrete export; it performed no service/network/session-content read. Existing getMessages/getMessagesPage asc/cursor semantics stay unchanged. The earlier prefix-only transport limitation is superseded for capture/recent relation pages; it remains honest that older sources may fall outside newest32 raw records.

## Synchronous availability and Root wrapper

`contextMemorySourceState` now accepts readAvailability. After its existing exact private source/hash lookup, the new read branch uses only the primed view and **selected retained prefix**. It re-resolves both Context members/checkpoint, exact engine IDs/content mapping and current pair suppression. It ignores an unrelated latest Context tail, runtime idle label, generation opt-in and source contribution flag for availability of already derived memory. The lifecycle still applies current host/use/current-chat policy, memory/content/source tombstones, budgets and actual source authorization. Archive is not deletion: Root's source-chat owner resolver must use existing history/read-source semantics. Deleted/revoked/edited selected evidence is unavailable.

`createRequestMemorySession` gains internal.readAvailability and explicitly passes null when absent. Public unprimed derived-source reads therefore fail unavailable instead of treating caller-authored Context/latest-tail completeness as engine proof. This does not disable explicit memory or policy controls. Root must prime before actual derived-memory recall. The source-state compatibility generation branch remains separate; this read view cannot grant generation even when host generate/contribute are on.

```ts
const reader = createCanonicalRecallSourceReader({
  scope: verifiedScope, execution: verifiedExecution,
  getOwner: ({ scope, execution, chatId }) =>
    existingHistoryReadSourceOwner(request, scope, execution, chatId),
  // Optional only when backed by actual original owner relation evidence:
  verifyPair: existingCanonicalPairRelation,
});
const session = createRequestMemorySession(request, selected, {
  readAvailability: reader.view,
});
const currentScope = session.resolveScope('read', currentEngineChatId);
const plan = session.memory.planSourceReads(currentScope, currentEngineChatId, {
  offset: boundedCandidateOffset, limit: 16, maxSources: 32,
});
const qualification = await reader.prime(plan.sourceRefs);
return reader.withVerifiedSources(() =>
  session.memory.withSourceReadPlan(currentScope, currentEngineChatId, plan, () =>
    session.memory.recall(currentScope, currentEngineChatId, approvedReadBudget)));
```

The existingHistoryReadSourceOwner and optional relation function are Root's actual auth/placement/engine-owner ports, not implementations invented here. That wrapper must revalidate the original request identity, exact runtime/container/placement/directory and each original source chat under existing history/read-source permission before and after awaited original-client reads. The final lifecycle/API source reads reauthorize again synchronously. Root owns framing of qualification/window continuation and real route integration. No unbounded all-memory prime is performed; new offsets must be explicitly bounded. Existing inspection pagination is not claimed to have acquired a new global source-qualified total by this recall-only window.

No source gate is held across await. Prime must immediately precede the synchronous wrapper; the cached view is not a remote engine lock or atomic freshness attestation. Selected Context/source suppression and current authorization are checked at the synchronous read point. Original prompt unknown/no-replay remains independent; no sender, automatic retry, transcript writer, model call or generation job was added.

## Evidence and cleanup

Dependency-free command: `node --test services/ingenium-api/lib/memory-v2/recall-availability.test.mjs services/ingenium-api/lib/memory-v2/opencode-snapshot.test.mjs services/ingenium-api/lib/memory-v2/bounded-snapshot.test.mjs services/ingenium-api/lib/memory-v2/request-source.test.mjs services/ingenium-api/lib/memory-v2/adapters.test.mjs services/ingenium-api/tests/veyra-memory-jobs.test.mjs services/ingenium-api/tests/veyra-memory-lifecycle.test.mjs services/ingenium-api/tests/veyra-memory-http.test.mjs`.

Final89passed/0failed/1skipped out of90. The skip is the existing explicit-path file-persistence case, VEYRA_MEMORY_TEST_DB absent; no file DB was created. Ten new cases exercise later incomplete tail vs fresh-chat retrieval; read/generation separation; canonical selected edit/delete/unknown/owner loss; selected Context/prefix/checkpoint drift after prime; user forget suppression against assistant-only provenance; current source/actor/use-policy checks; bounded16-row candidate selection and exact row window; unavailable historical relation vs explicit real owner-port contract; forged/unprimed views/plans/excessive refs/invalidation; reset scope and durable forget preservation. Fixtures use normalized transport replies and real in-memory SQLite/lifecycle. This is not real engine/public route/type/runtime acceptance.

Raw receipt coordination/memory/tests-recall-availability-repaired.tap SHA2562f282c1b650bce145c10ee3ef7b3967b7fabc7ec69a69360e58706ad44c2220d. Source-only changes use the original writer/output root. No build/install, file DB, cache, service/model/GPU/CU, upstream Web/computer-use/Stratus edit or new journal exists. Final receipt, stage inventory and exact cleanup reconciliation remain for Root integration; superseded passing receipts are removed after safety checks. Protected data/source/lockfiles/unique failures remain unchanged; no Windows recovery is claimed. Central noEmit against Root's new shared recent client, actual auth/engine read priming, fresh-chat workflow and full feature gates remain open.

Recent-page conformance boundary supplied by Root/Work: original2.0.11 metadata-only sample showed chronological/reverse chronological times and exact reversed IDs, while lexical ID ordering was not chronological. The reader preserves the client's supplied order and never sorts engine IDs. Previous/next cursors were present even on a short page and are not used as truncation/more evidence. This is not full32-record boundary acceptance. The lifecycle plan's hasMore uses a separate bounded one-bit SQLite existence probe after its16-row candidate window; it is unrelated to engine cursors or a global readable-memory total.

A final continuation-query edit initially lost its template-string quoting and produced syntax-only module failures before cases ran. tests-recall-availability-reviewed.tap retains that unique failure. The exact line was repaired using literal source quoting, then the full90-test run produced the final89pass/0fail/1existing skip above. recall-source-evidence.json fingerprints the inspected Root recent client and schema metadata receipt; it does not claim worker runtime qualification.

Cleanup receipt cleanup-recall-availability.json records exact removed passing intermediates tests-recall-availability.tap2717bytes and tests-recall-availability-final.tap23748bytes =26465 Linux logical bytes, with no safety exceptions. Final repaired TAP and the unique syntax failure remain for coordinator review; no Windows recovery claim.
