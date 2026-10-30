# Request integration contract v1

Coordinator-owned follow-on to veyra-parallel-v1.md. The complete phases 1–7 plan remains the completion condition. Reuse eight existing chats and thirteen checkouts. No additional source tree, dependency copy, compiler target, scheduler, identity authority or transcript owner is authorized.

## Shared request identity

The coordinator implements `services/ingenium-api/lib/request-identity.ts` with synchronous `revalidateRequestIdentity(request: Request)`. It reuses the existing authentication owner and returns `{ principal, attestation? }` for an unchanged current user/service identity, or null on missing, changed, expired, revoked, compatibility or runtime-gateway identity. It does not touch session activity during repeated domain checks or mint/cache permissions. The principal is the existing RequestPrincipal user/service union and attestation is the existing AttestedCoordinationIdentity. Workers can consume this exact export; do not create another credential parser or authorizer. It is a new composition seam, not yet qualified production evidence.

## Projects execution owner

Projects owns `lib/projects-v2/request-execution.ts` and its exports:

- `RequestExecutionSelection = {projectId: string|null, workspaceId: string, runtimeId: string}`. These are lookup requests only.
- `resolveRequestExecution(request, selection)` synchronously returns trusted ownership/execution facts or throws an inspectable unavailable/authorization error. Returned facts include organizationId, ownerUserId, explicit projectId, workspaceId, bindingHash, bindingEpoch, status:'authorized', runtimeId, mode:'runtime'|'native'|'compatibility', hostId, environmentId, available:true. Derive facts from existing authorities; unsupported owners stay unavailable. No invented host or projectless/global substitution.
- `resolveRequestChatBinding(request, execution, chatId)` resolves the exact private existing conversation and engine-session/runtime identity, rechecking original workspace ownership and scope. It returns those same scope axes plus chatId and visibility:'private' or denies.

Do not manufacture runtime readiness from a label or a stale snapshot. Native owners and projectless execution must come from their actual registry; missing facts become concrete coordinator integration requests. Existing contracts/permissions and original request journal remain authoritative.

## Memory and Dot consumers

Memory owns `lib/memory-v2/request-session.ts`, exporting `createRequestMemorySession(request, selected)` with the existing createCoreMemorySession result. Reuse request identity, projects execution/chat exports and existing explicit-memory/context owners. Keep generation/source eligibility fail-closed, synchronous and evidence based. Root owns route mounting, shared journal/restore barriers and final turn injection.

Dot owns `lib/dot-v2/request-binding.ts`, exporting the actual authenticated request-context, authorization, provenance and existing Jobs adapters for its current service/router/core-binding. Reuse projects execution facts and existing authorization; never infer approval from suggestion text or create a timer. Root owns scheduler insertion, router registration and server/UI root wiring.

Each worker delivers meaningful source/tests and reports exact interface errors to the named coordinator immediately. No worker edits another writer's source or claims full release acceptance. Integration-only source/test milestones leave all real platform, workflow, persistence, migration and production gates open.
## Canonical chat/history refinement

`chatId` is the existing ENGINE session/sourceSessionId. Context has a distinct canonical `contextConversationId`; preserve both IDs and return both without rewriting stored source metadata. Source lookup proves the unique private authorized Context record under exact org/user/project/runtime/sourceSessionId. Missing or ambiguous sources fail; latest-row selection is not authority.

`resolveRequestChatBinding(request,execution,engineSessionId,purpose:'active'|'history'='active')` uses a trusted server-selected purpose. Active controls require the unarchived chat. History can read an archived source under the same original content authority and exact scope, with deletion/exclusion/forget suppression preserved. Archive alone is not forget. HTTP body fields do not grant history authority. MemoryApiPorts.resolveChatBinding adds the operation permission; request-session selects history only for read-source.

Memory source eligibility policy `codex-memory-source-v1` uses minimum idle6h, configurable server-side integer1–48, matching the fetched official configuration reference https://learn.chatgpt.com/docs/config-file/config-reference and memory lifecycle https://learn.chatgpt.com/docs/customization/memories (2026-10-30). This threshold does not enable generation, contribution, external context or model execution. Missing actual settled admission facts deny eligibility. Server-owned admission chat/conversation/state/revision/Context revision enters the eligibility fingerprint and is rechecked at commit; no new prompt journal is implied.