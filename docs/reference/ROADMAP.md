---
title: Ingenium Product Roadmap
description: Repository-authoritative, execution-ready contracts for product and approved multi-user authentication and authorization roadmaps.
---

# Ingenium Product Roadmap

This file is the repository authority for roadmap scope, task identity, execution
contracts, dependencies, verification, and live markers. Repository Markdown is
canonical; the Docs Workspace is a projection and is not mutated by this roadmap.
The archived predecessor is [ROADMAP-2026-07-31-phase-0.md](./archive/ROADMAP-2026-07-31-phase-0.md).

## Approved multi-user authentication and authorization program

The `AUTH-100`–`AUTH-111` contracts below are the approved multi-user release
program. They extend this existing canonical roadmap; they do not replace the
earlier roadmap contracts or mutate the Docs Workspace. The completed workflow
cleanup prerequisite is commit `396b1d9`, which removed phase-commit enforcement;
ordinary manual commits no longer block execution.

### Confirmed product decisions

- **First release:** local authentication plus OIDC; no public signup. An
  installation operator performs local bootstrap and recovery. Passkeys and SMS
  are out of scope.
- **Organization/project authorization:** organizations own projects. An
  organization owner or admin can see every project in that organization.
  Organization members and viewers need explicit project membership. Project
  roles are `editor` and `viewer`; an organization `viewer` is always capped at
  read-only, regardless of project membership.
- **Ownership:** mail, providers, vault items, and private conversations may be
  private-user or organization-owned. Docs are organization-scoped. Existing
  data moves into a bootstrap organization and owner without changing existing
  resource IDs. Ambiguous existing credentials become organization-owned;
  existing OpenCode content becomes private to the bootstrap owner.
- **Installation boundary:** installation admins exclusively own backups,
  restore, raw logs, processes, global configuration, and the runtime fleet.
  Organization admins do not implicitly gain access to private plaintext.
- **Runtime:** each user/workspace gets an isolated runtime container shared by
  that user's Web, CLI, and VS Code surfaces. Launch uses an audience-bound,
  one-time ticket and a runtime-specific HTTPS root.

### Security and protocol constants

The API is the central principal and authorization boundary. Missing or
malformed authentication is `401`; an authenticated principal without the
required permission is `403`; a missing or foreign resource is `404` to avoid
cross-tenant enumeration. Browser state-changing requests require the exact
allowed origin and CSRF protection; server-to-server bearer requests remain a
separate non-browser path. OIDC identity is the unique pair `(issuer,subject)`.
Session, reset, invitation, launch-ticket, and API-token values are stored or
handled as hashes where applicable and are never returned after creation.

Passwords and recovery material use scrypt with a memory cost of at least
64 MiB. The initial timeout policy is:

| Control | Default |
|---|---:|
| Session idle | 30 minutes |
| Session absolute | 12 hours |
| Step-up authorization | 10 minutes |
| Password reset | 30 minutes |
| Email verification | 24 hours |
| Organization invitation | 7 days |
| Runtime launch ticket | 60 seconds or less |

The security set includes invitations, email verification/reset, TOTP, one-time
recovery codes, session/device management, scoped API tokens, immutable audit,
and step-up authorization. Token values are shown only at creation; persisted
forms contain hashes, scopes, expiry, and revocation state.

### Tenancy migration contract

The migration sequence is fixed and must be implemented in this order:

| Migration | Boundary |
|---:|---|
| 093 | Identity and tenancy |
| 094 | Authentication |
| 095 | Authorization and audit |
| 096 | Resource ownership |
| 097 | Mail tenancy |
| 098 | Content tenancy |
| 099 | Automation tenancy |
| 100 | Runtime isolation |

Every migration must use a probe-based runner: probe the exact schema signature,
accept only the complete absent or complete applied state, refuse partial or
ambiguous state, run transactionally, preserve IDs, and finish with integrity,
foreign-key, row-count, and ownership checks. The rollout is **expand →
dual-write/backfill → verify → enforce cutoff**. Reads and writes cannot switch
to mandatory tenant enforcement until backfill and preservation evidence are
complete; failed probes or mismatched counts fail closed rather than guessing.

### Later canonical documentation updates

Implementation waves must update only the directly affected sections of the
canonical repository docs, then rerun their focused link/command checks:
[API Authentication](../security/api-authentication.md), [Security](../security/index.md),
[Architecture](../concepts/architecture.md), [API Reference](../develop/api.md),
[Database Migrations](../develop/database.md), [Testing Guide](../develop/testing.md),
[Deployment Guide](../operations/deployment.md), [Projects](../configure/projects.md),
[Dashboard usage](../usage/dashboard.md), [Mail usage](../usage/mail.md),
[Secrets usage](../usage/secrets.md), [OpenCode usage](../usage/opencode.md), and
[Credential Rotation](../security/credential-rotation.md). No wave may silently
export or mutate Docs Workspace pages.

### Per-task completion checklist

Every task in this roadmap has a contract, and its execution record must include
all three checkable items below. The exact marker syntax remains the append-only
protocol above; the placeholder is not a live marker:

- `[ ]` append one `work-started` marker after preflight and declared ownership;
- `[ ]` append one matching `work-complete` marker only after all acceptance
  gates pass; and
- `[ ]` replace `Evidence TASK-ID: <acceptance evidence placeholder>` with
  non-empty evidence covering the task's tests, deployment/health, and applicable
  security, tenant, migration, or visual gates.

## Operating model

Execution is synchronous: at most **6 active agents**, comprising at most **3
permission-derived writers** and at most **3 nonwriters**. Writers have exclusive
territories; territory overlap is zero. Independent work runs in barrier subwaves:
all tasks in a subwave finish and verify before dependent tasks start. The
open-roadmap rule applies: while a roadmap task or TodoWrite item is open, the
orchestrator immediately dispatches the next declared phase and does not end the turn with a progress or completion response. Only `PASS`, `ESCALATE_USER`, an
explicit `STOP`, or an explicit `CANCELLED` ends execution.

Safe defaults are mandatory: grounding is off; task references are metadata-only;
events come from a trusted catalog; MCP verification is fixture-first; usage
budgets are advisory; vault access is opt-in and never auto-unseals; restore starts
with an operator command; default gates use no real credentials.

### Marker protocol

Only these exact HTML comments, appended under the live heading, are valid:

```text
<!-- (work-started) TASK-ID 2026-07-31T00:00:00Z actor-name -->
<!-- (work-complete) TASK-ID 2026-07-31T00:00:01Z actor-name -->
Evidence TASK-ID: non-empty implementation or verification evidence.
```

IDs must be defined below; timestamps are UTC ISO-8601 seconds; actors contain no
whitespace. Markers are append-only and separate from TodoWrite. A task may start
once while inactive and complete once only after its start; starts may be concurrent
within a subwave. Unknown, malformed, duplicate, out-of-order, outside-heading,
or evidence-free markers fail validation. Do not add a work-started marker for
DOC-100 until the DOC baseline tests pass.

### Contract field template

Every contract below explicitly contains: `IN_SCOPE`, `OUT_OF_SCOPE`, `Owner`,
`Dependencies`, `Acceptance`, `STOP_CONDITION`, `Escalation`, `Verification owner`,
`Deployment owner`, `Rollback/safety`, `Tests`, `Docs`, `Exclusive writer territory`,
`Phase/counts`, `Verification plan`, `Causal remediation rule`, and `Finding
classification`. `PASS` requires every acceptance and applicable gate. Escalation
is limited to unavailable required access/credentials, unauthorized destructive
action, a genuine product decision or ambiguity, or bounded diagnosis that cannot
reproduce a root cause.

## Phase dependency graph and allocations

```text
P0 DOC-100
  -> P1 BUG-100, MCP-100, CTX-100, CHAT-100, TASK-100, JOB-100, USAGE-100, VAULT-100, RESTORE-100
  -> P2 MCP-101..103, CTX-101, TASK-101..102, JOB-101, USAGE-101, VAULT-101, RESTORE-101
  -> P3 JOB-102, MCP-104..105, USAGE-102, VAULT-102, RESTORE-102
  -> P4 MCP-106
  -> C0 COORD-100 -> C1 COORD-101 -> C2 COORD-102 -> C3 COORD-103 -> C4 COORD-104 -> C5 COORD-105 -> C6 COORD-106
  -> P5 UI-100 -> UI-101 -> UI-102 -> UI-103
  -> P5 UI-102 -> CHAT-101
  -> P5 VSCODE-100 -> VSCODE-101 -> VSCODE-102 -> VSCODE-103
  -> P6 REL-100
  -> P7 DOC-101
  -> A0 AUTH-100 -> A1 AUTH-101 -> A2 AUTH-102 -> A3 AUTH-103 -> A4 AUTH-104
     -> A5 AUTH-105 -> A6 AUTH-106 -> A7 AUTH-107 -> A8 AUTH-108
      -> A9 AUTH-109 -> A10 AUTH-110 -> A11 AUTH-111
```

The C0-C6 coordination lane is an implementation-gated barrier chain;
`REL-100` also depends on `COORD-106`, `UI-102`, `CHAT-101`, and `VSCODE-102`.
The A0-A11 authentication lane is a strict barrier chain. No later tenancy,
runtime, or enforcement task may start until its predecessor's migration,
preservation, security, and deployment evidence is complete.

### Program gates

These gates are explicit acceptance requirements, not implied future work:

1. **Deployment/runtime:** every runtime-impacting wave names an authorized
   Docker/Compose deployment owner who rebuilds and restarts the current merged
   source, checks supervisor/application health, and probes the actual affected
   routes and HTTPS roots.
2. **UI:** AUTH-103 and AUTH-109, plus any changed authentication/authorization
   route, receive one changed-route visual gate at **1440x900** and **390x844**
   with accessibility, console/network, and browser-cleanup evidence. AUTH-111
   also runs the requested passive full-site desktop/mobile sweep.
3. **Security:** each security boundary receives one bounded current-diff and
   relevant-dependency review. No history scan is implied; it is permitted only
   for a confirmed secret or critical explicit trigger. Findings are
   `BLOCKING`, `FOLLOW_UP`, or `INFORMATIONAL` and are never auto-dispatched.
4. **Fixture E2E/containment:** the declared production-mode fixture E2E run
   uses an isolated database, project, credentials, and high-port block, then
   runs `npx tsx tests/suite-containment-audit.ts --strict`. Skipped or
   unselected external suites are not passes.
5. **Tenant isolation:** every wave that moves or authorizes data proves
   owner/org/project separation with positive and negative fixtures, including
   private-user versus organization-owned resources and installation-only
   surfaces.
6. **Migration preservation:** migrations 093–100 record pre/post IDs, bounded
   row counts, ownership mappings, schema hashes, `PRAGMA integrity_check`, and
   `PRAGMA foreign_key_check`; any mismatch blocks the cutoff.
7. **Final reconciliation:** AUTH-111 reconciles every roadmap marker and
   TodoWrite item, confirms the changed-file list and canonical-doc links, and
   records evidence before terminal `PASS`. An open roadmap task or TodoWrite
   item requires immediate autonomous continuation, not a progress response.

## Authentication and authorization execution contracts

#### AUTH-100 — Foundation: identity, tenancy, and migration runner

- **IN_SCOPE:** Establish the user, organization, organization-membership,
  project, and project-membership identity model; define the installation-admin
  boundary; add migration `093` for identity/tenancy; implement the probe-based
  migration runner and its expand/dual-write/backfill/verify/enforce-cutoff
  lifecycle; create the deterministic bootstrap organization and local operator
  owner; preserve all existing resource IDs. Existing ambiguous credentials are
  organization-owned; existing OpenCode content is private to the bootstrap
  owner. Public signup is not part of the model.
- **OUT_OF_SCOPE:** Password/OIDC login flows, TOTP, authorization middleware,
  dashboard UX, resource-specific backfills, runtime containers, Docs Workspace
  mutation, and source implementation outside the identity/migration boundary.
- **Owner:** `@ingenium-software-engineer-premium`.
- **Dependencies:** `DOC-100`; workflow cleanup prerequisite `396b1d9` is complete.
- **Acceptance:** A fresh and an existing database each pass the complete/absent
  probe for migration 093; partial or ambiguous schema refuses startup without
  mutation; bootstrap org/owner/project mappings are deterministic; existing
  IDs, bounded counts, ownership mappings, integrity checks, and foreign-key
  checks are preserved; local operator bootstrap/recovery is explicit; no public
  signup path is introduced; expand/dual-write/backfill/verify evidence is
  retained before any enforcement flag is enabled.
- **STOP_CONDITION:** `PASS` after migration-preservation, focused API/core,
  deployment/health, tenant-isolation, security, fixture-E2E, and marker checks;
  otherwise continue in scope or use only the permitted escalation rule.
- **Escalation:** Only unavailable required database/deployment access,
  unauthorized destructive migration action, a mutually exclusive identity or
  bootstrap product decision, genuine ambiguity, or bounded diagnosis that
  cannot reproduce a root cause.
- **Verification owner:** `@ingenium-qa`; `@ingenium-security-auditor` reviews
  probe fail-closed behavior and bootstrap boundaries.
- **Deployment owner:** `@ingenium-software-engineer-premium` with Docker/Compose
  permission; rebuild/restart the current merged source and health-check actual
  API routes.
- **Rollback/safety:** Take a verified pre-migration backup, use transactional
  probes, preserve source rows and IDs until post-checks pass, and leave the
  system in expand mode on a failed backfill; never guess ownership or delete
  ambiguous credentials/content.
- **Tests:** Migration 093 absent/complete/partial probes; bootstrap/recovery
  fixtures; ID/count/hash preservation; integrity/FK checks; organization and
  project isolation; no-signup route checks; deployment health; fixture E2E and
  strict containment; no-secret logs.
- **Docs:** This roadmap first; after verified implementation update only the
  directly affected sections of `docs/concepts/architecture.md`,
  `docs/develop/database.md`, `docs/security/index.md`, and
  `docs/operations/deployment.md`.
- **Exclusive writer territory:** Identity/tenancy schema, migration runner,
  bootstrap/recovery core/API code, and focused tests; no dashboard, mail,
  content, MCP, or runtime writer overlap.
- **Phase/counts:** A0 foundation; 3 writers / 3 nonwriters; premium owns the
  migration boundary, fast owns isolated fixtures, and docs owns roadmap-only
  edits; barrier before AUTH-101.
- **Verification plan:** Run source probes against disposable fresh and copied
  databases, compare pre/post IDs and ownership manifests, run focused tests,
  rebuild/restart, health-check actual routes, run tenant-negative fixtures and
  strict containment once, and fix only the current reproducible root cause
  before rerunning its smallest proving regression.
- **Causal remediation rule:** Fix the earliest probe, transaction, identity
  mapping, or preservation boundary that caused the failure; prove the fix with
  the named migration or isolation regression, not a downstream exception.
- **Finding classification:** Data loss, guessed ownership, partial-schema
  startup, cross-tenant access, or public signup is `BLOCKING`; unrelated
  historical drift is `FOLLOW_UP`; bounded migration evidence is
  `INFORMATIONAL`.
- **Markers/evidence:** [x] appended `work-started`; [x] appended matching
  `work-complete`; [x] recorded focused acceptance evidence below.
<!-- (work-started) AUTH-100 2026-08-13T13:20:00Z ingenium-software-engineer-premium -->
<!-- (work-complete) AUTH-100 2026-08-13T13:42:00Z ingenium-software-engineer-premium -->
Evidence AUTH-100: 8 focused core tests cover fresh and 092-shaped upgrades, partial-state refusal without repair, project ID preservation, bootstrap exactly-once, organization/project membership and owner invariants, session/token hash-expiry-revocation, content-free immutable audit metadata, and audit organization/project consistency; protected API bootstrap/error contracts and affected core/API typechecks passed on 2026-08-13.

#### AUTH-101 — Session identity: local/OIDC authentication and recovery

- **IN_SCOPE:** Add migration `094` for authentication; local password login,
  OIDC login, OIDC account identity keyed by `(issuer,subject)`, email
  verification and password reset, local operator bootstrap/recovery, TOTP,
  one-time recovery codes, session/device management, hashed session/reset/
  verification/invite/recovery material, and the stated timeout policy: idle
  session 30m, absolute session 12h, step-up 10m, reset 30m, verification 24h,
  invitation 7d, launch ticket <=60s. Password derivation uses scrypt with a
  memory cost of at least 64 MiB.
- **OUT_OF_SCOPE:** Public signup, passkeys, SMS, organization/project policy
  enforcement, resource backfills, dashboard visual redesign, MCP, and runtime
  gateway work.
- **Owner:** `@ingenium-software-engineer-premium`.
- **Dependencies:** AUTH-100.
- **Acceptance:** Local and OIDC login create the same authenticated principal
  model without duplicate `(issuer,subject)` identities; verification/reset,
  TOTP, recovery-code, session/device-revoke, and operator-recovery paths are
  one-time/expiry bounded and fail closed; raw secrets/tokens never appear in
  responses, logs, or persistence; timeout constants are source and runtime
  verified; no public signup, passkey, or SMS path exists.
- **STOP_CONDITION:** `PASS` after focused auth tests, security review,
  deployment/health, fixture E2E, isolation, strict containment, and marker
  reconciliation; otherwise continue in scope or use permitted escalation.
- **Escalation:** Only unavailable configured OIDC/provider access after the
  documented fixture path, unauthorized recovery/destructive action, a genuine
  login/recovery product decision or ambiguity, or an unreproduced root cause
  after bounded diagnosis.
- **Verification owner:** `@ingenium-qa`; `@ingenium-security-auditor` reviews
  password hashing, token hashing, replay, recovery, and session boundaries.
- **Deployment owner:** `@ingenium-software-engineer-premium` with Docker/Compose
  permission; rebuild/restart and health-check the actual login/session routes.
- **Rollback/safety:** Use disposable users and OIDC fixtures, never real
  credentials, retain recovery evidence without secret values, and preserve
  active pre-auth data while rolling back only the auth release boundary.
- **Tests:** Local/OIDC success and failure, `(issuer,subject)` uniqueness,
  verification/reset/invite expiry and replay, TOTP/recovery-code one-time use,
  session/device revoke, scrypt parameter checks, timeout checks, redaction,
  fixture E2E, deployment health, and strict containment.
- **Docs:** This roadmap; after verification update `docs/security/index.md`,
  `docs/security/api-authentication.md`, `docs/develop/api.md`,
  `docs/develop/variables.md`, and directly affected operations guidance only.
- **Exclusive writer territory:** Authentication core/API routes, credential
  tables, session/device logic, and focused tests; no overlap with authorization
  middleware or dashboard components.
- **Phase/counts:** A1 session identity; 3 writers / 3 nonwriters; premium owns
  auth, fast owns fixture clients, and docs owns roadmap-only edits; barrier
  before AUTH-102.
- **Verification plan:** Exercise every local/OIDC/recovery/session state with
  disposable identities, inspect database/log/response redaction, deploy the
  current merged source, health-check actual routes, run fixture E2E plus strict
  containment once, and rerun only the smallest regression for each causal fix.
- **Causal remediation rule:** Repair the first identity lookup, credential
  derivation, one-time-consumption, expiry, or session-revocation boundary
  proven by the trace; do not patch a UI symptom or weaken a failed guard.
- **Finding classification:** Credential/recovery leakage, replay, weak scrypt,
  duplicate OIDC identity, unbounded session, or forbidden signup/passkey/SMS is
  `BLOCKING`; provider UX enhancements are `FOLLOW_UP`; bounded auth telemetry is
  `INFORMATIONAL`.
- **Markers/evidence:** [ ] append `work-started` after preflight; [ ] append
  matching `work-complete` after all gates; [ ] replace
  `Evidence AUTH-101: <acceptance evidence placeholder>` with non-empty auth,
  security, deployment, E2E, and containment evidence.

#### AUTH-102 — Authorization: principals, roles, audit, and step-up

- **IN_SCOPE:** Add migration `095` for authorization and audit; establish the
  central API principal/authorization boundary; define organization/project
  role evaluation, resource ownership checks, CSRF, step-up authorization, and
  exact `401`/`403`/`404` semantics. Organization owner/admin see all org
  projects; organization member/viewer require explicit project membership;
  project roles are `editor` and `viewer`; an organization viewer is always
  read-only. Installation admins exclusively own backups/restore/raw logs/
  processes/global config/runtime fleet. Append immutable audit records without
  private plaintext.
- **OUT_OF_SCOPE:** Resource-specific schema backfills, dashboard screens, MCP
  adapters, runtime containers/gateways, public signup, passkeys, SMS, and
  authorization decisions not stated here.
- **Owner:** `@ingenium-software-engineer-premium`.
- **Dependencies:** AUTH-101.
- **Acceptance:** Every protected API route resolves one principal and one
  effective scope before data access; the role matrix is enforced consistently;
  missing/malformed auth returns `401`, insufficient permission returns `403`,
  and missing/foreign resources return `404`; browser mutations require exact
  origin/CSRF validation; step-up expires after 10m; installation-only routes
  reject org admins; org admins cannot implicitly read private-user plaintext;
  audit records identify actor/action/scope/outcome without secrets or content.
- **STOP_CONDITION:** `PASS` after authorization matrix, API contract, security
  review, deployment/health, tenant-isolation fixtures, fixture E2E, strict
  containment, and marker reconciliation; otherwise continue or escalate only
  under the permitted rule.
- **Escalation:** Only an unavailable required API/deployment boundary,
  unauthorized destructive operation, a mutually exclusive role/privacy
  decision, genuine ambiguity, or bounded diagnosis without a reproducible root
  cause.
- **Verification owner:** `@ingenium-qa`; `@ingenium-security-auditor` owns the
  role, CSRF, enumeration, step-up, audit, and installation-boundary review.
- **Deployment owner:** `@ingenium-software-engineer-premium` with Docker/Compose
  permission; rebuild/restart and probe the actual protected routes.
- **Rollback/safety:** Deny by default, preserve existing resource access until
  each resource is mapped, retain audit evidence, and do not expose plaintext or
  broaden an org role as a rollback shortcut.
- **Tests:** Full role/resource matrix, org viewer write denial, membership
  negatives, installation-admin separation, 401/403/404 contract, CSRF origin
  cases, step-up expiry/replay, audit immutability/redaction, deployment health,
  fixture E2E, tenant isolation, and strict containment.
- **Docs:** This roadmap; after verification update `docs/security/index.md`,
  `docs/security/api-authentication.md`, `docs/develop/api.md`, and
  `docs/concepts/architecture.md` only where the shipped boundary is directly
  described.
- **Exclusive writer territory:** Principal middleware, authorization policy,
  audit schema/API, CSRF/step-up enforcement, and focused tests; no resource,
  dashboard, MCP, or runtime writer overlap.
- **Phase/counts:** A2 authorization; 3 writers / 3 nonwriters; premium owns
  policy, fast owns matrix fixtures, and docs owns roadmap-only edits; barrier
  before AUTH-103 and all resource work.
- **Verification plan:** Run the complete role/scope/status matrix against
  disposable organizations and resources, inspect audit/redaction and browser
  origin evidence, deploy/health-check actual routes, run fixture E2E and strict
  containment once, and fix/rerun only the proving regression for a causal root.
- **Causal remediation rule:** Fix the earliest principal resolution, policy
  evaluation, resource lookup, CSRF, step-up, or audit persistence boundary
  identified by the failing trace; never turn a forbidden response into a
  client-side hiding behavior.
- **Finding classification:** Cross-tenant access, plaintext disclosure,
  install-boundary bypass, wrong status semantics, CSRF bypass, or audit loss is
  `BLOCKING`; extra roles or audit views are `FOLLOW_UP`; bounded policy evidence
  is `INFORMATIONAL`.
- **Markers/evidence:** [ ] append `work-started` after preflight; [ ] append
  matching `work-complete` after all gates; [ ] replace
  `Evidence AUTH-102: <acceptance evidence placeholder>` with non-empty role,
  security, audit, deployment, isolation, E2E, and containment evidence.

#### AUTH-103 — Dashboard UX: sign-in, membership, and security controls

- **IN_SCOPE:** Add the dashboard authentication and authorization UX over the
  central API boundary: local/OIDC sign-in, verification/reset, TOTP/recovery
  code setup, invitation acceptance, session/device management, step-up prompts,
  organization/project switcher, membership/role views, clear 401/403/404
  states, and installation-admin-only navigation. Keep browser bearer tokens
  server-side and preserve private-plaintext redaction.
- **OUT_OF_SCOPE:** New auth protocols, public signup, passkeys, SMS, resource
  schema/backfill work, runtime gateway implementation, Docs Workspace mutation,
  unrelated dashboard redesign, and weakening API authorization in the client.
