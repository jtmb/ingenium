# Codex-aligned completed-source snapshots

Verified2026-10-30. This supersedes the global future-ingress fence and mandatory new Node journal prerequisites in `delivery-owner-proposal.md`. Those were stronger than the requested Codex lifecycle. The old proposal stays unmounted as review history; do not adopt its coverage rules as memory acceptance criteria. Original prompt no-replay remains an independent delivery guarantee.

## Primary evidence and limits

Official [Memories](https://learn.chatgpt.com/docs/customization/memories) describes background extraction from eligible prior chats after idle time, with per-chat use/contribution and external-context controls. [Configuration](https://learn.chatgpt.com/docs/config-file/config-reference) documents the6h idle default and1–48h bounds. These pages do not prescribe a global lock over all future prompt writers.

OpenAI-owned source was inspected at commit [`7689f21b79f8faf318bab98f1cd98dd5f5aa59ad`](https://github.com/openai/codex/tree/7689f21b79f8faf318bab98f1cd98dd5f5aa59ad). `codex-snapshot-evidence.json` records pinned URLs, exact fetched source hashes and sizes; source was read in memory, with no repository clone/cache.

- [state runtime memories](https://github.com/openai/codex/blob/7689f21b79f8faf318bab98f1cd98dd5f5aa59ad/codex-rs/state/src/runtime/memories.rs): `claim_stage1_jobs_for_startup` selects permitted, enabled prior threads within age/idle bounds, excluding the current thread, and claims jobs using the selected source timestamp. `mark_stage1_job_succeeded` checks ownership of the running job, records its watermark and upserts timestamped output. The inspected path does not lock every future ingress while extracting.
- [phase1](https://github.com/openai/codex/blob/7689f21b79f8faf318bab98f1cd98dd5f5aa59ad/codex-rs/memories/write/src/phase1.rs): sampling materializes selected rollout items, serializes bounded model input and commits output under the claimed job token/source timestamp. Extraction retry ownership concerns the memory job, not replay of an original user prompt.
- [rollout input](https://github.com/openai/codex/blob/7689f21b79f8faf318bab98f1cd98dd5f5aa59ad/codex-rs/memories/write/src/rollout_input.rs): recent evidence is read with an8MiB overall/1MiB record bound, sanitized, and restored to source order; v2 prioritizes provenance tiers. [OpenAI PR53940](https://github.com/openai/codex/pull/53940) explains the bounded recent-evidence change.

Conclusion: bounded materialized extraction input and a source watermark are evidenced; a filesystem-wide immutable rollout or global atomic whole-chat quiescence contract is not. This does not establish byte-for-byte equality with this machine's installed binary. Its location was found read-only, but inspected PE metadata exposed no usable source commit/version. Veyra's completed-pair eligibility and precommit security/deletion checks below preserve the explicitly requested safeguards; they are not attributed as identical Codex implementation details.

## Implemented adapter

`lib/memory-v2/bounded-snapshot.mjs` exports `createCompletedMemorySnapshot` and `readCompletedSnapshotSource`, with actual declarations in `.d.mts`. The factory takes explicit **server original-owner ports**, never client assertions:

```ts
const snapshot = createCompletedMemorySnapshot({
  scope: verifiedScope, execution: verifiedExecution, chatId: engineSessionId,
  minRolloutIdleHours: approvedServerHours,
  captureSnapshot: originalSourceOwner.captureEligibleCompletedSnapshot,
  readCanonicalMessage: originalSourceOwner.readExactCanonicalMessage,
});
// Capture exactly once for this extraction; reuse the opaque object at commit.
```

The original-owner port supplies exact private scope/runtime/engine identity, eligibility capture/activity times, an input watermark and canonical completed user/assistant pairs. Capture rejects partial/unknown selected material, invalid ownership/IDs, insufficient idle time, future timestamps, broken terminal pairing, duplicate IDs and oversized records. Veyra retains its existing32-source ceiling alongside the evidenced byte bounds. It copies exact strings without trimming/normalizing and freezes selected evidence in process memory; no new persistent transcript, journal, scheduler, service or prompt sender exists.

The opaque WeakMap-backed snapshot cannot be fabricated from a deserialized object. Its public `selectedSources` manifest contains only canonical engine IDs, roles, terminal IDs and content hashes, in selected source order. The existing owner maps those to actual Context IDs via source metadata/idempotency keys; engine chat, Context conversation and Context message identities remain distinct. Extraction consumes only admitted selected references, never appended material discovered during a later read. Existing minimization/redaction before model/persistence remains required.

For every selected source lookup, the adapter calls the original owner to revalidate **both** members of that completed pair: exact IDs, source versions, turn/terminal identities, content bytes, completion evidence, completion time, owner instance and external-context classification. An absent/deleted/edited/partial/unknown selected source or mismatched terminal fails. This port must use actual canonical engine/source authority; do not pass a browser-authored Context checkpoint, optimistic reducer state, guessed completion label or stale unvalidated network cache. Async engine queries can be performed by the owning backend before entering the synchronous core adapter; the owner must furnish current exact source evidence at each precommit check. No new global future-ingress barrier follows from this contract.

`contextMemorySourceState` now accepts `completedSnapshot`. On this path it checks the current exact private Context source/content hash, source engine metadata and existing turn/checkpoint idempotency keys against the independently verified engine pair. It validates the checkpoint through the **selected completed terminal**, its retained prefix count and terminal content hash. It does not require that checkpoint to be the current conversation tail. A new user message, unknown future delivery or later completed turn outside the selected snapshot does not enter the input, require global quiescence or invalidate unchanged selected material.

Current host enable/generate, source-chat contribution, external-context permission, scope authorization, archive disposition and source/content suppression remain authoritative. The lifecycle's existing precommit generation-policy/chat revisions, source reads, deletion/tombstone/forget/restore suppressions and content checks remain in force inside its existing transaction. A selected pair changed since admission fails even if its original checkpoint remains. Archive/unarchive changes the eligibility version, preserving stale-admission rejection. The existing extraction input hash still excludes eligibility metadata, so unchanged-input deduplication survives this adapter.

`createRequestMemorySession` has an additive server-only `internal.completedSnapshot` option. With it, `eligibilityPolicy` supplies the existing approved version/hours/scope/runtime but **does not need admission journal fields**. No runtime-wide active-connection/generation event or global journal census is consulted on this path. The previous conservative source-state branch is retained for compatibility when no snapshot is supplied; it is not evidence that a new journal must be built. The coordinator should use the completed snapshot path for canonical backend extraction. Public request composition continues to deny internal generate/backup/restore and provides no caller-controlled snapshot endpoint.

## Integration and verification boundary

The factory/source-state adapter is implemented and tested; concrete canonical original-owner capture/read ports still belong to the coordinator's backend composition. Do not claim engine verification has run merely by constructing fixture callbacks. Reuse existing canonical engine message readers and completed source metadata; no new delivery journal is required for memory eligibility. Root retains production route/restore/turn integration, job leases/quota/model selection, actual auth/CSRF/type/runtime qualification and original prompt delivery no-replay.

Dependency-free command: `node --test services/ingenium-api/lib/memory-v2/bounded-snapshot.test.mjs services/ingenium-api/lib/memory-v2/request-source.test.mjs services/ingenium-api/lib/memory-v2/adapters.test.mjs services/ingenium-api/tests/veyra-memory-jobs.test.mjs`.

Final **43passed,0failed,0skipped**: nine new snapshot tests plus existing34. New cases cover journal-free eligible completed evidence, immutable hash-only source manifests, an appended unknown engine/incomplete Context tail outside the snapshot, changed/unknown/deleted selected engine source or terminal, wrong original owner/revision, byte-preservation/forged snapshot refusal, bounded capture, current policy/authorization-scope/source/checkpoint/suppression guards and explicit external-context control. Raw final receipt `coordination/memory/tests-bounded-snapshot-pair.tap` SHA256 `7980c42200e5cf31844e87e8c25daec561a49ab4909f45522efa991c8fc004ac`. This is CPU/in-memory evidence, not an actual engine call, model extraction, central TypeScript check or platform acceptance.

All generated output stays in the existing authorized C-backed coordination root. No file database, dependency cache, build, service, model, GPU, Computer Use, upstream Web or Stratus modification was created. Final evidence/stage inventory and the exact cleanup reconciliation receipt remain for coordinator review; protected sources/originals/failure fixtures are untouched. Linux logical cleanup and any Windows free-space claim are accounted separately.

Final pair hardening also verifies the current Context user counterpart when admitting an assistant source, including source/content forget suppressions on both selected members. This prevents a retained assistant from bypassing a forgotten or edited selected user member. cleanup-bounded-snapshot.json records both superseded passing logs removed after safety checks; final pair receipt remains the integration evidence.
