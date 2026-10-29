# Customize implementation and integration contract

Owner: Plugins and Skills worker.
Branch: codex/veyra-parallel-customize. Base: 99eed8c6c0b47a043ec90d83e96f54f4f5cc2429.
Status: scoped source for coordinator integration; worker goal remains active pending acceptance.

## Implemented

- /customize, /customize/plugins, /customize/skills: Customize navigation, Veyra blue mascot, search, refresh, Add, compact two-column catalog, installed indicators, installed sidebar, skill installed preview/expansion, project and discovery-scope selectors.
- The active project comes exclusively from the existing resolved ProjectProvider. All API reads and internal links carry that exact project. A project change remounts the surface and discards prior rows/selection. Failed plugin/skill reads remain independent; errors never become successful empty catalogs.
- Installed plugins come from api.plugins.list(project); skill rows come from api.skills.list(project). These are persisted records, not sample connector availability. Disabled plugins stay installed. The existing listSkills returns enabled, unarchived skills only; this bridge cannot enumerate disabled skill records and does not claim it can.
- /customize/plugins/manage reuses the existing project plugin editor, upload, enable/disable, description and removal workflows.
- /customize/skills/manage reuses the existing skill upload/editor, files/references, consolidated sources, proposal review/history/approval/rollback. /pipeline remains the synthesis owner. No second proposal database or synthesis executor was introduced.
- /customize/skills/archive adds the missing archive/restore UI using existing /skills/archived, /:name/archive and /:name/restore endpoints. It requires explicit confirmation, respects API permission/maintenance-lock refusals, and blocks writes after uncertain outcomes until authoritative refresh. A confirmed write followed by a failed read remains labelled saved with refresh failure.
- /customize/agents, /customize/mcp, /customize/configuration reuse the current agents, child MCP discovery/auth/tools/Vault-reference, and configuration/hook editors.
- The isolated API catalog service supports authorized project catalog reads, paginated discovery from trusted injected authorities, and delegated lifecycle operation receipts. It never opens SQLite, writes projection files, stores credentials, or follows executable catalog URLs. Mutation authority stays with the existing transactional owners.
- The supplied project authority is read-only and exposes only the real project catalog. Its mutation path fails closed. The optional catalog router is not mounted and has no writable HTTP routes.

## Integration changes owned by coordinator

1. Register Customize navigation in the shared Work shell. The surface includes the screenshot's Customize sidebar but no outer application rail/titlebar. Prevent duplicate legacy navigation/sidebar. Existing legacy routes remain intact.
2. Bind the frozen v1 ProjectRef and installation ownership semantics. Projectless means explicit null/private actor scope, not a synthetic project. This initial compatibility surface uses the current ProjectProvider and does not invent that future context. Preserve installation resources through the coordinator's explicit identity mapping before retiring the legacy global-project UI/row.
3. Supply trusted discoverable catalogs and their install/connect/update/remove owners before enabling Public/Personal/System catalog mutations. Project-local resources must not be relabelled Personal; unavailable scopes currently explain their limitation. No fabricated third-party entries, credential connections or placeholder success was added. The currently working discovery/connection path is the real MCP manager.
4. Before mounting createCustomizeRouter, register explicit shared authorization policy and supply resolveContext plus per-resource permission checks. createProjectCatalogAuthority(canRead) requires a host authorization callback; do not pass an unconditional callback. The service receives resolved UUIDs and an authenticated actor. Host checks must account for the requested plugin/skill resource. No compatibility principal is synthesized.
5. The optional router mounts as GET /api/v1/customize with project, kind=plugin|skill, visibility=project|public|personal|system, offset>=0 and 1<=limit<=100. The response contains data, exact project scope, available scopes and pagination. Errors: 400 invalid query, 401 unresolved identity, 403 denied read, 409 unsupported scope, 500 safe catalog failure. Responses use Cache-Control: no-store. UI currently uses established APIs and does not depend on this unmounted route.
6. Any writable catalog HTTP registration remains a separate integration gate: enforce CSRF, authentication, exact account/org/project capability, expected revision, durable idempotency receipt, maintenance locks, projection rollback and catalog provenance through existing owners. The service delegates once and preserves failed/unknown outcomes; it is not a replacement persistence implementation.

The newly user-authorized phased-checkout-orchestration installation skill is protected through namespace/catalog migration. Exact resource identity and coordinator provenance are retained in the private status receipt. This worker did not install, alter or re-read the live resource. The notification is provenance, not current runtime verification.

## Verification

Dependency-free CPU checks, Node 22.23.1:

    node --test services/ingenium-api/tests/veyra-customize-catalog.node.mjs services/ingenium-dashboard/tests/veyra-customize-catalog.node.mjs

16 tests pass. Coverage: membership versus enabled/archived state, search/scoped links, permission-before-read, unavailable scopes, bounded pagination, delegated revision/idempotency behavior, reload via the same test owner, action refusal, unknown/first failure preservation, and exact archive/restore API delegation. The owner fixtures are in memory: these results do not prove real SQLite/projection/restart persistence.

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

Composition follows the narrow central catalog, two-column rows, left installed list and rounded search/scope controls. Veyra's blue mascot replaces product branding. No personal project/account text or third-party logos were copied. Supported local project catalogs appear first; Public/Personal/System sources unavailable through this adapter are explicit limitations. Add opens existing editors rather than pretending to install a screenshot example. At narrow widths the sidebar stacks and catalog becomes one column.

These are implementation decisions for review, not accepted pixel parity. No baseline was edited, and no rendered screenshot or attended platform acceptance is claimed.

## Storage and cleanup

All source is in the assigned Customize checkout under the already-approved task root. Minimal coordination receipts use only veyra-phase-1/coordination/customize. No dependency install, full build, cache, download, model, runtime or desktop session was started.

Generated outputs: ownership.json and status.json only. Retained for the coordinator's ownership/integration consumer; end condition is integration acceptance/reconciliation. Source, tests and this documentation are durable deliverables. No disposable build trees or scratch files exist from this worker, so no cleanup deletion or disk recovery is claimed. No older or policy-rejected target was touched.
