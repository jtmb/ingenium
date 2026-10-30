# Native Customize source delivery

Owner: existing Customize chat, branch codex/veyra-parallel-customize. This continues the original unfinished Plugins/Skills goal. The coordinator owns native assembly, authenticated bridge, builds and qualification.

The delivery is restricted to this native-ui directory in the original approved C-backed task root. No dependency copy/install, build, service, browser, desktop control, model, registry/configuration change or native integration/index mutation is performed here. The files/ subtree is canonical source, not a generated application snapshot.

## Components and actual owners

NativeCustomize supplies the screenshot layout: inner Customize sidebar, Plugins/Skills navigation, registered-package sidebar, search/refresh/Add/settings, narrow two-column rows, project-source preview, scope selectors, and existing management views. Shared native canvas/sidebar/control/text/accent tokens preserve dark/light theme ownership. NativeWorkDesktop/App retain the outer rail, header, projects and diagnostics. Avoid a second outer sidebar around this component. Layout stacks at compact widths and wraps at enlarged text/scaling; browser/native screenshots remain a qualification gate.

nativeCatalog.ts is a read-only DTO projection. It dispatches only these existing native gateway operations:

- GET /v1/plugin-packages/?project_id=<native UUID>&project_revision=<saved revision>. Decode the existing service_instance_id/project_id/project_revision, registry revision, engine_stopped, restart_required and packages. The selected immutable version supplies real package ID/version/license. Registered-disabled remains present; removed registration retains versions but is not installed. Display the returned activation text. Registration is never relabelled engine activation.
- GET /v1/extension-config/skill-workspace?project_id=<native UUID>&project_revision=<saved revision>. Decode the existing owner, string catalog revision, supported/reason and bounded skill sources. Project files are present sources, not a hosted installed/enabled/archived record or a complete engine inventory. Duplicate IDs at distinct actual paths remain distinct; read-only reasons stay visible.

Both reads reject crossed service/project/revision, malformed/duplicate identities and unavailable selected package versions. The controller clears stale owner views, ignores late responses after owner/transport changes and never manufactures a project. Projectless, archived and disconnected views perform no catalog read. Public/Personal/System are visibly unavailable through these native owners, with no relabelled project entries or guessed owner. Local/private package discovery is reachable through the actual package manager.

Mutation controls reuse the exact existing PluginPackages, SkillWorkspace, ExtensionsPanel, InstructionEditor and ScopedEngineSettings. No extra operational store, mutation wrapper, native-command invocation or changed permission/receipt rule was added. Visited manager components remain mounted while catalog presentation changes, preserving drafts and their original-operation reconciliation state. Owner changes intentionally fence/remount the view; original ledgers remain with the existing managers. Return to catalog re-reads current metadata without replaying an operation.

The host supplies renderLegacyWorkflows(gateway), rendering its existing Productivity element and original callbacks with the fenced gateway. This preserves agents, hooks, notes, templates and all other preexisting Customize routes rather than copying or replacing those owners. The host must retain its actual project/service/reader admission. No hidden connection credentials are accepted by these components.

## Coordinator composition

Apply only after reviewing manifest.json. Every new file has an absent preimage and canonical post-SHA256; existing native owner/slot files have tree-bound baseline blob and canonical pre-SHA256 plus observed raw hash. The provided staged tree is 268acab8c5dcf14ab188ecd8fdcbb21c9316179b. Native metadata is a Windows Git worktree: use Windows Git with exact per-command safe.directory and core.longpaths=true. Never rewrite its index or global Git settings from a worker.

1. Run git apply --check on native-customize.patch in the coordinator-owned native checkout, then apply through the coordinator's approved source selection process. The patch adds only apps/web/src/features/customize files; it does not edit App, NativeWorkDesktop, locks, routes or any other worker territory. Preserve any preexisting target and reconcile a failed preimage check.
2. Import NativeCustomize at the shared Root/App composition boundary. Replace only the area === "customize" rendered slot. Keep Scheduled and non-Work behavior with its existing owner. Pass gateway, actual catalog.selected (including explicit null), connected, and the coordinator's current service instance ID.
3. Supply renderLegacyWorkflows={boundGateway => <Productivity gateway={boundGateway} area="customize" project={actualSelectedProject} ...theOriginalCallbacks />}. This is a composition recipe, not a literal executable spread. Reuse the exact existing Productivity callback bindings from App; do not create a new project or route.
4. Keep NativeWorkDesktop admission/diagnostics and Work presentation/switch behavior intact. The coordinator owns Root identity, service-reader disposal, real project restore and cross-domain navigation. Do not mount the dashboard Next.js pages inside native React as if they shared transport.
5. Supply hostedGovernance only after its real bridge is authenticated and correctly mapped as described below. Its content must be an actual functioning owner UI, not a success placeholder. Foreign/missing owner fields fail visibly unavailable.

Full native screenshot matching/reachability and lifecycle acceptance remain unproven until coordinator application and actual browser/native qualification.

## Required hosted governance bridge

This is an OPEN integration gate owned by the coordinator, not accepted full feature completion. The native source editor's save/remove operation is not hosted archive/restore, synthesis, proposal approval or activation.

The existing hosted owners are services/ingenium-api/lib/routes/skills.ts and its governance routes/core skills/projection/pipeline owners; the accepted Customize read mount is /api/v1/customize. Reuse the canonical hosted request/reauthentication/CSRF/permission boundary, expected revisions, maintenance locks, existing resource IDs and operation receipts. The native workbench transport currently admits /v1 operations and must not be pointed at an invented hosted URL or token.

