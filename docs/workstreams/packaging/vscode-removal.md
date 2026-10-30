# Remove bundled VS Code from Veyra

Approved additive release requirement, 2026-10-30. Product-facing bot name: **veyra-bot**.

This worker prepares source only. Root owns integration and acceptance. The previous original-candidate proposal at `1b3d255131e493d40ca060129fde16e4f5124797` stays frozen; its private context, candidate waiting-child/readiness, live 18-case qualification and independent approval gates remain open. Removing the editor neither cancels nor accepts those requirements.

## Reviewable packaging delta

`vscode-removal.patch` proposes 20 exact canonical paths. Four deletions remove repository-owned editor implementation files; no patch deletes a user file, mounted directory, Docker volume, backup or database row. `vscode-removal-receipt.json` contains each exact preimage/postimage byte count and SHA-256 and the Root HEAD observed during generation. `vscode-removal-proposal.mjs` is the reproducible in-memory transformation, and `vscode-removal-freeze.mjs` emits the patch without applying it. Original file newlines/EOF are preserved. `git apply --check` passed against the actual Root source; the worker did not apply it.

| Proposed source | Exact effect |
| --- | --- |
| `Dockerfile` | Remove code-server download/extraction/symlink/version check; built-in theme and VSIX install/verification; editor UID/GID/home/state initialization; script and nginx include copies. Every final target inherits `runtime-base`, so this affects user-runtime, runtime-manager, runtime-gateway, control-plane and compatibility. |
| `config/vendor-security.json` | Remove nine editor-only package overlays; retain the existing npm undici overlay with its exact pinned identity/integrity. |
| `scripts/install-vendor-security.mjs` | Allow only the global npm overlay root; resolve semver from `/usr/local/lib/node_modules/npm/package.json`, replacing its dependency on the removed code-server package. Preserve old identity, same-major, target safety and dependency-range checks. |
| `supervisord.conf`, `runtime-supervisord.conf` | Remove only `[program:vscode]`, including the compatibility editor user and editor stdout/stderr paths. Retain Web/CLI programs. |
| `scripts/docker-entrypoint.sh` | Remove editor identity lookups, editor home/state provisioning and editor-only stale socket unlink helper. Stop adding editor workspace/default ACLs; preserve Web/terminal ACLs and other startup security. |
| `scripts/runtime-entrypoint.sh` | Stop creating/chmodding `/home/appuser/vscode-data`; preserve the job-role branch, configuration, credentials and workspace setup. |
| `scripts/validate-process-isolation.sh` | Remove the deleted account from six explicit user lists; keep remaining service isolation checks. |
| `docker-compose.yml` | Remove the editor mount and unused named-volume declaration. This does not issue a Compose deployment, `down -v`, volume removal, data migration or historical state mutation. |
| `nginx/gateway.conf` | Remove editor upstream `127.0.0.1:4100`, editor request buckets and editor WebSocket maps. Retain Web/CLI routes and protections. |
| `nginx/runtime-aliases-compatibility.conf` | Replace the old editor proxy with an explicit dual-stack `vscode.localhost` tombstone using the existing static unavailable/404 include. Retaining the named deny vhost prevents fallback to the default dashboard. Production aliases already use that deny include and remain unchanged. |
| `scripts/healthcheck.sh`, `scripts/runtime-healthcheck.sh` | Remove editor supervised-process/readiness/CSP checks; keep API/Web/CLI/restore checks. Add editor-host HTTP and WebSocket-upgrade 404 checks in both compatibility and control-plane modes. |
| `services/ingenium-api/scripts/restore-maintenance.ts` | Remove editor only from the two stop/restart lists. Preserve every other byte, journal/signature validation, backup logic, recovery and rollback. Root reviews this API-owned integration hunk. |
| `scripts/validate-gateway-config.sh`, `scripts/validate-deployment-config.sh` | Remove obsolete positive install/listener/artifact checks and require retired-editor denial/absence. Remaining guards stay in place. |
| `scripts/start-vscode.sh` | Proposed source deletion: no new package launcher, auth-none editor, extension installation or port 4100 listener. |
| `scripts/validate-vscode-theme-manifest.mjs` | Proposed deletion of the now-unused editor theme validator. |
| `config/vscode-extensions/ingenium.system-theme-defaults/package.json` | Proposed deletion of the bundled editor-only theme manifest. |
| `nginx/proxy-vscode.conf` | Proposed deletion of the now-unreferenced editor proxy include. |