- **Owner:** `@ingenium-software-engineer-fast`.
- **Dependencies:** AUTH-102.
- **Acceptance:** A user can complete local/OIDC sign-in and safe recovery,
  accept an invitation, manage sessions/devices, satisfy step-up, and switch
  only among authorized organizations/projects; viewer/member/editor states and
  401/403/404 errors are accurate; no private plaintext or bearer token reaches
  browser storage/DOM/logs; changed routes pass accessibility and 1440x900 /
  390x844 visual checks.
- **STOP_CONDITION:** `PASS` after focused dashboard/API tests, deployed route
  health, one security review, fixture E2E, strict containment, changed-route
  visual evidence, and marker reconciliation; otherwise continue or permitted
  escalation.
- **Escalation:** Only unavailable configured browser/deployment/OIDC access,
  unauthorized destructive action, a genuine UX/product decision or ambiguity,
  or bounded diagnosis that cannot reproduce a root cause.
- **Verification owner:** `@ingenium-qa`; `@ingenium-qa-vision` owns the changed
  route visual gate and `@ingenium-security-auditor` verifies browser token,
  CSRF, privacy, and step-up presentation boundaries.
- **Deployment owner:** `@ingenium-software-engineer-premium` with Docker/Compose
  permission; rebuild/restart the current dashboard and health-check actual
  authentication and project routes.
- **Rollback/safety:** Preserve typed server errors and drafts, fail closed on
  missing scope, use fixture identities only, keep screenshots content-free,
  and roll back only task-owned UX/API client changes.
- **Tests:** Dashboard component/API tests for every auth and role state,
  keyboard/accessibility checks, browser storage/network/console redaction,
  Playwright sign-in/recovery/invite/step-up/project-switch flows, deployed
  health, 1440x900 and 390x844 screenshots, fixture E2E, and strict containment.
- **Docs:** This roadmap; after verified behavior update only directly affected
  `docs/usage/dashboard.md`, `docs/configure/projects.md`,
  `docs/security/api-authentication.md`, and `docs/develop/api.md` sections.
- **Exclusive writer territory:** Dashboard auth/session/membership routes,
  components, and focused tests; no runtime gateway or unrelated route overlap.
- **Phase/counts:** A3 dashboard UX; 3 writers / 3 nonwriters; fast owns UI,
  premium owns deployment, and docs owns roadmap-only edits; barrier before
  resource/content UI consumers.
- **Verification plan:** Run fixture identities through each visible state,
  inspect DOM/accessibility/network/console and browser storage, deploy the
  merged source, health-check actual routes, capture both viewports, run fixture
  E2E and strict containment once, and rerun only the smallest causal check.
- **Causal remediation rule:** Fix the first API-to-UI identity, scope, state,
  storage, focus, or error mapping boundary shown by source and browser evidence;
  do not mask authorization defects with client-only route guards.
- **Finding classification:** Token/plaintext exposure, incorrect access affordance,
  bypassable step-up, broken recovery, or in-scope visual/accessibility failure is
  `BLOCKING`; unrelated dashboard polish is `FOLLOW_UP`; browser evidence is
  `INFORMATIONAL`.
- **Markers/evidence:** [ ] append `work-started` after preflight; [ ] append
  matching `work-complete` after all gates; [ ] replace
  `Evidence AUTH-103: <acceptance evidence placeholder>` with non-empty UI,
  security, deployment, E2E, strict-containment, and visual evidence.

#### AUTH-104 — Resource tenancy: projects, mail, providers, and vault items

- **IN_SCOPE:** Add migration `096` for resource ownership and migration `097`
  for mail tenancy. Organizations own projects. Mail accounts/cache/messages/
  suggestions, provider configurations/credentials, and vault items support
  private-user or organization ownership. Preserve IDs while backfilling
  ownership; ambiguous existing credentials become organization-owned. Apply
  owner/org/project authorization to every resource operation and retain the
  existing secret-free vault/provider boundaries.
- **OUT_OF_SCOPE:** Docs and private-conversation content migration, automation,
  runtime isolation, public signup, passkeys/SMS, new mail providers, crypto
  redesign, and installation-admin access to org/private plaintext beyond the
  stated installation boundary.
- **Owner:** `@ingenium-software-engineer-premium`.
- **Dependencies:** AUTH-102, AUTH-103.
- **Acceptance:** Migrations 096/097 use complete-schema probes, preserve every
  resource ID and bounded count, map existing projects to the bootstrap org,
  map ambiguous credentials to the org, and distinguish private-user from org
  ownership; authorized owner/org/project roles can perform only permitted
  operations; foreign resources return safe 404; org admins do not implicitly
  read private plaintext; vault values and provider keys remain secret-free in
  responses/logs/audit; mail tenancy preserves folder/account identity.
- **STOP_CONDITION:** `PASS` after migration preservation, resource isolation,
  mail/provider/vault security review, deployed health, fixture E2E, strict
  containment, and marker reconciliation; otherwise continue or permitted
  escalation.
- **Escalation:** Only unavailable required mail/provider/vault/deployment access,
  unauthorized destructive migration or secret action, a mutually exclusive
  ownership decision, genuine ambiguity, or bounded diagnosis without a
  reproducible root cause.
- **Verification owner:** `@ingenium-qa`; `@ingenium-security-auditor` reviews
  credential ownership, vault/provider plaintext boundaries, and tenant leaks.
- **Deployment owner:** `@ingenium-software-engineer-premium` with Docker/Compose
  permission; rebuild/restart and health-check actual resource/mail routes.
- **Rollback/safety:** Use SQLite backup API and disposable accounts/vault data,
  preserve source rows until hashes/counts/FKs pass, never decrypt during
  backfill, and do not delete or reassign ambiguous credentials by guess.
- **Tests:** 096/097 probes and ID/count/hash preservation; org/project/private
  resource matrix; mail folder/account/cache isolation; provider/vault metadata
  and no-plaintext checks; deletion/restore safety; deployment health; fixture
  E2E and strict containment.
- **Docs:** This roadmap; after verification update directly affected sections of
  `docs/concepts/architecture.md`, `docs/security/index.md`,
  `docs/configure/email-setup.md`, `docs/usage/mail.md`, `docs/usage/secrets.md`,
  `docs/develop/database.md`, and `docs/develop/api.md` only.
- **Exclusive writer territory:** Resource ownership and mail tenancy core/API,
  migrations, and focused tests; no content, automation, MCP, or runtime
  writer overlap.
- **Phase/counts:** A4 resource tenancy; 3 writers / 3 nonwriters; premium owns
  resource/migration code, fast owns isolation fixtures, and docs owns
  roadmap-only edits; barrier before AUTH-105.
- **Verification plan:** Run fresh/existing migration probes, compare immutable
  IDs/counts/ownership manifests and SQLite checks, exercise each ownership
  matrix with disposable data, deploy/health-check actual routes, run fixture
  E2E and strict containment once, and rerun only the causal proving check.
- **Causal remediation rule:** Fix the first ownership backfill, folder/account
  identity, authorization lookup, secret serialization, or FK boundary that
  loses tenant safety; never add per-resource client exceptions.
- **Finding classification:** Data loss, cross-tenant mail/provider/vault access,
  plaintext exposure, wrong ownership, or broken preservation is `BLOCKING`;
  unsupported provider expansion is `FOLLOW_UP`; migration manifests are
  `INFORMATIONAL` evidence.
- **Markers/evidence:** [ ] append `work-started` after preflight; [ ] append
  matching `work-complete` after all gates; [ ] replace
  `Evidence AUTH-104: <acceptance evidence placeholder>` with non-empty
  migration, tenancy, security, deployment, E2E, and containment evidence.

#### AUTH-105 — Content tenancy: Docs and private conversations

- **IN_SCOPE:** Add migration `098` for content tenancy. Docs are
  organization-scoped. Private conversations support private-user or
  organization ownership, including messages, checkpoints, context/RAG source
  links, citations, and OpenCode content. Existing OpenCode content becomes
  private to the bootstrap owner while preserving IDs. Enforce content access
  before retrieval, search, indexing, citation, export, checkpoint, and restore
  paths; org admins do not implicitly read private-user plaintext.
- **OUT_OF_SCOPE:** Docs Workspace mutation, new RAG providers, transcript
  export redesign, mail/provider/vault backfill, automation, runtime containers,
  public signup, passkeys, SMS, and content-body sharing not explicitly owned.
- **Owner:** `@ingenium-software-engineer-premium`.
- **Dependencies:** AUTH-104.
- **Acceptance:** Migration 098 has complete/absent probes and preserves every
  content ID, message order, checkpoint/source linkage, bounded count, and hash;
  organization Docs are visible only to authorized org principals; private
  conversations/OpenCode content are visible only to the owner or explicit
  policy; org admin cannot read private plaintext by role alone; search/RAG,
  citations, uploads, checkpoints, restore-as-new, and task references enforce
  the same scope and return safe 404 for foreign content.
- **STOP_CONDITION:** `PASS` after content-preservation and tenant-isolation
  tests, security review, deployed route health, fixture E2E, strict containment,
  and marker reconciliation; otherwise continue or permitted escalation.
- **Escalation:** Only unavailable required content/deployment access,
  unauthorized irreversible restore/export, a mutually exclusive content
  sharing decision, genuine ambiguity, or bounded diagnosis without a
  reproducible root cause.
- **Verification owner:** `@ingenium-qa`; `@ingenium-security-auditor` reviews
  plaintext, indexing, citation, and private-content boundaries.
- **Deployment owner:** `@ingenium-software-engineer-premium` with Docker/Compose
  permission; rebuild/restart and health-check actual Docs/context/content routes.
- **Rollback/safety:** Use immutable snapshots and disposable content, preserve
  source IDs and message order, never expose content in logs or evidence, and
  fail closed if an ownership mapping is missing.
- **Tests:** 098 schema probes; content ID/order/link/hash preservation; org Docs
  and private conversation positive/negative matrices; RAG/search/citation/
  checkpoint/restore authorization; no-body foreign 404; deployment health;
  fixture E2E and strict containment.
- **Docs:** This roadmap; after verification update directly affected sections of
  `docs/concepts/architecture.md`, `docs/reference/docs-workspace.md`,
  `docs/usage/docs-workspace.md`, `docs/usage/chat.md`, `docs/develop/api.md`,
  `docs/develop/database.md`, and `docs/security/index.md` only.
- **Exclusive writer territory:** Content ownership/backfill, Docs/context/RAG
  authorization adapters, migration, and focused tests; no automation, MCP, or
  runtime writer overlap.
- **Phase/counts:** A5 content tenancy; 3 writers / 3 nonwriters; premium owns
  content boundaries, fast owns preservation/isolation fixtures, and docs owns
  roadmap-only edits; barrier before AUTH-106.
- **Verification plan:** Run migration probes against copied data, compare
  content/link/hash manifests and SQLite checks, exercise org/private retrieval
  and indexing negatives, deploy/health-check actual routes, run fixture E2E and
  strict containment once, and rerun only the smallest causal regression.
- **Causal remediation rule:** Fix the first content-owner resolution, query,
  index admission, citation, checkpoint, or export boundary proven to bypass
  scope; do not redact only the final rendered response.
- **Finding classification:** Private plaintext leakage, cross-org Docs access,
  foreign RAG/citation/restore access, or content loss is `BLOCKING`; richer
  sharing controls are `FOLLOW_UP`; content-free provenance is `INFORMATIONAL`.
- **Markers/evidence:** [ ] append `work-started` after preflight; [ ] append
  matching `work-complete` after all gates; [ ] replace
  `Evidence AUTH-105: <acceptance evidence placeholder>` with non-empty content
  preservation, privacy, security, deployment, E2E, and containment evidence.

#### AUTH-106 — Automation tenancy: jobs, tasks, runs, and audit

- **IN_SCOPE:** Add migration `099` for automation tenancy. Scope jobs,
  schedules, trusted events, deliveries, tasks, runs, logs, vault references,
  pipeline events, and automation metadata to the principal/org/project/resource
  owner model. Preserve IDs and history. Installation admins exclusively own
  raw process/log and global operational surfaces; organization admins do not
  implicitly read private job prompts, run output, vault plaintext, or private
  conversation-derived automation content. Keep trusted-event catalogs,
  bounded retries, and secret-free child environments.
- **OUT_OF_SCOPE:** New job types, arbitrary webhooks/commands, runtime fleet
  containers, MCP client behavior, public signup, passkeys/SMS, and unrelated
  scheduler redesign.
- **Owner:** `@ingenium-software-engineer-premium`.
- **Dependencies:** AUTH-105.
- **Acceptance:** Migration 099 complete/absent probes preserve automation IDs,
  delivery history, task references, and bounded counts; jobs/tasks/runs/logs
  enforce owner/org/project policy; private automation content is not exposed
  to org admins by role alone; installation-only raw logs/process/global surfaces
  reject org principals; trusted events remain exact-match, bounded, durable,
  project-scoped, and redacted; vault references never expose values.
- **STOP_CONDITION:** `PASS` after migration preservation, automation isolation,
  security review, deployment/health, fixture E2E, strict containment, and marker
  reconciliation; otherwise continue or permitted escalation.
- **Escalation:** Only unavailable scheduler/deployment access, unauthorized
  destructive execution, a mutually exclusive automation privacy decision,
  genuine ambiguity, or bounded diagnosis without a reproducible root cause.
- **Verification owner:** `@ingenium-qa`; `@ingenium-security-auditor` reviews
  raw-log/process/install boundaries, prompt/output redaction, and vault use.
- **Deployment owner:** `@ingenium-software-engineer-premium` with Docker/Compose
  permission; rebuild/restart and health-check actual jobs/tasks/service routes.
- **Rollback/safety:** Use disposable jobs and fixture events, preserve immutable
  delivery/run evidence, block execution when principal/scope is unavailable,
  never auto-unseal or log secret/plaintext data, and do not purge history.
- **Tests:** 099 probes and ID/history preservation; org/private/project job
  matrix; task/reference isolation; exact trusted-event delivery and retry
  checks; raw process/log denial; vault redaction; restart/health; fixture E2E
  and strict containment.
- **Docs:** This roadmap; after verification update directly affected sections of
  `docs/operations/jobs.md`, `docs/security/index.md`, `docs/develop/api.md`,
  `docs/develop/database.md`, `docs/usage/tasks.md`, and `docs/usage/secrets.md`.
- **Exclusive writer territory:** Automation ownership/backfill, job/task/run
  authorization, migration, and focused tests; no MCP or runtime writer overlap.
- **Phase/counts:** A6 automation; 3 writers / 3 nonwriters; premium owns
  automation, fast owns event/isolation fixtures, and docs owns roadmap-only
  edits; barrier before AUTH-107.
- **Verification plan:** Probe copied databases, compare IDs/history/counts and
  SQLite checks, run exact positive/negative job/task/run fixtures, inspect logs
  and redaction, deploy/health-check actual routes, run fixture E2E and strict
  containment once, and rerun only the proving check for a causal fix.
- **Causal remediation rule:** Fix the first automation ownership, event match,
  lease, child-environment, output-redaction, or install-scope boundary proven
  by the durable trace; never permit execution and hide it later.
- **Finding classification:** Unauthorized execution, private prompt/output or
  vault leakage, raw-log bypass, data loss, or cross-tenant history access is
  `BLOCKING`; richer automation features are `FOLLOW_UP`; bounded run evidence is
  `INFORMATIONAL`.
- **Markers/evidence:** [ ] append `work-started` after preflight; [ ] append
  matching `work-complete` after all gates; [ ] replace
  `Evidence AUTH-106: <acceptance evidence placeholder>` with non-empty
  automation preservation, security, deployment, E2E, and containment evidence.

#### AUTH-107 — MCP tenancy: authenticated principal and scoped tools

- **IN_SCOPE:** Carry the authenticated principal, organization, project,
  ownership, and effective scopes through the MCP server/API boundary; make API
  tokens scoped, hashed, expiry-bound, revocable, and creation-only visible;
  filter catalog discovery and invocation by authorization; keep installation
  tools installation-admin-only; preserve API-first/zero-DB runtime consumers,
  safe errors, idempotency, and project attestation.
- **OUT_OF_SCOPE:** New MCP product tools, arbitrary token aliases, runtime
  containers/gateways, dashboard redesign beyond the auth UX, public signup,
  passkeys/SMS, and direct database or mutation-REST access from consumers.
- **Owner:** `@ingenium-software-engineer-premium`.
- **Dependencies:** AUTH-106.
- **Acceptance:** An authenticated MCP request cannot omit or forge principal,
  org, project, or scope; scoped API tokens store only hashes and metadata;
  unauthorized discovery/invocation fails closed with the agreed status/error;
  installation-only tools reject org principals; private/org-owned resource
  tools enforce the same policy as REST; no token, prompt, private content, or
  credential appears in MCP responses/logs; catalog/tool parity remains intact.
- **STOP_CONDITION:** `PASS` after MCP/API fixture contracts, security review,
  deployed health, tenant-isolation and token fixtures, fixture E2E, strict
  containment, and marker reconciliation; otherwise continue or permitted
  escalation.
- **Escalation:** Only unavailable required MCP/deployment access, unauthorized
  destructive token/tool action, a mutually exclusive public tool/scope choice,
  genuine ambiguity, or bounded diagnosis without a reproducible root cause.
- **Verification owner:** `@ingenium-qa`; `@ingenium-security-auditor` reviews
  token hashing/scopes, tool filtering, install boundary, and redaction.
- **Deployment owner:** `@ingenium-software-engineer-premium` with Docker/Compose
  permission; rebuild/restart and health-check actual MCP/API routes.
- **Rollback/safety:** Deny unknown/missing scope, revoke only disposable fixture
  tokens, preserve existing catalog IDs and resource ownership, and never grant
  broad compatibility scope to repair a failing call.
- **Tests:** Token create/list/revoke/expiry/hash/redaction; org/project/private
  tool matrix; 401/403/404/error envelopes; discovery/invocation parity;
  installation-admin denial; API-only DB isolation; deployed MCP smoke; fixture
  E2E and strict containment.
- **Docs:** This roadmap; after verified behavior update only directly affected
  `docs/reference/mcp-tools.md`, `docs/develop/api.md`,
  `docs/security/api-authentication.md`, and `docs/security/index.md` sections.
- **Exclusive writer territory:** MCP server/API adapters, scoped-token surface,
  catalog authorization projection, and focused tests; no runtime or dashboard
  writer overlap.
- **Phase/counts:** A7 MCP; 3 writers / 3 nonwriters; premium owns API boundary,
  fast owns MCP fixtures, and docs owns roadmap-only edits; barrier before
  AUTH-108.
- **Verification plan:** Run token and tool matrix fixtures with disposable
  principals, inspect wire/log redaction and catalog parity, deploy/health-check
  actual MCP/API routes, run fixture E2E and strict containment once, and rerun
  only the smallest proving check after a causal fix.
- **Causal remediation rule:** Fix the first principal propagation, scope
  resolution, tool filtering, token storage, or serialization boundary proven by
  the request trace; do not patch individual tool handlers as exceptions.
- **Finding classification:** Token leakage, scope bypass, install-tool access,
  cross-tenant invocation, catalog inconsistency, or DB-boundary violation is
  `BLOCKING`; optional aliases/tools are `FOLLOW_UP`; parity evidence is
  `INFORMATIONAL`.
- **Markers/evidence:** [ ] append `work-started` after preflight; [ ] append
  matching `work-complete` after all gates; [ ] replace
  `Evidence AUTH-107: <acceptance evidence placeholder>` with non-empty token,
  MCP, security, deployment, E2E, and containment evidence.

#### AUTH-108 — Runtime isolation: per-user/workspace containers

- **IN_SCOPE:** Add migration `100` for runtime isolation and implement one
  isolated runtime container per user/workspace, shared only by that user's Web,
  CLI, and VS Code sessions. Bind runtime identity to user/workspace/org/project
  scope, isolate filesystem/process/environment/network state, define lifecycle
  and cleanup, and enforce installation-admin-only runtime-fleet controls. Launch
  tickets are audience-bound, one-time, hashed, and expire in 60 seconds or less.
- **OUT_OF_SCOPE:** Shared multi-user containers, runtime gateway/UI roots,
  dashboard shell redesign, public signup, passkeys/SMS, unrestricted host
  access, same-UID isolation claims beyond the declared container boundary, and
  production destructive fleet cleanup without authorization.
- **Owner:** `@ingenium-software-engineer-premium`.
- **Dependencies:** AUTH-107.
- **Acceptance:** Migration 100 probes complete/absent state and preserves runtime
  ownership IDs/mappings; two users/workspaces cannot observe or mutate each
  other's filesystem, processes, environment, sockets, sessions, or mounted
  projects; Web/CLI/VS Code for one principal share the intended isolated runtime;
  installation admins alone can inspect/control the fleet; launch ticket replay,
  wrong-audience, wrong-runtime, expired, and foreign-principal use fails closed;
  cleanup is bounded, owned, auditable, and does not delete another runtime.
- **STOP_CONDITION:** `PASS` after migration preservation, container isolation,
  security review, deployed fleet health, fixture E2E, strict containment, and
  marker reconciliation; otherwise continue or permitted escalation.
- **Escalation:** Only unavailable required container/fleet/deployment access,
  unauthorized destructive cleanup, a mutually exclusive runtime trust decision,
  genuine ambiguity, or bounded diagnosis without a reproducible root cause.
- **Verification owner:** `@ingenium-qa`; `@ingenium-security-auditor` reviews
  container boundaries, ticket binding, host exposure, and fleet privileges.
- **Deployment owner:** `@ingenium-software-engineer-premium` with Docker/Compose
  permission; rebuild/restart and health-check the actual runtime control and
  application paths.
- **Rollback/safety:** Use disposable runtime containers and preserved volume
  snapshots, never attach a test runtime to real user data, retain failed
  cleanup manifests, and stop only identity-proven owned processes/containers.
- **Tests:** 100 schema probes; two-user/two-workspace isolation; Web/CLI/VS Code
  shared-runtime checks; ticket hash/TTL/nonce/audience/replay tests; process,
  filesystem, network, env, and mount negatives; fleet privilege denial;
  deployment/runtime health; fixture E2E and strict containment.
- **Docs:** This roadmap; after verification update directly affected sections of
  `docs/concepts/architecture.md`, `docs/operations/deployment.md`,
  `docs/security/index.md`, `docs/security/api-authentication.md`,
  `docs/usage/opencode.md`, and `docs/develop/database.md` only.
- **Exclusive writer territory:** Runtime lifecycle/isolation core/API,
  migration, container definitions, and focused tests; no gateway/UI writer
  overlap.
- **Phase/counts:** A8 runtime isolation; 3 writers / 3 nonwriters; premium owns
  runtime, fast owns isolation/cleanup fixtures, and docs owns roadmap-only
  edits; barrier before AUTH-109.
- **Verification plan:** Build and run disposable per-user/workspace runtimes,
  exercise cross-identity negatives and ticket replay/audience cases, inspect
  process/mount/network evidence, rebuild/restart the current source, health-check
  actual runtime routes, run fixture E2E and strict containment once, and rerun
  only the causal proving check.
- **Causal remediation rule:** Fix the first runtime identity, container
  namespace, mount, process, network, ticket, or cleanup ownership boundary
  proven by deployment evidence; never rely on UI hiding or a shared fallback.
- **Finding classification:** Cross-user visibility/control, ticket replay,
  host exposure, unsafe cleanup, data loss, or false fleet authorization is
  `BLOCKING`; capacity tuning is `FOLLOW_UP`; bounded runtime telemetry is
  `INFORMATIONAL`.
- **Markers/evidence:** [ ] append `work-started` after preflight; [ ] append
  matching `work-complete` after all gates; [ ] replace
  `Evidence AUTH-108: <acceptance evidence placeholder>` with non-empty runtime,
  migration, security, deployment, E2E, and containment evidence.

#### AUTH-109 — Runtime gateway/UI: audience roots and launch flow

- **IN_SCOPE:** Provide runtime-specific HTTPS roots for the isolated Web, CLI,
  and VS Code audiences; issue and consume audience-bound one-time launch tickets
  with a TTL of 60 seconds or less; route each root only to the matching runtime
  and principal; strip browser bearer/identity/proxy headers; add dashboard launch,
  loading, expired-ticket, unavailable, and recovery states; preserve the shared
  per-user runtime across Web/CLI/VS Code.
- **OUT_OF_SCOPE:** Shared-origin subpath proxying, browser bearer exposure,
  public signup, passkeys/SMS, runtime-container implementation, arbitrary
  iframe permissions, and unrelated dashboard navigation redesign.
