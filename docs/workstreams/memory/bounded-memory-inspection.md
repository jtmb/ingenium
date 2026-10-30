# Bounded management entries inspection

Implemented in the exclusive memory namespace. Root shared routes/owner helpers/native code are unchanged. Immutable reference inspected: Root commit `f0c3733e84e7a159b969b0ba2d3f87d026c62b20`, `lib/memory-request-recall.ts`, `lib/memory-engine-owner.ts` and `lib/routes/memory-lifecycle.ts`. Root accepted the explicit candidate-window management contract before this implementation was checkpointed.

## Actual lifecycle semantics preserved

Legacy `MemoryLifecycle.inspect(scope,{offset,limit})` remains unchanged. It is a management read and does not require an active chat or generation/contribution/use opt-in. Authorized users must still be able to inspect existing stored memories and forget them after disabling injection/generation. Its offset and total refer to source-qualified results after filtering; this bounded implementation does not silently reinterpret them.

New `planInspectionSources(scope,{candidateOffset=0,limit=25,maxSources=32})` authorizes scope read, selects a bounded candidate window (limit1–100), filters existing memory/content/source suppressions and deduplicates at most32 source refs. One bounded existence probe provides candidate continuation. No fake chat ID or opt-in grants authority. The opaque InspectionSourcePlan is bound to the lifecycle instance, private scope, binding hash/epoch and inspection purpose. Recall and inspection plans cannot be interchanged.

`inspectSourcePlan(scope,plan)` reauthorizes at consumption, reads only exact unchanged planned row IDs/versions/content hashes/provenance, and applies current suppressions plus existing per-source authorization and canonical read availability. Every returned item is exactly the existing `{id,content,version,provenance}` management shape; persisted source IDs/hashes/chat IDs, eligibility tags, model and policy provenance are preserved. Fresh engine versions or verification facts are not inserted into stored provenance. A changed/unavailable source omits its entry without rewriting or hiding an independent qualified entry. New/revised unprimed rows cannot expand the request.

The result has `items` and an explicit `sourceWindow`: candidateOffset, limit, scanned, selected, returned, unavailableMemoryCount, deferredForSourceBudget, hasMore and nextCandidateOffset. It contains **no globally qualified total or legacy nextOffset**. These fields describe this bounded candidate window, not all readable stored memories. Generation/use/contribution opt-outs do not hide management entries; source authorization, hashes, canonical engine proof, current source/checkpoint integrity and durable forget suppressions still do. Legacy inspect/reset/forget/maintenance behavior is not narrowed by a bounded plan.

The accepted recall reader supplies canonical bounded source proof: existing actual OpenCode client/target/managed owner, exact selected member content/completion and relation, selected Context checkpoint prefix and current history/read-source checks. Later incomplete chat tails do not control inspection. Older sources outside the recent32 relation page still require actual bounded original-owner relation evidence. No whole-chat fence, new journal, credential parser, transcript writer, model or policy-boolean engine proof is introduced.

## Implemented orchestration and Root-owned boundary

`lib/memory-v2/inspection.mjs` and `.d.mts` export `readBoundedMemoryInspection({memory,scope,reader,candidateOffset?,limit?,maxSources?,consume})`:

1. Plan bounded management candidates with current scope authorization.
2. Await the existing canonical reader's `prime(plan.sourceRefs)`.
3. Call the required Root `consume(read)` barrier, which reacquires current actual placement/container/request authority before invoking the synchronous read.
4. Inside the consumed reader view, inspect the exact plan; append only verified/unavailable source counts to its window.
5. Invalidate the reader in finally on success, invalid input, revoked authority or Root consumption failure.

The helper owns no request identity/placement logic. Root must provide its actual existing barrier, matching f0c3733e; a permissive fixture consume callback is not production owner qualification. Source reads still reauthorize synchronously through the existing memory API session. It is a read-only management flow, not recall injection or a generation grant.

## Minimal shared-route proposal (not applied)

Add Root `lib/memory-request-inspection.ts` alongside the immutable recall helper, reusing the same placement/owner/session ports:

```ts
return withPlacement(request, selected, async () => {
  const bootstrap = createSession(request, selected);
  const scope = bootstrap.resolveScope('read'); // no chat required
  const execution = resolveRequestExecution(request, selected);
  const ownerBindings = new Map<string,string>();
  const reader = createCanonicalRecallSourceReader({
    scope, execution,
    getOwner: async input => {
      const owner = await resolveManagedMemoryEngineOwner(
        request, selected, input.scope, input.execution, input.chatId);
      // Preserve the actual original container binding across every source read.
      recordAndCheckExistingOwnerBinding(ownerBindings, input.chatId, owner);
      return owner;
    },
  });
  const session = createSession(request, selected, {readAvailability:reader.view});
  const page = await readBoundedMemoryInspection({
    memory:session.memory, scope, reader,
    candidateOffset:query.candidateOffset, limit:query.limit,
    consume:read => withPlacement(request, selected, () => {
      recheckExistingCurrentScopeAndContainerBindings(
        request, selected, session, scope, ownerBindings);
      return read();
    }),
  });
  return {status:200,headers:{'Cache-Control':'no-store'},
    body:{data:{items:page.items},sourceWindow:page.sourceWindow}};
});
```