Exact retired package artifacts:

- code-server `4.143.1`, `https://github.com/coder/code-server/releases/download/v4.143.1/code-server-4.143.1-linux-amd64.tar.gz`, archive SHA-256 `614877cf71005f14ea252bd2d9b1c12237cf7d73681ef150f0dff7f13849fdb5`; `/usr/local/lib/code-server` and `/usr/local/bin/code-server`.
- VSIX `sst-dev.opencode@0.0.13`, `https://open-vsx.org/api/sst-dev/opencode/0.0.13/file/sst-dev.opencode-0.0.13.vsix`, SHA-256 `e9a75751aa21fce3f9c9822d1f718043b1a9ba97e64c66b190a3fa85850c60d4`; `/usr/local/share/ingenium/vscode-extensions` and built-in theme under `lib/vscode/extensions/ingenium.system-theme-defaults`.
- Editor service account UID/GID **1107** and `/home/ingenium-vscode`. Keep this ID unused; do not renumber other service accounts or assign the retired ID to a different service. Existing numeric owners/ACLs remain historical data; this proposal does not strip them or recursively rewrite workspace ownership.

Nine retired overlays, all beneath `/usr/local/lib/code-server/`:

| Package | Old → replacement | Relative target |
| --- | --- | --- |
| shell-quote | 1.10.0 → 1.11.0 | `lib/vscode/node_modules/shell-quote` |
| follow-redirects | 1.16.0 → 1.16.1 | `node_modules/follow-redirects` |
| undici | 7.29.1 → 7.30.1 | `lib/vscode/node_modules/undici` |
| body-parser | 2.3.0 → 2.4.0 | `node_modules/body-parser` |
| qs | 6.16.0 → 6.16.1 | `node_modules/qs` |
| iconv-lite | 0.7.2 → 0.7.3 | `node_modules/iconv-lite` |
| content-type | 2.0.0 → 2.1.0 | `node_modules/body-parser/node_modules/content-type` |
| zod | 4.3.6 → 4.6.6 | `lib/vscode/node_modules/@github/copilot-sdk/node_modules/zod` |
| zod | 4.4.3 → 4.6.6 | `lib/vscode/node_modules/zod` |

Retain npm `12.2.1` and `/usr/local/lib/node_modules/npm/node_modules/undici` `6.29.0 → 6.29.1` with the unchanged SHA-512 integrity in the receipt. Actual image build must confirm the pinned npm includes the resolved semver module; the worker did not install or load it. Keep `python3 make g++ ca-certificates` in the builder and `supervisor nginx curl ca-certificates tzdata git acl libcap2-bin libssl3 openssl` at runtime: these serve surviving builds, Git/terminal, TLS, process isolation and restore. No apt package is proved editor-exclusive by this audit. OpenCode, ttyd, Chromium/computer-use support, cloudflared and Veyra's own file/Git capabilities remain in scope.

## Shared Core/API and gateway integration owned by Root

These are required integration targets, not applied changes. The packaging patch alone does **not** close editor access.

| Exact source | Required Root change |
| --- | --- |
| `packages/ingenium-core/lib/tools/runtimes.ts` | Remove `vscode` from active `RuntimeLaunchAudience`, origin/host admission, launch ticket mint/consume, browser-session exchange and session validation. Reject historical editor tokens/sessions before issuing backend names or authority. Keep rows/history intact. |
| `services/ingenium-api/lib/routes/runtimes.ts` | Change launch/health/exchange input enums to Web/CLI only. Remove 4100 compatibility target; never use a default branch that maps an unknown audience to CLI/Web. Reject legacy editor health/access requests. |
| `services/ingenium-api/scripts/runtime-gateway.ts` | Remove active editor audience, backend 4100 and editor host parsing; remove active editor cookie maps. Explicitly deny old `vscode--<runtime UUID>` hosts and old trusted public editor origins for both HTTP and upgrade before forwarding. Existing cookies must convey no authority; preserve Web/CLI audience isolation. |
| `services/ingenium-api/lib/compatibility-runtime-access.ts` | Remove editor from LAN launch, requestHost allowlist, exchange and session access. Retained in-memory/history tokens cannot revive the retired audience. |
| `services/ingenium-api/lib/cloudflare-trusted-ingress.ts` | Remove editor audience resolution; explicitly refuse a historical editor service entry before admitting a launcher origin. Simply deleting the audience mapping is insufficient because a legacy route could still resolve to a trusted service. |
| `packages/ingenium-core/lib/tools/cloudflare-tunnel.ts` | Remove active editor service/target minting. Handle old stored configuration through a read-only historical compatibility path that preserves it and renders the editor inactive; do not route it. Do not let a disabled legacy service invalidate or silently rewrite unrelated current Web/CLI/API routes. New enable/publish attempts must refuse editor. |
| `services/ingenium-api/lib/routes/dashboard.ts` | Remove expected editor process and service label from status; no permanently degraded status because the retired program is absent. |
| `services/ingenium-api/lib/routes/services.ts` | Remove editor process allowlist, port/title/label maps and start/stop/restart/log access. A caller cannot restart an obsolete supervisor entry through a stale service ID. |
| `services/ingenium-api/scripts/restore-maintenance.ts` | Review/apply the two-list hunk and test successful, interrupted and failed restore paths without waiting for or restarting the retired process. |

