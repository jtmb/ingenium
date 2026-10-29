# Production memory adapter contract

Coordinator-requested follow-up to the integrated memory source through `6d52d341`. Implementation stays under `services/ingenium-api/lib/memory-v2/`; no route, root manifest, shared schema, migration, native runtime or scheduler is edited or started.

## Existing authority verified

- `packages/ingenium-core/lib/db.ts`: `getDb` owns the existing `better-sqlite3` singleton; `execTransaction(work,retries)` is synchronous; `checkpointAfterWrite` must run after transaction return. `createApiMemorySession` receives these existing exports. It never constructs another database and never reads a database path from a client.
- `packages/ingenium-core/lib/tools/explicit-memory.ts`: reuse `resolveExplicitMemoryScope`, including the service-principal/credential/expiry/security-epoch/storage mapping checks. The adapter adds a current active membership/project/workspace check without replacing the existing credential authority.
- Migrations098/101/109 own the exact org/project/private-owner, workspace mapping and runtime-state columns queried by the adapter. No alternate project or workspace catalog is created. Existing projectless records are unavailable to this adapter until the authoritative new workspace owner provides their exact mapping.
- `services/ingenium-api/lib/routes/context.ts` links engine Chat through private Context conversation metadata `{source:'opencode-chat',sourceRuntimeId,sourceSessionId}`. The adapter selects canonical `context_messages` through this exact org/project/owner/runtime/session identity and recomputes SHA256 over stored UTF-8 content before returning it.

## Assembly ports

Use `createCoreMemorySession` from `core-session.ts` in production: it statically binds the existing `ingenium-core` getDb/transaction/checkpoint/explicit-scope exports. It creates no DB at module load. Its actual type compatibility is part of the requested coordinator API noEmit check. `createApiMemorySession` remains the injectable implementation exercised by dependency-free fixtures. Construct either session per authenticated request/job context. Required synchronous server-owned ports:

| Port | Required evidence |
| --- | --- |
| `authenticate(request)` | Current authenticated user/service principal, scopes and service attestation from existing middleware/auth/session/credential owners. Revalidate revocation for an async job; raw body/header owner claims are never identity. Unsupported compatibility and runtime-gateway principals are denied. |
| `resolveExistingScope(input)` | The existing `explicitMemory.resolveExplicitMemoryScope`. User ID comes from authentication; service ID/credential/hash must match existing attested request identity. No project visibility widening. |
| `resolveExecution(...)` | Actual available host/environment and exact runtime/workspace/owner/org/project/mapping hash/security epoch. Runtime mode also verifies current `runtime_instances` state and scope from the API DB. Native/compatibility modes require their real resolver; no automatic fallback. |
| `resolveChatBinding(...)` | Actual private engine session/ConversationRef and its exact actor/org/project/host/environment/workspace/runtime/hash/epoch. A visible label or caller-selected folder is insufficient. Read-source must resolve the **source** chat. Archive alone is not forget/revocation; use the existing history access policy. |
| `authorizeOperation(...)` | Existing API authorization, token audience/project limits, CSRF/origin, capability and any elevated backup/restore or internal-generation checks. Required on every call, with no default allow. |
| `resolveSourceState(...)` | Current source activity, explicit exclusion/revocation, uncertainty and approved idle eligibility. These flags are never inferred from a title, stale request snapshot or a constant. Excluded/uncertain material is withheld. |

`selected` accepts only `projectId` (explicit string/null), `workspaceId` and `runtimeId`. Extra owner/org/hash fields are rejected. The selected IDs are lookup requests, never authorization. Native/compatibility resolver data is checked against authoritative workspace ownership. Missing/changed execution evidence denies access; absent projectless mapping returns availability error503, never a global-project substitution.

For projectless sessions, `resolveProjectlessScope` is an explicit additional port to the new authoritative workspace owner. It must return a private, authorized actor-bound null-project scope with exact mapping hash/epoch. Legacy Context/explicit-memory lookup is withheld when no real projectless owner exists. This is an open integration gate, not a fabricated empty successful migration.

`session.resolveScope(permission,chatId)` supplies the scope for the existing `memoryResponse` facade. Capture a server-validated selection and bind the facade request to its exact chat; never pass arbitrary body fields as a scope. `session.memory` uses the same authenticated resolver on every operation. Do not expose `readSource` as an unauthenticated route: it is the internal qualified extractor/source bridge, returns untrusted data, and does not create another transcript or automatically run inference.

## Transaction and restoration safety

The lifecycle accepts an optional synchronous `runTransaction` port. The production session calls existing `execTransaction(work,1)` and then existing `checkpointAfterWrite`, outside the transaction. One attempt preserves the first mutation failure and avoids a hidden replay. The prior dependency-free manual transaction path remains for isolated consumers/tests; production uses the core port. An already-active outer transaction is rejected before mutation, so checkpointing cannot occur under its lock.

For existing API workspaces, `bindingEpoch` is the authoritative workspace `security_epoch`, not runtime `revision`; native instance/revision guards remain additional requirements of the real execution/session ports and local identity key. The session is bound to the exact core connection it received. After maintenance replaces/closes that singleton, construct a fresh session only after the restore owner applies suppression bundles and releases its read barrier. The adapter fails on connection replacement instead of silently serving a restored pre-suppression database. A post-commit checkpoint failure retains the original committed operation receipt for reconciliation.

## Explicit-memory injection