- **Owner:** `@ingenium-software-engineer-fast`.
- **Dependencies:** AUTH-108.
- **Acceptance:** Each audience resolves to its own runtime HTTPS root and cannot
  reach another audience/runtime; a launch ticket is bound to principal,
  workspace/runtime, audience, origin, nonce, and expiry, is consumed once, and
  never appears in logs/URLs after exchange; hostile/missing origins, wrong
  audiences, foreign runtimes, expired/replayed tickets, and direct private
  upstream access fail closed; Web/CLI/VS Code launch states are accessible and
  pass changed-route desktop/mobile visual checks.
- **STOP_CONDITION:** `PASS` after gateway/UI/API tests, security review,
  deployed runtime health, fixture E2E, strict containment, 1440x900/390x844
  visual evidence, and marker reconciliation; otherwise continue or permitted
  escalation.
- **Escalation:** Only unavailable configured HTTPS/browser/deployment access,
  unauthorized destructive runtime action, a genuine origin/embedding product
  decision or ambiguity, or bounded diagnosis without a reproducible root cause.
- **Verification owner:** `@ingenium-qa`; `@ingenium-qa-vision` owns changed
  route and passive relevant visual checks; `@ingenium-security-auditor` owns
  origin, ticket, header, CSP, and permission review.
- **Deployment owner:** `@ingenium-software-engineer-premium` with Docker/Compose
  permission; rebuild/restart and health-check the actual HTTPS roots and launch
  routes.
- **Rollback/safety:** Keep private upstream listeners private, use disposable
  tickets/runtimes, retain failed gateway evidence, reject unknown hosts/origins,
  and roll back only gateway/UI changes without deleting runtime volumes.
- **Tests:** Root/audience routing; ticket hash/TTL/binding/one-time/replay;
  origin/header/CSP/WebSocket negatives; Web/CLI/VS Code shared-runtime launch;
  dashboard loading/error/recovery/accessibility; deployed roots/health; fixture
  E2E; strict containment; 1440x900 and 390x844 screenshots and cleanup.
- **Docs:** This roadmap; after verification update directly affected sections of
  `docs/operations/deployment.md`, `docs/security/api-authentication.md`,
  `docs/security/iframe-sandbox.md`, `docs/usage/opencode.md`,
  `docs/usage/dashboard.md`, and `docs/concepts/conventions.md` only.
- **Exclusive writer territory:** Runtime gateway configuration, launch-ticket
  exchange, dashboard runtime launch components, and focused tests; no overlap
  with container lifecycle internals.
- **Phase/counts:** A9 runtime gateway/UI; 3 writers / 3 nonwriters; fast owns
  dashboard/gateway integration, premium owns deployment, and docs owns
  roadmap-only edits; barrier before AUTH-110.
- **Verification plan:** Exercise each audience from the dashboard and direct
  hostile-origin fixtures, inspect network/console/headers/DOM, deploy the
  merged source, health-check each actual root, capture both viewports, run fixture
  E2E and strict containment once, and rerun only the smallest causal regression.
- **Causal remediation rule:** Fix the earliest host/origin/ticket/audience,
  header/CSP, runtime URL, or UI state producer shown by gateway and browser
  evidence; do not hide a routing failure behind a permanent unavailable state.
- **Finding classification:** Ticket/origin bypass, cross-runtime routing,
  browser credential leak, private upstream exposure, broken launch, or in-scope
  visual/accessibility failure is `BLOCKING`; optional root aliases are
  `FOLLOW_UP`; browser/network evidence is `INFORMATIONAL`.
- **Markers/evidence:** [ ] append `work-started` after preflight; [ ] append
  matching `work-complete` after all gates; [ ] replace
  `Evidence AUTH-109: <acceptance evidence placeholder>` with non-empty gateway,
  UI, security, deployment, E2E, strict-containment, and visual evidence.

#### AUTH-110 — Enforcement cutoff: tenant-required reads and writes

- **IN_SCOPE:** Complete expand/dual-write/backfill/verify for migrations
  093–100, run preservation and isolation audits, then enable the enforcement
  cutoff across API, dashboard, MCP, mail, providers, vault, Docs, conversations,
  automation, and runtime paths. Remove project-only/global fallback behavior
  where it would bypass principal/org/ownership policy; retain installation
  admin-only operational controls and explicit private/org ownership. Make
  missing principal, tenant, ownership, or mapping fail closed.
- **OUT_OF_SCOPE:** New features after cutoff, public signup, passkeys/SMS,
  broad cleanup of unrelated legacy rows, Docs Workspace mutation, or rollback
  by deleting migrated data.
- **Owner:** `@ingenium-software-engineer-premium`.
- **Dependencies:** AUTH-109 and migrations 093–100 complete.
- **Acceptance:** All migration probes report complete applied state; dual-write
  and backfill reconcile without ID/count/hash/FK loss; every scoped read/write
  requires a principal and effective tenant/ownership decision; old fallback
  paths cannot cross tenants; 401/403/404, CSRF, step-up, installation-only,
  private-plaintext, scoped-token, and runtime-ticket contracts remain true;
  failed verification leaves enforcement disabled and preserves recovery evidence.
- **STOP_CONDITION:** `PASS` after cutoff rehearsal, preservation and tenant
  isolation matrix, security review, current-source deployment/health, fixture
  E2E, strict containment, applicable visual regressions, and marker
  reconciliation; otherwise continue in expand mode or use permitted escalation.
- **Escalation:** Only unavailable required deployment/database access,
  unauthorized irreversible cutoff, a mutually exclusive rollout decision,
  genuine ambiguity, or bounded diagnosis that cannot reproduce a root cause.
- **Verification owner:** `@ingenium-qa`; `@ingenium-security-auditor` reviews
  bypass search, cutoff fail-closed behavior, and migration evidence.
- **Deployment owner:** `@ingenium-software-engineer-premium` with Docker/Compose
  permission; rebuild/restart current merged source and health-check actual
  routes before and after the cutoff.
- **Rollback/safety:** Rehearse on an isolated copied database, snapshot before
  cutoff, gate enforcement on complete evidence, retain dual-write compatibility
  for the documented rollback window, and never use a broad fallback or delete
  source rows to recover.
- **Tests:** Probe-based migration matrix; dual-write/replay/backfill checks;
  source-derived legacy-fallback search; full tenant/role/private/install matrix;
  401/403/404/CSRF/step-up/token/ticket regressions; deployed health; fixture
  E2E; strict containment; changed-route visual regression where applicable.
- **Docs:** This roadmap; after verified cutoff update only directly affected
  `docs/develop/database.md`, `docs/security/api-authentication.md`,
  `docs/security/index.md`, `docs/concepts/architecture.md`,
  `docs/develop/api.md`, `docs/operations/deployment.md`, and
  `docs/develop/testing.md` sections.
- **Exclusive writer territory:** Enforcement flags/middleware, final backfill
  reconciliation, migration closure, and focused cutoff tests; no new product
  feature territory overlap.
- **Phase/counts:** A10 enforcement cutoff; 3 writers / 3 nonwriters; premium
  owns cutoff/deployment, fast owns regression fixtures, and docs owns
  roadmap-only edits; barrier before AUTH-111.
- **Verification plan:** Run rehearsal and preservation manifests, inspect all
  legacy fallback call sites, deploy/restart current source, health-check actual
  routes before/after enabling enforcement, run tenant/security fixture E2E and
  strict containment once, and fix/rerun only the smallest proving regression.
- **Causal remediation rule:** Fix the first remaining unscoped read/write,
  incomplete backfill, stale dual-write, or enforcement-flag boundary proven by
  the audit; do not add a route-specific bypass.
- **Finding classification:** Any bypass, data loss, tenant leak, false health,
  unsafe cutoff, or failed preservation is `BLOCKING`; nonrequired legacy
  cleanup is `FOLLOW_UP`; rollout manifests are `INFORMATIONAL`.
- **Markers/evidence:** [ ] append `work-started` after preflight; [ ] append
  matching `work-complete` after all gates; [ ] replace
  `Evidence AUTH-110: <acceptance evidence placeholder>` with non-empty cutoff,
  migration, security, deployment, E2E, containment, and isolation evidence.

#### AUTH-111 — Release acceptance and final reconciliation

- **IN_SCOPE:** Perform the complete approved multi-user release acceptance over
  local/OIDC auth, bootstrap/recovery, invitations, verification/reset, TOTP and
  recovery codes, sessions/devices, scoped API tokens, roles/audit/step-up,
  resource/content/automation tenancy, MCP, isolated runtimes, audience-bound
  HTTPS roots, deployment, and directly affected canonical documentation links.
  Reconcile all roadmap markers, acceptance evidence placeholders, changed paths,
  and TodoWrite state.
- **OUT_OF_SCOPE:** New product decisions/features, passkeys, SMS, public signup,
  unrelated docs cleanup, broad index regeneration, Docs Workspace mutation,
  destructive production restore, and real credentials in default fixture gates.
- **Owner:** `@ingenium-software-engineer-premium`.
- **Dependencies:** AUTH-110.
- **Acceptance:** A rebuilt current source is deployed and all required services,
  application health checks, actual API/dashboard/MCP/runtime HTTPS routes, and
  process boundaries are healthy; fixture E2E passes with strict containment;
  tenant isolation and migration-preservation matrices pass; security review
  records no in-scope blocker; AUTH-103/AUTH-109 desktop/mobile visual gates and
  the passive full-site sweep pass at 1440x900 and 390x844; directly affected
  canonical auth/security/architecture/testing/deployment docs have verified
  links/commands/policy wording; every completed task has evidence and no active
  marker or TodoWrite item remains unreconciled.
- **STOP_CONDITION:** `PASS` only after every acceptance item and evidence
  reconciliation is complete. `STOP` or `CANCELLED` is terminal only when
  explicitly requested; otherwise continue declared work or use only the
  permitted escalation rule.
- **Escalation:** Only unavailable required external credential/access after the
  configured fixture path, unauthorized destructive action, a mutually exclusive
  product decision, genuine ambiguity, or bounded diagnosis that cannot reproduce
  a root cause.
- **Verification owner:** `@ingenium-qa` owns one declared fixture/release pass;
  `@ingenium-security-auditor` owns one bounded security pass; and
  `@ingenium-qa-vision` owns the changed-route and passive desktop/mobile visual
  gates. They report findings once and never dispatch follow-up work.
- **Deployment owner:** `@ingenium-software-engineer-premium` with Docker/Compose
  permission; rebuild/restart the current merged source, verify image/source
  provenance, and health-check actual routes and runtime roots.
- **Rollback/safety:** Use disposable identities, organizations, resources,
  runtimes, tokens, and tickets; preserve migration/runner/visual evidence;
  clean only manifest-owned processes/ports/containers; never place secrets in
  docs, screenshots, logs, or test artifacts; do not mutate production data.
- **Tests:** Declared fixture production E2E and `npx tsx
  tests/suite-containment-audit.ts --strict`; migration ID/count/hash/FK
  preservation; complete tenant/role/private/install matrix; auth/recovery/
  session/token/ticket security; deployed runtime health and actual routes;
  1440x900/390x844 changed-route and passive full-site visual checks;
  accessibility/console/network/browser cleanup; focused canonical-doc link,
  command, format, append-only, and diff checks; final marker/TodoWrite audit.
- **Docs:** Update only directly affected canonical repository files, with primary
  links to `docs/security/api-authentication.md`, `docs/security/index.md`,
  `docs/concepts/architecture.md`, `docs/develop/api.md`,
  `docs/develop/database.md`, `docs/develop/testing.md`,
  `docs/operations/deployment.md`, and relevant usage/configuration pages; never
  mutate Docs Workspace.
- **Exclusive writer territory:** Release evidence, final reconciliation, and
  named directly affected docs only; no implementation writer overlap after
  AUTH-110.
- **Phase/counts:** A11 release acceptance; 1 writer / 3 nonwriters; premium owns
  deployment/evidence, QA owns fixture acceptance, security owns review, and QA
  vision owns visual gates; serialize any causal remediation in a new declared
  wave rather than looping reviewers.
- **Verification plan:** Rebuild/restart the current merged source, health-check
  actual services/routes/HTTPS roots, run each declared fixture, strict,
  migration-preservation, tenant-isolation, security, and visual gate once,
  inspect links/commands/policy wording and browser cleanup, remediate only a
  reproducible in-scope root cause with its minimum proving regression, then
  reconcile markers/TodoWrite and every evidence placeholder.
- **Causal remediation rule:** Name the first failing release boundary, fix only
  that root cause within scope, rerun the smallest proving check (and the
  originally declared review only when its boundary changed), then repeat final
  reconciliation; a failed check alone is never escalation.
- **Finding classification:** Failed security, isolation, preservation,
  deployment/health, runtime, visual/accessibility, fixture/containment, link,
  or final-reconciliation acceptance is `BLOCKING`; unrelated product/docs drift
  is `FOLLOW_UP`; retained provenance and bounded test telemetry are
  `INFORMATIONAL`.
- **Markers/evidence:** [ ] append `work-started` after all predecessors pass;
  [ ] append matching `work-complete` only after every release gate passes;
  [ ] replace `Evidence AUTH-111: <acceptance evidence placeholder>` with the
  complete deployment, health, E2E, strict-containment, tenant-isolation,
  migration-preservation, security, visual, documentation, and final-reconcile
  evidence.

Each phase is a barrier. Standard allocation is **3 writers / 3 nonwriters**:
writers are `@ingenium-docs` (docs territory), `@ingenium-software-engineer-fast`
(one declared implementation territory), and
`@ingenium-software-engineer-premium` (one declared integration/deployment
territory); nonwriters are `@ingenium-qa`, `@ingenium-security-auditor`, and
`@ingenium-explore`. If fewer territories exist, unused slots remain empty; never
exceed 3 writers or 3 nonwriters. QA/security report once per declared boundary and
never dispatch follow-up work.

## Execution contracts

#### DOC-100 — Roadmap baseline and archive

- **IN_SCOPE:** Archive the former roadmap byte-for-byte, create this canonical roadmap, archive index and hash sidecar, and update the reference index links.
- **OUT_OF_SCOPE:** Source, tests, Docs Workspace, indexes unrelated to Reference, and work-started markers before baseline tests.
- **Owner:** `@ingenium-docs`.
- **Dependencies:** None.
- **Acceptance:** Archive `cmp` and SHA-256 match; one canonical roadmap exists; every task has the complete field set; live marker log is empty; required links resolve.
- **STOP_CONDITION:** `PASS` after DOC baseline checks; otherwise continue in scope; explicit user `STOP`/`CANCELLED` is terminal.
- **Escalation:** Only an unavailable required check or genuine ambiguity in the expected canonical row.
- **Verification owner:** `@ingenium-qa`.
- **Deployment owner:** N/A; documentation-only.
- **Rollback/safety:** Preserve unrelated dirty changes; use apply-patch move semantics; never mutate Docs Workspace.
- **Tests:** Archive `cmp`/hash, Markdown structure, links, and `git diff --check`.
- **Docs:** `docs/reference/ROADMAP.md`, `docs/reference/archive/index.md`, `docs/reference/index.md` only.
- **Exclusive writer territory:** `docs/reference/ROADMAP.md`, `docs/reference/archive/`, `docs/reference/index.md`.
- **Phase/counts:** P0; 1 writer / 0 nonwriters; no overlapping writer.
- **Verification plan:** Run each named check once after the write; inspect status to confirm unrelated paths are untouched.
- **Causal remediation rule:** Fix only a reproducible in-scope documentation root cause, then rerun its affected check.
- **Finding classification:** In-scope defects are `BLOCKING`; unrelated drift is `FOLLOW_UP`; context is `INFORMATIONAL`.

#### BUG-100 — Extension plugin diagnostics isolation

- **IN_SCOPE:** Prevent registered Ingenium extension plugin lifecycle and API failures from writing diagnostics to stdout/stderr or appearing in Chat/OpenCode interaction output; keep hooks non-fatal; route bounded credential-free warnings through the OpenCode app logger when available; add failure-path tests for every registered extension plugin and wrapper.
- **OUT_OF_SCOPE:** Hiding manual tool-result errors, changing MCP transport preflight diagnostics, redesigning self-learning behavior, changing providers, or suppressing operator logs outside plugin runtime hooks.
- **Owner:** Extension/plugin writer.
- **Dependencies:** DOC-100.
- **Acceptance:** API-down, authentication, timeout, and logger-failure fixtures produce no stdout/stderr or Chat-visible diagnostic text; plugin hooks resolve safely; approved warnings contain no response body, URL, token, prompt, or stack; `auto-observer`, `observer`, `resource-sync`, and their registered wrappers have deterministic load and lifecycle regression coverage; deployed OpenCode remains clean during session-created/idle failure paths.
- **STOP_CONDITION:** `PASS` after extension tests, package build, deployed OpenCode failure-path smoke, and marker reconciliation; otherwise continue or permitted escalation.
- **Escalation:** Only unavailable configured OpenCode/deployment access or a genuine product decision about retaining a user-visible plugin failure.
- **Verification owner:** `@ingenium-qa`; `@ingenium-qa-vision` only if the deployed interaction surface changes visually.
- **Deployment owner:** `@ingenium-software-engineer-premium` for rebuilt extension/container acceptance.
- **Rollback/safety:** Never print secrets or upstream error text; preserve non-fatal hooks and manual tool failures; revert only plugin diagnostic routing and tests.
- **Tests:** Registered-wrapper load tests; lifecycle API-down/auth/timeout/logger-failure tests; stdout/stderr spies; extension full suite/typecheck/build; deployed session-created/idle Chat/OpenCode console and output smoke.
- **Docs:** This roadmap entry only unless operator-visible logging semantics require a directly affected canonical reference.
- **Exclusive writer territory:** `packages/ingenium-extension` plugin runtime/wrappers/tests and the smallest provider-free deployed acceptance fixture.
- **Phase/counts:** P1 urgent insertion; up to 2 writers / 2 nonwriters; serialize deployment after implementation.
- **Verification plan:** Reproduce the exact stderr JSON fixture, remove the earliest plugin stream write, exercise every registered wrapper with API and logger failures, build/package, deploy, trigger session-created/idle, and inspect output/console/logs.
- **Causal remediation rule:** Remove or reroute the first plugin-owned protocol-stream write; do not mask the rendered symptom downstream in Chat.
- **Finding classification:** Any plugin diagnostic reaching stdout/stderr or Chat is `BLOCKING`; unrelated operator logging is `FOLLOW_UP`; safe app-log evidence is `INFORMATIONAL`.

#### MCP-100 — Tool toggle semantics

- **IN_SCOPE:** Define and implement fail-closed enabled/disabled semantics from catalog through API, MCP discovery, invocation, and Tool Manager.
- **OUT_OF_SCOPE:** Renaming the catalog, new providers, auth redesign, or unrelated UI.
- **Owner:** MCP/API writer.
- **Dependencies:** DOC-100.
- **Acceptance:** Disabled tools are absent from visible discovery and direct execution fails safely; re-enable restores both; built-in exceptions remain explicit.
- **STOP_CONDITION:** `PASS` after fixture and deployed checks; otherwise continue or permitted escalation.
- **Escalation:** Product choice about aliases or unavailable deployment access only.
- **Verification owner:** `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Fail closed on unknown state; preserve project isolation; revert only task-owned state filtering.
- **Tests:** Catalog/API/MCP fixture tests and real safe-tool toggle smoke; no real credentials.
- **Docs:** `docs/reference/mcp-tools.md` only if user-visible semantics change.
- **Exclusive writer territory:** MCP catalog/state/API/server paths and their focused tests.
- **Phase/counts:** P1; 3 writers / 3 nonwriters; territory isolated from dashboard writer.
- **Verification plan:** Compare catalog, discovery, invocation, and UI state at each toggle, then health-check deployment.
- **Causal remediation rule:** Trace the first divergent state producer and fix that shared boundary, not downstream symptoms.
- **Finding classification:** Acceptance failures are `BLOCKING`; unrelated catalog drift is `FOLLOW_UP`; observations are `INFORMATIONAL`.

#### MCP-101 — Current-catalog conformance harness

- **IN_SCOPE:** Build a fixture-first harness that compares the complete current catalog, names, categories, registration, and toggle projection across boundaries.
- **OUT_OF_SCOPE:** Adding tools, changing approved extension exceptions, live provider credentials, or broad refactors.
- **Owner:** MCP/core writer.
- **Dependencies:** MCP-100.
- **Acceptance:** Harness detects missing, duplicate, unknown-category, stale, and wrongly toggled entries and passes against the current catalog.
- **STOP_CONDITION:** `PASS` after deterministic fixture and current-catalog runs.
- **Escalation:** Only an unresolved canonical catalog decision or unreproducible mismatch.
- **Verification owner:** `@ingenium-qa`.
- **Deployment owner:** N/A unless the harness is runtime-packaged; then premium owns deployment.
- **Rollback/safety:** Read-only fixtures; never rewrite the catalog during a conformance run.
- **Tests:** Complete catalog parity, malformed fixture, duplicate ID, and category tests.
- **Docs:** `docs/reference/mcp-tools.md` if catalog contract wording changes.
- **Exclusive writer territory:** MCP conformance harness and catalog tests.
- **Phase/counts:** P2; 3 writers / 3 nonwriters; no overlap with dashboard files.
- **Verification plan:** Run fixture cases, then compare a source-derived current catalog and record deterministic failures.
- **Causal remediation rule:** Repair the source registration or projection named by the first mismatch and rerun the smallest failing case.
- **Finding classification:** Harness acceptance defects are `BLOCKING`; unrelated tool drift is `FOLLOW_UP`; coverage notes are `INFORMATIONAL`.

#### MCP-102 — OpenCode/chat live visibility

- **IN_SCOPE:** Make enabled-tool state observable in live OpenCode and Chat tool visibility without weakening auth or project boundaries.
- **OUT_OF_SCOPE:** Chat redesign, provider routing, tool renaming, or hidden aliases.
- **Owner:** MCP/dashboard writer.
- **Dependencies:** MCP-100, MCP-101.
- **Acceptance:** Live OpenCode and Chat reflect toggle changes on refresh/reconnect and reject disabled direct calls with actionable errors.
- **STOP_CONDITION:** `PASS` after deployed live-path checks and exact viewport checks where UI changes.
- **Escalation:** Unavailable configured OpenCode access or genuine visibility contract ambiguity.
- **Verification owner:** `@ingenium-qa`; visual owner is `@ingenium-qa-vision` when applicable.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Preserve bearer boundaries and fail closed on stale visibility.
- **Tests:** Live fixture OpenCode/Chat discovery and direct-call tests; Playwright only for changed UI.
- **Docs:** `docs/usage/index.md` if live visibility becomes user-facing.
- **Exclusive writer territory:** OpenCode/chat visibility adapters and focused tests.
- **Phase/counts:** P2; 3 writers / 3 nonwriters; no overlap with catalog harness.
- **Verification plan:** Toggle, reconnect, inspect visible tools, invoke safe tool, inspect console/network, and health-check.
- **Causal remediation rule:** Fix the earliest stale-cache or projection boundary proven by the live trace.
- **Finding classification:** Broken live semantics are `BLOCKING`; unrelated chat polish is `FOLLOW_UP`; logs are `INFORMATIONAL`.

#### MCP-103 — Usefulness report

- **IN_SCOPE:** Define a report of tool visibility, successful safe invocation, failure reasons, freshness, and fixture/live provenance.
- **OUT_OF_SCOPE:** Billing, provider scoring, user surveillance, or unverified usefulness claims.
- **Owner:** MCP/API writer.
- **Dependencies:** MCP-101, MCP-102.
- **Acceptance:** Report distinguishes catalog conformance, reachable visibility, invocation outcome, unknown, and not-run; no secrets or prompt content.
- **STOP_CONDITION:** `PASS` after fixture and configured live report generation.
- **Escalation:** Only an unresolved usefulness definition or unavailable required live boundary.
- **Verification owner:** `@ingenium-qa`.
- **Deployment owner:** N/A unless exposed by a runtime route; premium then owns deployment.
- **Rollback/safety:** Read-only, bounded, project-scoped report.
- **Tests:** Fixture matrix, empty/error, redaction, freshness, and deterministic export tests.
- **Docs:** `docs/reference/mcp-tools.md` if report fields are public.
- **Exclusive writer territory:** MCP usefulness report and tests.
- **Phase/counts:** P2; 3 writers / 3 nonwriters; isolated report territory.
- **Verification plan:** Generate report from fixtures, then one configured live run and compare provenance fields.
- **Causal remediation rule:** Correct the producing metric or evidence label, never mask missing evidence as success.
- **Finding classification:** Wrong report status is `BLOCKING`; broader analytics are `FOLLOW_UP`; extra diagnostics are `INFORMATIONAL`.

#### CTX-100 — Context source workspace

- **IN_SCOPE:** Establish a project-scoped context source workspace with bounded text/Markdown ingestion, provenance, tags, priority, and safe metadata.
- **OUT_OF_SCOPE:** Transcript export, automatic grounding, cross-project sharing, or destructive compaction.
- **Owner:** Core/API writer.
- **Dependencies:** DOC-100.
- **Acceptance:** Source create/list/search/upload rejects unsafe paths and oversized/unsupported input, preserves provenance, and isolates projects.
- **STOP_CONDITION:** `PASS` after real isolated API source workflow.
- **Escalation:** Storage access or ambiguous ownership only.
- **Verification owner:** `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Use disposable sources; preserve source IDs; grounding remains off by default.
- **Tests:** Upload limits/types, metadata, isolation, CRUD, and API integration tests.
- **Docs:** `docs/concepts/architecture.md`, `docs/reference/mcp-tools.md` when directly affected.
- **Exclusive writer territory:** Core/API context source implementation and tests.
- **Phase/counts:** P1; 3 writers / 3 nonwriters; no overlap with task capture.
- **Verification plan:** Upload fixture, inspect source metadata, search, reject boundary cases, and verify project isolation.
- **Causal remediation rule:** Fix the first source/provenance boundary that loses identity or safety metadata.
- **Finding classification:** Data loss or cross-project exposure is `BLOCKING`; format expansion is `FOLLOW_UP`; metrics are `INFORMATIONAL`.

