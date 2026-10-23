# Bootstrap and dependency follow-up — 2026-10-23

Scope: repair automatic cold-start credential bootstrap and resolve the production dependency advisories. Keep all agent models, variants and defaults unchanged. Development remains in this Codex window. Preserve unrelated work, installation data, keys, historical chats and rollback artifacts.

1. Retry only API availability failures with bounded request timeouts and capped backoff; keep permanent authentication, credential binding and filesystem failures closed. Preserve optional runtime fallback and synchronous invalidation of stale runtime identity.
2. Apply compatible patched dependencies. The fresh audit supersedes the earlier 21-moderate report: 19 moderate and four high affected packages, including newly updated Zod and body-parser advisories. Validate the Zod 4 migration and dependency overrides; do not hide findings or change models.
3. Run focused bootstrap/security and affected workspace checks, audit the installed production dependency tree, review and checkpoint only intended files.
4. Build and adopt the reviewed image. Verify cold-start bootstrap completes automatically, normal restart, unchanged mounts/keys/history, and existing chat/browser operation. No additional Zen inference while the free quota is exhausted.
5. Publish a reviewed follow-up PR through the existing remote, verify the merged source and live image, and record exact results here.

Stop only for a concrete unsupported dependency or failed preservation/security gate; report the evidence and continue independent work. Do not weaken acceptance, revive retired orchestration, manipulate unrelated applications or use OpenCode for development.

Source validation complete; image build and deployed acceptance are next. Prior release acceptance and evidence remain historical records.

## Source results

- Installed production tree: `npm ls --omit=dev --all --json` exits 0. `npm audit --omit=dev --json` exits 0 with zero findings at every severity. Missing-package audit results from intermediate resolver attempts were rejected, not accepted as fixes.
- Patched versions: Hono 4.13.13, its Node adapter 1.19.15, body-parser 1.20.9, qs 6.16.1, OpenTelemetry core 2.8.0, typography selector parser 7.1.6, and UUID 11.1.1 for MSAL/gaxios. UUID 11 preserves CommonJS and the consumers' v4 API. Native OpenCode and its aligned 2.0.11 client/plugin packages remain unchanged.
- Zod 4.6.7 replaces vulnerable Zod 3 and pinned plugin copies. MCP records now explicitly specify string keys; API errors use the supported `issues` property. API middleware still transforms valid input and returns structured 422 errors. An oversized production MCP discovery schema is rejected before visiting its elements.
- Type checks pass for core, API, MCP server and extension. Focused checks pass: startup provisioning 7, core 48, API 69, email OAuth/Gmail 20, MCP server 30, plugin/client 53, built transport parity 3, collection-limit regression 1 and HTTP-validation regression 1. Total: 232 tests. The initial transport parity run lacked its required generated artifact; building the extension resolved that prerequisite and all three parity tests passed.
- The bootstrap no longer has a terminal 60-attempt readiness deadline. Only transport failures, HTTP 408/429 and server errors retry, with 1/2/4/8/15-second capped backoff and bounded HTTP requests. Required credentials keep waiting for availability; optional local runtime stops after three transient failures and retains its fail-closed general-credential fallback. Authentication, binding and filesystem errors do not retry. Stale runtime identity is invalidated synchronously before waiting.
- The installed-image cold-start test deliberately withholds loopback API readiness for 75 seconds and fails the first credential POST. It requires the actual bootstrap CLI to recover without operator intervention and checks private installed capability/environment files. This is synthetic startup evidence, not a production model call.

Advisory sources: [Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828), [OpenTelemetry](https://github.com/advisories/GHSA-8988-4f7v-96qf), [UUID](https://github.com/advisories/GHSA-w5hq-g745-h8pq), [selector parser](https://github.com/advisories/GHSA-rj75-hqrm-r3gf), and [qs](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g). The [Zod migration guide](https://zod.dev/v4/changelog) describes the compatibility changes.