The two named binding/recheck functions in this small recipe describe the already-present checks in Root's recall helper; they are not new authority exports claimed here. Root should reuse/extract those checks, including current request identity, scope/binding, actual backendContainerId and manager placement. Keep original provisioning revision comparison <= current Core revision. Do not substitute a URL/hash for actual container identity. The worker did not edit or copy the shared owner implementation into a competing writer.

Migrate public `GET /api/v1/memory/lifecycle/entries` deliberately in `routes/memory-lifecycle.ts`: route entries through the new async Root helper, allow only selection keys plus candidateOffset/limit, and reject legacy qualified `offset` rather than treating it as a candidate offset. Existing `memoryResponse(...,'entries')` and legacy lifecycle inspect remain intact for compatible internal callers. Apply the public DTO/query migration together with its UI caller, before publication; do not present the new response as the old exact total contract. Preserve original authenticated router placement, strict scalar/numeric parsing, GET-only method, no-store, CSRF/header/error handling and source-history authorization. No mutation endpoint or chat requirement is added.

UI caller implications:

- Keep `data.items` and its exact provenance/version handling; use candidateOffset and sourceWindow.nextCandidateOffset for explicit bounded continuation.
- Replace global-total/page-count claims with the current window/returned count and availability/deferred indication. A window may return zero entries while hasMore remains true because candidate sources were unavailable. Do not automatically scan every subsequent window to manufacture a global total.
- Reset the candidate cursor on scope/binding change, refresh or successful forget; retain existing receipt/idempotency/unknown-outcome behavior. Do not create another client transcript/journal.
- Keep inspection/forget available after opt-out while existing recall/injection and generation controls stay disabled. Do not label opt-out as deletion or waive current source authority.

## Verification, evidence and cleanup

Command: `node --test services/ingenium-api/lib/memory-v2/inspection.test.mjs services/ingenium-api/lib/memory-v2/recall-availability.test.mjs services/ingenium-api/lib/memory-v2/opencode-snapshot.test.mjs services/ingenium-api/lib/memory-v2/bounded-snapshot.test.mjs services/ingenium-api/lib/memory-v2/request-source.test.mjs services/ingenium-api/lib/memory-v2/adapters.test.mjs services/ingenium-api/tests/veyra-memory-jobs.test.mjs services/ingenium-api/tests/veyra-memory-lifecycle.test.mjs services/ingenium-api/tests/veyra-memory-http.test.mjs`.

Final98 cases:97passed,0failed,1existing explicit-path file-persistence skip (VEYRA_MEMORY_TEST_DB absent; no file DB created). Eight new inspection cases prove exact item/provenance/version preservation; opt-out management/forget versus disabled injection; one changed canonical source versus independent good entry; current source/actor/Context checks at consumption; candidate versus legacy qualified-offset semantics; inserted/revised unprimed rows; budget/purpose/scope/opaque plan checks; finally invalidation. Previous90-case suite is included. Shared fixture extraction is test-only and has no production imports.

Raw final `coordination/memory/tests-memory-inspection-final.tap` SHA256 `b39e1dd7cdecaa38c24ddb3ec53d7b088ed8f8559618531a29527906a802921a`. The first18-case run had16pass/2fixture failures: missing test-only envelope import and an incorrect assertion expecting empty inspection after actor revocation instead of the correct FORBIDDEN. Both fixture issues were repaired; the unique first-failure TAP is retained. No production authorization was weakened to make it pass.

All generated output uses the existing approved C-backed coordination root. No disposable scratch/file DB/dependency/cache/compiler/model/service/CU or bulk output was created. Final TAP, unique fixture failure, stage inventory and cleanup reconciliation are retained for the pending Root integration consumer; no eligible intermediate passing receipt exists for this stage, so removed bytes are0. Protected source/lockfiles/original journals/user/runtime data and prior failure witnesses are unchanged. No Windows recovery is claimed. Central types, actual public route/owner source priming, UI migration and full fresh-chat/runtime acceptance remain Root-owned and open.

If deferredForSourceBudget is nonzero, the UI must not label that candidate range fully inspected even when hasMore is false. Allow an explicit smaller-window retry over the range; nextCandidateOffset describes candidates beyond the window, not resolution of deferred entries inside it. Never fill the gap with unverified content or an automatic unbounded scan.