#### CHAT-100 — Explicit grounded chat

- **IN_SCOPE:** Add an explicit, opt-in grounded-chat path that shows whether context was used and cites selected sources.
- **OUT_OF_SCOPE:** Always-on grounding, hidden prompt injection, transcript export, or provider-specific behavior.
- **Owner:** Dashboard/API writer.
- **Dependencies:** CTX-100.
- **Acceptance:** Default chat is ungrounded; explicit grounding retrieves bounded relevant sources, labels source use, and answers safely when none apply.
- **STOP_CONDITION:** `PASS` after fixture-first API/UI workflow and visual checks if changed.
- **Escalation:** Product ambiguity over the explicit opt-in control or unavailable configured provider.
- **Verification owner:** `@ingenium-qa` and `@ingenium-qa-vision` for UI.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Grounding off by default; never expose hidden source content or secrets.
- **Tests:** Ungrounded/grounded/no-result, citation, project isolation, console/network, and viewport tests.
- **Docs:** `docs/usage/index.md` and `docs/concepts/architecture.md` if behavior is user-visible.
- **Exclusive writer territory:** Chat route/components and grounded-chat API adapter.
- **Phase/counts:** P1; 3 writers / 3 nonwriters; isolated from context storage.
- **Verification plan:** Compare identical prompts with grounding off/on, inspect citations and bounded retrieval, then deployed route health.
- **Causal remediation rule:** Fix the first grounding flag, retrieval, or rendering mismatch proven in the request trace.
- **Finding classification:** Default grounding or citation failure is `BLOCKING`; unrelated chat UX is `FOLLOW_UP`; provider variance is `INFORMATIONAL`.

#### CTX-101 — Reproducible citations

- **IN_SCOPE:** Define stable source/chunk citation IDs, retrieval evidence, ordering, and reproducible citation rendering for grounded responses.
- **OUT_OF_SCOPE:** New embeddings, full reindex, always-on grounding, or unsupported source formats.
- **Owner:** Core/API writer.
- **Dependencies:** CTX-100, CHAT-100.
- **Acceptance:** Same fixture and query yields bounded deterministic citation identifiers and source attribution; missing/deleted sources are explicit.
- **STOP_CONDITION:** `PASS` after reproducibility and deletion-edge tests.
- **Escalation:** Only an unresolved canonical ordering or source identity decision.
- **Verification owner:** `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Preserve provenance; never fabricate citations or reveal restricted content.
- **Tests:** Ranking tie, repeated query, missing source, limit, permission, and API response tests.
- **Docs:** `docs/concepts/architecture.md` and `docs/reference/mcp-tools.md` if citation fields are public.
- **Exclusive writer territory:** RAG citation identity/serialization and focused tests.
- **Phase/counts:** P2; 3 writers / 3 nonwriters; no overlap with Chat UI.
- **Verification plan:** Run identical fixture queries twice, compare IDs/order/evidence, then exercise missing-source behavior.
- **Causal remediation rule:** Repair the unstable source/chunk identity producer, not the display-only formatter.
- **Finding classification:** Non-reproducible or false citations are `BLOCKING`; ranking improvements are `FOLLOW_UP`; trace detail is `INFORMATIONAL`.

#### TASK-100 — Source-reference contract

- **IN_SCOPE:** Define metadata-only task references to email, context, docs, chat, and jobs with project scope, source type, immutable source ID, and display metadata.
- **OUT_OF_SCOPE:** Copying source bodies, attachments, secrets, automatic task creation, or cross-project references.
- **Owner:** Core/API writer.
- **Dependencies:** DOC-100.
- **Acceptance:** References validate trusted source types and IDs, remain metadata-only and project-scoped, and render missing sources safely.
- **STOP_CONDITION:** `PASS` after schema and API contract tests.
- **Escalation:** Only a product choice about source identity or authorization.
- **Verification owner:** `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** No source-body duplication; reject unknown/foreign IDs.
- **Tests:** Schema, authorization, project isolation, missing source, and serialization tests.
- **Docs:** `docs/reference/mcp-tools.md` and task guidance if public.
- **Exclusive writer territory:** Task reference schema/core/API and tests.
- **Phase/counts:** P1; 3 writers / 3 nonwriters; isolated from capture UI.
- **Verification plan:** Create references for each trusted source type, inspect metadata only, and reject foreign/unknown IDs.
- **Causal remediation rule:** Fix the shared reference validation boundary that permits the first unsafe payload.
- **Finding classification:** Body leakage or cross-project reference is `BLOCKING`; additional source types are `FOLLOW_UP`; metadata detail is `INFORMATIONAL`.

#### TASK-101 — Mail/Context capture

- **IN_SCOPE:** Capture email and context source references into tasks through explicit user actions, preserving metadata-only semantics.
- **OUT_OF_SCOPE:** Auto-triage task creation, copying message/document bodies, attachment ingestion, or mail sending.
- **Owner:** Mail/context writer.
- **Dependencies:** TASK-100, CTX-100.
- **Acceptance:** Explicit capture creates a task reference with stable source metadata, duplicate capture is controlled, and unauthorized/foreign capture fails safely.
- **STOP_CONDITION:** `PASS` after real fixture capture workflow.
- **Escalation:** Missing configured mail access or ambiguous user confirmation.
- **Verification owner:** `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Metadata-only; no destructive mail operation; fixture accounts only.
- **Tests:** Mail/context capture, idempotency, authorization, duplicate, and missing-source tests.
- **Docs:** `docs/usage/index.md` and task reference docs if user-visible.
- **Exclusive writer territory:** Mail/context capture actions and focused tests.
- **Phase/counts:** P2; 3 writers / 3 nonwriters; no overlap with Chat/Docs capture.
- **Verification plan:** Capture disposable fixtures, inspect task refs, repeat action, and verify no content/secret persistence.
- **Causal remediation rule:** Fix the first source-to-reference mapping defect, not duplicate UI symptoms.
- **Finding classification:** Unsafe or missing capture is `BLOCKING`; auto-capture ideas are `FOLLOW_UP`; provenance fields are `INFORMATIONAL`.

#### TASK-102 — Chat/Docs capture

- **IN_SCOPE:** Capture explicit Chat and Docs references into tasks with metadata-only source IDs and visible provenance.
- **OUT_OF_SCOPE:** Automatic capture, transcript/body duplication, Docs Workspace mutation, or editor redesign.
- **Owner:** Dashboard/docs writer.
- **Dependencies:** TASK-100, CHAT-100, CTX-100.
- **Acceptance:** Explicit capture creates correct project-scoped references for Chat and Docs; source content is not copied; missing sources are actionable.
- **STOP_CONDITION:** `PASS` after fixture UI/API path and visual check if changed.
- **Escalation:** Only unavailable configured UI route or product ambiguity about confirmation.
- **Verification owner:** `@ingenium-qa` and `@ingenium-qa-vision` for UI.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** No automatic capture; preserve source and task data on failed writes.
- **Tests:** Chat/Docs capture, project isolation, missing source, duplicate, accessibility, and viewport tests.
- **Docs:** `docs/usage/index.md` and directly affected reference docs.
- **Exclusive writer territory:** Chat/Docs capture controls and tests.
- **Phase/counts:** P2; 3 writers / 3 nonwriters; no overlap with Mail/context capture.
- **Verification plan:** Capture each fixture, inspect metadata-only response, reload, and verify reference display.
- **Causal remediation rule:** Fix the shared capture request/response contract where the first mismatch occurs.
- **Finding classification:** Body leakage or wrong source is `BLOCKING`; unrelated UI polish is `FOLLOW_UP`; accessibility notes are `INFORMATIONAL` unless acceptance fails.

#### JOB-100 — Durable trusted event model

- **IN_SCOPE:** Define durable, project-scoped trusted event catalog, payload schema, provenance, dedupe key, and retention/audit semantics.
- **OUT_OF_SCOPE:** Arbitrary user events, unauthenticated webhooks, secret payloads, or scheduler redesign.
- **Owner:** Core/API writer.
- **Dependencies:** DOC-100.
- **Acceptance:** Only cataloged event types validate; payloads are bounded/redacted; events persist durably with idempotency and audit provenance.
- **STOP_CONDITION:** `PASS` after schema, migration, and integration tests.
- **Escalation:** Only an unresolved event contract or migration authorization issue.
- **Verification owner:** `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Additive migration; preserve unknown historical records; never persist secrets.
- **Tests:** Catalog allowlist, payload bounds, dedupe, authorization, redaction, and restart durability tests.
- **Docs:** `docs/develop/api.md` and `docs/reference/mcp-tools.md` if exposed.
- **Exclusive writer territory:** Event schema/core/API migration and tests.
- **Phase/counts:** P1; 3 writers / 3 nonwriters; isolated from dispatcher.
- **Verification plan:** Insert each approved fixture, reject unknown/oversized payloads, restart, and verify durable audit state.
- **Causal remediation rule:** Repair the first validation or persistence boundary that accepts unsafe/untrusted data.
- **Finding classification:** Untrusted event acceptance or loss is `BLOCKING`; new event ideas are `FOLLOW_UP`; audit enrichment is `INFORMATIONAL`.

#### JOB-101 — Exact-match dispatcher and idempotent queue

- **IN_SCOPE:** Dispatch trusted catalog events to exact-match jobs with bounded queueing, idempotency, retry state, and failure visibility.
- **OUT_OF_SCOPE:** Fuzzy matching, arbitrary code execution, infinite retries, or credential acquisition.
- **Owner:** API/jobs writer.
- **Dependencies:** JOB-100.
- **Acceptance:** Exact event/job matches enqueue once, retries are bounded and durable, nonmatches do not run, and failures are inspectable.
- **STOP_CONDITION:** `PASS` after restart and duplicate-event fixtures.
- **Escalation:** Only an unresolved retry/idempotency product choice or unavailable scheduler access.
- **Verification owner:** `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** No arbitrary event execution; dead-letter failed jobs; retain audit evidence.
- **Tests:** Exact-match, duplicate, concurrent, restart, timeout, retry-bound, and dead-letter tests.
- **Docs:** `docs/operations/index.md` and API reference if route behavior changes.
- **Exclusive writer territory:** Scheduler/dispatcher/queue and focused tests.
- **Phase/counts:** P2; 3 writers / 3 nonwriters; no overlap with event schema.
- **Verification plan:** Emit fixture events, inspect queue/run IDs, restart mid-run, repeat events, and verify one effective execution.
- **Causal remediation rule:** Fix the first event-key, queue, or lease race proven by the durable trace.
- **Finding classification:** Duplicate or unauthorized execution is `BLOCKING`; retry tuning is `FOLLOW_UP`; telemetry is `INFORMATIONAL`.

#### JOB-102 — Jobs UI

- **IN_SCOPE:** Show trusted events, queued/running/completed/failed jobs, retries, and safe operator actions in the existing Jobs UI.
- **OUT_OF_SCOPE:** Arbitrary job editing, secret payload display, new scheduler policy, or unrelated dashboard redesign.
- **Owner:** Dashboard writer.
- **Dependencies:** JOB-101.
- **Acceptance:** UI accurately reflects durable state, redacts payloads, explains failures, and supports only authorized bounded actions.
- **STOP_CONDITION:** `PASS` after deployed route and visual checks.
- **Escalation:** Unavailable deployment/browser access or unresolved action authorization.
- **Verification owner:** `@ingenium-qa` and `@ingenium-qa-vision`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** No secret rendering; preserve existing jobs and fail closed on actions.
- **Tests:** API/UI state matrix, polling/reload, action authorization, accessibility, console/network, and viewport tests.
- **Docs:** `docs/operations/index.md` if operator workflow changes.
- **Exclusive writer territory:** Jobs dashboard route/components and tests.
- **Phase/counts:** P3; 3 writers / 3 nonwriters; isolated UI territory.
- **Verification plan:** Exercise each durable state, reload/poll, invoke safe action, inspect redaction, and health-check route.
- **Causal remediation rule:** Fix the first API-to-UI state mapping defect rather than adding display fallbacks.
- **Finding classification:** Misrepresented or unsafe job state is `BLOCKING`; unrelated dashboard polish is `FOLLOW_UP`; extra telemetry is `INFORMATIONAL`.

#### USAGE-100 — Advisory thresholds

- **IN_SCOPE:** Define provider-neutral, project-scoped advisory budgets/thresholds for requests, tokens, cost, and cache fields when reported.
- **OUT_OF_SCOPE:** Billing enforcement, provider credentials, automatic throttling, or inferred cost/cache values.
- **Owner:** Core/API writer.
- **Dependencies:** DOC-100.
- **Acceptance:** Thresholds are advisory, distinguish unknown from zero, preserve reported numeric counters, and never block a request by default.
- **STOP_CONDITION:** `PASS` after model/API fixture tests.
- **Escalation:** Only a product decision about threshold units or missing-value wording.
- **Verification owner:** `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** No enforcement or billing inference; project isolation and safe defaults.
- **Tests:** Threshold evaluation, unknown/zero, UTC, project isolation, and redaction tests.
- **Docs:** `docs/concepts/architecture.md` and `docs/usage/usage.md` if directly affected.
- **Exclusive writer territory:** Usage budget model/API and tests.
- **Phase/counts:** P1; 3 writers / 3 nonwriters; isolated from usage UI.
- **Verification plan:** Feed provider-neutral fixtures at below/equal/above/unknown thresholds and verify advisory outputs only.
- **Causal remediation rule:** Fix the first normalization or comparison defect; never convert unknown to zero.
- **Finding classification:** Blocking behavior or false billing claim is `BLOCKING`; richer budgets are `FOLLOW_UP`; omitted telemetry is `INFORMATIONAL`.

#### USAGE-101 — Evaluation and attention dedupe

- **IN_SCOPE:** Evaluate advisory thresholds, create deduplicated attention items with freshness and evidence, and preserve unknown semantics.
- **OUT_OF_SCOPE:** Notifications to external systems, automatic throttling, provider billing, or repeated alert spam.
- **Owner:** API/core writer.
- **Dependencies:** USAGE-100.
- **Acceptance:** Same condition produces one active attention item, changes resolve/reopen deterministically, and stale/unknown data is labeled.
- **STOP_CONDITION:** `PASS` after event/restart/dedupe fixtures.
- **Escalation:** Only unresolved dedupe lifecycle choice or unavailable required scheduler access.
- **Verification owner:** `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Advisory only; retain evidence; no secret payloads.
- **Tests:** Dedupe, resolve/reopen, stale, unknown, concurrent evaluation, and restart tests.
- **Docs:** `docs/usage/usage.md` if attention semantics are user-facing.
- **Exclusive writer territory:** Usage evaluator/attention persistence and tests.
- **Phase/counts:** P2; 3 writers / 3 nonwriters; isolated from usage UI.
- **Verification plan:** Evaluate repeated and changed fixtures, restart, inspect evidence and active count, and verify no duplicate attention rows.
- **Causal remediation rule:** Fix the stable condition key or state transition causing duplicate/missing attention.
- **Finding classification:** Alert spam or missed active condition is `BLOCKING`; delivery channels are `FOLLOW_UP`; evidence metadata is `INFORMATIONAL`.

#### USAGE-102 — Usage UI

- **IN_SCOPE:** Add usage/attention presentation with totals, tokens, reported cache states, advisory thresholds, freshness, unknown values, and export where supported.
- **OUT_OF_SCOPE:** Billing controls, fake data, provider branding, credentials, or unrelated navigation redesign.
- **Owner:** Dashboard writer.
- **Dependencies:** USAGE-101.
- **Acceptance:** UI labels advisory results, unknown/not-reported values, UTC freshness, loading/empty/error states, and deduplicated attention.
- **STOP_CONDITION:** `PASS` after deployed route and 1440x900/390x844 visual gate.
- **Escalation:** Product choice on unknown wording or unavailable browser/deployment access.
- **Verification owner:** `@ingenium-qa` and `@ingenium-qa-vision`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Never fabricate usage or expose credentials; preserve navigation.
- **Tests:** Component/API/Playwright states, accessibility, console/network, screenshots, and health checks.
- **Docs:** `docs/usage/usage.md`, `docs/usage/index.md`, and reference links if route is added.
- **Exclusive writer territory:** Usage route/components and focused tests.
- **Phase/counts:** P3; 3 writers / 3 nonwriters; isolated from attention evaluator.
- **Verification plan:** Render fixture states, filter UTC range, inspect unknown/advisory labels, export if present, then deployed route check.
- **Causal remediation rule:** Fix the first API field-to-label mapping defect proven by network and DOM evidence.
- **Finding classification:** False values or unsafe disclosure is `BLOCKING`; visual polish is `FOLLOW_UP`; extra chart detail is `INFORMATIONAL`.

#### VAULT-100 — Job vault-reference contract

- **IN_SCOPE:** Define opt-in metadata-only job references to vault items, authorization, audit identity, and no-secret payload rules.
- **OUT_OF_SCOPE:** Auto-unseal, secret retrieval in UI, plaintext persistence, or credential rotation.
- **Owner:** Security/core writer.
- **Dependencies:** JOB-100, DOC-100.
- **Acceptance:** Jobs may reference an authorized vault item by stable ID without storing its value; default path is no vault access and audit is complete.
- **STOP_CONDITION:** `PASS` after sealed/unsealed fixture contract tests.
- **Escalation:** Authorization or destructive secret-operation ambiguity only.
- **Verification owner:** `@ingenium-security-auditor` and `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Vault opt-in; never auto-unseal; never log or persist secret values.
- **Tests:** Sealed, missing, unauthorized, authorized metadata, audit, and project isolation tests; no real credentials.
- **Docs:** `docs/security/index.md` and job/vault reference docs if public.
- **Exclusive writer territory:** Vault/job reference contract and tests.
- **Phase/counts:** P1; 3 writers / 3 nonwriters; security territory isolated.
- **Verification plan:** Exercise sealed default and disposable authorized reference, inspect audit/redaction, and seal afterward.
- **Causal remediation rule:** Fix the first secret boundary that exposes or authorizes an unsafe value.
- **Finding classification:** Secret exposure or auto-unseal is `BLOCKING`; rotation features are `FOLLOW_UP`; audit detail is `INFORMATIONAL`.

#### VAULT-101 — Bounded runner injection

- **IN_SCOPE:** Inject authorized vault references into bounded job runners only after explicit opt-in, with lifetime, redaction, and failure controls.
- **OUT_OF_SCOPE:** Global environment injection, auto-unseal, arbitrary commands, secret caching, or real credentials in default gates.
- **Owner:** Security/jobs writer.
- **Dependencies:** VAULT-100, JOB-101.
- **Acceptance:** Authorized disposable fixture receives only the requested secret at runtime, is bounded and redacted, and sealed/expired access fails closed.
- **STOP_CONDITION:** `PASS` after isolated runner tests and security review.
- **Escalation:** Missing vault authorization or unresolved secret lifetime choice.
- **Verification owner:** `@ingenium-security-auditor` and `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** No auto-unseal; wipe transient material; fixture-only default gates.
- **Tests:** Authorization, TTL, sealed, timeout, crash cleanup, redaction, and no-real-credential tests.
- **Docs:** `docs/security/index.md` and operations guidance.
- **Exclusive writer territory:** Runner injection and security tests.
- **Phase/counts:** P2; 3 writers / 3 nonwriters; no overlap with vault UI.
- **Verification plan:** Run bounded disposable job, inspect process/log/audit surfaces, expire/seal, and prove no residue.
- **Causal remediation rule:** Fix the first injection, lifetime, or redaction boundary proven by the test trace.
- **Finding classification:** Secret leak or unbounded execution is `BLOCKING`; provider integrations are `FOLLOW_UP`; audit telemetry is `INFORMATIONAL`.

#### VAULT-102 — Vault UI and audit

- **IN_SCOPE:** Show vault-reference status, opt-in authorization, bounded job use, and secret-free audit records in existing UI.
- **OUT_OF_SCOPE:** Secret value display, auto-unseal, credential setup, or unrelated security redesign.
- **Owner:** Dashboard/security writer.
- **Dependencies:** VAULT-101.
- **Acceptance:** UI never renders values, shows sealed/authorized/denied states, and audit identifies actor/job/action without secrets.
- **STOP_CONDITION:** `PASS` after deployed exact workflow and visual/security checks.
- **Escalation:** Authorization ambiguity or unavailable browser/deployment access.
- **Verification owner:** `@ingenium-security-auditor`, `@ingenium-qa`, and `@ingenium-qa-vision` for UI.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Sealed default, no automatic unlock, fixture-only tests, preserve audit evidence.
- **Tests:** UI/API state matrix, audit redaction, accessibility, console/network, viewport, and no-real-credential tests.
- **Docs:** `docs/security/index.md` and `docs/operations/index.md` if operator behavior changes.
- **Exclusive writer territory:** Vault UI/audit presentation and tests.
- **Phase/counts:** P3; 3 writers / 3 nonwriters; isolated UI territory.
- **Verification plan:** Exercise sealed/denied/authorized fixture states, inspect DOM/network/audit, and verify value absence.
- **Causal remediation rule:** Fix the first secret-bearing response or rendering boundary, not a masking symptom.
- **Finding classification:** Any secret exposure is `BLOCKING`; visual refinements are `FOLLOW_UP`; audit context is `INFORMATIONAL`.

#### RESTORE-100 — Restore state machine

- **IN_SCOPE:** Define explicit operator-command-first restore states, authorization, preview, confirmation, progress, failure, rollback, and audit transitions.
- **OUT_OF_SCOPE:** Automatic restore, destructive purge, unsupported resource restoration, or hidden confirmation.
- **Owner:** Core/API writer.
- **Dependencies:** DOC-100.
- **Acceptance:** Valid transitions are durable and auditable; restore requires explicit authorization and preserves source data; invalid transitions fail closed.
- **STOP_CONDITION:** `PASS` after isolated state-machine and restore-preview tests.
- **Escalation:** Destructive authorization or unsupported restore scope ambiguity.
- **Verification owner:** `@ingenium-qa` and `@ingenium-security-auditor`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Operator command first; immutable source backup; explicit confirmation; preserve failed evidence.
- **Tests:** State transition, replay/idempotency, preview-vs-run, authorization, failure, and rollback tests.
- **Docs:** `docs/operations/index.md` and backup reference docs.
- **Exclusive writer territory:** Restore state model/core/API and tests.
- **Phase/counts:** P1; 3 writers / 3 nonwriters; isolated from executor.
- **Verification plan:** Walk every allowed and rejected transition with disposable backup and inspect audit/revision state.
- **Causal remediation rule:** Fix the first invalid transition or authorization boundary, never bypass it in the UI.
- **Finding classification:** Unsafe/destructive transition is `BLOCKING`; unsupported resource types are `FOLLOW_UP`; transition logs are `INFORMATIONAL`.

#### RESTORE-101 — Supervisor maintenance executor

- **IN_SCOPE:** Run authorized restore maintenance through supervisor-controlled bounded execution with status, timeout, cleanup, and health checks.
- **OUT_OF_SCOPE:** Automatic restore triggers, raw process spawning from UI, unbounded commands, or unsupported backup formats.
- **Owner:** DevOps/API writer.
- **Dependencies:** RESTORE-100, JOB-101.
- **Acceptance:** Operator command starts one bounded executor, status survives restart, timeout/failure is visible, and service remains healthy or safely degraded.
- **STOP_CONDITION:** `PASS` after deployed Compose execution and health checks.
- **Escalation:** Unavailable deployment access or unreproducible executor failure after bounded diagnosis.
- **Verification owner:** `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Supervisor ownership, no shell interpolation of untrusted values, source backup preserved, operator confirmation required.
- **Tests:** Executor command, timeout, restart, cleanup, authorization, logs, health, and containment tests.
- **Docs:** `docs/operations/index.md` and deployment guidance.
- **Exclusive writer territory:** Supervisor/API maintenance executor and tests.
- **Phase/counts:** P2; 3 writers / 3 nonwriters; no overlap with restore state model.
- **Verification plan:** Preview then authorized disposable restore, observe supervisor/status/health, force bounded failure, and inspect retained evidence.
- **Causal remediation rule:** Fix the first command construction, supervision, timeout, or status persistence root cause.
- **Finding classification:** Unbounded/destructive execution or false health is `BLOCKING`; additional formats are `FOLLOW_UP`; logs are `INFORMATIONAL`.

