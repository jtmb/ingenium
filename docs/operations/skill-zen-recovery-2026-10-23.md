# Skill upload and free Zen synthesis recovery

Scope: repair persistent skill uploads and the existing free Zen synthesis path without changing models, mappings, variants or saved selections. All development remains in the current Codex window.

## Implementation

Non-global skills now use their registered, API-owned project data directory. They no longer infer the application source root from the database location. Global skill storage and model/config paths remain unchanged. A failed required projection rolls back the upload/edit transaction, preserving the previous content and revision.

OpenCode v2 separates catalog filtering from permission evaluation and tool execution. The protected broker enforcer retains native approval-only catalog entries, denies every broker permission evaluation, and rejects every broker tool call in the native pre-execution hook. The latter also covers plugin tools that omit their own permission checks. Root-owned profile/configuration protections, reserved identity enforcement and per-project shadow removal remain active. No provider headers, credentials, model identities or billing/quota policies are spoofed or bypassed.

The broker also rejects provider-error messages, empty completions and attempted tool use instead of treating them as successful synthesis text.

## Source and native checks

Project isolation, global storage, failed upload rollback and failed edit rollback are covered. Existing skills, governance and protected-agent tests remain applicable. Protected native permission probes deny read, shell, edit, subagent, skill, MCP, external-directory and arbitrary plugin actions under hostile project configuration. Enforcer tests cover the pre-execution guard, aliases, reloads and retained ordinary agents.

This is a source checkpoint. Actual upload/reload/edit/archive, a real free Zen synthesis batch, persisted proposal review/activation, restart persistence and unchanged model configuration still require deployment validation. A free-tier quota failure must remain a visible external limitation rather than trigger a model switch.

## Primary upstream evidence

- [OpenCode v2.0.11 catalog filtering](https://github.com/anomalyco/opencode/blob/v2.0.11/packages/core/src/tool.ts) and [permission evaluation hooks](https://github.com/anomalyco/opencode/blob/v2.0.11/packages/core/src/permission.ts).
- [Restricted-agent free-tier rejection report](https://github.com/anomalyco/opencode/issues/54744). This motivates testing native catalog compatibility; it is not evidence that our own live synthesis passed.
