# Closed original JobRun MCP transport source proposal

Owner: Dot worker chat 01a18935-103f-7432-98b0-cd2c51f8c8ab. Source-only proposal under docs/workstreams/dot. All work uses the existing C-backed WSL task root /home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845; no dependencies, generated build output, cache, temporary tree, disk database or live process was created.

## Concrete implemented path

The original server registration for project_detail accepts a required string name and delegates to projectTools.projectDetail(name). That wrapper uses GET /projects/:name/detail and textResult. The actual API handler delegates synchronously to the original Core projects.getProjectDetail(name). This proposal calls that same Core operation after validating the original current JobRun, its exact attempt/capability, original Core explicit tool policy, exact original project id/name/organization, and original per-project tool toggle. Its MCP text result matches the existing wrapper. It does not import the original global HTTP client or acquire its bearer. The original Core catalog/category and policy are used, not a new authorization table or a body-provided category.

Only ingenium_project_detail is implemented and advertised. It uses the original required name string schema, tightened to reject unknown keys. Other tools remain withheld. In particular the original memory policy is private and project_list is installation scope; projects:read and memory:read on the parent do not authorize either tool. Tool coverage expansion requires a concrete original operation and its policy, schema, binding, state and handler review. No placeholder dispatcher is counted as working coverage.

The actual factory wires the concrete broker and catalog itself. list and call repeat current owner assignment validation; the HTTP owner resolves the sidecar credential on every request. No asynchronous gap occurs between final binding checks and the synchronous Core detail read. The closed dispatcher receives the already verified original credential, never a generic request principal. Revoked, expired, changed run/attempt/parent/grant, disabled tool and cross-project inputs fail closed.

## Extension and ingress

The original extension launcher selects job-run before generic binding/preflight/project provisioning. Its dedicated SDK Server registers ListToolsRequestSchema and CallToolRequestSchema with StdioServerTransport. List refreshes the authorized catalog every time; call uses /runtime/job-runs/:runId/mcp/:canonicalTool. Both carry exact job-run audience and attempt headers. The existing generic Auth allowlist and generic extension binding remain unchanged.

The client reads only /run/ingenium-runtime/capability, using canonical non-symlink path, O_NOFOLLOW, owned regular single-link 0600 file, bounded size and original credential format. It never uses API_TOKEN, arbitrary credential paths or a general API auth client. URL is the fixed child profile's environment binding; redirects are rejected, responses bounded at 1 MiB, requests bounded at 64 KiB, timeout 15 seconds, dispatch never retried. Distribution required-artifact validation includes the two new compiled transport files.

Root must import and mount createCore126Ingress(managed.handlers) after the original JSON parser and preauth limiters, immediately before app.use(authMiddleware) in services/ingenium-api/scripts/api-server.ts. It owns /api/v1/internal/managed-job-runs/ and /api/v1/runtime/job-runs/ exclusively, consumes unmatched private paths with 404, rejects cookies/origin/internal-service headers, and never sets req.principal. Its internal handlers authenticate only the original manager-file owner. Root owns the managed owner/scheduler/image lifetime and must not instantiate an extra owner per request. The source patch exports this composition; it intentionally does not edit shared api-server or Auth.

## Evidence and remaining gates

22 dependency-free fixtures pass. They import exact original Core catalog/policy and execute exact original Core getProjectById/getProjectDetail/getToolState functions against Node SQLite :memory:, including a foreign-project witness. They exercise closed HTTP list/call, scope/attempt/revocation/toggle denial, client framing/failure bounds/no retry, launcher selection order, and source-level SDK/Express composition with inert facades. Facades do not establish actual SDK compatibility or full TypeScript acceptance.

Regeneration: VEYRA_DOT_PROPOSAL_SOURCE_ROOT=<Root actual source> /home/brajam/.local/bin/node --experimental-strip-types --test docs/workstreams/dot/core126-broker.cpu.mjs. Patch pre/post hashes and apply check are in core126-broker-transport.json. Apply only after the no-create delta. Root must run actual Core/API/extension/server noEmit, SDK transport fixtures, distribution/image qualification and the complete live managed JobRun path. Full Phase 1, screenshots, cancellation/restore/deploy and broader goal remain open.

Cleanup inventory: only durable source proposals, patch, minimal receipt and unique fixture code retained for Root's review/application. No disposable paths, no deletion, 0 removed bytes. Protected original failure fixtures, Root logs and unrelated source are untouched. No Linux or Windows disk-recovery claim.