#### RESTORE-102 — Operator workflow

- **IN_SCOPE:** Provide a clear preview→authorize→run→monitor→verify workflow in the existing operations UI/API.
- **OUT_OF_SCOPE:** Automatic restore, hidden confirmation, direct secret input, or unsupported resource promises.
- **Owner:** Dashboard/operations writer.
- **Dependencies:** RESTORE-101.
- **Acceptance:** Operator sees exact scope, confirmation, progress, terminal outcome, rollback guidance, and audit link; UI prevents unsafe defaults.
- **STOP_CONDITION:** `PASS` after deployed desktop/mobile workflow and accessibility checks.
- **Escalation:** Destructive product decision or unavailable browser/deployment access.
- **Verification owner:** `@ingenium-qa` and `@ingenium-qa-vision`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Operator-command-first, explicit confirmation, preserve source and failed evidence.
- **Tests:** Playwright preview/confirm/cancel/failure/reload, API authorization, accessibility, console/network, screenshots.
- **Docs:** `docs/operations/index.md` and backup/restore reference docs.
- **Exclusive writer territory:** Restore operator UI and tests.
- **Phase/counts:** P3; 3 writers / 3 nonwriters; isolated workflow territory.
- **Verification plan:** Run disposable preview and authorized execution, inspect every state, reload, and verify audit/health.
- **Causal remediation rule:** Fix the first state or authorization mismatch shown by API and DOM evidence.
- **Finding classification:** Unsafe workflow or misleading scope is `BLOCKING`; visual polish is `FOLLOW_UP`; operator hints are `INFORMATIONAL`.

#### MCP-104 — Report API

