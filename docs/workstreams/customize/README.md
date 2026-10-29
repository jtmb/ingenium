# Customize implementation and integration contract

Owner: Plugins and Skills worker.
Branch: codex/veyra-parallel-customize. Base: 99eed8c6c0b47a043ec90d83e96f54f4f5cc2429.
Status: scoped source for coordinator integration; worker goal remains active pending acceptance.

## Implemented

- /customize, /customize/plugins, /customize/skills: Customize navigation, Veyra blue mascot, search, refresh, Add, compact two-column catalog, installed indicators, installed sidebar, skill installed preview/expansion, project and discovery-scope selectors.
- The active project comes exclusively from the existing resolved ProjectProvider. Project-local reads and links carry that exact project; installation reads and editor links carry their independently resolved, explicit namespace. A project change remounts the surface and discards prior rows/selection. Failed plugin/skill reads remain independent; errors never become successful empty catalogs.
- Installed plugins come from api.plugins.list(project); skill rows come from api.skills.list(project). These are persisted records, not sample connector availability. Disabled plugins stay installed. The existing listSkills returns enabled, unarchived skills only; this bridge cannot enumerate disabled skill records and does not claim it can.
- /customize/plugins/manage reuses the existing project plugin editor, upload, enable/disable, description and removal workflows.
- /customize/skills/manage reuses the existing skill upload/editor, files/references, consolidated sources, proposal review/history/approval/rollback. /pipeline remains the synthesis owner. No second proposal database or synthesis executor was introduced.
- /customize/skills/archive adds the missing archive/restore UI using existing /skills/archived, /:name/archive and /:name/restore endpoints. It requires explicit confirmation, respects API permission/maintenance-lock refusals, and blocks writes after uncertain outcomes until authoritative refresh. A confirmed write followed by a failed read remains labelled saved with refresh failure.
- /customize/agents, /customize/mcp, /customize/configuration reuse the current agents, child MCP discovery/auth/tools/Vault-reference, and configuration/hook editors.
- The isolated API catalog service supports authorized project catalog reads, paginated discovery from trusted injected authorities, and delegated lifecycle operation receipts. It never opens SQLite, writes projection files, stores credentials, or follows executable catalog URLs. Mutation authority stays with the existing transactional owners.
- The supplied project authority is read-only and exposes only the real project catalog. Its mutation path fails closed. The optional catalog router is not mounted and has no writable HTTP routes.

## Integration changes owned by coordinator

1. Register Customize navigation in the shared Work shell. The surface includes the screenshot's Customize sidebar but no outer application rail/titlebar. Prevent duplicate legacy navigation/sidebar. Existing legacy routes remain intact.
2. Bind the frozen v1 ProjectRef and installation ownership semantics. Projectless means explicit null/private actor scope, not a synthetic project. The legacy route wrapper uses ProjectProvider. Work can instead import CustomizeCatalogView with project=null and real actor-owned catalog sources; it then performs no project-local plugin/skill read and creates no synthetic project. Preserve installation resources through the coordinator's explicit identity mapping before retiring the legacy global-project UI/row.
3. Supply trusted discoverable catalogs and their install/connect/update/remove owners before enabling Public/Personal/System catalog mutations. Project-local resources must not be relabelled Personal. System is now read through the one active explicitly flagged installation mapping returned by the authenticated project API; absence, ambiguity, archive or permission failure never selects a name-based fallback. Public/Personal scopes can consume configured server catalogs through the new reader/source adapter. No fabricated third-party entries, credential connections or placeholder success was added. The currently working discovery/connection path is the real MCP manager.
4. Before mounting createCustomizeRouter, register explicit shared authorization policy and supply resolveContext plus per-resource permission checks. createProjectCatalogAuthority(canRead) requires a host authorization callback; do not pass an unconditional callback. The service receives resolved UUIDs and an authenticated actor. Host checks receive the exact plugin/skill kind, requested visibility and optional resource ID. Reads recheck each resource before exposing it, and advertised actions are filtered by per-resource action capability. No compatibility principal is synthesized.
5. The optional router mounts as GET /api/v1/customize with project, kind=plugin|skill, visibility=project|public|personal|system, offset>=0 and 1<=limit<=100. The response contains data, exact project scope, available scopes and pagination. Errors: 400 invalid query, 401 unresolved identity, 403 denied read, 409 unsupported scope, 500 safe catalog failure, 502 inconsistent catalog identity. Responses use Cache-Control: no-store. UI currently uses established APIs and does not depend on this unmounted route.
6. Any writable catalog HTTP registration remains a separate integration gate: enforce CSRF, authentication, exact account/org/project capability, expected revision, durable idempotency receipt, maintenance locks, projection rollback and catalog provenance through existing owners. The service delegates once and preserves failed/unknown outcomes; it is not a replacement persistence implementation.

