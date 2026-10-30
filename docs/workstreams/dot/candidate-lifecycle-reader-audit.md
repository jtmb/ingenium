# SQL131 Root integration audit

This is a source review and required integration list, not runtime acceptance. Source hashes in the companion JSON pin reviewed bytes; locations are review anchors and may shift with concurrent work. Root owns every canonical edit below.

- `packages/ingenium-core/lib/tools/jobs.ts` (764-786,820-824,842-847): Discriminate purpose and protocol; join extension for candidate finish/result/retirement and cancellation. Preserve managed recovery exclusion and production predicate. Base prepared must never imply live or retired.

- `services/ingenium-api/lib/job-runner.ts` (1595): Preserve managed-run local-runner refusal; no fallback, replay or new attempt.

- `packages/ingenium-core/lib/tools/mcp-credentials.ts` (545-570,622-634): Keep original production material binding/withdrawal unchanged. Candidate issuer and self-withdraw need genuine separate owner and extension; no candidate credentials are enabled by this proposal.

- `services/ingenium-api/lib/restore-runtime-guard.ts` (15-28): Recognize exact protocol/schema and extension original physical retirement plus terminal Run; base remains prepared. No absence or parent-health inference; no retrofitting old candidate rows.

- `packages/ingenium-core/lib/db.ts` (5513-5525,5539,5588): Register131 between130/132 atomically; validate exact column, marker, tables and all triggers. Compose cumulative126+129+131 schema comparator; dedicated FK validation targets run_id rather than generic parent id. Include signed restore checks.

- `packages/ingenium-core/lib/tools/dot-execution-delegation.ts` (42-45,101): Keep production cancellation and existing-ledger absent-close refusal. Candidate safety reduction requires genuine separate original control context after withdrawal/restart.

- `services/ingenium-api/lib/dot-v2/dot-original-context.ts` (101-120): Reacquire fresh private context and placement against original persisted selection SHA/intent/deadline. No new prepare, selection or deadline.

- `services/ingenium-api/lib/dot-v2/installed-dot-scheduler.ts` (68-70): Keep production cancellation ports and ordinary scheduler closed to candidate. Candidate recovery remains same original manager and extension.

- `services/ingenium-api/lib/dot-v2/core126-owner.mjs` (production branches and candidate splice): Preserve production CAS/material/retirement. Apply exact proposed source splice only after review. Marked base row remains immutable; extension is sole mutable candidate lifecycle authority.

- `services/ingenium-api/lib/dot-v2/core126-http.mjs` (31,47,74): Keep production HTTP/tool principal gates closed to candidate; separate actual private candidate auth/routes are Root work. JSON purpose is not authority.

- `services/ingenium-api/lib/dot-v2/core126-actual-factory.ts` (67,86): Bind actual private candidate owner without broadening production endpoints or accepting fake principals.

- `services/ingenium-api/lib/dot-v2/managed-job-owner.mjs` (58-84,87,90,102): Preserve production material-before-create path. Candidate requires dedicated genuine create/retained duplex attach/start/readiness/material on same original child and manager; no sibling serve, listing adoption or second client.

Add new helper/gates, SQL and owner bytes to exact source/copier/image compiler closure. Reapproval required for changed source. Root strict Core/API, same-child native/18 protocol, Windows and cluster gates remain open.
