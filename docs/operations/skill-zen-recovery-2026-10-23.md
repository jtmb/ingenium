# Skill upload and free Zen synthesis recovery

Scope: repair persistent skill uploads and the existing free Zen synthesis path without changing models, mappings, variants or saved selections. All development remains in the current Codex window.

## Implementation

Non-global skills now use their registered, API-owned project data directory. They no longer infer the application source root from the database location. Global skill storage and model/config paths remain unchanged. A failed required projection rolls back the upload/edit transaction, preserving the previous content and revision.

OpenCode v2 separates catalog filtering from permission evaluation and tool execution. The protected broker enforcer retains native approval-only catalog entries, denies every broker permission evaluation, and rejects every broker tool call in the native pre-execution hook. The latter also covers plugin tools that omit their own permission checks. Root-owned profile/configuration protections, reserved identity enforcement and per-project shadow removal remain active. No provider headers, credentials, model identities or billing/quota policies are spoofed or bypassed.

The broker also rejects provider-error messages, empty completions and attempted tool use instead of treating them as successful synthesis text.

## Source and native checks

Project isolation, global storage, failed upload rollback and failed edit rollback are covered. Existing skills, governance and protected-agent tests remain applicable. Protected native permission probes deny read, shell, edit, subagent, skill, MCP, external-directory and arbitrary plugin actions under hostile project configuration. Enforcer tests cover the pre-execution guard, aliases, reloads and retained ordinary agents.

## Deployment results

Deployed `ingenium-ingenium:release-20261023-a8a87ae8ab37` from `c2c6ddbfd354a725d4d4f811b28899c3693b00fc`. The container became healthy in 63 seconds with identical mounts, ports and projected model configuration. All 14 model/configuration/profile source files remain byte-for-byte unchanged. Native permission probes and protected application-code checks passed against the built image.

All 235 focused tests passed: 172 core skill/governance/protected-agent checks, 45 API broker/provider/security checks and 18 enforcer/configuration checks. Core and API type checks passed.

The supported API migration projected eight existing skills across four non-global projects. Every existing skill row, content and revision remained unchanged; the old packaged source files were retained.

Actual UI upload, preview, edit/save and reload passed, with desktop and mobile screenshots reviewed. The skill also survived a normal container restart with identical database content and file hash. Its projection is owned by the unprivileged API user. All three protected application keys were preserved. API archive/restore checks were confirmed in the UI, and the owned QA project was then archived with its records retained. An initial test waited for PUT instead of the actual PATCH method; that test error was corrected and the owned fixture retested.

## Remaining live synthesis gate

At 03:16 UTC on October 24, the actual UI resumed the existing failed three-observation batch using the unchanged `opencode/beam-free` choice. The updated broker received HTTP **429**, rather than the earlier 403 response. Native logs contain the free-usage-limit message. The provider did not supply a usable completion or a reset time. No further manual inference retries were made.

The batch remains resumable at `created`; no skill proposal was generated or approved, and successful end-to-end free Zen synthesis is **not yet verified**. The 429 result alone is not a completed-synthesis acceptance test. The request to use a different existing free model for verification is pending; no alternate model has been selected and no saved default changed. Quota, provider identity and billing checks were not bypassed.

The remaining acceptance is a real free Zen response, completion of this retained batch, a grounded persisted proposal, and review/activation with zero executed tools. Keep the release acceptance open until those gates pass.

## Primary upstream evidence

- [OpenCode v2.0.11 catalog filtering](https://github.com/anomalyco/opencode/blob/v2.0.11/packages/core/src/tool.ts) and [permission evaluation hooks](https://github.com/anomalyco/opencode/blob/v2.0.11/packages/core/src/permission.ts).
- [Restricted-agent free-tier rejection report](https://github.com/anomalyco/opencode/issues/54744). This motivates testing native catalog compatibility; it is not evidence that our own live synthesis passed.
