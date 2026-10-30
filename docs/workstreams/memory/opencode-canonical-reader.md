# Canonical OpenCode capture and refresh

Implemented source: `services/ingenium-api/lib/memory-v2/opencode-snapshot.ts` exports `createCanonicalOpenCodeSnapshotReader`. It directly binds the original `opencodeClient.getSession`, `getMessages`, `getSessionMessage` and existing `withOpenCodeRuntimeTarget`, using the verified owner's directory on every call. No new fetcher, credential parser, fallback target, database, journal, transcript writer or model execution is added. The pure algorithm and real SQLite mapper live in `opencode-snapshot.mjs` / `opencode-context-pair.mjs`, with matching `.d.mts` declarations.

## Actual normalized API evidence

Inspected the owned checkout's existing `lib/opencode-client.ts`: `SessionInfo`/`MessageEnvelope` definitions near188/241/282; `mapV2Session`/`mapV2Message` near860/893; `getV2MessagePage` near1006; actual client methods near1477/1538/1549. Normalization checks the requested session/directory, returns canonical engine message IDs, preserves visible user text (using native ingeniumVisibleText metadata when present), constructs normalized assistant text/reasoning/tool parts and preserves real message completion time and finish. It also constructs a synthetic step-finish part, using creation time when completion is absent. The adapter therefore requires **info.time.completed and finish==='stop'**, not synthetic part timing or an idle label.

The v2 adapter does not expose an engine boot/container UUID. It does not expose raw user metadata or an explicit external-context-used flag in MessageEnvelope. It normally does not preserve a parentID relation for normalized v2 assistants. The reader selects only strictly adjacent canonical ordered user/terminal-assistant pairs; when an explicit parentID exists it must match. It does not claim an engine-supplied parent link that normalization lacks, or associate an arbitrary last assistant with a guessed prompt. Pending/error tool state, failed finish, missing completion, malformed/oversized pair and ambiguous Context mapping cannot qualify.

Three real prerequisites remain visible to Root:

1. `getOwner` must revalidate through Root's existing authorization/placement/runtime/container owner, returning exact scope/execution, actual ownerInstanceId, authorized directory and existing authenticated OpenCodeRuntimeTarget. A URL/session/hash is not a manufactured boot UUID. Null/missing/replaced/revoked ownership invalidates the reader. Credentials remain only in the existing target context, never logs or source manifests.
2. `externalContext` must return a server-owned boolean from actual selected-source provenance, or null when unknown. An empty normalized tool list cannot prove false; raw metadata was dropped by normalization. No assumption, extra parser or new journal fills that gap. True evidence still requires the current explicit external-context memory policy.
3. Existing `getMessages(chat,32,undefined,directory)` asks for ascending order and only returns its first normalized page. This implementation is a **bounded prefix**, not a verified newest32 suffix or whole-history census. It does not scan unbounded pages or invent reverse cursors. For continuing long-chat recent-suffix extraction, the original client owner must expose a verified bounded recent-page/ordering port. No upstream Web edit or global future-ingress fence is required. Size checks occur after the existing client's JSON normalization; this adds bounded request/accepted evidence limits, not a streaming byte cap to its fetcher.

These findings were reported directly to the coordinator before completion. Actual transport binding is implemented; these owner/provenance/paging facts are not represented as fixture-proven backend capabilities.

## Lifecycle and typed interface

`OpenCodeSnapshotOptions` requires verified `scope`, `execution`, `chatId`, integer1–48 `minRolloutIdleHours`, `getOwner` and `externalContext`. `createCanonicalOpenCodeSnapshotReader` returns:

- `prepare(): Promise<PreparedOpenCodeSnapshot>`: one capture attempt. It obtains actual current owner/session, checks real session activity time against the configured idle threshold, reads at most32 normalized messages, accepts at most8MiB total /1MiB per record, forms completed adjacent pairs, classifies external context and checks initial session identity/activity again. It creates the opaque bounded snapshot, maps every selected pair to exact existing Context IDs and checkpoint, then directly verifies each selected ID before publication.
- `refresh(): Promise<true>`: clears prior verification before awaiting anything, rechecks actual owner/session and reads **only selected exact message IDs**. It checks full normalized-envelope hashes, exact content/completion/turn/version, Context mapping/checkpoint and current external-context evidence. Session identity includes real engine project, directory and creation timestamp, alongside Root's actual owner identity; a new updated timestamp or unrelated later message is not identity loss. A revert targeting a selected member invalidates it.
- `withVerifiedSources(work)`: opens one synchronous source-read window, passes an immutable in-memory copy of the verified selected CompletedEngineMessage array to `work`, and closes/consumes the window in finally. Snapshot source callbacks return null outside it. A Promise-returning callback is rejected; this window never spans extraction, minimization or another await. Call it immediately after awaited prepare/refresh; it is not an engine lock, cryptographic freshness attestation or assurance against all remote races.
- `invalidate()`: clears the synchronous view and advances its verification epoch. A late read from an invalidated in-flight refresh cannot republish stale evidence. Failed reads/owner checks also clear the view. A failed prepare cannot be silently repurposed with another original.

