# Core126 same-agent material and actual job profile gate

## Confirmed source gap and bounded proposal

Read-only Root observation on 2026-10-30 confirms `agents.getJobAgentConfig(projectId,name)` returns `{description,mode,system,hidden,permissions}`; Core admission uses SHA256 of ordinary `JSON.stringify` of that exact object. `launchMaterial.provision` currently carries no selected agent definition/permissions; `assignment` returns the agent name only. The runtime entrypoint calls `--project-server-owned`, whose actual allowlist contains only `chat/ingenium-chat.md` and root `plan.md`. It then writes generic extension MCP and observer/resource/lifecycle/other plugins before job dispatch. The immutable managed config also contains generic MCP/plugins, so editing one user jsonc file does not prove a closed merged job configuration. None of these observations proves that a selected project agent executes with the admitted definition/permissions.

The existing `job-runner.ts:createVaultOpenCodeRuntime` already uses native V2 JSON `agents:{[agent.name]:agent.config}`. Reuse that representation rather than writing lossy YAML or selecting an agent by name alone. This proposal adds pure, typed `packages/veyra-operations/core126-agent-material.mjs`, its declaration and CPU fixtures. It neither writes runtime files nor supplies a credential/permission owner. Root owns Core/manager/entrypoint/child/native-plugin integration and actual image/harness qualification. Storage/ownership remains the one existing packaging task root and approved prefixes in the main integration guide. No build/cache/temp/dependency/model/runtime output is generated.

## Original Core to manager to child

Inside original Core's existing synchronous one-use `launchMaterial` transaction, after its current authorization/profile/agent/provider checks and before returning material, re-read `currentFacts.agentConfig` from `getJobAgentConfig` and call:

```ts
const agentMaterial = projectCore126AgentMaterial({
  admission: a, agentName: currentJob.agent,
  agentConfig: currentFacts.agentConfig,
});
```

Return this private `agentMaterial` beside the existing capability/provision fields, within the same original authenticated manager handoff. The projection verifies the SAME admitted ordinary-JSON `agentHash`, exact five config fields, ordered native permission rules and default deny. It retains description, mode, exact system text, hidden and ordered permissions without normalization or model override. It binds original run/attempt/runtime/org/project/owner/workspace/binding/epoch/image/profile/agent hash/deadline. It rejects reserved/path/prototype agent names, extra config keys, credentials, replacement model and expired material. No user task prompt is included. This is private runtime material; do not include it or selected agent content in image manifests, logs, status, labels, Env, receipts or error details.

The original manager verifies it against the authenticated original admission using `verifyCore126AgentMaterial`, preserving the existing one-use material/effect/CAS/unknown semantics. Extend only the JOB attach handoff to a bounded two-part frame: existing capability line, then one JSON agent-material frame (max 384 KiB) terminated by EOF. Use the original private Docker attach path and in-memory private buffers, with no new token, endpoint authority or disk spool. Preserve the ordinary runtime capability-only handoff. The existing manager handoff currently accepts only the capability string, so extend that typed JOB port deliberately; do not discard material at `buildRuntimeSpec` or `handoff`.

The job branch must run before generic agent normalization/config/bootstrap. It must validate UID/private roots and original capability as before, read the bounded material frame, store material/overlay only in the existing private job tmpfs at UID/GID1000 mode0600 using descriptor-safe no-follow/exclusive/single-link/stable reads/writes, and create the selected native overlay with `core126AgentOverlay`. No shell interpolation or environment transport of agent content. Do not persist material beyond this original job container's required consumer.

The child fetches its original assignment through the SAME scoped job credential and original API. Root adds the admitted binding fields (including attempt, image/profile/agent hash and deadline) to the assignment, based on current original Core rows, then compares the handed material to this independent authenticated expected binding before any `spawn`. The job-agent NAME must also match the assignment's current original job agent. Continue to use admission's already verified model with explicit `--model`; never take a material/model override. A stale/changed assignment/material causes refusal/unknown under original ownership, with no replacement model dispatch or retry.

## Closed job config and actual native verification

A selected config file alone does not prove native V2 merged state. Root must implement and review an actual image-owned job-only loader/profile and native enforcement hook, and verify that the pinned OpenCode version loads it before any provider/model/tool dispatch. Do not invent an undocumented config-isolation flag or assume `OPENCODE_CONFIG` removes `/etc`, project, user or environment config. Run the actual inert config-loader/registry harness with hostile workspace/user overrides. If that cannot be established, this image remains UNQUALIFIED.

Proposed fixed image paths (no fallback):

