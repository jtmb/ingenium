# Skill upload and free Zen synthesis recovery

Scope: repair persistent skill uploads and the existing free Zen synthesis path without changing models, mappings, variants or saved selections. All development remains in the current Codex window.

## Live acceptance — October 25, 2026

Both repairs now pass live verification on the existing deployed image; no rebuild or model change was needed for this recheck.

- A new owned project passed real Markdown upload, preview, edit/save and reload through the UI.
- The actual Run Synthesis button resumed the retained three-observation batch using the unchanged `opencode/beam-free` selection. Both broker calls used that model. At 06:35 America/Toronto (10:35 UTC), the batch completed: pending observations fell from three to zero, processed observations rose from 184 to 187, and the incomplete batch cleared.
- The model generated a new `lark-scratch-validation` proposal grounded in all three owned observations. The proposal was opened, reviewed and approved through the UI. Its new skill was activated, displayed and retained after reload. The API-owned persistent directory contains the generated SKILL.md and both reference files with matching content.
- A separate new empty chat sent exactly one prompt to Beam Free and received its exact unique marker. Historical messages were not used as proof.
- Current native permission probes again denied read, shell, edit, subagent, skill, MCP, external-directory and arbitrary plugin operations. No broker model override was present. The existing protected execution hooks remain in place.
- All 14 model/configuration/profile source files and the production projected model configuration remain byte-for-byte unchanged. The runtime code is still the previously validated `c2c6ddbfd354a725d4d4f811b28899c3693b00fc`; subsequent source changes only record acceptance.

Desktop/mobile evidence was reviewed. After validation, the generated synthetic skill and the separate QA project were archived, and only the new synthetic trait was dismissed. Existing traits were verified unchanged; the applied proposal and observation history remain retained. The failed-batch blocker is resolved. No alternate model, paid fallback, new provider identity or quota bypass was used.

This closes the live upload and synthesis gates for this repair. Broader integration limits from the earlier independent UI review remain separate from these two fixes.

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

## Historical quota gate — superseded by October 25 acceptance

At 03:16 UTC on October 24, the actual UI resumed the existing failed three-observation batch using the unchanged `opencode/beam-free` choice. The updated broker received HTTP **429**, rather than the earlier 403 response. Native logs contain the free-usage-limit message. The provider did not supply a usable completion or a reset time. No further manual inference retries were made.

At that checkpoint the batch remained resumable at `created`; no skill proposal had been generated or approved, and successful end-to-end free Zen synthesis was not verified. The 429 result alone was not a completed-synthesis acceptance test. No alternate model was selected and no saved default changed. Quota, provider identity and billing checks were not bypassed.

Those acceptance gates were kept open until the live response, completed batch, grounded persisted proposal, UI review/activation and protected tool-denial checks above passed on October 25.

## Primary upstream evidence

- [OpenCode v2.0.11 catalog filtering](https://github.com/anomalyco/opencode/blob/v2.0.11/packages/core/src/tool.ts) and [permission evaluation hooks](https://github.com/anomalyco/opencode/blob/v2.0.11/packages/core/src/permission.ts).
- [Restricted-agent free-tier rejection report](https://github.com/anomalyco/opencode/issues/54744). This motivates testing native catalog compatibility; it is not evidence that our own live synthesis passed.