- **IN_SCOPE:** Expose project-scoped MCP usefulness report API with bounded filters, provenance, freshness, and safe error envelopes.
- **OUT_OF_SCOPE:** New catalog semantics, secrets, unbounded export, or provider billing.
- **Owner:** API/MCP writer.
- **Dependencies:** MCP-103.
- **Acceptance:** Authorized callers receive deterministic fixture/live report fields and unauthorized, invalid, and oversized requests fail safely.
- **STOP_CONDITION:** `PASS` after API contract and configured smoke tests.
- **Escalation:** Unresolved public response contract or unavailable configured service.
- **Verification owner:** `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Read-only, bounded, redacted, project-isolated.
- **Tests:** API schema, auth, filters, empty/error, size, freshness, and fixture tests.
- **Docs:** `docs/develop/api.md` and `docs/reference/mcp-tools.md`.
- **Exclusive writer territory:** Report API route/tool and tests.
- **Phase/counts:** P3; 3 writers / 3 nonwriters; no overlap with inspector UI.
- **Verification plan:** Call valid and invalid fixture requests, compare provenance, and health-check deployed route.
- **Causal remediation rule:** Fix the first route validation or report serialization defect.
- **Finding classification:** Unsafe or nondeterministic API is `BLOCKING`; extra filters are `FOLLOW_UP`; diagnostics are `INFORMATIONAL`.

#### MCP-105 — Existing Tool Manager inspector UI

- **IN_SCOPE:** Add report inspection to the existing Tool Manager without creating a parallel tool-management surface.
- **OUT_OF_SCOPE:** New dashboard shell, catalog redesign, or secret/prompt display.
- **Owner:** Dashboard writer.
- **Dependencies:** MCP-104.
- **Acceptance:** Existing Tool Manager shows report freshness, fixture/live provenance, per-tool outcomes, and empty/error states accurately.
- **STOP_CONDITION:** `PASS` after deployed route and visual gate.
- **Escalation:** Unavailable browser/deployment access or unresolved existing-surface placement choice.
- **Verification owner:** `@ingenium-qa` and `@ingenium-qa-vision`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Preserve existing toggles; no secret/prompt rendering; fail closed on stale report.
- **Tests:** Component/API/Playwright, accessibility, console/network, 1440x900 and 390x844 screenshots.
- **Docs:** `docs/reference/mcp-tools.md` if inspector is documented.
- **Exclusive writer territory:** Existing Tool Manager inspector components and tests.
- **Phase/counts:** P3; 3 writers / 3 nonwriters; no overlap with report API.
- **Verification plan:** Render fixture, live, stale, empty, and error states in the existing manager, then check deployment.
- **Causal remediation rule:** Fix the first API-to-inspector mapping defect, not stale-state cosmetics.
- **Finding classification:** Misleading report or exposed content is `BLOCKING`; shell redesign is `FOLLOW_UP`; layout notes are `INFORMATIONAL`.

#### MCP-106 — Usefulness review

- **IN_SCOPE:** Review MCP report/API/inspector usefulness against current catalog and representative fixture/live tasks and record evidence.
- **OUT_OF_SCOPE:** Implementing new tools, changing scores without evidence, provider credentials, or broad UX review.
- **Owner:** `@ingenium-qa`.
- **Dependencies:** MCP-103, MCP-104, MCP-105.
- **Acceptance:** Review distinguishes useful, reachable, not-run, unknown, and failed; representative outcomes have reproducible evidence and no secrets.
- **STOP_CONDITION:** `PASS` after one bounded review and recorded evidence.
- **Escalation:** Only genuine usefulness definition ambiguity or unavailable required live access.
- **Verification owner:** `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium` for the reviewed deployed build.
- **Rollback/safety:** Read-only review; no catalog mutation; fixture-first and no real credentials.
- **Tests:** Re-run report/API/inspector contract checks and representative fixture matrix.
- **Docs:** Update `docs/reference/mcp-tools.md` only for directly verified behavior.
- **Exclusive writer territory:** Review evidence artifact only; no implementation territory overlap.
- **Phase/counts:** P4; 1 writer / 3 nonwriters; writer slot reserved for evidence, no source overlap.
- **Verification plan:** Review current catalog, run fixtures, inspect deployed inspector, classify evidence, and publish bounded findings.
- **Causal remediation rule:** Any blocker names the observed producer and is fixed only in a later declared contract; do not patch review output.
- **Finding classification:** In-scope acceptance failure is `BLOCKING`; out-of-scope usefulness ideas are `FOLLOW_UP`; evidence context is `INFORMATIONAL`.

#### COORD-100 — Cooperative multi-session guarantee

- **IN_SCOPE:** Define the guarantee for managed agents sharing one project and canonical worktree; enforce project ownership for every task read/mutation; add task revision/CAS, request-hash idempotency, and atomic reserve/release semantics; specify exact relative file/tree/reserved claim grammar for downstream coordination.
- **OUT_OF_SCOPE:** Absolute prevention of manual editor or external-process writes, dashboard UI, transcript sharing, or historical audit.
- **Owner:** `@ingenium-software-engineer-premium`.
- **Dependencies:** MCP-106, TASK-102.
- **Acceptance:** Every task lookup and mutation rejects foreign-project IDs; stale revisions and conflicting reservations fail deterministically; idempotent retries return the original result and reject changed payloads; the same-project/canonical-worktree managed-agent boundary and exact claims (`path`, `tree`, `@build`, `@repository`) are defined with no globs, absolute paths, traversal, `.git/**`, secrets, or ambiguous prefixes; manual/external writes are explicitly not promised.
- **STOP_CONDITION:** `PASS` after task core/API/MCP fixtures and review against COORD-101..106; otherwise continue in scope or permitted escalation.
- **Escalation:** Only genuine guarantee/ownership ambiguity or unavailable required source access.
- **Verification owner:** `@ingenium-qa`.
- **Security owner:** `@ingenium-security-auditor`.
- **Deployment owner:** `@ingenium-software-engineer-premium` for task-boundary route acceptance.
- **Rollback/safety:** Use additive task concurrency state, preserve existing tasks, enforce project isolation, and reject unsafe claim syntax rather than broadening it.
- **Tests:** Core/API/MCP cross-project negatives, stale revision, idempotent replay/hash mismatch, concurrent reservation/release, grammar, and canonical-worktree contract fixtures.
- **Docs:** This roadmap entry only until shipped behavior directly affects canonical operational documentation.
- **Exclusive writer territory:** Task core/API/MCP ownership and concurrency paths, their migration/tests, and coordination contract fixtures; no overlap with existing feature territories.
- **Phase/counts:** C0; 3 writers / 3 nonwriters; fast owns MCP/fixtures, premium owns task core/API boundaries, and docs owns directly affected contracts.
- **Verification plan:** Exercise foreign-project IDs, stale/concurrent updates, replayed requests, and reservations first; then validate each guarantee against COORD-101..106 and reject any promise covering manual or external writes.
- **Causal remediation rule:** Fix the earliest task ownership, revision, idempotency, reservation, or claim-grammar boundary; do not add downstream exceptions.
- **Finding classification:** Cross-project task access, lost updates, duplicate reservations, or a missing guarantee boundary is `BLOCKING`; broader coordination features are `FOLLOW_UP`; clarified terminology is `INFORMATIONAL`.

#### COORD-101 — Coordination registry and core primitives

- **IN_SCOPE:** Add project-scoped coordination storage and core operations for `project_id`, opaque `worktree_id`, `session_id`, incarnation, hashed ownership token, revision/CAS, request-hash idempotency, monotonic fence, heartbeat/TTL, exact file/tree/coarse claims, baseline hashes, dirty/quarantined/collision state, bounded snapshots, and optional `current_task_id`/`context_conversation_id` plus revision.
- **OUT_OF_SCOPE:** UI, plugin event wiring, manual/external write prevention, raw transcript/reasoning storage, and cross-project claims.
- **Owner:** `@ingenium-software-engineer-premium`.
- **Dependencies:** COORD-100.
- **Acceptance:** Register/recover/update/heartbeat/claim/release/close primitives enforce project/worktree/session/incarnation isolation; path-segment overlap is atomic, batch reservation rolls back wholly, no globs are accepted, snapshots are bounded, and `checkpointAfterWrite()` is outside transactions.
- **STOP_CONDITION:** `PASS` after migration/core concurrency and failure fixtures; otherwise continue in scope or permitted escalation.
- **Escalation:** Only migration authorization, unavailable required database access, or unreproducible bounded concurrency failure.
- **Verification owner:** `@ingenium-qa`.
- **Security owner:** `@ingenium-security-auditor`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Additive migration with project isolation, hashed tokens, quarantine on uncertain writes, and retained failure evidence.
- **Tests:** Migration/foreign-key, CAS, idempotency, fence monotonicity, TTL/expiry, path-prefix overlap, atomic batch rollback, hash/state, bounded snapshot, and WAL-lock fixtures.
- **Docs:** This roadmap entry; directly affected database/API references only after implementation ships.
- **Exclusive writer territory:** `packages/ingenium-core` coordination migration/tools/tests; no overlapping core writer.
- **Phase/counts:** C1; 3 writers / 3 nonwriters; fast owns fixtures, premium owns migration/core, docs owns roadmap maintenance.
- **Verification plan:** Run isolated database fixtures for each state transition, concurrent overlap, rollback, expiry, and transaction/checkpoint path once.
- **Causal remediation rule:** Fix the first transaction, identity, or overlap-check root cause at the core boundary and rerun only its failing fixture.
- **Finding classification:** Cross-project access, non-atomic claims, token leakage, or WAL locking is `BLOCKING`; richer state is `FOLLOW_UP`; telemetry is `INFORMATIONAL`.

#### COORD-102 — Coordination API and MCP surface

- **IN_SCOPE:** Expose register/recover/update/heartbeat/snapshot/batch-claim/release/close and authorized-takeover operations with exact HTTP methods, status/error envelopes, idempotency keys/request hashes, expected revisions, and four redacted MCP tools: `ingenium_coordination_status`, `ingenium_coordination_update`, `ingenium_coordination_claim`, and `ingenium_coordination_release`.
- **OUT_OF_SCOPE:** Plugin enforcement, dashboard UI, raw paths/tokens in responses, arbitrary takeover, and cross-project access.
- **Owner:** `@ingenium-software-engineer-premium`.
- **Dependencies:** COORD-101.
- **Acceptance:** Document exact endpoints, methods, validation errors, conflict/expiry/unavailable statuses, CAS/idempotency behavior, authorized takeover evidence, project/worktree isolation, and redaction of paths, ownership tokens, prompts, and credentials.
- **STOP_CONDITION:** `PASS` after API/MCP contract, auth, and idempotency fixtures; otherwise continue in scope or permitted escalation.
- **Escalation:** Only unresolved public HTTP/error/tool contract ambiguity or unavailable configured API access.
- **Verification owner:** `@ingenium-qa`.
- **Security owner:** `@ingenium-security-auditor`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Fail closed on auth, stale revision, unknown project, expired lease, or unavailable API; never return bearer/token material.
- **Tests:** Method/status/error matrix, auth/isolation, CAS, retries, duplicate request hashes, takeover authorization, redaction, and four-tool schema fixtures.
- **Docs:** This roadmap and `docs/develop/api.md`/`docs/reference/mcp-tools.md` only when the shipped public surface is verified.
- **Exclusive writer territory:** `services/ingenium-api` coordination routes and `services/ingenium-server` MCP adapters/tests.
- **Phase/counts:** C2; 3 writers / 3 nonwriters; fast owns MCP adapters, premium owns API, docs owns roadmap only.
- **Verification plan:** Exercise every declared response class with disposable project/worktree/session fixtures, then inspect redaction and isolation once.
- **Causal remediation rule:** Fix the earliest API-to-core identity, status, or serialization mismatch; do not soften client errors.
- **Finding classification:** Unauthorized access, leaked token/path, wrong status, or non-idempotent mutation is `BLOCKING`; optional filters are `FOLLOW_UP`; bounded audit fields are `INFORMATIONAL`.

#### COORD-103 — Session coordinator plugin awareness

- **IN_SCOPE:** Add a V1 `session-coordinator` wrapper using actual OpenCode event shapes under `event.properties`; lazily register, reconcile SDK state at startup, serialize per-session events, maintain a bounded 30-second heartbeat, dispose/expire sessions, and inject status/todos/diff/current-task/context-revision snapshots through `experimental.chat.system.transform` on the next turn. Sanitize peer text against prompt injection and exclude transcripts, reasoning, payloads, and credentials. Include package/config projections and restart requirement; deployment is later.
- **OUT_OF_SCOPE:** Write enforcement, dashboard UI, transcript mirroring, raw prompt sharing, and deployment execution.
- **Owner:** `@ingenium-software-engineer-fast`.
- **Dependencies:** COORD-102.
- **Acceptance:** Lifecycle and transform fixtures use `event.properties`; snapshots are bounded, sanitized, fresh on the next turn, contain only operational peer state, and project to package plus project/global config with an explicit restart requirement.
- **STOP_CONDITION:** `PASS` after extension lifecycle/typecheck/package and fixture checks; otherwise continue in scope or permitted escalation.
- **Escalation:** Only unavailable configured OpenCode SDK/runtime access or genuine event-shape ambiguity after source inspection.
- **Verification owner:** `@ingenium-qa`.
- **Security owner:** `@ingenium-security-auditor`.
- **Deployment owner:** `@ingenium-software-engineer-premium` for a later rebuilt deployment.
- **Rollback/safety:** Hooks remain non-fatal for reads, never inject untrusted peer instructions, and never log sensitive payloads.
- **Tests:** Actual `event.properties`, lazy registration, startup reconciliation, per-session serialization, bounded heartbeat, dispose/expiry, transform freshness, injection sanitization, redaction, config projection, restart, and API failure fixtures.
- **Docs:** This roadmap and directly affected plugin/config references after implementation; no Docs Workspace writes.
- **Exclusive writer territory:** `packages/ingenium-extension` coordinator wrapper/plugin and focused tests.
- **Phase/counts:** C3; 3 writers / 3 nonwriters; fast owns extension, premium owns integration fixtures, docs owns roadmap only.
- **Verification plan:** Run lifecycle and transform fixtures once, verify next-turn freshness and redaction, then confirm restart-required projection without deploying.
- **Causal remediation rule:** Fix the first event-shape, serialization, freshness, or sanitization boundary; never patch rendered prompt text alone.
- **Finding classification:** Sensitive sharing, stale/missing peer state, wrong event shape, or unsafe injection is `BLOCKING`; UI/status embellishment is `FOLLOW_UP`; bounded operational detail is `INFORMATIONAL`.

#### COORD-104 — Managed write enforcement

- **IN_SCOPE:** Enforce claims in `tool.execute.before/after` for exact `edit`, `write`, `apply_patch`, `create`, `delete`, and `rename` paths; atomically acquire claims, validate fence/lease and dirty hashes, record actual post-write footprint, quarantine unexpected writes, fail closed when API is unavailable, and deny mutating Bash to writers except fixed wrappers under `@build`/`@repository` claims.
- **OUT_OF_SCOPE:** Manual VS Code/external writes, read-only Bash, formatter/generator expansion, dashboard UI, and guarantees outside managed OpenCode mutations in an accepted session epoch.
- **Owner:** `@ingenium-software-engineer-premium`.
- **Dependencies:** COORD-103.
- **Acceptance:** Every supported mutation is checked before execution, multi-path patches reserve atomically, overlap/fence/lease/dirty failures prevent writes, after-hooks record actual footprint, unexpected writes quarantine, API outage blocks mutation, and the guarantee is limited to managed OpenCode writes and accepted session epoch.
- **STOP_CONDITION:** `PASS` after extension enforcement and two-session conflict fixtures; otherwise continue in scope or permitted escalation.
- **Escalation:** Only unavailable configured OpenCode hook access or an unreproducible enforcement race after bounded diagnosis.
- **Verification owner:** `@ingenium-qa`.
- **Security owner:** `@ingenium-security-auditor`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Fail closed before mutation, quarantine rather than silently accept drift, and preserve pre/post hashes and fence evidence.
- **Tests:** Each mutation verb, multi-path patch, overlap, stale fence, expired lease, dirty baseline, unexpected footprint, API outage, fixed-wrapper allowlist, and read-only Bash fixtures.
- **Docs:** This roadmap; security/operations wording only when shipped behavior is verified.
- **Exclusive writer territory:** Extension tool hooks, Bash permission wrappers, enforcement adapters, and tests.
- **Phase/counts:** C4; 3 writers / 3 nonwriters; premium owns enforcement, fast owns parsers/fixtures, docs owns roadmap only.
- **Verification plan:** Attempt every in-scope write under owned, peer, stale, expired, dirty, unexpected, and API-down states; prove no mutation before the failing hook returns.
- **Causal remediation rule:** Repair the earliest pre-execution claim/fence decision or post-write footprint observer; never rely on after-the-fact cleanup.
- **Finding classification:** A bypassable managed write, unsafe Bash mutation, or API-outage write is `BLOCKING`; manual/external drift is `FOLLOW_UP` under the stated guarantee; evidence is `INFORMATIONAL`.

#### COORD-105 — Resource-sync and repository serialization

- **IN_SCOPE:** Serialize `@resource-sync`/`@repository` operations as scan → API apply → manifest save; renew and verify fence before saving, serialize concurrent `session.created` across processes, prevent stale manifest deletion, and use coarse claims for repository/git/build mutations.
- **OUT_OF_SCOPE:** Manual/external filesystem control, arbitrary generators/formatters, full Git workflow redesign, dashboard UI, and deployment execution.
- **Owner:** `@ingenium-software-engineer-fast`.
- **Dependencies:** COORD-104.
- **Acceptance:** Concurrent syncs cannot delete newer manifests or save under stale fences; scan/apply/save is ordered and recoverable; repository/git/build mutations require the declared coarse claim and project/worktree isolation.
- **STOP_CONDITION:** `PASS` after multi-process sync, stale-fence, crash, and coarse-claim fixtures; otherwise continue in scope or permitted escalation.
- **Escalation:** Only unavailable process-isolation/runtime access or unreproducible manifest race after bounded diagnosis.
- **Verification owner:** `@ingenium-qa`.
- **Security owner:** `@ingenium-security-auditor`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Never delete a manifest without current fence ownership; retain stale/crash evidence and fail closed on API outage.
- **Tests:** Concurrent `session.created`, scan/apply/save ordering, renewal-before-save, stale deletion prevention, crash/restart recovery, repository/git/build coarse claims, and project isolation.
- **Docs:** This roadmap and resource-sync/repository operational references only after shipped behavior is verified.
- **Exclusive writer territory:** `packages/ingenium-extension/resource-sync.ts`, repository/build wrappers, and focused tests.
- **Phase/counts:** C5; 3 writers / 3 nonwriters; fast owns sync, premium owns process/deployment fixtures, docs owns roadmap only.
- **Verification plan:** Run two process fixtures through concurrent sync and coarse mutations, force stale/crash/API-down states, and inspect manifests, fences, and retained evidence once.
- **Causal remediation rule:** Fix the first scan/apply/save ordering, fence renewal, or stale-delete decision proven by the manifest trace.
- **Finding classification:** Stale deletion, fence bypass, cross-project mutation, or unsafe API-down behavior is `BLOCKING`; broader Git automation is `FOLLOW_UP`; retained evidence is `INFORMATIONAL`.

#### COORD-106 — Multi-window acceptance and rollout

- **IN_SCOPE:** Accept and roll out coordination with three real OpenCode 1.18.9 windows in one project and canonical checkout: independent claimed files may proceed concurrently, overlap is blocked before write, peer task/context state is visible next turn, crash/expiry quarantines dirty state, API outage blocks writes, resource sync is safe, project/config projection and restart are verified, sensitive sharing is absent, and logs/visual evidence are collected if UI changes. Document optional separate-worktree stronger isolation as a future mode, not a V1 requirement.
- **OUT_OF_SCOPE:** Separate-worktree implementation, dashboard UI, transcript/reasoning sharing, manual/external write prevention, real credentials, and acceptance without deployed evidence.
- **Owner:** `@ingenium-software-engineer-premium`.
- **Dependencies:** COORD-105.
- **Acceptance:** All three-window, conflict, peer-freshness, crash/expiry, quarantine, outage, sync, restart/config, redaction, deployment, cleanup, and regression gates pass; separate-worktree mode is future scope and not used to claim V1 success.
- **STOP_CONDITION:** `PASS` only after deployed three-window evidence, targeted QA/security checks, cleanup, and marker reconciliation; otherwise continue in scope or permitted escalation.
- **Escalation:** Only unavailable required OpenCode/deployment access, unauthorized destructive cleanup, genuine product ambiguity, or bounded diagnosis that cannot reproduce a root cause.
- **Verification owner:** `@ingenium-qa`; `@ingenium-qa-vision` only if coordination UI changes.
- **Security owner:** `@ingenium-security-auditor`.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Deploy behind fail-closed gates, preserve dirty/quarantined evidence, clean only owned fixtures, and never use real credentials.
- **Tests:** Three-window OpenCode 1.18.9 acceptance, independent/overlap claims, next-turn peer snapshot, crash/TTL/quarantine, API outage, resource-sync race, isolation, redaction/prompt-injection, restart/config, logs/console, visual checks if UI, and cleanup/health checks.
- **Docs:** This roadmap; update only directly affected canonical operational/security references after verified rollout.
- **Exclusive writer territory:** Deployment/acceptance fixtures, rollout configuration, and coordination evidence; no overlap with implementation source after C5.
- **Phase/counts:** C6; 1 writer / 3 nonwriters for acceptance, with premium deployment, QA acceptance, security review, and explore evidence; serialize remediation in a new declared wave.
- **Verification plan:** Deploy the merged build, run the three-window matrix once, inspect API/plugin logs and console/network, run security redaction checks, clean up, and rerun only the causal targeted check for any fixed blocker.
- **Causal remediation rule:** Name the first failing coordination boundary, remediate only that root cause, redeploy, and rerun the smallest proving acceptance check.
- **Finding classification:** A failed V1 guarantee, sensitive leak, write bypass, unsafe outage path, or unclean deployment is `BLOCKING`; separate-worktree mode and dashboard/audit enhancements are `FOLLOW_UP`; operational traces are `INFORMATIONAL`.

#### UI-100 — Shared native Select primitive

- **IN_SCOPE:** Create one accessible shared native `<select>` primitive for dashboard forms, with the repository's required hover/cursor styling, label/id association, disabled/loading/error states, keyboard behavior, and a testable API; inventory every current native-select consumer for the migration lane.
- **OUT_OF_SCOPE:** Migrating the 52 existing selects, replacing custom menus/comboboxes, changing product choices, redesigning the dashboard shell, or adding a third-party select library.
- **Owner:** `@ingenium-software-engineer-fast`.
- **Dependencies:** DOC-100.
- **Acceptance:** The primitive renders a real native select, exposes an accessible name, preserves native keyboard semantics, has deterministic empty/disabled/error behavior, passes focused component/accessibility tests, and records the exact 52-select inventory for UI-101.
- **STOP_CONDITION:** `PASS` after focused primitive/inventory tests and marker reconciliation; otherwise continue in scope or permitted escalation.
- **Escalation:** Only unavailable required test/deployment access, a genuine product decision about native semantics, or bounded diagnosis that cannot reproduce a root cause.
- **Verification owner:** `@ingenium-qa`.
- **Deployment owner:** `@ingenium-software-engineer-premium` for the dashboard build/runtime smoke.
- **Rollback/safety:** Additive shared primitive only; preserve existing consumers until migration is verified; do not alter unrelated dirty files or use real credentials.
- **Tests:** Primitive unit/component tests, accessible-name and keyboard tests, 52-consumer inventory/static check, dashboard typecheck/build, and `git diff --check`.
- **Docs:** This roadmap only; no other canonical documentation is directly affected by the primitive baseline.
- **Exclusive writer territory:** Shared dashboard Select primitive, its focused tests, and the UI-101 inventory artifact; no overlap with VSCode runtime or route files.
- **Phase/counts:** P5 UI lane start; 3 writers / 3 nonwriters; fast owns primitive, premium owns deployment/runtime smoke, docs owns roadmap only; zero overlapping writer territory.
- **Verification plan:** Implement the smallest primitive, run its focused tests and inventory check once, run dashboard typecheck/build, then inspect the diff and retain failure output; fix only a reproducible in-scope root cause and rerun the affected check.
- **Causal remediation rule:** Fix the earliest primitive contract, labeling, or inventory producer proven by the failing test; do not patch each consumer symptom.
- **Finding classification:** Missing native/accessibility semantics or an incorrect inventory is `BLOCKING`; unrelated UI drift is `FOLLOW_UP`; test or inventory provenance is `INFORMATIONAL`.

#### UI-101 — Native select migration and accessible names

- **IN_SCOPE:** Migrate all 52 inventoried native selects to UI-100, add or correct accessible names and associations, preserve values/validation/form submission, and remove duplicate local native-select styling where migration proves it redundant.
- **OUT_OF_SCOPE:** Custom menu/combobox migration, unrelated form redesign, changing option sets or product behavior, adding visual polish beyond the shared primitive, or touching `/vscode`.
- **Owner:** `@ingenium-software-engineer-fast`.
- **Dependencies:** UI-100.
- **Acceptance:** All 52 identified native selects use UI-100; every select has a programmatic accessible name; existing form behavior and keyboard operation remain intact; focused component/accessibility/static checks pass with no unowned select left behind.
- **STOP_CONDITION:** `PASS` after the 52-select migration checks, dashboard checks, and marker reconciliation; otherwise continue in scope or permitted escalation.
- **Escalation:** Only unavailable required test/deployment access, a genuine product decision about changed form semantics, or bounded diagnosis that cannot reproduce a root cause.
- **Verification owner:** `@ingenium-qa`; `@ingenium-qa-vision` owns the changed-route visual gate.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Preserve each existing option/value/validation contract; revert only UI-101 consumer edits if the shared primitive fails; no broad formatting churn.
- **Tests:** Static count and consumer-ownership check for all 52 selects, focused component/accessibility tests, dashboard typecheck/build, Playwright form/keyboard checks, console/network checks, and 1440x900/390x844 screenshots.
- **Docs:** This roadmap only unless a shipped user-facing form policy is directly changed.
- **Exclusive writer territory:** Dashboard files containing the 52 native selects and their focused tests; no overlap with UI-100 primitive internals after the dependency barrier or VSCode files.
- **Phase/counts:** P5 UI lane; 3 writers / 3 nonwriters; fast owns migration, premium owns deployment, docs owns roadmap only; serialized after UI-100.
- **Verification plan:** Enumerate source consumers, migrate all 52, run static/count and focused tests once, deploy the merged dashboard, inspect changed routes at both viewports and browser console/network, and rerun only the smallest check for any fixed root cause.
- **Causal remediation rule:** Fix the first consumer-to-primitive mapping or accessible-name source proven by DOM and source evidence, not an individual visual symptom.
- **Finding classification:** An unmigrated select, missing accessible name, or broken form/keyboard behavior is `BLOCKING`; unrelated styling drift is `FOLLOW_UP`; layout observations are `INFORMATIONAL`.

#### UI-102 — Custom menu/combobox pattern migration

- **IN_SCOPE:** Define and migrate in-scope custom menu/combobox controls to one accessible pattern with explicit roles/states, focus management, keyboard/typeahead behavior, outside-click handling, disabled/loading/error states, and native-select parity where applicable.
- **OUT_OF_SCOPE:** Replacing controls that are not menu/combobox patterns, adding a component library, changing option semantics, broad dashboard navigation redesign, or VSCode route work.
- **Owner:** `@ingenium-software-engineer-fast`.
- **Dependencies:** UI-101.
- **Acceptance:** Every inventoried custom menu/combobox uses the approved pattern; accessible names, expanded/selected/active states, focus return, Escape/Arrow/Home/End/typeahead behavior, and pointer behavior pass focused and browser checks; no duplicate custom pattern remains in scope.
- **STOP_CONDITION:** `PASS` after focused accessibility/component tests, deployed changed-route checks, visual gates, and marker reconciliation; otherwise continue in scope or permitted escalation.
- **Escalation:** Only unavailable browser/deployment access, a genuine product decision about interaction semantics, or bounded diagnosis that cannot reproduce a root cause.
- **Verification owner:** `@ingenium-qa`; `@ingenium-qa-vision` owns the changed-route and passive desktop/mobile visual gates.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Preserve selected values and server contracts; keep a single reversible migration boundary; do not weaken keyboard/accessibility behavior or alter unrelated controls.
- **Tests:** Pattern unit/component and accessibility tests, keyboard/focus/typeahead/outside-click tests, route Playwright tests, console/network checks, and 1440x900/390x844 screenshots with browser cleanup.
- **Docs:** This roadmap only unless verified shipped interaction policy requires a directly affected canonical guide.
- **Exclusive writer territory:** Dashboard custom menu/combobox components and their focused tests; no overlap with VSCode runtime/route files.
- **Phase/counts:** P5 UI lane; 3 writers / 3 nonwriters; fast owns pattern migration, premium owns deployment, docs owns roadmap only; serialized after UI-101.
- **Verification plan:** Inventory custom controls, migrate one shared pattern boundary, run focused keyboard/accessibility tests once, deploy and inspect changed routes at both viewports, then rerun only the proving check for each reproducible in-scope fix.
- **Causal remediation rule:** Fix the earliest role/state/focus producer proven by the accessibility tree and event trace; do not hide a pattern defect with CSS or click-only fallbacks.
- **Finding classification:** Broken keyboard/focus semantics, inaccessible naming, or incorrect selection is `BLOCKING`; unrelated visual polish is `FOLLOW_UP`; compatible browser variance is `INFORMATIONAL`.

#### CHAT-101 — Explicit Context project with separate global authority

- **IN_SCOPE:** Add an explicit, selectable Context project control on `/chat`, persist and display the selected Context project for the request/session, and keep global tools authority separate and clearly identified from project-scoped Context retrieval and mutations.
- **OUT_OF_SCOPE:** Always-on grounding, changing global tool authorization, cross-project data sharing, transcript export, provider redesign, Docs Workspace mutation, or unrelated Chat redesign.
- **Owner:** `@ingenium-software-engineer-fast`.
- **Dependencies:** UI-102, CHAT-100, CTX-101.
- **Acceptance:** `/chat` offers an accessible explicit project selector; selected Context project is visible, selectable, request-bound, and isolated; global tools remain under their independent authority and are not silently redirected to the Context project; defaults and no-selection behavior are safe and documented in the UI; fixture/API/UI checks pass.
- **STOP_CONDITION:** `PASS` after fixture-first API/UI tests, deployed Chat checks, visual/accessibility gates, and marker reconciliation; otherwise continue in scope or permitted escalation.
- **Escalation:** Only unavailable configured Chat/deployment access, a genuine product decision about project-selection defaults, or bounded diagnosis that cannot reproduce a root cause.
- **Verification owner:** `@ingenium-qa`; `@ingenium-qa-vision` owns Chat visual/accessibility checks; `@ingenium-security-auditor` verifies project/global authority separation.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Context remains explicit and project-scoped; global tools retain current authority; fail closed on missing/foreign projects; never expose hidden source content or secrets.
- **Tests:** Component/API project-selection, request-attestation and foreign-project rejection, global-tool-authority separation, no-selection/refresh/reload, accessibility, keyboard, console/network, 1440x900/390x844 visual, and fixture E2E tests.
- **Docs:** This roadmap only unless the verified shipped Context project workflow directly changes `docs/usage/chat.md` or architecture wording.
- **Exclusive writer territory:** `/chat` project-selector components, Chat request/session adapters, and focused tests; no overlap with VSCode or shared Select files after prior barriers.
- **Phase/counts:** P5 Chat continuation; 3 writers / 3 nonwriters; fast owns Chat implementation, premium owns deployment, docs owns roadmap only; starts after UI-102.
- **Verification plan:** Select a disposable Context project, send fixture requests with and without selection, inspect network/request authority and rendered state, reject foreign/global confusion, run visual/security checks once, and rerun only the causal targeted check after an in-scope fix.
- **Causal remediation rule:** Fix the first project-identity or authority-routing mismatch proven by request trace and API response; never compensate with client-only labels.
- **Finding classification:** Cross-project access, silent authority mixing, or unusable selection is `BLOCKING`; unrelated Chat polish is `FOLLOW_UP`; provenance and telemetry are `INFORMATIONAL`.

#### VSCODE-100 — Pinned code-server runtime and gateway foundation

- **IN_SCOPE:** Add the pinned code-server 4.131.0 amd64 runtime with SHA-256 `f6316f0b14ef5c12ed6e67e0154dd02ccf5e66112064687d7e93c51763105361`, same Ingenium container/appuser, private code-server `127.0.0.1:4100` listener, Nginx container listener `3002`, public iframe/gateway origin `http://vscode.localhost:3002`, loopback-only Compose host publication `127.0.0.1:3002:3002`, and keep dashboard/OpenCode on port `3000`; also provide `/workspace` mount, auth-none local profile matching OpenCode Web, Open VSX/user-managed extensions, full terminal, dedicated `vscode-data` volume, status/health foundation, and explicit administrator-grade/no-LAN trust caveat.
- **OUT_OF_SCOPE:** `/vscode` dashboard route/iframe implementation, remote/LAN exposure, multi-user authorization, extension marketplace proxying, arbitrary code-server versions, or changing OpenCode gateway behavior.
- **Owner:** `@ingenium-software-engineer-premium`.
- **Dependencies:** DOC-100.
- **Acceptance:** Build/runtime provenance verifies the exact version/architecture/hash; code-server runs as appuser in the existing Ingenium container; code-server is bound only to private `127.0.0.1:4100`; Nginx listens on container port `3002`; Compose publishes exactly `127.0.0.1:3002:3002` and never a LAN-facing `3002`; the trusted public iframe/gateway origin is exactly `http://vscode.localhost:3002`, while dashboard/OpenCode remain on `3000`; `/workspace` resolves; `vscode-data` persists; status/health reports process and gateway state; local auth-none/full-terminal/Open VSX behavior and administrator-grade/no-LAN caveat are explicit; WebSocket upgrades accept the exact trusted `Origin: http://vscode.localhost:3002` and reject hostile or missing `Origin`; no credentials are used in default gates.
- **STOP_CONDITION:** `PASS` after provenance, Docker/gateway/status, persistence, health, and security checks plus marker reconciliation; otherwise continue in scope or permitted escalation.
- **Escalation:** Only unavailable required image/network/deployment access, unauthorized destructive volume cleanup, a genuine trust/auth product decision, or bounded diagnosis that cannot reproduce a root cause.
- **Verification owner:** `@ingenium-qa`; `@ingenium-security-auditor` owns boundary/provenance review.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Pin and verify before execution; bind loopback only; preserve existing OpenCode and volumes; stop/remove only owned fixtures; rollback removes the VSCode runtime/gateway additions without deleting `vscode-data` unless explicitly authorized.
- **Tests:** SHA/architecture/provenance checks, container/appuser/process checks, private `127.0.0.1:4100` bind and no-LAN probes, exact Compose publication check for `127.0.0.1:3002:3002`, Nginx container-listener check for `3002`, dashboard/OpenCode `3000` regression check, exact `http://vscode.localhost:3002` gateway/CSP/header checks, WebSocket checks accepting only the exact trusted `Origin` and rejecting hostile and missing `Origin`, `/workspace` and `vscode-data` persistence, status/health, terminal/Open VSX fixture checks, no-real-credential security checks, and cleanup.
- **Docs:** This roadmap only until runtime behavior is shipped and source-verified; then only directly affected canonical operations/security references.
- **Exclusive writer territory:** Docker/runtime scripts, Supervisor/service status, gateway configuration, and VSCode volume/runtime tests; no overlap with dashboard route files.
- **Phase/counts:** P5 VSCode lane start; 3 writers / 3 nonwriters; premium owns runtime/deployment, fast owns dashboard implementation territory reserved for VSCODE-101, docs owns roadmap only; zero overlap.
- **Verification plan:** Build the pinned image, inspect hash/user/listeners/mounts, start the owned deployment, exercise root/health/status/persistence/security fixtures once, preserve logs, and fix/rerun only the named causal check for reproducible in-scope failures.
- **Causal remediation rule:** Fix the first provenance, bind, process-user, gateway, volume, or health producer proven by deployment evidence; never mask a private-boundary failure in the dashboard.
- **Finding classification:** Wrong/unpinned artifact, LAN exposure, unsafe auth, data loss, or false health is `BLOCKING`; nonrequired extension integrations are `FOLLOW_UP`; deployment telemetry is `INFORMATIONAL`.

#### VSCODE-101 — `/vscode` route, iframe, CSP, navigation, and standalone mode

- **IN_SCOPE:** Add the `/vscode` dashboard route and navigation entry, trusted separate-origin unsandboxed iframe to the exact public `http://vscode.localhost:3000/` root, minimal clipboard permission, CSP/frame policy, loading/error/unavailable states, and standalone/new-tab fallback; retain dashboard/OpenCode on the established `3000` virtual-host gateway.
- **OUT_OF_SCOPE:** Runtime installation/gateway foundation, code-server feature customization, remote/LAN access, sandboxing the trusted separate-origin iframe, arbitrary permissions, or unrelated navigation redesign.
- **Owner:** `@ingenium-software-engineer-fast`.
- **Dependencies:** VSCODE-100, UI-102.
- **Acceptance:** `/vscode` is reachable from navigation and direct URL; iframe targets exactly `http://vscode.localhost:3000/`, is unsandboxed only because it is trusted separate-origin, requests only minimal clipboard permission, CSP/frame headers and WebSocket trusted `Origin` are exact, hostile and missing WebSocket `Origin` requests are rejected, loading/error/unavailable states are explicit, standalone/new-tab fallback works, dashboard/OpenCode remain on the established `3000` virtual-host gateway, and existing routes remain healthy.
- **STOP_CONDITION:** `PASS` after deployed route, iframe/CSP/navigation, accessibility, console/network, visual, and marker checks; otherwise continue in scope or permitted escalation.
- **Escalation:** Only unavailable configured browser/deployment access, a genuine origin/trust product decision, or bounded diagnosis that cannot reproduce a root cause.
- **Verification owner:** `@ingenium-qa`; `@ingenium-qa-vision` owns changed-route and passive desktop/mobile visual gates; `@ingenium-security-auditor` owns CSP/permission review.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Keep OpenCode roots unchanged; allow only the dedicated expected origin and minimal clipboard permission; fail closed when origin/runtime is unavailable; remove only route/navigation/iframe changes on rollback.
- **Tests:** Route/navigation and standalone component tests, exact `http://vscode.localhost:3000/` iframe-origin/CSP/permissions/header tests, WebSocket exact-trusted-Origin acceptance plus hostile/missing-Origin rejection, dashboard/OpenCode `3000` regression, loading/error/unavailable states, accessibility/keyboard, console/network, deployed health, 1440x900/390x844 screenshots, and browser cleanup.
- **Docs:** This roadmap only unless the verified route requires a directly affected canonical usage/operations reference.
- **Exclusive writer territory:** Dashboard `/vscode` route, navigation entry, iframe/status components, and focused tests; no overlap with runtime/gateway files or `/chat` after dependency barriers.
- **Phase/counts:** P5 VSCode lane; 3 writers / 3 nonwriters; fast owns route, premium owns deployment, docs owns roadmap only; serialized after VSCODE-100.
- **Verification plan:** Deploy the foundation, open `/vscode` direct and through navigation, inspect iframe origin/CSP/permissions and all failure states, run accessibility/console/network and both viewport visual checks once, then rerun only the smallest check proving each causal fix.
- **Causal remediation rule:** Fix the earliest URL/origin/CSP/navigation state producer proven by browser and network evidence; do not hide a gateway failure with a permanent fallback.
- **Finding classification:** Wrong origin, unsafe permission/CSP, broken route, or misleading runtime state is `BLOCKING`; unrelated navigation polish is `FOLLOW_UP`; browser compatibility notes are `INFORMATIONAL`.

#### VSCODE-102 — VSCode deployment, persistence, security, and acceptance

- **IN_SCOPE:** Prove the merged VSCode runtime and `/vscode` route in deployment with the exact public iframe/gateway origin `http://vscode.localhost:3000/` on the established port-`3000` virtual-host gateway, private code-server `127.0.0.1:4100`, dashboard/OpenCode on `3000`, persistence, security, administrator-grade/no-LAN trust caveat, E2E, visual, accessibility, console/network, cleanup, and rollback acceptance; assign and execute premium deployment/runtime ownership with fast dashboard implementation, QA, security, vision, and docs gates as declared.
- **OUT_OF_SCOPE:** New VSCode features, remote/LAN enablement, multi-user auth, extension curation, unrelated dashboard routes, Docs Workspace mutation, real credentials, or changing prior task contracts.
- **Owner:** `@ingenium-software-engineer-premium`.
- **Dependencies:** VSCODE-101.
- **Acceptance:** A rebuilt current source passes exact code-server provenance, same-container/appuser, private code-server `127.0.0.1:4100`, established port-`3000` virtual-host gateway, no host `3002` or public `4100` exposure, exact public origin `http://vscode.localhost:3000/`, dashboard/OpenCode `3000` preservation, private-loopback/no-LAN, dedicated-root/CSP/permission, exact trusted WebSocket `Origin` acceptance with hostile/missing `Origin` rejection, `/workspace`, `vscode-data` restart persistence, auth-none local profile, full-terminal/Open VSX, status/health, security redaction, E2E, accessibility, 1440x900/390x844 visual, cleanup, and rollback checks; the administrator-grade/no-LAN caveat is visible and not weakened.
- **STOP_CONDITION:** `PASS` only after deployed E2E/visual/security evidence and marker reconciliation; otherwise continue in scope or permitted escalation.
- **Escalation:** Only unavailable required deployment/browser access, unauthorized destructive cleanup, a genuine trust/auth product decision, or bounded diagnosis that cannot reproduce a root cause.
- **Verification owner:** `@ingenium-qa` owns one declared E2E acceptance pass; `@ingenium-security-auditor` owns one bounded security pass; `@ingenium-qa-vision` owns one changed-route visual gate and one passive desktop/mobile sweep.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Rebuild/restart only the current merged source, preserve `vscode-data` and retained failure evidence, clean only manifest-owned resources, never expose LAN or real credentials, and rollback the VSCode wave without touching OpenCode or unrelated dirty changes.
- **Tests:** Exact artifact/provenance, Docker/Supervisor/appuser, private `127.0.0.1:4100`, established port-`3000` virtual-host gateway, no host `3002` or public `4100` exposure, exact `http://vscode.localhost:3000/` route/iframe/gateway/CSP/headers, dashboard/OpenCode `3000` regression, WebSocket exact-trusted-Origin acceptance plus hostile/missing-Origin rejection, route/standalone, persistence/restart, health/status, terminal/Open VSX, security/no-LAN/redaction, fixture E2E, accessibility, console/network, 1440x900/390x844 screenshots, strict containment, cleanup, and targeted rollback checks.
- **Docs:** This roadmap only until acceptance proves a directly affected canonical operational/security document; no Docs Workspace writes or broad regeneration.
- **Exclusive writer territory:** VSCode deployment fixtures, acceptance configuration, rollback evidence, and release evidence; no overlap with implementation source after VSCODE-101.
- **Phase/counts:** P5 VSCode acceptance; 1 writer / 3 nonwriters; premium deployment, QA E2E, security review, and QA vision visual gate; fast/docs territories closed for this acceptance wave.
- **Verification plan:** Rebuild and restart the merged source, run each declared gate once in dependency order, inspect runtime/browser evidence and cleanup, remediate only reproducible in-scope roots, then rerun the minimum proving regression and reconcile markers.
- **Causal remediation rule:** Name the first failing runtime, security, route, persistence, or acceptance boundary; fix that root cause only, redeploy, and rerun its smallest proving check rather than broad retries.
- **Finding classification:** Failed deployment acceptance, LAN exposure, unsafe CSP/permission, persistence loss, secret leak, or unclean teardown is `BLOCKING`; feature enhancements are `FOLLOW_UP`; retained logs/screenshots are `INFORMATIONAL`.

#### REL-100 — Full acceptance

- **IN_SCOPE:** Run the declared roadmap acceptance across contracts, barriers, safety defaults, deployment, accessibility, links, markers, and repository diff.
- **OUT_OF_SCOPE:** New feature work, unrelated cleanup, Docs Workspace writes, and real credentials in default gates.
- **Owner:** Release/QA owner.
- **Dependencies:** MCP-106, JOB-102, USAGE-102, VAULT-102, RESTORE-102, CTX-101, TASK-102, COORD-106, UI-102, CHAT-101, VSCODE-102.
- **Acceptance:** All scoped contracts pass with evidence; no active markers; clean targeted diff; safe defaults and operator boundaries remain true.
- **STOP_CONDITION:** `PASS` only after full evidence and reconciliation; explicit user `STOP`/`CANCELLED` remains terminal.
- **Escalation:** Only the permitted five escalation conditions after bounded diagnosis.
- **Verification owner:** `@ingenium-qa`, with security and visual owners for their declared gates.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Preserve source data, credentials, and unrelated dirty changes; revert only task-owned release wave.
- **Tests:** Targeted contract suites, deployed health/routes, fixture-first gates, visual/accessibility, links, marker parser, and diff check.
- **Docs:** Verify all directly affected canonical docs; no broad regeneration.
- **Exclusive writer territory:** Release evidence and no source overlap.
- **Phase/counts:** P5; 1 writer / 3 nonwriters; barrier after all implementation waves.
- **Verification plan:** Execute checks once in dependency order, remediate reproducible in-scope roots, rerun only affected checks, reconcile markers/TodoWrite.
- **Causal remediation rule:** Every fix names the current reproducible root cause and proves it with the minimum targeted regression.
- **Finding classification:** Failed acceptance is `BLOCKING`; unrelated drift is `FOLLOW_UP`; evidence context is `INFORMATIONAL`.

#### DOC-101 — Final documentation

- **IN_SCOPE:** Update only directly affected canonical repository Markdown with verified behavior, commands, links, safety defaults, and operator workflows.
- **OUT_OF_SCOPE:** Docs Workspace mutation, broad index regeneration, speculative docs, and unrelated cleanup.
- **Owner:** `@ingenium-docs`.
- **Dependencies:** REL-100.
- **Acceptance:** Canonical docs match shipped behavior; links/commands/policy wording pass targeted checks; archive remains immutable and indexed.
- **STOP_CONDITION:** `PASS` after targeted docs verification and final marker reconciliation.
- **Escalation:** Only an unverified source behavior, unavailable check dependency, or genuine documentation ambiguity.
- **Verification owner:** `@ingenium-qa` for the declared docs checks.
- **Deployment owner:** N/A; documentation-only unless a runtime route is being verified by REL-100.
- **Rollback/safety:** Change only named directly affected docs; preserve archive bytes and unrelated dirty changes.
- **Tests:** Markdown structure, links, commands, archive hash/cmp, and `git diff --check`.
- **Docs:** Only the directly affected canonical files identified by REL-100; never Docs Workspace.
- **Exclusive writer territory:** Named `docs/**/*.md` files only; no overlap with implementation writers.
- **Phase/counts:** P6; 1 writer / 0 nonwriters; final documentation barrier.
- **Verification plan:** Read source-verified behavior, patch targeted sections, run affected checks once, and verify no unrelated docs changed.
- **Causal remediation rule:** Fix the named documentation root cause and rerun only its affected check; do not paper over source defects.
- **Finding classification:** Incorrect in-scope canonical content is `BLOCKING`; unrelated drift is `FOLLOW_UP`; context is `INFORMATIONAL`.

## Live marker log

The baseline is intentionally empty. The orchestrator appends exact markers only
after DOC-100 baseline tests pass; TodoWrite remains the live checklist.
### Work marker log
<!-- (work-started) DOC-100 2026-07-31T13:49:23Z ingenium-docs -->
<!-- (work-complete) DOC-100 2026-07-31T13:57:33Z ingenium-docs -->
Evidence DOC-100: archived byte/hash preservation verified; 28 canonical contracts verified; dynamic marker parser verified; agent-policy validation verified; append-only checks verified; archive checksum verified.
<!-- (work-started) MCP-100 2026-07-31T13:59:06Z ingenium-docs -->
<!-- (work-complete) MCP-100 2026-07-31T14:32:16Z ingenium-docs -->
Evidence MCP-100: catalog defaults and unknown-state fail-closed behavior verified; project-isolated atomic/idempotent API state verified; immediate invocation and extension execution gates verified; Tool Manager project mismatch and safe error states verified; focused core/API/server/extension/dashboard suites and typechecks passed; deployed real transport changed from 266 visible tools to 265 while `health_check` was disabled, returned `TOOL_DISABLED` on direct invocation, restored visibility and invocation after re-enable, and retained six healthy supervised processes.
<!-- (work-started) MCP-101 2026-07-31T14:32:57Z ingenium-docs -->
<!-- (work-complete) MCP-101 2026-07-31T14:58:12Z ingenium-docs -->
Evidence MCP-101: pure read-only conformance fixtures detect malformed, duplicate, missing, stale, category, projection, explicit-state, and toggle faults; the current source-derived inventory passes at 266 server plus 2 extension tools; TypeScript AST registration parity and exact extension-plugin contracts pass; targeted core/server/extension suites and typechecks pass; the test-only extension artifact is excluded from package output; no runtime deployment is applicable.
<!-- (work-started) MCP-102 2026-07-31T14:58:21Z ingenium-docs -->
<!-- (work-started) BUG-100 2026-07-31T15:24:18Z ingenium-docs -->
<!-- (work-complete) BUG-100 2026-07-31T16:01:53Z ingenium-docs -->
Evidence BUG-100: observer and resource-sync protocol-stream diagnostics were replaced with bounded non-fatal OpenCode app logging; all three configured Ingenium V1 wrappers now have API/auth/timeout/logger-failure lifecycle coverage; 56 targeted and 118 full extension tests, typecheck, package build, and 266-tool transport parity passed; deployed OpenCode 1.18.9 failure smoke produced zero stdout/stderr, contained logger rejection, emitted only allowlisted warnings, showed zero leaked legacy JSON events in post-restart logs, and retained six healthy services.
<!-- (work-complete) MCP-102 2026-07-31T16:51:44Z ingenium-docs -->
Evidence MCP-102: pre-handshake authoritative reconciliation, exact project-name/immutable-ID attestation, retained-call gating, child state envelopes, and one-change notifications passed focused server/API checks; Chat refresh/freshness/global ownership and bounded exact-code recovery passed 44 component tests; provider-free live transport proved 266 visible tools, disabled-tool removal plus `TOOL_DISABLED`, reconnect behavior, and re-enable restoration; deployed OpenCode 1.18.9 and six services remained healthy; desktop/mobile drawer evidence, 200 MCP requests, zero console errors, and browser cleanup are recorded under `tests/artifacts/visual-qa/run-20260731-mcp102/`.
<!-- (work-started) MCP-103 2026-07-31T16:52:08Z ingenium-docs -->
<!-- (work-complete) MCP-103 2026-07-31T18:03:21Z ingenium-docs -->
Evidence MCP-103: pure core conformance/usefulness engines emit deterministic score-free fixture/live reports with global catalog/freshness and per-tool boundary/visibility/invocation states; full 268-tool output is 46,598 bytes within the 64 KiB bound; malformed results map to `invalid-response`; nine collector, fifteen core contract, 716 full core, typecheck, redaction, path/mode, configured health-only invocation, and owned-process cleanup checks passed; configured live evidence is stored at `tests/artifacts/test-runs/run-20260731-mcp103-live/mcp-usefulness-report.json`; no runtime route exists, so deployment is not applicable until MCP-104.
<!-- (work-started) MCP-104 2026-07-31T18:03:28Z ingenium-docs -->
<!-- (work-complete) MCP-104 2026-07-31T19:18:35Z ingenium-docs -->
Evidence MCP-104: core evidence mapping and the `ingenium_mcp_report_get` catalog contract pass at 269 tools; the API uses a fixed packaged launcher, matching protected worktree token, exact probe mode, per-project UUID single-flight/cache, two-process cap, health-only invocation, fixed filters/errors, and 64 KiB response bound; focused core/API/server/extension suites and typechecks passed; deployed live report returned 269 enriched tools in 56,713 bytes with project attestation, fresh health success, isolated toggle enrichment, route/tool parity, no sensitive content, no child/vault/probe orphan, and six healthy services.
<!-- (work-started) MCP-105 2026-07-31T19:18:44Z ingenium-docs -->
<!-- (work-complete) MCP-105 2026-07-31T19:49:09Z ingenium-docs -->
Evidence MCP-105: existing Tool Manager now renders the project-authoritative live report with provenance, freshness, catalog, current toggle, visibility, invocation, extension-boundary, loading/empty/error/retry states and no raw content; 540 dashboard tests, focused QA/security, typecheck/build/lint passed; deployed report and route returned 200 with 269 tools and toggles restored; desktop/mobile evidence shows Live/Fresh, zero console errors and no viewport overflow under `tests/artifacts/visual-qa/run-20260731-mcp105/`.
<!-- (work-started) MCP-106 2026-07-31T19:49:09Z ingenium-docs -->
<!-- (work-complete) MCP-106 2026-07-31T20:30:17Z ingenium-docs -->
Evidence MCP-106: bounded review verified the 269-tool catalog, live project-attested report API, gated MCP report tool, deployed Tool Manager inspector, health success, reachable/not-run unsafe tools, extension not-applicable states, disabled `TOOL_DISABLED` fixtures, honest unknown conformance, redaction, and desktop/mobile evidence; focused core/API/server/dashboard suites passed after stale generated catalog artifacts were removed, restoring reproducible 269-tool parity.
<!-- (work-started) CTX-100 2026-07-31T20:30:36Z ingenium-docs -->
<!-- (work-complete) CTX-100 2026-07-31T21:32:39Z ingenium-docs -->
Evidence CTX-100: implemented bounded project-scoped direct/chunked context source create/list/get/search with metadata-only DTOs, preserved provenance/tags/priority/safe metadata/source references, path and credential rejection, finite pagination, immutable source/chunk guards, and fail-closed migration-071 inspection. Focused core/API tests and typechecks, the full 726-test core suite, bounded QA/security checks, canonical docs, Docker rebuild, six-process health, live migration inspection, bearer enforcement, isolated create/list/get/search, 404 isolation, 422 boundary rejection, and no-body/path/secret response checks passed.
<!-- (work-started) CHAT-100 2026-07-31T21:32:39Z ingenium-docs -->
<!-- (work-complete) CHAT-100 2026-07-31T22:56:07Z ingenium-docs -->
Evidence CHAT-100: added an accessible per-send project-context control defaulting off, explicit selected-project retrieval, bounded/deduplicated excerpts inside injection-resistant untrusted delimiters, preserved system instructions and retry metadata, metadata-only use/no-match disclosure, fixed send acceptance semantics, and safe fixed search errors. Focused dashboard/API/core tests, typecheck, lint, build, provider-independent fixture E2E, strict containment, bounded QA/security, canonical docs, Docker rebuild and six-process health passed. Non-sensitive visual evidence at 1440x900 and 390x844 plus a 20-route desktop/mobile sweep passed under `tests/artifacts/visual-qa/run-20260731-chat100/`; no real provider send was required.
<!-- (work-started) CTX-101 2026-07-31T22:56:07Z ingenium-docs -->
<!-- (work-complete) CTX-101 2026-08-01T00:10:00Z ingenium-docs -->
Evidence CTX-101: reused immutable persisted chunk UUIDs as citation IDs, added availability/source-hash/chunk-index evidence, total ordering across all RAG searches and fallback terms, stable generic-RAG 409 mutation conflicts, and exact metadata-only Chat rendering. Repeated current/checkpoint/tie/limit/isolation tests, core/API/dashboard type and build checks, fixture E2E, bounded QA/security, canonical docs, Docker rebuild, live persisted-ID/repeatability/foreign/mutation acceptance, and citation screenshots at both viewports passed. The reconciled 20-route desktop/mobile sweep, `/opencode` fixture-health regression, and strict containment passed under `tests/artifacts/visual-qa/run-20260731-ctx101/`.
<!-- (work-started) TASK-100 2026-08-01T00:10:00Z ingenium-docs -->
<!-- (work-complete) TASK-100 2026-08-01T01:27:14Z ingenium-docs -->
Evidence TASK-100: added fail-closed migration 072 and a dedicated immutable metadata-only reference contract for email, context, docs, chat, and jobs with canonical identities, server-derived safe display snapshots, scoped idempotent create/list/delete, current availability, neutral missing/foreign errors, usage-mapped OpenCode authorization, and fixed path-segment handling. Focused core/API and 731-test core suites, typechecks, bounded QA/security, canonical API/task docs, Docker rebuild, six-process health, migration/FK checks, live Context/Docs/Job attach/list/duplicate/delete/isolation workflow, fixture-backed Email/Chat policies, and deployed non-redirecting dot-path probes passed.
<!-- (work-started) TASK-101 2026-08-01T01:27:14Z ingenium-docs -->
<!-- (work-complete) TASK-101 2026-08-01T03:37:24Z ingenium-docs -->
Evidence TASK-101: added strict atomic email/context capture into one todo task plus immutable reference, deterministic duplicate reuse, no-orphan failures, global email authority with unchanged loaded folder, project-scoped Context source summaries, shared title-only modal, explicit Mail/Context actions, and responsive mobile Mail list/reader navigation. Focused core/API/dashboard tests and typechecks, bounded QA/security, Docker rebuild and health, disposable Context API workflow, fully mocked Mail browser workflow, canonical usage docs, sanitized desktop/mobile changed-route evidence, content-free 20-route sweep, and strict containment passed under `tests/artifacts/visual-qa/run-20260801-task101/`.
<!-- (work-started) TASK-102 2026-08-01T03:37:24Z ingenium-docs -->
<!-- (work-complete) TASK-102 2026-08-01T05:53:52Z ingenium-docs -->
Evidence TASK-102: extended strict atomic capture to Docs and server-verified Chat sessions, retained fixed transcript-free Chat metadata, added explicit accessible Chat/Docs controls, duplicate/no-orphan semantics, and reload-visible Task Detail provenance with available/missing/unavailable states. Focused core/API/dashboard tests and typechecks, bounded QA/security, combined production fixture UI→API capture with no provider send/content leakage, Overlay focus-trap/restoration regressions, responsive Task Detail, Docker rebuild/health, live disposable Docs lifecycle, canonical docs, 13 sanitized element captures, content-free 20-route desktop/mobile sweep, and strict containment passed under `tests/artifacts/visual-qa/run-20260801-task102/`.
<!-- (work-started) COORD-100 2026-08-01T05:53:52Z ingenium-docs -->
<!-- (work-complete) COORD-100 2026-08-01T07:42:45Z ingenium-docs -->
Evidence COORD-100: additive migration 073 and transactional migration 074 added partial-state guards and quarantined legacy reservations that cannot prove token possession; project-scoped task reads/mutations now provide revision/CAS, request-hash idempotency, hashed caller-held reservation tokens, and reserve/release. Typed `path`/`tree`/`@build`/`@repository` claims define the managed-agent same-project/canonical-worktree boundary, excluding manual and external writes. Focused Core 10/10, API 4/4, server adapter/registration 5/5, catalog 6/6, relevant typechecks, bounded QA/security PASS with history scan 0, canonical docs, Docker rebuild, six Supervisor processes, API/gateway health, applied migrations, deployed 269-stdio/271-total catalog, health tool, and scoped reserve/GET-404 smoke passed. No visual gate applied because no UI changed.
<!-- (work-started) COORD-101 2026-08-01T07:44:01Z ingenium-docs -->
<!-- (work-complete) COORD-101 2026-08-01T08:57:05Z ingenium-docs -->
Evidence COORD-101: migration 075 provides a four-table guarded coordination registry with project/worktree/session/incarnation isolation, hash-only caller-held tokens, CAS revisions, request-hash idempotency, durable monotonic fences, TTL heartbeats without resurrection, atomic exact claims with baselines and active/released/dirty/quarantined/collision states, bounded credential-free snapshots, project-composite task/context pointers, retained close history, and WAL-safe post-transaction checkpoints. Focused 44-test initial matrix, hardened coordination 20/20, full Core 766 pass, and typecheck passed; QA PASS; security blockers were remediated and targeted security PASS with history scan 0. Canonical docs, Docker rebuild, six processes, health, migration, live tables/indexes/trigger/FKs, foreign_key_check, temporary lifecycle, and no-token-log checks passed. Synthesis was triggered; 10 skills remained unchanged. No visual gate applied because this was Core-only.
<!-- (work-started) COORD-102 2026-08-01T10:27:39Z ingenium-docs -->
<!-- (work-complete) COORD-102 2026-08-01T11:23:59Z ingenium-docs -->
Evidence COORD-102: `tests/artifacts/test-runs/run-20260801-coord102/manifest.json` records the nine authenticated project-scoped coordination routes, API-authorized takeover evidence, redacted status and error projections, and four MCP tools with the 275 total / 273 stdio / 29 category catalog counts. Focused tests, typechecks, and the full suite passed aside from a known unrelated API failure; remediated QA/security checks passed with history scan 0, no-db-leaks passed, canonical docs passed, Docker rebuild with six processes and health checks passed, live route/tool smokes passed, synthesis and sync completed, and no visual gate was applicable.
<!-- (work-started) UI-100 2026-08-01T18:34:27Z ingenium-docs -->
<!-- (work-started) VSCODE-100 2026-08-01T18:34:27Z ingenium-docs -->
<!-- (work-complete) UI-100 2026-08-01T19:02:01Z ingenium-docs -->
Evidence UI-100: shared native Select source; 9/9 tests; exact 52 inventory; dashboard typecheck/build; QA targeted PASS; no changed runtime surface because no consumer migrated, so visual/deployment gates apply at UI-101.
<!-- (work-started) UI-101 2026-08-01T19:02:01Z ingenium-docs -->
<!-- (work-complete) UI-101 2026-08-01T21:07:06Z ingenium-docs -->
Evidence UI-101: 52 shared Selects across 19 files; accessible names; 589 tests/source checks; QA PASS; typecheck/build/lint; deployed seven-process smoke; visual/full-site evidence under `tests/artifacts/visual-qa/run-20260801-ui101-selects/`; Docs mobile remediation and final PASS.
<!-- (work-complete) VSCODE-100 2026-08-01T21:07:06Z ingenium-docs -->
Evidence VSCODE-100: pinned code-server 4.131.0/hash, choice-A `127.0.0.1:3002`→container `3002`→private `4100`, hostile Origin rejection, QA/security PASS, seven-process deployment, code-server CSP/WS/health/appuser/OpenVSX/`vscode-data` persistence evidence under `tests/artifacts/test-runs/run-20260801-ui101-vscode100/`.
<!-- (work-started) UI-102 2026-08-01T21:07:06Z ingenium-docs -->
<!-- (work-complete) UI-102 2026-08-01T22:36:38Z ingenium-docs -->
Evidence UI-102: shared Dropdown/Combobox patterns; all 10 controls; 601 tests/source checks; QA remediation; deployed seven-process evidence under `tests/artifacts/test-runs/run-20260801-ui102-dropdowns/`; passive/full-site visual evidence and active interaction PASS under `tests/artifacts/visual-qa/run-20260801-ui102-dropdowns/`; mobile PageTree fix/recheck.
<!-- (work-started) CHAT-101 2026-08-01T22:36:38Z ingenium-docs -->
<!-- (work-complete) CHAT-101 2026-08-02T00:44:13Z ingenium-docs -->
Evidence CHAT-101: `/chat` Context project selector, explicit `?project=` and
validated active-project resolution, fail-closed invalid/stored selection with
user recovery, request-bound default-off composer Context, API-time archived
race rejection, separate server-global Chat tools/config authority, encoded
queries, and source-content log exclusion documented in `docs/usage/chat.md`
and `docs/develop/api.md`; focused dashboard33/API61 reviewer pass, security
targeted8 plus encoding check, deployed seven-process/routes/code-server
regression, and the Chat visual artifact
`tests/artifacts/visual-qa/run-20260801-chat101/interaction.json`; deploy
acceptance is recorded in
`tests/artifacts/test-runs/run-20260801-chat101-deploy/acceptance.md`.
<!-- (work-started) VSCODE-101 2026-08-02T00:54:31Z ingenium-docs -->

**User-decision marker — superseding active VSCODE-101 (2026-08-01):** The separate browser publication at `127.0.0.1:3002` is superseded because WSL2 Windows browsers cannot reach WSL-loopback Docker binds. Reuse the established OpenCode same-port virtual-host architecture with the exact browser origin `http://vscode.localhost:3000/`, private code-server at `127.0.0.1:4100`, Host/Origin/CSP isolation, and no LAN or remote support. Prior VSCODE-100/101 evidence remains historical; `3002` acceptance is not current.
<!-- (work-complete) VSCODE-101 2026-08-02T05:38:24Z ingenium-docs -->
Evidence VSCODE-101: dashboard627, security CSP PASS, fresh seven-process deployment, live Docker 1/1, browser interaction, visual artifacts, and `tests/artifacts/test-runs/run-20260801-chat101-deploy/acceptance.md`; the superseded `3002` publication/origin remains historical and is not current acceptance.
<!-- (work-started) VSCODE-102 2026-08-02T05:38:25Z ingenium-docs -->
<!-- (work-complete) VSCODE-102 2026-08-02T09:20:01Z ingenium-docs -->
Evidence VSCODE-102: exact public origin `http://vscode.localhost:3000/` verified with no host `3002` or public `4100`; private code-server `4100` and seven supervised processes verified; security CSP, worker, and static-chunk boundaries verified; fresh deployment acceptance recorded in `tests/artifacts/test-runs/run-20260801-vscode102/acceptance.md`; browser/visual evidence recorded under `tests/artifacts/visual-qa/run-20260801-vscode102/`; persistence marker restart/remove/volume-preserve behavior verified; `npm test`, typecheck, lint, and build passed; fixture E2E `105/105` with strict containment, Docker `30/30`, and route parity `61/61` passed. Artifact, append-only, and agent gates from the prior full phase remain pending the final post-marker rerun and are not claimed here. Known follow-ups: Windows elevated firewall-rule behavior is unverified although the default inbound block remains; pinned optional VSDA404; upstream activity labels/external Copilot metadata; pre-existing broken docs link.
<!-- (work-started) JOB-100 2026-08-02T09:34:56Z ingenium-docs -->

