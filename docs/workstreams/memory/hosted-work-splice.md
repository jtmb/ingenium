# Hosted-project Work memory proposal (Root splice required)

Owner: Memory chat 01a18935-0219-7cc0-88be-368fa7fa330c, same checkout and
existing approved C-backed Ubuntu VHDX. Additional retained allowance 96 KiB;
coordination/memory/hosted-work-proposal-receipt.json records baseline/inventory.
No tests/builds/DB/runtime/model/device/CU/process/downloads. Authored tests are
UNRUN; source review is not typecheck, UI, CSRF or persistence qualification.

New source only: memory-v2/HostedWorkMemory.tsx, hosted-contract/http/journal
modules and declarations; tests/veyra-memory-hosted-work.test.mjs. Core/API/Work
canonical files were not edited. No new store, transcript or credential owner.
Existing controller.mjs is reused byte-for-byte (Root/owned SHA256
07df864177ee2954aacb9f7e43ab8a8dff1eb70b91837e3b4ef1d49e965d87cb).

## Missing original response and minimal route

Current /api/v1/memory/lifecycle/policy returns policy/chat, scopeHash,
bindingHash/epoch and available. It does NOT return actor/org/selection,
engine-to-Context mapping or canChange/canForget. No synthetic adapter supplies
these. New component stays unavailable until Root installs BOTH this route and
the original expected-binding guards below. No positive proof callbacks exist.

Proposed GET /api/v1/memory/lifecycle/work-binding requires exactly workspaceId,
runtimeId, engineSessionId, optionally expectedProjectId (a known actual Project
UUID for narrowing only). Initial lookup does NOT require a client projectId:
current RuntimeContext provides projectName but no Project UUID. Do not send a
name, default project or projectless flag. Expected actorUserId/organizationId
stay client comparison metadata, never query grants. Server derives the real
non-null Project ID from the freshly authorized owned workspace. Absence of a
client Project ID is not projectless authority. Null server workspace.projectId,
drafts and compatibility remain unavailable. A known expectedProjectId must
equal the derived Project ID; it cannot authorize or substitute for the lookup.
Response {data:{schemaVersion:1,available:true,actorUserId,organizationId,
projectId,workspaceId,runtimeId,engineSessionId,contextConversationId,scopeHash,
bindingHash,bindingEpoch,canChange,canForget}}. All identity fields are strings;
scope/binding hashes are lowercase64-hex; epoch is a nonnegative safe integer.
Permissions must be actual booleans, not optional/default true. This DTO grants
no authority: every later route revalidates its real original owners.

Root route algorithm, under existing authenticated/limited route composition:

1. Validate exact workspace/runtime/engine and optional expectedProjectId keys;
   require a genuine current user principal, never a request-body actor, injected
   principal or Voice/agent permission. Freshly getAuthorizedWorkspace(workspaceId)
   through the existing runtimes owner: actual status authorized, owner matches
   principal, actual org membership current. Derive projectId ONLY from this
   original workspace. Null => projectless unavailable; optional known expected
   UUID mismatch => refusal. Do not resolve it from projectName/organizationName,
   labels, a global Project or a raw scope DTO. Build selected={projectId:the
   derived UUID,workspaceId:the original id,runtimeId:the requested runtime}.
2. Reuse withManagedRequestPlacement, resolveRequestExecution(request,selected),
   resolveRequestChatBinding(request,execution,engineSessionId,'active').
   The latter returns the genuine contextConversationId; do NOT assume equality.
   Read-only exemplar: voice-v2/request-context.ts::resolveHostedCurrentCallSelection
   uses this exact resolver chain around581. Do not call its Voice-specific
   CPU/agent/session path to establish memory authority.
3. createRequestMemorySession(request,selected).resolveScope('read',engineId)
   validates actual memory/execution/source ownership. Read scope policy and
   check fresh principal==scope owner, org/project/workspace/runtime/hash/epoch
   and both original mapping IDs. None are renderer claims.
4. Derive canChange/canForget by READ-ONLY inspection of real memory write
   capability: current principal scopes and existing
   authorization.requireProjectPermission(toAuthorizationPrincipal(principal),
   actualProjectId,'memory','write'), matching decision organization. Only an
   explicit genuine permission denial yields false. Revoked/stale/unknown/IO
   errors propagate; no broad catch(FORBIDDEN)=>false. A GET probe of
   session.resolveScope('write-policy'/'forget') is WRONG: current
   authorizeMemoryRequestOperation intentionally refuses mutation permissions
   on safe methods. Do not bypass unsafe-method/CSRF checks for actual writes.
5. Revalidate original workspace/project identity, ownership/security epoch,
   request identity, execution, read scope and exact reverse mapping
   immediately before returning; changed original/permission facts refuse.
   Cache-Control:no-store. No transcript/DB mutation or engine launch.

## Required expected-binding route guards

New adapter sends X-Veyra-Memory-Scope, -Binding, -Epoch and -Context (prefix
X-Veyra-Memory-) on every existing lifecycle request after acquisition. Query
chatId remains the actual ENGINE session ID, including chats/:chatId/policy;
canonical Context appears only in its distinct comparison header.

Root must require/validate the four headers for this hosted protocol, resolve
the actual request scope + reverse mapping, and compare exact current
scopeHash/bindingHash/epoch/context before any mutation. Unknown headers must
not silently be ignored: this is the binding-GET-to-PUT race boundary. Existing
session authorization/CSRF/CAS still run in the actual PUT/POST transaction.
For async entries/source inspection, compare before AND after qualification and
before final consumption, retaining original placement/history checks. The
current raw lifecycle router does not implement these headers. Registering only
work-binding and omitting these guards does not satisfy this proposal.