The newly user-authorized phased-checkout-orchestration installation skill is protected through namespace/catalog migration. Exact resource identity and coordinator provenance are retained in the private status receipt. This worker did not install, alter or re-read the live resource. The notification is provenance, not current runtime verification.

## Verification

Dependency-free CPU checks, Node 22.23.1:

    node --test services/ingenium-api/tests/veyra-customize-catalog.node.mjs services/ingenium-dashboard/tests/veyra-customize-catalog.node.mjs

30 tests pass. Coverage: membership versus enabled/archived state, search/scoped links, permission-before-read, unavailable scopes, bounded pagination, delegated revision/idempotency behavior, reload via the same test owner, action refusal, unknown/first failure preservation, and exact archive/restore API delegation. The owner fixtures are in memory: these results do not prove real SQLite/projection/restart persistence.

Pending centrally scheduled checks:

- Node and browser files deliberately use .node.mjs/.browser.ts names so default Vitest discovery cannot execute a foreign test runner.
- Focused TypeScript and lint checks of the new dashboard/API modules, with no install or compiler outputs in source.
- API tests/veyra-customize-router.test.ts: HTTP handler contracts, auth denial, invalid input, safe 500. Handler invocation uses no listening server.
- Dashboard tests/veyra-customize-browser.browser.ts: isolated authenticated project fixture, mocked resource records, search/scopes/links/error behavior. Use tests/veyra-customize-playwright.config.ts with VEYRA_CUSTOMIZE_TEST_BASE_URL, VEYRA_CUSTOMIZE_OUTPUT_ROOT set to the assigned coordination/customize directory, and optional fixture storage state through VEYRA_CUSTOMIZE_TEST_STORAGE_STATE. Set VEYRA_CUSTOMIZE_TEST_PROJECT; absence skips rather than silently creating a user project. This is fixture UI coverage, not live lifecycle proof.
- Real authority checks from existing API skill governance and core skills-projection suites, scheduled with all temp/state roots contained. Required live checks additionally include upload/edit/readback, archive/restore, maintenance-lock denial, cross-project denial, restart persistence, synthesis batch → grounded proposal → approval → activation → fresh-chat use.
- Exact integrated Windows/Linux runtime, public/private catalogs and installation scopes, screenshots, keyboard, auth expiry and 100–200% scaling remain open.

## Visual evidence and deliberate differences

Inspected original protected references without desktop control:

| Reference | Intrinsic size | SHA256 |
| --- | --- | --- |
| customize-plugins | 2560 × 1392 | bd1414301baff800c2263b36b0a3505b93e1c46e819cf3b161373f19ab0cea05 |
| customize-skills | 2560 × 1392 | 4b026f21699c754420e35ec11606fa6fbc25fd1988edbcd8a6f02f8c06d1d416 |

Composition follows the narrow central catalog, two-column rows, left installed list and rounded search/scope controls. Veyra's blue mascot replaces product branding. No personal project/account text or third-party logos were copied. Supported local project catalogs appear first; Public/Personal sources without a configured authorized owner remain explicit limitations. Add opens existing editors rather than pretending to install a screenshot example. At narrow widths the sidebar stacks and catalog becomes one column.

These are implementation decisions for review, not accepted pixel parity. No baseline was edited, and no rendered screenshot or attended platform acceptance is claimed.

## Storage and cleanup

All source is in the assigned Customize checkout under the already-approved task root. Minimal coordination receipts use only veyra-phase-1/coordination/customize. No dependency install, full build, cache, download, model, runtime or desktop session was started. Source syntax checks and an isolated strict check of the dependency-free API catalog module reused the existing TypeScript library entirely in memory; no compiler files or cache were emitted.

Generated outputs: ownership.json and status.json only. Retained for the coordinator's ownership/integration consumer; end condition is integration acceptance/reconciliation. Source, tests and this documentation are durable deliverables. No disposable build trees or scratch files exist from this worker, so no cleanup deletion or disk recovery is claimed. No older or policy-rejected target was touched.

## System and configured catalog readers

The System reader resolves only an active API row with is_global=true/1. It does not assume a row named global-default, create a global project, copy installation content into a project, or change the active logical project. It reads the exact mapped API namespace, checks returned project IDs when present, and preserves that namespace in editor links. Installation rename, revoked access, missing/ambiguous identity, and cross-namespace responses fail without a fallback. This is a compatibility reader until the coordinator supplies the installation-owned namespace adapter.

CustomizeCatalogSource is the host-facing read port:

    { id: "project" | "public" | "personal" | "system",
      scopeIdentity: "<actual actor/catalog/installation identity>",
      label: "<display label>",
      apiProject?: "<explicit legacy management namespace>",
      read(kind): Promise<CustomizeEntry[]> }

The source must retain its real owner/auth context and read the authoritative service; it is not a browser-only registry. Change scopeIdentity when ownership changes. The UI discards stale source results, renders actual source categories, and shows available entries separately from installed/enabled state. Without an explicit management namespace an entry cannot open an unrelated project editor.