**JOB-100 decision/work-started marker (2026-08-02 UTC; `ingenium-docs`):** Conservative v1 trusted catalog is limited to the existing immutable Context maintenance producers: `context.conversation.archived`, `context.conversation.unarchived`, and `context.checkpoint.restored_as_new`. Payloads contain content-free identifiers and revisions only. Provenance uses the immutable Context audit source ID; deduplication is by project + event type + source audit ID; retention is indefinite and append-only until an explicit authorized project lifecycle action. Unknown historical jobs are preserved, but every new or changed `trigger_event` must be cataloged. Dispatch and scheduler work is deferred to JOB-101.

Rationale: source inspection found no existing job event producer or canonical event catalog; the existing job `trigger_event` field is generic. This conservative boundary reuses immutable Context audit evidence without widening v1 to arbitrary events or scheduler behavior.
<!-- (work-complete) JOB-100 2026-08-02T10:28:35Z ingenium-docs -->
Evidence JOB-100: migration076, QA54+API3, Core780, security direct SQL recheck7, deployment run-20260802-job100 migration/catalog/hash/reversible API/API restart/7 services.
Finding JOB-100: FOLLOW_UP (out of scope): run API project-scoping security review; not a blocker for JOB-100.
<!-- (work-started) JOB-101 2026-08-02T10:34:27Z ingenium-docs -->
Evidence JOB-101: decision/work-started scope is exact-match same-project enabled jobs; snapshot every existing undispatched migration076 event once; unique delivery per project+event+job; exactly-once enqueue with bounded at-least-once execution after verified teardown; max five attempts at 30/60/120/300/600 seconds; hash-only lease token with CAS; ambiguous live processes dead-letter rather than duplicate; no payload prompt interpolation; no manual replay; indefinite sanitized audit; and close-run/log project-scoping follow-up.
<!-- (work-complete) JOB-101 2026-08-02T12:01:49Z ingenium-docs -->
Evidence JOB-101: migration077; Core791/API751/server403 source evidence; focused QA; security10+11/direct; deployment run-20260802-job101 with preserved hashes, 24 runtime tests, and 7 processes; full2783, typecheck/lint0/build, fixture105, strict/db/append/artifact checks passed. Exact-match same-project fanout, one existing-backlog snapshot, exactly-once delivery creation with bounded at-least-once execution, five attempts with fixed backoffs, hash-only lease/process proof, ambiguous-identity no-duplicate handling, allowlisted child environment and redacted logs, active-delete 409, project-scoped run/log/cancel, bounded event/delivery GETs, and no payload prompt interpolation/manual replay are complete. No unresolved blocker.
<!-- (work-started) JOB-102 2026-08-02T12:11:02Z ingenium-docs -->

**JOB-102 decision/work-started marker (2026-08-02 UTC; `ingenium-docs`):** With JOB-101 complete, the existing `/jobs` route gains Jobs, Event queue, and Trusted events views. Use an exact static-catalog Select while preserving legacy values; cursor pagination uses load-more with client filters explicitly labeled as loaded results. Event and delivery state is read-only: do not display payloads, process details, or lease owners. Existing **Run Now** remains a fresh manual run, not replay. Provide no event/dead-letter/retry mutations, show active delete `409` responses, and use mobile cards with desktop tables. Acceptance includes the deployed visual and full-site gates.

<!-- (work-complete) JOB-102 2026-08-02T13:51:30Z ingenium-docs -->
Evidence JOB-102: Canonical Jobs documentation records the `/jobs` Jobs, Event queue, and Trusted events views; loaded-results client filters, cursor load-more, and polling; the exact trusted-event Select with legacy preservation; metadata-only read-only behavior with no payloads or replay; fresh manual Run Now semantics; bounded retries/dead-letter behavior; active-delivery delete `409`; and responsive/accessibility states. Verification evidence: dashboard634, focused16, full fixture118, QA/security rechecks, fresh deploy7 with route/API checks, active interaction JSON, visual run `run-20260802-job102/full-site`, strict/artifact/append checks, and diff/link/format review. The optional `/vscode` 404 is informational only and is not a JOB-102 blocker.
<!-- (work-started) USAGE-100 2026-08-02T13:59:14Z ingenium-docs -->