Required explicit binding:

- Native service instance + native saved-project UUID/revision/root/environment.
- Actual authenticated hosted actor/principal and hosted project UUID + exact API namespace, or explicit actor-owned null project when that real owner supports it.
- Actual installation UUID/resource owner, preserving existing installation skill identities/revisions. No synthetic global project, name fallback, installation copy, or duplicate skill store.
- A reader/operation epoch fenced on either service, actor, namespace, project revision, installation or permission change. Pending writes keep original owner/receipt and never replay on navigation/auth expiry/5xx.

The hostedGovernance composition slot takes the native serviceInstanceId/projectId/projectRevision plus actual actorId/installationId/hostedProjectId and authenticated UI content. Projectless is explicit projectId=null/projectRevision=null, with hostedProjectId=null only for a real actor-owned hosted scope. A mapped System/installation scope can retain its real hosted UUID without inventing a native project. The metadata match is a composition fence, not authentication proof. These are admission metadata for the supplied owner, not a new service DTO or transport. Native checks fence the native side; the supplied bridge must itself verify actual hosted IDs, current permissions and installation mapping before reads/writes.

Required existing hosted capabilities/DTOs:

- GET /api/v1/customize?project=<exact namespace>&kind=skill|plugin&visibility=project|system|public|personal&offset=0&limit=100. Envelope: scope:{kind:"project",projectId}, scopes, data rows with id/kind/name/description/category/visibility/installed/enabled/archived/revision/actions and pagination:{offset,limit,total,hasMore}. Only configured, permission-filtered scopes may be enabled. Public/Personal remain unavailable without an actual owner. Native project-source data cannot substitute this envelope.
- Existing skills get/create/PATCH through the canonical hosted client, retaining content/references/tags/always_apply, project_id, id/revision, and the C4 first-failure/draft/unknown-write rules. Keep validation versus service refusal versus unknown write versus confirmed-write/readback failure distinct.
- GET /skills/archived and POST /skills/:encodedName/archive|restore under the canonical /api/v1 prefix and exact project query. Use real full installed metadata for disabled records, not active-only listSkills; archive is distinct from native source removal.
- Existing proposals counts/page/detail and approve/reject/rollback methods preserve actual proposal IDs, expected revisions, filters/cursors and pending request epochs.
- Existing synthesis/pipeline owner must retain batch grounding, proposal generation, approval, activation and fresh-chat skill selection. It is not a new native POST or automatic engine start. Provide its existing authenticated UI/action owner via the bridge rather than guessing an endpoint.
- Real runtime activation must be read from the existing deliberate engine/session inventory and attachment owner; source presence, enabled registration and a successful save are insufficient evidence.

Bridge failures must remain visible. Do not grant a broad native transport proxy or advertise unavailable capabilities as functional.

## Verification and cleanup

Worker evidence: nine dependency-free semantic tests passed against the real DTO projection shape. TypeScript syntax and isolated pure-controller diagnostics are recorded in the manifest/evidence receipt. No build/cache/test fixture trees were created. Native component tests and full type/browser/native checks require the coordinator's resource lease and are not claimed from syntax or domain tests.

Coordinator recipe after application, using existing locked dependencies and the original approved output/cache/TEMP policy:

- node --test apps/web/src/features/customize/nativeCatalog.node.mjs (Node22+ source type stripping).
- Existing native Vitest run selecting NativeCustomize.test.tsx: six semantic cases for disabled registration, unavailable scopes/no extra calls, retained editor draft, explicit-null no read, stale-owner response fencing and foreign hosted governance refusal and explicit-null hosted composition (the six tests combine some assertions).
- Full apps/web TypeScript noEmit; preserve old NativeWorkDesktop/Work/sidebar/owner tests.
- Actual native Work navigation to Plugins and Skills, supported project read, scope denial, native package discover/review/install/disable/unregister/rollback, guarded skill create/edit/remove with exact readback and pending-original recovery.
- Authenticated hosted bridge archive/restore/proposals/synthesis/activation/fresh-chat workflow with real IDs and owner denial/maintenance lock/auth-expiry/unknown-outcome controls.
- Screenshots at normal/compact widths, dark/light and 100–200%; keyboard and focus return, long Unicode names, disconnected/error/empty states. Compare to supplied Plugins/Skills references; do not replace baselines.

Canonical source files, patch, manifest, recipe and this document are retained for coordinator application/review and reproducibility. No inactive builds, dependencies, caches, scratch or copied runtime data exist from this worker; removed paths0/bytes0. The coordinator retains/reconciles its separately owned runtime/test artifacts after their last real consumer. No Linux/Windows disk recovery is claimed.


Regenerate source hashes and the reviewed add-only patch without touching native source/index:

    node docs/workstreams/customize/native-ui/prepare-delivery.mjs --source <actual-native-source-filesystem-path> --git-root <same-checkout-Windows-Git-path> --git-executable <existing-Windows-git.exe>

When invoked from WSL, use the actual /home path for --source, the paired //wsl.localhost/Ubuntu/home path for --git-root, and /mnt/c/Program Files/Git/cmd/git.exe as the explicit executable. Quote paths with spaces. The script refuses any existing target, unexpected target prefix or source link. It reads the declared tree and compares canonical prerequisite bytes; it does not apply/stage a patch, alter native files or configure Git globally. It writes only canonical delivery source, native-customize.patch and manifest.json in this directory.