Preserve migrations `101_runtime_isolation.sql`, `102_runtime_browser_sessions.sql`, `105_runtime_localhost_browser_origins.sql` and other signed/history formats. Historical schema acceptance is distinct from active runtime authorization. Do not delete old editor database records to make tests pass. Verify all mint, consume, exchange, session-access, health and WebSocket branches deny editor even with otherwise valid original credentials. Do not only narrow a TypeScript union.

## UI integration targets owned by Root/UI workstream

- Remove the active `/vscode` page and `VSCodeFrame.tsx` iframe launcher, or retain a static unavailable route with no runtime launch hooks/network requests. Direct URLs must not reconstruct a frame.
- `src/app/components/Navigation.tsx`: remove the VS Code nav entry. `src/app/components/veyra-work/work-state.ts`: remove or replace the **Files and editor → /vscode** link using an already working Veyra file surface. Keep Work, file browsing and Git workflows; do not replace them with a dead link.
- `src/app/standalone/page.tsx`: remove the editor import, audience allowlist, title, rendering branch and StandaloneVSCode helper. `/standalone?page=vscode` must be unavailable. `WorkspaceControl.tsx` removes that popout type.
- `src/lib/runtime-urls.ts` and `src/lib/use-runtime-launch.ts`: remove editor constant/union/default URL branches. `next.config.js`: remove the editor frame-src origin; preserve Web/CLI and required CSP.
- `src/app/components/MainContainer.tsx`, `ProjectDropdown.tsx`: remove editor route exceptions/comments. `src/app/components/settings/panels/CloudflarePanel.tsx` and `src/lib/api.ts`: remove active editor service controls/type; allow read-only retired configuration display only when needed for history.

All paths above are relative to `services/ingenium-dashboard/`. Do not globally remove the words `editor` or `Code`: project membership role `editor`, documentation editors, plugin/config editors, CLI tools and the OpenCode product are distinct surviving features. Current product-facing prose uses **veyra-bot**; frozen historical receipts keep their exact bytes.

## Helm and packaged exposure

No Helm chart is present in this application tree. `docs/operations/kubernetes.md` identifies **`charts/ingenium` in private `jtmb/branconet-charts`**, delivered through existing Flux. This worker did not open an external chart checkout or verify its present templates/values; exact template filenames and current chart SHA remain Root/operator evidence to obtain. No live deployment, Helm command or external chart mutation was authorized for this worker.

The chart integration gate is concrete: inspect and render its existing templates/values, remove editor container port/Service targetPort **4100**, editor ingress/host/backend, editor-only process/environment/probe and new editor volumeMount/PVC declarations if present; preserve data claims, retained PVC/PV identities, backups and other mounts. Do not remove a shared claim or run uninstall/prune. Keep authenticated Web/CLI/runtime-gateway **8080/8443** and dashboard/API/OAuth **3000/4097/1456** exposure. The app Dockerfile already does not EXPOSE 4100 and Compose does not publish it; this is not proof of external chart absence. Private gateway ports must not be mistaken for obsolete editor ports.

Inspect generated Windows/Linux package manifests, installers, SBOM/file lists and all five image targets for accidental bundled code-server, VSIX/theme and launcher copies. Native/bundle manifests found without direct editor strings still need actual payload inspection. Source removal is not a claim about an existing installed package's contents, process list, disk savings or ingress.

## Preservation and acceptance