**USAGE-100 decision/work-started marker (2026-08-02 UTC; `ingenium-docs`):** The current contract is advisory thresholds over the existing migration068 ledger, with no producer or ledger expansion. Thresholds are project-scoped and nullable for requests, total tokens, provider-reported numeric cost (no currency or inference), cache read, and cache write. Evaluation uses a caller-selected explicit UTC `from`/`to` range, or the existing all-history summary when omitted; thresholds have no implicit day or month. States are `disabled`, `unknown`, `below`, `equal`, and `above`; `unknown` never becomes zero. Results are advisory only and never block, throttle, or route. Implementation scope is migration078 plus API/Core, with no MCP; UI is deferred to USAGE-102 and attention to USAGE-101.
<!-- (work-complete) USAGE-100 2026-08-02T14:54:17Z ingenium-docs -->
Evidence USAGE-100: Core797/API755 source evidence; QA/probe fix; security14; deployment run-20260802-usage100 with migration, hashes, temporary acceptance, API restart, and seven-process verification. Scheduler `usage_sync_state` cursor behavior is informational; events, mappings, and thresholds remain unchanged. Full gates passed: typecheck, build, lint (0), fixture118, strict containment, database isolation, append-only, and artifact checks; dashboard634 passed after canonical reservation recovery. Targeted link, Markdown format, append-only, and diff checks passed.
Finding USAGE-100: FOLLOW_UP (Core-only coverage): archived-project and range-bound edge cases are recorded in Core evidence; retain as follow-up if a separately required deployed/API matrix is needed. No in-scope blocker remains.
<!-- (work-started) USAGE-101 2026-08-02T15:04:46Z ingenium-docs -->

**USAGE-101 decision/work-started marker (2026-08-02 UTC; `ingenium-docs`):** Migration079 is dedicated to the usage attention/items transition audit. Use one stable all-history key for each of the five metrics. Active states are `unknown` (informational), `equal` (warning), and `above` (critical); `below` and `disabled` resolve. Repeated unchanged refreshes emit no event; material changes emit an event and clear acknowledgement. A resolved condition reopens the same row. Acknowledgement uses CAS and never resolves an item. Freshness is `disabled`, `unknown`, `fresh`, or `stale`, based on the sync interval and successful-sync evidence. Scope is API list/evaluate/ack only, with no MCP, enforcement, channels, ranges, or UI.
<!-- (work-complete) USAGE-101 2026-08-02T19:00:00Z ingenium-docs -->
Evidence USAGE-101: Core802/API762; QA15+11 and security concurrency/direct-SQL review; deployment run `run-20260802-usage101` covering migration/schema/hashes, isolated lifecycle, API restart 7, and scheduler/API behavior; final type/lint (0)/build, fixture118, strict containment, database-isolation, append-only, and artifact checks passed. Migration079 attention is advisory and API-only: five stable all-history condition keys, unknown/equal/above active severities, below/disabled resolution, same-row reopen, CAS acknowledgement, freshness from successful mapped-source sync evidence, and no enforcement, ranges, channels, or MCP surface. Canonical link/format/append/diff checks passed. Agent validation is reported separately after this dependency-graph reconciliation.
#### VSCODE-103 — System theme and pinned OpenCode extension

- **IN_SCOPE:** Set code-server system color-scheme defaults for fresh and existing `vscode-data` volumes; bake the official Open VSX `sst-dev.opencode@0.0.13` VSIX with SHA-256 `e9a75751aa21fce3f9c9822d1f718043b1a9ba97e64c66b190a3fa85850c60d4`; validate build identity and engine compatibility; install the pinned extension offline and idempotently as `appuser` into persisted extensions; preserve user settings and existing extensions; verify deployment, dark/light system-theme behavior, pinned extension behavior, and visual acceptance.
- **OUT_OF_SCOPE:** Disabling workspace trust, running extension commands, provider authentication, marketplace network access at runtime, unrelated VS Code customization, or extension auto-update redesign.
- **Owner:** `@ingenium-software-engineer-premium`.
- **Dependencies:** VSCODE-102.
- **Acceptance:** Fresh and existing `vscode-data` volumes both receive the system color-scheme defaults and the pinned extension without losing user settings or existing extensions; restart and offline operation remain successful; the extension list reports exactly `sst-dev.opencode` at version `0.0.13`; explicit user theme values remain unchanged; system dark and light changes are followed when no explicit user value overrides them; build identity, VSIX SHA-256, and code-server engine compatibility are verified; installation is offline, `appuser`-owned, persisted, and idempotent; visual acceptance covers dark/light themes and the extension; evidence contains no content or secrets; all 7 services remain healthy.
- **STOP_CONDITION:** `PASS` only after fresh/existing-volume, restart/offline, provenance, persistence, security, deployment, dark/light visual, extension, seven-service, and marker checks pass; otherwise continue in scope or permitted escalation.
- **Escalation:** Only unavailable required deployment/browser/build access, unauthorized destructive volume cleanup, a genuine product decision or ambiguity, or bounded diagnosis that cannot reproduce a root cause.
- **Verification owner:** `@ingenium-qa` owns the declared deployment and acceptance pass; `@ingenium-security-auditor` owns the bounded provenance, offline, ownership, and no-content/secrets review; `@ingenium-qa-vision` owns the dark/light and extension visual gate.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Verify the baked VSIX before installation; preserve `vscode-data`, user settings, and pre-existing extensions; install only as `appuser` into the persisted extension directory; stop/remove only owned fixtures; rollback removes the pinned extension/theme additions without deleting the volume or altering unrelated VSCode/OpenCode state.
- **Tests:** Build identity and code-server engine checks; exact VSIX SHA-256 and extension manifest/version checks; offline install and no-marketplace-network checks; fresh-volume and existing-volume preservation checks; appuser ownership, idempotence, persisted extension-directory, restart, and offline checks; explicit theme-value preservation and system dark/light follow checks; exact extension-list check; content/secrets redaction checks; seven-service health/deployment checks; 1440x900 and 390x844 dark/light/extension visual, accessibility, console/network, and browser-cleanup checks.
- **Docs:** This roadmap only until verified behavior directly affects a canonical operational or security document; no Docs Workspace writes or broad regeneration.
- **Exclusive writer territory:** Code-server theme defaults, baked VSIX/provenance, persisted appuser extension installation, and VSCODE-103 deployment/acceptance fixtures; no overlap with dashboard route or unrelated VS Code customization files.
- **Phase/counts:** P5 VSCode continuation; 1 writer / 3 nonwriters; premium owns implementation and deployment, QA owns acceptance, security owns provenance/boundary review, and QA vision owns visual acceptance; serialized after VSCODE-102.
- **Verification plan:** Rebuild the current merged source, inspect build identity/engine/VSIX provenance, run fresh and existing volume fixtures, restart and exercise offline behavior, verify theme and extension state without collecting content or secrets, run the seven-service deployment and dark/light visual gates once, then fix and rerun only the smallest check proving each reproducible in-scope root cause before reconciling markers.
- **Causal remediation rule:** Fix the earliest proven build, engine, install ownership, persistence, theme precedence, offline, network, or visual-state producer; never mask extension/version or user-setting loss with a post-install rewrite.
- **Finding classification:** Wrong artifact/hash/version, engine incompatibility, marketplace runtime dependency, non-idempotent or non-appuser install, user-setting/extension loss, theme-precedence regression, content/secrets exposure, unhealthy service, or failed in-scope visual acceptance is `BLOCKING`; unrelated VS Code customization or auto-update behavior is `FOLLOW_UP`; deployment and visual evidence are `INFORMATIONAL`.

<!-- (work-started) VSCODE-103 2026-08-02T16:10:25Z ingenium-docs -->
<!-- (work-complete) VSCODE-103 2026-08-02T18:58:51Z ingenium-docs -->
Evidence VSCODE-103: canonical run `tests/artifacts/test-runs/run-20260802-vscode103/` and visual path `tests/artifacts/visual-qa/run-20260802-vscode103/`; code-free built-in `configurationDefaults` verified for automatic system detection with Dark Modern/Light Modern and explicit user/workspace precedence; official Open VSX `sst-dev.opencode@0.0.13` URL/SHA verified; image-baked offline appuser install, fresh/existing `vscode-data` persistence, restart/upgrade identity-engine-hash revalidation, no runtime registry install, Restricted Mode/user-trust boundary, QA/security review, Docker specification, and all 7 supervisord services verified.
<!-- (work-started) USAGE-102 2026-08-02T19:22:31Z ingenium-docs -->

**USAGE-102 decision/work-started marker (2026-08-02 UTC; `ingenium-docs`):** With USAGE-101 complete, extend the existing `/usage` route only: add an advisory threshold editor with selected UTC evaluation, and all-history attention cards/list with exact-five metrics. Retain draft values and require reload on CAS conflict; provide active/resolved filtering plus acknowledge, evaluate, and load-more actions, including event load-more. Use explicit unknown/not-reported/partial wording; do not add currency, enforcement, or provider branding. A project switch resets all usage state. No settings or navigation change; acceptance includes desktop/mobile changed-route and full-site visual gates. Scope is implementation plus the declared gates only; no completion marker, other docs/tasks, or Docs Workspace work.

#### UI-103 — Dockable side navigation and hover scrollbar

- **IN_SCOPE:** Add the burger immediately before the logo; support a persisted desktop full `224px` ↔ compact `56px` icon rail state applied before paint; retain the existing full drawer on mobile only; preserve the current theme, links, groups, and active states; add a hover-only stable scrollbar with no idle gutter; provide accessible names and native `title` text in the icon rail; implement focus trap/restoration, unique IDs, unmounted closed-drawer behavior, Escape, backdrop dismissal, route-close behavior, and reduced-motion handling; verify desktop, mobile, and full-site gates.
- **OUT_OF_SCOPE:** Route, group, or content redesign; global scrollbar changes; YouTube styling; hiding navigation entirely.
- **Owner:** `@ingenium-software-engineer-fast`.
- **Dependencies:** UI-102 (complete).
- **Acceptance:** Burger placement is immediately before the logo; desktop full/compact navigation persists and is applied without a hydration or first-paint flash; mobile retains only the existing full drawer behavior; current theme, links, groups, and active states remain intact; idle scrollbars are not visible, hover reveals the thumb, and scrollbar width is stable with no layout shift or overflow; keyboard, touch, and wheel interactions work; rail controls have accessible names and native titles; focus trapping/restoration, unique IDs, closed-drawer unmounting, Escape, backdrop dismissal, route close, reduced motion, deployment, changed-route visual, and full-site desktop/mobile gates pass.
- **STOP_CONDITION:** `PASS` after focused interaction/accessibility tests, deployed dashboard acceptance, desktop/mobile visual gates, full-site gates, and marker reconciliation; otherwise continue in scope or permitted escalation.
- **Escalation:** Only unavailable required browser/deployment access, a genuine product decision or ambiguity in navigation interaction semantics, or bounded diagnosis that cannot reproduce a root cause.
- **Verification owner:** `@ingenium-qa`; `@ingenium-qa-vision` owns the changed-route and passive full-site desktop/mobile visual gates.
- **Deployment owner:** `@ingenium-software-engineer-premium`.
- **Rollback/safety:** Preserve the current navigation model and mobile drawer; keep persistence fail-safe and hydration-safe; change only dashboard navigation/scrollbar behavior and focused tests; do not alter global scrollbar styles, unrelated routes, or other dirty files.
- **Tests:** Navigation component/accessibility tests; persistence/pre-paint and hydration tests; focus trap/restoration, unique-ID, unmount, Escape, backdrop, route-close, reduced-motion, keyboard/touch/wheel, scrollbar-hover/stability, overflow, console/network, deployment health, changed-route 1440x900/390x844 screenshots, and passive full-site desktop/mobile checks with browser cleanup.
- **Docs:** This roadmap only; no other canonical documentation or Docs Workspace work.
- **Exclusive writer territory:** Dashboard navigation components, navigation scrollbar styles/utilities, and focused UI-103 tests; no overlap with VSCode, Chat, usage, or shared control files.
- **Phase/counts:** P5 UI continuation; 3 writers / 3 nonwriters; fast owns navigation implementation, premium owns deployment, docs owns roadmap only; serialized after UI-102.
- **Verification plan:** Inspect the existing navigation and drawer contracts, implement the smallest shared desktop/mobile boundary, run focused interaction/accessibility and persistence/hydration checks once, deploy the merged dashboard, inspect changed routes at both viewports and the passive full-site sweep, then fix only reproducible in-scope roots and rerun the smallest proving check before reconciling markers.
- **Causal remediation rule:** Fix the earliest navigation state, persistence/hydration, focus lifecycle, route-close, scrollbar geometry, or responsive boundary proven by source, DOM, and event evidence; do not mask it with page-specific CSS or click-only fallbacks.
- **Finding classification:** Broken navigation interaction, accessibility/focus behavior, persistence/hydration, layout/overflow, scrollbar stability, deployment, or in-scope visual acceptance is `BLOCKING`; route/group/content redesign, global scrollbar changes, YouTube styling, or unrelated UI drift is `FOLLOW_UP`; browser variance and retained evidence are `INFORMATIONAL`.

<!-- (work-started) UI-103 2026-08-02T20:42:39Z ingenium-docs -->

**UI-103 decision/work-started marker (2026-08-02 UTC; `ingenium-docs`):** With UI-102 complete, keep mobile navigation as the existing full drawer and add only the desktop dockable full/compact rail. The burger sits immediately before the logo; the compact rail preserves current links, groups, active states, theme, accessible names, and native titles. Persist the desktop state before paint without hydration drift. Closed mobile drawers unmount, trap and restore focus, use unique IDs, close on Escape/backdrop/route, and honor reduced motion. The scrollbar is stable and invisible at rest, revealing its thumb on hover without global scrollbar changes or layout shift. Acceptance includes keyboard/touch/wheel, deployment, changed-route, and passive full-site desktop/mobile gates; no other docs or Docs Workspace work.
<!-- (work-complete) UI-103 2026-08-02T21:30:00Z ingenium-docs -->
Evidence UI-103: burger immediately before the logo; desktop 224px↔56px persisted icon rail applied before paint; mobile modal drawer with focus trap/restoration, inert background, unique IDs, Escape/backdrop/route close, viewport resize cleanup, and reduced-motion behavior; hover-only stable scrollbar with no overflow or layout shift. Deployment evidence `tests/artifacts/test-runs/run-20260802-ui103/`; active interaction/final proof and desktop/mobile visual/full-site evidence under `tests/artifacts/visual-qa/run-20260802-ui103/`; dashboard655, fixture120, QA/security review, and strict containment verification recorded.
<!-- (work-complete) USAGE-102 2026-08-02T21:31:00Z ingenium-docs -->
Evidence USAGE-102: `/usage` thresholds editor with CAS revision handling and retained drafts; selected inclusive-from/exclusive-to UTC advisory evaluation; active/resolved attention filtering with acknowledge, evaluate, and paging; event paging; explicit unknown/zero/partial/freshness wording; no currency inference or enforcement; project reset behavior. Deployment evidence `tests/artifacts/test-runs/run-20260802-usage102/`; active interaction and desktop/mobile visual/full-site evidence under `tests/artifacts/visual-qa/run-20260802-usage102/`; dashboard655, fixture120, and security review recorded.
<!-- (work-started) VAULT-100 2026-08-02T23:02:18Z ingenium-docs -->

**VAULT-100 decision/work-started marker (2026-08-02 UTC; `ingenium-docs`):** IN_SCOPE is migration080 normalized `job_vault_references` plus immutable authorize/revoke audit; optional bounded `vault_item_ids` on job create/PATCH/MCP create; omitted preserves/no reference by default, while empty revokes; same-project active items use a fail-closed generic error; sealed and unsealed responses expose metadata only (IDs/status/version/timestamps); actor is `authenticated_api`; stable IDs follow item revisions. Dependencies DOC-100 and JOB-100 are complete. No reveal, decrypt, unseal, runner injection, or UI. OUT_OF_SCOPE is completion, other docs/tasks/Docs Workspace, and crypto/AAD/backups/rotation.
<!-- (work-complete) VAULT-100 2026-08-02T23:56:55Z ingenium-docs -->

Evidence VAULT-100: Core808 (`packages/ingenium-core/tests/job-vault-references.test.ts`), API766 (`services/ingenium-api/tests/jobs-vault-references-api.test.ts`), server406 (`services/ingenium-server/tests/jobs-vault-references.test.ts`), QA/security review, and canary evidence `run-vault100` cover sealed-safe metadata, omitted/empty/replace semantics, seven sealed/hash/fixture checks, same-project active-item enforcement, generic errors, immutable audit actor `authenticated_api`, stable item versions, and absence of secret material. Deployment evidence `run-vault100`; full120, strict containment, database-boundary, agent validation, and artifact checks passed. No VAULT-101 injection/rotation/UI, crypto/AAD/backups, or Docs Workspace work was performed.
<!-- (work-started) VAULT-101 2026-08-03T00:06:18Z ingenium-docs -->

**VAULT-101 decision/work-started marker (2026-08-03 UTC; `ingenium-docs`):** At execution time, explicitly reauthorize each vault reference for one attempt only; fail closed before spawn when authorization is sealed, missing, deleted, foreign, revoked, expired, or version-stale. Inject only through protected run-owned `/dev/shm` UUID files with directory mode `0700` and file mode `0600`, plus a nonsecret `INGENIUM_VAULT_SECRET_FILES` ID-to-path map; never expose values through environment variables, argv, prompts, logs, DB, API, or MCP. Vault-enabled output is wholly redacted. Retries re-resolve authorization. Cleanup and zeroization cover every terminal, crash, and shutdown path. Reuse the existing metadata audit; never auto-unseal. A same-ID PATCH may refresh the authorization version if required. No migration by default. Dependencies VAULT-100 and JOB-101 are complete. OUT_OF_SCOPE is UI, rotation, crypto, backups, aliases, environment values, and strong same-UID isolation.
<!-- (work-complete) VAULT-101 2026-08-02T02:41:27Z ingenium-software-engineer-premium -->

**VAULT-101 deployment acceptance (2026-08-02 UTC; content-free evidence):** Rebuilt and force-recreated the current working tree (image label SHA `99d39f0dd620cbc9a10af238fe2b438cd1fadd95`). Build-time deployment validation and production build passed. The live composite health check passed all seven supervised services and its configured routes. Live vault status returned `{status:200,sealed:true,initialized:true,itemCount:0,folderCount:0}`; no unseal or job was invoked. Migration 081 was complete (its 2 tables and 8 required triggers present), with zero foreign-key violations. The pre/post metadata-only vault digest was unchanged: `d4f5bd6f57505cdf538ce1bff880eee82522a9940987fecef2a3e2908d9e03db` (`vaultConfigRows:1`, `vaultItemCount:0`, `vaultAuditCount:2`). The deployed tmpfs root validated as a non-symlink directory owned by UID `1000`, mode `0700`, with `entryCount:0`. In-container checks passed: the isolated tmpfs-root fixture and the three prepared safe-partial cleanup, unsafe-directory retention, and nonce-race retention canaries. No browser, Docs Workspace, UI, or application-source changes were made during deployment acceptance.

**VAULT-101 reconciliation note (2026-08-03 UTC):** The immediately preceding VAULT-101 completion paragraph is superseded for its timestamp only; its evidence and completion claim are unchanged. The current UTC completion marker below is authoritative for reconciliation.
<!-- (work-complete) VAULT-101 2026-08-03T02:57:24Z ingenium-docs -->

Evidence VAULT-101: Core818 (`packages/ingenium-core/tests/vault-job-runs.test.ts` and `packages/ingenium-core/tests/vault-job-secrets.test.ts`), API784 (`services/ingenium-api/tests/job-runner-lifecycle.test.ts` and `services/ingenium-api/tests/jobs-vault-references-api.test.ts`), server406 (`services/ingenium-server/tests/jobs-vault-references.test.ts`), QA/security review and targeted rechecks, plus full120, establish one-attempt explicit reauthorization, fresh retry resolution, sealed/missing/deleted/foreign/revoked/expired/version-stale fail-closed behavior, tmpfs UUID files, the nonsecret `INGENIUM_VAULT_SECRET_FILES` ID-to-path map, no secret-value surfaces/output, process-group recovery, and cleanup/zeroization. Deployed canonical vault101 acceptance passed after rebuild and force-recreate: migration081 schema evidence is 2 tables/2 indexes/8 triggers (5 run + 3 item) with FK0; final partial-cleanup, unsafe-directory-retention, and nonce-race canaries passed; sealed vault state and metadata hashes were unchanged; all 7 health checks passed. No VAULT-102 UI, rotation/AAD/backups, Docs Workspace, or unrelated drift work was performed.
<!-- roadmap:supersede task=VAULT-101 kind=work-complete original=2026-08-02T02:41:27Z replacement=2026-08-03T02:57:24Z reason=clock-skew -->
<!-- (work-started) VAULT-102 2026-08-03T03:24:58Z ingenium-docs -->

**VAULT-102 decision/work-started marker (2026-08-03 UTC; `ingenium-docs`):** IN_SCOPE is migration082 job-revision CAS; sealed-safe metadata-only reference statuses `authorized`, `version_stale`, and `unavailable`; job-scoped metadata-only authorize/revoke/secret_read/access_denied audit; and the existing Jobs create/edit picker behavior: unsealed allows selection, sealed allows revoke only, reference changes and refresh require explicit confirmation, and CAS conflicts preserve the draft. Desktop/mobile visual and full-site gates are required. Dependencies VAULT-101 is complete. No values. OUT_OF_SCOPE is auto-unseal, reveal, rotation, crypto, backups, aliases, settings, and navigation redesign.

<!-- (work-complete) VAULT-102 2026-08-03T04:51:54Z ingenium-docs -->
Evidence VAULT-102: migration082 revision CAS and sealed-safe metadata contracts are documented in `docs/develop/database.md`, `docs/develop/api.md`, `docs/operations/jobs.md`, `docs/security/index.md`, `docs/usage/secrets.md`, and `docs/usage/dashboard.md`; field names are `status` and `authorized_item_version`; the existing Jobs picker/confirmation/revoke/refresh behavior, CAS draft retention, no-value boundary, and audit actions are recorded. Full counts, deployment `run-vault102`, active/visual/full-site acceptance, security, and QA evidence are retained by the implementation acceptance record. `sweep429` and existing Secrets label/form observations are FOLLOW_UP only; no rotation/AAD/backups, unseal/reveal redesign, unrelated docs, or Docs Workspace work was performed.
<!-- (work-started) RESTORE-100 2026-08-03T04:59:04Z ingenium-docs -->

**RESTORE-100 decision/work-started marker (2026-08-03 UTC; `ingenium-docs`):** Ready for executor: IN_SCOPE is the migration083 restore plan/auth/event/receipt state machine; signed v2 fixed-name directory bundles; a dedicated persistent HMAC-SHA256 key file, defaulting to owner-only under Ingenium data and supporting a configurable path; legacy preview-only behavior with confirmation denied; the server-global `Ingenium` + OpenCode DB; dry-run preview, one-time token, CAS/idempotency/audit, and receipt state; API/MCP operator command surfaces only, with no UI. OUT_OF_SCOPE is executor/DB swap/WAL/services/rollback (RESTORE-101), UI (RESTORE-102), and other resources/offhost. No apply.

**RESTORE-100 documentation completion marker (2026-08-03 UTC; `ingenium-docs`):** Canonical operations, API, migration, variable, MCP, architecture, and security docs now record the signed v2 fixed-file bundle contract, manifest schema fingerprints and key-file boundary, legacy preview-only behavior, migration 083 immutable revisions/audit/idempotency/one-time authorization, preview-authorize-confirm-status-audit surfaces, legacy `confirm: true` `410`, `ready_for_executor` as the only preparation outcome, tamper-evident staging and validated bounded-buffer handoff, no active database apply, and source preservation. Evidence is the canonical authenticated index plus targeted Core/API/MCP restore tests, deployment acceptance, security review, QA review, and full-count reconciliation recorded by the implementation acceptance run. The auth-id SQL mutability question is a RESTORE-101 follow-up unless that executor contract requires it. No RESTORE-101/102, UI, other-resource/off-host, or Docs Workspace work was performed.
<!-- (work-complete) RESTORE-100 2026-08-03T08:00:03Z ingenium-docs -->
Evidence RESTORE-100: migration083 inventory tests passed 4/4, API restore-contract tests passed 6/6, and MCP adapter tests passed 3/3; append-only and agent validation were rerun after the marker repair. Canonical authenticated-index, deployment, security, QA, and full-count evidence remain the implementation acceptance record; no active apply was run. The auth-id SQL mutability question is FOLLOW_UP for RESTORE-101.
<!-- (work-started) RESTORE-101 2026-08-03T08:09:32Z ingenium-docs -->

**RESTORE-101 decision/work-started marker (2026-08-03 UTC; `ingenium-docs`):** With RESTORE-100 complete, IN_SCOPE is migration084 executor authorization/run/events using a second one-time live token; a fixed Supervisor restore-maintenance process; an external authenticated journal/control capsule; quiesce, `pre_restore` snapshot, recoverable two-DB swap, migration/capsule rehydrate, health/rollback/crash recovery, and bounded timeouts; plus API/MCP authorize/execute/status/audit surfaces. All destructive gates use disposable Compose fixtures only and never normal volumes. OUT_OF_SCOPE is RESTORE-102 UI/automatic triggers, other resources, live operator restore, and off-host execution. No real-volume apply or RESTORE-102 work.