`explicitMemoryForChat` reads effective scope/chat policy **before** calling the legacy loader and **after** an async load. Disabled use, a policy revision change or changed binding prevents injection. The returned explicit items must all be active/private and match exact org/owner/project/workspace; cross-owner rows fail closed. The helper never calls save/update/forget and does not change IDs, CAS versions, tombstones, receipts or restore suppressions.

Wrap the existing `explicitMemory.listExplicitMemories(scope,'private',budget)` as the loader. Preserve saved-memory priority: the final turn owner must allocate one combined memory item/token budget across explicit saves and learned recall, then disclose any omitted material. Do not independently allocate the full budget twice or let inferred recall displace an explicit correction. Existing explicit-memory formatting and source safety checks still apply after this gate.

## Validation and integration requests

`node --test services/ingenium-api/lib/memory-v2/adapters.test.mjs services/ingenium-api/tests/veyra-memory-http.test.mjs services/ingenium-api/tests/veyra-memory-jobs.test.mjs` passed **19/19**,0 skipped. Eleven adapter cases cover caller identity rejection, revocation, exact source/hash checks, service attestation, transaction/checkpoint order, nested transactions, replaced connection, projectless/native absence, explicit-use gating, async policy races and suppression/receipt preservation. Remaining eight are API/Jobs regressions.

The test database is an in-memory SQLite fixture using the inspected existing table columns and synchronous core interface. This does **not** claim that the installed native `better-sqlite3` module or full `getDb` migration initialization has been exercised. Request the coordinator's installed-wrapper smoke check and API noEmit typecheck on the new patch. No worker install, full build, live DB, model, provider or runtime was started.

Coordinator previously integrated through `6d52d341`: memory UI4/4 is verified in `coordination/integration/dashboard-tests-r1.log`. API/dashboard noEmit passes were reported by the coordinator; those r1 logs contain no diagnostics. They predate this adapter patch and do not qualify its new types/runtime assembly.

The existing API TypeScript build emits `core-session.ts`. The coordinator reports its AST closure copier now handles static MJS imports; ensure it includes the new factory import and excludes tests. Runtime modules are `lifecycle.mjs`, `http.mjs`, `jobs.mjs`, `adapters.mjs`; do not ship `adapters.test.mjs` through a blanket glob. The coordinator retains router registration, source/binding port assembly, migration numbering, restore barriers, shared journal, native/cluster checks and final visual acceptance.

Coordinator subsequently reports migrations122–124 allocated in parent, including memory123 generated virtual organization/owner FK references from the canonical six-axis key without changing positional inserts. Its actual core-wrapper integration test verifies original-table digests, memory/Dot/catalog writes, close/reopen fresh-chat recall/receipts and forget. This advances base-core compatibility evidence; it does not substitute for assembly/typechecking of the new adapter factory in this patch. The worker proposal schema remains unchanged and is used only by pure fixtures.

## Central real-core Vitest suite

`services/ingenium-api/tests/veyra-memory-core-adapters.test.ts` is submitted source for the coordinator's next central run. It imports the real `ingenium-core` through the existing API Vitest alias and the actual `createCoreMemorySession` entry point. It does not mock DB/auth/workspace functions or install the draft schema. The suite requires migration123's generated organization/owner columns; missing real migrations fail the setup.

Six sequential cases cover actual browser-session actor/revocation denial; actual service credential resolution/attestation/revocation; workspace security-epoch revocation through the core lifecycle; same-scope fresh-chat retrieval/receipts after close/reopen followed by durable forget; original receipt identity/version after a controlled post-commit checkpoint fault and reopen; and read/use gating over actual explicit saved memories. Original explicit-memory/context row digests and foreign keys are checked. The only fault seam replaces the checkpoint callback in one case; real core transactions and persistence remain in use.

Execution/host/source eligibility ports are deliberate fixture resolvers over the actual fixture runtime and Context records, not qualified production/live-engine bindings. Core runtime transitions update fixture DB records only; no provisioner, service, model, scheduler, container or microphone is invoked. The coordinator retains all real resolver wiring and attended runtime gates.

Run centrally after applying this commit, using existing dependencies and the existing API alias:

```sh
VEYRA_MEMORY_CORE_TEST_ROOT="$OWNED_MEMORY_COORD" \
TEMP="$OWNED_MEMORY_COORD/tmp" TMP="$OWNED_MEMORY_COORD/tmp" TMPDIR="$OWNED_MEMORY_COORD/tmp" \
node node_modules/vitest/vitest.mjs run --config services/ingenium-api/vitest.config.ts \
  services/ingenium-api/tests/veyra-memory-core-adapters.test.ts
```

The central runner supplies an existing absolute task-owned root and creates its scoped temp directory under its measured resource lease. No fallback to system temp, profile DB or user credentials is allowed. The suite creates one fresh SQLite fixture for all cases, restores process environment, closes the singleton and writes `veyra-memory-core-fixture.json` with exact generated paths. The fixture includes fake auth material only. Keep the fixture until the coordinator reviews the result/first failure, then perform normal exact containment/handle/mount/source-preservation cleanup. Budget one core DB/WAL plus a small fixture key/config, conservatively32MiB before central measurement; no dependency copy/install is requested. The worker has **not run this Vitest suite**.

Expected denial normalization is narrow: core `MEMORY_SCOPE_NOT_FOUND` becomes memory `FORBIDDEN`/403. Unexpected core/DB errors still fail as500 with sanitized responses. This closes the actual-core wrong-actor facade mismatch found during test design; no broader catch or authorization fallback is introduced.