- `/usr/local/share/ingenium/opencode-managed/job-opencode.json`: job-only immutable base config; dedicated actual job broker, protected reserved broker and the selected agent verifier; no generic plugins/bootstrap.
- `/usr/local/share/ingenium/opencode-managed/plugins/enforce-job-agent/index.mjs`: Root's actual native V2 hook reading original private material, rechecking the selected merged registry entry and ordered permissions before provider/model/tool use and on reload; reject on lost enforcement. Do not trust a caller's bool or a projected name.
- Existing `/usr/local/share/ingenium/opencode-managed/agents/ingenium-llm-broker.md` and `/usr/local/share/ingenium/opencode-managed/plugins/enforce-reserved-broker/index.mjs`: immutable original broker profile/enforcer retained without modifying its security semantics.
- Dedicated `/app/services/ingenium-api/dist/scripts/runtime-job-mcp.js`: actual scoped job-run transport from Root's reviewed broker integration, with no generic preflight.

`assertCore126EffectiveJobProfile` is a PURE comparison helper for that actual trusted hook/harness. Its `effective` parameter is not a capability or external API: only Root's real native merged-config/registry observer can supply it. Passing JSON/labels/expected values is not qualification. The observer must expose actual authority-bearing selected-agent fields without stripping unknown overrides: exact original five fields, id/name and reviewed disabled/model/steps/request defaults; unknown fields or nonempty request settings/headers/body refuse. Empty native request defaults are allowed explicitly. Hash the five original fields in ORIGINAL Core object order, preserving the ordinary-JSON contract, and require equality with the same admitted `agentHash`.

The actual observer also supplies measured static config/profile/plugin hashes, actual loaded plugin list, actual MCP server command/audience/run/attempt/capability-file binding, zero generic bootstrap requests and reserved broker identity/profile/enforcer. The static profile comes from the independently approved exact image manifest. An assertion of `configAuthority` or zero bootstrap is insufficient by itself: actual loader origin/call traces and image-pinned enforcement must prove it. If native V2 exposes further authority-bearing fields/defaults, review and explicitly represent them before extending this strict contract; do not silently strip or normalize them to make a test pass. Enforce private control/config/capability paths independently through the existing protected owner; do not broaden selected agent permissions or append silent grants.

The native selected-agent transform/hook must prevent hostile project config from replacing the material or broadening permission/model/request fields during activation/reload, and must fail before dispatch if it cannot observe/revalidate actual state. The immutable original reserved-broker plugin separately denies its tool execution; merely observing hidden/subagent is insufficient. The actual harness must attempt a reserved-broker tool and prove no execution. Preserve original provider and server Core authorization checks alongside local native enforcement.

## Strengthened immutable image witness

The manifest contract now requires 15 critical source files and 13 exact image artifacts, adding agent-material implementation/emitted closure, job-only base, job-agent plugin, original reserved profile and protected plugin. It verifies the helper's actual source-to-emitted closure path/digests too. Missing proposed Root files/artifacts refuse; no placeholder hash is allowed. Use future ACTUAL applied d35 broker/entrypoint/loader/plugin and compiled artifact hashes, not historical `core126-observed-root.json` or a future filename assumption.

The 13 actual inert protocol cases include exact public canary Core agent hash versus actual merged native definition/permissions, changed-agent denial, changed-permission denial, closed job-only MCP/plugins with zero generic bootstrap, and actual reserved-broker tool denial, in addition to original model/audience/run/attempt/grant/result checks. The canary is public and fixed; manifests contain only static/image/source/canary hashes and minimal results, never customer agent/system/user task text or credentials. Production ports must run the actual pinned image/SDK behavior; synthetic fixtures are not image qualification. Root must independently approve the raw manifest/image/source digest after the real tests.

## Validation and cleanup

Run dependency-free CPU tests with TEMP/TMP/TMPDIR set to the existing coordination/packaging and NODE_COMPILE_CACHE empty:

```text
node tests/veyra-release-core126-image.test.mjs
node tests/veyra-release-core126-agent-material.test.mjs
```

The 26 image tests and 12 material tests cover fixture determinism and drift/freshness/ownership plus exact Core hash, ordered permissions, material scope/expiry/name substitution, native overrides, generic MCP/plugins/bootstrap, immutable static file drift and reserved broker replacement. This worker does not run a compiler, build, Docker, OpenCode or model. The original full task remains incomplete until Root's actual integration/image/native/platform/workflow/security/visual/persistence acceptance. New durable source/types/test/docs are required for Root integration and future regression; no disposable files were created or removed, and prior protected cleanup exceptions remain untouched.