For recognized pre-handler binding mismatch use explicit BINDING_CHANGED409
or another reviewed refusal. The client conservatively retains original metadata
unless a matching committed receipt or known definitive pre-commit rejection
is available; no request is resent. BINDING_CHANGED, cancellation, malformed
responses, CSRF after canonical retry and server/transport errors remain
uncertain here. Root must review negative/no-dispatch reconciliation UX before
calling this complete; do not erase metadata merely because receipt is absent.

## Minimal Work mount

Inside Root's actual BoundWorkRuntime, after authenticated actor/org IDs,
confirmed workspaceId/runtimeId and successfully created engine session are
present, mount HostedWorkMemory with those five comparison/selection fields.
Current RuntimeContext.projectName and RuntimeWorkspaceOption.projectName are
display values, not UUIDs. No projectRefId prop is required on default /work.
An optional genuinely known expectedProjectId can narrow the server lookup.
The acquired binding carries projectId for all subsequent EXISTING lifecycle
calls and the journal. Refresh work-binding also narrows by that acquired UUID;
a changed Project cannot be silently adopted. Never use DEFAULT_PROJECT, a draft
ID, Context ID as engine ID, or guessed permission. Null selection is unavailable.
Root may place it
in the existing memory control/panel slot or in a small Memory details panel;
do not mount it simultaneously under two independent controller owners.

Initial selection key includes actor/org/workspace/runtime/engine and optional
expected Project; acquired controller identity also includes the real Project.
New selection
unmounts old resources, aborts reads, disposes controller and invalidates cursor
results; captured original writes retain their own metadata for reconciliation.
Strict Mode creates fresh controllers rather than reusing disposed owners.
All transport goes through imported dashboardFetch/getApiBase. Browser does
not set Authorization or CSRF tokens; canonical fetch owns credentials/marker/
CSRF and may replay only its certified pre-handler CSRF/step-up refusal. The
new adapter adds no retry or write auto-resend.

## Journal and bounded management presentation

localStorage holds only original operation metadata: actor/org/scope namespace,
operation ID, comparison IDs/hash/epoch, policy booleans/revisions or forget
memory ID/version or reset confirmation hash. No memory content, transcript,
model response, token or credential is persisted. Each operation has its own
key; quota/corruption/readback conflicts refuse sending. Race-created originals
are retained and reconciled individually; no blanket delete, overwrite or
assumption of localStorage CAS. Outstanding metadata blocks new writes. Durable
receipts remain in the single Core writer, not the browser. GET status never
replays a mutation, and a missing receipt never means it was not applied.

Bounded list uses actual entries.sourceWindow (candidateOffset/limit/scanned/
returned/unavailable/deferred/nextCandidateOffset), no globally qualified total.
Current LearnedMemoryList requires total:number and prints a scope total: it
cannot honestly consume this response. Proposal reuses its row/provenance/reset
types and presentation pattern in a bounded view; no shared component edit.
Optional minimal Root improvement: total:number|null with explicit unknown-total
text plus bounded sourceWindow prop, then reuse that shared component directly.
Do not pass returned page count as a global total. MemoryControls and existing
controller are reused directly.

MemoryDisclosure is deliberately not rendered: GET entries/recall does not
prove a model consumed context. Actual prompt-context owner and a bound turn
consumption receipt remain a separate Root gate before mounting disclosure.
No recalled content/instructions are added to the prompt by this proposal.
Forgetting through this panel uses original learned lifecycle suppression and
receipts; it does not delete transcript or replace explicit saved memory.

## Review pins, tests and remaining gates

At review, current Root SHA256s (recheck before splice; no automatic patch):

- API lib/routes/memory-lifecycle.ts: c7df5179963b12f3600da8b5c2e644aba4c8ddf3e53fc60ed56f6093c39b6f8e
- API lib/projects-v2/request-execution.ts: 7910a9895750227a93e7e87862c359cef574aa2c261b3bd2079c48c856eb501d
- API lib/memory-v2/request-policy.mjs: e80a87e4bbfe4f31871b27701cc4170971951c6288bc55fde88812684a90ab00
- Dashboard WorkRuntime.tsx: 0deca18e9599d24b8e5493f448ff14122a45600d856b2e4ee1c8fe84dfdb4d0d
- Dashboard src/lib/api.ts: c630f0415c2fc50e8b2b2bba10745ad57363a2cd78de058295a7da36ec3810bb

Authored UNRUN tests cover draft/compatibility/null-server-Project refusal,
workspace-first lookup without UUID/name/default inference, optional expected
Project narrowing and use of acquired UUID on later lifecycle calls, distinct IDs, absent
route/permission, forged binding, revoked permission/epoch drift before send,
CAS/header/CSRF delegation, lost write/reload/receipt without resend, actor/org/
scope partition, metadata-only strict journal, quota/corruption/racing records,
bounded cursor, post-await drift, teardown signals, exact forget receipts and
absence of false consumption disclosure. Root's admitted command:
node --test tests/veyra-memory-hosted-work.test.mjs, with existing tool/runtime
and TEMP/TMP/TMPDIR in the same authorized output root; no dependency install.

Root still owns route/header/mount integration, typecheck/component browser
tests, actual CSRF/permissions, reload/storage faults, genuine persistence,
fresh-chat retrieval/forget/isolation, prompt context and full release acceptance.
Projectless issuer/136/137/explicit-memory/MCP remain separate; no activation.
Goal remains honestly blocked. No full-goal or runtime success claimed.
Cleanup: no disposable paths, removed none/0B. Retain minimal source/tests/docs
and receipt for Root review/integration; end condition is integration or explicit
supersession. No prior protected target touched; no disk recovery claim.
