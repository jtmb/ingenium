# Request execution integration v1

Owned source implements the frozen coordinator contract in
services/ingenium-api/lib/projects-v2/request-execution.ts. This is a synchronous
lookup boundary over the existing API request identity, core runtime/workspace,
explicit-memory scope, project/content authorization and Context owners. It
creates no credential parser, registry, database, transcript, permission cache,
runtime, process or fallback project. Existing installation resource migration
122 and all legacy IDs/data remain untouched.

## Composition

The coordinator supplies its shared revalidateRequestIdentity export in
lib/request-identity.ts. Compatibility and runtime-gateway identities are denied.
The root installs its actual placement owner once with
installRequestExecutionPlacementResolver(owner). Missing installation remains
EXECUTION_PLACEMENT_UNAVAILABLE; this worker has supplied no default owner.

PlacementResolver receives an immutable lookup containing organizationId,
ownerUserId, projectId, workspaceId, bindingHash, bindingEpoch, runtimeId,
runtimeRevision, backendName, backendContainerId and now (milliseconds).
It synchronously returns all the same axes except now, plus actual stable hostId,
environmentId, observedAt and expiresAt (milliseconds), or null. The owner must
observe real placement, not construct IDs from backend labels or runtime IDs.
Every scope/backend/container/revision/epoch axis must match; evidence cannot be
from the future or older than 30 seconds, its validity window cannot exceed
30 seconds, and it must remain unexpired after the callback. Promises cannot
satisfy the synchronous contract. No placement result is cached.

resolveRequestExecution(request, {projectId, workspaceId, runtimeId}) treats all
three inputs only as exact lookups. Extra client authority fields are rejected.
The existing authorized workspace must retain its raw storage mapping hash and
epoch; runtime owner, organization, project, workspace and epoch must match.
READY/IDLE alone is insufficient: a registered container, current absolute/idle
lifetime, an unexpired lifecycle lease when present, current project access and
actual fresh placement are required. User identity must own the workspace.
A service also needs its exact existing credential/attestation, supported
mcp/runtime audience and current existing explicitMemory scope resolution,
including the credential/principal epoch and expiry checks owned there.
Request identity and persisted bindings are rechecked after callbacks.

resolveRequestChatBinding(request, execution, chatId) re-resolves execution from
existing owners, compares every retained binding axis, requires the exact private
existing Context conversation under the same organization/project/user, and
reuses existing content authorization and append-only Context archive state.
Only a source='opencode-chat' registration with matching sourceRuntimeId and
bounded sourceSessionId can supply engineSessionId. It never invents a session,
copies messages, changes a conversation or makes a remote engine lookup. The
persisted registration identifies the original session; live generation
admission remains the existing engine/request-journal owner's responsibility.
A second execution recheck prevents Context callbacks from admitting an old
runtime/binding. Lookup facts do not grant terminal input, generation or other
effect permission; original-journal/final authorization remains mandatory.

Inspectable RequestExecutionError values carry code and HTTP status. Invalid
input is 422, unavailable identity 401, hidden scope/runtime/chat 404, changed
binding 409, and missing execution/placement owners 503. Existing core failures
also deny rather than selecting another owner. Native, compatibility and true
projectless selections stay unavailable until their actual owners are composed.

## Source proof and central qualification

The dependency-free request-execution test uses the actual canonical migrations
001–121 in in-memory SQLite, existing runtime/workspace/conversation rows and
current state reads. Tests retain all SQL immutability triggers and foreign keys.
They cover no-write reconnect, revoked and mismatched ownership, stopped/expired
or missing-container runtime, exact placement/freshness axes, forged retained
execution, private chat/session/archive requirements, service attestation,
revocation during callbacks and current state persistence. These tests exercise
the implementation kernel and real schema; core method and facade import/type
qualification require the coordinator's actual emitted core/identity closure.

From the worker source with the existing Node runtime and TEMP/TMP/TMPDIR in
the existing coordination/projects root:

```sh
node --experimental-sqlite --test services/ingenium-api/tests/veyra-projects-request-execution.test.mjs
```

The full Projects CPU invocation still requires explicit
VEYRA_PROJECTS_NATIVE_SOURCE_ROOT="$PHASE/windows-source". Central requested
checks are the existing actual-core API type/emitted-closure checks plus request
identity, project/content authorization, service credential revocation and
Context archive tests with this facade. No local dependency install/build,
native compile, service, model or UI runtime was started here.

## Native/projectless proposal against the current tree

tree268-proposal.json records exact native tree
268acab8c5dcf14ab188ecd8fdcbb21c9316179b evidence. The retained complete
private-workspaces/native-private-workspaces.patch still dry-applies to those
shared files; its outputs match the proposed hashes. The proposal is not applied,
compiled or mounted. No duplicate full patch is retained.

The recorded tree still has ProjectStore schema version 5 with only native
project metadata, no private workspace DTO/store/route owner. ServiceState owns
a token and service instance plus existing project/task/effect supervisors; it
does not expose an authenticated organization/user authority or real private
root custody. routes/scratch.rs constructs ProjectCreateRequest/ProjectDraft
and returns a real Project. It is not projectless execution. Neither current
API authorized_workspaces.project_id nor runtime_instances.project_id permits
null; no migration/global-project rewrite is proposed by this worker.

The retained seven-file source patch proposes strict null-project DTOs, additive
metadata in the existing native single writer and an intentionally unmounted
boundary. Existing API/core actor scope must be joined to the selected native
service instance through a verified owner, real private filesystem custody must
be retained by the existing supervisor, and terminal/agent executors must consume
that custody without constructing Project/TaskWorkspace or replaying unknown
original effects. The coordinator owns those shared/native compositions and
schema allocation. Do not mount synthetic permissive ports or report private
projectless execution as accepted from these policy/schema tests.
