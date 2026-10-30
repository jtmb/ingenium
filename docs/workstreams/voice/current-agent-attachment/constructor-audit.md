# Selection-owner constructor audit

Source-only follow-on for Root. Global request/client fence remains inactive.
No shared changes, runtime tests, builds, models, devices or Computer Use.
Read actual `prd-ui-fixes` sources; hashes are in constructor-audit.json.

## False blocking and unsafe aliasing

1. `opencode-client.ts:2514-2540`, createBackgroundSynthesisBrokerExecutor:
   original Core runtime is selected with getReadyRuntimeForProject; manual
   selection must match runtime ID/owner. isLocalRuntimeBinding additionally
   verifies original project, authorized workspace, bootstrap claimed owner,
   organization/security epoch and compatibility local placement. It then
   creates a scoped loopback target with authHeader/directory but no selection
   owner ID. Proposed binding rejects this target's mutations. brokerExecute
   creates a collection session BEFORE its first guarded PUT instructions.
   The PUT then throws; finally deleteSession can throw too, orphaning the new
   broker session. This is a source-derived failure prediction, not a run.
2. runtime-opencode-context.ts:41 creates managed target without owner ID.
   Existing proposal adds runtime ID here. Without it, model/agent/prompt,
   compact, update, delete, revert/unrevert and instruction writes all fail.
   GET/event reads are not selection mutations and do not require this key.
3. voice-v2/request-context.ts:54 and memory-engine-owner.ts:47 create managed
   targets without owner ID. Their currently observed snapshot/session calls
   are reads, so they are NOT falsely blocked by the mutation classifier.
   Later mutation inside these scopes would fail. Memory snapshot/recall
   transports preserve owner.target; do not invent another identity there.
4. No scoped target uses the proposed literal installation-opencode fallback.
   This covers ordinary default typed and direct synthesis paths, including
   executeSynthesisBroker calls in context, docs-ai, rag and jobs routes.
   They are not blocked solely for missing scoped ID, but that fallback has
   no original installation transport proof. config.opencodeUrl accepts
   OPENCODE_SERVER_URL; buildAuthHeader accepts either inline env credentials
   or a protected file. URL/password availability does not prove engine owner.
5. Simply adding runtime:<id> to the local synthesis target while retaining
   installation-opencode for the same default local engine SPLITS admission
   for identical engine/session IDs. That is unsafe even if synthesis usually
   creates its own session. Conversely, deriving IDs from hostname/URL or
   credentials does not establish original ownership and can merge unrelated
   engines or permit key rotation. Do not activate on that basis.

## Fixed constructor proposal supported by current owners

For managed-runtime scopes, centralize target construction behind an API-owned
factory that resolves the original Core RuntimeInstance by retained runtime ID,
preserves existing route/private/placement authorization, checks READY/IDLE,
workspace/project/organization/owner/security epoch and original backend mapping,
and returns a frozen target with selectionOwnerId = `runtime:${runtime.id}`.
Use that factory for runtime middleware, voice and memory owner target creation.
Do not accept a browser-supplied selectionOwnerId, URL, RuntimeInstance-shaped
object, arbitrary callback returning true, or forged generic target as proof.
A module-private WeakMap/branded handle can make the provenance runtime-checked;
a public optional string field alone cannot. Keep logical key stable across
backend recreation so it cannot clear an unknown admission merely by restart.
Actual backend/start identity remains a separate current-authority comparison.

For local compatibility/default scopes, current evidence supports the original
Core installation namespace `veyra_installation_identity.instance_id` (migration
122), and isLocalRuntimeBinding establishes original local workspace/runtime
ownership. It does NOT bind an arbitrary default URL to that engine process.
No complete safe fixed default constructor is available from the sources read.
Root must retain and validate the original startup transport/installation binding
before minting `installation:${instance_id}` and use that SAME protected handle
for default requests AND the verified local background synthesis adapter.
The constructor should take no externally supplied identity/positive proof;
read original installation/runtime owners and retained launch binding internally.
Do not use installation UUID alone to bless configured remote/default targets.
Do not replace protected transport ownership with hostname/env inspection.

Keep existing default typed/synthesis behavior while this boundary is absent.
Global activation that replaces the fallback with refusal would block established
features. A missing owner must be detected before broker session creation once
the boundary is integrated, not after the first write. Root owns integration.

## Remaining acceptance and safety limits

This proposal is a process-local admission identity improvement, not complete
single-writer coverage. Direct Web/auth proxy, Native and other processes do not
share its Map. API restart loses unknown slots. Core installation identity is
durable namespace evidence, not a persisted per-session mutation reconciliation
owner. Those gates remain open; no new queue, Run, engine kill or permissions
change is authorized or proposed. Tests for constructor provenance/aliases and
broker pre-admission remain to be authored with Root's eventual original binding.

Review checked every real withOpenCodeRuntimeTarget callsite found under API lib,
including snapshot/recall owner.target forwarding. No constructor patch is emitted
because a superficially complete default mapping would assert missing evidence.
Existing source proposal, SQL132 and 29 tests are preserved. Root separately
reported all29 proposal/canonical tests PASS; this worker ran none of them.
