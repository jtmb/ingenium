# Current request/runtime assembly

The coordinator's complete phases1–7 Windows/Linux plan remains the completion condition. This checkpoint implements request composition; it is not production, full feature, visual, device or release acceptance.

## Existing authorities and identity

request-identity.ts reuses the original authentication owner on every domain call. The original admitted actor, session/token, scopes, namespace limits and service attestation must still match. Cookie precedence and legacy normal authentication activity are unchanged. New core inspectScopedApiToken/inspectMcpCredential share their original validators but perform no activity write or checkpoint, allowing revalidation inside the existing synchronous single-writer transaction. Compatibility and runtime-gateway principals cannot become private memory actors.

Stable project-ID lookup is an additive core reader. Only the versioned memory lifecycle transport uses it in the existing private memory authorization policy; legacy name-based routes retain their contract.

## Actual managed execution placement

The original authenticated runtime manager adds GET /v1/runtimes/:id/placement. Its original Docker socket supplies actual managed container labels, backend ID/name, runtime scope, epoch/revision, state/health and daemon identity. The host namespace hashes that daemon identity without returning it. The execution environment uses the API-owned persisted migration122 installation identity and the managed-runtime profile namespace. Runtime replacement alone does not create a different host/environment namespace.

The API qualifies a five-second observation in request-local AsyncLocalStorage after original actor/project/workspace checks. Synchronous Projects/Memory/Dot readers recheck the exact current binding and DB handle. There is no cross-request identity/permission/placement cache. Missing, stale, unhealthy or changed placement remains unavailable; native, compatibility and projectless owners require their real separate adapters. Long jobs reacquire current original-owner facts at admission/commit instead of retaining a browser request. Manager redirects are refused.

## Memory transport

The versioned prefix is /api/v1/memory/lifecycle, mounted behind existing authentication, CSRF, authorization and rate limiters and before the unchanged explicit-memory router. Shared query fields are projectId, workspaceId, runtimeId; explicit projectless=true is recognized but unavailable until its real owner is composed. Owner/org/host/hash claims are rejected. Engine chatId remains separate from canonical Context conversation IDs.

| Route | Method | Behavior |
|---|---|---|
| /scope-policy | GET | Scope settings before chat creation, without inserting defaults |
| /policy | GET / PUT | Effective chat policy / CAS scope-policy update |
| /chats/:chatId/policy | PUT | CAS chat use/contribution update |
| /recall | GET | Qualified, private, provenance-bearing recall |
| /entries | GET | Inspect scoped learned entries |
| /forget | POST | Original operation/version and suppression receipt |
| /reset-preview, /reset | GET / POST | Preview, then confirmed scoped reset |
| /operations/:operationId | GET | Reconcile the original durable receipt |

Pagination/recall query budgets are strict safe integers. Header/body operation IDs must agree; no new ID or replay is introduced. Existing explicit-memory reads remain enabled by default; learned generation and external context remain disabled. Public transport cannot generate or restore memory. Generation eligibility policy, original source snapshot/owner, internal Jobs, shared saved+learned context budget and restore suppression barrier still require final composition and qualification.

## Source evidence

- Nine actual-core identity cases pass: no-write revalidation under an outer transaction, cookie precedence, actor/grant substitution, expiry/revocation and real service attestation.
- Nine pure original-manager observation cases pass: stable namespace, exact scope/epoch/revision/container, health/freshness/protocol denial. They do not exercise a Docker daemon.
- Twelve real HTTP + real core + real auth/CSRF/authorization/request-adapter cases pass, using an explicitly synthetic manager observation. They cover a scope with zero chat rows, distinct engine/Context IDs, operation/CAS/idempotency reconciliation, async revocation, false placement, private owner and MCP grants, strict inputs and rename-stable identity.
- Core and full API source noEmit pass with exact source aliases. Protected existing distribution outputs are untouched; these checks do not establish production emission or real platform readiness.

Authoritative private logs and first-failure evidence are under coordination/integration. Three consumed successful fixtures were retained because their exact cleanup preservation check encountered unlisted generated directories; no deletion occurred and no alternate-path retry is authorized. evidence/request-http-success-fixture-cleanup-r1.json records their exact paths. First-failure fixtures and every earlier cleanup refusal remain protected. No service/model/GPU/CU/production operation was activated by this checkpoint.