Prepared output contains only the opaque snapshot, exact Context conversation/source refs and actual owner identity. Context mapper reads the existing core connection through `positionalCoreConnection(getDb())`; it requires exact private org/owner/project/runtime/session, engine IDs, raw content/hash, adjacent user/assistant sequence, original turn/checkpoint idempotency and retained prefix count. Duplicate, trimmed, missing, wrong-owner or uncheckpointed mappings return unavailable. It never writes a transcript to make a mapping pass. Historic client-trimmed Context may therefore need explicit Root reconciliation through the original writer; the reader does not normalize engine bytes to hide disagreement.

## Root integration with existing Jobs

`runMemoryExtraction` now has an optional `sourceVerification` port. It awaits refresh before initial synchronous admission/input-dedup and again before synchronous re-admission/persistence. Each phase runs inside withVerifiedSources; the existing job lease is rechecked after awaited refresh. Quota/model/minimization execute outside the view. Existing receipt reconciliation, input dedup, operation identity, policy checks and no-replay remain unchanged. This modifies no queue/registration/provider or production model execution.

```ts
const reader = createCanonicalOpenCodeSnapshotReader({
  scope, execution, chatId, minRolloutIdleHours: persistedPolicy.minRolloutIdleHours,
  getOwner: () => existingVerifiedPlacementAndRuntimeOwner(),
  externalContext: (input) => originalSelectedSourceProvenance(input),
});
const prepared = await reader.prepare();
// Existing authenticated core composition, not the public generation-denying port:
const session = existingInternalMemorySession({ completedSnapshot: prepared.snapshot });
let modelEvidence: readonly Readonly<CompletedEngineMessage>[] = [];
return runMemoryExtraction({
  ...existingQualifiedJobPorts, memory: session.memory, scope, chatId,
  sourceRefs: [...prepared.sourceRefs],
  sourceVerification: {
    refresh: () => reader.refresh(),
    withVerifiedSources: (work) => reader.withVerifiedSources((messages) => {
      const result = work(); // admission/processed-input or final commit, synchronous
      modelEvidence = messages; // ephemeral bounded model input; no persistent copy
      return result;
    }),
  },
  extract: (input) => existingQualifiedExtraction({ ...input, evidence: modelEvidence }),
});
```

The recipe's existing owner/internal-session/model functions are Root composition placeholders, not new APIs claimed by this worker. The implemented typed symbols are the reader methods, PreparedOpenCodeSnapshot/owner/provenance interfaces, exact SQLite mapper and optional Jobs verification hooks. Root must register/wire actual current authorization, placement, policy, provenance, job lease/quota/model and restore boundaries. The public request memory port still does not authorize generation. There is no original-prompt sender or automatic retry in this adapter.

## Evidence and cleanup

Dependency-free command: `node --test services/ingenium-api/lib/memory-v2/opencode-snapshot.test.mjs services/ingenium-api/lib/memory-v2/bounded-snapshot.test.mjs services/ingenium-api/lib/memory-v2/request-source.test.mjs services/ingenium-api/lib/memory-v2/adapters.test.mjs services/ingenium-api/tests/veyra-memory-jobs.test.mjs`.

Final **55passed,0failed,0skipped**. Twelve new canonical/Jobs cases plus43 prior cases cover: bounded actual transport call shapes; exact bytes; no synchronous source access outside verification; later unrelated message/activity; selected deletion/edit/unknown/partial; owner revocation/replacement during awaited reads; missing true owner ID; unknown external provenance; synthetic finish fallback refusal; directory/size/parent failures; Context exact/trimmed/duplicate mapping; external provenance/mapping/revert changes; awaited Jobs admission/commit and lease failure; explicit invalidation versus late reads. Transport fixtures are normalized original-client contract objects, not actual engine/runtime acceptance. The real `.ts` binding requires central noEmit and actual client/owner integration qualification.

Final raw receipt `coordination/memory/tests-opencode-snapshot-reviewed.tap` SHA256 `9819067944948f4cd15340ee868b49c49bb84448ad12aa3213a4fb432027a447`. All TEMP/TMP/TMPDIR and receipts use the original approved C-backed root. Only source, a small stage inventory, final TAP and exact cleanup receipt are retained for coordinator review. No file DB, dependency/cache/build/service/model/GPU/Computer Use/upstream/Stratus action was created. Superseded passing receipts are reconciled in cleanup-opencode-snapshot.json; protected original journals/user data/source/lockfiles/failure fixtures remain untouched. No Windows disk recovery is claimed.

Cleanup completed: removed exact superseded passing receipts tests-opencode-snapshot.tap5484 bytes and tests-opencode-snapshot-final.tap14793 bytes, total20277 Linux logical bytes, with no failed safety check. Final55-check reviewed receipt remains. Exact inspected original client/context file hashes are retained in opencode-client-source-evidence.json.