Existing `/home/ingenium-vscode/vscode-data`, `/home/appuser/vscode-data`, any existing `vscode-data` Docker volume, workspace `.vscode` folders, extensions/settings, old IPC sockets, snapshots and backups are protected user/history data. New startup must leave them alone. Their consumer is the owner's historical recovery/archive workflow; they have no new Veyra editor runtime consumer and no automatic deletion end condition. This task does not authorize destroying them. Do not invoke the old socket helper to clean them. Root should compare pre/post data hashes/identities during the actual migration rather than infer preservation from absence of a mount.

Existing backup code `packages/ingenium-core/lib/tools/backups.ts` declares format 2 with `manifest.json`, `ingenium.db`, `opencode.db`; this audit does not claim it backs up editor homes or workspace trees. Preserve historical signed bundles and legacy authorization/receipt rows exactly. Test the actual supported backup/restore formats and all protected separately mounted data; do not reinterpret an old bundle or remove legacy validation solely because the editor runtime retired.

Required live acceptance after Root applies/integrates:

1. All final Linux image targets and Windows release payload contain no code-server executable/tree, bundled VSIX/theme, editor launcher/proxy include or editor service account/startup. No supervised editor and no 4100 listener. Confirm actual pinned npm overlay still verifies. Quantify any image/package savings from measured payloads only.
2. Editor aliases, direct routes, old audience hosts/public origins, health probes, new ticket mint, old ticket consume/exchange, browser-session validation, service restart and HTTP/WebSocket traffic deny access. There is no fallback into another audience/dashboard backend. Web/CLI grants keep their original separation.
3. Work/file browsing and Git status/diff operate on the original workspace; Web works; CLI/terminal connection and WebSocket input work; Git operations and project/workspace switching remain correctly scoped. Verify the actual Windows and existing Linux deployment workflows, not source fixture rendering alone.
4. Backup preview/signature, restore quiesce/restart, interrupted journal recovery and rollback succeed without a missing-editor timeout. Existing editor/workspace/history data remains unchanged; supported historical backup metadata remains readable and cannot reactivate editor access.
5. Update current docs, screenshots/screen contract and tests that previously expected editor capability. Requalify the actual changed image and all candidate source hashes; never transplant approval or measured results from an old image. Preserve the full original release acceptance scope.

Related regression sources requiring review/update include `tests/test-image-provenance.sh`, `tests/test-compatibility-protected-runtime-acl.sh`, `tests/playwright.docker.config.ts`, dashboard `vscode-docker.spec.ts`, runtime launch/standalone/navigation/CSP/phase-2c gateway tests, API services/runtime gateway/compatibility/Cloudflare tests and Core runtime/backup/restore tests. Replace successful-editor assertions with explicit denial and surviving-feature checks; do not blanket skip or weaken those suites.

## Evidence and storage reconciliation

Twelve source checks passed under Windows Node 24.18.0 and WSL Node 22.23.1. They verify packaging removal and preservation of surviving blocks, exact retained overlay metadata, strict tombstone routing, health/restore changes, four named source deletions, negative validator checks, unchanged original inputs and `sh -n` parsing of proposed shell postimages. VM parsing of the altered npm installer is syntax only. These checks execute no installer, daemon, package build, model, Docker operation, network probe or user-data deletion. The full existing static validators, TS semantic compile, pinned npm resolver, nginx configuration rendering and live workflows remain unrun here.

The initial patch renderer omitted trailing blank context in some hunks; `git apply --check` rejected those hunks. The renderer now preserves normal context (including blank context rows), and the final exact 20-file patch passes. No failed patch was applied. Windows Node's test-runner UNC path discovery also required invoking the test from its own existing directory; no copied test tree was created.

Reuse the original C-backed WSL task root `/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845`. Six small durable artifacts under this existing worker's `docs/workstreams/packaging/` and its one existing coordination status are the only new/updated paths. Keep process TEMP/TMP/TMPDIR under `veyra-phase-1/coordination/packaging`, NODE_COMPILE_CACHE empty; no npm/Cargo/compiler/build caches or downloads were created. Regeneration commands and protected paths are in the receipt. Root is the remaining consumer of these source/patch/test/receipt artifacts through review, application and acceptance. No source snapshot, dependency copy, alternate drive/root or temporary payload tree exists.

Cleanup: **removed paths: none; measured removed bytes: 0**. There are no new disposable outputs to delete. Existing Native targets, caches, protected failure evidence and all user/runtime data were untouched. No Linux filesystem or Windows free-space recovery is claimed.