createServiceCatalogSource binds this port to the coordinator-mounted GET /api/v1/customize boundary. It requires actual consumer project UUID/name plus source identity/visibility. Its reader validates all page scopes, booleans, revisions, categories, duplicate IDs, stable totals and pagination progress. It performs no mutation, hidden retry or alternate-scope request. Projectless Personal sources require the foundation's actor-owned reader; this legacy service adapter never manufactures a project UUID.

The service's authorize callback now accepts context, action, kind, visibility, optional resourceId. The existing project authority remains read-only; writable owner/idempotency/CSRF mounting gates are unchanged.

## Real persistence test request

A new veyra-customize-persistence.test.ts uses the actual core SQLite and skill projection implementation rather than the in-memory authority fixture. Run it centrally after integrating this source:

    node node_modules/vitest/vitest.mjs run --config services/ingenium-api/tests/veyra-customize-vitest.config.ts tests/veyra-customize-persistence.test.ts

Set VEYRA_CUSTOMIZE_OUTPUT_ROOT to the already-assigned coordination/customize root. No value means an explicit skip; a relative path is rejected. All DB/home/global-config fixture paths stay within a private randomized child of that root. The tests cover preserved installation skill UUID/revision/references after DB close/reopen, archive/restore plus another project's unchanged content, actual projection rollback and actor/project denial. DB reopen is narrower than a full process/platform restart.

Teardown closes every tracked SQLite handle, checks exact realpath ownership and its marker, rejects symlinks/special files/source locks, checks mounts and process handles, then removes the private in-process fixture and reports exact paths/bytes. The fixture is never given to a subprocess/service/container. An unexpected test failure retains the closed fixture for coordinator diagnosis. A failed safety check or removal also protects that exact target. Either condition prevents further fixture generation or deletion retries. The source records the regeneration command before generation. These tests have not yet run in this worker; they require the coordinator's resource schedule. Their pass/cleanup receipts must be recorded before claiming persistence acceptance.

Coordinator notification records that predecessor commit 91e3f236 was integrated and its full API/dashboard noEmit checks plus 4/4 router tests passed. Those results apply to that predecessor; this expanded source still needs the scheduled integrated checks.
Nine focused component tests in tests/veyra-customize-components.test.tsx additionally cover real-project-name/null-project isolation, stale actor callbacks, explicit System editor/archive bindings, available versus installed state, scope failure without fallback, and synchronous failure containment, and host-controlled projectless navigation. They are prepared for the dashboard's existing Vitest configuration. The read adapter's JSON ownership key distinguishes null from a real project literally named projectless; source identity changes discard prior actor content. These component tests are not yet executed in this worker.
Inherited plugin editing fixes are specified in coordinator-fixes.md, with owned API/UI regression tests. The existing source endpoint uses the process directory instead of the resource projection; the existing editor suppresses source-load errors and permits an empty buffer. These are known coordinator-owned gates. Their new regressions are expected to fail the inherited code until the coordinator applies the narrowly requested corrections. No passing result is claimed for them.
The owned API and dashboard tests/veyra-customize-vitest.config.ts inherit their existing workspace configurations while setting transform caches to coordination/customize/vite-api and vite-dashboard through required VEYRA_CUSTOMIZE_OUTPUT_ROOT. No root value is inferred. The coordinator must budget and reconcile those caches after the last consumer. Run the API config for 4 router, 4 real persistence and 3 inherited-source regression cases; run the dashboard config for 9 Customize component and 2 inherited-editor cases. C1/C2 in coordinator-fixes.md must be corrected before these regression gates can pass.

CustomizeCatalogView accepts optional onNavigate(kind). Work must supply this callback for projectless cross-view navigation; without it the view emits no legacy route link that could reconstruct a default project. Management links require the source's explicit API namespace. This preserves null logical project state while allowing the independently authorized installation catalog.
C3 supplies the full unarchived skill-record query to the API authority's new readSkillRecords argument. A configured project source prevents any active-only fallback; its installed summary includes retained disabled records. The default compatibility API still has activation-only enumeration, so its heading and System reader explicitly say Active skills. The real persistence suite now has four cases, including a disabled record plus retained reference bytes after DB reopen. That fixture uses the actual core owner to enumerate a known seeded record; complete production enumeration remains C3.

The human's direct reporting authorization was verified in the coordinator's two actual user messages. The worker reported all C1/C2/C3 gates and exact test requests directly. Coordinator acknowledged ownership of all three fixes. The same orchestration resource was normally updated to revision 1 by the coordinator; any earlier hash/revision is historical provenance, and this worker imposes no hash-based freeze on authorized skill updates.

C4 records the inherited shared Skills upload/save error-state gate, verified in the integration root and directly reported. It belongs to the coordinator's shared Skills-page territory and remains open alongside the full runtime qualification.
