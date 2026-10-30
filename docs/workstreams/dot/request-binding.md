# Request-local veyra-bot composition

This source milestone implements the frozen `docs/contracts/veyra-request-integration-v1.md` boundary. It does not activate a scheduler, runner, source listener, notification transport or root route. The full Veyra acceptance goal remains open.

## Root integration

Import `createCoreRequestDotSession` from `lib/dot-v2/request-session.ts` and `createRequestDotRouter` from `lib/dot-v2/router.ts`. Mount behind the existing authentication, CSRF, authorization, rate-limit and operation-journal middleware. Supply a fresh factory for every HTTP request:

```ts
createRequestDotRouter(request => createCoreRequestDotSession(
  request,
  selectedLookupIds(request),
  qualifiedRunnerOwner,
  coreDotOptions,
));
```

`selectedLookupIds` supplies explicit `{projectId, workspaceId, runtimeId, chatId}`. IDs request lookups; request bodies, labels, suggestion text and historical scope do not confer authority. Each domain action rechecks the existing request identity, exact execution facts and canonical private chat/session. The shared existing-owner errors pass through to the root error middleware; Dot errors retain inspectable 401/403/409/422/503 semantics. Responses use `Cache-Control: no-store`.

The production module imports the actual `revalidateRequestIdentity`, Projects `resolveRequestExecution` / `resolveRequestChatBinding`, Memory `createRequestMemorySession`, authorization, Context, explicit memory, trusted events, delivery queue, Jobs, singleton DB, transaction and runner owners. It does not parse credentials, mint a session, open a database or cache a permission. `createCoreRequestDotSession` preserves the real user/service caller in `startJobRun` provenance even though Dot records use the trusted logical owner.

Do not retain an HTTP session factory in the autonomous scheduler. Root must supply its established durable automation identity and current grant/binding policy to the existing singleton scheduler path. No timer is added here. Projectless legacy Jobs remain unavailable; no synthetic project is substituted.

## Qualified runner requirements

`DotQualifiedRunnerOwner` is mandatory and has no permissive defaults:

- `assertExecutionSupported(execution, job)` must prove the existing runner honors this exact workspace/runtime/host/environment/binding epoch. Labels or runtime names are insufficient.
- `capabilitiesForJob(job)` returns the independently declared current capability profile or null (unavailable). Prompt text must not become a capability declaration. `requireCapabilities` reuses the actual caller's existing grants, including external-message permissions. A profile broader than approval is rejected before claim and after commit even when Job revision is unchanged.
- `inspectSettlement(execution, run)` returns active, settled, or unknown using the production process owner. The existing `runningProcesses` map is not enough: leader exit may leave descendant teardown pending. An optimistic cancelled DB row or missing handle is not settlement proof. Unknown remains pending. Signal requests use the existing `killRunProcess` only after exact Job/run/operation binding checks.

Until these existing-owner facts exist, reject/unavailable is the required behavior. The adapter does not start another worker or infer that cancellation completed. Root owns final actual process/restart acceptance.

## Source references and eligibility

`dotSourceReference` emits a canonical bounded JSON reference `{v:1,id,hash,chatId?,memoryKind?,version?}`. Hashes are lower-case SHA-256. Extra properties and noncanonical encodings are rejected.

User sources require a current private canonical Context conversation, its real engine runtime/session metadata, a user-role message, stored hash and recomputed content hash. Event sources require a real trusted context.maintenance schema-1 event, exact target chat and `dotEventDigest(event, sessionId)`; no event payload is exposed in queue responses. Memory sources require an explicit selected chat, currently enabled existing memory use policy, private exact execution scope and exact version/hash. Explicit tombstones, suppressed records, excluded derived recall and instruction-authority markers are denied. Memory generation and contribution policy are never enabled by Dot.

Queue output contains only `{id,state,projectId}` for Jobs with an exact stored Dot binding and existing visibility. Original keyset cursor is preserved even when a page filters to empty; root clients must continue pagination. Run visibility is derived from its current owning Job, matching the existing Jobs router.

## Validation and remaining gates

Worker checks are dependency-free and in-memory only. The request CPU suite covers body forgery, revocation, changed credential/execution/session, real service provenance and private Job denial, approval write/execute permissions, capability/revision/prompt changes, canonical message/event/memory eligibility, metadata-only queue filtering, cancellation settlement and exact launch identity. Core regression cases cover capability expansion before claim and between commit and launch.

`veyra-dot-router-boundary.cpu.mjs` additionally contains a socket-disabled Express case proving fresh request factories and error forwarding. It is source for the central runner and was not executed in this worker's dependency-free-only allocation. Central compilation must include the real shared request modules; Memory's export was not yet present at the last worker read. Root must also run actual HTTP/auth/middleware and qualified-runner checks. Previous 17/17 actual-core acceptance predates this request-composition change and does not qualify these new modules.

Regenerate worker evidence with the existing Node binary and loader, selecting adapter/service/schedule/core-binding/request-binding and dashboard view-model CPU files. Use `--test-name-pattern='^(?!SQLite close/reopen)'` to exclude disk fixture creation. No installs, compiler output, cache, temp, services, models or desktop control are needed. All source/receipts stay under the existing task root; no new output root exists.
