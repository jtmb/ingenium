# Proposed native exact-conversation Web port

This is a coordinator review proposal, not an implemented Gateway contract or qualified host. It changes no transport, native capability, CSP, IPC or upstream page. Native Work continues to show Web unavailable until the actual service owner can establish every binding below.

## Current owner evidence at native61c99f8e

| Source | Observed ownership and consequence |
| --- | --- |
| App.tsx, original Workbench render | App passes the actual catalog Project, snapshot/service instance, selected profile and liveSessionSelection ID. onSessionChange records the Workbench's reported session ID with that selected project. The wrapper's scope is presentation fencing only and cannot qualify an engine. |
| Workbench.tsx:612 and1346 | activeSessionId comes from the actual returned session.id. Explicit selection reads GET /v1/agent/sessions/:selectedSessionId and rejects a different returned ID before setting the session. The selected sidebar ID alone is not proof that this read finished. |
| Workbench.tsx:1370 and1386 | History reads target that actual activeSessionId, with original pagination/durable message handling. The wrapper must never reimplement this history or resend a prompt on return. |
| Workbench.tsx:614 | Permission view includes project ID/revision/environment/root, service instance, actual session ID and returned session.projectID. That engine project ID is not the Veyra project label or UUID. |
| packages/contracts/src/index.ts, TaskPermissionOwner | Existing typed owner contains service_instance_id, project_id, project_revision, environment, directory, session_id, engine_project_id and engine_instance_id. Reuse this evidence-bearing owner rather than infer engine binding from directory or project names. |
| Same contracts, PromptOriginal / SessionCreationOriginal / SessionCreationOwner | Originals retain engine instance/project/revision, full project, configuration, profile/quant/context and session data. A pending/unknown original is not replaced or reconciled by opening Web. |
| useTaskSubmission.ts and TaskSummary | Saved task admission is keyed by task_id, with a receipt matching service_instance_id. TaskSummary.id is a task record; it must not be converted to an engine conversation ID. The service needs an explicit authoritative mapping if a saved-task view opens Web. |
| platform/types.ts:162 | Gateway.workbench is a generic authenticated request port. Existing OpenCode setup ports install/configure the engine. Neither is a qualified exact-session Web presentation port. |
| MvpDesktop.tsx | The entered shared-service origin launches a separately authenticated service workspace. It is not evidence of this native project/session/engine binding. |

## Minimal typed proposal for the actual gateway owner

The coordinator should adapt names and fields to its real authority and host primitive. No frontend implementation should mint these values. Timestamp units and nullability must remain explicit.

```ts
type NativeWebOwner = TaskPermissionOwner; // reuse the generated original type
type NativeWebReadRequest = Readonly<{
  owner: NativeWebOwner; // from the current service-validated session owner
  expected_engine_revision: number;
}>;

type NativeWebBinding = Readonly<{
  binding_id: string; // service-issued, opaque, no bearer credential in UI storage
  owner: NativeWebOwner;
  engine_revision: number;
  authorization: Readonly<{
    actor_id: string; organization_id: string | null; policy_epoch: string;
  }>; // service-asserted principal; absent native auth evidence cannot qualify
  upstream_version: string;
  protocol_id: string; // verified served protocol, never a frontend route guess
  public_origin: string; // service-validated allowed origin; no credentials
  observed_at_unix_ms: number;
  expires_at_unix_ms: number;
  invalidation_epoch: string;
}>;
type NativeWebObservation =
  | { kind: "unavailable"; reason: string }
  | { kind: "qualified"; binding: NativeWebBinding };

// Both are proposed additions to the coordinator-owned typed Gateway.
// Read is observational and must not launch/start/load/create/admit anything.
readConversationWebBinding(request: NativeWebReadRequest):
  Promise<NativeWebObservation>;
// Explicit user action only. The host resolves binding_id using its existing
// isolated Web surface owner; UI never constructs a route or gets engine auth.
openConversationWeb(request: Readonly<{
  binding: NativeWebBinding;
}>): Promise<
  | { kind: "unavailable"; reason: string }
  | { kind: "opened"; binding_id: string; invalidation_epoch: string }
>;
```

The host must expose a real embedded presentation lifecycle appropriate to the existing native security boundary before the opened result can become a successful in-place Web toggle. A separately opened shared-service window does not satisfy this requirement. A qualified metadata read alone is not a rendered-session acknowledgement.

## Service validation and invalidation

The authoritative owner must match every owner axis and engine revision against the selected native session, including current project revision, actual execution environment, canonical directory, engine instance and engine project. It must establish an authenticated principal and policy scope; the frontend cannot derive these from local storage, display labels, a stale snapshot or an installation ID. A saved-task record needs a real task-to-engine-session mapping; no UUID/string/title matching is sufficient.

Reject on disconnect/reconnect, service/engine restart or replacement, reader/principal/org/policy epoch change, project revision/root/environment change, session deletion/mismatch, expired binding, host/protocol/version/origin mismatch, launch failure or revoked capability. The actual host owns invalidation and disposal; the UI also fences late results against its captured owner and intent. A pending request must not redirect a newer selection.

Returning to Work keeps the original Workbench mounted and invokes only the existing owner's observational history/status/permission refresh. Lost prompt, session-creation, fork, approval or model-operation outcomes remain unresolved until their existing receipt paths resolve them. Web activity cannot unlock/replay an original or silently change model/quant/context. Drafts and attachment originals stay scoped to their existing controller; any upstream draft is the upstream owner's state.

Required acceptance: actual same-session rendered acknowledgement, authorized native/WSL owner match, expiry/restart/principal changes, unavailable/failed launch recovery, pending-original preservation, shared history/tool/approval refresh, no duplicate submission, keyboard/scroll retention and unchanged upstream/CSP/IPC behavior. These gates remain open.
